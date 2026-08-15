const resolveDeepLTargetLang = (lang) => {
  switch ((lang || '').toLowerCase()) {
    case 'en': case 'en-us': case 'en-gb': return 'EN';
    case 'ja': return 'JA';
    case 'ko': return 'KO';
    case 'fr': return 'FR';
    case 'de': return 'DE';
    case 'es': return 'ES';
    case 'zh': case 'zh-cn': case 'zh-tw': return 'ZH';
    default: return 'JA';
  }
};

const parseLRCInternal = (lrc) => {
  if (!lrc) return { lines: [], hasTs: false };
  const tagTest = /\[\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,4}\s*)?\]/;

  // タイムスタンプがない場合
  if (!tagTest.test(lrc)) {
    // 空行も保持して、翻訳時に行が詰まらないようにする
    const lines = lrc.split(/\r?\n/).map((line, sourceIndex) => {
      const text = (line ?? '').replace(/^\s+|\s+$/g, '');
      return { time: null, text, source_index: sourceIndex };
    });
    return { lines, hasTs: false };
  }

  const lines = lrc.split(/\r?\n/);
  const result = [];
  const tagExp = /\[\s*(\d{1,3})\s*:\s*(\d{2})\s*(?:[.:]\s*(\d{1,4})\s*)?\]/g;

  let sourceIndex = 0;
  lines.forEach(lineStr => {
    const line = (lineStr ?? '').trim();
    if (!line) return;

    // Extract all tags on this line
    const tags = [];
    let match;
    tagExp.lastIndex = 0;
    while ((match = tagExp.exec(line)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3] || '0';
      const frac = parseFloat('0.' + fracStr);
      const time = min * 60 + sec + frac;
      tags.push(time);
    }

    if (tags.length > 0) {
      const currentSourceIndex = sourceIndex++;
      // Strip all tags to get the line text
      const text = line.replace(/\[\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,4}\s*)?\]/g, '').trim();
      tags.forEach(time => {
        result.push({ time, text, source_index: currentSourceIndex });
      });
    }
  });

  result.sort((a, b) => (a.time || 0) - (b.time || 0));
  return { lines: result, hasTs: true };
};


const parseBaseLRC = (lrc) => {
  const { lines, hasTs } = parseLRCInternal(lrc);
  hasTimestamp = hasTs;
  return lines;
};

const MAX_SINGER_NUMBER = 32;

const normalizeSingerNumber = (value) => {
  if (typeof value === 'boolean') return 1;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_SINGER_NUMBER ? number : 1;
};

const normalizeSingerColor = (value) => {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '';
};

const normalizeSingerLineText = (line) => String(line?.text ?? line ?? '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const singerMetadataSource = (metadata) => (
  metadata?.effective && typeof metadata.effective === 'object'
    ? { ...metadata, ...metadata.effective }
    : metadata
);

const hasSingerDisplayMetadata = (metadata, canonicalLines = null) => {
  const source = singerMetadataSource(metadata);
  if (!source || typeof source !== 'object') return false;
  if (
    Array.isArray(canonicalLines) &&
    !singerMetadataMatchesCanonicalLines(source, canonicalLines)
  ) return false;
  const assignments = Array.isArray(source.line_singers) ? source.line_singers : [];
  if (assignments.some(number => normalizeSingerNumber(number) !== 1)) return true;
  const singers = source.singers && typeof source.singers === 'object' && !Array.isArray(source.singers)
    ? source.singers
    : {};
  return Object.values(singers).some(profile => (
    profile && typeof profile === 'object' && (
      String(profile.artist_name || profile.artist || '').trim() ||
      normalizeSingerColor(profile.color)
    )
  ));
};

const countCanonicalSingerLines = (canonicalLines) => {
  if (!Array.isArray(canonicalLines)) return null;
  const indexes = new Set();
  canonicalLines.forEach((line, index) => {
    const rawSourceIndex = Number(line?.source_index);
    indexes.add(Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index);
  });
  return indexes.size;
};

const singerMetadataMatchesCanonicalLines = (metadata, canonicalLines) => {
  const source = singerMetadataSource(metadata);
  const declaredLineCount = Number(source?.line_count);
  if (!Number.isInteger(declaredLineCount) || declaredLineCount < 0) return true;
  return countCanonicalSingerLines(canonicalLines) === declaredLineCount;
};

const clearSingerFields = (line) => {
  if (!line || typeof line !== 'object') return line;
  const next = { ...line };
  delete next.singerNumber;
  delete next.singerArtistName;
  delete next.singerColor;
  delete next.showSingerName;
  return next;
};

const applySingerMetadataToLines = (lines, metadata, options = {}) => {
  if (!Array.isArray(lines)) return [];
  const source = singerMetadataSource(metadata);
  if (!source || typeof source !== 'object') return lines.map(clearSingerFields);

  const assignments = Array.isArray(source.line_singers)
    ? source.line_singers.map(normalizeSingerNumber)
    : [];
  const singers = source.singers && typeof source.singers === 'object' && !Array.isArray(source.singers)
    ? source.singers
    : {};
  const hasCanonicalLineContract = Array.isArray(options.canonicalLines);
  const canonicalLines = hasCanonicalLineContract ? options.canonicalLines : [];
  const sameSource = options.sameSource !== false;
  if (
    hasCanonicalLineContract &&
    !singerMetadataMatchesCanonicalLines(source, canonicalLines)
  ) return lines.map(clearSingerFields);
  const resolvedAssignments = new Array(lines.length).fill(null);

  if (sameSource || !canonicalLines.length) {
    lines.forEach((line, index) => {
      if (line?.duetSide === 'right') return;
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index;
      resolvedAssignments[index] = normalizeSingerNumber(assignments[sourceIndex]);
    });
  } else {
    const queues = new Map();
    const seenSourceIndexes = new Set();
    canonicalLines.forEach((line, index) => {
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index;
      if (seenSourceIndexes.has(sourceIndex)) return;
      seenSourceIndexes.add(sourceIndex);
      const key = normalizeSingerLineText(line);
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push({ sourceIndex, number: normalizeSingerNumber(assignments[sourceIndex]) });
    });

    const usedCanonicalIndexes = new Set();
    lines.forEach((line, displayIndex) => {
      if (line?.duetSide === 'right') return;
      const queue = queues.get(normalizeSingerLineText(line));
      while (queue?.length && usedCanonicalIndexes.has(queue[0].sourceIndex)) queue.shift();
      if (!queue?.length) return;
      const match = queue.shift();
      usedCanonicalIndexes.add(match.sourceIndex);
      resolvedAssignments[displayIndex] = match.number;
    });

    lines.forEach((line, displayIndex) => {
      if (line?.duetSide === 'right' || resolvedAssignments[displayIndex] !== null) return;
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : displayIndex;
      resolvedAssignments[displayIndex] = normalizeSingerNumber(assignments[sourceIndex]);
    });
  }

  let previousDisplaySingerNumber = null;
  return lines.map((line, index) => {
    const next = clearSingerFields(line);
    const number = resolvedAssignments[index];
    if (!next || number === null) return next;
    const profile = singers[String(number)] && typeof singers[String(number)] === 'object'
      ? singers[String(number)]
      : {};
    const artistName = String(profile.artist_name || profile.artist || '').trim().slice(0, 200);
    const hasDisplayText = !!normalizeSingerLineText(next);
    const showSingerName = hasDisplayText && !!artistName && previousDisplaySingerNumber !== number;
    if (hasDisplayText) previousDisplaySingerNumber = number;
    return {
      ...next,
      singerNumber: number,
      singerArtistName: artistName,
      singerColor: normalizeSingerColor(profile.color),
      showSingerName,
    };
  });
};

const applySingerMetadataToRow = (row, line, metadata) => {
  if (!row || !line || line.singerNumber === null || line.singerNumber === undefined) return;
  const number = normalizeSingerNumber(line.singerNumber);
  const isEven = number % 2 === 0;
  row.dataset.singerNumber = String(number);
  row.classList.toggle('singer-odd', !isEven);
  row.classList.toggle('singer-even', isEven);

  const artistName = String(line.singerArtistName || '').trim();
  row.dataset.singerLabel = artistName || `Singer ${number}`;
  const color = normalizeSingerColor(line.singerColor);
  if (color) {
    row.dataset.singerColor = color;
    row.style.setProperty('--ytm-singer-color', color);
  } else {
    delete row.dataset.singerColor;
    row.style.removeProperty('--ytm-singer-color');
  }

  if (artistName && line.showSingerName) {
    const label = (row.ownerDocument || document).createElement('span');
    label.className = 'lyric-singer-name';
    label.textContent = artistName;
    row.appendChild(label);
  }
};

// ===== duet helpers =====
const timeKey = (t) => {
  if (typeof t !== 'number' || Number.isNaN(t)) return 'NaN';
  // milliseconds precision is enough for LRC tags
  return t.toFixed(3);
};

const DUET_TIME_TOLERANCE = 0.15;
const DUET_DUPLICATE_TOLERANCE = 1.0;
const SAME_TIMESTAMP_TOLERANCE = 0.05;
const DYNAMIC_ACTIVE_TAIL_SEC = 0.2;
const DYNAMIC_OVERLAP_TOLERANCE = 0.05;

const normalizeLyricCompareText = (text) => String(text || '')
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, '')
  .replace(/[.,，。!！?？:：;；'"\-‐‑‒–—―~〜()（）\[\]{}<>「」『』【】]/g, '')
  .toLowerCase()
  .trim();

const normalizeLyricCompareTextStrict = (text) => String(text || '')
  .normalize('NFKC')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, '')
  .replace(/[\p{P}\p{S}\p{C}]/gu, '')
  .toLowerCase()
  .trim();

const extractDynamicLineText = (line) => {
  if (typeof line?.text === 'string' && line.text.length) return line.text;
  if (Array.isArray(line?.chars)) {
    return line.chars.map(c => c?.c || c?.text || c?.caption || '').join('');
  }
  return '';
};

const toFiniteDynamicTime = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getDynamicLineStartSec = (line) => {
  for (const value of [line?.startTimeMs, line?.start_ms, line?.startMs]) {
    const milliseconds = toFiniteDynamicTime(value);
    if (milliseconds !== null) return milliseconds / 1000;
  }
  const seconds = toFiniteDynamicTime(line?.time);
  if (seconds !== null) return seconds;
  if (Array.isArray(line?.chars) && line.chars.length) {
    const ts = line.chars
      .map(char => [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .map(toFiniteDynamicTime)
        .find(value => value !== null) ?? null)
      .filter(v => v != null);
    if (ts.length) return Math.min(...ts) / 1000;
  }
  return null;
};

const getDynamicLineEndSec = (line) => {
  if (!line) return null;
  if (typeof line.__ytmEndSec === 'number' && Number.isFinite(line.__ytmEndSec)) {
    return line.__ytmEndSec;
  }

  const startSec = getDynamicLineStartSec(line);
  let endSec = null;

  for (const value of [line?.endTimeMs, line?.end_ms, line?.endMs, line?.endTime]) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) continue;
    const milliseconds = Number(value);
    if (Number.isFinite(milliseconds)) {
      endSec = milliseconds / 1000;
      break;
    }
  }

  if (Array.isArray(line?.chars) && line.chars.length) {
    const lastCharMs = line.chars
      .map(char => [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .map(toFiniteDynamicTime)
        .find(value => value !== null) ?? null)
      .filter(v => v != null)
      .reduce((max, v) => Math.max(max, v), Number.NEGATIVE_INFINITY);

    if (Number.isFinite(lastCharMs)) {
      const charTailSec = (lastCharMs / 1000) + DYNAMIC_ACTIVE_TAIL_SEC;
      endSec = (typeof endSec === 'number') ? Math.max(endSec, charTailSec) : charTailSec;
    }
  }

  if (!(typeof endSec === 'number') && typeof startSec === 'number') {
    endSec = startSec + 1.5;
  }

  if (typeof startSec === 'number' && typeof endSec === 'number' && endSec <= startSec) {
    endSec = startSec + DYNAMIC_ACTIVE_TAIL_SEC;
  }

  if (typeof endSec === 'number' && Number.isFinite(endSec)) {
    line.__ytmEndSec = endSec;
    return endSec;
  }
  return null;
};

const isLineDynamicallyActiveAtTime = (line, timeSec, tolerance = DYNAMIC_OVERLAP_TOLERANCE) => {
  const startSec = (typeof line?._dynamicRenderStartSec === 'number' && Number.isFinite(line._dynamicRenderStartSec))
    ? line._dynamicRenderStartSec
    : null;
  const endSec = (typeof line?._dynamicRenderEndSec === 'number' && Number.isFinite(line._dynamicRenderEndSec))
    ? line._dynamicRenderEndSec
    : null;

  return typeof startSec === 'number' &&
    typeof endSec === 'number' &&
    (timeSec + tolerance) >= startSec &&
    timeSec <= (endSec + tolerance);
};

const isSameTimestamp = (a, b, tolerance = SAME_TIMESTAMP_TOLERANCE) =>
  typeof a === 'number' &&
  typeof b === 'number' &&
  Math.abs(a - b) <= tolerance;

const scoreLyricTextMatch = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 60;
  return 0;
};

const findCrossSideDuplicateIndex = (lines, line) => {
  if (!Array.isArray(lines) || !lines.length || !line) return -1;

  const lineText = normalizeLyricCompareTextStrict(line?.text);
  if (!lineText) return -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const existing = lines[i];
    if (!isSameTimestamp(existing?.time, line?.time, DUET_DUPLICATE_TOLERANCE)) {
      if (typeof existing?.time === 'number' && typeof line?.time === 'number' && existing.time < line.time - DUET_DUPLICATE_TOLERANCE) {
        break;
      }
      continue;
    }

    const isCrossSideDuplicate = existing?.duetSide && line?.duetSide && existing.duetSide !== line.duetSide;
    if (!isCrossSideDuplicate) continue;

    const existingText = normalizeLyricCompareTextStrict(existing?.text);
    if (existingText && scoreLyricTextMatch(existingText, lineText) >= 100) {
      return i;
    }
  }

  return -1;
};

const preferDuplicateMainLine = (existingLine, incomingLine) => {
  if (!existingLine) return incomingLine || null;
  if (!incomingLine) return existingLine;
  if (existingLine.duetSide === incomingLine.duetSide) return existingLine;
  if (incomingLine.duetSide === 'left') return incomingLine;
  if (existingLine.duetSide === 'left') return existingLine;
  return existingLine;
};

const findDynamicLineForRender = (line, sourceLines, usedIndexes) => {
  if (!line || typeof line.time !== 'number') return null;
  if (!Array.isArray(sourceLines) || !sourceLines.length) return null;

  const wantedText = normalizeLyricCompareTextStrict(line.text);
  const candidates = [];

  sourceLines.forEach((dynLine, idx) => {
    const startSec = getDynamicLineStartSec(dynLine);
    if (typeof startSec !== 'number') return;

    const timeDiff = Math.abs(startSec - line.time);
    if (timeDiff > DUET_TIME_TOLERANCE) return;

    const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
    const textScore = scoreLyricTextMatch(wantedText, dynText);

    candidates.push({
      idx,
      dynLine,
      timeDiff,
      textScore,
      used: !!(usedIndexes && usedIndexes.has(idx)),
    });
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    Number(a.used) - Number(b.used) ||
    b.textScore - a.textScore ||
    a.timeDiff - b.timeDiff ||
    a.idx - b.idx
  );

  const picked = candidates[0];
  if (usedIndexes) usedIndexes.add(picked.idx);
  return picked.dynLine;
};

// コンテンツマッチでDynamic LRC行を探す（時間が大きくずれている場合の1文字同期対応用）
// timeTolerance: 秒単位の許容幅。1文字同期の場合は5.0秒推奨。
const findDynamicLineByContent = (line, sourceLines, timeTolerance = 5.0) => {
  if (!line || !Array.isArray(sourceLines) || !sourceLines.length) return null;
  const wantedText = normalizeLyricCompareTextStrict(line.text);
  if (!wantedText) return null;

  let bestMatch = null;
  let bestScore = 0;
  let bestTimeDiff = Infinity;

  sourceLines.forEach(dynLine => {
    const startSec = getDynamicLineStartSec(dynLine);
    if (typeof startSec !== 'number') return;
    if (typeof line.time === 'number' && Math.abs(startSec - line.time) > timeTolerance) return;

    const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
    const score = scoreLyricTextMatch(wantedText, dynText);
    if (score <= 0) return;

    const timeDiff = typeof line.time === 'number' ? Math.abs(startSec - line.time) : 0;
    // 同スコアなら時間が近い方を優先
    if (score > bestScore || (score === bestScore && timeDiff < bestTimeDiff)) {
      bestScore = score;
      bestTimeDiff = timeDiff;
      bestMatch = dynLine;
    }
  });

  // 完全一致(100)のみ採用: 部分一致(60)だと文字数・内容が違うデータが当たり誤表示の原因になる
  return bestScore >= 100 ? bestMatch : null;
};

// Dynamic.lrc形式のパーサー（sub.txt用）
const parseDynamicLrcForSub = (text) => {
  const out = [];
  if (!text) return out;

  const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const parseLrcTimeToMsSub = (ts) => {
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

  // 1st pass: parse lines
  const parsed = [];
  for (const raw of rows) {
    const line = raw.trimEnd();
    if (!line) continue;

    const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    if (!m) continue;

    parsed.push({
      lineMs: parseLrcTimeToMsSub(m[1]),
      rest: m[2] || '',
    });
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

    for (let i = 0; i < n; i++) {
      const t = s + Math.floor(step * i);
      chars.push({ t, c: arr[i] });
    }
  };

  for (let li = 0; li < parsed.length; li++) {
    const { lineMs, rest } = parsed[li];
    const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
      ? parsed[li + 1].lineMs
      : null;

    const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
    const chars = [];

    let prevMs = null;
    let prevEnd = 0;

    while (true) {
      const mm = tagRe.exec(rest);
      if (!mm) break;

      const tagMs = parseLrcTimeToMsSub(mm[1]);

      if (prevMs == null && tagMs != null && mm.index > prevEnd) {
        const chunk0 = rest.slice(prevEnd, mm.index);
        pushDistributed(chars, chunk0, tagMs, tagMs);
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd, mm.index);
        pushDistributed(chars, chunk, prevMs, tagMs);
      }

      prevMs = tagMs;
      prevEnd = mm.index + mm[0].length;
    }

    if (prevMs != null) {
      const chunk = rest.slice(prevEnd);
      let endMs = nextLineMs;
      if (typeof endMs !== 'number') endMs = prevMs + 1500;
      if (endMs <= prevMs) endMs = prevMs + 200;
      pushDistributed(chars, chunk, prevMs, endMs);
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

// Dynamic.lrc形式かどうかを判定
const isDynamicLrcFormat = (text) => {
  if (!text) return false;
  // <00:00.00>形式のタグが含まれていればDynamic.lrc形式
  return /<\d+:\d{2}(?:\.\d{1,3})?>/.test(text);
};

const parseSubLRC = (lrc) => {
  // Dynamic.lrc形式の場合は専用パーサーを使用
  if (isDynamicLrcFormat(lrc)) {
    const dynLines = parseDynamicLrcForSub(lrc);
    if (dynLines && dynLines.length) {
      // dynamicLinesからLRC形式のlinesに変換
      const lines = dynLines.map(dl => ({
        time: (typeof dl.startTimeMs === 'number') ? dl.startTimeMs / 1000 : null,
        text: dl.text || '',
      }));
      // サブ用のdynamicLinesを保存
      duetSubDynamicLines = dynLines;
      return { lines, hasTs: true, dynamicLines: dynLines };
    }
  }

  // 通常のLRC形式
  duetSubDynamicLines = null;
  const { lines, hasTs } = parseLRCInternal(lrc);
  return { lines: Array.isArray(lines) ? lines : [], hasTs: !!hasTs, dynamicLines: null };
};

const mergeDuetLines = (mainLines, subLines) => {
  // タイムスタンプの許容誤差 (秒)
  const TIME_TOLERANCE = 0.5;

  const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');

  // サブ歌詞のタイムスタンプセットを作成（高速検索用）
  const subTimeSet = new Set();
  subLinesWithTime.forEach(sub => {
    // 許容誤差を考慮して、0.1秒刻みでキーを追加
    const baseMs = Math.round(sub.time * 10);
    for (let i = -5; i <= 5; i++) {
      subTimeSet.add(baseMs + i);
    }
  });

  // sub歌詞と時間が被るメイン歌詞を除外する
  // また、除外されたメイン歌詞のタイムスタンプを記録
  const excludedMainTimes = new Set();
  const filteredMain = (mainLines || []).filter(l => {
    if (typeof l?.time !== 'number') return true;
    // 時間が近似しているサブ歌詞があるかチェック
    const keyMs = Math.round(l.time * 10);
    const collision = subTimeSet.has(keyMs);
    if (collision) {
      excludedMainTimes.add(Math.round(l.time * 1000)); // ミリ秒精度で記録
    }
    return !collision;
  });

  // dynamicLinesからも除外されたメイン行に対応するものを除外
  // （グローバル変数dynamicLinesを直接変更せず、フィルタ用のセットを保存）
  _duetExcludedTimes = excludedMainTimes;

  _duetExcludedTimes = excludedMainTimes;

  _duetExcludedTimes = excludedMainTimes;

  _duetExcludedTimes = excludedMainTimes;

  const merged = [];
  filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
  (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

  merged.sort((a, b) => {
    const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
    const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;

    // 時間がほぼ同じ場合は、Left(メイン) -> Right(サブ) の順に並べる
    if (Math.abs(at - bt) < 0.05) {
      const ap = a.duetSide === 'right' ? 1 : 0;
      const bp = b.duetSide === 'right' ? 1 : 0;
      return ap - bp;
    }
    return at - bt;
  });

  return merged;
};

const mergeDuetLinesWithSimultaneousSupport = (mainLines, subLines) => {
  const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
  const excludedMainTimes = new Set();

  // Dynamic LRC（1文字同期）がある場合は5秒の許容幅+内容一致で重複判定
  // 通常LRCはタイムスタンプが精確なので完全一致（SAME_TIMESTAMP_TOLERANCE=0.05s）のみ重複とみなす
  const hasDynamicLrc = Array.isArray(dynamicLines) && dynamicLines.length > 0;
  const dedupeTimeTolerance = hasDynamicLrc ? 5.0 : SAME_TIMESTAMP_TOLERANCE;

  const filteredMain = (mainLines || []).filter((mainLine) => {
    if (typeof mainLine?.time !== 'number') return true;

    const mainText = normalizeLyricCompareTextStrict(mainLine.text);
    if (!mainText) return true;

    // dedupeTimeTolerance以内のタイムスタンプ差かつ同一テキストのサブ行があれば重複とみなしてメイン行を除外
    const duplicateSub = subLinesWithTime.find((subLine) => {
      if (!isSameTimestamp(mainLine.time, subLine.time, dedupeTimeTolerance)) return false;
      const subText = normalizeLyricCompareTextStrict(subLine.text);
      return !!subText && scoreLyricTextMatch(mainText, subText) >= 100;
    });
    if (duplicateSub) {
      excludedMainTimes.add(Math.round(mainLine.time * 1000));
      return false;
    }
    return true;
  });

  const merged = [];
  filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
  (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

  merged.sort((a, b) => {
    const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
    const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;

    if (isSameTimestamp(at, bt)) {
      const ap = a.duetSide === 'right' ? 1 : 0;
      const bp = b.duetSide === 'right' ? 1 : 0;
      return ap - bp;
    }
    return at - bt;
  });

  const deduped = [];
  for (const line of merged) {
    const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
    const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;
    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      continue;
    }
    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      continue;
    }

    if (duplicateIdx >= 0) {
      // 同内容の重複だけ落とす。別歌詞の同時進行は残す。
      if (prev?.duetSide === 'left' && line?.duetSide === 'right') {
        deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      }
      continue;
    }

    deduped.push(line);
  }

  return deduped;
};

const collapseCrossSideDuplicateLyrics = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return Array.isArray(lines) ? lines : [];

  const deduped = [];
  for (const line of lines) {
    const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
    const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;

    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      continue;
    }

    deduped.push(line);
  }

  return deduped;
};

const getDynamicLineForTime = (sec) => {
  if (!dynamicLines || !Array.isArray(dynamicLines) || !dynamicLines.length) return null;

  // デュエットモードで除外されたタイムスタンプかチェック
  const isDuetMode = document.body.classList.contains('ytm-duet-mode');
  if (isDuetMode && _duetExcludedTimes && _duetExcludedTimes.size > 0) {
    const secMs = Math.round(sec * 1000);
    // 許容誤差50ms以内で除外されたタイムスタンプをチェック
    for (let offset = -50; offset <= 50; offset += 10) {
      if (_duetExcludedTimes.has(secMs + offset)) {
        return null; // このタイムスタンプはsub.txtで上書きされているので無視
      }
    }
  }

  // マップキャッシュの再構築（参照が変わった時のみ）
  if (_dynMapSrc !== dynamicLines) {
    _dynMapSrc = dynamicLines;
    _dynMap = new Map();

    dynamicLines.forEach(dl => {
      let ms = null;
      if (typeof dl?.startTimeMs === 'number') {
        ms = dl.startTimeMs;
      } else if (typeof dl?.startTimeMs === 'string') {
        const n = Number(dl.startTimeMs);
        if (!Number.isNaN(n)) ms = n;
      } else if (Array.isArray(dl?.chars) && dl.chars.length) {
        const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
        if (ts.length) ms = Math.min(...ts);
      }

      if (typeof ms === 'number') {
        _dynMap.set(timeKey(ms / 1000), dl);
      }
    });
  }

  // 1. 完全一致トライ
  const exact = _dynMap?.get(timeKey(sec));
  if (exact) return exact;

  // 2. 近似値トライ (前後0.15秒)
  const TOLERANCE = 0.15;
  const found = dynamicLines.find(dl => {
    let startS = 0;
    if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
    else if (dl.time) startS = dl.time;
    return Math.abs(startS - sec) <= TOLERANCE;
  });

  return found || null;
};

// サブボーカル用のdynamicLine取得（sub.txtのDynamic.lrc対応）
let _subDynMapSrc = null;
let _subDynMap = null;

const getSubDynamicLineForTime = (sec) => {
  if (!duetSubDynamicLines || !Array.isArray(duetSubDynamicLines) || !duetSubDynamicLines.length) return null;

  // マップキャッシュの再構築（参照が変わった時のみ）
  if (_subDynMapSrc !== duetSubDynamicLines) {
    _subDynMapSrc = duetSubDynamicLines;
    _subDynMap = new Map();

    duetSubDynamicLines.forEach(dl => {
      let ms = null;
      if (typeof dl?.startTimeMs === 'number') {
        ms = dl.startTimeMs;
      } else if (typeof dl?.startTimeMs === 'string') {
        const n = Number(dl.startTimeMs);
        if (!Number.isNaN(n)) ms = n;
      } else if (Array.isArray(dl?.chars) && dl.chars.length) {
        const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
        if (ts.length) ms = Math.min(...ts);
      }

      if (typeof ms === 'number') {
        _subDynMap.set(timeKey(ms / 1000), dl);
      }
    });
  }

  // 1. 完全一致トライ
  const exact = _subDynMap?.get(timeKey(sec));
  if (exact) return exact;

  // 2. 近似値トライ (前後0.15秒)
  const TOLERANCE = 0.15;
  const found = duetSubDynamicLines.find(dl => {
    let startS = 0;
    if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
    else if (dl.time) startS = dl.time;
    return Math.abs(startS - sec) <= TOLERANCE;
  });

  return found || null;
};

// 歌詞ソースの優先設定。'ytm' か 'lrchub' の2択で、どちらも他ソースへフォールバックする。
// 旧バージョンの 'standard' / 'ytm_only' / 'lrclib' もここで吸収する。
// 歌詞ソース設定は「YTM優先 / LRCHub優先」の2択になった。
// それ以前の保存値をどう引き継ぐかの対応表:
//   ytm / ytm_only … そのまま YTM優先
//   lrchub         … 明示的に LRCHub を選んだ意思とみなして尊重する
//   standard       … 旧デフォルト。特に選んでいないので、新しい既定値へ
//   lrclib         … 旧「LRCLIB優先」。その選択肢自体が無くなったので既定値へ
//   未設定 / 不明   … 既定値
// 既定値を YTM優先 にしているのは、videoId で曲を一意に特定できる YTM の方が
// 誤マッチが起きず、タイミングも配信元のデータそのままで正確なため。
// 背景の明るさの既定値。CSS 側の var() のフォールバックとも揃えること。
const DEFAULT_BG_BRIGHTNESS = 0.65;

const normalizeSourceMode = (value) => (
  (value === 'ytm' || value === 'ytm_only') ? 'ytm'
    : (value === 'lrchub') ? 'lrchub'
      : 'ytm'
);

// いま表示している歌詞が「YTM優先」設定によって選ばれたものか。
// true の間は、あとから届く LRCHub の高品質差し替えを受け付けない
// (手動で候補を選んだときと同じ扱い)。
let currentLyricsFromPreferredYtm = false;
// Immersion が開いていて再生位置を継続的に追えていたか。
// 連続再生の offset 補正を適用してよいかの判断に使う。
let _wasTrackingPlayback = false;

let animatedCaptionData = null;
let animatedCaptionFrameKey = '';

const isTimedTextXml = (text) => (
  typeof text === 'string' &&
  /<timedtext\b/i.test(text) &&
  /<body\b/i.test(text) &&
  /<p\b/i.test(text)
);

const timedTextNumberAttr = (el, name, fallback = null) => {
  const raw = el ? el.getAttribute(name) : null;
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeTimedTextCaption = (text) => (
  String(text || '')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
);

const parseTimedTextStyleMap = (root, tagName) => {
  const out = new Map();
  root.querySelectorAll(tagName).forEach((el) => {
    const id = el.getAttribute('id');
    if (!id) return;
    const attrs = {};
    Array.from(el.attributes || []).forEach(attr => {
      attrs[attr.name] = attr.value;
    });
    out.set(String(id), attrs);
  });
  return out;
};

const extractTimedTextSegments = (node, inheritedPenId = '') => {
  const segments = [];
  const walk = (current, penId) => {
    Array.from(current.childNodes || []).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = String(child.nodeValue || '').replace(/\u200B/g, '').replace(/\uFEFF/g, '');
        if (text.trim()) segments.push({ text, penId });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const nextPenId = child.getAttribute('p') || penId;
      walk(child, nextPenId);
    });
  };
  walk(node, inheritedPenId);
  return segments;
};

const buildTimedTextPlainLines = (events) => {
  const lines = [];
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  events.forEach((event) => {
    const text = normalizeTimedTextCaption(event.text);
    const norm = normalize(text);
    if (!norm) return;

    const last = lines[lines.length - 1];
    if (last && event.time <= (last.endTime || last.time) + 0.35) {
      const lastNorm = normalize(last.text);
      if (norm === lastNorm) return;
      if (norm.includes(lastNorm) || lastNorm.includes(norm)) {
        if (norm.length >= lastNorm.length) {
          last.time = event.time;
          last.endTime = event.endTime;
          last.text = text;
        }
        return;
      }
    }

    lines.push({
      time: event.time,
      endTime: event.endTime,
      text,
    });
  });

  return lines.map(({ time, text }) => ({ time, text }));
};

const parseTimedTextAnimation = (xmlText) => {
  if (!isTimedTextXml(xmlText) || typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const root = doc.querySelector('timedtext');
    if (!root) return null;

    const pens = parseTimedTextStyleMap(root, 'pen');
    const windows = parseTimedTextStyleMap(root, 'wp');
    const windowStyles = parseTimedTextStyleMap(root, 'ws');
    const events = [];

    root.querySelectorAll('body > p').forEach((p, index) => {
      const startMs = timedTextNumberAttr(p, 't', null);
      const durationMs = timedTextNumberAttr(p, 'd', 0);
      if (startMs === null) return;

      const penId = p.getAttribute('p') || '';
      const wpId = p.getAttribute('wp') || '';
      const wsId = p.getAttribute('ws') || '';
      const segments = extractTimedTextSegments(p, penId);
      const text = normalizeTimedTextCaption(segments.map(s => s.text).join(''));
      if (!text) return;

      events.push({
        id: index,
        time: startMs / 1000,
        endTime: (startMs + Math.max(60, durationMs || 0)) / 1000,
        startMs,
        endMs: startMs + Math.max(60, durationMs || 0),
        durationMs,
        text,
        segments: segments.length ? segments : [{ text, penId }],
        penId,
        wpId,
        wsId,
        pen: pens.get(String(penId)) || {},
        window: windows.get(String(wpId)) || {},
        windowStyle: windowStyles.get(String(wsId)) || {},
      });
    });

    if (!events.length) return null;
    events.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
    return {
      pens,
      windows,
      windowStyles,
      events,
      plainLines: buildTimedTextPlainLines(events),
    };
  } catch (e) {
    console.warn('TimedText parse failed', e);
    return null;
  }
};

const getTimedTextAnchorTransform = (anchorPoint) => {
  const ap = Number(anchorPoint);
  const map = {
    0: 'translate(0, 0)',
    1: 'translate(-50%, 0)',
    2: 'translate(-100%, 0)',
    3: 'translate(0, -50%)',
    4: 'translate(-50%, -50%)',
    5: 'translate(-100%, -50%)',
    6: 'translate(0, -100%)',
    7: 'translate(-50%, -100%)',
    8: 'translate(-100%, -100%)',
  };
  return map[ap] || 'translate(-50%, -50%)';
};

const getTimedTextAlign = (windowStyle) => {
  const ju = Number(windowStyle?.ju);
  if (ju === 0) return 'left';
  if (ju === 2) return 'right';
  return 'center';
};

const getTimedTextScaledFontSize = (rawSize, fallback = 140) => {
  const numeric = Number(rawSize);
  const sourceSize = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(20, Math.min(98, sourceSize * 0.30));
};

const getAnimatedCaptionFontScale = () => {
  const fallback = 3.4;
  try {
    if (!ui?.lyrics || typeof getComputedStyle !== 'function') return fallback;
    const raw = getComputedStyle(ui.lyrics).getPropertyValue('--ytm-animated-font-scale');
    const value = Number(String(raw || '').trim());
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return value;
  } catch {
    return fallback;
  }
};

const getTimedTextCueStyle = (event) => {
  const pen = event.pen || {};
  const win = event.window || {};
  const left = timedTextNumberAttr({ getAttribute: n => win[n] }, 'ah', 50);
  const top = timedTextNumberAttr({ getAttribute: n => win[n] }, 'av', 80);
  const scale = getAnimatedCaptionFontScale();
  const baseFontSize = getTimedTextScaledFontSize(pen.sz, 140);
  const fontSize = baseFontSize * scale;
  const opacity = pen.fo !== undefined ? Math.max(0, Math.min(1, Number(pen.fo) / 254)) : 1;
  const color = /^#[0-9a-f]{6}$/i.test(pen.fc || '') ? pen.fc : '#FEFEFE';
  const edgeColor = /^#[0-9a-f]{6}$/i.test(pen.ec || '') ? pen.ec : '#000000';
  const textShadow = pen.ec
    ? `0 0 2px ${edgeColor}, 0 2px 8px rgba(0,0,0,.72)`
    : '0 2px 10px rgba(0,0,0,.72)';

  return [
    `left:${left}%`,
    `top:${top}%`,
    `transform:${getTimedTextAnchorTransform(win.ap)}`,
    `--ytm-animated-base-font-size:${baseFontSize}px`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `opacity:${opacity}`,
    `text-shadow:${textShadow}`,
    `text-align:${getTimedTextAlign(event.windowStyle)}`,
    pen.i === '1' ? 'font-style:italic' : '',
  ].filter(Boolean).join(';');
};

const getTimedTextSegmentHtml = (event) => (
  ((segments, scale) => segments.map(segment => {
    const pen = animatedCaptionData?.pens?.get(String(segment.penId || event.penId)) || event.pen || {};
    const color = /^#[0-9a-f]{6}$/i.test(pen.fc || '') ? pen.fc : '';
    const opacity = pen.fo !== undefined ? Math.max(0, Math.min(1, Number(pen.fo) / 254)) : null;
    const size = Number(pen.sz || 0);
    const style = [
      color ? `color:${color}` : '',
      opacity !== null ? `opacity:${opacity}` : '',
      size ? `font-size:${(getTimedTextScaledFontSize(size, size) * scale).toFixed(2)}px` : '',
      pen.i === '1' ? 'font-style:italic' : '',
    ].filter(Boolean).join(';');
    return `<span${style ? ` style="${style}"` : ''}>${escapeHtml(segment.text)}</span>`;
  }).join(''))(event.segments || [{ text: event.text, penId: event.penId }], getAnimatedCaptionFontScale())
);

function renderAnimatedTimedText(captionData) {
  if (!ui.lyrics || !captionData) return;
  animatedCaptionData = captionData;
  animatedCaptionFrameKey = '';
  // innerHTML差し替えによるscrollイベントをユーザースクロール扱いにしない
  suppressUserScrollDetection(500);
  hasTimestamp = true;
  document.body.classList.remove('ytm-no-lyrics', 'ytm-no-timestamp');
  document.body.classList.add('ytm-has-timestamp', 'ytm-animated-caption-mode');
  ui.lyrics.innerHTML = '<div class="ytm-animated-caption-stage" aria-live="off"></div>';
  const now = getCurrentPlaybackTimeSec();
  updateAnimatedCaptionStage(typeof now === 'number' ? now : 0, true);
}

function updateAnimatedCaptionStage(currentTime, force = false) {
  if (!animatedCaptionData || !ui.lyrics) return;
  const stage = ui.lyrics.querySelector('.ytm-animated-caption-stage');
  if (!stage) return;
  const tMs = Math.max(0, currentTime * 1000);
  const active = animatedCaptionData.events
    .filter(event => tMs + 40 >= event.startMs && tMs <= event.endMs + 40)
    .slice(-24);
  const key = active.map(event => `${event.id}:${event.startMs}:${event.endMs}`).join('|');
  if (!force && key === animatedCaptionFrameKey) return;
  animatedCaptionFrameKey = key;
  stage.innerHTML = active.map(event => (
    `<div class="ytm-animated-caption-cue" style="${getTimedTextCueStyle(event)}">${getTimedTextSegmentHtml(event)}</div>`
  )).join('');
}

function setupMovieMode() {
  const resizeObserver = new ResizeObserver(() => {
    window.dispatchEvent(new Event('resize'));
  });
  const targetWrapper = document.getElementById("ytm-custom-wrapper");
  if (targetWrapper) {
    resizeObserver.observe(targetWrapper);
  } else {
    resizeObserver.observe(document.body);
  }

  const check = () => {
    const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");
    const target = document.querySelector("#ytm-custom-wrapper");
    const switcher = document.querySelector("ytmusic-av-toggle");
    const switcherTarget = document.querySelector("#ytm-custom-info-area");

    if (!video || !target || !switcher || !switcherTarget) {
      setTimeout(check, 300);
      return;
    }

    movieObserver = observerMovieModeSetup();
  };
  check();
};
// ============================================================
// ■ 未解決の不具合: Immersion ON のとき「曲 / 動画」の切り替えが効かない
//   (2026-08-15 調査。次に触る人向けのメモ)
//
// 症状
//   Immersion ON では「動画」を押しても playback-mode が ATV_PREFERRED の
//   まま変わらない。OFF にすると、まったく同じ click() で即座に
//   OMV_PREFERRED になり URL も MV の videoId へ変わる。
//   つまり YTM 側は正常で、こちらが何かを邪魔している。
//
// これは以前からある不具合
//   bringSwitcherOnly() は 2026-03-23 から一度も変わっていない
//   (git log -S"bringSwitcherOnly" で確認済み)。
//   コードが変わっていないのに動かなくなったので、原因は YTM 側の
//   実装変更。同時期に、キューの ytmusic-player-queue-item から
//   a 要素が消えて videoId が取れなくなる変更も入っている
//   (queue-manager.js の _buildQueueIndex 参照)。同じ刷新の一部と思われる。
//
// 唯一つかんだ手がかり
//   #ytm-custom-info-area ごと DOM から切り離した状態でクリックすると
//   切り替えが成立した。この時 handleMutation → changeUIWithMovieMode 内の
//   customSwitcherParent.appendChild(switcher) が例外で止まっている。
//   ただし video 要素の移動はその前に走っているので、
//   「動画要素の移動」ではなく「切り替え中の switcher の移動」が
//   引き金である可能性が高い。
//
// 試して駄目だった案 (どれも切り替わらず)
//   1. switcher を動かさず、自前の代理ボタンから本体を click() する
//   2. 本体の visibility:hidden を打ち消してから click() する
//   3. プレイヤーページの非表示と ytm-custom-layout を外してから click() する
//   4. handleMutation の DOM 組み替えを 600ms 遅らせる
//   1 が駄目だった点が上の仮説と噛み合っておらず、まだ何か見落としがある。
//
// 次に調べるとよさそうなこと
//   - YTM 側のクリックハンドラが実際に走っているか (イベントリスナの確認)
//   - ytmusic-player-page の内部状態 (player-page-open / player-ui-state) が
//     切り替え処理の前提になっていないか
//   - Immersion OFF の復帰処理 changeIModeUIWithMovieMode(false) が
//     具体的に何を戻しているか。そこに必要条件が含まれているはず
//
// UI は今のところ従来どおり (トグルは表示したまま) にしてある。
// 壊れているのを確認できたのが 2 環境だけで、YTM の段階的な配信で
// まだ動く利用者が居る可能性を否定できないため。
// 広く壊れていると分かったら、Immersion 中は非表示にするのが親切。
// ============================================================
function bringSwitcherOnly() {
  const switcher = document.querySelector("ytmusic-av-toggle");
  const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
  customSwitcherParent.appendChild(switcher);
}
function changeIModeUIWithMovieMode(mode) {
  if (!mode) {
    moviemode = null;
    if (movieObserver) movieObserver.stop();
    movieObserver = null;
    const switcher = document.querySelector("ytmusic-av-toggle");
    const video = document.querySelector("ytmusic-player#player");
    const originParent = document.querySelector("div#main-panel");
    const originSwitcherTarget = originParent.children[1];
    const originTarget = originParent.children[2];
    if (!originParent.contains(video)) {
      originParent.insertBefore(video, originTarget);
    }
    if (!originParent.contains(switcher)) {
      originSwitcherTarget.appendChild(switcher);
    }
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
  else {
    if (movieObserver) movieObserver.stop();
    movieObserver = null;
    movieObserver = observerMovieModeSetup();
  }
}
const observerMovieModeSetup = () => {
  const switcher = document.querySelector("ytmusic-av-toggle");
  if (!switcher) return null;

  if (movieObserver) {
    movieObserver.stop();
    movieObserver = null;
  }

  let changed;
  let classTargets = [];

  const handleMutation = () => {
    const mode = switcher.getAttribute("playback-mode");
    const newMoviemode = (mode === "OMV_PREFERRED") ? true : false;

    if (moviemode !== newMoviemode) {
      changed = true;
    } else {
      changed = false;
    }

    moviemode = newMoviemode;

    classTargets = [];
    const wrapper = document.querySelector("#ytm-custom-wrapper");
    if (wrapper instanceof Element) {
      classTargets.push(...wrapper.querySelectorAll("*"));
    }
    const pusher = (element) => {
      if (element instanceof Element) classTargets.push(element);
    };
    const playerBar = document.querySelector("ytmusic-player-bar");
    pusher(playerBar);
    pusher(switcher);
    const video = document.querySelector("ytmusic-player#player");
    pusher(video);
    const navBar = document.querySelector("ytmusic-nav-bar");
    pusher(navBar);

    classTargets.forEach(element => {
      if (moviemode) {
        element.classList.add("moviemode");
      } else {
        element.classList.remove("moviemode");
      }
    });

    changeUIWithMovieMode(changed);
  };

  handleMutation();
  bringSwitcherOnly();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "playback-mode") {
        handleMutation();
      }
    });
  });

  observer.observe(switcher, { attributes: true });

  movieObserver = {
    stop: () => {
      observer.disconnect();
      movieObserver = null;
    }
  };

  return movieObserver;
};
function changeUIWithMovieMode(changed) {
  if (!changed || changed === null) return;
  const originParent = document.querySelector("div#main-panel");
  const originTarget = originParent.children[2];
  const customParent = document.querySelector("#ytm-custom-wrapper");
  const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
  const switcher = document.querySelector("ytmusic-av-toggle");
  const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");

  if (moviemode) {
    customParent.prepend(video);
    customSwitcherParent.appendChild(switcher);
  }
  else {
    if (!originParent.contains(video)) {
      originParent.insertBefore(video, originTarget);
    }
  }
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 100);
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 300);
}
function isYTMPremiumUser() {
  const switcher = document.querySelector("ytmusic-av-toggle");
  const requireSignIn = !!document.querySelector('ytmusic-guide-signin-promo-renderer');
  const primarySection = document.querySelector('#mini-guide ytmusic-guide-section-renderer[is-primary] div#items');
  const notPremium = primarySection ? primarySection.childNodes.length >= 4 : false;
  if (!requireSignIn && !notPremium) {
    if (switcher) switcher.classList.remove('notpremium');
  }
  else {
    if (switcher) switcher.classList.add('notpremium');
  }
  return !requireSignIn || !notPremium;
}

