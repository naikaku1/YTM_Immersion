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

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
};

const unwrapLrchubRecord = (res) => {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return res;
  if (!res.record || typeof res.record !== 'object' || Array.isArray(res.record)) return res;
  return {
    ...res,
    ...res.record,
  };
};

const getLrchubVideoLinks = (res) => {
  if (!res || typeof res !== 'object') return [];
  const record = unwrapLrchubRecord(res) || {};
  const lists = [
    record.video_links,
    record.videoLinks,
    record.provider_meta?.video_links,
    record.providerMeta?.videoLinks,
    res.video_links,
    res.videoLinks,
    res.provider_meta?.video_links,
    res.providerMeta?.videoLinks,
  ];
  const normalizeList = (list) => {
    if (Array.isArray(list)) return list;
    if (!list || typeof list !== 'object') return [];
    return Object.entries(list).map(([mappedVideoId, value]) => (
      value && typeof value === 'object'
        ? { video_id: mappedVideoId, ...value }
        : { video_id: mappedVideoId, offset_ms: value }
    ));
  };
  return lists.flatMap(normalizeList);
};

export const getLrchubVideoOffsetMs = (res, videoId = '') => {
  if (!res || typeof res !== 'object') return 0;
  const record = unwrapLrchubRecord(res) || {};
  const explicitVideoId = String(videoId || '').trim();
  const responseVideoId = String(
    record.video_id || record.videoId || res.video_id || res.videoId || ''
  ).trim();
  const requestedVideoId = String(
    explicitVideoId || responseVideoId
  ).trim();
  const links = getLrchubVideoLinks(res);

  if (requestedVideoId) {
    const exact = links.find(link => (
      String(link?.video_id || link?.videoId || '').trim() === requestedVideoId
    ));
    const exactOffset = toFiniteNumber(exact?.offset_ms ?? exact?.offsetMs);
    if (exactOffset !== null) return exactOffset;
    // Never borrow an offset registered for another video of the same song.
    if (links.length) return 0;
    // A direct offset is only exact when the response identifies the same
    // video. Identity-free record/search offsets must not leak across videos.
    if (explicitVideoId && responseVideoId !== explicitVideoId) return 0;
    if (responseVideoId && responseVideoId !== requestedVideoId) return 0;
  }

  const directOffset = [
    record.offset_ms,
    record.offsetMs,
    res.offset_ms,
    res.offsetMs,
  ].map(toFiniteNumber).find(value => value !== null);
  return directOffset ?? 0;
};

export const shiftLrcTimestamps = (text, offsetMs) => {
  if (typeof text !== 'string' || !text || !Number.isFinite(Number(offsetMs)) || Number(offsetMs) === 0) {
    return text;
  }
  const deltaMs = Number(offsetMs);
  const timestampPattern = /([\[<])(\d+):(\d{2})(?:([.:])(\d{1,3}))?([\]>])/g;

  return text.replace(timestampPattern, (full, open, minuteRaw, secondRaw, separator, fractionRaw, close) => {
    const minutes = Number(minuteRaw);
    const seconds = Number(secondRaw);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return full;

    const fraction = String(fractionRaw || '');
    const fractionMs = fraction
      ? Number(fraction.padEnd(3, '0').slice(0, 3))
      : 0;
    const shiftedMs = Math.max(0, ((minutes * 60 + seconds) * 1000) + fractionMs + deltaMs);
    const shiftedMinutes = Math.floor(shiftedMs / 60000);
    const shiftedSeconds = Math.floor((shiftedMs % 60000) / 1000);
    const shiftedFractionMs = Math.floor(shiftedMs % 1000);
    const minuteText = String(shiftedMinutes).padStart(Math.max(2, minuteRaw.length), '0');
    const secondText = String(shiftedSeconds).padStart(2, '0');

    let fractionLength = fraction.length;
    if (!fractionLength && shiftedFractionMs !== 0) fractionLength = 3;
    let fractionText = '';
    if (fractionLength) {
      fractionText = String(shiftedFractionMs).padStart(3, '0').slice(0, fractionLength);
    }
    const fractionPart = fractionLength ? `${separator || '.'}${fractionText}` : '';
    return `${open}${minuteText}:${secondText}${fractionPart}${close}`;
  });
};

