export const SHARED_TRANSLATE_ENDPOINTS = [
  'https://immersionproject.coreone.work/api/translate',
  'https://immersionproject.coreone.work/api/translate/'
];

export const COMMUNITY_REMAINING_ENDPOINTS = [
  'https://immersionproject.coreone.work/api/community/remaining',
  'https://immersionproject.coreone.work/api/community/remaining/',
  'https://immersionproject.coreone.work/api/community/remaining',
  'https://immersionproject.coreone.work/api/community/remaining/',
];

export const normalizeArtist = (s) =>
  (s || '').toLowerCase().replace(/\s+/g, '').trim();

export const pickBestLrcLibHit = (items, artist) => {
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

export const fetchFromLrcLib = (track, artist) => {
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

export const formatLrcTime = (seconds) => {
  const total = Math.max(0, seconds);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
};

export const fetchCandidatesFromUrl = (url) => {
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

export const buildCandidatesUrl = (res, payloadVideoId) => {
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

export const fetchFromLrchub = (track, artist, youtube_url, video_id) => {
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

              // Keep original spaces (do not auto-trim)
              textLine = String(textLine ?? '');
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
export const withRandomCacheBuster = (url, buster) => {
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

export const normalizeCandidateFilePath = (value) => {
  const s = String(value || '').trim().replace(/^\/+/, '');
  if (!s) return '';

  const rawPrefix = /^https?:\/\/raw\.githubusercontent\.com\/LRCHub\/[^/]+\/main\/(.*)$/i;
  const treePrefix = /^https?:\/\/github\.com\/LRCHub\/[^/]+\/(?:blob|tree)\/main\/(.*)$/i;

  let m = s.match(rawPrefix);
  if (m && m[1]) return String(m[1]).replace(/^\/+/, '');
  m = s.match(treePrefix);
  if (m && m[1]) return String(m[1]).replace(/^\/+/, '');

  return s;
};

export const buildGitHubSelectRawUrl = (video_id, relPath) => {
  const cleaned = normalizeCandidateFilePath(relPath);
  if (!video_id || !cleaned) return '';
  const encoded = cleaned
    .split('/')
    .filter(Boolean)
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return `https://raw.githubusercontent.com/LRCHub/${video_id}/main/${encoded.startsWith('select/') ? encoded : 'select/' + encoded}`;
};

export const normalizeGitHubSelectCandidateEntry = (entry, idx, video_id) => {
  let obj = null;
  if (typeof entry === 'string') {
    obj = { path: entry };
  } else if (entry && typeof entry === 'object') {
    obj = { ...entry };
  } else {
    return null;
  }

  const path = normalizeCandidateFilePath(
    obj.path ||
    obj.file ||
    obj.filename ||
    obj.name ||
    obj.select ||
    obj.id ||
    ''
  );

  if (!path) return null;

  const basename = path.split('/').pop() || path;
  const candidateId = String(obj.candidate_id || obj.id || basename);
  const rawUrl = obj.raw_url || obj.rawUrl || buildGitHubSelectRawUrl(video_id, path);
  const lyrics = typeof obj.lyrics === 'string' ? obj.lyrics.trim() : '';

  return {
    ...obj,
    id: candidateId,
    candidate_id: candidateId,
    path,
    select: obj.select || path,
    title: obj.title || obj.name || basename,
    source: obj.source || 'GitHub',
    raw_url: rawUrl,
    lyrics,
  };
};

export const parseGitHubSelectIndexPayload = (json, video_id) => {
  const wrap = json && typeof json === 'object' && json.response ? json.response : json;

  let list = [];
  if (Array.isArray(wrap)) {
    list = wrap;
  } else if (wrap && typeof wrap === 'object') {
    if (Array.isArray(wrap.candidates)) list = wrap.candidates;
    else if (Array.isArray(wrap.files)) list = wrap.files;
    else if (Array.isArray(wrap.items)) list = wrap.items;
    else if (Array.isArray(wrap.list)) list = wrap.list;
    else if (wrap.entries && typeof wrap.entries === 'object') {
      list = Object.entries(wrap.entries).map(([k, v]) => (v && typeof v === 'object') ? ({ path: k, ...v }) : ({ path: k }));
    } else {
      list = Object.entries(wrap)
        .filter(([k]) => /\.(?:lrc|txt)$/i.test(String(k || '')))
        .map(([k, v]) => (v && typeof v === 'object') ? ({ path: k, ...v }) : ({ path: k }));
    }
  }

  return list
    .map((entry, idx) => normalizeGitHubSelectCandidateEntry(entry, idx, video_id))
    .filter(Boolean);
};

export const fetchGithubSelectCandidates = async (video_id, bust) => {
  if (!video_id) return [];
  const idxUrl = `https://raw.githubusercontent.com/LRCHub/${video_id}/main/select/index.json`;
  try {
    const res = await fetch(typeof bust === 'function' ? bust(idxUrl) : withRandomCacheBuster(idxUrl), { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return parseGitHubSelectIndexPayload(json, video_id);
  } catch (e) {
    console.warn('[BG] GitHub select index error:', e);
    return [];
  }
};

export const fetchGithubSelectIndex = async (video_id) => fetchGithubSelectCandidates(video_id);

export const candidateKeySet = (candidate_id, cand) => {
  const values = [
    candidate_id,
    cand && cand.id,
    cand && cand.candidate_id,
    cand && cand.path,
    cand && cand.name,
    cand && cand.filename,
    cand && cand.file,
    cand && cand.title,
    cand && cand.label,
    cand && cand.select,
    cand && cand.list,
  ].filter(Boolean);

  const set = new Set();
  values.forEach((value) => {
    const s = String(value).trim();
    if (!s) return;
    set.add(s);
    set.add(s.toLowerCase());

    const norm = normalizeCandidateFilePath(s);
    if (norm) {
      set.add(norm);
      set.add(norm.toLowerCase());
    }

    const base = s.split('/').pop();
    if (base) {
      set.add(base);
      set.add(base.toLowerCase());
      const noExt = base.replace(/\.[^.]+$/, '');
      if (noExt) {
        set.add(noExt);
        set.add(noExt.toLowerCase());
      }
    }
  });
  return set;
};

export const findCandidateEntry = (entries, candidate_id, cand) => {
  const keys = candidateKeySet(candidate_id, cand);
  if (!Array.isArray(entries) || !entries.length || !keys.size) return null;
  const probeFields = ['candidate_id', 'id', 'path', 'name', 'filename', 'file', 'title', 'label', 'select', 'list'];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    for (const field of probeFields) {
      const value = entry[field];
      if (!value) continue;
      const entryKeys = candidateKeySet(value, { [field]: value });
      for (const k of entryKeys) {
        if (keys.has(k)) return entry;
      }
    }
  }
  return null;
};

export const buildCandidateUrls = (video_id, candidate_id, cand, entry) => {
  const urls = [];
  const addUrl = (raw) => {
    if (!raw) return;
    try {
      const u = new URL(String(raw), `https://raw.githubusercontent.com/LRCHub/${video_id}/main/`);
      u.searchParams.set('v', String(1000 + Math.floor(Math.random() * 9000)));
      urls.push(u.toString());
    } catch (e) {
    }
  };

  const addPath = (raw) => {
    const p = normalizeCandidateFilePath(raw);
    if (!p) return;
    if (/^https?:\/\//i.test(p)) {
      addUrl(p);
      return;
    }
    addUrl(`https://raw.githubusercontent.com/LRCHub/${video_id}/main/${p}`);
    if (!p.startsWith('select/')) {
      addUrl(`https://raw.githubusercontent.com/LRCHub/${video_id}/main/select/${p}`);
    }
  };

  [entry, cand].filter(Boolean).forEach((src) => {
    ['raw_url', 'rawUrl', 'download_url', 'downloadUrl', 'url'].forEach((k) => addUrl(src[k]));
    ['path', 'name', 'filename', 'file', 'select', 'list'].forEach((k) => addPath(src[k]));
  });

  const cid = String(candidate_id || '').trim();
  if (cid) {
    addPath(cid);
    addPath(`${cid}.lrc`);
    addPath(`${cid}.txt`);
  }

  return [...new Set(urls)];
};

export const fetchCandidateLyrics = async (video_id, candidate_id, candidate) => {
  const cand = candidate && typeof candidate === 'object' ? candidate : {};
  if (typeof cand.lyrics === 'string' && cand.lyrics.trim()) return cand.lyrics.trim();
  if (!video_id) return '';

  const entries = await fetchGithubSelectIndex(video_id);
  const entry = findCandidateEntry(entries, candidate_id, cand);
  const urls = buildCandidateUrls(video_id, candidate_id, cand, entry);

  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const text = (await r.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (!text) continue;
      if (/^<!doctype html/i.test(text) || /^<html/i.test(text)) continue;
      return text;
    } catch (e) {
    }
  }
  return '';
};

export const fetchFromGithub = (video_id) => {
  if (!video_id) return Promise.resolve({ lyrics: '', dynamicLines: null, subLyrics: '', candidates: [] });

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

  const pSub = safeFetchText(`${base}/sub.txt`);
  const pSelectCandidates = fetchGithubSelectCandidates(video_id, bust);

  const parseLrcTimeToMs = (ts) => {
    const s = String(ts || '').trim();
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

  const parseDynamicLrc = (text) => {
    const out = [];
    if (!text) return out;
    const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const parsed = [];
    for (const raw of rows) {
      const line = raw.trimEnd();
      if (!line) continue;
      const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) continue;
      parsed.push({ lineMs: parseLrcTimeToMs(m[1]), rest: m[2] || '' });
    }

    const pushDistributed = (chars, chunk, startMs, endMs) => {
      if (!chunk) return;
      const arr = Array.from(chunk);
      const n = arr.length;
      if (!n) return;
      const s = (typeof startMs === 'number') ? startMs : null;
      const e = (typeof endMs === 'number') ? endMs : null;
      if (s == null) {
        for (const ch of arr) chars.push({ t: 0, c: ch });
        return;
      }
      if (e == null || e <= s) {
        for (const ch of arr) chars.push({ t: s, c: ch });
        return;
      }
      const dur = Math.max(1, e - s);
      const step = dur / n;
      for (let i = 0; i < n; i++) chars.push({ t: s + Math.floor(step * i), c: arr[i] });
    };

    for (let li = 0; li < parsed.length; li++) {
      const { lineMs, rest } = parsed[li];
      const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number') ? parsed[li + 1].lineMs : null;
      const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
      const chars = [];
      let prevMs = null;
      let prevEnd = 0;

      while (true) {
        const mm = tagRe.exec(rest);
        if (!mm) break;
        const tagMs = parseLrcTimeToMs(mm[1]);
        if (prevMs == null && tagMs != null && mm.index > prevEnd) {
          pushDistributed(chars, rest.slice(prevEnd, mm.index), tagMs, tagMs);
        }
        if (prevMs != null) {
          pushDistributed(chars, rest.slice(prevEnd, mm.index), prevMs, tagMs);
        }
        prevMs = tagMs;
        prevEnd = mm.index + mm[0].length;
      }

      if (prevMs != null) {
        let endMs = nextLineMs;
        if (typeof endMs !== 'number') endMs = prevMs + 1500;
        if (endMs <= prevMs) endMs = prevMs + 200;
        pushDistributed(chars, rest.slice(prevEnd), prevMs, endMs);
      }

      out.push({
        startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
        text: chars.map(c => c.c).join(''),
        chars,
      });
    }

    return out;
  };

  const buildLrcFromDynamic = (lines) => {
    if (!Array.isArray(lines) || !lines.length) return '';
    return lines.map((line) => {
      let ms = null;
      if (typeof line.startTimeMs === 'number') ms = line.startTimeMs;
      else if (typeof line.startTimeMs === 'string') {
        const n = Number(line.startTimeMs);
        if (!Number.isNaN(n)) ms = n;
      } else if (Array.isArray(line.chars) && line.chars.length) {
        const ts = line.chars.map(c => (typeof c.t === 'number' ? c.t : null)).filter(v => v != null);
        if (ts.length) ms = Math.min(...ts);
      }
      if (ms == null) return null;

      let textLine = '';
      if (typeof line.text === 'string' && line.text.length) textLine = line.text;
      else if (Array.isArray(line.chars)) textLine = line.chars.map(c => c.c || c.text || c.caption || '').join('');
      textLine = String(textLine ?? '');
      const timeTag = `[${formatLrcTime(ms / 1000)}]`;
      return textLine ? `${timeTag} ${textLine}` : timeTag;
    }).filter(Boolean).join('\n').trimEnd();
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
    const [subLyrics, selectCandidates] = await Promise.all([pSub, pSelectCandidates]);

    const dynText = await safeFetchText(`${base}/Dynamic.lrc`);
    const dynLines = parseDynamicLrc(dynText);
    if (dynLines && dynLines.length) {
      const lyrics = buildLrcFromDynamic(dynLines);
      if (lyrics && lyrics.trim()) return { lyrics, dynamicLines: dynLines, subLyrics: subLyrics || '', candidates: selectCandidates || [] };
    }

    const readme = await safeFetchText(`${base}/README.md`);
    const lyrics = extractLyricsFromReadme(readme);

    return { lyrics: lyrics || '', dynamicLines: null, subLyrics: subLyrics || '', candidates: selectCandidates || [] };
  })();
};;

export const extractVideoIdFromUrl = (youtube_url) => {
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

export const withTimeout = (promise, ms, label) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label || 'timeout')), ms);
    }),
  ]);
};
export async function fetchCommunityRemaining() {
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