function preferLyricsDefault(targetKey, attempt = 0) {
  if (!targetKey || currentKey !== targetKey) return;

  const switcher = document.querySelector("ytmusic-av-toggle");
  if (!switcher) {
    if (attempt < 10) setTimeout(() => preferLyricsDefault(targetKey, attempt + 1), 300);
    return;
  }

  const mode = switcher.getAttribute("playback-mode");
  if (mode === "ATV_PREFERRED") return;
  if (mode && mode !== "OMV_PREFERRED") return;

  const songBtn = switcher.querySelector('.song-button.ytmusic-av-toggle, .song-button');
  if (!songBtn) {
    if (attempt < 10) setTimeout(() => preferLyricsDefault(targetKey, attempt + 1), 300);
    return;
  }

  try {
    songBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    if (typeof songBtn.click === 'function') songBtn.click();
  } catch (e) {
    console.warn('Failed to switch default playback mode to lyrics', e);
  }

  if (attempt < 10) {
    setTimeout(() => {
      if (currentKey !== targetKey) return;
      const latestMode = switcher.getAttribute("playback-mode");
      if (latestMode !== "ATV_PREFERRED") {
        preferLyricsDefault(targetKey, attempt + 1);
      }
    }, 250);
  }
}
const hoverTimeInfoSetup = () => {
  const timeToSeconds = (str) => {
    const [m, s] = str.split(":").map(Number);
    return m * 60 + s;
  };
  const removeHoverTimeInfo = () => {
    let attempts = 0;
    const interval = setInterval(() => {
      const info = document.querySelector('#hover-time-info');
      if (info) {
        info.remove();
        clearInterval(interval);
      } else {
        attempts++;
        if (attempts > 30) {
          clearInterval(interval);
        }
      }
    }, 1000);
  };
  const createHoverTimeInfo = () => {
    let info = document.querySelector('#hover-time-info-new');
    if (!info) {
      info = document.createElement('span');
      info.id = 'hover-time-info-new';
      info.style.display = 'none';
      info.textContent = '0:00';
      document.body.appendChild(info);
    }
  };
  const adjustHoverTimeInfoPosition = () => {
    let attempts = 0;
    const interval = setInterval(() => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const sliderBar = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      );
      const slider = sliderBar?.parentElement?.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');

      if (slider && info && progresshandle && playerBar) {
        const refresh = () => {
          const onMove = (e) => {
            const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
            const infoLeft = e.clientX;
            const relativeMouseX = e.clientX - marginLeft;
            const timeinfo = document.querySelector('#left-controls > span');
            if (!timeinfo) return;
            const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
            const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
            const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
            const hoverTimeString = `${String(Math.floor(hoverTimeSeconds / 60))}:${String(hoverTimeSeconds % 60).padStart(2, '0')}`;
            info.style.display = 'block';
            info.style.left = `${infoLeft}px`;
            info.textContent = hoverTimeString;
          };
          const hide = () => {
            info.style.display = 'none';
          };
          slider.addEventListener('mousemove', onMove);
          slider.addEventListener('mouseout', hide);
          progresshandle.addEventListener('mousemove', onMove);
          progresshandle.addEventListener('mouseout', hide);
        };
        refresh();
        clearInterval(interval);
      } else {
        attempts++;
        if (attempts > 60) {
          clearInterval(interval);
        }
      }
    }, 1000);
  };
  removeHoverTimeInfo();
  createHoverTimeInfo();
  adjustHoverTimeInfoPosition();
};

const parseLRCNoFlag = (lrc) => {
  return parseLRCInternal(lrc).lines;
};

const normalizeStr = (s) => (s || '').replace(/\s+/g, '').trim();

const isMixedLang = (s) => {
  if (!s) return false;
  const hasLatin = /[A-Za-z]/.test(s);
  const hasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
  const hasHangul = /[\uAC00-\uD7AF]/.test(s);
  let kinds = 0;
  if (hasLatin) kinds++;
  if (hasCJK) kinds++;
  if (hasHangul) kinds++;
  return kinds >= 2;
};

const detectCharScript = (ch) => {
  if (!ch) return 'OTHER';
  if (/[A-Za-z]/.test(ch)) return 'LATIN';
  if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) return 'CJK';
  if (/[\uAC00-\uD7AF]/.test(ch)) return 'HANGUL';
  return 'OTHER';
};

const segmentByScript = (s) => {
  const result = [];
  if (!s) return result;
  let currentScript = null;
  let buf = '';
  for (const ch of s) {
    const script = detectCharScript(ch);
    if (currentScript === null) {
      currentScript = script;
      buf = ch;
    } else if (script === currentScript) {
      buf += ch;
    } else {
      result.push({ script: currentScript, text: buf });
      currentScript = script;
      buf = ch;
    }
  }
  if (buf) {
    result.push({ script: currentScript, text: buf });
  }
  return result;
};

const shouldTranslateSegment = (script, langCode) => {
  const lang = (langCode || '').toLowerCase();
  if (script === 'OTHER') return false;
  switch (lang) {
    case 'ja': return script === 'LATIN' || script === 'HANGUL';
    case 'en': return script === 'CJK' || script === 'HANGUL';
    case 'ko': return script === 'LATIN' || script === 'CJK';
    default: return script !== 'LATIN';
  }
};

const translateMixedSegments = async (lines, indexes, langCode, targetLang) => {
  if (!config.deepLKey) return null;
  try {
    const segmentsToTranslate = [];
    const perLineSegments = {};
    indexes.forEach(idx => {
      const line = lines[idx];
      const text = (line && line.text) || '';
      const segs = segmentByScript(text);
      const segMeta = [];
      segs.forEach(seg => {
        if (shouldTranslateSegment(seg.script, langCode)) {
          const translateIndex = segmentsToTranslate.length;
          segmentsToTranslate.push(seg.text);
          segMeta.push({ original: seg.text, translateIndex });
        } else {
          segMeta.push({ original: seg.text, translateIndex: null });
        }
      });
      perLineSegments[idx] = segMeta;
    });
    if (!segmentsToTranslate.length) return null;
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE', payload: { text: segmentsToTranslate, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } },
        resolve
      );
    });
    if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== segmentsToTranslate.length) {
      return null;
    }
    const segTranslations = res.translations.map(t => t.text || '');
    const result = {};
    Object.keys(perLineSegments).forEach(key => {
      const lineIdx = Number(key);
      const segMeta = perLineSegments[lineIdx];
      let rebuilt = '';
      segMeta.forEach(seg => {
        if (seg.translateIndex == null) {
          rebuilt += seg.original;
        } else {
          rebuilt += segTranslations[seg.translateIndex] ?? seg.original;
        }
      });
      result[lineIdx] = rebuilt;
    });
    return result;
  } catch (e) {
    console.error('DeepL mixed-line fallback failed', e);
    return null;
  }
};

const dedupePrimarySecondary = (lines) => {
  if (!Array.isArray(lines)) return lines;
  lines.forEach(l => {
    if (!l.translation) return;
    const src = normalizeStr(l.text);
    const trn = normalizeStr(l.translation);
    if (src === trn && !isMixedLang(l.text)) {
      delete l.translation;
    }
  });
  return lines;
};

const translateTo = async (lines, langCode) => {
  if (!config.deepLKey || !lines.length) return null;
  const targetLang = resolveDeepLTargetLang(langCode);
  try {
    const baseTexts = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '');
    // 空行は翻訳APIへ送らず、行数だけ保持してタイムスタンプのズレを防ぐ
    const mapIdx = [];
    const requestTexts = [];
    for (let i = 0; i < baseTexts.length; i++) {
      const t = baseTexts[i];
      if ((t || '').trim()) {
        mapIdx.push(i);
        requestTexts.push(t);
      }
    }

    let translated = new Array(lines.length).fill('');

    if (requestTexts.length) {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text: requestTexts, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } },
          resolve
        );
      });

      if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== requestTexts.length) {
        return null;
      }

      for (let i = 0; i < mapIdx.length; i++) {
        const tr = res.translations[i];
        translated[mapIdx[i]] = (tr && tr.text) ? tr.text : '';
      }
    }
    const fallbackIndexes = [];
    for (let i = 0; i < lines.length; i++) {
      const src = baseTexts[i];
      const trn = translated[i];
      if (!src) continue;
      if (normalizeStr(src) === normalizeStr(trn) && isMixedLang(src)) {
        fallbackIndexes.push(i);
      }
    }
    if (fallbackIndexes.length) {
      const mixedFallback = await translateMixedSegments(lines, fallbackIndexes, langCode, targetLang);
      if (mixedFallback) {
        fallbackIndexes.forEach(i => {
          if (mixedFallback[i]) translated[i] = mixedFallback[i];
        });
      }
    }
    return translated;
  } catch (e) {
    console.error('DeepL failed', e);
  }
  return null;
};


const getMetadata = () => {
  // Prefer MediaSession metadata (most accurate)
  if (navigator.mediaSession?.metadata) {
    const { title, artist, album, artwork } = navigator.mediaSession.metadata;
    return {
      title: (title || '').toString(),
      artist: (artist || '').toString(),
      album: (album || '').toString(),
      src: Array.isArray(artwork) && artwork.length ? artwork[artwork.length - 1].src : null
    };
  }

  // Fallback: read from player bar
  const tEl = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
  const aEl = document.querySelector('.byline.style-scope.ytmusic-player-bar');
  if (!(tEl && aEl)) return null;

  const parts = (aEl.textContent || '')
    .split('•')
    .map(s => (s || '').trim())
    .filter(Boolean);

  return {
    title: (tEl.textContent || '').trim(),
    artist: parts[0] || '',
    album: parts[1] || '',
    src: null
  };
};


const extractVideoIdFromHref = (href) => {
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    const vid = url.searchParams.get('v');
    if (vid) return vid;
    if (url.hostname.includes('youtu.be')) {
      return (url.pathname || '').split('/').filter(Boolean)[0] || null;
    }
  } catch (e) { }
  return null;
};

const getCurrentVideoIdFromDom = () => {
  const selectors = [
    'ytmusic-player-bar yt-formatted-string.title a[href*="watch"]',
    'ytmusic-player-bar a[href*="watch?v="]'
  ];

  for (const selector of selectors) {
    const link = document.querySelector(selector);
    const vid = extractVideoIdFromHref(link && (link.href || link.getAttribute('href')));
    if (vid) return vid;
  }
  return null;
};

const getCurrentVideoUrl = () => {
  try {
    const domVid = getCurrentVideoIdFromDom();
    if (domVid) return `https://youtu.be/${domVid}`;

    const url = new URL(location.href);
    const vid = url.searchParams.get('v');
    return vid ? `https://youtu.be/${vid}` : location.href;
  } catch (e) {
    console.warn('Failed to get current video url', e);
    return '';
  }
};

const getCurrentVideoId = () => {
  try {
    const domVid = getCurrentVideoIdFromDom();
    if (domVid) return domVid;

    const url = new URL(location.href);
    return url.searchParams.get('v');
  } catch (e) {
    return null;
  }
};

// === BG からの後追いメタ更新（遅い方待ちをやめた時用）===
// Metadata can arrive after lyrics; refresh related UI when it does.
chrome.runtime.onMessage.addListener((msg) => {
  try {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'LYRICS_DATA_UPDATE') {
      void applyLateLyricsUpgrade(msg.payload || {}).catch((error) => {
        console.warn('[YTM] Failed to apply late LRCHub lyrics:', error);
      });
      return;
    }
    if (msg.type !== 'LYRICS_META_UPDATE') return;
    const p = msg.payload || {};
    const curVid = getCurrentVideoId();
    if (p.video_id && curVid && p.video_id !== curVid) return;

    if (Array.isArray(p.candidates)) lyricsCandidates = p.candidates;
    if (p.config !== undefined) lyricsConfig = p.config;
    if (Array.isArray(p.requests)) lyricsRequests = p.requests;
    syncLyricsLockState();

    // duet: sub lyrics can arrive later
    if (typeof p.subLyrics === 'string') {
      duetSubLyricsRaw = p.subLyrics;
      // re-render with same raw lyrics to avoid showing duplicate left+right lines
      if (lastRawLyricsText && typeof lastRawLyricsText === 'string') {
        applyLyricsText(lastRawLyricsText);
      }
    }

    // dynamic: char-timed lines can arrive later even if lyrics came from API
    if (Array.isArray(p.dynamicLines) && p.dynamicLines.length) {
      dynamicLines = p.dynamicLines;
      // re-render to attach per-char spans while keeping current lines/translations
      if (Array.isArray(lyricsData) && lyricsData.length) {
        renderLyrics(lyricsData);
      }
    }

    // candidates/config が更新されたらメニューを再描画
    const incomingMeaningData = normalizeMeaningPayloadLocal(p);
    if (incomingMeaningData) {
      setLyricsMeaningData(incomingMeaningData);
      persistMeaningDataToCurrentCache().catch(() => { });
      if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
    }

    refreshCandidateMenu();
    refreshLockMenu();
  } catch (e) {
    // ignore
  }
});

const createEl = (tag, id, cls, html) => {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls) el.className = cls;
  if (html !== undefined && html !== null) el.innerHTML = html;
  return el;
};

const showToast = (text) => {
  if (!text) return;
  let el = document.getElementById('ytm-toast');
  if (!el) {
    el = createEl('div', 'ytm-toast', '', '');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 5000);
};

let fallbackToastTimer = null;
let lyricsCacheWriteQueue = Promise.resolve();

function enqueueLyricsCacheWrite(key, createValue, isCurrent) {
  const task = lyricsCacheWriteQueue
    .catch(() => undefined)
    .then(async () => {
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      const value = typeof createValue === 'function' ? await createValue() : createValue;
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      await storage.set(key, value);
      return true;
    });
  lyricsCacheWriteQueue = task.then(() => undefined, () => undefined);
  return task;
}

function hideFallbackNotice() {
  if (fallbackToastTimer) clearTimeout(fallbackToastTimer);
  fallbackToastTimer = null;
  const el = document.getElementById('ytm-fallback-toast');
  if (el) el.classList.remove('visible');
}