const normalizeDynamicLineObjects = (value) => {
  const sourceLines = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray(value.lines) ? value.lines : null);
  if (!sourceLines) return value;

  const normalizedLines = sourceLines.map(line => {
    const startTimeMs = firstFiniteNumber(
      line?.startTimeMs, line?.start_ms, line?.startMs, line?.time
    );
    const endTimeMs = firstFiniteNumber(
      line?.endTimeMs, line?.end_ms, line?.endMs, line?.endTime
    );
    const chars = Array.isArray(line?.chars)
      ? line.chars.map(char => {
        const t = firstFiniteNumber(
          char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time
        );
        const c = char?.c ?? char?.char ?? char?.text ?? char?.caption ?? char?.value;
        return {
          ...char,
          ...(t === null ? {} : { t }),
          ...(c === undefined || c === null ? {} : { c: String(c) }),
        };
      })
      : line?.chars;
    return {
      ...line,
      ...(startTimeMs === null ? {} : { startTimeMs }),
      ...(endTimeMs === null ? {} : { endTimeMs }),
      chars,
    };
  });

  return Array.isArray(value) ? normalizedLines : { ...value, lines: normalizedLines };
};

const shiftDynamicLineObjects = (value, offsetMs) => {
  const normalized = normalizeDynamicLineObjects(value);
  const sourceLines = Array.isArray(normalized) ? normalized : normalized?.lines;
  if (!Array.isArray(sourceLines)) return normalized;
  const deltaMs = Number(offsetMs);
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return normalized;

  const shiftNumeric = (raw) => {
    const numeric = toFiniteNumber(raw);
    return numeric === null ? raw : Math.max(0, numeric + deltaMs);
  };

  const shiftedLines = sourceLines.map(line => ({
      ...line,
      startTimeMs: shiftNumeric(line?.startTimeMs),
      endTimeMs: shiftNumeric(line?.endTimeMs),
      chars: Array.isArray(line?.chars)
        ? line.chars.map(char => ({
          ...char,
          t: shiftNumeric(char?.t),
          startTimeMs: shiftNumeric(char?.startTimeMs),
        }))
        : line?.chars,
    }));
  return Array.isArray(normalized) ? shiftedLines : { ...normalized, lines: shiftedLines };
};

const shiftTimedTranslationPayload = (value, offsetMs) => {
  if (typeof value === 'string') {
    return /[\[<]\d+:\d{2}/.test(value) ? shiftLrcTimestamps(value, offsetMs) : value;
  }
  if (Array.isArray(value)) return value.map(item => shiftTimedTranslationPayload(item, offsetMs));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, shiftTimedTranslationPayload(nested, offsetMs)])
  );
};

const ANIMATED_LYRICS_FIELDS = [
  'animated_lyrics',
  'timedtext',
  'timed_text',
  'youtube_timedtext',
  'caption_xml',
  'captionXml',
];
const ANIMATED_JSON_MS_KEYS = new Set(['t', 'time_ms', 'start_ms', 'end_ms', 'timestamp_ms']);
const ANIMATED_JSON_SECOND_KEYS = new Set(['start', 'end', 'time', 'timestamp', 'begin']);

const getAnimatedLyricsEntry = (value) => {
  if (!value || typeof value !== 'object') return null;
  for (const key of ANIMATED_LYRICS_FIELDS) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return { key, text: value[key] };
    }
  }
  return null;
};

const formatAnimatedSeconds = (value) => {
  const text = Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return text || '0';
};

const shiftAnimatedMsValue = (value, offsetMs) => {
  if (typeof value === 'boolean') return value;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return value;
  const shifted = Math.max(0, Math.round(numeric + offsetMs));
  return typeof value === 'string' ? String(shifted) : shifted;
};

const shiftAnimatedSecondsValue = (value, offsetMs) => {
  if (typeof value === 'boolean') return value;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return value;
  const shifted = Math.max(0, numeric + (offsetMs / 1000));
  return typeof value === 'string' ? formatAnimatedSeconds(shifted) : shifted;
};

