const CLOUD_STORAGE_KEY = 'dailyReplayCloudState';

const DEFAULT_CLOUD_STATE = {
  serverBaseUrl: 'https://immersionproject.coreone.work',
  loginPath: '/auth/discord',
  recoveryToken: null,
  lastSyncAt: null,
  lastSyncInfo: null,
};

const SHARED_TRANSLATE_ENDPOINTS = [
  'https://immersionproject.coreone.work/api/translate',
  'https://immersionproject.coreone.work/api/translate/'
];

const COMMUNITY_REMAINING_ENDPOINTS = [
  'https://immersionproject.coreone.work/api/community/remaining',
  'https://immersionproject.coreone.work/api/community/remaining/',
  'https://immersionproject.coreone.work/api/community/remaining',
  'https://immersionproject.coreone.work/api/community/remaining/',
];

// ===================== Local Discord Presence Forwarder =====================
const LOCAL_DISCORD_PRESENCE_BASE = 'http://127.0.0.1:5678'; // 歌詞送信に必須

async function postLocalDiscordPresence(path, payload) {
  const url = LOCAL_DISCORD_PRESENCE_BASE.replace(/\/+$/, '') + path;
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload || {}),
    }),
    1500,
    'local presence timeout'
  );
  const txt = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`local presence failed: ${res.status} ${txt || res.statusText}`);
  }
  try { return JSON.parse(txt); } catch { return { ok: true }; }
}



function loadCloudState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(CLOUD_STORAGE_KEY, (items) => {
      const stored = items && items[CLOUD_STORAGE_KEY] ? items[CLOUD_STORAGE_KEY] : {};
      resolve(Object.assign({}, DEFAULT_CLOUD_STATE, stored));
    });
  });
}

async function saveCloudState(patchOrNew) {
  const current = await loadCloudState();
  const merged =
    typeof patchOrNew === 'function'
      ? patchOrNew(current)
      : Object.assign({}, current, patchOrNew || {});
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CLOUD_STORAGE_KEY]: merged }, () => resolve(merged));
  });
}

async function cloudSyncHistory(history) {
  const state = await loadCloudState();
  if (!state.recoveryToken) {
    return { ok: false, error: 'NO_TOKEN' };
  }

  const base = (state.serverBaseUrl || DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
  const url = base + '/api/history';

  const payload = {
    code: state.recoveryToken,
    history: Array.isArray(history) ? history : [],
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: 'NETWORK_ERROR: ' + e };
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
  }

  if (!res.ok) {
    return {
      ok: false,
      error: 'HTTP_' + res.status + (data && data.error ? ':' + data.error : ''),
    };
  }

  const mergedHistory = data && Array.isArray(data.history) ? data.history : null;

  const now = Date.now();
  const info = {
    sentCount: payload.history.length,
    serverCount: mergedHistory ? mergedHistory.length : null,
  };

  await saveCloudState({
    lastSyncAt: now,
    lastSyncInfo: info,
  });

  return {
    ok: true,
    mergedHistory,
    lastSyncAt: now,
    lastSyncInfo: info,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(CLOUD_STORAGE_KEY, (items) => {
    if (!items || !items[CLOUD_STORAGE_KEY]) {
      chrome.storage.local.set({ [CLOUD_STORAGE_KEY]: DEFAULT_CLOUD_STATE });
    }
  });
});

const normalizeArtist = (s) =>
  (s || '').toLowerCase().replace(/\s+/g, '').trim();

const pickBestLrcLibHit = (items, artist) => {
  if (!Array.isArray(items) || !items.length) return null;
  const target = normalizeArtist(artist);
  const getArtistName = (it) =>
    it.artistName || it.artist || it.artist_name || '';

  let hit = null;

  if (target) {
    hit = items.find(it => {
      const a = normalizeArtist(getArtistName(it));
      return a && a === target && (it.syncedLyrics || it.synced_lyrics);
    });
    if (hit) return hit;

    hit = items.find(it => {
      const a = normalizeArtist(getArtistName(it));
      return a && a === target && (it.plainLyrics || it.plain_lyrics);
    });
    if (hit) return hit;

    hit = items.find(it => {
      const a = normalizeArtist(getArtistName(it));
      return a && (a.includes(target) || target.includes(a)) && (it.syncedLyrics || it.synced_lyrics);
    });
    if (hit) return hit;

    hit = items.find(it => {
      const a = normalizeArtist(getArtistName(it));
      return a && (a.includes(target) || target.includes(a)) && (it.plainLyrics || it.plain_lyrics);
    });
    if (hit) return hit;
  }

  return null;
};