function showFallbackNotice() {
  let el = document.getElementById('ytm-fallback-toast');
  if (!el) {
    el = createEl('div', 'ytm-fallback-toast', '', 'LrcLib の歌詞を一時表示しています');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.classList.add('visible');
  if (fallbackToastTimer) clearTimeout(fallbackToastTimer);
  fallbackToastTimer = setTimeout(() => {
    fallbackToastTimer = null;
    el.classList.remove('visible');
  }, 4500);
}

function updateLyricsSourceState(payload, notify = true) {
  currentLyricsSource = String(payload?.lyricsSource || payload?.source || '').trim().toLowerCase() || null;
  isFallbackLyrics = !!payload?.fallbackUsed &&
    currentLyricsSource === 'lrclib' &&
    !!config.useLrcLibFallback &&
    (config.lyricSourceMode || 'standard') === 'standard';

  if (isFallbackLyrics && notify) showFallbackNotice();
  else if (!isFallbackLyrics) hideFallbackNotice();
}

const hasCharacterSyncedLines = (value) => (
  Array.isArray(value) && value.some(line => (
    Array.isArray(line?.chars) &&
    line.chars.some(char => {
      const hasText = [char?.c, char?.char, char?.text, char?.caption, char?.value]
        .some(text => String(text ?? '').length > 0);
      const hasTime = [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .some(time => time !== null && time !== undefined &&
          !(typeof time === 'string' && !time.trim()) && Number.isFinite(Number(time)));
      return hasText && hasTime;
    })
  ))
);

const selectLyricsPayload = (payload) => {
  const lyrics = typeof payload?.lyrics === 'string' ? payload.lyrics : '';
  const animatedLyrics = typeof payload?.animated_lyrics === 'string' ? payload.animated_lyrics : '';
  const nextDynamicLines = hasCharacterSyncedLines(payload?.dynamicLines)
    ? payload.dynamicLines
    : null;
  const useAnimated = !nextDynamicLines && config.useAnimatedCaptions && animatedLyrics.trim();
  const quality = nextDynamicLines
    ? 4
    : (useAnimated
      ? 3
      : (/\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? 2 : (lyrics.trim() ? 1 : 0)));
  return {
    text: useAnimated ? animatedLyrics : lyrics,
    lyrics,
    animatedLyrics,
    dynamicLines: nextDynamicLines,
    quality,
  };
};

async function applyLateLyricsUpgrade(payload) {
  // 'ytm' も受ける。YouTube Music 側は時刻なしの歌詞を先に返しておいて、
  // 裏で同期版を探し当てたらここで差し替えにくる。
  const lateSource = payload && payload.lyricsSource;
  if (!payload || (lateSource !== 'lrchub' && lateSource !== 'ytm') || !payload.success) return;
  if (!currentKey || payload.track_key !== currentKey) return;
  if (!activeLyricsRequestId || payload.request_id !== activeLyricsRequestId) return;
  if (payload.video_id && currentLyricsVideoId && payload.video_id !== currentLyricsVideoId) return;
  // A manual candidate choice is an explicit user decision; never replace it
  // with a request that started before that choice.
  if (selectedCandidateId || currentLyricsResultPriority >= 3) return;
  // YTM優先で選ばれた歌詞は、ユーザーの明示的な選択と同じ扱い。
  // 再生中に LRCHub が割り込んで差し替えるのを防ぐ。
  // typeof で見ているのは、この関数がテストで単体切り出しされ、
  // 外側の変数が存在しない文脈で実行されることがあるため。
  if (typeof currentLyricsFromPreferredYtm !== 'undefined' && currentLyricsFromPreferredYtm) return;

  const selected = selectLyricsPayload(payload);
  if (!selected.text || !selected.text.trim()) return;
  if (currentLyricsResultPriority === 2 && selected.quality <= currentLyricsQuality) return;
  const requestId = activeLyricsRequestId;
  const targetKey = currentKey;
  const targetVideoId = currentLyricsVideoId;
  currentLyricsResultPriority = 2;
  currentLyricsQuality = selected.quality;

  lyricsCandidates = Array.isArray(payload.candidates) ? payload.candidates : null;
  lyricsRequests = Array.isArray(payload.requests) ? payload.requests : null;
  lyricsConfig = payload.config || null;
  lyricsTranslationMap = {
    ...normalizeTranslationsToLrcMapLocal(payload.translations),
    ...normalizeTranslationsToLrcMapLocal(payload.lrcMap),
  };
  dynamicLines = selected.dynamicLines;
  duetSubLyricsRaw = typeof payload.subLyrics === 'string' ? payload.subLyrics : '';
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  selectedCandidateId = null;
  setLyricsMeaningData(payload);
  syncLyricsLockState();
  refreshCandidateMenu();
  refreshLockMenu();

  const isCurrent = () => (
    requestId === activeLyricsRequestId &&
    targetKey === currentKey &&
    targetVideoId === currentLyricsVideoId &&
    currentLyricsResultPriority === 2 &&
    currentLyricsQuality === selected.quality
  );
  void requestSingerMetadataForLyrics(
    payload.record_id,
    selected.lyrics || selected.text,
    { trackKey: targetKey, videoId: targetVideoId }
  );
  await applyLyricsText(selected.text);
  if (!isCurrent()) return;
  updateLyricsSourceState(payload, false);
  clearLyricsLateRetry(targetKey);

  // Cache writes from the initial fallback callback and the late LRCHub event
  // share one queue, so the higher-priority LRCHub record always lands last.
  try {
    await enqueueLyricsCacheWrite(
      targetKey,
      async () => {
        const existing = await storage.get(targetKey);
        const existingRecord = existing && typeof existing === 'object' ? existing : {};
        return {
          ...existingRecord,
          cacheVersion: LYRICS_CACHE_VERSION,
          video_id: targetVideoId || payload.video_id || null,
          record_id: payload.record_id || null,
          lyrics: selected.lyrics || selected.text,
          animated_lyrics: selected.animatedLyrics || null,
          dynamicLines: selected.dynamicLines || null,
          noLyrics: false,
          subLyrics: duetSubLyricsRaw,
          meaningData: lyricsMeaning || null,
          candidates: lyricsCandidates || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: 'lrchub',
          fallbackUsed: false,
          lyricsQuality: selected.quality,
          offset_ms: Number.isFinite(Number(payload.offset_ms)) ? Number(payload.offset_ms) : 0,
        };
      },
      isCurrent
    );
  } catch (error) {
    console.warn('[YTM] Failed to cache late LRCHub lyrics:', error);
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const parseMeaningTimeToSecLocal = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 10000 ? value / 1000 : value;
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  let frac = m[3] || '0';
  if (frac.length === 1) frac += '00';
  else if (frac.length === 2) frac += '0';
  const ms = Number(frac.slice(0, 3));
  if (!Number.isFinite(min) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
  return (min * 60) + sec + (ms / 1000);
};

const formatMeaningTimeLocal = (seconds) => {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const total = Math.max(0, seconds);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const normalizeMeaningStringListLocal = (value) => {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
  return [];
};

const normalizeMeaningSourceLocal = (payload) => {
  if (!payload) return null;
  if (Array.isArray(payload)) return { explanations: payload };
  if (typeof payload !== 'object') return null;

  const rawMeaningData = payload.meaningData;
  if (!rawMeaningData) return payload;

  const meaningData = Array.isArray(rawMeaningData)
    ? { explanations: rawMeaningData }
    : (typeof rawMeaningData === 'object' ? rawMeaningData : {});

  return {
    ...payload,
    ...meaningData,
    explanations: Array.isArray(meaningData.explanations)
      ? meaningData.explanations
      : (Array.isArray(payload.explanations) ? payload.explanations : []),
    timeline_meanings: Array.isArray(meaningData.timeline_meanings)
      ? meaningData.timeline_meanings
      : (Array.isArray(payload.timeline_meanings) ? payload.timeline_meanings : []),
    song_summary: meaningData.song_summary || meaningData.songSummary || payload.song_summary || payload.songSummary || null,
    final_summary: meaningData.final_summary || payload.final_summary || null,
    comments: Array.isArray(meaningData.comments) ? meaningData.comments : (Array.isArray(payload.comments) ? payload.comments : []),
    rating: meaningData.rating || payload.rating || null,
  };
};

const normalizeMeaningCommentsLocal = (comments) => {
  if (!Array.isArray(comments)) return [];
  return comments
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const body = String(item.body || item.comment || item.text || '').trim();
      if (!body) return null;
      return {
        body,
        contributorName: String(item.contributor_name || item.contributorName || item.user || item.name || '').trim(),
        createdAt: String(item.created_at || item.createdAt || '').trim(),
      };
    })
    .filter(Boolean);
};

const normalizeMeaningRatingLocal = (rating) => {
  if (!rating || typeof rating !== 'object') return null;
  const average = Number(rating.average ?? rating.avg ?? rating.score);
  const count = Number(rating.count ?? rating.total ?? rating.votes);
  const hasAverage = Number.isFinite(average);
  const hasCount = Number.isFinite(count);
  if (!hasAverage && !hasCount) return null;
  return {
    average: hasAverage ? average : null,
    count: hasCount ? count : null,
  };
};

const normalizeMeaningPayloadLocal = (payload) => {
  const source = normalizeMeaningSourceLocal(payload);
  if (!source || typeof source !== 'object') return null;

  // Handle new LRCHub "explanations" format
  const rawTimeline = Array.isArray(source.explanations) ? source.explanations : (Array.isArray(source.timeline_meanings) ? source.timeline_meanings : []);

  const timeline = rawTimeline
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      // Map from either new LRCHub spec or old spec
      const startRaw = String(item.start_time || item.start || '').trim();
      const endRaw = String(item.end_time || item.end || '').trim();

      const startSec = (typeof item.start_ms === 'number') ? item.start_ms / 1000 : parseMeaningTimeToSecLocal(item.start_sec ?? item.startSec ?? startRaw);
      const endSec = (typeof item.end_ms === 'number') ? item.end_ms / 1000 : parseMeaningTimeToSecLocal(item.end_sec ?? item.endSec ?? endRaw);
      const start = startRaw || formatMeaningTimeLocal(startSec);
      const end = endRaw || formatMeaningTimeLocal(endSec);

      return {
        start,
        end,
        startSec,
        endSec,
        label: String(item.lyrics || item.label || item.text || '').trim(),
        summary: String(item.summary || item.synopsis || '').trim(),
        detail: String(item.meaning || item.detail || item.explanation || item.description || '').trim(),
        emotion: normalizeMeaningStringListLocal(item.emotion || item.emotions || item.mood),
        keywords: normalizeMeaningStringListLocal(item.keywords || item.keyword),
      };
    })
    .filter(item => item && (item.label || item.summary || item.detail));

  const songSummaryRaw = source.song_summary && typeof source.song_summary === 'object'
    ? source.song_summary
    : (source.songSummary && typeof source.songSummary === 'object' ? source.songSummary : {});
  const finalSummaryRaw = source.final_summary && typeof source.final_summary === 'object'
    ? source.final_summary
    : {};
  const synopsis = String(songSummaryRaw.synopsis || finalSummaryRaw.synopsis || '').trim();
  const message = String(songSummaryRaw.message || finalSummaryRaw.message || '').trim();
  const summaryText = String(songSummaryRaw.summary || finalSummaryRaw.summary || '').trim();
  const longSummaryParts = [synopsis, message, summaryText].filter(Boolean);
  const finalSummary = {
    short: String(finalSummaryRaw.short || synopsis || message || summaryText || '').trim(),
    long: String(finalSummaryRaw.long || longSummaryParts.join('\n\n') || finalSummaryRaw.short || '').trim(),
  };
  const comments = normalizeMeaningCommentsLocal(source.comments);
  const rating = normalizeMeaningRatingLocal(source.rating);

  if (!timeline.length && !finalSummary.short && !finalSummary.long && !comments.length && !rating) return null;

  return {
    title: String(source.display_name || source.title || source.track || '').trim(),
    timeline_meanings: timeline,
    final_summary: finalSummary,
    song_summary: { synopsis, message, summary: summaryText },
    comments,
    rating,
  };
};

const parseMeaningPayloadTextLocal = (text) => {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

  const candidates = [raw];
  const fenced = raw.match(/```(?:json|txt|text)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeMeaningPayloadLocal(parsed);
      if (normalized) return normalized;
    } catch (e) {
    }
  }

  return null;
};

const getMeaningSegments = () => (
  lyricsMeaning && Array.isArray(lyricsMeaning.timeline_meanings)
    ? lyricsMeaning.timeline_meanings
    : []
);

const getCurrentPlaybackTimeSec = () => {
  const v = document.querySelector('video');
  if (!v || typeof v.currentTime !== 'number' || Number.isNaN(v.currentTime)) return null;
  let t = v.currentTime;
  // 連続再生対応: 曲開始オフセットを引いて曲内ローカル時間にする（全歌詞共通）
  if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
  t = Math.max(0, t - timeOffset);
  const duration = Number.isFinite(v.duration) ? v.duration : null;
  t = Math.max(0, t + (config.syncOffset / 1000));
  if (typeof duration === 'number' && duration > 0) {
    t = Math.min(t, duration);
  }
  return t;
};

const findMeaningIndexByTime = (timeSec) => {
  const segments = getMeaningSegments();
  if (!segments.length) return -1;
  if (typeof timeSec !== 'number' || Number.isNaN(timeSec)) return 0;

  let fallbackIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const startSec = typeof segment.startSec === 'number' ? segment.startSec : null;
    const endSec = typeof segment.endSec === 'number' ? segment.endSec : null;

    if (startSec != null && timeSec + 0.12 >= startSec) {
      fallbackIndex = i;
    }
    if ((startSec == null || timeSec + 0.12 >= startSec) &&
      (endSec == null || timeSec <= endSec + 0.12)) {
      return i;
    }
    if (startSec != null && timeSec < startSec) {
      break;
    }
  }

  return fallbackIndex;
};

const resolveMeaningIndex = (preferredTime = null) => {
  const segments = getMeaningSegments();
  if (!segments.length) return -1;
  if (typeof preferredTime === 'number' && !Number.isNaN(preferredTime)) {
    return findMeaningIndexByTime(preferredTime);
  }
  if (lastActiveIndex >= 0 && lyricsData[lastActiveIndex] && typeof lyricsData[lastActiveIndex].time === 'number') {
    return findMeaningIndexByTime(lyricsData[lastActiveIndex].time);
  }
  const now = getCurrentPlaybackTimeSec();
  if (typeof now === 'number') return findMeaningIndexByTime(now);
  return 0;
};

const buildMeaningChipGroup = (label, values, kind) => {
  if (!Array.isArray(values) || !values.length) return '';
  const chips = values.map((value) => `<span class="ytm-meaning-chip ${kind}">${escapeHtml(value)}</span>`).join('');
  return `<div class="ytm-meaning-chip-group"><div class="ytm-meaning-chip-label">${escapeHtml(label)}</div><div class="ytm-meaning-chip-list">${chips}</div></div>`;
};

const buildMeaningRatingHtml = () => {
  const rating = lyricsMeaning && lyricsMeaning.rating;
  if (!rating) return '';
  const average = typeof rating.average === 'number' ? rating.average.toFixed(1) : '--';
  const count = typeof rating.count === 'number' ? `${rating.count}件` : '';
  return `<div class="ytm-meaning-rating"><span>★ ${escapeHtml(average)}</span>${count ? `<span>${escapeHtml(count)}</span>` : ''}</div>`;
};

const buildMeaningSummarySectionsHtml = () => {
  const summary = (lyricsMeaning && lyricsMeaning.song_summary) || {};
  const sections = [
    ['あらすじ', summary.synopsis],
    ['メッセージ', summary.message],
    ['まとめ', summary.summary],
  ].filter(([, text]) => String(text || '').trim());

  return sections.map(([label, text]) => `
      <section class="ytm-meaning-summary-section">
        <div class="ytm-meaning-summary-section-label">${escapeHtml(label)}</div>
        <p>${escapeHtml(text)}</p>
      </section>
    `).join('');
};

const buildMeaningCommentsHtml = () => {
  const comments = lyricsMeaning && Array.isArray(lyricsMeaning.comments) ? lyricsMeaning.comments : [];
  if (!comments.length) return '';
  const items = comments.slice(0, 5).map((comment) => {
    const meta = [comment.contributorName, comment.createdAt].filter(Boolean).join(' / ');
    return `
        <div class="ytm-meaning-comment">
          <p>${escapeHtml(comment.body)}</p>
          ${meta ? `<div class="ytm-meaning-comment-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
      `;
  }).join('');
  return `
      <section class="ytm-meaning-comments">
        <div class="ytm-meaning-summary-section-label">コメント</div>
        ${items}
      </section>
    `;
};

const getMeaningDisplayTitle = () => {
  const raw = (lyricsMeaning && lyricsMeaning.title) || ui.title?.textContent || 'Song Meaning';
  return String(raw || 'Song Meaning').trim();
};

function hideMeaningSummaryPopup() {
  if (ui.meaningSummaryBackdrop) ui.meaningSummaryBackdrop.classList.remove('visible');
  if (ui.meaningSummaryDialog) ui.meaningSummaryDialog.classList.remove('visible');
}

let summaryButtonAttentionTimer = null;
let summaryButtonAttentionKey = null;
const MEANING_ALWAYS_SHOW_KEY = 'ytm_meaning_always_show';
const MEANING_PINNED_SONGS_KEY = 'ytm_meaning_pinned_songs';
let meaningPinnedSongs = new Set();
let meaningPreferencesPromise = null;
let meaningHoverTimer = null;
let meaningHoverHideTimer = null;
let meaningHoverVisible = false;
let meaningHoverIndex = -1;
let meaningVisibleBeforeHover = false;

function emphasizeSummaryButtonAfterLyricsLoad() {
  if (!ui.summaryBtn || !lyricsMeaning || !currentKey || summaryButtonAttentionKey === currentKey) return;
  summaryButtonAttentionKey = currentKey;
  if (summaryButtonAttentionTimer) clearTimeout(summaryButtonAttentionTimer);
  ui.summaryBtn.classList.add('ytm-summary-attention');
  summaryButtonAttentionTimer = setTimeout(() => {
    summaryButtonAttentionTimer = null;
    if (ui.summaryBtn) ui.summaryBtn.classList.remove('ytm-summary-attention');
  }, 3000);
}

function getMeaningPinMode() {
  if (config.alwaysShowMeaning) return 'global';
  if (currentKey && meaningPinnedSongs.has(currentKey)) return 'song';
  return 'off';
}

function isMeaningPersistentlyVisible() {
  return getMeaningPinMode() !== 'off';
}

async function ensureMeaningDisplayPreferences() {
  if (meaningPreferencesPromise) return meaningPreferencesPromise;
  meaningPreferencesPromise = Promise.all([
    storage.get(MEANING_ALWAYS_SHOW_KEY),
    storage.get(MEANING_PINNED_SONGS_KEY)
  ]).then(([alwaysShow, pinnedSongs]) => {
    config.alwaysShowMeaning = !!alwaysShow;
    meaningPinnedSongs = new Set(
      Array.isArray(pinnedSongs) ? pinnedSongs.filter(key => typeof key === 'string' && key) : []
    );
  });
  return meaningPreferencesPromise;
}

async function persistMeaningDisplayPreferences() {
  await Promise.all([
    storage.set(MEANING_ALWAYS_SHOW_KEY, !!config.alwaysShowMeaning),
    storage.set(MEANING_PINNED_SONGS_KEY, Array.from(meaningPinnedSongs))
  ]);
}

function clearMeaningHoverTimers() {
  if (meaningHoverTimer) clearTimeout(meaningHoverTimer);
  if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
  meaningHoverTimer = null;
  meaningHoverHideTimer = null;
}

function hideTransientMeaningPanel() {
  if (!meaningHoverVisible) return;
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  if (isMeaningPersistentlyVisible() || meaningVisibleBeforeHover) {
    meaningPanelVisible = true;
    syncMeaningPanelToPlayback(true);
  } else {
    meaningPanelVisible = false;
    if (ui.meaningPanel) ui.meaningPanel.classList.remove('active');
    if (ui.meaningBtn) ui.meaningBtn.classList.remove('active');
  }
  meaningVisibleBeforeHover = false;
}

function scheduleMeaningHoverHide() {
  if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
  meaningHoverHideTimer = setTimeout(() => {
    meaningHoverHideTimer = null;
    if (ui.meaningPanel?.matches(':hover')) return;
    hideTransientMeaningPanel();
  }, 900);
}

function startMeaningHover(line) {
  clearMeaningHoverTimers();
  if (!lyricsMeaning || !line || typeof line.time !== 'number') return;
  const nextIndex = findMeaningIndexByTime(line.time);
  if (nextIndex < 0) return;
  meaningHoverTimer = setTimeout(() => {
    meaningHoverTimer = null;
    meaningVisibleBeforeHover = meaningPanelVisible;
    meaningHoverVisible = true;
    meaningHoverIndex = nextIndex;
    meaningPanelVisible = true;
    if (ui.meaningPanel) ui.meaningPanel.classList.add('active');
    if (ui.meaningBtn) ui.meaningBtn.classList.add('active');
    renderMeaningPanel(nextIndex);
  }, 1000);
}

function setupMeaningPanelHoverEvents() {
  if (!ui.meaningPanel || ui.meaningPanel.dataset.hoverMeaningSetup === '1') return;
  ui.meaningPanel.dataset.hoverMeaningSetup = '1';
  ui.meaningPanel.addEventListener('mouseenter', () => {
    if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
    meaningHoverHideTimer = null;
  });
  ui.meaningPanel.addEventListener('mouseleave', () => {
    if (meaningHoverVisible) scheduleMeaningHoverHide();
  });
}

async function cycleMeaningPinMode() {
  if (!lyricsMeaning || !currentKey) return;
  const currentMode = getMeaningPinMode();
  let nextMode = 'off';

  if (currentMode === 'off') {
    meaningPinnedSongs.add(currentKey);
    config.alwaysShowMeaning = false;
    nextMode = 'song';
  } else if (currentMode === 'song') {
    meaningPinnedSongs.delete(currentKey);
    config.alwaysShowMeaning = true;
    nextMode = 'global';
  } else {
    config.alwaysShowMeaning = false;
    meaningPinnedSongs.delete(currentKey);
  }

  await persistMeaningDisplayPreferences();
  const alwaysToggle = document.getElementById('meaning-always-toggle');
  if (alwaysToggle) alwaysToggle.checked = !!config.alwaysShowMeaning;
  clearMeaningHoverTimers();
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  meaningVisibleBeforeHover = false;

  if (nextMode === 'off') {
    toggleMeaningPanel(false);
    showToast('解説を非表示にしました');
    return;
  }

  meaningPanelVisible = true;
  if (ui.meaningPanel) ui.meaningPanel.classList.add('active');
  renderMeaningPanel(resolveMeaningIndex());
  if (ui.meaningBtn) ui.meaningBtn.classList.add('active');
  showToast(nextMode === 'song' ? 'この曲で解説を固定表示します' : '対応曲すべてで解説を表示します');
}

function ensureMeaningSummaryDialog() {
  if (ui.meaningSummaryBackdrop && ui.meaningSummaryDialog) return;

  const backdrop = createEl('div', 'ytm-meaning-summary-backdrop', 'ytm-meaning-summary-backdrop');
  const dialog = createEl('div', 'ytm-meaning-summary-dialog', 'ytm-meaning-summary-dialog');
  backdrop.appendChild(dialog);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) hideMeaningSummaryPopup();
  });
  document.body.appendChild(backdrop);
  ui.meaningSummaryBackdrop = backdrop;
  ui.meaningSummaryDialog = dialog;

  if (!meaningSummaryGlobalSetup) {
    meaningSummaryGlobalSetup = true;
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideMeaningSummaryPopup();
    });
  }
}

function buildMeaningPanelActionsHtml() {
  const pinMode = getMeaningPinMode();
  const pinLabel = pinMode === 'off'
    ? 'この曲で表示'
    : (pinMode === 'song' ? 'すべての対応曲で表示' : '固定を解除して非表示');
  return `
    <div class="ytm-meaning-panel-actions">
      <button class="ytm-meaning-pin-btn is-${pinMode}" type="button" aria-label="${pinLabel}" title="${pinLabel}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v2l1.5 5 3 3v2H13v6l-1 1-1-1v-6H5.5v-2l3-3L10 5V3h4Z"/></svg>
      </button>
      <button class="ytm-meaning-close-btn ytm-unified-close-btn size-36" type="button" aria-label="Close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
  `;
}

function renderMeaningPanel(index = null) {
  if (!ui.meaningPanel) return;

  const normalizedIndex = typeof index === 'number' ? index : resolveMeaningIndex();
  const segments = getMeaningSegments();
  const segment = normalizedIndex >= 0 ? segments[normalizedIndex] : null;
  const summary = lyricsMeaning && lyricsMeaning.final_summary ? lyricsMeaning.final_summary : { short: '', long: '' };

  if (!lyricsMeaning) {
    ui.meaningPanel.innerHTML = '';
    ui.meaningPanel.classList.remove('active');
    activeMeaningIndex = -1;
    return;
  }

  if (!segment) {
    const fallbackText = summary.long || summary.short || 'この曲の解説データはまだありません。';
    ui.meaningPanel.innerHTML = `
        <div class="ytm-meaning-panel-head">
          <div>
            <div class="ytm-meaning-panel-eyebrow">歌詞解説</div>
          </div>
          ${buildMeaningPanelActionsHtml()}
        </div>
        <div class="ytm-meaning-panel-body">
          <p class="ytm-meaning-panel-text">${escapeHtml(fallbackText)}</p>
          ${buildMeaningSummarySectionsHtml()}
          ${buildMeaningRatingHtml()}
          ${buildMeaningCommentsHtml()}
        </div>
      `;
    activeMeaningIndex = -1;
  } else {
    ui.meaningPanel.innerHTML = `
        <div class="ytm-meaning-panel-head">
          <div>
            <div class="ytm-meaning-panel-eyebrow">歌詞解説</div>
            <div class="ytm-meaning-panel-range">${escapeHtml(segment.start || '--:--')} - ${escapeHtml(segment.end || '--:--')}</div>
          </div>
          ${buildMeaningPanelActionsHtml()}
        </div>
        <div class="ytm-meaning-panel-body">
          ${segment.summary ? `<p class="ytm-meaning-panel-summary">${escapeHtml(segment.summary)}</p>` : ''}
          ${segment.detail ? `<p class="ytm-meaning-panel-text">${escapeHtml(segment.detail)}</p>` : ''}
          ${buildMeaningChipGroup('感情', segment.emotion, 'emotion')}
          ${buildMeaningChipGroup('キーワード', segment.keywords, 'keyword')}
          ${buildMeaningRatingHtml()}
        </div>
      `;
    activeMeaningIndex = normalizedIndex;
  }

  const closeBtn = ui.meaningPanel.querySelector('.ytm-meaning-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      toggleMeaningPanel(false);
    };
  }
  const pinBtn = ui.meaningPanel.querySelector('.ytm-meaning-pin-btn');
  if (pinBtn) {
    pinBtn.onclick = (ev) => {
      ev.stopPropagation();
      cycleMeaningPinMode();
    };
  }
}

function syncMeaningPanelToPlayback(force = false, preferredTime = null) {
  if (!meaningPanelVisible || !ui.meaningPanel || !lyricsMeaning) return;
  if (meaningHoverVisible && meaningHoverIndex >= 0) return;
  const nextIndex = resolveMeaningIndex(preferredTime);
  if (!force && nextIndex === activeMeaningIndex) return;
  renderMeaningPanel(nextIndex);
}

function refreshMeaningUi() {
  const hasMeaning = !!lyricsMeaning;
  if (hasMeaning && isMeaningPersistentlyVisible()) {
    meaningPanelVisible = true;
  }

  if (ui.meaningBtn) {
    ui.meaningBtn.hidden = !hasMeaning;
    ui.meaningBtn.classList.toggle('active', !!(hasMeaning && meaningPanelVisible));
  }
  if (ui.summaryBtn) {
    ui.summaryBtn.hidden = !hasMeaning;
  }

  if (!hasMeaning) {
    clearMeaningHoverTimers();
    meaningHoverVisible = false;
    meaningHoverIndex = -1;
    meaningVisibleBeforeHover = false;
    meaningPanelVisible = false;
    activeMeaningIndex = -1;
    if (ui.meaningPanel) {
      ui.meaningPanel.classList.remove('active');
      ui.meaningPanel.innerHTML = '';
    }
    hideMeaningSummaryPopup();
    return;
  }

  if (ui.meaningPanel) {
    ui.meaningPanel.classList.toggle('active', !!meaningPanelVisible);
    if (meaningPanelVisible) renderMeaningPanel(resolveMeaningIndex());
  }
}

function setLyricsMeaningData(data) {
  lyricsMeaning = normalizeMeaningPayloadLocal(data);
  activeMeaningIndex = -1;
  refreshMeaningUi();
  if (lyricsMeaning && lyricsData.length) emphasizeSummaryButtonAfterLyricsLoad();
}

async function persistMeaningDataToCurrentCache() {
  if (!currentKey || !lyricsMeaning) return;
  const cached = await storage.get(currentKey);
  if (cached === NO_LYRICS_SENTINEL) return;

  const base = (cached && typeof cached === 'object')
    ? cached
    : ((typeof lastRawLyricsText === 'string' && lastRawLyricsText.trim()) ? { lyrics: lastRawLyricsText } : null);

  if (!base) return;
  await storage.set(currentKey, { ...base, meaningData: lyricsMeaning });
}


function toggleMeaningPanel(force) {
  if (!lyricsMeaning) {
    showToast('解説データがまだありません');
    return;
  }

  clearMeaningHoverTimers();
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  meaningVisibleBeforeHover = false;
  meaningPanelVisible = typeof force === 'boolean' ? force : !meaningPanelVisible;
  if (ui.meaningPanel) {
    ui.meaningPanel.classList.toggle('active', meaningPanelVisible);
  }
  if (ui.meaningBtn) {
    ui.meaningBtn.classList.toggle('active', meaningPanelVisible);
  }
  if (meaningPanelVisible) {
    syncMeaningPanelToPlayback(true);
  }
}

function showMeaningSummaryPopup() {
  if (!lyricsMeaning) {
    showToast('要約データがまだありません');
    return;
  }

  ensureMeaningSummaryDialog();
  const summary = lyricsMeaning.final_summary || {};
  const shortText = summary.short || '';
  const longText = summary.long || shortText || 'この曲の要約データはまだありません。';
  const structuredSummaryHtml = buildMeaningSummarySectionsHtml();

  ui.meaningSummaryDialog.innerHTML = `
      <button class="ytm-meaning-summary-close ytm-unified-close-btn size-36" type="button" aria-label="Close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="ytm-meaning-summary-eyebrow">要約</div>
      <div class="ytm-meaning-summary-title">${escapeHtml(getMeaningDisplayTitle())}</div>
      ${buildMeaningRatingHtml()}
      ${shortText ? `<p class="ytm-meaning-summary-short">${escapeHtml(shortText)}</p>` : ''}
      ${structuredSummaryHtml || `<p class="ytm-meaning-summary-long">${escapeHtml(longText)}</p>`}
      ${buildMeaningCommentsHtml()}
    `;

  const closeBtn = ui.meaningSummaryDialog.querySelector('.ytm-meaning-summary-close');
  if (closeBtn) closeBtn.onclick = () => hideMeaningSummaryPopup();

  ui.meaningSummaryBackdrop.classList.add('visible');
  ui.meaningSummaryDialog.classList.add('visible');
}

function setupAutoHideEvents() {
  if (document.body.dataset.autohideSetup) return;
  // mousemove は 1 フレームに 1 回へ間引く。
  // 高ポーリングレートのマウスでは毎秒数百回発火し、その都度
  // handleInteraction() の querySelector / classList 操作 / setTimeout 再設定が
  // 走って無視できないCPUコストになるため。
  let _interactionRafId = null;
  const onMouseMove = () => {
    if (_interactionRafId) return;
    _interactionRafId = requestAnimationFrame(() => {
      _interactionRafId = null;
      handleInteraction();
    });
  };
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  ['click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
  document.body.dataset.autohideSetup = 'true';
  handleInteraction();
}

function setupScrollResumeEvents() {
  if (!ui.lyrics) return;

  const handleUserScroll = () => {
    // 曲切替・再描画など拡張側の操作で発生したscrollイベントは
    // ユーザースクロールとして扱わない（自動スクロールが止まる原因になる）
    if (performance.now() < _suppressUserScrollUntil) return;

    if (isProgrammaticScrolling) {
      // プログラムスクロール中は、完了までタイムアウトを延長
      clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 150);
      return;
    }

    isUserScrolling = true;
    ui.lyrics.classList.add('ytm-user-browsing-lyrics');
    clearTimeout(userScrollTimeout);
    userScrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (ui.lyrics) {
        ui.lyrics.classList.remove('ytm-user-browsing-lyrics');
        ui.lyrics._lastScrolledIndex = -1; // 復帰時に強制スクロールさせるためリセット
      }
    }, 3000);
  };

  ui.lyrics.addEventListener('scroll', handleUserScroll, { passive: true });
}


// ===================== 歌詞＋翻訳適用 =====================

let lyricsTranslationMap = {};

const normalizeTranslationLangKey = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (key === 'jp') return 'ja';
  if (key === 'kr') return 'ko';
  if (key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'zh';
  return key;
};

const toLrchubTranslateLang = (lang) => {
  const key = normalizeTranslationLangKey(lang);
  if (!key || key === 'original') return '';
  if (key === 'ja') return 'JA';
  if (key === 'en') return 'EN';
  if (key === 'ko') return 'KO';
  if (key === 'zh') return 'CN';
  return key.toUpperCase();
};

