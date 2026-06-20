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

export const getCacheBuster = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export const toLrchubTranslateLang = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (!key || key === 'original') return '';
  if (key === 'ja' || key === 'jp') return 'JA';
  if (key === 'en' || key === 'en-us' || key === 'en-gb') return 'EN';
  if (key === 'ko' || key === 'kr') return 'KO';
  if (key === 'zh' || key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'CN';
  return key.toUpperCase();
};

export const toUiLangKey = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (key === 'jp') return 'ja';
  if (key === 'kr') return 'ko';
  if (key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'zh';
  return key;
};

export const extractTranslationLyrics = (value) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  const fields = [
    value.lyrics,
    value.synced_lyrics,
    value.syncedLyrics,
    value.lrc,
    value.plain_lyrics,
    value.plainLyrics,
    value.text
  ];

  for (const field of fields) {
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return '';
};

export const normalizeLrchubTranslations = (translations) => {
  const lrcMap = {};
  if (!translations) return lrcMap;

  if (translations.lrc_map && typeof translations.lrc_map === 'object') {
    Object.entries(translations.lrc_map).forEach(([lang, lyrics]) => {
      const key = toUiLangKey(lang);
      const text = extractTranslationLyrics(lyrics);
      if (key && text) lrcMap[key] = text;
    });
  }

  if (Array.isArray(translations)) {
    translations.forEach((item) => {
      if (!item) return;
      const lang = item.language || item.lang || item.target_lang || item.targetLang;
      const key = toUiLangKey(lang);
      const text = extractTranslationLyrics(item);
      if (key && text) lrcMap[key] = text;
    });
    return lrcMap;
  }

  if (typeof translations === 'object') {
    Object.entries(translations).forEach(([lang, value]) => {
      if (lang === 'lrc_map') return;
      const key = toUiLangKey(value?.language || value?.lang || lang);
      const text = extractTranslationLyrics(value);
      if (key && text) lrcMap[key] = text;
    });
  }

  return lrcMap;
};

export const normalizeLrchubMeaningPayload = (res) => {
  if (!res || typeof res !== 'object') return null;

  const explanations = Array.isArray(res.explanations)
    ? res.explanations
    : (Array.isArray(res.timeline_meanings) ? res.timeline_meanings : []);
  const songSummary = (
    (res.song_summary && typeof res.song_summary === 'object') ? res.song_summary :
    (res.songSummary && typeof res.songSummary === 'object') ? res.songSummary :
    null
  );
  const finalSummary = (res.final_summary && typeof res.final_summary === 'object') ? res.final_summary : null;
  const comments = Array.isArray(res.comments) ? res.comments : [];
  const rating = (res.rating && typeof res.rating === 'object') ? res.rating : null;

  if (!explanations.length && !songSummary && !finalSummary && !comments.length && !rating) {
    return null;
  }

  return {
    title: res.display_name || res.title || res.track || '',
    track: res.track || res.title || '',
    artist: res.artist || res.artist_name || '',
    explanations,
    song_summary: songSummary,
    final_summary: finalSummary,
    comments,
    rating,
  };
};

export const normalizeLrchubLyricsResponse = (res) => {
  if (!res || typeof res !== 'object') return null;

  let lyrics = '';
  let dynamicLines = null;
  const animatedLyricsXml = [
    res.animated_lyrics,
    res.timedtext,
    res.timed_text,
    res.youtube_timedtext,
    res.caption_xml,
    res.captionXml
  ].find(value => typeof value === 'string' && value.trim()) || '';

  const dynText = res.dynamic_lrc || res.dynamic_lyrics || res.dynamicLrc || res.dynamicLyrics;
  if (dynText) {
    if (typeof dynText === 'string') {
      dynamicLines = parseDynamicLrc(dynText);
      lyrics = buildLrcFromDynamic(dynamicLines);
    } else if (typeof dynText === 'object' && Array.isArray(dynText.lines)) {
      dynamicLines = dynText.lines;
      lyrics = buildLrcFromDynamic(dynamicLines);
    }
  }

  if (!lyrics) {
    const fields = [
      res.synced_lyrics,
      res.syncedLyrics,
      res.lyrics,
      res.lrc,
      res.plain_lyrics,
      res.plainLyrics,
      res.text,
      animatedLyricsXml
    ];

    for (const value of fields) {
      if (typeof value === 'string' && value.trim()) {
        lyrics = value;
        break;
      }
    }
  }

  return {
    ...res,
    lyrics: String(lyrics || '').trim(),
    animated_lyrics: String(animatedLyricsXml || '').trim(),
    dynamicLines,
    meaningData: normalizeLrchubMeaningPayload(res),
    songSummary: res.song_summary || res.songSummary || res.final_summary || null,
    lrcMap: {
      ...normalizeLrchubTranslations(res.lrc_map),
      ...normalizeLrchubTranslations(res.lrcMap),
      ...normalizeLrchubTranslations(res.translations)
    }
  };
};

export const getLrchubSearchCandidates = (res) => {
  if (Array.isArray(res)) return res.filter(Boolean);
  if (!res || typeof res !== 'object') return [];

  const candidates = [];
  ['candidates', 'results', 'items'].forEach((key) => {
    if (Array.isArray(res[key])) {
      res[key].forEach(item => {
        if (item) candidates.push(item);
      });
    }
  });
  return candidates;
};

export const getLrchubRecordId = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = (
    candidate.record_id ||
    candidate.recordId ||
    candidate.candidate_id ||
    candidate.lyrics_id ||
    candidate.lyric_id ||
    (candidate.record && candidate.record.id) ||
    candidate.id
  );
  return id === undefined || id === null || id === '' ? null : String(id);
};