const shiftAnimatedJsonTimes = (value, offsetMs) => {
  if (Array.isArray(value)) return value.map(item => shiftAnimatedJsonTimes(item, offsetMs));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    const normalizedKey = String(key).toLowerCase();
    if (ANIMATED_JSON_MS_KEYS.has(normalizedKey)) {
      return [key, shiftAnimatedMsValue(nested, offsetMs)];
    }
    if (ANIMATED_JSON_SECOND_KEYS.has(normalizedKey)) {
      return [key, shiftAnimatedSecondsValue(nested, offsetMs)];
    }
    return [key, shiftAnimatedJsonTimes(nested, offsetMs)];
  }));
};

const shiftAnimatedTimedText = (text, offsetMs) => {
  const paragraphPattern = /(<p\b[^>]*?\bt\s*=\s*)(["'])(-?\d+(?:\.\d+)?)(\2)/gi;
  const textPattern = /(<text\b[^>]*?\bstart\s*=\s*)(["'])(-?\d+(?:\.\d+)?)(\2)/gi;
  const shiftedParagraphs = text.replace(
    paragraphPattern,
    (full, prefix, quote, raw, suffix) => (
      `${prefix}${quote}${shiftAnimatedMsValue(raw, offsetMs)}${suffix}`
    ),
  );
  return shiftedParagraphs.replace(
    textPattern,
    (full, prefix, quote, raw, suffix) => (
      `${prefix}${quote}${shiftAnimatedSecondsValue(raw, offsetMs)}${suffix}`
    ),
  );
};

const shiftAnimatedLyricsPayload = (animatedLyrics, offsetMs) => {
  if (typeof animatedLyrics !== 'string' || !animatedLyrics || !Number.isFinite(Number(offsetMs)) || Number(offsetMs) === 0) {
    return animatedLyrics;
  }
  const text = String(animatedLyrics);
  const stripped = text.trimStart();
  if (stripped.startsWith('{') || stripped.startsWith('[')) {
    try {
      return JSON.stringify(shiftAnimatedJsonTimes(JSON.parse(text), Number(offsetMs)));
    } catch (e) {
      // Continue with TimedText/LRC detection when a JSON-looking payload is malformed.
    }
  }
  const shiftedTimedText = shiftAnimatedTimedText(text, Number(offsetMs));
  if (shiftedTimedText !== text) return shiftedTimedText;
  if (/[\[<]\d{1,3}:\d{2}(?:[.:]\d{1,3})?[\]>]/.test(text)) {
    return shiftLrcTimestamps(text, Number(offsetMs));
  }
  return text;
};

const sha256Hex = async (text) => {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function' || typeof TextEncoder !== 'function') return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
    return Array.from(
      new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('');
  } catch (e) {
    return null;
  }
};

const applyVerifiedAnimatedOffset = async (raw, normalized, videoId) => {
  if (!raw || !normalized || typeof normalized !== 'object') return normalized;
  const source = unwrapLrchubRecord(raw);
  if (!source || typeof source !== 'object') return normalized;
  const animated = getAnimatedLyricsEntry(source);
  if (!animated) return normalized;

  const requestedVideoId = String(videoId || source.video_id || source.videoId || '').trim();
  if (!requestedVideoId) return normalized;
  const offsetMs = getLrchubVideoOffsetMs(raw, requestedVideoId);
  if (!offsetMs) return normalized;

  const appliedVideoId = String(source._ytmAnimatedOffsetAppliedForVideoId || '').trim();
  const appliedOffsetMs = toFiniteNumber(source._ytmAnimatedOffsetAppliedMs);
  if (appliedVideoId === requestedVideoId && appliedOffsetMs === offsetMs) return normalized;

  const providerMeta = source.provider_meta || source.providerMeta;
  if (!providerMeta || providerMeta.animated_lyrics_offset_normalized !== true) return normalized;
  const expectedHash = String(providerMeta.animated_lyrics_offset_normalized_hash || '').trim();
  if (expectedHash) {
    const actualHash = await sha256Hex(animated.text);
    if (!actualHash || actualHash !== expectedHash) return normalized;
  }

  const shiftedAnimated = shiftAnimatedLyricsPayload(animated.text, offsetMs);
  const aliases = {};
  for (const key of ANIMATED_LYRICS_FIELDS) {
    if (source[key] === animated.text) aliases[key] = shiftedAnimated;
  }
  const normalizedLyricsMatchesAnimated = (
    typeof normalized.lyrics === 'string' &&
    normalized.lyrics.trim() === animated.text.trim()
  );
  return {
    ...normalized,
    ...aliases,
    animated_lyrics: shiftedAnimated,
    ...(normalizedLyricsMatchesAnimated ? { lyrics: shiftedAnimated } : {}),
    _ytmAnimatedOffsetAppliedForVideoId: requestedVideoId,
    _ytmAnimatedOffsetAppliedMs: offsetMs,
  };
};

const applyLrchubVideoOffset = (res, videoId) => {
  const record = unwrapLrchubRecord(res);
  if (!record || typeof record !== 'object') return record;
  const requestedVideoId = String(videoId || record.video_id || record.videoId || '').trim();
  if (requestedVideoId && record.offsetAppliedForVideoId === requestedVideoId) return record;
  const offsetMs = getLrchubVideoOffsetMs(res, videoId);
  if (!offsetMs) {
    return {
      ...record,
      offset_ms: 0,
      video_id: requestedVideoId,
      offsetAppliedForVideoId: requestedVideoId || null,
    };
  }

  const shifted = {
    ...record,
    offset_ms: offsetMs,
    video_id: requestedVideoId,
    offsetAppliedForVideoId: requestedVideoId || null,
  };
  ['dynamic_lrc', 'dynamic_lyrics', 'dynamicLrc', 'dynamicLyrics', 'synced_lyrics', 'syncedLyrics', 'lrc'].forEach(key => {
    if (typeof shifted[key] === 'string') shifted[key] = shiftLrcTimestamps(shifted[key], offsetMs);
  });
  const rawAnimated = getAnimatedLyricsEntry(record);
  const lyricsDuplicatesAnimated = !!rawAnimated &&
    typeof record.lyrics === 'string' &&
    record.lyrics.trim() === rawAnimated.text.trim();
  if (!lyricsDuplicatesAnimated && typeof shifted.lyrics === 'string' && /[\[<]\d+:\d{2}/.test(shifted.lyrics)) {
    shifted.lyrics = shiftLrcTimestamps(shifted.lyrics, offsetMs);
  }
  // Raw animated captions are not necessarily canonicalized to the song
  // timeline. LRCHub only shifts them after a flag + payload-hash check, so the
  // conservative client path leaves them untouched.
  ['dynamic_lrc', 'dynamic_lyrics', 'dynamicLrc', 'dynamicLyrics'].forEach(key => {
    if (shifted[key] && typeof shifted[key] === 'object') {
      shifted[key] = shiftDynamicLineObjects(shifted[key], offsetMs);
    }
  });
  ['lrc_map', 'lrcMap', 'translations'].forEach(key => {
    if (shifted[key]) shifted[key] = shiftTimedTranslationPayload(shifted[key], offsetMs);
  });
  return shifted;
};

export const normalizeLrchubLyricsResponse = (res, options = {}) => {
  if (!res || typeof res !== 'object') return null;
  const normalizedOptions = typeof options === 'string' ? { videoId: options } : (options || {});
  const videoId = normalizedOptions.videoId || '';
  const source = normalizedOptions.applyVideoOffset
    ? applyLrchubVideoOffset(res, videoId)
    : unwrapLrchubRecord(res);
  if (!source || typeof source !== 'object') return null;
  const translationOffsetMs = normalizedOptions.applyVideoOffsetToTranslations
    ? getLrchubVideoOffsetMs(source, videoId)
    : 0;
  const translationPayload = (value) => (
    translationOffsetMs ? shiftTimedTranslationPayload(value, translationOffsetMs) : value
  );

  let lyrics = '';
  let dynamicLines = null;
  const animatedLyricsXml = [
    source.animated_lyrics,
    source.timedtext,
    source.timed_text,
    source.youtube_timedtext,
    source.caption_xml,
    source.captionXml
  ].find(value => typeof value === 'string' && value.trim()) || '';

  const dynText = source.dynamic_lrc || source.dynamic_lyrics || source.dynamicLrc || source.dynamicLyrics;
  if (dynText) {
    if (typeof dynText === 'string') {
      dynamicLines = parseDynamicLrc(dynText);
      lyrics = buildLrcFromDynamic(dynamicLines);
    } else if (typeof dynText === 'object') {
      const normalizedDynamic = normalizeDynamicLineObjects(dynText);
      dynamicLines = Array.isArray(normalizedDynamic) ? normalizedDynamic : normalizedDynamic?.lines;
      lyrics = buildLrcFromDynamic(dynamicLines);
    }
  }

  if (!lyrics) {
    const fields = [
      source.synced_lyrics,
      source.syncedLyrics,
      source.lyrics,
      source.lrc,
      source.plain_lyrics,
      source.plainLyrics,
      source.text,
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
    ...source,
    // Keep physical outer blank lines. /api/record/singers indexes plain
    // lyrics by the original split("\\n") order, including those rows.
    lyrics: String(lyrics || ''),
    animated_lyrics: String(animatedLyricsXml || '').trim(),
    dynamicLines,
    offset_ms: getLrchubVideoOffsetMs(source, videoId),
    meaningData: normalizeLrchubMeaningPayload(source),
    songSummary: source.song_summary || source.songSummary || source.final_summary || null,
    lrcMap: {
      ...normalizeLrchubTranslations(translationPayload(source.lrc_map)),
      ...normalizeLrchubTranslations(translationPayload(source.lrcMap)),
      ...normalizeLrchubTranslations(translationPayload(source.translations))
    }
  };
};

export const normalizeRawLrchubLyricsForVideo = async (res, videoId = '') => {
  const normalized = normalizeLrchubLyricsResponse(res, {
    videoId,
    applyVideoOffset: true,
  });
  return applyVerifiedAnimatedOffset(res, normalized, videoId);
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
    (candidate.provider_meta && candidate.provider_meta.record_id) ||
    (candidate.provider_meta && candidate.provider_meta.recordId) ||
    (candidate.providerMeta && candidate.providerMeta.record_id) ||
    (candidate.providerMeta && candidate.providerMeta.recordId) ||
    candidate.candidate_id ||
    candidate.lyrics_id ||
    candidate.lyric_id ||
    (candidate.record && candidate.record.id) ||
    (candidate.record && candidate.record.record_id) ||
    (candidate.record && candidate.record.recordId) ||
    candidate.id
  );
  return id === undefined || id === null || id === '' ? null : String(id);
};

const LRCHUB_MAX_SINGER_NUMBER = 32;

const normalizeLrchubSingerNumber = (value, fallback = 1) => {
  if (typeof value === 'boolean') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > LRCHUB_MAX_SINGER_NUMBER) {
    return fallback;
  }
  return number;
};

const normalizeLrchubSingerColor = (value) => {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '';
};

export const normalizeLrchubSingerMetadata = (res) => {
  if (!res || typeof res !== 'object' || Array.isArray(res) || res.ok === false) return null;

  const rawAssignments = Array.isArray(res.line_singers)
    ? res.line_singers
    : (Array.isArray(res.assignments) ? res.assignments : []);
  const declaredLineCount = Number(res.line_count);
  const lineCount = Number.isInteger(declaredLineCount) && declaredLineCount >= 0
    ? declaredLineCount
    : rawAssignments.length;
  const line_singers = Array.from(
    { length: lineCount },
    (_, index) => normalizeLrchubSingerNumber(rawAssignments[index], 1),
  );

  const singers = {};
  const rawSingers = res.singers && typeof res.singers === 'object' && !Array.isArray(res.singers)
    ? res.singers
    : {};
  Object.entries(rawSingers).forEach(([rawNumber, rawProfile]) => {
    const number = normalizeLrchubSingerNumber(rawNumber, 0);
    if (!number || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) return;
    singers[String(number)] = {
      artist_name: String(rawProfile.artist_name || rawProfile.artist || '').trim().slice(0, 200),
      color: normalizeLrchubSingerColor(rawProfile.color),
    };
  });

  const singer_numbers = [...new Set(line_singers.length ? line_singers : [1])].sort((a, b) => a - b);
  singer_numbers.forEach((number) => {
    const key = String(number);
    if (!singers[key]) singers[key] = { artist_name: '', color: '' };
  });
  if (!singers['1']) singers['1'] = { artist_name: '', color: '' };

  return {
    ...res,
    ok: true,
    record_id: getLrchubRecordId(res),
    video_id: String(res.video_id || res.videoId || '').trim(),
    line_count: lineCount,
    line_singers,
    singers,
    singer_numbers,
    singer_count: singer_numbers.length || 1,
    lyrics_revision: String(res.lyrics_revision || '').trim(),
    effective_scope: ['song', 'video', 'default'].includes(String(res.effective_scope || '').toLowerCase())
      ? String(res.effective_scope).toLowerCase()
      : 'default',
    inherited: !!res.inherited,
    has_song_config: !!res.has_song_config,
    has_video_override: !!res.has_video_override,
    song_config: res.song_config && typeof res.song_config === 'object' ? res.song_config : null,
    video_override: res.video_override && typeof res.video_override === 'object' ? res.video_override : null,
  };
};

export const fetchLrchubSingerMetadata = (params = {}) => {
  const recordId = String(params.record_id || params.recordId || '').trim();
  if (!recordId) return Promise.resolve(null);

  const endpoint = new URL(`https://lrchub.coreone.work/api/record/singers?_=${getCacheBuster()}`);
  endpoint.searchParams.set('record_id', recordId);
  const videoId = String(params.video_id || params.videoId || '').trim();
  const videoUrl = String(params.url || params.youtube_url || params.youtubeUrl || '').trim();
  if (videoId) endpoint.searchParams.set('video_id', videoId);
  else if (videoUrl) endpoint.searchParams.set('url', videoUrl);

  return fetch(endpoint.toString(), { method: 'GET', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`LRCHub singers failed: ${response.status} ${message}`);
      }
      return response.json();
    })
    .then(normalizeLrchubSingerMetadata)
    .catch(err => {
      console.warn('[BG] LRCHub singers error:', err);
      return null;
    });
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
      // /api/lyrics already applies the selected video's offset server-side.
      .then(res => normalizeLrchubLyricsResponse(res, {
        videoId: video_id,
        applyVideoOffsetToTranslations: true,
      }))
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
    // /api/lyrics already applies the selected video's offset server-side.
    .then(res => normalizeLrchubLyricsResponse(res, {
      videoId: video_id,
      applyVideoOffsetToTranslations: true,
    }))
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
  const { track, artist, limit = 30, translate_to, video_id } = params;
  if (!track) return null;

  const searchRes = await searchLrchub(track, artist, limit);
  const candidates = getLrchubSearchCandidates(searchRes);

  const direct = await normalizeRawLrchubLyricsForVideo(searchRes, video_id);
  if (direct && direct.lyrics && direct.lyrics.trim()) {
    return {
      ...direct,
      candidates
    };
  }

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const normalized = await fetchLrchubCandidateLyrics(cand, translate_to, video_id);
    if (normalized && normalized.lyrics && normalized.lyrics.trim()) {
      const nextCandidates = candidates.map((item, idx) => (
        idx === i ? {
          ...item,
          lyrics: normalized.lyrics,
          dynamicLines: normalized.dynamicLines || null,
          lyricsComplete: true,
        } : item
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

export const fetchLrchubCandidateLyrics = async (candidate, translate_to, video_id = '') => {
  // Search/record responses contain canonical timestamps. Apply only the
  // offset belonging to the current video before parsing them.
  const direct = await normalizeRawLrchubLyricsForVideo(candidate, video_id);
  const recordId = getLrchubRecordId(candidate);
  if (!recordId) {
    return direct && direct.lyrics && direct.lyrics.trim() ? direct : null;
  }

  // /api/search lyric fields are previews and may be truncated mid-line.
  // Prefer the complete record whenever an id is available, falling back to
  // the preview only when the detail request fails or contains no lyrics.
  const recordRes = await fetchLrchubRecord(recordId, translate_to);
  const complete = await normalizeRawLrchubLyricsForVideo(recordRes, video_id);
  if (complete && complete.lyrics && complete.lyrics.trim()) return complete;
  return direct && direct.lyrics && direct.lyrics.trim() ? direct : null;
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
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || 'timeout')), ms);
    }),
  ]).finally(() => {
    // 解除しないと GET_LYRICS 1回につき数本のタイマーが満了まで居座る
    if (timer !== null) clearTimeout(timer);
  });
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