const extractTranslationLyricsLocal = (value) => {
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

const normalizeTranslationsToLrcMapLocal = (input) => {
  const out = {};
  if (!input) return out;

  if (input.lrc_map && typeof input.lrc_map === 'object') {
    Object.entries(input.lrc_map).forEach(([lang, value]) => {
      const key = normalizeTranslationLangKey(lang);
      const lyrics = extractTranslationLyricsLocal(value);
      if (key && lyrics) out[key] = lyrics;
    });
  }

  if (Array.isArray(input)) {
    input.forEach(item => {
      if (!item) return;
      const key = normalizeTranslationLangKey(item.language || item.lang || item.target_lang || item.targetLang);
      const lyrics = extractTranslationLyricsLocal(item);
      if (key && lyrics) out[key] = lyrics;
    });
    return out;
  }

  if (typeof input === 'object') {
    Object.entries(input).forEach(([lang, value]) => {
      if (lang === 'lrc_map') return;
      const key = normalizeTranslationLangKey(value?.language || value?.lang || lang);
      const lyrics = extractTranslationLyricsLocal(value);
      if (key && lyrics) out[key] = lyrics;
    });
  }

  return out;
};

const getRequestedTranslationLangs = () => {
  if (!config.useTrans) return [];
  const mainLang = normalizeTranslationLangKey(config.mainLang || 'original');
  const subLang = normalizeTranslationLangKey(config.subLang || '');
  const langs = [];
  if (mainLang && mainLang !== 'original') langs.push(mainLang);
  if (subLang && subLang !== 'original' && subLang !== mainLang) langs.push(subLang);
  return [...new Set(langs.filter(Boolean))];
};

const getRequestedLrchubTranslateLangs = () => (
  config.useSharedTranslateApi
    ? getRequestedTranslationLangs().map(toLrchubTranslateLang).filter(Boolean)
    : []
);

async function applyTranslations(baseLines, youtubeUrl) {
  if (!config.useTrans || !Array.isArray(baseLines) || !baseLines.length) return baseLines;
  const mainLangStored = await storage.get('ytm_main_lang');
  const subLangStored = await storage.get('ytm_sub_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
  const mainLang = normalizeTranslationLangKey(config.mainLang || 'original');
  const subLang = normalizeTranslationLangKey(config.subLang || '');
  const langsToFetch = getRequestedTranslationLangs();
  if (!langsToFetch.length) return baseLines;

  let lrcMap = config.useSharedTranslateApi ? { ...(lyricsTranslationMap || {}) } : {};
  if (config.useSharedTranslateApi) {
    try {
      const missingLangs = langsToFetch.filter(lang => !lrcMap[normalizeTranslationLangKey(lang)]);
      if (missingLangs.length) {
        const metaNow = getMetadata();
        const track = metaNow?.title ? metaNow.title.replace(/\s*[\(-\[].*?[\)-]].*/, '') : '';
        const artist = metaNow?.artist || '';
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'GET_TRANSLATION',
            payload: {
              track,
              artist,
              youtube_url: youtubeUrl,
              video_id: getCurrentVideoId(),
              langs: missingLangs
            }
          }, resolve);
        });
        if (res?.success) {
          lrcMap = {
            ...lrcMap,
            ...normalizeTranslationsToLrcMapLocal(res.translations),
            ...normalizeTranslationsToLrcMapLocal(res.lrcMap)
          };
        }
      }
      lyricsTranslationMap = { ...(lyricsTranslationMap || {}), ...lrcMap };
    } catch (e) {
      console.warn('GET_TRANSLATION failed', e);
    }
  }

  const transLinesByLang = {};
  const needDeepL = [];

  langsToFetch.forEach(lang => {
    const langKey = normalizeTranslationLangKey(lang);
    const lrc = (lrcMap && lrcMap[langKey]) || '';
    if (lrc) {
      const parsed = parseLRCNoFlag(lrc);
      transLinesByLang[langKey] = parsed;
    } else if (!config.useSharedTranslateApi) {
      needDeepL.push(langKey);
    }
  });

  if (needDeepL.length && config.deepLKey) {
    for (const lang of needDeepL) {
      const translatedTexts = await translateTo(baseLines, lang);
      if (translatedTexts && translatedTexts.length === baseLines.length) {
        const lines = baseLines.map((l, i) => ({
          time: l.time,
          text: translatedTexts[i]
        }));
        transLinesByLang[lang] = lines;
        const plain = translatedTexts.join('\n');
        if (plain.trim()) {
          chrome.runtime.sendMessage({
            type: 'REGISTER_TRANSLATION',
            payload: { youtube_url: youtubeUrl, lang, lyrics: plain }
          }, (res) => {
            YTMLog.log('[CS] REGISTER_TRANSLATION', lang, res);
          });
        }
      }
    }
  }

  const alignedMap = buildAlignedTranslations(baseLines, transLinesByLang);
  const final = baseLines.map(l => ({ ...l }));
  const getLangTextAt = (langCode, index, baseText) => {
    if (!langCode || langCode === 'original') return baseText;
    const arr = alignedMap[langCode];
    if (!arr) return baseText;
    const v = arr[index];
    return (v === null || v === undefined) ? baseText : v;
  };

  for (let i = 0; i < final.length; i++) {
    const baseText = final[i].text;
    let primary = getLangTextAt(mainLang, i, baseText);
    let secondary = null;
    if (subLang && subLang !== mainLang) {
      secondary = getLangTextAt(subLang, i, baseText);
    } else if (!subLang && mainLang !== 'original') {
      if (normalizeStr(primary) !== normalizeStr(baseText)) {
        secondary = baseText;
      }
    }
    if (secondary && normalizeStr(primary) === normalizeStr(secondary)) {
      if (!isMixedLang(baseText)) secondary = null;
    }
    final[i].text = primary;
    if (secondary) final[i].translation = secondary;
    else delete final[i].translation;
  }
  dedupePrimarySecondary(final);
  return final;
}

const buildAlignedTranslations = (baseLines, transLinesByLang) => {
  const alignedMap = {};
  const TOL = 0.15;
  Object.keys(transLinesByLang).forEach(lang => {
    const arr = transLinesByLang[lang];
    const res = new Array(baseLines.length).fill(null);
    if (!Array.isArray(arr) || !arr.length) {
      alignedMap[lang] = res;
      return;
    }
    const hasAnyTime = arr.some(x => x && typeof x.time === 'number');
    if (!hasAnyTime) {
      // Untimed translations use blank rows only as section separators. Match
      // non-empty translations to non-empty base lines so timestamp sorting
      // cannot turn a separator into a translated lyric line.
      const contentLines = arr.filter(item => (
        item && typeof item.text === 'string' && item.text.trim() !== ''
      ));
      let k = 0;
      for (let i = 0; i < baseLines.length; i++) {
        const baseTextRaw = (baseLines[i]?.text ?? '');
        const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
        if (isEmptyBaseLine) { res[i] = ''; continue; }
        const cand = contentLines[k];
        if (cand && typeof cand.text === 'string') {
          const trimmed = cand.text.trim();
          res[i] = trimmed === '' ? '' : trimmed;
        } else {
          res[i] = '';
        }
        k++;
      }
      alignedMap[lang] = res;
      return;
    }
    let j = 0;
    for (let i = 0; i < baseLines.length; i++) {
      const baseLine = baseLines[i] || {};
      const tBase = baseLine.time;
      const baseTextRaw = (baseLine.text ?? '');
      const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
      if (isEmptyBaseLine) {
        res[i] = '';
        continue;
      }
      if (typeof tBase !== 'number') {
        const cand = arr[i];
        if (cand && typeof cand.text === 'string') {
          const raw = cand.text;
          const trimmed = raw.trim();
          res[i] = trimmed === '' ? '' : trimmed;
        }
        continue;
      }
      while (j < arr.length && typeof arr[j].time === 'number' && arr[j].time < tBase - TOL) {
        j++;
      }
      if (j < arr.length && typeof arr[j].time === 'number' && Math.abs(arr[j].time - tBase) <= TOL) {
        const raw = (arr[j].text ?? '');
        const trimmed = raw.trim();
        res[i] = trimmed === '' ? '' : trimmed;
        j++;
      }
    }
    alignedMap[lang] = res;
  });
  return alignedMap;
};


// ===================== Dynamic line post-processing =====================
// Some providers return Dynamic lyrics in "word chunks" (e.g. each char item is a whole word).
// We normalize them into true character-level timings by distributing each chunk's duration
// across its characters (1 char at a time).
function normalizeDynamicLinesToCharLevel(dynLines) {
  if (!Array.isArray(dynLines) || dynLines.length === 0) return dynLines;

  const toMs = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      if (!v.trim()) return null;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const getLineStartMs = (line) => {
    if (!line) return null;
    return toMs(line.startTimeMs) ?? toMs(line.start_ms) ?? toMs(line.startMs) ?? toMs(line.time) ?? null;
  };

  const getCharStartMs = (ch) => {
    if (!ch) return null;
    return toMs(ch.t) ?? toMs(ch.startTimeMs) ?? toMs(ch.start_ms) ?? toMs(ch.startMs) ?? toMs(ch.time) ?? null;
  };

  const getCharText = (ch) => {
    if (!ch || typeof ch !== 'object') return '';
    const raw = [ch.c, ch.char, ch.text, ch.caption, ch.value]
      .find(value => value !== null && value !== undefined && String(value).length > 0) ?? '';
    return String(raw);
  };

  const isWordChunk = (s) => {
    if (typeof s !== 'string') return false;
    // Use Array.from to be Unicode-safe (emoji etc.)
    return Array.from(s).length > 1;
  };

  const expandChunk = (chunkText, startMs, endMs) => {
    const arr = Array.from(String(chunkText ?? ''));
    const n = arr.length;
    if (!n) return [];
    const s = (typeof startMs === 'number' && Number.isFinite(startMs)) ? startMs : null;
    const e = (typeof endMs === 'number' && Number.isFinite(endMs)) ? endMs : null;

    // If we can't determine timing, emit all at 0 (will appear immediately when line becomes active)
    if (s == null) return arr.map(c => ({ t: 0, c }));

    if (e == null || e <= s) return arr.map(c => ({ t: s, c }));

    const dur = Math.max(1, e - s);
    const step = dur / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ t: s + Math.floor(step * i), c: arr[i] });
    }
    return out;
  };

  for (let li = 0; li < dynLines.length; li++) {
    const line = dynLines[li];
    if (!line || !Array.isArray(line.chars) || line.chars.length === 0) continue;

    const rawLineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;
    line.chars = line.chars.map(ch => ({
      ...(ch || {}),
      c: getCharText(ch),
      t: getCharStartMs(ch) ?? rawLineStartMs,
    }));
    if (typeof line.text !== 'string' || !line.text) {
      line.text = line.chars.map(ch => ch.c).join('');
    }
    if (toMs(line.startTimeMs) === null) line.startTimeMs = rawLineStartMs;

    // detect if any "char" item is actually a multi-character chunk (word)
    const hasChunk = line.chars.some(ch => isWordChunk(ch?.c));
    if (!hasChunk) continue;

    const nextLineStartMs = (li + 1 < dynLines.length) ? getLineStartMs(dynLines[li + 1]) : null;
    const lineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;

    // Build expanded character list
    const expanded = [];
    for (let i = 0; i < line.chars.length; i++) {
      const seg = line.chars[i];
      const segText = (seg && typeof seg.c === 'string') ? seg.c : '';
      const segStart = getCharStartMs(seg) ?? lineStartMs;

      // End bound is next segment's start, else next line, else a small fallback window
      let segEnd = (i + 1 < line.chars.length) ? getCharStartMs(line.chars[i + 1]) : null;
      if (segEnd == null) segEnd = toMs(line.endTimeMs) ?? nextLineStartMs ?? (segStart + 1500);
      if (typeof segEnd === 'number' && segEnd <= segStart) segEnd = segStart + 200;

      // Even if segText is already single "character", keep it as-is
      const segArr = Array.from(String(segText));
      if (segArr.length <= 1) {
        if (segArr.length === 1) expanded.push({ t: segStart, c: segArr[0] });
        continue;
      }

      expanded.push(...expandChunk(segText, segStart, segEnd));
    }

    // Replace with normalized chars
    line.chars = expanded;
    // Update line text if missing or mismatched
    try {
      const rebuilt = expanded.map(x => x.c).join('');
      if (typeof line.text !== 'string' || line.text.length === 0) line.text = rebuilt;
    } catch (e) { }

    // Ensure startTimeMs exists
    if (typeof line.startTimeMs !== 'number' || !Number.isFinite(line.startTimeMs)) {
      const firstT = expanded.length ? expanded[0].t : lineStartMs;
      line.startTimeMs = firstT;
    }
  }

  return dynLines;
}

async function applyLyricsText(rawLyrics) {
  const keyAtStart = currentKey;
  const videoIdAtStart = currentLyricsVideoId;
  const applyEpoch = ++lyricsApplyEpoch;
  if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
    if (keyAtStart !== currentKey || videoIdAtStart !== currentLyricsVideoId || applyEpoch !== lyricsApplyEpoch) return;
    lyricsData = [];
    hasTimestamp = false;
    animatedCaptionData = null;
    renderLyrics([]);
    refreshMeaningUi();
    return;
  }
  lastRawLyricsText = rawLyrics;
  const timedTextData = parseTimedTextAnimation(rawLyrics);
  let parsed = null;
  if (timedTextData) {
    if (config.useAnimatedCaptions && !hasCharacterSyncedLines(dynamicLines)) {
      const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
      const canonicalSingerLines = canonicalLyrics.trim()
        ? parseLRCInternal(canonicalLyrics).lines
        : [];
      const useSingerLayout = hasSingerDisplayMetadata(currentSingerMetadata, canonicalSingerLines);
      if (
        useSingerLayout &&
        canonicalLyrics.trim() && canonicalLyrics.trim() !== rawLyrics.trim()
      ) {
        return applyLyricsText(canonicalLyrics);
      }
      lyricsData = timedTextData.plainLines || [];
      dynamicLines = null;
      duetSubDynamicLines = null;
      renderAnimatedTimedText(timedTextData);
      if (lyricsData.length) emphasizeSummaryButtonAfterLyricsLoad();
      refreshMeaningUi();
      if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
      return;
    }
    animatedCaptionData = null;
    hasTimestamp = true;
    parsed = timedTextData.plainLines || [];
  } else {
    animatedCaptionData = null;
    parsed = parseBaseLRC(rawLyrics);
  }
  const videoUrl = getCurrentVideoUrl();

  // duet: if sub.txt exists, hide (filter) the normal lines that match sub timestamps,
  // and render the sub lines on the right.
  let baseLines = parsed;
  let hasDuetSub = false;

  // デュエットモードのリセット（sub.txtがない場合は除外タイムスタンプもクリア）
  _duetExcludedTimes = new Set();

  if (typeof duetSubLyricsRaw === 'string' && duetSubLyricsRaw.trim()) {
    const subObj = parseSubLRC(duetSubLyricsRaw);
    const subLines = subObj.lines || [];
    hasDuetSub = !!subObj.hasTs && subLines.some(l => typeof l?.time === 'number');
    if (hasDuetSub) {
      // even if the main lyrics didn't have tags, duet sub implies timestamp mode
      hasTimestamp = true;
      baseLines = mergeDuetLinesWithSimultaneousSupport(parsed, subLines);
    }
  }
  document.body.classList.toggle('ytm-duet-mode', hasDuetSub);

  let finalLines = baseLines;
  if (config.useTrans) {
    const translated = await applyTranslations(baseLines, videoUrl);
    // applyTranslations rebuilds objects, so re-attach duetSide by index
    if (Array.isArray(translated) && Array.isArray(baseLines) && translated.length === baseLines.length) {
      finalLines = translated.map((l, i) => ({ ...l, duetSide: baseLines[i]?.duetSide }));
    } else {
      finalLines = translated;
    }
  }
  if (
    keyAtStart !== currentKey ||
    videoIdAtStart !== currentLyricsVideoId ||
    applyEpoch !== lyricsApplyEpoch
  ) return;

  const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
  const canonicalLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : parsed;
  finalLines = applySingerMetadataToLines(finalLines, currentSingerMetadata, {
    canonicalLines,
    sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === rawLyrics.trim(),
  });
  finalLines = collapseCrossSideDuplicateLyrics(finalLines);

  // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
  try {
    if (Array.isArray(dynamicLines) && dynamicLines.length) {
      dynamicLines = normalizeDynamicLinesToCharLevel(dynamicLines);
    }
  } catch (e) { }

  // 注意: ここで timeOffset を 0 にリセットしてはいけない。
  // 連続再生（currentTime がリセットされない）対応のため、曲開始オフセットは
  // tick() で設定された値を保持する。リセット再生の場合は RAF ループ側で
  // currentTime が offset を下回った時点で自動的に 0 に補正される。

  lyricsData = finalLines;
  renderLyrics(finalLines);
  if (finalLines.length) emphasizeSummaryButtonAfterLyricsLoad();
  refreshMeaningUi();
  if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
}

// ===================== 歌詞候補・ロック関連 =====================

const getCandidateId = (cand, idx = 0) => {
  if (!cand || typeof cand !== 'object') return String(idx);
  return String(cand.id || cand.candidate_id || cand.path || cand.file || cand.filename || cand.name || cand.title || idx);
};

const getCandidateRecordId = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = candidate.record_id || candidate.recordId ||
    candidate.provider_meta?.record_id || candidate.provider_meta?.recordId ||
    candidate.providerMeta?.record_id || candidate.providerMeta?.recordId ||
    candidate.candidate_id ||
    candidate.lyrics_id || candidate.lyric_id || candidate.record?.record_id ||
    candidate.record?.recordId || candidate.record?.id || null;
  return id === null || id === undefined || id === '' ? null : String(id);
};

const buildCandidateLabel = (cand, idx = 0) => {
  if (!cand || typeof cand !== 'object') return `候補${idx + 1}`;

  const rawName = (
    cand.file ||
    cand.filename ||
    cand.name ||
    cand.path ||
    cand.select ||
    cand.list ||
    cand.candidate_id ||
    cand.id ||
    ''
  );

  const normalized = String(rawName || '').trim().replace(/\\/g, '/');
  const labelText = normalized ? normalized.split('/').pop() : `候補${idx + 1}`;
  return labelText;
};

const safeRuntimeSendMessage = (message) => {
  return new Promise((resolve) => {
    try {
      if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
        resolve(null);
        return;
      }
      EXT.runtime.sendMessage(message, (resp) => {
        const err = EXT.runtime && EXT.runtime.lastError ? EXT.runtime.lastError : null;
        if (err) {
          console.warn('[CS] runtime.sendMessage failed:', err.message || err);
          resolve({ success: false, error: err.message || String(err) });
          return;
        }
        resolve(resp || null);
      });
    } catch (e) {
      console.warn('[CS] runtime.sendMessage exception:', e);
      resolve({ success: false, error: String(e) });
    }
  });
};

const refreshRenderedSingerMetadata = async () => {
  const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
  const renderedLyrics = String(lastRawLyricsText || '');
  const canonicalSingerLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : [];
  const useSingerLayout = hasSingerDisplayMetadata(currentSingerMetadata, canonicalSingerLines);

  // Animated captions have their own free-positioned cue layout. When singer
  // metadata changes alignment, color, or labels, use the canonical line
  // layout so that contract remains visible and deterministic.
  if (
    useSingerLayout &&
    canonicalLyrics.trim() && renderedLyrics.trim() &&
    canonicalLyrics.trim() !== renderedLyrics.trim() &&
    document.body.classList.contains('ytm-animated-caption-mode')
  ) {
    await applyLyricsText(canonicalLyrics);
    return;
  }

  if (!Array.isArray(lyricsData) || !lyricsData.length) return;
  const canonicalLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : [];
  const sameSource = !canonicalLyrics.trim() || canonicalLyrics.trim() === renderedLyrics.trim();
  lyricsData = applySingerMetadataToLines(lyricsData, currentSingerMetadata, {
    canonicalLines,
    sameSource,
  });
  renderLyrics(lyricsData);
};

const requestSingerMetadataForLyrics = async (recordId, canonicalLyrics, identity = {}) => {
  const normalizedRecordId = String(recordId || '').trim();
  const targetKey = identity.trackKey || currentKey;
  const targetVideoId = String(identity.videoId ?? currentLyricsVideoId ?? getCurrentVideoId() ?? '');
  const nextCanonicalLyrics = typeof canonicalLyrics === 'string' ? canonicalLyrics : '';
  if (
    targetKey !== currentKey ||
    targetVideoId !== String(currentLyricsVideoId || '')
  ) return null;

  const requestKey = normalizedRecordId
    ? `${targetKey || ''}///${targetVideoId}///${normalizedRecordId}`
    : '';
  const canonicalChanged = nextCanonicalLyrics !== currentSingerCanonicalLyrics;
  const metadataContextChanged = requestKey !== currentSingerMetadataKey;

  currentLyricsRecordId = normalizedRecordId || null;
  currentSingerCanonicalLyrics = nextCanonicalLyrics;
  if (metadataContextChanged) currentSingerMetadata = null;

  if (!normalizedRecordId) {
    singerMetadataRequestSequence += 1;
    singerMetadataRequestKey = '';
    currentSingerMetadataKey = '';
    currentSingerMetadata = null;
    await refreshRenderedSingerMetadata();
    return null;
  }
  if (!metadataContextChanged && currentSingerMetadata) {
    if (canonicalChanged) await refreshRenderedSingerMetadata();
    return currentSingerMetadata;
  }

  if (singerMetadataRequestKey === requestKey) return null;
  singerMetadataRequestKey = requestKey;
  const requestSequence = ++singerMetadataRequestSequence;
  const response = await safeRuntimeSendMessage({
    type: 'GET_LYRIC_SINGERS',
    payload: {
      record_id: normalizedRecordId,
      video_id: targetVideoId || null,
      youtube_url: getCurrentVideoUrl(),
    },
  });

  if (requestSequence !== singerMetadataRequestSequence) return null;
  singerMetadataRequestKey = '';
  if (
    targetKey !== currentKey ||
    targetVideoId !== String(currentLyricsVideoId || '') ||
    normalizedRecordId !== String(currentLyricsRecordId || '')
  ) return null;

  const metadata = response?.success && response.singerMetadata && typeof response.singerMetadata === 'object'
    ? response.singerMetadata
    : null;
  if (metadata?.record_id && String(metadata.record_id) !== normalizedRecordId) return null;
  if (metadata) {
    currentSingerMetadata = metadata;
    currentSingerMetadataKey = requestKey;
  } else if (currentSingerMetadataKey !== requestKey) {
    currentSingerMetadata = null;
  }
  await refreshRenderedSingerMetadata();
  return currentSingerMetadata;
};

const formatPreviewTime = (seconds) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const getCurrentPlaybackSeconds = () => {
  try {
    const v = document.querySelector('video');
    if (v && Number.isFinite(v.currentTime)) {
      // 連続再生対応: 曲開始オフセットを引いて曲内ローカル時間で返す
      return Math.max(0, v.currentTime - timeOffset);
    }
  } catch (e) { }
  return null;
};

// Resolve the active lyric from the media clock. This remains accurate when a
// background tab throttles rAF and its highlighted DOM row becomes stale.
// null means timed lyric data is unavailable; '' is an intentional lyric gap.
const getCurrentPlaybackLyricText = () => {
  const meta = getMetadata();
  if (meta) {
    const metadataKey = `${meta.title}///${meta.artist}`;
    if (currentKey && currentKey !== metadataKey) return '';
  }

  const currentTime = getCurrentPlaybackTimeSec();
  if (!Number.isFinite(currentTime)) return null;

  if (
    config.useAnimatedCaptions &&
    animatedCaptionData &&
    Array.isArray(animatedCaptionData.events)
  ) {
    const tMs = Math.max(0, currentTime * 1000);
    const activeEvents = animatedCaptionData.events
      .filter(event => tMs + 40 >= event.startMs && tMs <= event.endMs + 40)
      .slice(-24);
    const currentEvent = activeEvents[activeEvents.length - 1];
    return currentEvent ? String(currentEvent.text || '').trim() : '';
  }

  if (!Array.isArray(lyricsData) || !lyricsData.length || !hasTimestamp) return null;

  let primaryIndex = -1;
  for (let i = 0; i < lyricsData.length; i++) {
    const lineTime = lyricsData[i]?.time;
    if (typeof lineTime !== 'number' || !Number.isFinite(lineTime)) continue;
    if (lineTime > currentTime) break;
    primaryIndex = i;
  }
  if (primaryIndex < 0) return '';

  const activeIndices = new Set([primaryIndex]);
  const currentLineTime = lyricsData[primaryIndex]?.time;
  if (typeof currentLineTime === 'number') {
    for (let i = primaryIndex - 1; i >= 0; i--) {
      if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
      activeIndices.add(i);
    }
    for (let i = primaryIndex + 1; i < lyricsData.length; i++) {
      if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
      activeIndices.add(i);
    }
  }

  if (activeIndices.size === 1 && primaryIndex > 0) {
    const previousIndex = primaryIndex - 1;
    const previousTime = lyricsData[previousIndex]?.time;
    const currentSide = lyricsData[primaryIndex]?.duetSide;
    const previousSide = lyricsData[previousIndex]?.duetSide;
    const isClosePreviousLine = typeof currentLineTime === 'number' &&
      typeof previousTime === 'number' &&
      (currentLineTime - previousTime) <= 1.0;
    const isDifferentDuetSide = currentSide && previousSide && currentSide !== previousSide;

    if (isClosePreviousLine && !isDifferentDuetSide) {
      const currentText = normalizeLyricCompareTextStrict(lyricsData[primaryIndex]?.text);
      const previousText = normalizeLyricCompareTextStrict(lyricsData[previousIndex]?.text);
      const sameDisplayedLyric = !!currentText &&
        !!previousText &&
        scoreLyricTextMatch(currentText, previousText) >= 100;
      if (!sameDisplayedLyric) activeIndices.add(previousIndex);
    }
  }

  lyricsData.forEach((line, lineIndex) => {
    if (!activeIndices.has(lineIndex) && isLineDynamicallyActiveAtTime(line, currentTime)) {
      activeIndices.add(lineIndex);
    }
  });

  if (activeIndices.size > 1) {
    const activeList = Array.from(activeIndices).sort((a, b) => a - b);
    activeList.forEach((activeIndex) => {
      const activeLine = lyricsData[activeIndex];
      if (activeLine?.duetSide !== 'right') return;
      const activeText = normalizeLyricCompareTextStrict(activeLine?.text);
      if (!activeText) return;
      const dedupeTolerance = Array.isArray(dynamicLines) && dynamicLines.length > 0
        ? 5.0
        : DUET_DUPLICATE_TOLERANCE;
      const hasMatchingLeft = activeList.some((otherIndex) => {
        if (otherIndex === activeIndex) return false;
        const otherLine = lyricsData[otherIndex];
        if (otherLine?.duetSide !== 'left') return false;
        if (!isSameTimestamp(otherLine?.time, activeLine?.time, dedupeTolerance)) return false;
        const otherText = normalizeLyricCompareTextStrict(otherLine?.text);
        return !!otherText && scoreLyricTextMatch(otherText, activeText) >= 100;
      });
      if (hasMatchingLeft) activeIndices.delete(activeIndex);
    });
  }

  return Array.from(activeIndices)
    .sort((a, b) => a - b)
    .map(index => String(lyricsData[index]?.text || lyricsData[index]?.rawLine || '').trim())
    .filter((text, index, lines) => text && lines.indexOf(text) === index)
    .join(' / ');
};

globalThis.YTMImmersionDiscordLyrics = {
  ...(globalThis.YTMImmersionDiscordLyrics || {}),
  getCurrentPlaybackLyricText,
};

const getCurrentRenderedLyricText = () => {
  if (lastActiveIndex >= 0 && Array.isArray(lyricsData) && lyricsData[lastActiveIndex]) {
    const line = lyricsData[lastActiveIndex];
    const txt = String(line.text || line.rawLine || '').trim();
    if (txt) return txt;
  }
  try {
    const activeRow = ui.lyrics ? ui.lyrics.querySelector('.lyric-line.active .lyric-main, .lyric-line.active') : null;
    return activeRow && activeRow.textContent ? activeRow.textContent.trim() : '';
  } catch (e) {
    return '';
  }
};

const getCurrentRenderedLyricIndex = () => {
  if (!Array.isArray(lyricsData) || !lyricsData.length) return -1;
  if (Number.isInteger(lastActiveIndex) && lastActiveIndex >= 0) {
    let nonEmptyIndex = -1;
    for (let i = 0; i <= Math.min(lastActiveIndex, lyricsData.length - 1); i++) {
      const txt = String(lyricsData[i]?.text || lyricsData[i]?.rawLine || '').trim();
      if (txt) nonEmptyIndex += 1;
    }
    return nonEmptyIndex;
  }
  return -1;
};

const pickPreviewInfoFromLyrics = (rawLyrics) => {
  const txt = typeof rawLyrics === 'string' ? rawLyrics.trim() : '';
  if (!txt) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };

  const parsed = parseLRCNoFlag(txt);
  const nonEmpty = Array.isArray(parsed)
    ? parsed.filter(line => line && typeof line.text === 'string' && line.text.trim())
    : [];

  if (!nonEmpty.length) {
    const plain = txt.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!plain.length) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };
    return { line: plain[0], mode: 'plain-first', lineIndex: 0, total: plain.length };
  }

  const currentSeconds = getCurrentPlaybackSeconds();
  const hasTs = nonEmpty.some(line => typeof line.time === 'number' && Number.isFinite(line.time));

  if (hasTs && typeof currentSeconds === 'number') {
    let foundIndex = 0;
    for (let i = 0; i < nonEmpty.length; i++) {
      const t = nonEmpty[i] && typeof nonEmpty[i].time === 'number' ? nonEmpty[i].time : null;
      if (t == null) continue;
      if (t > currentSeconds) break;
      foundIndex = i;
    }
    return {
      line: String(nonEmpty[foundIndex].text || '').trim(),
      mode: 'timestamp',
      lineIndex: foundIndex,
      total: nonEmpty.length
    };
  }

  const currentLineIndex = getCurrentRenderedLyricIndex();
  if (currentLineIndex >= 0) {
    const idx = Math.max(0, Math.min(currentLineIndex, nonEmpty.length - 1));
    return {
      line: String(nonEmpty[idx].text || '').trim(),
      mode: 'current-line-index',
      lineIndex: idx,
      total: nonEmpty.length
    };
  }

  try {
    const v = document.querySelector('video');
    if (v && Number.isFinite(v.currentTime) && Number.isFinite(v.duration) && v.duration > 0) {
      // 連続再生対応: 曲内ローカル時間で進捗比率を計算
      const localTime = Math.max(0, v.currentTime - timeOffset);
      const ratio = Math.max(0, Math.min(1, localTime / v.duration));
      const idx = Math.max(0, Math.min(nonEmpty.length - 1, Math.round((nonEmpty.length - 1) * ratio)));
      return {
        line: String(nonEmpty[idx].text || '').trim(),
        mode: 'progress-ratio',
        lineIndex: idx,
        total: nonEmpty.length
      };
    }
  } catch (e) { }

  return {
    line: String(nonEmpty[0].text || '').trim(),
    mode: 'plain-first',
    lineIndex: 0,
    total: nonEmpty.length
  };
};

async function ensureCandidateLyricsLoaded(candId) {
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return null;
  const candidateListAtStart = lyricsCandidates;
  const candidateKeyAtStart = currentKey;
  const candidateVideoAtStart = currentLyricsVideoId || getCurrentVideoId() || '';
  const idx = lyricsCandidates.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
  if (idx < 0) return null;
  const cand = lyricsCandidates[idx];
  const candidateHasLyrics = cand && typeof cand.lyrics === 'string' && cand.lyrics.trim();
  const candidateHasRecordReference = !!(
    cand?.record_id || cand?.recordId || cand?.candidate_id || cand?.lyrics_id ||
    cand?.lyric_id || cand?.record?.id || cand?.record?.record_id || cand?.record?.recordId
  );
  const candidateNeedsFullRecord = candidateHasRecordReference && cand?.lyricsComplete !== true;
  const candidateAdvertisesDynamic = !!(
    cand?.has_dynamic ||
    cand?.hasDynamic ||
    cand?.dynamic_lrc ||
    cand?.dynamic_lyrics ||
    cand?.dynamicLrc ||
    cand?.dynamicLyrics
  );
  const candidateNeedsDynamic = candidateAdvertisesDynamic && !hasCharacterSyncedLines(cand?.dynamicLines);
  if (candidateHasLyrics && !candidateNeedsDynamic && !candidateNeedsFullRecord) return cand;

  const payload = {
    youtube_url: getCurrentVideoUrl(),
    video_id: candidateVideoAtStart,
    translate_to: getRequestedLrchubTranslateLangs(),
    candidate_id: getCandidateId(cand, idx),
    candidate: cand || null
  };
  YTMLog.log('[CS] GET_CANDIDATE_LYRICS request:', payload);
  const res = await safeRuntimeSendMessage({ type: 'GET_CANDIDATE_LYRICS', payload });
  YTMLog.log('[CS] GET_CANDIDATE_LYRICS response:', res);
  if (
    currentKey !== candidateKeyAtStart ||
    (currentLyricsVideoId || getCurrentVideoId() || '') !== candidateVideoAtStart ||
    lyricsCandidates !== candidateListAtStart
  ) return null;
  const hasResponseLyrics = typeof res?.lyrics === 'string' && res.lyrics.trim();
  const hasResponseAnimatedLyrics = typeof res?.animated_lyrics === 'string' && res.animated_lyrics.trim();
  if (res && res.success && (hasResponseLyrics || hasResponseAnimatedLyrics)) {
    const next = {
      ...(cand || {}),
      record_id: res.record_id || cand?.record_id || cand?.recordId || null,
      lyrics: res.lyrics || cand?.lyrics || '',
      lyricsComplete: res.lyricsComplete === true,
      animated_lyrics: res.animated_lyrics || cand?.animated_lyrics || null,
      dynamicLines: hasCharacterSyncedLines(res.dynamicLines) ? res.dynamicLines : null,
      offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
      lyricsSource: res.lyricsSource || 'lrchub',
      fallbackUsed: false,
      meaningData: res.meaningData || cand?.meaningData || null,
      songSummary: res.songSummary || cand?.songSummary || null,
      comments: Array.isArray(res.comments) ? res.comments : (Array.isArray(cand?.comments) ? cand.comments : []),
      rating: res.rating || cand?.rating || null,
      translations: res.translations || cand?.translations || null,
      lrcMap: res.lrcMap || cand?.lrcMap || null,
      has_synced: typeof res.has_synced === 'boolean' ? res.has_synced : !!/\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(res.lyrics)
    };
    lyricsCandidates[idx] = next;
    return next;
  }
  return cand || null;
}