const fetchFromLrcLib = (track, artist) => {
  if (!track) return Promise.resolve({ lyrics: '', candidates: [] });
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}`;
  console.log('[BG] LrcLib search URL:', url);

  return fetch(url)
    .then(r => (r.ok ? r.json() : Promise.reject(r.statusText)))
    .then(list => {
      console.log('[BG] LrcLib search result count:', Array.isArray(list) ? list.length : 'N/A');
      const items = Array.isArray(list) ? list : [];
      
      const hit = pickBestLrcLibHit(items, artist);
      
      let bestLyrics = '';
      if (hit) {
        const synced = hit.syncedLyrics || hit.synced_lyrics || '';
        const plain = hit.plainLyrics || hit.plain_lyrics || hit.plain_lyrics_text || '';
        bestLyrics = (synced || plain || '').trim();
      }

      const candidates = items.map(item => {
        const synced = item.syncedLyrics || item.synced_lyrics || '';
        const plain = item.plainLyrics || item.plain_lyrics || item.plain_lyrics_text || '';
        const txt = (synced || plain || '').trim();
        if (!txt) return null;

        return {
          id: `lrclib_${item.id}`,
          artist: item.artistName || item.artist,
          title: item.trackName || item.trackName,
          source: 'LrcLib',
          has_synced: !!synced,
          lyrics: txt
        };
      }).filter(Boolean);

      return { lyrics: bestLyrics, candidates: candidates };
    })
    .catch(err => {
      console.error('[BG] LrcLib error:', err);
      return { lyrics: '', candidates: [] };
    });
};

const formatLrcTime = (seconds) => {
  const total = Math.max(0, seconds);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
};

const fetchCandidatesFromUrl = (url) => {
  if (!url) {
    return Promise.resolve({
      candidates: [],
      hasSelectCandidates: false,
      config: null,
      requests: [],
    });
  }

  try {
    const base = 'https://lrchub.coreone.work';
    const u = new URL(url, base);
    u.protocol = 'https:';
    if (!u.searchParams.has('include_lyrics')) {
      u.searchParams.set('include_lyrics', '1');
    }
    url = u.toString();
  } catch (e) {
    console.warn('[BG] invalid candidates url:', url, e);
  }

  return fetch(url)
    .then(async (r) => {
      let json;
      try {
        json = await r.json();
      } catch (e) {
        throw new Error(r.statusText || 'Invalid JSON');
      }

      const res = json.response || json;
      const list = Array.isArray(res.candidates) ? res.candidates : [];
      const config = res.config || null;
      const requests = Array.isArray(res.requests) ? res.requests : [];
      const hasSelectCandidates = list.length > 1;

      return {
        candidates: list,
        hasSelectCandidates,
        config,
        requests,
      };
    })
    .catch(err => {
      console.error('[BG] candidates error:', err);
      return { candidates: [], hasSelectCandidates: false, config: null, requests: [] };
    });
};

const buildCandidatesUrl = (res, payloadVideoId) => {
  const base = 'https://lrchub.coreone.work';
  const raw = res.candidates_api_url || '';

  try {
    if (raw) {
      const u = new URL(raw, base);
      u.protocol = 'https:';
      if (!u.searchParams.has('include_lyrics')) {
        u.searchParams.set('include_lyrics', '1');
      }
      return u.toString();
    }
  } catch (e) {
  }

  const vid = res.video_id || payloadVideoId;
  if (!vid) return null;
  const u = new URL('/api/lyrics_candidates', base);
  u.searchParams.set('video_id', vid);
  u.searchParams.set('include_lyrics', '1');
  return u.toString();
};

const fetchFromLrchub = (track, artist, youtube_url, video_id) => {
  return fetch('https://lrchub.coreone.work/api/lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, artist, youtube_url, video_id }),
  })
    .then(r => r.text())
    .then(text => {
      let lyrics = '';
      let dynamicLines = null;
      let hasSelectCandidates = false;
      let candidates = [];
      let config = null;
      let requests = [];

      try {
        const json = JSON.parse(text);
        const res = json.response || json;

        hasSelectCandidates = !!res.has_select_candidates;
        config = res.config || null;
        requests = Array.isArray(res.requests) ? res.requests : [];

        if (
          res.dynamic_lyrics &&
          Array.isArray(res.dynamic_lyrics.lines) &&
          res.dynamic_lyrics.lines.length
        ) {
          dynamicLines = res.dynamic_lyrics.lines;
          const lrcLines = dynamicLines
            .map(line => {
              let ms = null;
              if (typeof line.startTimeMs === 'number') {
                ms = line.startTimeMs;
              } else if (typeof line.startTimeMs === 'string') {
                const n = Number(line.startTimeMs);
                if (!Number.isNaN(n)) ms = n;
              }
              if (ms == null) return null;

              let textLine = '';
              if (typeof line.text === 'string' && line.text.length) {
                textLine = line.text;
              } else if (Array.isArray(line.chars)) {
                textLine = line.chars
                  .map(c => c.c || c.text || c.caption || '')
                  .join('');
              }

              textLine = (textLine || '').trim();
              const timeTag = `[${formatLrcTime(ms / 1000)}]`;
              return textLine ? `${timeTag} ${textLine}` : timeTag;
            })
            .filter(Boolean);

          lyrics = lrcLines.join('\n');
        } else {
          const synced = typeof res.synced_lyrics === 'string' ? res.synced_lyrics.trim() : '';
          const plain = typeof res.plain_lyrics === 'string' ? res.plain_lyrics.trim() : '';
          if (synced) lyrics = synced;
          else if (plain) lyrics = plain;
        }

        const url = buildCandidatesUrl(res, video_id);
        if (url) {
          return fetchCandidatesFromUrl(url).then(cRes => {
            candidates = cRes.candidates;
            hasSelectCandidates = !!(hasSelectCandidates || cRes.hasSelectCandidates);
            if (cRes.config) config = cRes.config;
            if (Array.isArray(cRes.requests) && cRes.requests.length) requests = cRes.requests;

            return {
              lyrics,
              dynamicLines,
              hasSelectCandidates,
              candidates,
              config,
              requests,
            };
          });
        }
      } catch (e) {
      }

      return { lyrics, dynamicLines, hasSelectCandidates, candidates, config, requests };
    });
};


// --- GitHub raw のブラウザキャッシュ対策: 毎回URLを変えて最新を取りに行く ---
const withRandomCacheBuster = (url, buster) => {
  const v = String(buster || (1000 + Math.floor(Math.random() * 9000)));
  try {
    const u = new URL(url);
    u.searchParams.set('v', v);
    return u.toString();
  } catch (e) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + v;
  }
};

const fetchFromGithub = (video_id) => {
  if (!video_id) return Promise.resolve({ lyrics: '', dynamicLines: null, subLyrics: '' });

  const base = `https://raw.githubusercontent.com/LRCHub/${video_id}/main`;
  const __cacheBuster = (1000 + Math.floor(Math.random() * 9000));
  const bust = (url) => withRandomCacheBuster(url, __cacheBuster);

  const safeFetchText = async (url) => {
    try {
      const r = await fetch(bust(url), { cache: 'no-store' });
      if (!r.ok) return '';
      return (await r.text()) || '';
    } catch (e) {
      return '';
    }
  };

  // duet: optional sub vocal LRC (only lines that should be shown on the right)
  const pSub = safeFetchText(`${base}/sub.txt`);

  const parseLrcTimeToMs = (ts) => {
    const s = String(ts || '').trim();
    // mm:ss.xx or mm:ss.xxx
    const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!m) return null;
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    let frac = m[3] || '0';
    if (frac.length === 1) frac = frac + '00';
    else if (frac.length === 2) frac = frac + '0';
    const ms = parseInt(frac.slice(0, 3), 10);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ms)) return null;
    return (mm * 60 + ss) * 1000 + ms;
  };

  // Dynamic.lrc format:
  // [00:00.56]<00:00.56>無<00:00.68>敵...
  const parseDynamicLrc = (text) => {
    const out = [];
    if (!text) return out;

    const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) continue;

      const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) continue;

      const lineMs = parseLrcTimeToMs(m[1]);
      const rest = m[2] || '';

      const chars = [];
      const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;

      let prevMs = null;
      let prevEnd = 0;

      while (true) {
        const mm = tagRe.exec(rest);
        if (!mm) break;

        const tagMs = parseLrcTimeToMs(mm[1]);
        if (prevMs != null) {
          const chunk = rest.slice(prevEnd, mm.index);
          if (chunk) {
            for (const ch of Array.from(chunk)) {
              chars.push({ t: prevMs, c: ch });
            }
          }
        }
        prevMs = tagMs;
        prevEnd = mm.index + mm[0].length;
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd);
        if (chunk) {
          for (const ch of Array.from(chunk)) {
            chars.push({ t: prevMs, c: ch });
          }
        }
      }

      const textLine = chars.map(c => c.c).join('');

      out.push({
        startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
        text: textLine,
        chars,
      });
    }

    return out;
  };

  const buildLrcFromDynamic = (lines) => {
    if (!Array.isArray(lines) || !lines.length) return '';
    const lrcLines = lines
      .map(line => {
        let ms = null;

        if (typeof line.startTimeMs === 'number') {
          ms = line.startTimeMs;
        } else if (typeof line.startTimeMs === 'string') {
          const n = Number(line.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(line.chars) && line.chars.length) {
          const ts = line.chars
            .map(c => (typeof c.t === 'number' ? c.t : null))
            .filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (ms == null) return null;

        let textLine = '';
        if (typeof line.text === 'string' && line.text.length) {
          textLine = line.text;
        } else if (Array.isArray(line.chars)) {
          textLine = line.chars.map(c => c.c || c.text || c.caption || '').join('');
        }

        textLine = (textLine || '').trim();
        const timeTag = `[${formatLrcTime(ms / 1000)}]`;
        return textLine ? `${timeTag} ${textLine}` : timeTag;
      })
      .filter(Boolean);

    return lrcLines.join('\n').trim();
  };

  const extractLyricsFromReadme = (text) => {
    if (!text) return '';
    const m = String(text).match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
    const body = m ? m[1] : String(text);

    return body
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .filter(line => !line.trim().startsWith('>'))
      .filter(line => !line.trim().startsWith('```'))
      .filter(line => !line.includes('歌詞登録ステータス'))
      .join('\n')
      .trim();
  };

  return (async () => {
    const subLyrics = (await pSub) || '';

    // 1) Dynamic.lrc (char-timed) を最優先
    const dynText = await safeFetchText(`${base}/Dynamic.lrc`);
    const dynLines = parseDynamicLrc(dynText);

    if (dynLines && dynLines.length) {
      const lyrics = buildLrcFromDynamic(dynLines);
      if (lyrics && lyrics.trim()) return { lyrics, dynamicLines: dynLines, subLyrics };
    }

    // 2) README.md (タイムスタンプ/プレーン)
    const readme = await safeFetchText(`${base}/README.md`);
    const lyrics = extractLyricsFromReadme(readme);

    return { lyrics: lyrics || '', dynamicLines: null, subLyrics };
  })();
};;

const extractVideoIdFromUrl = (youtube_url) => {
  if (!youtube_url) return null;
  try {
    const u = new URL(youtube_url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return id || null;
    }
    const v = u.searchParams.get('v');
    return v || null;
  } catch (e) {
    return null;
  }
};

const withTimeout = (promise, ms, label) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label || 'timeout')), ms);
    }),
  ]);
};
async function fetchCommunityRemaining() {
  let lastErr = null;
  for (const url of COMMUNITY_REMAINING_ENDPOINTS) {
    try {
      const res = await withTimeout(fetch(url, { method: 'GET', cache: 'no-store' }), 20000, 'community remaining timeout');
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`community remaining failed: ${res.status} ${msg}`);
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new Error('community remaining: invalid json');
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('community remaining failed');
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !req.type) {
    return;
  }

  
  // Local Discord presence (localhost python server)
  if (req.type === 'DISCORD_PRESENCE_UPDATE') {
    postLocalDiscordPresence('/presence', req.payload || {})
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (req.type === 'DISCORD_PRESENCE_CLEAR') {
    postLocalDiscordPresence('/clear', {})
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

if (req.type === 'GET_CLOUD_STATE') {
    loadCloudState()
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SAVE_RECOVERY_TOKEN') {
    const token = typeof req.token === 'string' ? req.token.trim() : '';
    saveCloudState({ recoveryToken: token || null })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SET_SERVER_BASE_URL') {
    const url = typeof req.serverBaseUrl === 'string' ? req.serverBaseUrl.trim() : '';
    saveCloudState({ serverBaseUrl: url || DEFAULT_CLOUD_STATE.serverBaseUrl })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'OPEN_LOGIN_PAGE') {
    (async () => {
      try {
        const state = await loadCloudState();
        const base = (state.serverBaseUrl || DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
        const loginPath = state.loginPath || DEFAULT_CLOUD_STATE.loginPath || '/auth/discord';
        const url = base + loginPath;
        chrome.tabs.create({ url }, () => {
          if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          else sendResponse({ ok: true, url });
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (req.type === 'GET_COMMUNITY_REMAINING') {
    (async () => {
      try {
        const data = await fetchCommunityRemaining();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }


  if (req.type === 'SYNC_HISTORY') {
    const history = Array.isArray(req.history) ? req.history : (req.payload && Array.isArray(req.payload.history) ? req.payload.history : []);
    (async () => {
      try {
        const result = await cloudSyncHistory(history);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

    if (req.type === 'TRANSLATE') {
    const { text, apiKey, targetLang, useSharedTranslateApi } = req.payload || {};
    const target = targetLang || 'JA';
    const texts = Array.isArray(text) ? text : [text];

    const translateViaDeepL = async () => {
      if (!apiKey) throw new Error('DeepL API key is missing');
      const endpoint = apiKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      const body = { text: texts, target_lang: target };

      const res = await withTimeout(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        20000,
        'deepl translate timeout'
      );

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`DeepL translate failed: ${res.status} ${msg}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.translations)) {
        throw new Error('DeepL translate: invalid response');
      }
      return {
        translations: data.translations,
        engine: 'deepl',
        plan: apiKey.endsWith(':fx') ? 'free' : 'pro',
      };
    };

    const fetchSharedJson = async (payload) => {
      const tryFetch = async (url, init, label) => {
        const res = await withTimeout(fetch(url, init), 20000, label || 'shared translate timeout');
        const rawText = await res.text().catch(() => '');
        let data = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch (e) {
          // JSON 以外でも data は null のまま
        }
        if (!res.ok) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (rawText || res.statusText);
          throw new Error(`shared translate http ${res.status}: ${msg}`);
        }
        if (!data || (data.ok !== undefined && !data.ok)) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : 'invalid response';
          throw new Error(`shared translate: ${msg}`);
        }
        return data;
      };

      const jsonInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      let lastErr = null;

      // 1) JSON で両方の URL を試す（/ の有無でリダイレクトが起きる環境対策）
      for (const url of SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, jsonInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      // 2) それでも駄目な場合、プリフライト回避用にフォーム送信も試す（サーバーが受ければ動く）
      //    ※ Content-Type を application/json にしない（simple request）
      const formBody = new URLSearchParams();
      if (Array.isArray(payload.text)) {
        // バッチはフォーム送信だと仕様が不明なので個別に任せる
        throw lastErr || new Error('shared translate failed');
      }
      formBody.set('text', String(payload.text ?? ''));
      formBody.set('target_lang', String(payload.target_lang ?? ''));
      const formInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: formBody.toString(),
      };

      for (const url of SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, formInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error('shared translate failed');
    };;

    const translateViaShared = async () => {
      const toTranslations = (arr) => arr.map(v => ({ text: (v ?? '').toString() }));

      // まずバッチを試す（サーバーが配列対応していれば最速）
      try {
        const data = await fetchSharedJson({ text: texts, target_lang: target });
        if (Array.isArray(data.text) && data.text.length === texts.length) {
          return {
            translations: toTranslations(data.text),
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        if (Array.isArray(data.translations) && data.translations.length === texts.length) {
          const mapped = data.translations.map(x => ({ text: (x && x.text !== undefined ? x.text : x) ?? '' }));
          return {
            translations: mapped,
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        if (typeof data.text === 'string' && texts.length === 1) {
          return {
            translations: [{ text: data.text }],
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }
        // 想定外の形なら個別へフォールバック
      } catch (e) {
        // バッチ失敗 → 個別へ
      }

      // 個別リクエスト（サーバーが "text: string" 前提でも動く）
      const pMap = async (arr, mapper, concurrency = 5) => {
        const results = new Array(arr.length);
        let i = 0;
        const workers = Array.from({ length: Math.min(concurrency, arr.length) }, async () => {
          while (true) {
            const idx = i++;
            if (idx >= arr.length) break;
            results[idx] = await mapper(arr[idx], idx);
          }
        });
        await Promise.all(workers);
        return results;
      };

      const perItem = await pMap(
        texts,
        async (t) => fetchSharedJson({ text: t ?? '', target_lang: target }),
        5
      );

      const translated = perItem.map(d => (d && d.text !== undefined ? d.text : ''));

      const meta = perItem.find(Boolean) || {};
      return {
        translations: toTranslations(translated),
        detected_source_language: meta.detected_source_language || null,
        engine: meta.engine || 'shared',
        plan: meta.plan || null,
      };
    };

    (async () => {
      try {
        if (useSharedTranslateApi) {
          const shared = await translateViaShared();
          sendResponse({
            success: true,
            translations: shared.translations,
            detected_source_language: shared.detected_source_language,
            engine: shared.engine,
            plan: shared.plan,
          });
          return;
        }

        const deepl = await translateViaDeepL();
        sendResponse({
          success: true,
          translations: deepl.translations,
          engine: deepl.engine,
          plan: deepl.plan,
        });
      } catch (e) {
        // 共有翻訳が落ちてても DeepL キーがあれば自動フォールバック
        if (useSharedTranslateApi && apiKey) {
          try {
            const deepl = await translateViaDeepL();
            sendResponse({
              success: true,
              translations: deepl.translations,
              engine: deepl.engine,
              plan: deepl.plan,
              fallback_from: 'shared',
              fallback_error: String(e),
            });
            return;
          } catch (e2) {
            sendResponse({ success: false, error: `${String(e2)} (shared failed: ${String(e)})` });
            return;
          }
        }
        sendResponse({ success: false, error: String(e) });
      }
    })();

    return true;
  }


  // 歌詞取得
  if (req.type === 'GET_LYRICS') {
    const { track, artist, youtube_url, video_id } = req.payload || {};
    const tabId = sender && sender.tab ? sender.tab.id : null;

    console.log('[BG] GET_LYRICS (Hub + GitHub)', { track, artist });

    (async () => {
      const timeoutMs = 15000;

      // 1) LRCHub
      const pHub = withTimeout(
        fetchFromLrchub(track, artist, youtube_url, video_id),
        timeoutMs, 'lrchub'
      ).then(res => ({ source: 'hub', data: res })).catch(e => ({ source: 'hub', error: e }));

      // 2) GitHub
      const vidForGit = video_id || extractVideoIdFromUrl(youtube_url);
      let pGit = Promise.resolve({ source: 'git', data: '' });
      if (vidForGit) {
        pGit = fetchFromGithub(vidForGit)
          .then(res => ({ source: 'git', data: res }))
          .catch(e => ({ source: 'git', error: e }));
      }

      // 返答を一度だけ返す（遅い方を待たない）
      let responded = false;
      const sendOnce = (payload) => {
        if (responded) return;
        responded = true;
        sendResponse(payload);
      };

      // LRCHub の candidates/config/requests は、GitHub が先に返っても後追いで UI 更新できるように push する
      const pushMetaUpdate = (meta) => {
        if (!tabId) return;
        try {
          chrome.tabs.sendMessage(tabId, { type: 'LYRICS_META_UPDATE', payload: meta });
        } catch (e) {
          // ignore
        }
      };

      // 並列実行（"両方待ち" をやめる）
      let hubRes = null;
      let gitRes = null;

      const handleHub = async () => {
        const r = await pHub;
        hubRes = r;

        let sharedCandidates = [];
        let sharedConfig = null;
        let sharedRequests = [];

        if (hubRes && !hubRes.error && hubRes.data) {
          if (Array.isArray(hubRes.data.candidates)) sharedCandidates = hubRes.data.candidates.slice();
          if (hubRes.data.config) sharedConfig = hubRes.data.config;
          if (Array.isArray(hubRes.data.requests)) sharedRequests = hubRes.data.requests.slice();
        }

        const hasCandidates = sharedCandidates.length > 0;

        // まだ返してない & LRCHub に歌詞がある → 即返す
        if (!responded && hubRes && !hubRes.error && hubRes.data && hubRes.data.lyrics && hubRes.data.lyrics.trim()) {
          const d = hubRes.data;
          console.log('[BG] Won (fast): LRCHub');
          sendOnce({
            success: true,
            lyrics: d.lyrics,
            dynamicLines: d.dynamicLines || null,
            subLyrics: (typeof d.subLyrics === 'string' ? d.subLyrics : ''),
            hasSelectCandidates: d.hasSelectCandidates || hasCandidates,
            candidates: sharedCandidates,
            config: d.config || null,
            requests: d.requests || [],
            githubFallback: false,
          });
          return;
        }

        // 既に GitHub で歌詞を返していたら、候補/設定だけ後追いで通知
        if (responded && (hasCandidates || sharedConfig || (sharedRequests && sharedRequests.length))) {
          const vid = video_id || extractVideoIdFromUrl(youtube_url);
          pushMetaUpdate({
            video_id: vid,
            hasSelectCandidates: hasCandidates,
            candidates: sharedCandidates,
            config: sharedConfig,
            requests: sharedRequests,
          });
        }
      };

      const handleGit = async () => {
        const r = await pGit;
        gitRes = r;

        // duet: sub.txt may arrive via GitHub even when LRCHub won first
        try {
          if (gitRes && !gitRes.error && gitRes.data && typeof gitRes.data.subLyrics === 'string' && gitRes.data.subLyrics.trim()) {
            pushMetaUpdate({ video_id: vidForGit, subLyrics: gitRes.data.subLyrics });
          }
        } catch (e) {
          // ignore
        }

        // dynamic: char-timed lines can arrive later via GitHub even when LRCHub won first
        try {
          if (gitRes && !gitRes.error && gitRes.data && Array.isArray(gitRes.data.dynamicLines) && gitRes.data.dynamicLines.length) {
            pushMetaUpdate({ video_id: vidForGit, dynamicLines: gitRes.data.dynamicLines });
          }
        } catch (e) {
          // ignore
        }

        if (
          !responded &&
          gitRes &&
          !gitRes.error &&
          gitRes.data &&
          typeof gitRes.data.lyrics === 'string' &&
          gitRes.data.lyrics.trim()
        ) {
          const d = gitRes.data;
          console.log('[BG] Won (fast): GitHub');
          // ※ candidates/config/requests は後から LRCHub が来たら pushMetaUpdate で更新
          sendOnce({
            success: true,
            lyrics: d.lyrics,
            dynamicLines: d.dynamicLines || null,
            subLyrics: (typeof d.subLyrics === 'string' ? d.subLyrics : ''),
            hasSelectCandidates: false,
            candidates: [],
            config: null,
            requests: [],
            githubFallback: true,
          });
        }
      };

      const hubTask = handleHub();
      const gitTask = handleGit();

      await Promise.allSettled([hubTask, gitTask]);

      // どちらかで返していたら終了
      if (responded) return;

      // ここに来るのは「どっちも歌詞が取れなかった」だけ。候補だけでも返す（あれば）
      let sharedCandidates = [];
      let sharedConfig = null;
      let sharedRequests = [];

      if (hubRes && !hubRes.error && hubRes.data) {
        if (Array.isArray(hubRes.data.candidates)) sharedCandidates = hubRes.data.candidates.slice();
        if (hubRes.data.config) sharedConfig = hubRes.data.config;
        if (Array.isArray(hubRes.data.requests)) sharedRequests = hubRes.data.requests.slice();
      }

      const hasCandidates = sharedCandidates.length > 0;

      console.log('[BG] No lyrics found (Hub+GitHub)');
      sendOnce({
        success: false,
        lyrics: '',
        dynamicLines: null,
        hasSelectCandidates: hasCandidates,
        candidates: sharedCandidates,
        config: sharedConfig,
        requests: sharedRequests,
      });

    })();

    return true;
  }

  if (req.type === 'SELECT_LYRICS_CANDIDATE') {
    const { youtube_url, video_id, candidate_id, request, action, lock } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (candidate_id) body.candidate_id = candidate_id;
    const reqKey = request || action;
    if (reqKey) body.request = reqKey;
    if (typeof lock !== 'undefined') body.lock = String(lock);

    if ((!body.youtube_url && !body.video_id) || (!body.candidate_id && !body.request)) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/lyrics_select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, raw: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }

  if (req.type === 'GET_TRANSLATION') {
    const payload = req.payload || {};
    const { youtube_url, video_id, lang, langs } = payload;

    (async () => {
      const reqLangs = Array.isArray(langs) && langs.length ? langs : (lang ? [lang] : []);
      if (!reqLangs.length) {
        sendResponse({ success: true, lrcMap: {}, missing: [] });
        return;
      }

      const vid = video_id || extractVideoIdFromUrl(youtube_url);
      const lrcMap = {};
      const missingSet = new Set();

      // 1) GitHub translation/<lang>.txt を最優先で試す
      if (vid) {
        await Promise.all(reqLangs.map(async (l) => {
          const url = `https://raw.githubusercontent.com/LRCHub/${vid}/main/translation/${l}.txt`;
          try {
            const r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) return;
            const text = (await r.text()) || '';
            if (text.trim()) {
              lrcMap[l] = text;
            }
          } catch (e) {
          }
        }));
      }

      const remaining = reqLangs.filter(l => !(l in lrcMap));

      // 2) まだ無いものだけ LRCHub API にフォールバック
      if (remaining.length) {
        try {
          const url = new URL('https://lrchub.coreone.work/api/translation');
          if (youtube_url) url.searchParams.set('youtube_url', youtube_url);
          else if (video_id) url.searchParams.set('video_id', video_id);
          else if (vid) url.searchParams.set('video_id', vid);

          remaining.forEach(l => url.searchParams.append('lang', l));

          const text = await fetch(url.toString(), { method: 'GET' }).then(r => r.text());
          try {
            const json = JSON.parse(text);
            if (json && json.lrc_map) {
              Object.keys(json.lrc_map).forEach(k => {
                if (!lrcMap[k] && json.lrc_map[k]) lrcMap[k] = json.lrc_map[k];
              });
            }
            const missing = json.missing_langs || [];
            missing.forEach(m => missingSet.add(m));
          } catch (e) {
            // JSON parse failed -> treat as missing
            remaining.forEach(m => missingSet.add(m));
          }
        } catch (e) {
          remaining.forEach(m => missingSet.add(m));
        }
      }

      // GitHub + API どちらにも無かった lang を missing に入れる
      reqLangs.forEach(l => {
        if (!lrcMap[l]) missingSet.add(l);
      });

      sendResponse({ success: true, lrcMap, missing: Array.from(missingSet) });
    })().catch(err => sendResponse({ success: false, error: String(err) }));

    return true;
  }


  if (req.type === 'REGISTER_TRANSLATION') {
    const { youtube_url, video_id, lang, lyrics } = req.payload;
    const body = { lang, lyrics };
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;

    fetch('https://lrchub.coreone.work/api/translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, raw: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }

  if (req.type === 'SHARE_REGISTER') {
    const { youtube_url, video_id, phrase, text, lang, time_ms, time_sec } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (phrase || text) body.phrase = phrase || text;
    if (lang) body.lang = lang;
    if (typeof time_ms === 'number') body.time_ms = time_ms;
    else if (typeof time_sec === 'number') body.time_sec = time_sec;

    if ((!body.youtube_url && !body.video_id) || !body.phrase) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/share/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, data: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }
});
self.addEventListener('fetch', (event) => {
  if (event.preloadResponse) {
    event.waitUntil(event.preloadResponse);
  }
});