export const fetchFromLrchub = (params) => {
  const { track, artist, youtube_url, video_id, offset_ms, translate_to, translation_source, method = 'POST' } = params;
  const normalizedTranslateTo = Array.isArray(translate_to)
    ? translate_to.map(toLrchubTranslateLang).filter(Boolean)
    : toLrchubTranslateLang(translate_to);

  if (String(method || '').toUpperCase() === 'GET') {
    const url = new URL(`https://lrchub.coreone.work/api/lyrics?_=${getCacheBuster()}`);
    if (track) url.searchParams.set('track', track);
    if (artist) url.searchParams.set('artist', artist);
    if (youtube_url) url.searchParams.set('youtube_url', youtube_url);
    if (video_id) url.searchParams.set('video_id', video_id);
    if (offset_ms !== undefined && offset_ms !== null && offset_ms !== '') url.searchParams.set('offset_ms', offset_ms);
    if (translation_source) url.searchParams.set('translation_source', translation_source);
    if (Array.isArray(normalizedTranslateTo)) {
      normalizedTranslateTo.forEach(lang => url.searchParams.append('translate_to', lang));
    } else if (normalizedTranslateTo) {
      url.searchParams.set('translate_to', normalizedTranslateTo);
    }

    return fetch(url.toString(), { method: 'GET', cache: 'no-store' })
      .then(r => r.json())
      .then(res => normalizeLrchubLyricsResponse(res))
      .catch(err => {
        console.error('[BG] LRCHub GET error:', err);
        return null;
      });
  }

  const body = {
    track,
    artist,
    youtube_url,
    video_id,
    offset_ms,
    translation_source
  };
  if (Array.isArray(normalizedTranslateTo) ? normalizedTranslateTo.length : normalizedTranslateTo) {
    body.translate_to = normalizedTranslateTo;
  }

  return fetch(`https://lrchub.coreone.work/api/lyrics?_=${getCacheBuster()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(res => normalizeLrchubLyricsResponse(res))
    .catch(err => {
      console.error('[BG] LRCHub error:', err);
      return null;
    });
};

export const searchLrchub = (track, artist, limit = 30) => {
  const url = new URL(`https://lrchub.coreone.work/api/search?_=${getCacheBuster()}`);
  url.searchParams.set('track', track);
  if (artist) url.searchParams.set('artist', artist);
  if (limit) url.searchParams.set('limit', limit);

  return fetch(url.toString())
    .then(r => r.json())
    .catch(err => {
      console.error('[BG] LRCHub search error:', err);
      return [];
    });
};

export const fetchFromLrchubSearch = async (params = {}) => {
  const { track, artist, limit = 30, translate_to } = params;
  if (!track) return null;

  const searchRes = await searchLrchub(track, artist, limit);
  const candidates = getLrchubSearchCandidates(searchRes);

  const direct = normalizeLrchubLyricsResponse(searchRes);
  if (direct && direct.lyrics && direct.lyrics.trim()) {
    return {
      ...direct,
      candidates
    };
  }

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const normalized = await fetchLrchubCandidateLyrics(cand, translate_to);
    if (normalized && normalized.lyrics && normalized.lyrics.trim()) {
      const nextCandidates = candidates.map((item, idx) => (
        idx === i ? { ...item, lyrics: normalized.lyrics, dynamicLines: normalized.dynamicLines || null } : item
      ));
      return {
        ...normalized,
        candidates: nextCandidates
      };
    }
  }

  return {
    ...(direct || (searchRes && typeof searchRes === 'object' ? searchRes : {})),
    lyrics: '',
    dynamicLines: null,
    candidates
  };
};

export const fetchLrchubCandidateLyrics = async (candidate, translate_to) => {
  const direct = normalizeLrchubLyricsResponse(candidate);
  if (direct && direct.lyrics && direct.lyrics.trim()) return direct;

  const recordId = getLrchubRecordId(candidate);
  if (!recordId) return null;

  const recordRes = await fetchLrchubRecord(recordId, translate_to);
  return normalizeLrchubLyricsResponse(recordRes);
};

export const fetchLrchubRecord = (record_id, translate_to) => {
  const url = new URL(`https://lrchub.coreone.work/api/record?_=${getCacheBuster()}`);
  url.searchParams.set('record_id', record_id);
  if (translate_to) {
    if (Array.isArray(translate_to)) {
      translate_to.map(toLrchubTranslateLang).filter(Boolean).forEach(lang => url.searchParams.append('translate_to', lang));
    } else {
      const normalized = toLrchubTranslateLang(translate_to);
      if (normalized) url.searchParams.set('translate_to', normalized);
    }
  }

  return fetch(url.toString())
    .then(r => r.json())
    .catch(err => {
      console.error('[BG] LRCHub record error:', err);
      return null;
    });
};

export const saveLrchubExplanations = (record_id, explanations, song_summary) => {
  return fetch('https://lrchub.coreone.work/api/record/explanations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record_id, explanations, song_summary }),
  })
    .then(r => r.json())
    .catch(err => {
      console.error('[BG] LRCHub explanations error:', err);
      return { ok: false, error: String(err) };
    });
};

export const parseLrcTimeToMs = (ts) => {
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

export const parseDynamicLrc = (text) => {
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

export const buildLrcFromDynamic = (lines) => {
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
;

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

export const delay = (ms) => new Promise(resolve => {
  setTimeout(resolve, Math.max(0, ms || 0));
});

export async function fetchCommunityRemaining() {
  let lastErr = null;
  for (const url of COMMUNITY_REMAINING_ENDPOINTS) {
    try {
      const cbUrl = new URL(url);
      cbUrl.searchParams.set('_', getCacheBuster());
      const res = await withTimeout(fetch(cbUrl.toString(), { method: 'GET', cache: 'no-store' }), 20000, 'community remaining timeout');
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
