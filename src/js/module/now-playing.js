// Optional LRCHub Discord relay. Credentials stay in the extension background;
// this isolated content script sends only playback data, never a recovery token.
(() => {
  const api = globalThis.chrome;
  if (!api?.runtime?.sendMessage || !api.storage?.local) return;

  const ENABLED_KEY = 'ytm_discord_enabled';
  const HEARTBEAT_MS = 30000;
  const RETRY_MS = 5000;
  const RESPONSE_TIMEOUT_MS = 15000;
  const sessionId = crypto.randomUUID();
  let sequence = 0;
  let enabled = false;
  let attachedMedia = null;
  let lastSignature = '';
  let lastTrack = '';
  let lastAttemptAt = 0;
  let retryAt = 0;
  let observed = null;
  let published = false;
  let inFlight = false;
  let inFlightAction = null;
  let pending = null;
  let suspended = false;
  let sendEpoch = 0;
  let lyricRefresh = null;
  let stage = 'disabled';
  const mediaEvents = ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked',
    'timeupdate', 'durationchange', 'loadedmetadata', 'emptied', 'ratechange'];

  const send = (action) => {
    if (inFlight) { pending = action; return; }
    if (action.payload && (!enabled || suspended)) return;
    inFlight = true;
    inFlightAction = action;
    const epoch = sendEpoch;
    lastAttemptAt = Date.now();
    stage = 'publishing';
    const message = action.payload
      ? { type: 'NOW_PLAYING_UPDATE', payload: { ...action.payload, session_id: sessionId, sequence: ++sequence } }
      : { type: 'NOW_PLAYING_CLEAR' };
    const done = (response) => {
      const failed = api.runtime.lastError || !response?.ok;
      if (epoch !== sendEpoch) return;
      inFlight = false;
      inFlightAction = null;
      if (stage === 'publishing') stage = failed ? 'relay_error' : 'received';
      if (failed) {
        lastSignature = '';
        retryAt = Date.now() + (response?.error === 'NO_TOKEN' ? HEARTBEAT_MS : RETRY_MS);
        // A DELETE may have failed after an earlier POST reached the server.
        if (!action.payload) published = true;
      } else {
        retryAt = 0;
        if (!action.payload) published = false;
      }
      const next = pending;
      pending = null;
      if (next) send(next);
    };
    try { api.runtime.sendMessage(message, done); }
    catch (_) { done(null); }
  };

  const clear = () => {
    lastSignature = '';
    observed = null;
    if (!published) return;
    published = false;
    send({ payload: null });
  };

  const publicArtwork = (value, id) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password &&
          new TextEncoder().encode(url.href).length <= 300) return url.href;
    } catch (_) { /* Data/blob covers cannot be fetched by Discord. */ }
    return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  };

  const syncPlayback = (event) => {
    // An unloading/throttled renderer may lose a message callback. A worker
    // poll can recover without waiting for a timer in that renderer to run.
    if (inFlight && Date.now() - lastAttemptAt >= RESPONSE_TIMEOUT_MS) {
      if ((inFlightAction && !inFlightAction.payload) || (pending && !pending.payload)) published = true;
      sendEpoch += 1;
      inFlight = false;
      inFlightAction = null;
      pending = null;
      lastSignature = '';
      retryAt = 0;
    }
    if (!enabled || suspended) {
      if (!enabled && !suspended && published && Date.now() >= retryAt) clear();
      stage = !enabled ? 'disabled' : 'suspended';
      return;
    }
    const media = document.querySelector('video.video-stream') || document.querySelector('video');
    if (media !== attachedMedia) {
      if (attachedMedia) mediaEvents.forEach(name => attachedMedia.removeEventListener(name, sync));
      attachedMedia = media;
      if (media) mediaEvents.forEach(name => media.addEventListener(name, sync, { passive: true }));
    }
    const isAd = (typeof isAdPlayingNow === 'function' && isAdPlayingNow()) ||
      !!document.querySelector('.ad-interrupting, .ad-showing');
    if (!media || media.ended || media.readyState === 0 || isAd) {
      if (Date.now() >= retryAt) clear();
      stage = isAd ? 'advertisement' : 'media_unavailable';
      return;
    }
    const metadata = typeof getMetadata === 'function' ? getMetadata() : null;
    const id = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
    if (!id || !metadata?.title?.trim()) {
      if (Date.now() >= retryAt) clear();
      stage = !metadata?.title?.trim() ? 'metadata_unavailable' : 'track_id_unavailable';
      return;
    }
    const trackKey = [id, metadata.title, metadata.artist].join('\u0000');
    if (trackKey !== lastTrack) {
      lastTrack = trackKey;
      if (typeof requestImmersionTick === 'function') requestImmersionTick();
    }
    if (typeof shouldWaitForSettledMetadata === 'function' && shouldWaitForSettledMetadata(metadata, id)) {
      stage = 'metadata_settling';
      return;
    }

    const rawPosition = typeof getCurrentPlaybackSeconds === 'function'
      ? getCurrentPlaybackSeconds() : media.currentTime;
    const position = Number.isFinite(rawPosition) ? Math.max(0, Math.round(rawPosition * 1000)) : 0;
    const duration = Number.isFinite(media.duration) ? Math.max(0, Math.round(media.duration * 1000)) : 0;
    let lyric = '';
    try {
      const resolver = globalThis.YTMImmersionDiscordLyrics?.getCurrentPlaybackLyricText;
      const resolved = typeof resolver === 'function' ? resolver() : null;
      if (typeof resolved === 'string') lyric = resolved;
    } catch (_) { /* Lyrics are optional while loading a new song. */ }
    const payload = {
      track: { id, title: metadata.title, artist: metadata.artist || '', album: metadata.album || '' },
      artwork_url: publicArtwork(metadata.src, id),
      // Always include intentional gaps, avoiding stale lyrics after a seek or
      // track change. The server need not guess timings for plain/animated text.
      current_lyric: lyric,
      position_ms: duration > 0 ? Math.min(position, duration) : position,
      duration_ms: duration,
      is_playing: !media.paused,
    };
    const now = Date.now();
    const signature = JSON.stringify({ ...payload, position_ms: 0 });
    const drift = observed && observed.track === trackKey && observed.playing === payload.is_playing
      ? Math.abs(position - observed.position - (observed.playing ? (now - observed.at) * (media.playbackRate || 1) : 0))
      : 0;
    observed = { track: trackKey, playing: payload.is_playing, position, at: now };
    const seeked = event?.type === 'seeking' || event?.type === 'seeked' || drift > 1500;
    const heartbeat = payload.is_playing && now - lastAttemptAt >= HEARTBEAT_MS;
    if (now < retryAt) { stage = 'waiting_retry'; return; }
    if (signature === lastSignature && !seeked && !heartbeat) return;
    lastSignature = signature;
    published = true;
    send({ payload });
  };

  const sync = (event) => {
    try { syncPlayback(event); }
    catch (_) {
      // Metadata/UI helpers may not be ready yet. Keep the collector installed
      // and let the next media event or worker poll retry the same snapshot.
      lastSignature = '';
      observed = null;
      stage = 'collector_error';
    }
  };

  const refreshLyrics = () => {
    if (!enabled || suspended || lyricRefresh) return;
    const refresh = globalThis.YTMImmersionDiscordLyrics?.refreshPlayback;
    if (typeof refresh !== 'function') return;
    const finished = () => {
      lyricRefresh = null;
      // Read the current track again; a completed lookup may belong to a song
      // that changed or was stopped while its lyrics were being fetched.
      if (enabled && !suspended) sync({ type: 'lyrics-refreshed' });
    };
    try {
      lyricRefresh = Promise.resolve(refresh()).then(finished, finished);
    } catch (_) { /* Optional lyrics must not block the media snapshot. */ }
  };

  const setEnabled = (value) => {
    const changed = enabled !== (value === true);
    enabled = value === true;
    if (typeof config !== 'undefined') config.discordEnabled = enabled;
    if (!enabled) { pending = null; clear(); stage = 'disabled'; return; }
    if (changed) {
      lastSignature = '';
      retryAt = 0;
      if (typeof requestImmersionTick === 'function') requestImmersionTick();
    }
    sync();
  };

  const suspend = () => {
    suspended = true;
    stage = 'suspended';
    pending = null;
    // A navigation can destroy this document before an outstanding callback
    // runs. Deliver DELETE to the worker now, which orders it after that POST.
    sendEpoch += 1;
    inFlight = false;
    inFlightAction = null;
    lastSignature = '';
    observed = null;
    if (!published) return;
    published = false;
    try {
      api.runtime.sendMessage({ type: 'NOW_PLAYING_CLEAR' }, () => { void api.runtime.lastError; });
    } catch (_) { /* Tab removal or the server's expiry also clears activity. */ }
  };

  // Read-only diagnostics contain no playback metadata, credentials or IDs.
  globalThis.YTMImmersionNowPlaying = Object.freeze({
    getDiagnostics: () => ({
      stage,
      last_attempt_at: Number.isFinite(lastAttemptAt) && lastAttemptAt > 0 ? lastAttemptAt : null,
    }),
  });

  api.storage.local.get(ENABLED_KEY, items => setEnabled(items?.[ENABLED_KEY]));
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== api.runtime.id) return;
    if (msg.type === 'NOW_PLAYING_POLL') {
      // Refresh lyric state without waiting for its network requests. Music
      // metadata and the media clock are sufficient to publish immediately.
      refreshLyrics();
      sync({ type: 'worker-poll' });
      sendResponse({ ok: enabled && !suspended });
      return true;
    }
    if (msg.type !== 'NOW_PLAYING_REFRESH') return;
    lastSignature = '';
    retryAt = 0;
    sync();
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[ENABLED_KEY]) setEnabled(changes[ENABLED_KEY].newValue);
    if (changes.dailyReplayCloudState && enabled) {
      const change = changes.dailyReplayCloudState;
      if (change.oldValue?.recoveryToken !== change.newValue?.recoveryToken) {
        retryAt = 0;
        lastSignature = '';
        sync();
      }
    }
  });
  document.addEventListener('visibilitychange', sync, { passive: true });
  // Freeze is a page scheduling state, not a playback stop or navigation.
  // Never DELETE solely because Chrome moved the tab out of the foreground.
  document.addEventListener('freeze', () => { lastSignature = ''; observed = null; }, { passive: true });
  document.addEventListener('resume', () => { suspended = false; sync(); }, { passive: true });
  window.addEventListener('pagehide', suspend, { passive: true });
  window.addEventListener('pageshow', () => { suspended = false; sync(); }, { passive: true });
  setInterval(() => sync(), 500);
})();
