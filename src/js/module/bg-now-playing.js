// Authentication stays in the extension worker. Content scripts send playback
// data only; the recovery token is never placed in a URL or returned as status.
export const NOW_PLAYING_URL = 'https://lrchub.coreone.work/api/now-playing';

const MAX_LYRICS_BYTES = 128 * 1024;
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(value).byteLength;

const isPublicArtworkUrl = value => {
  if (typeof value !== 'string' || byteLength(value) > 300) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(host) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(host) &&
      !host.endsWith('.localhost') && !host.endsWith('.local');
  } catch {
    return false;
  }
};

// Whitelist the documented fields instead of forwarding arbitrary messages.
export function normalizeNowPlayingPayload(value) {
  if (!value || typeof value !== 'object' || !value.track ||
      typeof value.track !== 'object') return null;
  const track = {};
  for (const key of ['id', 'title', 'artist', 'album']) {
    if (typeof value.track[key] !== 'string') return null;
    track[key] = value.track[key];
  }
  if (!track.id.trim() || !track.title.trim()) return null;
  if (!Number.isSafeInteger(value.position_ms) || value.position_ms < 0 ||
      !Number.isSafeInteger(value.duration_ms) || value.duration_ms < 0 ||
      typeof value.is_playing !== 'boolean') return null;
  const payload = {
    track,
    position_ms: value.position_ms,
    duration_ms: value.duration_ms,
    is_playing: value.is_playing,
  };
  if (value.artwork_url != null && value.artwork_url !== '') {
    if (!isPublicArtworkUrl(value.artwork_url)) return null;
    payload.artwork_url = value.artwork_url;
  }
  for (const key of ['lyrics', 'current_lyric']) {
    if (value[key] == null) continue;
    if (typeof value[key] !== 'string' || byteLength(value[key]) > MAX_LYRICS_BYTES) return null;
    payload[key] = value[key];
  }
  if (value.session_id != null || value.sequence != null) {
    if (typeof value.session_id !== 'string' || !value.session_id.trim() ||
        value.session_id.length > 128 || !Number.isSafeInteger(value.sequence) ||
        value.sequence < 1) return null;
    payload.session_id = value.session_id;
    payload.sequence = value.sequence;
  }
  return payload;
}

const senderIdentity = sender => ({
  tabId: sender?.tab?.id,
  documentId: typeof sender?.documentId === 'string' ? sender.documentId : '',
});
const sameDocument = (owner, sender) => owner && owner.tabId === sender.tabId &&
  (!sender.documentId || !owner.documentId || owner.documentId === sender.documentId);