function ensureCandidateHoverPreview() {
  let el = document.getElementById('ytm-candidate-hover-preview');
  const parent = ui.uploadMenu || document.body;
  if (!el) {
    el = document.createElement('div');
    el.id = 'ytm-candidate-hover-preview';
    el.innerHTML = `
        <div class="ytm-candidate-hover-preview-title"></div>
        <div class="ytm-candidate-hover-preview-line"></div>
        <div class="ytm-candidate-hover-preview-meta"></div>
        <div class="ytm-candidate-hover-preview-current"></div>
      `;
    parent.appendChild(el);
  } else if (el.parentElement !== parent) {
    parent.appendChild(el);
  }
  return el;
}

function updateCandidateHoverPreviewPosition(clientX, clientY, anchorEl) {
  const el = ensureCandidateHoverPreview();
  if (!el) return;
  if (ui.uploadMenu && el.parentElement === ui.uploadMenu) {
    const menuRect = ui.uploadMenu.getBoundingClientRect();
    const anchorRect = (anchorEl || hoverPreviewAnchorEl || ui.uploadMenu).getBoundingClientRect();
    const height = el.offsetHeight || 180;
    const maxTop = Math.max(8, ui.uploadMenu.offsetHeight - height - 8);
    const desiredTop = Math.max(8, Math.min(maxTop, anchorRect.top - menuRect.top - 8));
    el.style.top = `${desiredTop}px`;
    el.style.left = 'auto';
    el.style.right = `calc(100% + 12px)`;
    return;
  }
  const pad = 18;
  const width = el.offsetWidth || 360;
  const height = el.offsetHeight || 160;
  let left = clientX + pad;
  let top = clientY + pad;
  if (left + width > window.innerWidth - 12) left = Math.max(12, clientX - width - pad);
  if (top + height > window.innerHeight - 12) top = Math.max(12, clientY - height - pad);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function renderCandidateHoverPreview(candId) {
  const el = ensureCandidateHoverPreview();
  if (!el || !candId) return;
  const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
  const idx = list.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
  if (idx < 0) return;
  const cand = list[idx];
  const titleEl = el.querySelector('.ytm-candidate-hover-preview-title');
  const lineEl = el.querySelector('.ytm-candidate-hover-preview-line');
  const metaEl = el.querySelector('.ytm-candidate-hover-preview-meta');
  const currentEl = el.querySelector('.ytm-candidate-hover-preview-current');
  const info = pickPreviewInfoFromLyrics(cand && cand.lyrics ? cand.lyrics : '');
  const currentLine = getCurrentRenderedLyricText();
  const currentSeconds = getCurrentPlaybackSeconds();

  if (titleEl) titleEl.textContent = buildCandidateLabel(cand, idx);

  if (lineEl) {
    if (info.line) lineEl.textContent = info.line;
    else if (hoverPreviewLoading) lineEl.textContent = '候補の歌詞データを読み込み中...';
    else lineEl.textContent = 'この候補の歌詞データを表示できませんでした';
  }

  if (metaEl) {
    const parts = [];
    if (typeof currentSeconds === 'number') parts.push(`再生位置 ${formatPreviewTime(currentSeconds)}`);
    if (info.total > 0 && info.lineIndex >= 0) parts.push(`行 ${info.lineIndex + 1}/${info.total}`);
    if (info.mode === 'timestamp') parts.push('候補自身の同期位置');
    else if (info.mode === 'current-line-index') parts.push('現在の表示行に追従');
    else if (info.mode === 'progress-ratio') parts.push('再生率から推定');
    else if (info.mode === 'plain-first') parts.push('先頭行を表示');
    metaEl.textContent = parts.join(' / ');
  }

  if (currentEl) {
    currentEl.textContent = currentLine ? `現在表示中: ${currentLine}` : '';
  }

  updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY);
  el.classList.add('visible');
}

function startCandidateHoverPreviewLoop() {
  if (hoverPreviewRafId) return;
  const tick = () => {
    if (!hoverPreviewCandidateId) {
      hoverPreviewRafId = null;
      return;
    }
    renderCandidateHoverPreview(hoverPreviewCandidateId);
    hoverPreviewRafId = requestAnimationFrame(tick);
  };
  hoverPreviewRafId = requestAnimationFrame(tick);
}

async function showCandidateHoverPreview(candId, ev) {
  if (!candId) return;
  hoverPreviewCandidateId = candId;
  hoverPreviewAnchorEl = ev?.currentTarget || ev?.target?.closest?.('.ytm-upload-menu-item-candidate') || hoverPreviewAnchorEl;
  hoverPreviewMouseX = ev?.clientX ?? hoverPreviewMouseX;
  hoverPreviewMouseY = ev?.clientY ?? hoverPreviewMouseY;
  hoverPreviewLoading = true;
  YTMLog.log('[CS] hover preview start:', candId);
  const el = ensureCandidateHoverPreview();
  if (el) {
    renderCandidateHoverPreview(candId);
    updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
    el.classList.add('visible');
  }
  startCandidateHoverPreviewLoop();
  const cand = await ensureCandidateLyricsLoaded(candId);
  if (hoverPreviewCandidateId !== candId) return;
  hoverPreviewLoading = false;
  renderCandidateHoverPreview(candId);
}

function hideCandidateHoverPreview() {
  hoverPreviewCandidateId = null;
  hoverPreviewLoading = false;
  hoverPreviewAnchorEl = null;
  if (hoverPreviewRafId) {
    cancelAnimationFrame(hoverPreviewRafId);
    hoverPreviewRafId = null;
  }
  const el = document.getElementById('ytm-candidate-hover-preview');
  if (el) el.classList.remove('visible');
}

async function selectCandidateById(candId) {
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return;
  const selectionKey = currentKey;
  const selectionVideoId = currentLyricsVideoId || getCurrentVideoId() || '';
  let cand = lyricsCandidates.find((c, idx) => getCandidateId(c, idx) === String(candId));
  if (!cand) return;
  // A search result can already contain line-synced lyrics while its
  // character timings still need to be fetched from /api/record.
  cand = await ensureCandidateLyricsLoaded(candId);
  if (
    currentKey !== selectionKey ||
    (currentLyricsVideoId || getCurrentVideoId() || '') !== selectionVideoId
  ) return;
  const hasCandidateLyrics = typeof cand?.lyrics === 'string' && cand.lyrics.trim();
  const hasCandidateAnimatedLyrics = typeof cand?.animated_lyrics === 'string' && cand.animated_lyrics.trim();
  if (!cand || (!hasCandidateLyrics && !hasCandidateAnimatedLyrics)) {
    showToast('この候補の歌詞データを読み込めませんでした');
    return;
  }
  const selectedPayload = selectLyricsPayload(cand);
  const nextLyricsText = selectedPayload.text;
  selectedCandidateId = candId;
  currentLyricsFromPreferredYtm = false;  // 手動選択が最優先
  // Cancel any automatic late upgrade which belongs to the pre-selection
  // request. A manual candidate choice must remain authoritative.
  activeLyricsRequestId = null;
  currentLyricsResultPriority = 3;
  currentLyricsQuality = selectedPayload.quality;
  dynamicLines = selectedPayload.dynamicLines;
  lyricsTranslationMap = {
    ...normalizeTranslationsToLrcMapLocal(cand.translations),
    ...normalizeTranslationsToLrcMapLocal(cand.lrcMap)
  };
  setLyricsMeaningData(cand);
  updateLyricsSourceState({ lyricsSource: 'lrchub', fallbackUsed: false }, false);
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  const candidateRecordId = getCandidateRecordId(cand);
  void requestSingerMetadataForLyrics(
    candidateRecordId,
    selectedPayload.lyrics || nextLyricsText,
    { trackKey: selectionKey, videoId: selectionVideoId }
  );
  if (currentKey) {
    storage.set(currentKey, {
      cacheVersion: LYRICS_CACHE_VERSION,
      video_id: currentLyricsVideoId || getCurrentVideoId() || null,
      record_id: candidateRecordId,
      lyrics: cand.lyrics,
      animated_lyrics: cand.animated_lyrics || null,
      dynamicLines: dynamicLines || null,
      noLyrics: false,
      lrcMap: lyricsTranslationMap || null,
      meaningData: lyricsMeaning || null,
      candidateId: cand.id || candId || null,
      lyricsSource: 'lrchub',
      fallbackUsed: false,
      lyricsQuality: selectedPayload.quality,
      offset_ms: Number.isFinite(Number(cand.offset_ms)) ? Number(cand.offset_ms) : 0,
    });
  }
  await applyLyricsText(nextLyricsText);
  if (
    currentKey !== selectionKey ||
    (currentLyricsVideoId || getCurrentVideoId() || '') !== selectionVideoId
  ) return;
  const youtube_url = getCurrentVideoUrl();
  const video_id = selectionVideoId;
  const candidate_id = cand.id || candId;
  try {
    chrome.runtime.sendMessage(
      { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, candidate_id } },
      (res) => YTMLog.log('[CS] SELECT_LYRICS_CANDIDATE result:', res)
    );
  } catch (e) {
    console.warn('[CS] SELECT_LYRICS_CANDIDATE failed to send', e);
  }
  const reloadKey = currentKey;
  const reloadVideoId = selectionVideoId;
  setTimeout(() => {
    const metaNow = getMetadata();
    if (!metaNow) return;
    const keyNow = `${metaNow.title}///${metaNow.artist}`;
    if (
      keyNow !== reloadKey ||
      currentKey !== reloadKey ||
      (currentLyricsVideoId || getCurrentVideoId() || '') !== reloadVideoId ||
      (getCurrentVideoId() || '') !== reloadVideoId
    ) return;
    storage.remove(reloadKey);
    loadLyrics(metaNow);
  }, 10000);
}

let lyricsLockState = null;

function normalizeLockRequestId(req) {
  return String(req?.request || req?.id || '').trim().toLowerCase();
}

function inferLockRequestTarget(req) {
  if (!req || typeof req !== 'object') return null;

  const explicit = String(req.target || '').trim().toLowerCase();
  if (explicit === 'sync' || explicit === 'dynamic') return explicit;

  const key = normalizeLockRequestId(req);
  if (key === 'lock_current_sync') return 'sync';
  if (key === 'lock_current_dynamic') return 'dynamic';

  const label = String(req.label || '').toLowerCase();
  if (label.includes('lock dynamic') || label.includes('dynamic') || label.includes('動く')) return 'dynamic';
  if (label.includes('lock sync') || label.includes('sync') || label.includes('同期') || label.includes('readme')) return 'sync';

  return null;
}

function buildLyricsLockState(requests, config, prevState) {
  const prevByRequest = prevState && prevState.byRequest && typeof prevState.byRequest === 'object'
    ? prevState.byRequest
    : {};

  const next = {
    sync: false,
    dynamic: false,
    byRequest: { ...prevByRequest }
  };

  if (Array.isArray(requests)) {
    requests.forEach((req) => {
      if (!req || typeof req !== 'object') return;

      const requestId = normalizeLockRequestId(req);
      const target = inferLockRequestTarget(req);
      const locked = req.locked === true || req.available === false || req.state === 'locked';

      if (requestId) next.byRequest[requestId] = locked;
      if (target && locked) next[target] = true;
    });
  }

  // Default lock states removed as per user request

  next.sync = !!next.byRequest.lock_current_sync || !!next.sync;
  next.dynamic = !!next.byRequest.lock_current_dynamic || !!next.dynamic;

  return next;
}

function syncLyricsLockState() {
  lyricsLockState = buildLyricsLockState(lyricsRequests, lyricsConfig, lyricsLockState);
  return lyricsLockState;
}

function isLockRequestLocked(req, state = lyricsLockState) {
  const target = inferLockRequestTarget(req);
  const requestId = normalizeLockRequestId(req);

  if (requestId && state?.byRequest && Object.prototype.hasOwnProperty.call(state.byRequest, requestId)) {
    return !!state.byRequest[requestId];
  }
  if (target && state && Object.prototype.hasOwnProperty.call(state, target)) {
    return !!state[target];
  }
  return !!req?.locked;
}

function refreshCandidateMenu() {
  if (!ui.uploadMenu) {
    if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    return;
  }
  const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
  const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
  if (!section || !list) return;
  list.innerHTML = '';
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) {
    section.style.display = 'none';
    if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    return;
  }
  section.style.display = 'block';
  lyricsCandidates.forEach((cand, idx) => {
    const id = getCandidateId(cand, idx);
    const btn = document.createElement('button');
    btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
    btn.dataset.action = 'candidate';
    btn.dataset.candidateId = id;
    btn.textContent = buildCandidateLabel(cand, idx);
    if (String(selectedCandidateId || '') === id) {
      btn.classList.add('is-selected');
    }
    btn.addEventListener('mouseenter', (ev) => {
      showCandidateHoverPreview(id, ev);
    });
    btn.addEventListener('mousemove', (ev) => {
      hoverPreviewMouseX = ev.clientX;
      hoverPreviewMouseY = ev.clientY;
      hoverPreviewAnchorEl = ev.currentTarget || hoverPreviewAnchorEl;
      updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
    });
    btn.addEventListener('mouseleave', () => {
      hideCandidateHoverPreview();
    });
    list.appendChild(btn);
  });
  if (ui.lyricsBtn) {
    ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    void ui.lyricsBtn.offsetWidth;
    ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
  }
}

function refreshLockMenu() {
  if (!ui.uploadMenu) return;
  const lockSection = ui.uploadMenu.querySelector('.ytm-upload-menu-locks');
  const lockList = lockSection ? lockSection.querySelector('.ytm-upload-menu-lock-list') : null;
  const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
  if (!lockSection || !lockList || !addSyncBtn) return;
  const lockState = syncLyricsLockState();
  lockList.innerHTML = '';
  const mergedRequests = [];
  if (Array.isArray(lyricsRequests)) {
    lyricsRequests.forEach(r => { if (r) mergedRequests.push({ ...r }); });
  }
  const ensureRequest = (id, label, target) => {
    const idLower = String(id).toLowerCase();
    if (mergedRequests.some(r => String(r.request || r.id || '').toLowerCase() === idLower)) return;
    mergedRequests.push({ request: id, label, target });
  };
  // ensureRequest for lock_current_sync and lock_current_dynamic removed as per user request
  const activeReqs = mergedRequests.filter(r => {
    if (!r) return false;
    if (r.has_lyrics) return true;
    if (r.target === 'sync' || r.target === 'dynamic') return true;
    const key = String(r.request || r.id || '').toLowerCase();
    if (!key) return false;
    return key.startsWith('lock_current_');
  });
  if (!activeReqs.length) {
    lockSection.style.display = 'none';
  } else {
    lockSection.style.display = 'block';
    activeReqs.forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'ytm-upload-menu-item';
      btn.dataset.action = 'lock-request';
      btn.dataset.requestId = r.request || r.id || '';
      btn.textContent = r.label || r.request || r.id || '歌詞を確定';
      const locked = isLockRequestLocked(r, lockState);
      if (locked) {
        btn.classList.add('ytm-upload-menu-item-disabled');
        btn.title = 'すでに確定された歌詞です';
      }
      lockList.appendChild(btn);
    });
  }
  const shouldDisableAddSync = !!lockState?.sync && !!lockState?.dynamic;
  addSyncBtn.classList.toggle('ytm-upload-menu-item-disabled', shouldDisableAddSync);
  if (shouldDisableAddSync) {
    addSyncBtn.dataset.disabledMessage = 'すでに確定された歌詞です';
    addSyncBtn.title = 'すでに確定された歌詞です';
  } else {
    delete addSyncBtn.dataset.disabledMessage;
    addSyncBtn.title = '';
  }
}


function setupUploadMenu(uploadBtn) {
  if (!ui.btnArea || ui.uploadMenu) return;
  ui.btnArea.style.position = 'relative';
  const menu = createEl('div', 'ytm-upload-menu', 'ytm-upload-menu');
  menu.innerHTML = `
      <div class="ytm-upload-menu-title">Lyrics</div>
      <button class="ytm-upload-menu-item" data-action="local">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg></span>
        <span>ローカル歌詞読み込み / ReadLyrics</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="add-sync">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>
        <span>歌詞同期を追加 / AddTiming</span>
      </button>
      <div class="ytm-upload-menu-locks" style="display:none;">
        <div class="ytm-upload-menu-subtitle">歌詞を確定 / Confirm</div>
        <div class="ytm-upload-menu-lock-list"></div>
      </div>
      <div class="ytm-upload-menu-candidates" style="display:none;">
        <div class="ytm-upload-menu-subtitle">別の歌詞を選択</div>
        <div class="ytm-upload-menu-candidate-list"></div>
      </div>
    `;
  ui.btnArea.appendChild(menu);
  ui.uploadMenu = menu;
  const toggleMenu = (show) => {
    if (!ui.uploadMenu) return;
    const cl = ui.uploadMenu.classList;
    if (show === undefined) cl.toggle('visible');
    else if (show) cl.add('visible');
    else { cl.remove('visible'); hideCandidateHoverPreview(); }
  };
  uploadBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleMenu();
  });
  ui.uploadMenu.addEventListener('click', (ev) => {
    const target = ev.target.closest('.ytm-upload-menu-item');
    if (!target) return;
    if (target.classList.contains('ytm-upload-menu-item-disabled')) {
      const msg = target.dataset.disabledMessage || 'この操作は現在利用できません';
      showToast(msg);
      return;
    }
    const action = target.dataset.action;
    const candId = target.dataset.candidateId || null;
    const reqId = target.dataset.requestId || null;
    toggleMenu(false);
    hideCandidateHoverPreview();
    if (action === 'local') {
      ui.input?.click();
    } else if (action === 'add-sync') {
      const videoUrl = getCurrentVideoUrl();
      const base = 'https://lrchub.coreone.work';
      const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
      window.open(lrchubUrl, '_blank');
    } else if (action === 'candidate' && candId) {
      selectCandidateById(candId);
    } else if (action === 'lock-request' && reqId) {
      sendLockRequest(reqId);
    }
  });

  if (!uploadMenuGlobalSetup) {
    uploadMenuGlobalSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.uploadMenu) return;
      if (!ui.uploadMenu.classList.contains('visible')) return;
      if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
      ui.uploadMenu.classList.remove('visible');
    }, true);
  }
  refreshCandidateMenu();
  refreshLockMenu();
}

function setupDeleteDialog(trashBtn) {
  if (!ui.btnArea || ui.deleteDialog) return;
  ui.btnArea.style.position = 'relative';
  const dialog = createEl('div', 'ytm-delete-dialog', 'ytm-confirm-dialog', `
      <div class="ytm-confirm-title">歌詞を削除</div>
      <div class="ytm-confirm-message">
        この曲の保存済み歌詞を削除しますか？<br>
        <span style="font-size:11px;opacity:0.7;">ローカルキャッシュのみ削除されます。</span>
      </div>
      <div class="ytm-confirm-buttons">
        <button class="ytm-confirm-btn cancel">キャンセル</button>
        <button class="ytm-confirm-btn danger">削除</button>
      </div>
    `);
  ui.btnArea.appendChild(dialog);
  ui.deleteDialog = dialog;
  const toggleDialog = (show) => {
    if (!ui.deleteDialog) return;
    const cl = ui.deleteDialog.classList;
    if (show === undefined) cl.toggle('visible');
    else if (show) cl.add('visible');
    else cl.remove('visible');
  };
  trashBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDialog();
  });
  const cancelBtn = dialog.querySelector('.ytm-confirm-btn.cancel');
  const dangerBtn = dialog.querySelector('.ytm-confirm-btn.danger');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDialog(false);
    });
  }
  if (dangerBtn) {
    dangerBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (currentKey) {
        storage.remove(currentKey);
        lyricsData = [];
        dynamicLines = null;
        duetSubDynamicLines = null;
        _duetExcludedTimes = new Set();
        lyricsCandidates = null;
        selectedCandidateId = null;
        lyricsRequests = null;
        lyricsConfig = null;
        lyricsLockState = null;
        setLyricsMeaningData(null);
        hideMeaningSummaryPopup();
        renderLyrics([]);
        refreshCandidateMenu();
        refreshLockMenu();
        refreshMeaningUi();
      }
      toggleDialog(false);
    });
  }
  if (!deleteDialogGlobalSetup) {
    deleteDialogGlobalSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.deleteDialog) return;
      if (!ui.deleteDialog.classList.contains('visible')) return;
      if (ui.deleteDialog.contains(ev.target) || trashBtn.contains(ev.target)) return;
      ui.deleteDialog.classList.remove('visible');
    }, true);
  }
}

function setupLangPills(groupId, currentValue, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const pills = Array.from(group.querySelectorAll('.ytm-lang-pill'));
  const apply = () => {
    pills.forEach(p => {
      p.classList.toggle('active', p.dataset.value === currentValue);
    });
  };
  apply();
  pills.forEach(p => {
    p.onclick = (e) => {
      e.stopPropagation();
      currentValue = p.dataset.value;
      apply();
      onChange(currentValue);
    };
  });
}

// ===================== UIサイズ =====================
// Immersion UI の寸法は CSS 側で calc(<基準px> * var(--ytm-ui-scale)) として
// 定義してあるので、この変数を書き換えるだけで全体が拡大縮小する。
const UI_SCALE_MIN = 0.7;
const UI_SCALE_MAX = 1.5;

function normalizeUiScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, num));
}

function applyUiScale(value) {
  const scale = normalizeUiScale(value);
  config.uiScale = scale;
  document.documentElement.style.setProperty('--ytm-ui-scale', String(scale));
  // 歌詞エリアの高さ・行高が変わると中央位置もずれるので、
  // 次のハイライト更新で中央スクロールをやり直させる。
  if (ui.lyrics) ui.lyrics._lastScrolledIndex = -1;
  if (PipManager && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer._lastScrolledIndex = -1;
  }
  // 上記のレイアウト変化で出る scroll イベントをユーザー操作と誤検出させない
  suppressUserScrollDetection(400);
  return scale;
}

async function initSettings() {
  if (ui.settings) return;
  ui.settings = createEl('div', 'ytm-settings-panel', '', ``);
  document.body.appendChild(ui.settings);
  await ensureMeaningDisplayPreferences();

  if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
  const cachedTrans = await storage.get('ytm_trans_enabled');
  if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

  const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
  if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;

  const mainLangStored = await storage.get('ytm_main_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  const subLangStored = await storage.get('ytm_sub_lang');
  if (subLangStored !== null) config.subLang = subLangStored;
  const uiLangStored = await storage.get('ytm_ui_lang');
  if (uiLangStored) config.uiLang = uiLangStored;

  const offsetStored = await storage.get('ytm_sync_offset');
  if (offsetStored !== null) config.syncOffset = offsetStored;
  const saveOffsetStored = await storage.get('ytm_save_sync_offset');
  if (saveOffsetStored !== null) config.saveSyncOffset = saveOffsetStored;
  const lrclibFallbackStored = await storage.get('ytm_lrclib_fallback');
  config.useLrcLibFallback = true;  // 歌詞ソース設定は廃止。常に全ソースを使う
  const animatedCaptionStored = await storage.get('ytm_animated_captions_enabled');
  if (animatedCaptionStored !== null) config.useAnimatedCaptions = !!animatedCaptionStored;
  const singerColorsStored = await storage.get('ytm_singer_colors_enabled');
  if (singerColorsStored !== null) config.useSingerColors = !!singerColorsStored;
  const sourceModeStored = await storage.get('ytm_lyric_source_mode');
  config.lyricSourceMode = normalizeSourceMode(sourceModeStored);

  const lowCpuStored = await storage.get('ytm_low_cpu_mode');
  if (lowCpuStored !== null) config.lowCpuMode = !!lowCpuStored;

  // ★スライダー初期値反映
  const weightStored = await storage.get('ytm_lyric_weight');
  if (weightStored) config.lyricWeight = weightStored;
  const brightStored = await storage.get('ytm_bg_brightness');
  if (brightStored) config.bgBrightness = brightStored;
  const uiScaleStored = await storage.get('ytm_ui_scale');
  if (uiScaleStored !== null) config.uiScale = normalizeUiScale(uiScaleStored);

  renderSettingsPanel();

  if (!settingsOutsideClickSetup) {
    settingsOutsideClickSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.settings) return;
      if (!ui.settings.classList.contains('active')) return;
      if (ui.settings.contains(ev.target)) return;
      if (ui.settingsBtn && ui.settingsBtn.contains(ev.target)) return;
      ui.settings.classList.remove('active');
    }, true);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && ui.settings && ui.settings.classList.contains('active')) {
        ui.settings.classList.remove('active');
      }
    });
  }
}


// ===== 共有翻訳: 残り文字数表示 =====
const COMMUNITY_REMAINING_TTL_MS = 60 * 1000; // 60s
let communityRemainingCache = { ts: 0, data: null, error: null };
let communityRemainingTimer = null;

function ensureCommunityRemainingTimer() {
  if (communityRemainingTimer) return;
  communityRemainingTimer = setInterval(() => {
    try {
      // 設定パネルが開いているときだけ更新（無駄な通信を減らす）
      if (ui.settings && ui.settings.classList.contains('active')) {
        updateCommunityRemainingUI(false);
      }
    } catch (_) { }
  }, 60 * 1000);
}

async function getCommunityRemaining(force = false) {
  const now = Date.now();
  if (!force && communityRemainingCache.data && (now - communityRemainingCache.ts) < COMMUNITY_REMAINING_TTL_MS) {
    return communityRemainingCache.data;
  }

  if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
    throw new Error('extension runtime is not available');
  }

  const resp = await new Promise((resolve) => {
    try {
      EXT.runtime.sendMessage({ type: 'GET_COMMUNITY_REMAINING' }, (r) => resolve(r));
    } catch (e) {
      resolve(null);
    }
  });

  if (!resp || !resp.ok) {
    const msg = resp && resp.error ? resp.error : 'failed';
    communityRemainingCache = { ts: now, data: null, error: msg };
    throw new Error(msg);
  }

  const data = resp.data || resp.remaining || resp;
  communityRemainingCache = { ts: now, data, error: null };
  return data;
}

async function updateCommunityRemainingUI(force = false) {
  const valEl = document.getElementById('community-remaining-val');
  if (!valEl) return;

  // 初回だけ「取得中…」
  if (!valEl.textContent || valEl.textContent === '--') {
    valEl.textContent = '取得中…';
  }

  try {
    const data = await getCommunityRemaining(force);

    const remaining =
      (data && (data.total_remaining ?? data.totalRemaining ?? data.total_remaining_total ?? data.total ?? data.free_remaining_total)) ?? null;

    if (remaining != null && !Number.isNaN(Number(remaining))) {
      valEl.textContent = Number(remaining).toLocaleString();
    } else {
      valEl.textContent = '--';
    }

    // 生データは hover で見れるように
    try {
      valEl.title = JSON.stringify(data, null, 2);
    } catch (_) { }
  } catch (e) {
    valEl.textContent = '--';
    valEl.title = e && e.message ? e.message : String(e);
  }
}

function renderSettingsPanel() {
  if (!ui.settings) return;

  // 現在の曲IDがあるか確認（キャッシュ削除ボタンの制御用）
  const hasCurrentSong = !!currentKey;

  // --- SVG Icons ---
  const ICONS = {
    visuals: `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5 11 5.67 11 6.5 10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5S18.33 12 17.5 12z"/></svg>`,
    trans: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
    data: `<svg viewBox="0 0 24 24"><path d="M12 2C7.58 2 4 3.79 4 6s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 8.55V12c0 2.21 3.58 4 8 4s8-1.79 8-4V8.55C18.83 9.99 15.72 11 12 11S5.17 9.99 4 8.55zM4 14.55V18c0 2.21 3.58 4 8 4s8-1.79 8-4v-3.45C18.83 15.99 15.72 17 12 17s-6.83-1.01-8-2.45z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.27 5.33A18.6 18.6 0 0 0 14.9 4l-.25.45c1.4.33 2.7.9 3.9 1.65a13.3 13.3 0 0 0-4.55-1.45 13.9 13.9 0 0 0-4 0A13.3 13.3 0 0 0 5.45 6.1c1.2-.75 2.5-1.32 3.9-1.65L9.1 4a18.6 18.6 0 0 0-4.37 1.33C2.14 9.2 1.44 12.97 1.79 16.69a18.7 18.7 0 0 0 5.6 2.83l1.2-1.66c-.66-.25-1.28-.55-1.87-.92l.46-.34a13.3 13.3 0 0 0 11.64 0l.46.34c-.59.37-1.21.67-1.87.92l1.2 1.66a18.7 18.7 0 0 0 5.6-2.83c.42-4.3-.7-8.03-2.94-11.36zM8.52 14.46c-.9 0-1.63-.82-1.63-1.83 0-1 .72-1.83 1.63-1.83.92 0 1.65.83 1.63 1.83 0 1.01-.72 1.83-1.63 1.83zm6.96 0c-.9 0-1.63-.82-1.63-1.83 0-1 .72-1.83 1.63-1.83.92 0 1.65.83 1.63 1.83 0 1.01-.71 1.83-1.63 1.83z"/></svg>`,
    github: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.570 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`
  };

  let extVersion = '';
  try { extVersion = (EXT && EXT.runtime && EXT.runtime.getManifest) ? (EXT.runtime.getManifest().version || '') : ''; } catch (_) { }

  ui.settings.innerHTML = `
      <div class="settings-tabs">
        <div class="settings-tabs-header">
          <span class="settings-app-name">YTM Immersion</span>
          <span class="settings-app-caption">Settings</span>
        </div>
        <button class="settings-tab-btn active" data-tab="visuals">
          ${ICONS.visuals}<span>Visuals</span>
        </button>
        <button class="settings-tab-btn" data-tab="translation">
          ${ICONS.trans}<span>Translation</span>
        </button>
        <button class="settings-tab-btn" data-tab="data">
          ${ICONS.data}<span>Data & Reset</span>
        </button>

        <div class="settings-tabs-footer">
           <div class="settings-links">
             <a class="settings-link-btn" href="https://discord.gg/cpBCACpt6j"
                target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord">
               ${ICONS.discord}
             </a>
             <a class="settings-link-btn" href="https://github.com/naikaku1/YTM_Immersion"
                target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub">
               ${ICONS.github}
             </a>
           </div>
           <button id="save-settings-btn" class="settings-save-btn">
             ${ICONS.save}
             <span>${t('settings_save')}</span>
           </button>
           ${extVersion ? `<div class="settings-version">v${extVersion}</div>` : ''}
        </div>
      </div>

      <div class="settings-panels">
        <div class="settings-panels-header">
          <h3>${t('settings_title')}</h3>
          <button id="ytm-settings-close-btn" class="ytm-unified-close-btn size-32" title="Close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>

        <div class="settings-scroll-area">

          <div class="settings-panel active" id="panel-visuals">
            <div class="settings-section-title">${t('settings_sec_display')}</div>
            <div class="settings-group-card">
              <div class="setting-row">
                <span class="setting-name">UI Language</span>
                <div class="ytm-lang-group" id="ui-lang-group"></div>
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_left_align')}</span>
                <input type="checkbox" id="left-align-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_keep_past_lyrics')}</span>
                <input type="checkbox" id="keep-past-lyrics-toggle">
              </label>
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">UIサイズ (UI Size)</span>
                  <span class="setting-value-badge" id="ui-scale-val">${Math.round((config.uiScale || 1) * 100)}%</span>
                </div>
                <input type="range" id="ui-scale-slider" min="0.7" max="1.5" step="0.05" value="${config.uiScale || 1}">
              </div>
            </div>

            <div class="settings-section-title">${t('settings_sec_bg')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_apple_bg')}</span>
                <input type="checkbox" id="apple-bg-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_low_cpu_mode')}</span>
                <input type="checkbox" id="low-cpu-toggle">
              </label>
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">背景の明るさ (Brightness)</span>
                  <span class="setting-value-badge" id="bright-val">${Math.round((config.bgBrightness || DEFAULT_BG_BRIGHTNESS) * 100)}%</span>
                </div>
                <input type="range" id="bright-slider" min="0.1" max="1.0" step="0.05" value="${config.bgBrightness || DEFAULT_BG_BRIGHTNESS}">
              </div>
            </div>

            <div class="settings-section-title">${t('settings_sec_lyrics')}</div>
            <div class="settings-group-card">
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">歌詞の太さ (Weight)</span>
                  <span class="setting-value-badge" id="weight-val">${config.lyricWeight || 800}</span>
                </div>
                <input type="range" id="weight-slider" min="100" max="900" step="100" value="${config.lyricWeight || 800}">
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_animated_captions')}</span>
                <input type="checkbox" id="animated-caption-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_singer_colors')}</span>
                <input type="checkbox" id="singer-colors-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">歌詞の解説がある場合常に表示</span>
                <input type="checkbox" id="meaning-always-toggle">
              </label>
            </div>

            <div class="settings-section-title">${t('settings_sec_data_source')}</div>
            <div class="settings-group-card">
              <div class="setting-row stacked">
                <span class="setting-name">${t('settings_source_auto_title')}</span>
                <span class="setting-desc">${t('settings_source_auto_desc')}</span>
                <div class="ytm-lang-group" id="lyric-source-group">
                  <button class="ytm-lang-pill" data-value="ytm">${t('settings_source_ytm')}</button>
                  <button class="ytm-lang-pill" data-value="lrchub">${t('settings_source_lrchub')}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-translation">
            <div class="settings-section-title">Translation & Features</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_trans')}</span>
                <input type="checkbox" id="trans-toggle">
              </label>
              <div class="setting-row stacked" id="shared-trans-row">
                <label class="setting-row-top toggle-label">
                  <span class="setting-name">${t('settings_shared_trans')}</span>
                  <input type="checkbox" id="shared-trans-toggle">
                </label>
                <div class="setting-row-top setting-subline" style="display:none">
                  <span class="setting-desc">共有翻訳 残り文字数</span>
                  <span id="community-remaining-val" class="setting-value-badge">--</span>
                </div>
              </div>
            </div>

            <div class="settings-group-card">
               <div class="setting-row stacked">
                  <span class="setting-name">${t('settings_main_lang')}</span>
                  <div class="ytm-lang-group" id="main-lang-group">
                    <button class="ytm-lang-pill" data-value="original">Original</button>
                    <button class="ytm-lang-pill" data-value="ja">日本語</button>
                    <button class="ytm-lang-pill" data-value="en">English</button>
                    <button class="ytm-lang-pill" data-value="ko">한국어</button>
                  </div>
               </div>
               <div class="setting-row stacked">
                  <span class="setting-name">${t('settings_sub_lang')}</span>
                  <div class="ytm-lang-group" id="sub-lang-group">
                    <button class="ytm-lang-pill" data-value="original">Original</button>
                    <button class="ytm-lang-pill" data-value="ja">日本語</button>
                    <button class="ytm-lang-pill" data-value="en">English</button>
                    <button class="ytm-lang-pill" data-value="ko">한국어</button>
                    <button class="ytm-lang-pill" data-value="zh">中文</button>
                  </div>
               </div>
               <div class="setting-row stacked">
                 <span class="setting-name">DeepL API Key <span class="setting-tag">Optional</span></span>
                 <input type="password" id="deepl-key-input" class="setting-input-text" placeholder="Paste your API key here" autocomplete="off">
               </div>
            </div>

            <div class="settings-group-card">
               <div class="setting-row">
                  <span class="setting-name">${t('settings_sync_offset')}</span>
                  <div class="setting-number-wrap">
                    <input type="number" id="sync-offset-input" class="setting-input-number" placeholder="0">
                    <span class="setting-unit">ms</span>
                  </div>
               </div>
               <label class="setting-row toggle-label">
                 <span class="setting-name secondary">${t('settings_sync_offset_save')}</span>
                 <input type="checkbox" id="sync-offset-save-toggle">
               </label>
            </div>
          </div>

          <div class="settings-panel" id="panel-data">
            <div class="settings-section-title">Data Management</div>
            <div class="settings-group-card">
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">この曲の歌詞データを削除</span>
                  <span class="setting-desc">現在再生中の曲の歌詞キャッシュのみを削除します</span>
                </div>
                <button id="delete-current-cache-btn" class="settings-action-btn btn-danger" ${hasCurrentSong ? '' : 'disabled'}>
                  ${ICONS.trash}<span>削除</span>
                </button>
              </div>
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">すべての歌詞データを削除</span>
                  <span class="setting-desc">保存されているすべての歌詞データを削除します（設定は保持されます）</span>
                </div>
                <button id="clear-all-lyrics-cache-btn" class="settings-action-btn btn-danger strong">
                  ${ICONS.trash}<span>全削除</span>
                </button>
              </div>
            </div>

            <div class="settings-section-title">Reset</div>
            <div class="settings-group-card">
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">設定をリセット (Reset All)</span>
                  <span class="setting-desc">拡張機能のすべての設定を初期状態に戻します</span>
                </div>
                <button id="clear-all-btn" class="settings-action-btn btn-neutral">リセット</button>
              </div>
            </div>

          </div>

        </div>
      </div>
    `;
  // --- Tab Switching Logic ---
  const tabs = ui.settings.querySelectorAll('.settings-tab-btn');
  const panels = ui.settings.querySelectorAll('.settings-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      ui.settings.querySelector(`#panel-${tabId}`).classList.add('active');
    });
  });


  // 値の反映
  document.getElementById('deepl-key-input').value = config.deepLKey || '';
  document.getElementById('trans-toggle').checked = config.useTrans;
  document.getElementById('shared-trans-toggle').checked = !!config.useSharedTranslateApi;
  document.getElementById('left-align-toggle').checked = !!config.leftAlignInfo;
  document.getElementById('keep-past-lyrics-toggle').checked = !!config.keepPastLyrics;
  document.getElementById('apple-bg-toggle').checked = !!config.appleBg;
  document.getElementById('low-cpu-toggle').checked = !!config.lowCpuMode;
  document.getElementById('animated-caption-toggle').checked = !!config.useAnimatedCaptions;
  document.getElementById('singer-colors-toggle').checked = !!config.useSingerColors;
  document.getElementById('meaning-always-toggle').checked = !!config.alwaysShowMeaning;

  // 共有翻訳の残り文字数（保存済み値を表示）
  document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
  document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
  document.getElementById('sync-offset-save-toggle').checked = config.saveSyncOffset;

  // スライダーイベント設定
  // トラックの進捗フィル（CSS変数 --fill）を現在値に合わせて更新する
  const updateSliderFill = (slider) => {
    if (!slider) return;
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const val = parseFloat(slider.value || '0');
    const pct = (max > min) ? ((val - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--fill', pct.toFixed(1) + '%');
  };

  const wSlider = document.getElementById('weight-slider');
  const bSlider = document.getElementById('bright-slider');
  const sSlider = document.getElementById('ui-scale-slider');
  updateSliderFill(wSlider);
  updateSliderFill(bSlider);
  updateSliderFill(sSlider);
  if (sSlider) {
    sSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('ui-scale-val').textContent = Math.round(val * 100) + '%';
      applyUiScale(val);
      updateSliderFill(e.target);
    });
  }
  if (wSlider) {
    wSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('weight-val').textContent = val;
      config.lyricWeight = val;
      document.documentElement.style.setProperty('--ytm-lyric-weight', val);
      updateSliderFill(e.target);
    });
  }
  if (bSlider) {
    bSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('bright-val').textContent = Math.round(val * 100) + '%';
      document.documentElement.style.setProperty('--ytm-bg-brightness', val);
      updateSliderFill(e.target);
    });
  }

  // 言語ピル設定
  setupLangPills('main-lang-group', config.mainLang, v => { config.mainLang = v; });
  setupLangPills('sub-lang-group', config.subLang, v => { config.subLang = v; });
  setupLangPills('lyric-source-group', config.lyricSourceMode || 'ytm', v => { config.lyricSourceMode = v; });
  refreshUiLangGroup();

  // 閉じるボタン
  const closeBtn = document.getElementById('ytm-settings-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      ui.settings.classList.remove('active');
    };
  }

  // 保存ボタンの処理
  document.getElementById('save-settings-btn').onclick = async () => {
    const prevAlwaysShowMeaning = !!config.alwaysShowMeaning;
    const [
      savedDeepLKey,
      savedMainLang,
      savedSubLang,
      savedUseTrans,
      savedSharedTrans,
      savedUiLang,
      savedAnimatedCaptions,
      savedLrcLibFallback,
      savedSourceMode
    ] = await Promise.all([
      storage.get('ytm_deepl_key'),
      storage.get('ytm_main_lang'),
      storage.get('ytm_sub_lang'),
      storage.get('ytm_trans_enabled'),
      storage.get('ytm_shared_trans_enabled'),
      storage.get('ytm_ui_lang'),
      storage.get('ytm_animated_captions_enabled'),
      storage.get('ytm_lrclib_fallback'),
      storage.get('ytm_lyric_source_mode')
    ]);

    const prevDeepLKey = savedDeepLKey || '';
    const prevMainLang = savedMainLang || 'original';
    const prevSubLang = savedSubLang !== null ? savedSubLang : 'en';
    const prevUseTrans = savedUseTrans !== null ? savedUseTrans : false;
    const prevUseSharedTrans = savedSharedTrans !== null ? savedSharedTrans : false;
    const prevUiLang = savedUiLang || 'ja';
    const prevAnimatedCaptions = savedAnimatedCaptions !== null ? !!savedAnimatedCaptions : false;
    const prevUseLrcLibFallback = savedLrcLibFallback !== null ? !!savedLrcLibFallback : true;
    const prevSourceMode = savedSourceMode || 'standard';

    // 画面から値を取得
    config.deepLKey = document.getElementById('deepl-key-input').value.trim();
    config.useTrans = document.getElementById('trans-toggle').checked;
    config.useSharedTranslateApi = document.getElementById('shared-trans-toggle').checked;
    config.leftAlignInfo = document.getElementById('left-align-toggle').checked;
    config.keepPastLyrics = document.getElementById('keep-past-lyrics-toggle').checked;
    config.appleBg = document.getElementById('apple-bg-toggle').checked;
    config.lowCpuMode = document.getElementById('low-cpu-toggle').checked;
    config.useAnimatedCaptions = document.getElementById('animated-caption-toggle').checked;
    config.useSingerColors = document.getElementById('singer-colors-toggle').checked;
    config.alwaysShowMeaning = document.getElementById('meaning-always-toggle').checked;
    config.lyricWeight = document.getElementById('weight-slider').value;
    config.bgBrightness = document.getElementById('bright-slider').value;
    config.uiScale = normalizeUiScale(document.getElementById('ui-scale-slider')?.value);

    const offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
    config.syncOffset = isNaN(offsetVal) ? 0 : offsetVal;
    config.saveSyncOffset = document.getElementById('sync-offset-save-toggle').checked;

    // Persist every value before re-rendering. applyLyricsText/loadLyrics read some
    // settings back from storage, so fire-and-forget writes can restore stale values.
    await Promise.all([
      storage.set('ytm_deepl_key', config.deepLKey),
      storage.set('ytm_trans_enabled', config.useTrans),
      storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi),
      storage.set('ytm_left_align', config.leftAlignInfo),
      storage.set('ytm_keep_past_lyrics', config.keepPastLyrics),
      storage.set('ytm_apple_bg', config.appleBg),
      storage.set('ytm_low_cpu_mode', config.lowCpuMode),
      storage.set('ytm_animated_captions_enabled', config.useAnimatedCaptions),
      storage.set('ytm_singer_colors_enabled', config.useSingerColors),
      storage.set('ytm_lrclib_fallback', config.useLrcLibFallback),
      storage.set(MEANING_ALWAYS_SHOW_KEY, config.alwaysShowMeaning),
      storage.set('ytm_main_lang', config.mainLang),
      storage.set('ytm_sub_lang', config.subLang),
      storage.set('ytm_ui_lang', config.uiLang),
      storage.set('ytm_lyric_weight', config.lyricWeight),
      storage.set('ytm_bg_brightness', config.bgBrightness),
      storage.set('ytm_ui_scale', config.uiScale),
      storage.set('ytm_sync_offset', config.syncOffset),
      storage.set('ytm_save_sync_offset', config.saveSyncOffset),
      storage.set('ytm_lyric_source_mode', config.lyricSourceMode)
    ]);

    document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
    document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
    document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
    document.body.classList.toggle('ytm-lightweight-mode', !!config.lowCpuMode);
    document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    if (PipManager.pipWindow?.document) {
      PipManager.pipWindow.document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    }
    document.documentElement.style.setProperty('--ytm-lyric-weight', config.lyricWeight);
    document.documentElement.style.setProperty('--ytm-bg-brightness', config.bgBrightness);
    applyUiScale(config.uiScale);

    const translationChanged = (
      prevDeepLKey !== config.deepLKey ||
      prevMainLang !== config.mainLang ||
      prevSubLang !== config.subLang ||
      prevUseTrans !== config.useTrans ||
      prevUseSharedTrans !== config.useSharedTranslateApi
    );
    const animatedCaptionsChanged = prevAnimatedCaptions !== config.useAnimatedCaptions;
    const lyricsSourceChanged = (
      prevSourceMode !== config.lyricSourceMode ||
      prevUseLrcLibFallback !== config.useLrcLibFallback
    );
    const uiLanguageChanged = prevUiLang !== config.uiLang;
    const meaningAlwaysChanged = prevAlwaysShowMeaning !== config.alwaysShowMeaning;

    ui.settings.classList.remove('active');

    if (animatedCaptionsChanged || lyricsSourceChanged) {
      const metaNow = getMetadata();
      if (metaNow?.title && metaNow?.artist) {
        await loadLyrics(metaNow);
      } else if (lastRawLyricsText) {
        await applyLyricsText(lastRawLyricsText);
      }
    } else if (translationChanged) {
      if (lastRawLyricsText) {
        await applyLyricsText(lastRawLyricsText);
      } else {
        const metaNow = getMetadata();
        if (metaNow?.title && metaNow?.artist) await loadLyrics(metaNow);
      }
    }

    if (meaningAlwaysChanged) {
      if (config.alwaysShowMeaning && lyricsMeaning) {
        meaningPanelVisible = true;
        meaningHoverVisible = false;
        meaningHoverIndex = -1;
      } else if (!isMeaningPersistentlyVisible()) {
        meaningPanelVisible = false;
      }
      refreshMeaningUi();
    }

    if (uiLanguageChanged) {
      const replayWasActive = !!ui.replayPanel?.classList.contains('active');
      const replayRange = ui.replayPanel?.dataset?.range || 'day';
      if (ui.replayPanel) {
        ui.replayPanel.remove();
        ui.replayPanel = null;
        createReplayPanel();
        ui.replayPanel.dataset.range = replayRange;
        ui.replayPanel.querySelectorAll('.ytm-lang-pill').forEach(pill => {
          pill.classList.toggle('active', pill.dataset.range === replayRange);
        });
        if (replayWasActive) {
          ui.replayPanel.classList.add('active');
          ReplayManager.renderUI();
        }
      }
      renderSettingsPanel();
    }

    showToast(t('settings_saved'));
  };

  // リセットボタン
  document.getElementById('clear-all-btn').onclick = storage.clear;

  // すべての歌詞データを削除ボタンの処理
  const clearLyricsBtn = document.getElementById('clear-all-lyrics-cache-btn');
  if (clearLyricsBtn) {
    clearLyricsBtn.onclick = async () => {
      if (confirm('保存されているすべての歌詞データを削除しますか？\n（設定や再生履歴は保持されます）')) {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.get(null, async (items) => {
          const keysToDelete = Object.keys(items).filter(k => k.includes('///'));
          if (keysToDelete.length > 0) {
            await new Promise(resolve => chrome.storage.local.remove(keysToDelete, resolve));
          }
          showToast('すべての歌詞キャッシュを削除しました');
          location.reload();
        });
      }
    };
  }

  // キャッシュ削除ボタンの処理
  const delBtn = document.getElementById('delete-current-cache-btn');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!currentKey) return;
      if (confirm('現在の曲の歌詞キャッシュを削除しますか？\n（歌詞データ、同期情報などがリセットされます）')) {
        await storage.remove(currentKey);

        lyricsData = [];
        dynamicLines = null;
        duetSubDynamicLines = null;
        _duetExcludedTimes = new Set();
        lyricsCandidates = null;
        selectedCandidateId = null;
        lyricsRequests = null;
        lyricsConfig = null;
        lyricsLockState = null;

        renderLyrics([]);
        refreshCandidateMenu();
        refreshLockMenu();

        showToast('歌詞キャッシュを削除しました');
      }
    };
  }
}

function createReplayPanel() {
  ui.replayPanel = createEl('div', 'ytm-replay-panel', '', `
      <button class="replay-close-btn ytm-unified-close-btn size-40"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <h3>Daily Replay</h3>
      
      <div class="ytm-lang-group" style="margin-bottom: 20px;">
        <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
        <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
        <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

      <button id="replay-reset-action" class="replay-footer-btn">${t('settings_reset')} History</button>
    `);

  document.body.appendChild(ui.replayPanel);

  ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
    ui.replayPanel.classList.remove('active');
  };

  const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
  pills.forEach(p => {
    p.onclick = (e) => {
      pills.forEach(x => x.classList.remove('active'));
      e.target.classList.add('active');
      ui.replayPanel.dataset.range = e.target.dataset.range;
      ReplayManager.renderUI();
    };
  });

  document.getElementById('replay-reset-action').onclick = async () => {
    if (confirm(t('replay_reset_confirm'))) {
      await storage.remove(ReplayManager.HISTORY_KEY);
      ReplayManager.renderUI();
    }
  };
}

// ===================== Artist Seamless Switch =====================
const SWITCH_NOISE_KEYWORDS = [
  '歌ってみた', '弾いてみた', '弾いてみたけど', '踊ってみた', '叩いてみた',
  '歌われてみた', '演奏してみた', '演奏動画',
  'cover', 'covered', 'karaoke', 'カラオケ',
  'acoustic', 'live', 'remix', 'piano',
  'arrange', 'off vocal', 'instrumental', 'full chorus', 'short ver'
];

function _switchQueryForMeta(meta) {
  // Search title only — not title+artist, so we get all versions
  return (meta?.title || '').trim();
}

function _filterSwitchResults(items, meta) {
  const titleLower = (meta?.title || '').toLowerCase();
  return items.filter(item => {
    const t = (item.title || '').toLowerCase();
    const ch = (item.channel || '').toLowerCase();
    // Keep items whose title shares words with the song title (looser check)
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 1);
    const hasTitle = titleWords.some(w => t.includes(w));
    if (!hasTitle) return false;
    // Exclude noise keywords
    for (const kw of SWITCH_NOISE_KEYWORDS) {
      if (t.includes(kw) || ch.includes(kw)) return false;
    }
    return true;
  });
}

async function searchYTMAlternatives(meta) {
  const q = _switchQueryForMeta(meta);
  if (!q) return [];
  // Use YouTube Music's InnerTube API — same endpoint the web app itself uses
  try {
    const resp = await fetch('https://music.youtube.com/youtubei/v1/search?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '67', 'X-YouTube-Client-Version': '1.20240101.01.00' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'ja',
            gl: 'JP',
          }
        },
        query: q
        // No params = search all types (songs, videos, albums, etc.)
      })
    });
    if (!resp.ok) { console.warn('[Switch] InnerTube API error:', resp.status); return []; }
    const data = await resp.json();

    const results = [];
    const walk = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 30) return;
      if (obj.musicResponsiveListItemRenderer) {
        const r = obj.musicResponsiveListItemRenderer;
        const videoId =
          r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.find(x => x.navigationEndpoint?.watchEndpoint)?.navigationEndpoint?.watchEndpoint?.videoId;
        const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
        const subtitle = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
        if (videoId && title) results.push({ videoId, title, channel: subtitle, thumb });
        return; // don't descend into an item we already parsed
      }
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val)) val.forEach(v => walk(v, depth + 1));
        else if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };
    walk(data);
    const seen = new Set();
    return results.filter(r => { if (seen.has(r.videoId)) return false; seen.add(r.videoId); return true; });
  } catch (e) {
    console.error('[Switch] Search failed:', e);
    return [];
  }
}


function setupSwitchPanel(triggerBtn) {
  // Toggle: close if already open
  const existing = document.getElementById('ytm-switch-panel');
  if (existing) { existing.remove(); return; }

  const meta = getMetadata();
  if (!meta || !meta.title) { showToast('曲名情報を取得できませんでした'); return; }

  const panel = document.createElement('div');
  panel.id = 'ytm-switch-panel';
  panel.className = 'ytm-switch-panel';
  panel.innerHTML = `
      <div class="ytm-switch-header">
        <span>🔄 代替バージョンを検索: ${escHtml(meta.title)}</span>
        <button class="ytm-switch-close ytm-unified-close-btn size-26" id="ytm-switch-close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div class="ytm-switch-list" id="ytm-switch-list">
        <div class="ytm-switch-loading">検索中…</div>
      </div>
    `;
  document.body.appendChild(panel);

  // Position panel ABOVE the trigger button
  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    const panelWidth = 360;
    const isMoviemode = triggerBtn.classList.contains("moviemode");
    let left = rect.left + rect.width / 2 - panelWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    panel.style.position = 'fixed';
    panel.style.left = `${left}px`;
    panel.style.bottom = isMoviemode ? 'auto' : `${(window.innerHeight - rect.top + 10)}px`;
    panel.style.top = isMoviemode ? `${rect.top - 10 + 65}px` : 'auto';// 65pxはちょうどいい高さオフセット
    panel.style.right = 'auto';
  }

  document.getElementById('ytm-switch-close').onclick = () => panel.remove();
  setTimeout(() => {
    document.addEventListener('click', function outsideClick(ev) {
      if (!panel.contains(ev.target) && !ev.target.closest('#ytm-switch-btn')) {
        panel.remove();
        document.removeEventListener('click', outsideClick, true);
      }
    }, true);
  }, 100);

  searchYTMAlternatives(meta).then(rawResults => {
    const results = _filterSwitchResults(rawResults, meta);
    const listEl = document.getElementById('ytm-switch-list');
    if (!listEl) return;

    if (!results.length) {
      // Show all unfiltered results if filter removed everything
      const fallback = rawResults.slice(0, 10);
      if (!fallback.length) {
        listEl.innerHTML = '<div class="ytm-switch-loading">候補が見つかりませんでした</div>';
        return;
      }
      listEl.innerHTML = '<div class="ytm-switch-loading" style="font-size:10px;opacity:0.6;padding:6px 10px">フィルターを緩めて表示しています</div>';
      renderSwitchItems(listEl, fallback, false);
      return;
    }
    listEl.innerHTML = '';
    renderSwitchItems(listEl, results, true);
  });
}

function renderSwitchItems(listEl, items, clearFirst) {
  if (clearFirst) listEl.innerHTML = '';
  const video = document.querySelector('video');
  // 連続再生対応: 曲開始オフセットを引いて曲内ローカル位置で別バージョンに飛ばす
  const currentTime = video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime - timeOffset) : 0;

  items.forEach(item => {
    const row = document.createElement('button');
    row.className = 'ytm-switch-item';
    row.innerHTML = `
        ${item.thumb ? `<img class="ytm-switch-thumb" src="${escHtml(item.thumb)}" alt="">` : '<div class="ytm-switch-thumb"></div>'}
        <div class="ytm-switch-info">
          <div class="ytm-switch-title">${escHtml(item.title)}</div>
          <div class="ytm-switch-channel">${escHtml(item.channel)}</div>
        </div>
      `;
    row.onclick = () => {
      document.getElementById('ytm-switch-panel')?.remove();
      const t = Math.floor(currentTime);
      const url = `https://music.youtube.com/watch?v=${item.videoId}&t=${t}s`;
      location.href = url;
    };
    listEl.appendChild(row);
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initLayout() {
  const existingWrapper = document.getElementById('ytm-custom-wrapper');
  if (existingWrapper && !ui.wrapper) {
    existingWrapper.remove();
    document.getElementById('ytm-custom-bg')?.remove();
  }

  if (document.getElementById('ytm-custom-wrapper')) {
    ui.wrapper = document.getElementById('ytm-custom-wrapper');
    ui.bg = document.getElementById('ytm-custom-bg');
    ui.lyricsStage = document.getElementById('ytm-lyrics-stage');
    ui.lyrics = document.getElementById('my-lyrics-container');
    ui.meaningPanel = document.getElementById('ytm-meaning-panel');
    ui.title = document.getElementById('ytm-custom-title');
    ui.artist = document.getElementById('ytm-custom-artist');
    ui.artwork = document.getElementById('ytm-artwork-container');
    ui.btnArea = document.getElementById('ytm-btn-area');
    document.getElementById('ytm-meaning-btn')?.remove();
    ui.meaningBtn = null;
    ui.summaryBtn = document.getElementById('ytm-meaning-summary-btn');
    ui.meaningSummaryBackdrop = document.getElementById('ytm-meaning-summary-backdrop');
    ui.meaningSummaryDialog = document.getElementById('ytm-meaning-summary-dialog');
    ui.lyricsBtn = ui.btnArea ? ui.btnArea.querySelector('.lyrics-btn') : null;
    ui.settingsBtn = document.getElementById('ytm-settings-btn');
    ui.uploadMenu = document.getElementById('ytm-upload-menu');
    ui.deleteDialog = document.getElementById('ytm-delete-dialog');
    setupAutoHideEvents();
    setupMeaningPanelHoverEvents();
    refreshMeaningUi();
    return;
  }
  ui.bg = createEl('div', 'ytm-custom-bg');
  document.body.appendChild(ui.bg);
  ui.wrapper = createEl('div', 'ytm-custom-wrapper');
  const leftCol = createEl('div', 'ytm-custom-left-col');
  ui.artwork = createEl('div', 'ytm-artwork-container');
  const info = createEl('div', 'ytm-custom-info-area');
  ui.title = createEl('div', 'ytm-custom-title');
  ui.artist = createEl('div', 'ytm-custom-artist');
  ui.btnArea = createEl('div', 'ytm-btn-area');

  const btns = [];
  const lyricsBtnConfig = { txt: 'Lyrics', cls: 'lyrics-btn', click: () => { } };

  //  PiPボタン
  const pipBtnConfig = {
    txt: 'PIP',
    cls: 'icon-btn',
    click: () => PipManager.toggle()
  };

  const replayBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>',
    cls: 'icon-btn',
    click: () => {
      if (!ui.replayPanel) {
        createReplayPanel();
      }
      ui.replayPanel.classList.add('active');
      ReplayManager.renderUI();
    }
  };


  const settingsBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    cls: 'icon-btn',
    click: async () => {
      initSettings();
      refreshUiLangGroup();
      ui.settings.classList.toggle('active');
    }
  };

  const switchBtnConfig = {
    txt: '',
    cls: 'icon-btn ytm-switch-icon-btn',
    click: (ev) => setupSwitchPanel(ev.currentTarget)
  };

  // ボタン配列に追加
  btns.push(lyricsBtnConfig, pipBtnConfig, replayBtnConfig, switchBtnConfig, settingsBtnConfig);

  btns.forEach(b => {
    const btn = createEl('button', '', `ytm-glass-btn ${b.cls || ''}`, b.txt);
    btn.onclick = b.click;
    ui.btnArea.appendChild(btn);
    if (b === lyricsBtnConfig) {
      ui.lyricsBtn = btn;
      setupUploadMenu(btn);
    }
    if (b === switchBtnConfig) {
      btn.id = 'ytm-switch-btn';
      // Use the custom icon image
      try {
        const iconUrl = chrome.runtime.getURL('src/assets/icons/ArtistChange.png');
        btn.innerHTML = `<img src="${iconUrl}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;" alt="ArtistChange">`;
      } catch (_) { btn.textContent = '🔄'; }
    }
    if (b === settingsBtnConfig) {
      btn.id = 'ytm-settings-btn';
      ui.settingsBtn = btn;
    }
  });

  ui.input = createEl('input');
  ui.input.type = 'file';
  ui.input.accept = '.lrc,.txt';
  ui.input.style.display = 'none';
  ui.input.onchange = handleUpload;
  document.body.appendChild(ui.input);
  info.append(ui.title, ui.artist, ui.btnArea);
  leftCol.append(ui.artwork, info);
  ui.lyricsStage = createEl('div', 'ytm-lyrics-stage');
  ui.lyrics = createEl('div', 'my-lyrics-container');
  ui.summaryBtn = createEl(
    'button',
    'ytm-meaning-summary-btn',
    'ytm-lyrics-summary-trigger',
    '<span aria-hidden="true">i</span>'
  );
  ui.summaryBtn.type = 'button';
  ui.summaryBtn.title = '要約';
  ui.summaryBtn.setAttribute('aria-label', '曲の要約を表示');
  ui.summaryBtn.onclick = () => showMeaningSummaryPopup();
  ui.artwork.appendChild(ui.summaryBtn);
  ui.meaningPanel = createEl('aside', 'ytm-meaning-panel', 'ytm-meaning-panel');
  ui.lyricsStage.append(ui.lyrics, ui.meaningPanel);
  ui.wrapper.append(leftCol, ui.lyricsStage);
  document.body.appendChild(ui.wrapper);
  ensureMeaningSummaryDialog();
  refreshMeaningUi();
  setupMeaningPanelHoverEvents();
  setupAutoHideEvents();
  setupScrollResumeEvents();
  if (isYTMPremiumUser()) setupMovieMode(); //moviemode setup
}

let lyricsLateRetryTimer = null;
let lyricsLateRetryKey = null;
const LYRICS_LATE_RETRY_DELAYS_MS = [15000, 30000];
const LYRICS_CACHE_VERSION = 2;

function clearLyricsLateRetry(targetKey = null) {
  if (targetKey && lyricsLateRetryKey && lyricsLateRetryKey !== targetKey) return;
  if (lyricsLateRetryTimer) {
    clearTimeout(lyricsLateRetryTimer);
    lyricsLateRetryTimer = null;
  }
  lyricsLateRetryKey = null;
}