export function createNowPlayingRelay({
  loadSettings,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  loadOwner = async () => null,
  saveOwner = async () => {},
}) {
  let owner = null;
  // Kept only in worker memory; persisted ownership contains no credential.
  // This distinguishes a fresh publish using a replacement credential from the
  // old account's cleanup when storage events race with content messages.
  let ownerToken = '';
  let initialized = false;
  let running = false;
  let lastStatus = { ok: true, active: false };
  const pending = [];
  const sequences = new Map();

  const initialize = async () => {
    if (initialized) return;
    const stored = await loadOwner();
    if (stored && Number.isInteger(stored.tabId)) owner = stored;
    initialized = true;
  };
  const setOwner = async (value, token = '') => {
    owner = value;
    ownerToken = value ? token : '';
    await saveOwner(value);
  };
  const tokenOf = settings => typeof settings?.recoveryToken === 'string'
    ? settings.recoveryToken.trim() : '';
  const request = async (method, token, payload) => {
    if (!token) return { ok: false, error: 'NO_TOKEN' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(NOW_PLAYING_URL, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
      let data = null;
      try { data = await response.json(); } catch { /* DELETE may return 204. */ }
      const result = {
        ok: response.ok,
        status: response.status,
        ...(response.ok ? {} : { error: `HTTP_${response.status}` }),
      };
      if (typeof data?.active === 'boolean') result.active = data.active;
      else if (response.ok && method === 'DELETE') result.active = false;
      const state = data?.social?.worker?.state;
      // The API's state is a small machine identifier, never a server message.
      if (typeof state === 'string' && /^[a-z_-]{1,64}$/.test(state)) {
        result.social = { worker: { state } };
      }
      return result;
    } catch {
      return { ok: false, error: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' };
    } finally {
      clearTimeout(timer);
    }
  };

  const execute = async job => {
    await initialize();
    const settings = await loadSettings();
    const token = tokenOf(settings);
    if (job.action === 'reset') {
      // A changed/removed credential must clear its old account, not the new one.
      const clearToken = typeof job.previousToken === 'string' ? job.previousToken.trim() : token;
      let result = clearToken ? await request('DELETE', clearToken) : { ok: true, active: false };
      if (result.error === 'NETWORK_ERROR' || result.error === 'TIMEOUT') {
        // One bounded retry also covers an unloading content script whose
        // response callback cannot schedule another attempt.
        result = await request('DELETE', clearToken);
      }
      const clearsCurrentOwner = !ownerToken || ownerToken === clearToken;
      if (clearsCurrentOwner && (result.ok || job.credentialsChanged)) {
        await setOwner(null);
        sequences.clear();
      }
      return result;
    }
    if (job.action === 'clear') {
      if (!sameDocument(owner, job.sender)) return { ok: true, ignored: true };
      const result = token ? await request('DELETE', token) : { ok: false, error: 'NO_TOKEN' };
      // Keep ownership after a transient failure so the same client's retry can
      // still clear its presence instead of being mistaken for an idle tab.
      if (result.ok) await setOwner(null);
      return result;
    }
    if (settings?.enabled !== true) return { ok: false, error: 'DISABLED', active: false };
    if (!token) return { ok: false, error: 'NO_TOKEN' };
    if (job.action === 'status') return request('GET', token);

    const payload = job.payload;
    if (!payload.is_playing && owner && !sameDocument(owner, job.sender)) {
      return { ok: true, ignored: true };
    }
    const sequenceKey = `${job.sender.tabId}/${job.sender.documentId}/${payload.session_id || ''}`;
    if (payload.session_id && payload.sequence <= (sequences.get(sequenceKey) || 0)) {
      return { ok: false, error: 'STALE_SEQUENCE', status: 409 };
    }
    if (payload.session_id) {
      sequences.set(sequenceKey, payload.sequence);
      while (sequences.size > 32) sequences.delete(sequences.keys().next().value);
    }
    await setOwner({
      ...job.sender,
      sessionId: payload.session_id || '',
      isPlaying: payload.is_playing,
    }, token);
    return request('POST', token, payload);
  };

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const job = pending.shift();
        let result;
        try { result = await execute(job); }
        catch { result = { ok: false, error: 'STORAGE_ERROR' }; }
        if (!result.ignored) lastStatus = result;
        job.resolve.forEach(resolve => resolve(result));
      }
    } finally {
      running = false;
    }
  };
  const enqueue = job => new Promise(resolve => {
    const latest = pending[pending.length - 1];
    // Keep the latest lyric/seek while a slow request is in flight. DELETE and
    // other documents remain ordered barriers, so a stop cannot be overtaken.
    if (job.action === 'update' && latest?.action === 'update' &&
        sameDocument(latest.sender, job.sender) &&
        latest.payload.session_id === job.payload.session_id) {
      if (!job.payload.session_id || job.payload.sequence > latest.payload.sequence) {
        latest.payload = job.payload;
      }
      latest.resolve.push(resolve);
    } else {
      pending.push({ ...job, resolve: [resolve] });
    }
    void pump();
  });
  return {
    update(value, sender) {
      const payload = normalizeNowPlayingPayload(value);
      const identity = senderIdentity(sender);
      if (!payload || !Number.isInteger(identity.tabId)) {
        return Promise.resolve({ ok: false, error: 'INVALID_PAYLOAD' });
      }
      return enqueue({ action: 'update', payload, sender: identity });
    },
    clear(sender) {
      return enqueue({ action: 'clear', sender: senderIdentity(sender) });
    },
    removeTab(tabId) {
      return enqueue({ action: 'clear', sender: { tabId, documentId: '' } });
    },
    disable(previousToken) {
      return enqueue({ action: 'reset', previousToken });
    },
    credentialsChanged(previousToken) {
      return enqueue({ action: 'reset', previousToken, credentialsChanged: true });
    },
    status() {
      return enqueue({ action: 'status' });
    },
    getStatus() {
      return lastStatus;
    },
  };
}