function scheduleLyricsLateRetry(meta, targetKey, attempt = 0) {
  if (!targetKey || currentKey !== targetKey) return;
  const targetVideoId = currentLyricsVideoId || getCurrentVideoId() || '';
  if (lyricsLateRetryTimer) return;
  if (attempt >= LYRICS_LATE_RETRY_DELAYS_MS.length) return;

  const delayMs = LYRICS_LATE_RETRY_DELAYS_MS[attempt];
  lyricsLateRetryKey = targetKey;
  lyricsLateRetryTimer = setTimeout(() => {
    lyricsLateRetryTimer = null;
    lyricsLateRetryKey = null;
    if (currentKey !== targetKey) return;
    if (
      (currentLyricsVideoId || '') !== targetVideoId ||
      (getCurrentVideoId() || '') !== targetVideoId
    ) return;

    const metaNow = getMetadata() || meta;
    if (!metaNow) return;
    const keyNow = `${metaNow.title}///${metaNow.artist}`;
    if (keyNow !== targetKey) return;

    loadLyrics(metaNow, { lateRetryAttempt: attempt + 1 });
  }, delayMs);
}

async function loadLyrics(meta, options = {}) {
  await Promise.all([ensureMeaningDisplayPreferences(), runtimeSettingsReady]);
  if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
  const cachedTrans = await storage.get('ytm_trans_enabled');
  if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

  const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
  if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;
  const mainLangStored = await storage.get('ytm_main_lang');
  const subLangStored = await storage.get('ytm_sub_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
  const uiLangStored = await storage.get('ytm_ui_lang');
  if (uiLangStored) config.uiLang = uiLangStored;
  const lrclibFallbackStored = await storage.get('ytm_lrclib_fallback');
  config.useLrcLibFallback = true;  // 歌詞ソース設定は廃止。常に全ソースを使う
  const animatedCaptionStored = await storage.get('ytm_animated_captions_enabled');
  if (animatedCaptionStored !== null && animatedCaptionStored !== undefined) config.useAnimatedCaptions = !!animatedCaptionStored;
  const sourceModeStored = await storage.get('ytm_lyric_source_mode');
  config.lyricSourceMode = normalizeSourceMode(sourceModeStored);

  const thisKey = `${meta.title}///${meta.artist}`;
  const requestVideoId = getCurrentVideoId() || '';
  if (thisKey !== currentKey || requestVideoId !== (currentLyricsVideoId || '')) return;
  const requestId = `lyrics-${Date.now()}-${++lyricsRequestSequence}`;
  activeLyricsRequestId = requestId;
  currentLyricsResultPriority = 0;
  currentLyricsQuality = 0;
  // Invalidate an older applyLyricsText() call for the same track/video while
  // this newer request is being resolved.
  lyricsApplyEpoch += 1;
  let cached = await storage.get(thisKey);
  if (
    thisKey !== currentKey ||
    requestVideoId !== (currentLyricsVideoId || '') ||
    requestId !== activeLyricsRequestId
  ) return;
  dynamicLines = null;
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  singerMetadataRequestSequence += 1;
  singerMetadataRequestKey = '';
  currentSingerMetadataKey = '';
  currentLyricsRecordId = null;
  currentSingerMetadata = null;
  currentSingerCanonicalLyrics = '';
  duetSubLyricsRaw = '';
  lyricsCandidates = null;
  selectedCandidateId = null;
  // 曲ごとに必ず倒す。倒し忘れると、次の曲で YTM が取れなかったときも
  // LRCHub の差し替えを止め続けてしまう。
  currentLyricsFromPreferredYtm = false;
  lyricsRequests = null;
  lyricsConfig = null;
  lyricsLockState = null;
  lyricsTranslationMap = {};
  setLyricsMeaningData(null);
  let data = null;
  let dataPriority = 0;
  let dataQuality = 0;
  let noLyricsCached = false;
  let cachedSingerRecordId = null;
  let cachedCanonicalLyrics = '';
  if (cached !== null && cached !== undefined) {
    if (cached === NO_LYRICS_SENTINEL) {
      noLyricsCached = true;
    } else if (typeof cached === 'string') {
      // Legacy string entries may be old line-only network caches. Display
      // them immediately, but keep them provisional so fresh DynamicLRC can
      // upgrade them. New manual uploads are stored with manualLyrics=true.
      data = cached;
      dataPriority = 0;
      dataQuality = /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(cached) ? 2 : 1;
      currentLyricsResultPriority = 0;
      currentLyricsQuality = dataQuality;
    } else if (typeof cached === 'object') {
      const cachedVideoId = String(cached.video_id || cached.videoId || '');
      const cacheMatchesVideo = cached.cacheVersion === LYRICS_CACHE_VERSION &&
        cachedVideoId === requestVideoId;
      const cachedSource = String(cached.lyricsSource || cached.source || '').trim().toLowerCase();
      const cachedLrcLibIsFallback = cachedSource === 'lrclib' &&
        (config.lyricSourceMode || 'standard') === 'standard';
      const cacheSourceAllowed = !cachedLrcLibIsFallback || !!config.useLrcLibFallback;
      if (cacheMatchesVideo && cacheSourceAllowed) {
        const cachedSelection = selectLyricsPayload(cached);
        data = cachedSelection.text;
        cachedSingerRecordId = String(cached.record_id || cached.recordId || '').trim() || null;
        cachedCanonicalLyrics = cachedSelection.lyrics || data || '';
        dynamicLines = cachedSelection.dynamicLines;
        if (typeof cached.subLyrics === 'string') duetSubLyricsRaw = cached.subLyrics;
        if (cached.noLyrics) noLyricsCached = true;
        if (Array.isArray(cached.candidates)) lyricsCandidates = cached.candidates;
        if (Array.isArray(cached.requests)) lyricsRequests = cached.requests;
        if (cached.config) lyricsConfig = cached.config;
        if (cached.lockState && typeof cached.lockState === 'object') lyricsLockState = cached.lockState;
        if (cached.lrcMap || cached.translations) {
          lyricsTranslationMap = {
            ...normalizeTranslationsToLrcMapLocal(cached.translations),
            ...normalizeTranslationsToLrcMapLocal(cached.lrcMap)
          };
        }
        if (cached.meaningData) setLyricsMeaningData(cached.meaningData);
        currentLyricsResultPriority = cached.manualLyrics ? 3 : (cachedLrcLibIsFallback ? 1 : 2);
        dataPriority = currentLyricsResultPriority;
        currentLyricsQuality = cachedSelection.quality;
        dataQuality = cachedSelection.quality;
        updateLyricsSourceState({ ...cached, fallbackUsed: cachedLrcLibIsFallback }, !!data);
      }
    }
  }
  syncLyricsLockState();
  refreshCandidateMenu();
  refreshLockMenu();

  if (data && cachedSingerRecordId) {
    void requestSingerMetadataForLyrics(cachedSingerRecordId, cachedCanonicalLyrics, {
      trackKey: thisKey,
      videoId: requestVideoId,
    });
  }

  let renderedFromCache = false;
  if (
    data &&
    thisKey === currentKey &&
    requestVideoId === (currentLyricsVideoId || '') &&
    requestId === activeLyricsRequestId
  ) {
    applyLyricsText(data).then(() => {
      if (
        thisKey === currentKey &&
        requestVideoId === (currentLyricsVideoId || '') &&
        requestId === activeLyricsRequestId
      ) {
        refreshMeaningUi();
      }
    });
    renderedFromCache = true;
  }
  let needsRendering = !renderedFromCache;

  // Always fetch fresh data from URL as requested
  let gotLyrics = false;
  try {
    const track = meta.title.replace(/\s*[\(-\[].*?[\)-]].*/, '');
    const artist = meta.artist;
    const youtube_url = getCurrentVideoUrl();
    const video_id = requestVideoId;
    const translate_to = getRequestedLrchubTranslateLangs();
    const payload = {
      track,
      artist,
      youtube_url,
      video_id,
      use_lrclib: config.useLrcLibFallback,
      lyric_source_mode: config.lyricSourceMode || 'standard',
      request_id: requestId,
      track_key: thisKey,
    };
    if (translate_to.length) payload.translate_to = translate_to;

    // YouTube Music の行同期歌詞は content script からしか取れない
    // (Service Worker の fetch は Origin: chrome-extension:// が付いて YouTube に 403 で弾かれる)。
    // background への問い合わせと並列に走らせるので、待ち時間は増えない。
    const ytmPromise = (window.YTMLyrics && video_id)
      ? window.YTMLyrics.fetch(video_id, {
        // YTM が時刻なしの歌詞しか持っていない曲では、別リリースに同期版が
        // あることがある。その探索は数秒かかるので待たずに先へ進み、
        // 見つかった時だけここで差し替える。
        onUpgrade: (upgraded) => {
          if (!upgraded || !upgraded.hasSynced) return;
          void applyLateLyricsUpgrade({
            success: true,
            lyricsSource: 'ytm',
            lyrics: upgraded.lyrics,
            animated_lyrics: null,
            dynamicLines: null,
            track_key: thisKey,
            request_id: requestId,
            video_id,
          });
        },
      })
      : Promise.resolve(null);

    const backgroundPromise = new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'GET_LYRICS', payload },
        resolve
      );
    });

    // YTM優先で YTM が同期歌詞を持っているなら、LRCHub の完了を待つ意味はない。
    // 以前はここで background を無条件に await していたため、YTM が 250ms で
    // 返っていても LRCHub のレース(1.5秒)とフォールバック(各8秒)が終わるまで
    // 描画されず、並列に走らせた意味が消えていた。
    const preferYtmSource = (config.lyricSourceMode || 'ytm') === 'ytm';
    const ytmEarly = preferYtmSource ? await ytmPromise : null;
    const skipWaitingBackground = !!(ytmEarly && ytmEarly.hasSynced);

    let res = skipWaitingBackground
      // 既に返っていればメタデータ(候補・翻訳・解説)ごと使えるので、短時間だけ待つ
      ? await Promise.race([
        backgroundPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 400)),
      ])
      : await backgroundPromise;

    if (skipWaitingBackground && res === null) {
      // 間に合わなかった分は、届いた時にメタデータだけ反映する。
      // 歌詞そのものは YTM を採用済みなので触らない。
      const metaKey = thisKey, metaVideoId = video_id, metaRequestId = requestId;
      backgroundPromise.then(late => {
        if (!late || !late.success) return;
        if (metaKey !== currentKey || metaVideoId !== (currentLyricsVideoId || '')) return;
        if (metaRequestId !== activeLyricsRequestId) return;
        if (Array.isArray(late.requests)) lyricsRequests = late.requests;
        if (late.config) lyricsConfig = late.config;
        if (Array.isArray(late.candidates) && late.candidates.length) lyricsCandidates = late.candidates;
        lyricsTranslationMap = {
          ...(lyricsTranslationMap || {}),
          ...normalizeTranslationsToLrcMapLocal(late.translations),
          ...normalizeTranslationsToLrcMapLocal(late.lrcMap),
        };
        const lateMeaning = normalizeMeaningPayloadLocal(late);
        if (lateMeaning) setLyricsMeaningData(lateMeaning);
        syncLyricsLockState();
        refreshCandidateMenu();
        refreshLockMenu();
        refreshMeaningUi();
      }).catch(() => { });
    }
    if (
      thisKey !== currentKey ||
      video_id !== (currentLyricsVideoId || '') ||
      requestId !== activeLyricsRequestId
    ) return;
    YTMLog.log('[CS] GET_LYRICS response:', res);

    // 歌詞ソースの優先設定は 'ytm' / 'lrchub' の2択。どちらも他方へフォールバックする。
    //   YTM優先   … YTM に同期歌詞があればそれ。無ければ LRCHub / LrcLib
    //   LRCHub優先 … LRCHub / LrcLib が歌詞を返せばそれ。無ければ YTM
    // 品質スコアによる自動判定はしない。設定した側が確実に優先される方が予測しやすい。
    try {
      const preferYtm = preferYtmSource;
      const backgroundHasLyrics = !!res?.success &&
        typeof res.lyrics === 'string' && !!res.lyrics.trim();

      // LRCHub優先で、しかも LRCHub 側が既に歌詞を返しているなら YTM の結果は使わない。
      // ここで待つと、表示が YTM の完了まで丸ごと遅れてしまう
      // (カタログ解決が走る曲では1秒以上かかる)。走らせたままにして待たない。
      if (preferYtm || !backgroundHasLyrics) {
        const ytmRes = ytmEarly || await ytmPromise;
        const stillCurrent =
          thisKey === currentKey &&
          video_id === (currentLyricsVideoId || '') &&
          requestId === activeLyricsRequestId;

        // YTM が同期歌詞を持たない曲でも、歌詞テキスト自体は持っていることがある
        // (実測: 曲の約2割は cueRange を持たない = モバイルでも時刻なしで表示される)。
        // 以前はこれを丸ごと捨てていたため、「モバイルには歌詞があるのに
        // 拡張では何も出ない」曲が生まれていた。他にどこからも歌詞が来ない
        // ときの最後の受け皿として採用する。
        const ytmHasPlain = !!(ytmRes && !ytmRes.hasSynced &&
          typeof ytmRes.lyrics === 'string' && ytmRes.lyrics.trim());
        const useYtm = !!ytmRes && stillCurrent &&
          (ytmRes.hasSynced || (ytmHasPlain && !backgroundHasLyrics));

        if (useYtm) {
          const synced = !!ytmRes.hasSynced;
          YTMLog.log(`[CS] YouTube Music を採用 (${synced ? '同期' : '時刻なし'} / ${preferYtm ? 'YTM優先' : 'LRCHubが空のためフォールバック'})`);
          // フォールバックで採った場合は、あとから LRCHub が届いたら差し替えてよい。
          // 時刻なしの歌詞は同期歌詞に劣るので、YTM優先設定でも差し替えを許す。
          currentLyricsFromPreferredYtm = preferYtm && synced;
          res = {
            ...res,
            success: true,
            lyrics: ytmRes.lyrics,
            animated_lyrics: null,
            dynamicLines: null,
            lyricsSource: 'ytm',
            fallbackUsed: !preferYtm || !synced,
          };
        }
      }
    } catch (e) {
      console.warn('[CS] YouTube Music の取り込みに失敗:', e);
    }

    const selectedResponse = selectLyricsPayload(res);
    const responseLyrics = selectedResponse.lyrics;
    const responseAnimatedLyrics = selectedResponse.animatedLyrics;
    const preferredLyrics = selectedResponse.text;
    const hasResponseLyrics = !!res?.success && !!preferredLyrics.trim();
    const responsePriority = hasResponseLyrics ? (res?.fallbackUsed ? 1 : 2) : 0;
    // A late LRCHub event can overtake the original callback. Reject the
    // lower-priority fallback/failure before it mutates any LRCHub state.
    if (responsePriority < currentLyricsResultPriority) return;
    if (
      responsePriority === currentLyricsResultPriority &&
      responsePriority === 2 &&
      selectedResponse.quality < currentLyricsQuality
    ) return;

    // LRCHub 以外の軽量ソース(YTM / LrcLib)が勝ったレスポンスには
    // requests / config / candidates が入っていない。無条件に代入すると
    // それらを null で潰したうえで下のキャッシュ書き込みが永続化してしまう。
    if (Array.isArray(res?.requests)) lyricsRequests = res.requests;
    if (res?.config) lyricsConfig = res.config;
    syncLyricsLockState();
    if (Array.isArray(res?.candidates) && res.candidates.length) lyricsCandidates = res.candidates;
    lyricsTranslationMap = {
      ...(lyricsTranslationMap || {}),
      ...normalizeTranslationsToLrcMapLocal(res?.translations),
      ...normalizeTranslationsToLrcMapLocal(res?.lrcMap)
    };
    refreshCandidateMenu();
    refreshLockMenu();
    const nextMeaningData = normalizeMeaningPayloadLocal(res);
    if (nextMeaningData) setLyricsMeaningData(nextMeaningData);
    if (typeof res?.subLyrics === 'string' && res.subLyrics.trim()) duetSubLyricsRaw = res.subLyrics;

    if (hasResponseLyrics) {
      const isDifferent = (preferredLyrics !== data) ||
        (JSON.stringify(selectedResponse.dynamicLines) !== JSON.stringify(dynamicLines)) ||
        (res.subLyrics && res.subLyrics !== duetSubLyricsRaw);

      currentLyricsResultPriority = responsePriority;
      currentLyricsQuality = selectedResponse.quality;
      dataPriority = responsePriority;
      dataQuality = selectedResponse.quality;
      data = preferredLyrics;
      gotLyrics = true;
      dynamicLines = selectedResponse.dynamicLines;
      void requestSingerMetadataForLyrics(
        res.record_id,
        responseLyrics || preferredLyrics,
        { trackKey: thisKey, videoId: video_id }
      );
      updateLyricsSourceState(res, true);
      if (
        thisKey === currentKey &&
        video_id === (currentLyricsVideoId || '') &&
        requestId === activeLyricsRequestId &&
        responsePriority === currentLyricsResultPriority &&
        selectedResponse.quality === currentLyricsQuality
      ) {
        clearLyricsLateRetry(thisKey);
        const cacheRecord = {
          cacheVersion: LYRICS_CACHE_VERSION,
          video_id,
          record_id: res.record_id || null,
          lyrics: responseLyrics || data,
          animated_lyrics: responseAnimatedLyrics || null,
          dynamicLines: dynamicLines || null,
          noLyrics: false,
          subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : ''),
          meaningData: lyricsMeaning || null,
          candidates: lyricsCandidates || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: res.lyricsSource || null,
          fallbackUsed: !!res.fallbackUsed,
          lyricsQuality: selectedResponse.quality,
          offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
        };
        const isResponseCurrent = () => (
          thisKey === currentKey &&
          video_id === (currentLyricsVideoId || '') &&
          requestId === activeLyricsRequestId &&
          responsePriority === currentLyricsResultPriority &&
          selectedResponse.quality === currentLyricsQuality
        );
        const wroteCache = await enqueueLyricsCacheWrite(
          thisKey,
          cacheRecord,
          isResponseCurrent
        );
        if (wroteCache && isResponseCurrent() && (isDifferent || !renderedFromCache)) {
          needsRendering = true;
        }
      }
    } else {

    }
  } catch (e) {
    console.error('GET_LYRICS failed', e);
  }
  if (
    !gotLyrics &&
    !data &&
    thisKey === currentKey &&
    requestVideoId === (currentLyricsVideoId || '') &&
    requestId === activeLyricsRequestId &&
    currentLyricsResultPriority === 0 &&
    currentLyricsQuality === 0
  ) {
    const noLyricsIsCurrent = () => (
      thisKey === currentKey &&
      requestVideoId === (currentLyricsVideoId || '') &&
      requestId === activeLyricsRequestId &&
      currentLyricsResultPriority === 0 &&
      currentLyricsQuality === 0
    );
    try {
      const wroteNoLyrics = await enqueueLyricsCacheWrite(
        thisKey,
        NO_LYRICS_SENTINEL,
        noLyricsIsCurrent
      );
      if (!wroteNoLyrics) return;
    } catch (error) {
      console.warn('[YTM] Failed to cache the no-lyrics result:', error);
    }
    if (!noLyricsIsCurrent()) return;
    noLyricsCached = true;
    scheduleLyricsLateRetry(meta, thisKey, options.lateRetryAttempt || 0);
  }
  if (
    thisKey !== currentKey ||
    requestVideoId !== (currentLyricsVideoId || '') ||
    requestId !== activeLyricsRequestId
  ) return;
  if (!data && currentLyricsResultPriority === 0 && currentLyricsQuality === 0) {
    renderLyrics([]);
    refreshCandidateMenu();
    refreshLockMenu();
    refreshMeaningUi();
    return;
  }
  if (dataPriority !== currentLyricsResultPriority || dataQuality !== currentLyricsQuality) return;
  if (needsRendering) {
    await applyLyricsText(data);
  }
}

// Segmenter の生成は重いため1回だけ作って使い回す
const _jaWordSegmenter = new Intl.Segmenter('ja', { granularity: 'word' });

const optimizeLineBreaks = (text) => {
  if (!text) return '';

  const segments = Array.from(_jaWordSegmenter.segment(text));

  let html = '';
  let buffer = '';

  const rules = {
    suffixes: new Set([
      'て', 'に', 'を', 'は', 'が', 'の', 'へ', 'と', 'も', 'で', 'や', 'し', 'から', 'より', 'だけ', 'まで', 'こそ', 'さえ', 'でも', 'など', 'なら', 'くらい', 'ぐらい', 'ばかり',
      'ね', 'よ', 'な', 'さ', 'わ', 'ぞ', 'ぜ', 'かしら', 'かな', 'かも', 'だし', 'もん', 'もの',
      'って', 'けど', 'けれど', 'のに', 'ので', 'から', 'ため', 'よう', 'こと', 'もの', 'わけ', 'ほう', 'ところ', 'とおり',
      'た', 'だ', 'ない', 'たい', 'ます', 'ません', 'う', 'よう', 'れる', 'られる', 'せる', 'させる', 'ん', 'ず',
      'てた', 'てる', 'ちゃう', 'じゃん', 'なきゃ', 'なくちゃ', 'く', 'き', 'けれ', 'れば',
      'った', 'たら', 'たり',
      'か', 'かい', 'だい', 'いる', 'ある', 'くる', 'いく', 'みる', 'おく', 'しまう', 'ほしい', 'あげる', 'くれる', 'もらう',
      '、', '。', '，', '．', '…', '・', '！', '？', '!', '?', '~', '～', '“', '”', '‘', '’', ')', ']', '}', '」', '』', '】', '）'
    ]),

    isEnglish: (w) => /^[a-zA-Z0-9'\-\.,!?:;]+$/.test(w),
    isSpace: (w) => /^\s+$/.test(w),
    isOpenParen: (w) => /^[\(\[\{「『（【]$/.test(w),
    hasKanji: (w) => /[\u4E00-\u9FFF]/.test(w),
    isHiragana: (w) => /^[\u3040-\u309F\u30FC]+$/.test(w),
    isKatakana: (w) => /^[\u30A0-\u30FF\u30FC]+$/.test(w),
    startsWithSmallKana: (w) => /^[\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308E\u3095\u3096]/.test(w)
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const word = seg.segment;
    const next = segments[i + 1];

    buffer += word;

    if (!next) {
      html += `<span class="lyric-phrase">${buffer}</span>`;
      break;
    }

    const nextWord = next.segment;
    let shouldMerge = false;

    if (rules.startsWithSmallKana(nextWord)) {
      shouldMerge = true;
    }
    else if (rules.suffixes.has(nextWord)) {
      if (!rules.isOpenParen(nextWord)) {
        shouldMerge = true;
      }
    }

    else if (rules.hasKanji(word) && rules.isHiragana(nextWord)) {
      shouldMerge = true;
    }
    else if (rules.isKatakana(word) && rules.isKatakana(nextWord)) {
      shouldMerge = true;
    }
    else if ((rules.isEnglish(word) || rules.isSpace(word)) &&
      (rules.isEnglish(nextWord) || rules.isSpace(nextWord))) {
      shouldMerge = true;
    }

    if (shouldMerge) {
      continue;
    }

    html += `<span class="lyric-phrase">${buffer}</span>`;
    buffer = '';
  }

  return html;
};
function renderLyrics(data) {
  if (!ui.lyrics) return;
  document.body.classList.remove('ytm-animated-caption-mode');
  ui.lyrics.classList.remove('ytm-user-browsing-lyrics');
  animatedCaptionFrameKey = '';
  // 再描画によるscrollイベントをユーザースクロール扱いにしない
  suppressUserScrollDetection(500);
  ui.lyrics.innerHTML = '';
  ui.lyrics.scrollTop = 0;
  // 再描画後は前回のハイライト/スクロール状態が無効になるためリセットし、
  // 次回の自動スクロールは現在の再生位置へ「即時」ジャンプさせる
  // （曲の途中で歌詞が再描画された際、0秒位置のまま止まる問題の修正）
  ui.lyrics._lastScrolledIndex = -1;
  ui.lyrics._instantNextScroll = true;
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer._lastScrolledIndex = -1;
    PipManager.pipLyricsContainer._instantNextScroll = true;
  }
  _previousActiveIndices.clear();
  _hasDynamicRenderRanges = false;
  _activeRowsHaveCharSpans = true;
  const hasData = Array.isArray(data) && data.length > 0;
  document.body.classList.toggle('ytm-no-lyrics', !hasData);
  document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
  document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

  const fragment = document.createDocumentFragment();
  const usedMainDynamicIndices = new Set();
  const usedSubDynamicIndices = new Set();

  data.forEach((line, index) => {
    const row = createEl('div', '', 'lyric-line');

    if (line && line.duetSide === 'right') {
      row.classList.add('sub-vocal');
    } else if (line && line.duetSide === 'left') {
      row.classList.add('main-vocal');
    }
    applySingerMetadataToRow(row, line, currentSingerMetadata);

    if (line && typeof line === 'object') {
      line._dynamicRenderStartSec = null;
      line._dynamicRenderEndSec = null;
    }

    if (typeof line.time === 'number') {
      row.dataset.startTime = String(line.time);
    }

    const mainSpan = createEl('span', '', 'lyric-main');

    // dynamic lyrics highlighting
    let dyn = null;

    // サブボーカル(right)にはduetSubDynamicLinesを使用、メインにはdynamicLinesを使用
    if (line && line.duetSide === 'right') {
      // サブボーカル用のdynamic lines（sub.txtがDynamic LRC形式の場合）
      if (duetSubDynamicLines && Array.isArray(duetSubDynamicLines) && duetSubDynamicLines.length) {
        if (typeof line.time === 'number') {
          dyn = findDynamicLineForRender(line, duetSubDynamicLines, usedSubDynamicIndices);
        }
      } else if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
        // sub.txtが通常LRC形式の場合、メインのDynamic LRCからコンテンツマッチで1文字同期データを取得
        // → サブボーカル右側も1文字ハイライトに対応（5秒の許容幅+内容一致で検索）
        if (typeof line.time === 'number') {
          dyn = findDynamicLineByContent(line, dynamicLines);
        }
      }
    } else {
      // メインボーカル用のdynamic lines
      if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
        if (typeof line.time === 'number') {
          // 時間で検索
          dyn = findDynamicLineForRender(line, dynamicLines, usedMainDynamicIndices);
        } else {
          // デュエットモード以外のみインデックスフォールバックを使用
          const isDuetMode = document.body.classList.contains('ytm-duet-mode');
          if (!isDuetMode) {
            dyn = dynamicLines[index];
          }
        }
      }
    }

    if (line && typeof line === 'object' && dyn) {
      const dynStartSec = getDynamicLineStartSec(dyn);
      const dynEndSec = getDynamicLineEndSec(dyn);
      line._dynamicRenderStartSec = typeof dynStartSec === 'number' ? dynStartSec : (
        typeof line.time === 'number' ? line.time : null
      );
      line._dynamicRenderEndSec = typeof dynEndSec === 'number' ? dynEndSec : null;

      if (typeof line._dynamicRenderStartSec === 'number') {
        row.dataset.dynamicStartTime = String(line._dynamicRenderStartSec);
      }
      if (typeof line._dynamicRenderEndSec === 'number') {
        row.dataset.dynamicEndTime = String(line._dynamicRenderEndSec);
      }
      if (typeof line._dynamicRenderStartSec === 'number' && typeof line._dynamicRenderEndSec === 'number') {
        _hasDynamicRenderRanges = true;
      }
    }

    if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
      const charSpans = [];
      dyn.chars.forEach((ch, ci) => {
        const chSpan = createEl('span', '', 'lyric-char');
        // Preserve spaces
        const cc = (ch.c === '\t') ? ' ' : ch.c;
        chSpan.textContent = (cc === ' ') ? '\u00A0' : cc;
        chSpan.dataset.charIndex = String(ci);
        if (typeof ch.t === 'number') {
          chSpan.dataset.time = String(ch.t / 1000);
        }
        // \u6BCE\u30D5\u30EC\u30FC\u30E0\u306E dataset \u53C2\u7167 + parseFloat \u3092\u907F\u3051\u308B\u305F\u3081\u6570\u5024\u3092\u30AD\u30E3\u30C3\u30B7\u30E5
        chSpan._ytmTime = (typeof ch.t === 'number') ? (ch.t / 1000) : 0;
        chSpan.classList.add('char-pending');
        mainSpan.appendChild(chSpan);
        charSpans.push(chSpan);
      });
      row._ytmCharSpans = charSpans;
    } else {
      const rawText = line ? line.text : '';
      mainSpan.innerHTML = optimizeLineBreaks(rawText);
    }
    row.appendChild(mainSpan);

    if (line && line.translation) {
      const subSpan = createEl('span', '', 'lyric-translation', line.translation);
      row.appendChild(subSpan);
      row.classList.add('has-translation');
    }

    row.addEventListener('mouseenter', () => startMeaningHover(line));
    row.addEventListener('mouseleave', () => {
      if (meaningHoverTimer) clearTimeout(meaningHoverTimer);
      meaningHoverTimer = null;
      if (meaningHoverVisible) scheduleMeaningHoverHide();
    });

    row.onclick = () => {
      if (meaningPanelVisible && line && typeof line.time === 'number') {
        syncMeaningPanelToPlayback(true, line.time);
      }
      if (!hasTimestamp || !line || line.time == null) return;
      const v = document.querySelector('video');
      // line.time は曲内ローカル時間。video の currentTime は曲開始オフセット分
      // ずれている（連続再生時）ため、offset を足し戻して正しい位置をシークする。
      // （これがないと前の曲の音声位置にシークしてしまう）
      if (v) v.currentTime = line.time + timeOffset;
    };
    fragment.appendChild(row);
  });

  ui.lyrics.appendChild(fragment);

  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
    if (PipManager.pipWindow.document) {
      // 歌詞が無い曲は PIP でも歌詞エリアごと畳む（通常ウィンドウと同じ扱い）
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-lyrics', !hasData);
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      PipManager.pipWindow.document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    }
  }
}

const handleUpload = (e) => {
  const file = e.target.files[0];
  if (!file || !currentKey) return;
  const r = new FileReader();
  r.onload = (ev) => {
    storage.set(currentKey, {
      cacheVersion: LYRICS_CACHE_VERSION,
      video_id: currentLyricsVideoId || getCurrentVideoId() || null,
      lyrics: String(ev.target.result || ''),
      dynamicLines: null,
      manualLyrics: true,
      lyricsSource: 'manual',
      fallbackUsed: false,
      noLyrics: false,
    });
    currentKey = null;
  };
  r.readAsText(file);
  e.target.value = '';
};


let isRafLoopRunning = false;
// rAF の ID はそれを発行したウィンドウでしか解除できない。
// PIP ウィンドウで予約した ID をメインの cancelAnimationFrame に渡しても効かないので、
// どちらで発行したかを覚えておく。
let lyricRafWindow = null;

const cancelLyricRaf = () => {
  if (!lyricRafId) return;
  try { (lyricRafWindow || window).cancelAnimationFrame(lyricRafId); } catch (e) { }
  lyricRafId = null;
  lyricRafWindow = null;
};

// PIP の開閉時に呼ぶ。ループは走り続けているので startLyricRafLoop() だけでは
// ガードで弾かれ、コールバックが旧ウィンドウに予約されたまま残る。
// PIP を開くとメイン側は rAF が絞られて次フレームが来ず、ハイライトが止まる。
const restartLyricRafLoop = () => {
  cancelLyricRaf();
  isRafLoopRunning = false;
  startLyricRafLoop();
};
window.restartLyricRafLoop = restartLyricRafLoop;

function startLyricRafLoop() {
  if (isRafLoopRunning) return;
  isRafLoopRunning = true;
  cancelLyricRaf();
  _cachedVideoEl = null;
  // 停止中に曲が変わっている可能性があるため、巻き戻り検出の基準をリセット
  _lastRafPlaybackTime = -1;

  const loop = () => {
    const v = _cachedVideoEl || (_cachedVideoEl = document.querySelector('video'));

    if (v) {
      if (PipManager.pipWindow) {
        PipManager.updatePlayState(v.paused);
      }

      const isPlaying = v.readyState > 0 && !v.paused && !v.ended;
      document.body.classList.toggle('ytm-music-paused', !isPlaying);

      if (isPlaying) {
        let t = v.currentTime;
        const duration = v.duration || 1;

        // 連続再生（曲が変わっても currentTime がリセットされない）対応:
        // 現在の曲が始まった video 時間(timeOffset)を引いて曲内ローカル時間にする。
        // currentTime が offset を下回ったら曲がリセットされたとみなし offset を解除。
        if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
        t = Math.max(0, t - timeOffset);
        // v.duration は曲ごとの長さ。ローカル時間はそれを超えないのでそのままクランプ
        t = Math.min(Math.max(0, t + (config.syncOffset / 1000)), v.duration);

        // 再生時間が大幅に巻き戻った場合（曲切替 or 後方シーク）の検出。
        // 次のスクロールを即時ジャンプにして、0秒位置からのゆっくりスクロールを防ぐ。
        // （曲切替時の歌詞リセットは tick() が currentKey 変更を検出して
        //   lyricsData を空にするため、ここでは凍結せず即時ジャンプのみで十分）
        if (_lastRafPlaybackTime >= 0 && t < _lastRafPlaybackTime - 1.5) {
          if (ui.lyrics) ui.lyrics._instantNextScroll = true;
          if (PipManager.pipLyricsContainer) PipManager.pipLyricsContainer._instantNextScroll = true;
        }
        _lastRafPlaybackTime = t;

        // ハイライト更新で例外が出てもRAFループを止めないようにする
        // （止まると isRafLoopRunning が true のまま再開せず、ハイライトが永久停止するため）
        try {
          if (animatedCaptionData && config.useAnimatedCaptions) {
            updateAnimatedCaptionStage(t);
          }
          if (!animatedCaptionData && lyricsData.length && hasTimestamp) {
            updateLyricHighlight(t);
          }
        } catch (err) {
          console.warn('[YTM] lyric highlight update failed:', err);
        }

        if (PipManager.pipWindow && PipManager.progressRing) {
          const radius = 32;
          const circumference = radius * 2 * Math.PI;
          const progress = t / duration;
          const offset = circumference - (progress * circumference);
          PipManager.progressRing.style.strokeDashoffset = offset;
        }

        if (PipManager.pipWindow) {
          lyricRafWindow = PipManager.pipWindow;
          lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
        } else {
          lyricRafWindow = window;
          lyricRafId = requestAnimationFrame(loop);
        }
      } else {
        isRafLoopRunning = false;
      }
    } else {
      isRafLoopRunning = false;
    }
  };

  if (PipManager.pipWindow) {
    lyricRafWindow = PipManager.pipWindow;
    lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
  } else {
    lyricRafWindow = window;
    lyricRafId = requestAnimationFrame(loop);
  }
}

document.addEventListener('play', (e) => {
  if (e.target.tagName === 'VIDEO') {
    startLyricRafLoop();
  }
}, true);

document.addEventListener('playing', (e) => {
  if (e.target.tagName === 'VIDEO') {
    startLyricRafLoop();
  }
}, true);


let lastScrolledIndex = -1;
let isUserScrolling = false;
let userScrollTimeout = null;
let isProgrammaticScrolling = false;
let programmaticScrollTimeout = null;
let programmaticScrollMaxTimeout = null;
let _previousActiveIndices = new Set();
let _cachedVideoEl = null;
let _slidersPatched = false;
let _lastLikeCheckTime = 0;
// 拡張側の操作(再描画・scrollTopリセット等)によるscrollイベントを
// ユーザースクロールと誤検出しないための抑制ウィンドウ
let _suppressUserScrollUntil = 0;
// 再生時間の大幅な巻き戻り（曲切替/シーク）検出用
let _lastRafPlaybackTime = -1;
// 現在の描画に1文字同期(dynamic)の時間レンジが存在するか（毎フレームの全行走査を省くため）
let _hasDynamicRenderRanges = false;
// アクティブ行に1文字同期スパンが含まれるか。trueの間のみ毎フレームのDOM更新が必要。
// 安全側に倒して初期値はtrue（次のフレームで実態に合わせて更新される）
let _activeRowsHaveCharSpans = true;

function suppressUserScrollDetection(ms = 500) {
  _suppressUserScrollUntil = performance.now() + ms;
}

function updateLyricHighlight(currentTime) {
  if (!lyricsData.length) return;
  if (!hasTimestamp) return;
  // 再生時間が不正（NaN/Infinity）な場合は処理しない。
  // 曲切替直後などに NaN が来ると idx が最終行になり、歌詞が一番下まで
  // スクロールしてしまうため。
  if (!Number.isFinite(currentTime)) return;

  const t = currentTime;

  let idx = -1;
  let startSearch = Math.max(0, lastActiveIndex);

  // 再生時間が前回の位置より大幅に戻っている場合は最初から検索
  if (startSearch >= lyricsData.length || (startSearch > 0 && lyricsData[startSearch].time > t + 0.5)) {
    startSearch = 0;
  }

  for (let i = startSearch; i < lyricsData.length; i++) {
    if (lyricsData[i].time > t) {
      idx = i - 1;
      break;
    }
    if (i === lyricsData.length - 1) idx = i;
  }



  const targets = [];
  if (ui.lyrics) targets.push(ui.lyrics);
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    targets.push(PipManager.pipLyricsContainer);
  }

  const activeIndices = new Set();
  if (idx >= 0 && idx < lyricsData.length) {
    activeIndices.add(idx);

    const currentLineTime = lyricsData[idx]?.time;
    if (typeof currentLineTime === 'number') {
      for (let i = idx - 1; i >= 0; i--) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
      for (let i = idx + 1; i < lyricsData.length; i++) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
    }

    if (activeIndices.size === 1) {
      const prevIdx = (idx > 0 && idx < lyricsData.length &&
        typeof lyricsData[idx]?.time === 'number' &&
        typeof lyricsData[idx - 1]?.time === 'number' &&
        (lyricsData[idx].time - lyricsData[idx - 1].time) <= 1.0
      ) ? (idx - 1) : -1;

      if (prevIdx >= 0) {
        // デュエットモードでduetSideが異なる行（メイン⇔サブ）は追加しない
        // （1文字追跡タイムスタンプ時にサブボーカルがダブる原因になるため）
        const currentSide = lyricsData[idx]?.duetSide;
        const prevSide = lyricsData[prevIdx]?.duetSide;
        const isDifferentDuetSide = currentSide && prevSide && currentSide !== prevSide;
        if (!isDifferentDuetSide) {
          const currentText = normalizeLyricCompareTextStrict(lyricsData[idx]?.text);
          const prevText = normalizeLyricCompareTextStrict(lyricsData[prevIdx]?.text);
          const sameDisplayedLyric = !!currentText && !!prevText && scoreLyricTextMatch(currentText, prevText) >= 100;
          if (!sameDisplayedLyric) activeIndices.add(prevIdx);
        }
      }
    }

    if (_hasDynamicRenderRanges) {
      lyricsData.forEach((line, lineIndex) => {
        if (activeIndices.has(lineIndex)) return;
        if (!isLineDynamicallyActiveAtTime(line, t)) return;
        activeIndices.add(lineIndex);
      });
    }

    if (activeIndices.size > 1) {
      const activeList = Array.from(activeIndices).sort((a, b) => a - b);
      activeList.forEach((activeIdx) => {
        const activeLine = lyricsData[activeIdx];
        if (activeLine?.duetSide !== 'right') return;

        const activeText = normalizeLyricCompareTextStrict(activeLine?.text);
        if (!activeText) return;

        const hasMatchingLeft = activeList.some((otherIdx) => {
          if (otherIdx === activeIdx) return false;
          const otherLine = lyricsData[otherIdx];
          if (otherLine?.duetSide !== 'left') return false;
          // Dynamic LRC（1文字同期）の場合は行の開始時刻が最大5秒ずれる可能性があるため
          // 許容幅を動的に切り替える（通常LRCはDUET_DUPLICATE_TOLERANCE=1.0sのまま）
          const dedupeTol = (Array.isArray(dynamicLines) && dynamicLines.length > 0)
            ? 5.0
            : DUET_DUPLICATE_TOLERANCE;
          if (!isSameTimestamp(otherLine?.time, activeLine?.time, dedupeTol)) return false;

          const otherText = normalizeLyricCompareTextStrict(otherLine?.text);
          return !!otherText && scoreLyricTextMatch(otherText, activeText) >= 100;
        });

        if (hasMatchingLeft) {
          activeIndices.delete(activeIdx);
        }
      });
    }
  }

  // 差分検出: 前回と同じアクティブ行セットなら、char更新以外をスキップ
  const activeChanged = activeIndices.size !== _previousActiveIndices.size ||
    [...activeIndices].some(i => !_previousActiveIndices.has(i));

  // 完全に変化のないフレームは行ループ自体をスキップ
  // （アクティブ行に1文字同期がある場合のみ毎フレームの更新が必要）
  const scrollPending = targets.some(c => idx !== (c._lastScrolledIndex ?? -1));
  if (!activeChanged && !scrollPending && !_activeRowsHaveCharSpans) {
    lastActiveIndex = idx;
    if (meaningPanelVisible) {
      syncMeaningPanelToPlayback(false, t);
    }
    return;
  }

  let sawActiveCharSpans = false;

  targets.forEach(container => {
    const rows = container.children;
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.classList.contains('lyric-line')) continue;
      const isActive = activeIndices.has(i);
      const isPrimary = (i === idx);
      const isPast = idx >= 0 && i < idx && !isActive;
      r.classList.toggle('lyric-past', isPast);

      if (isActive) {
        // 状態遷移時のみクラス操作（active でなかった→active になった）
        if (activeChanged && !_previousActiveIndices.has(i)) {
          r.classList.add('active');
          if (r.classList.contains('has-translation')) {
            r.classList.add('show-translation');
          }
        }

        if (isPrimary && idx !== (container._lastScrolledIndex ?? -1)) {
          // 再描画直後・大幅シーク後は現在位置へ即時ジャンプ（0秒位置からの
          // ゆっくりスクロールを防ぐ）
          const scrollBehavior = container._instantNextScroll ? 'auto' : 'smooth';
          container._instantNextScroll = false;

          if (container === ui.lyrics) {
            if (isUserScrolling) continue;
            // 【通常再生画面】
            // getBoundingClientRect を使って要素の絶対位置から確実なスクロール量を計算
            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            const targetScroll = container.scrollTop + rRect.top - containerRect.top - (container.clientHeight / 2) + (rRect.height / 2);

            isProgrammaticScrolling = true;
            clearTimeout(programmaticScrollTimeout);
            clearTimeout(programmaticScrollMaxTimeout);
            programmaticScrollTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 150);
            programmaticScrollMaxTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 1200);
            if (scrollBehavior === 'auto') suppressUserScrollDetection(300);

            container.scrollTo({ top: targetScroll, behavior: scrollBehavior });

            container._lastScrolledIndex = idx;
            ReplayManager.incrementLyricCount();
          } else {
            // 【PIP（小窓）】
            if (container._isUserScrolling) continue;

            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            const targetScroll = container.scrollTop + rRect.top - containerRect.top - (container.clientHeight * 0.35) + (rRect.height / 2);

            container._isProgrammaticScrolling = true;
            container.scrollTo({ top: targetScroll, behavior: scrollBehavior });

            container._lastScrolledIndex = idx;
          }
        }

        // char-level アニメーション（アクティブ行のみ、毎フレーム必要）
        // 行要素にキャッシュした配列を使う（毎フレームの querySelectorAll を回避）
        let charSpans = r._ytmCharSpans;
        if (!charSpans) charSpans = r._ytmCharSpans = Array.from(r.querySelectorAll('.lyric-char'));
        if (charSpans.length > 0) {
          sawActiveCharSpans = true;
          charSpans.forEach(sp => {
            const tt = (sp._ytmTime !== undefined) ? sp._ytmTime : (sp._ytmTime = parseFloat(sp.dataset.time || '0'));
            if (Number.isFinite(tt) && tt <= t) {
              if (!sp.classList.contains('char-active')) {
                sp.classList.add('char-active');
                sp.classList.remove('char-pending');
              }
            } else {
              if (!sp.classList.contains('char-pending')) {
                sp.classList.remove('char-active');
                sp.classList.add('char-pending');
              }
            }
          });
        }
      } else if (activeChanged && _previousActiveIndices.has(i)) {
        // 状態遷移: active→非active になった行のみリセット
        r.classList.remove('active');
        r.classList.remove('show-translation');

        let charSpans = r._ytmCharSpans;
        if (!charSpans) charSpans = r._ytmCharSpans = Array.from(r.querySelectorAll('.lyric-char'));
        if (charSpans.length > 0) {
          charSpans.forEach(sp => {
            sp.classList.remove('char-active');
            sp.classList.add('char-pending');
          });
        }
      }
    }
  });

  if (activeChanged) {
    _previousActiveIndices = new Set(activeIndices);
  }
  _activeRowsHaveCharSpans = sawActiveCharSpans;

  lastActiveIndex = idx;
  if (meaningPanelVisible) {
    syncMeaningPanelToPlayback(false, t);
  }
}

async function sendLockRequest(requestId) {
  const youtube_url = getCurrentVideoUrl();
  const video_id = getCurrentVideoId();
  const reqInfo = Array.isArray(lyricsRequests)
    ? lyricsRequests.find(r => r.id === requestId || r.request === requestId || (r.aliases || []).includes(requestId))
    : null;
  const requestTarget = inferLockRequestTarget(reqInfo || { request: requestId });
  try {
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, request: requestId } },
        resolve
      );
    });
    if (res?.success) {
      showToast('歌詞を確定しました');
      if (reqInfo) {
        reqInfo.locked = true;
        reqInfo.available = false;
      }
      const currentState = syncLyricsLockState();
      const nextState = {
        ...(currentState || { sync: false, dynamic: false, byRequest: {} }),
        byRequest: { ...(currentState?.byRequest || {}) }
      };
      nextState.byRequest[String(requestId || '').toLowerCase()] = true;
      if (requestTarget === 'sync') nextState.sync = true;
      if (requestTarget === 'dynamic') nextState.dynamic = true;
      lyricsLockState = nextState;
      refreshLockMenu();
    } else {
      const msg = res?.error || (res?.raw && (res.raw.message || res.raw.code)) || '歌詞の確定に失敗しました';
      showToast(msg);
    }
  } catch (e) {
    console.error('lock request error', e);
    showToast('歌詞の確定に失敗しました');
  }
}



function setupPlayerBarBlankClickGuard() {
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar || bar.dataset.ytmBlankClickGuard === '1') return;
  bar.dataset.ytmBlankClickGuard = '1';

  // 余白クリックがプレイヤーの開閉に繋がるのを防ぐ（ボタン/スライダー等は通常通り動かす）
  bar.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;

    // インタラクティブ要素は通す（閉じるボタンの逆三角もここに含まれる想定）
    if (
      t.closest('button, a, input, textarea, select, tp-yt-paper-icon-button, tp-yt-paper-button, tp-yt-paper-slider, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer')
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
  }, true);
}

let _cachedLayoutEl = null;

const tick = async () => {
  // Update PIP window state (throttled to once per second)
  if (PipManager && PipManager.pipWindow) {
    const now = performance.now();
    if (now - _lastLikeCheckTime > 1000) {
      _lastLikeCheckTime = now;
      PipManager.updateLikeState();
    }
  }

  if (document.querySelector('.ad-interrupting, .ad-showing')) return;

  let toggleBtn = document.getElementById('my-mode-toggle');

  if (!toggleBtn) {
    const rc = document.querySelector('.right-controls-buttons');
    if (rc) {
      toggleBtn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');

      if (config.mode) toggleBtn.classList.add('active');

      toggleBtn.onclick = () => {
        config.mode = !config.mode;
        document.body.classList.toggle('ytm-custom-layout', config.mode);
        if (isYTMPremiumUser()) changeIModeUIWithMovieMode(config.mode);

        toggleBtn.classList.toggle('active', config.mode);
      };
      rc.prepend(toggleBtn);
    }
  } else {
    const isActive = toggleBtn.classList.contains('active');
    if (config.mode && !isActive) toggleBtn.classList.add('active');
    else if (!config.mode && isActive) toggleBtn.classList.remove('active');
  }

  const layout = _cachedLayoutEl || (_cachedLayoutEl = document.querySelector('ytmusic-app-layout'));
  const isPlayerOpen = layout?.hasAttribute('player-page-open');
  if (!config.mode || !isPlayerOpen) {
    document.body.classList.remove('ytm-custom-layout');
    // Immersion を閉じている間は再生位置を追えていない。
    // 次に開いた時、曲の切り替わりを見ていたことにしてはいけない。
    _wasTrackingPlayback = false;
    return;
  }
  document.body.classList.add('ytm-custom-layout');
  initLayout();


  setupPlayerBarBlankClickGuard();
  if (!_slidersPatched) {
    const sliders = document.querySelectorAll('ytmusic-player-bar .middle-controls tp-yt-paper-slider');
    if (sliders.length > 0) {
      sliders.forEach(s => {
        try {
          s.style.boxSizing = 'border-box';
          s.style.paddingLeft = '20px';
          s.style.paddingRight = '20px';
          s.style.minWidth = '0';
          s.style.cursor = 'pointer';
        } catch (e) { }
      });
      _slidersPatched = true;
    }
  }

  const meta = getMetadata();
  if (!meta) return;
  // 「直前の tick でも追えていたか」を、フラグを更新する前に控える
  const wasTrackingBefore = _wasTrackingPlayback;
  _wasTrackingPlayback = true;
  const key = `${meta.title}///${meta.artist}`;
  const videoId = getCurrentVideoId() || '';

  if (currentKey !== key || (currentLyricsVideoId || '') !== videoId) {
    // 初回ロード（曲の途中から開いた場合など）は再生位置のリセットを待たない
    const isInitialLoad = (currentKey === null);

    // クラウド同期
    if (currentKey !== null && CloudSync && typeof CloudSync.syncNow === 'function') {
      CloudSync.syncNow();
    }

    const v = document.querySelector('video');
    const currentTime = v ? v.currentTime : 0;
    const duration = v ? v.duration : 0;


    // timeOffset = 現在の曲が始まった video 時間（曲内ローカル時間 = currentTime - timeOffset）。
    // YTM の連続再生では曲が変わっても video の currentTime が 0 にリセットされず
    // そのまま進み続けることがある。その場合、新曲が始まった時点の currentTime を
    // offset として引くことで曲内の正しい再生位置を得る。
    //  ・初回ロード（最初の曲 / 途中再生）は offset 不要（currentTime がそのまま曲内時間）
    //  ・リセット再生（currentTime が 0 に戻る）の場合は RAF ループ側で offset を自動解除
    //  ・Immersion を曲の途中で開いた場合は、この時点の currentTime は
    //    「新しい曲が始まった video 時間」ではなく「今聴いている位置」。
    //    これを offset にすると曲内時間が 0 に潰れ、歌詞が頭から流れてしまう
    //    (シークしてから Immersion を開くとズレる、という不具合の原因)。
    //    直前まで実際に再生を追えていた時だけ、連続再生の補正を適用する。
    const sawTransition = wasTrackingBefore && !isInitialLoad;
    if (!sawTransition) {
      timeOffset = 0;
    } else if (Number.isFinite(currentTime) && currentTime >= 5) {
      timeOffset = currentTime;
    } else {
      timeOffset = 0;
    }

    if (!config.saveSyncOffset) {
      if (isFirstSongDetected) {
        isFirstSongDetected = false;
      } else {
        const offsetInput = document.getElementById('sync-offset-input');
        if (offsetInput) {
          offsetInput.value = 0;
        }
        config.syncOffset = 0;
        storage.set('ytm_sync_offset', 0);
      }
    } else {
      isFirstSongDetected = false;
    }

    clearLyricsLateRetry();

    currentKey = key;
    currentLyricsVideoId = videoId;
    activeLyricsRequestId = null;
    currentLyricsResultPriority = 0;
    currentLyricsQuality = 0;
    currentLyricsSource = null;
    isFallbackLyrics = false;
    lyricsApplyEpoch += 1;
    hideFallbackNotice();
    summaryButtonAttentionKey = null;
    lyricsData = [];
    animatedCaptionData = null;
    animatedCaptionFrameKey = '';
    document.body.classList.remove('ytm-animated-caption-mode');
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    singerMetadataRequestSequence += 1;
    singerMetadataRequestKey = '';
    currentSingerMetadataKey = '';
    currentLyricsRecordId = null;
    currentSingerMetadata = null;
    currentSingerCanonicalLyrics = '';
    lyricsCandidates = null;
    selectedCandidateId = null;
    lyricsRequests = null;
    lyricsConfig = null;
    lyricsLockState = null;
    lyricsTranslationMap = {};
    setLyricsMeaningData(null);
    hideMeaningSummaryPopup();
    lastActiveIndex = -1;
    _previousActiveIndices.clear();
    lastScrolledIndex = -1;
    if (ui.lyrics) ui.lyrics._lastScrolledIndex = -1;
    if (PipManager && PipManager.pipLyricsContainer) {
      PipManager.pipLyricsContainer._lastScrolledIndex = -1;
    }
    isUserScrolling = false;
    if (userScrollTimeout) clearTimeout(userScrollTimeout);
    if (ui.lyrics) ui.lyrics.classList.remove('ytm-user-browsing-lyrics');
    isProgrammaticScrolling = false;
    if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
    if (programmaticScrollMaxTimeout) clearTimeout(programmaticScrollMaxTimeout);
    lastTimeForChars = -1;
    // 曲切替処理が走ったので巻き戻り検出の基準をリセットし、
    // この後の scrollTop=0 / innerHTML 差し替えによる scroll イベントを
    // ユーザースクロールとして誤検出しないようにする
    _lastRafPlaybackTime = -1;
    // YTM が video 要素を差し替えた場合に古い参照を使い続けないようにする
    _cachedVideoEl = null;
    suppressUserScrollDetection(900);

    if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
      QueueManager.onSongChanged();
    }

    updateMetaUI(meta);
    preferLyricsDefault(key);

    // PIPウィンドウのメタデータと歌詞表示をリセット
    if (PipManager) {
      PipManager.updateMeta(meta.title, meta.artist);
      PipManager.resetLyrics(); // ここで歌詞を一旦消す
      // Schedule a delayed update check to ensure player bar DOM is fully updated by YTM
      setTimeout(() => {
        if (PipManager && PipManager.pipWindow) {
          PipManager.updateLikeState();
        }
      }, 1000);
    }

    refreshCandidateMenu();
    refreshLockMenu();
    if (ui.lyrics) ui.lyrics.scrollTop = 0;
    setTimeout(() => {
      if (currentKey !== key) return;
      if ((currentLyricsVideoId || '') !== videoId || (getCurrentVideoId() || '') !== videoId) return;
      const metaNow = getMetadata() || meta;
      const keyNow = `${metaNow.title}///${metaNow.artist}`;
      if (keyNow !== key) return;
      loadLyrics(metaNow);
      startLyricRafLoop();
    }, 800);
  }
};

function updateMetaUI(meta) {
  ui.title.innerText = meta.title;
  ui.artist.innerText = meta.artist;

  if (meta.src) {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    if (meta.src.startsWith('data:') || meta.src.startsWith('blob:')) {
      img.src = meta.src;
    } else {
      try {
        const url = new URL(meta.src);
        url.searchParams.set('ytm_cors', Date.now().toString());
        img.src = url.toString();
      } catch (e) {
        img.src = meta.src + (meta.src.includes('?') ? '&' : '?') + 'ytm_cors=' + Date.now();
      }
    }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.filter = 'blur(4px)';
        ctx.drawImage(img, 0, 0, 64, 64);
        const blurredDataUrl = canvas.toDataURL();
        ui.bg.style.backgroundImage = `url(${blurredDataUrl})`;
      } catch (e) {
        console.warn("Failed to generate pre-blurred background via canvas:", e);
        ui.bg.style.backgroundImage = `url(${meta.src})`;
      }
    };
    img.onerror = () => {
      ui.bg.style.backgroundImage = `url(${meta.src})`;
    };
    ui.artwork.replaceChildren(img);
    if (ui.summaryBtn) ui.artwork.appendChild(ui.summaryBtn);
  }
  ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';

  // アーティストページのURLを取得
  let retryCount = 0;
  const maxRetries = 5;
  const trySetArtistLink = () => {
    const bylineWrapper = document.querySelector('ytmusic-player-bar yt-formatted-string.byline.complex-string');
    if (!bylineWrapper) {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(trySetArtistLink, 300);
      } else {
        ui.artist.innerText = meta.artist; // フォールバック
      }
      return;
    }

    const artistLinks = Array.from(
      bylineWrapper.querySelectorAll('a.yt-simple-endpoint')
    ).filter(a => {
      const href = a.href || '';
      return href.includes('channel/') || href.includes('/channel/');
    });

    if (artistLinks.length > 0) {
      let artistHTML = '';

      artistLinks.forEach((link, index) => {
        const name = link.textContent.trim();
        const url = link.href;

        artistHTML += `<a href="${url}" 
          style="color:inherit; text-decoration:none;"
          target="_blank">
          ${name}
        </a>`;
        if (index < artistLinks.length - 1) {
          artistHTML += ' • ';
        }
      });
      ui.artist.innerHTML = artistHTML;
      return;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      setTimeout(trySetArtistLink, 300);
    } else {
      ui.artist.innerText = meta.artist;
    }
  };

  trySetArtistLink();
}

const runtimeSettingsReady = (async function applySavedRuntimeSettings() {
  const [
    savedOffset,
    savedOffsetEnabled,
    savedFallbackEnabled,
    savedSourceMode,
    savedAnimatedCaptions,
    savedSingerColors,
  ] = await Promise.all([
    storage.get('ytm_sync_offset'),
    storage.get('ytm_save_sync_offset'),
    storage.get('ytm_lrclib_fallback'),
    storage.get('ytm_lyric_source_mode'),
    storage.get('ytm_animated_captions_enabled'),
    storage.get('ytm_singer_colors_enabled'),
  ]);
  if (savedOffset !== null && Number.isFinite(Number(savedOffset))) config.syncOffset = Number(savedOffset);
  if (savedOffsetEnabled !== null) config.saveSyncOffset = !!savedOffsetEnabled;
  config.useLrcLibFallback = true;
  config.lyricSourceMode = normalizeSourceMode(savedSourceMode);
  if (savedAnimatedCaptions !== null) config.useAnimatedCaptions = !!savedAnimatedCaptions;
  if (savedSingerColors !== null) config.useSingerColors = !!savedSingerColors;
  document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);

  // 1. 歌詞の太さ
  const savedWeight = await storage.get('ytm_lyric_weight');
  if (savedWeight) {
    config.lyricWeight = savedWeight;
    document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
  }

  // 2. 背景の明るさ
  //
  // 既定値を引き上げた。以前の 0.4 はアートワークの色がほとんど出ず、
  // この拡張の見どころを一つ潰していたため。
  // 自分でスライダーを動かした人は保存値がそのまま使われる。
  // 一度も触っていない人は、既存ユーザーも含めて新しい既定値になる。
  const savedBright = await storage.get('ytm_bg_brightness');
  if (savedBright) {
    config.bgBrightness = savedBright;
    document.documentElement.style.setProperty('--ytm-bg-brightness', savedBright);
  }

  // 2-b. UIサイズ
  const savedUiScale = await storage.get('ytm_ui_scale');
  if (savedUiScale !== null) applyUiScale(savedUiScale);

  // 3. 左揃えオプション
  const leftAlignStored = await storage.get('ytm_left_align');
  if (leftAlignStored !== null) config.leftAlignInfo = leftAlignStored;
  document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
  const keepPastStored = await storage.get('ytm_keep_past_lyrics');
  if (keepPastStored !== null && keepPastStored !== undefined) config.keepPastLyrics = !!keepPastStored;
  document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);

  // 4. Apple Music風背景オプション
  const appleBgStored = await storage.get('ytm_apple_bg');
  if (appleBgStored !== null) config.appleBg = appleBgStored;
  document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);

  // 5. 軽量モードオプション
  const lowCpuStored = await storage.get('ytm_low_cpu_mode');
  if (lowCpuStored !== null) config.lowCpuMode = !!lowCpuStored;
  document.body.classList.toggle('ytm-lightweight-mode', !!config.lowCpuMode);
})().catch((error) => {
  console.warn('[YTM] Failed to restore saved runtime settings:', error);
});


// ===================== 初期化 =====================

// Windows は日本語が Yu Gothic UI 等にフォールバックし、macOS の Hiragino Sans より
// 同じ font-weight でも太く見える。CSS 側で補正するための目印を付ける。
try {
  const platform = (navigator.userAgentData && navigator.userAgentData.platform)
    || navigator.platform || '';
  if (/win/i.test(platform)) document.body.classList.add('ytm-win');
} catch (e) { /* 判定できなければ補正しないだけ */ }

// 背景アニメーションを、見えていない間は止める。
// 動かし続けると、上に乗っている backdrop-filter の要素が毎フレーム
// 裏側のぼかしを計算し直すことになり、そのぶん無駄に電力と CPU を使う。
const updateAmbientAnimationState = () => {
  const video = document.querySelector('video');
  const idle = document.hidden || !!(video && video.paused);
  document.body.classList.toggle('ytm-anim-idle', idle);
};
document.addEventListener('visibilitychange', updateAmbientAnimationState);
document.addEventListener('play', updateAmbientAnimationState, true);
document.addEventListener('pause', updateAmbientAnimationState, true);
updateAmbientAnimationState();

ReplayManager.init();
QueueManager.init();
CloudSync.init();

YTMLog.log('YTM Immersion loaded.');


const setupObserver = () => {

  const targetNode = document.querySelector('ytmusic-player-bar');


  if (!targetNode) {
    setTimeout(setupObserver, 500);
    return;
  }


  let _tickScheduled = false;
  let _tickRafId = null;
  let _tickFallbackTimer = null;
  const runScheduledTick = () => {
    if (!_tickScheduled) return;
    _tickScheduled = false;
    if (_tickRafId !== null) {
      cancelAnimationFrame(_tickRafId);
      _tickRafId = null;
    }
    if (_tickFallbackTimer !== null) {
      clearTimeout(_tickFallbackTimer);
      _tickFallbackTimer = null;
    }
    tick();
  };
  const scheduleTick = () => {
    if (_tickScheduled) return;
    _tickScheduled = true;
    if (!document.hidden) {
      _tickRafId = requestAnimationFrame(runScheduledTick);
    }
    _tickFallbackTimer = setTimeout(
      runScheduledTick,
      document.hidden ? 0 : 250
    );
  };
  const observer = new MutationObserver((mutations) => {
    const hasRelevantMutation = mutations.some(mutation => {
      const target = mutation.target;
      if (!target) return false;
      if (target.closest && target.closest('tp-yt-paper-slider, tp-yt-paper-progress, #left-controls, #right-controls, .time-info')) {
        return false;
      }
      return true;
    });

    if (hasRelevantMutation) {
      scheduleTick();
    }
  });



  observer.observe(targetNode, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true
  });

  YTMLog.log('YTM Immersion: Zero-delay observer started.');

  tick();
};
