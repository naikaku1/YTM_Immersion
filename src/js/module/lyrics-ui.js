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
  // Enhanced LRC の語タグ。ここに来る時点で「行同期として読む」と決まって
  // いるので(語同期は isDynamicLrcFormat 側で先に分岐する)、表示する文字列
  // からは落とす。残すと画面に <00:12.34> がそのまま並ぶ。
  const LRC_WORD_TAG = /<\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,3}\s*)?>/g;

  // タイムスタンプがない場合
  if (!tagTest.test(lrc)) {
    // 空行も保持して、翻訳時に行が詰まらないようにする
    const lines = lrc.split(/\r?\n/).map((line, sourceIndex) => {
      const text = (line ?? '').replace(LRC_WORD_TAG, '').replace(/^\s+|\s+$/g, '');
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
      const text = line
        .replace(/\[\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,4}\s*)?\]/g, '')
        .replace(LRC_WORD_TAG, '')
        .trim();
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

// ── 先頭に紛れ込む見出し行 ──────────────────────────────────
// 取得元によっては、1行目に曲そのものではない行が入っている。
//
//   - QQ音楽由来の同期データ: 「制作人：〜」「作詞：〜」のクレジット行
//   - SimpMusic の richsync : 「曲名 - アーティスト (…)」の見出し行
//
// どちらも本物の歌詞と同じタイムスタンプ付きなので、そのまま出すと
// イントロの間ずっと曲名がハイライトされ続ける。上流のデータは直せない
// ので、表示する行からだけ落とす。
//
// 落とすのは必ず「先頭から連続する分だけ」。1行でも該当しない行が来たら
// そこで打ち切るので、曲中の歌詞を巻き込むことはない。
// 元データ側は触らない。歌手の色分けは行番号で歌詞に対応づけられていて、
// データから消すと1行ずれるため。
const LYRIC_CREDIT_LABELS = [
  '制作人', '製作人', '制作', '製作', '出品', '监制', '監製',
  '作詞', '作词', '作曲', '编曲', '編曲', '词曲', '詞曲',
  '混音', '録音', '录音', '母带', '母帶', '和声', '和聲',
  'produced by', 'producer', 'lyrics', 'lyricist', 'lyric',
  'music', 'composer', 'composed by', 'arranged by', 'arranger',
  'vocal', 'chorus', 'mixing', 'mastering', 'op', 'sp',
];

// 全角・大文字・語中の空白を潰してから突き合わせる。
// 「Produced by」と「producedby」を別物として扱わないため、
// 既知ラベル側も同じ形に均しておく。
const normalizeCreditLabel = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

const LYRIC_CREDIT_LABEL_KEYS = LYRIC_CREDIT_LABELS.map(normalizeCreditLabel);

const isLyricCreditLine = (text) => {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  // 「ラベル：値」の形だけを見る。コロンが無ければクレジット行ではない。
  const m = raw.match(/^([^:：]{1,24})[:：]/);
  if (!m) return false;
  const label = normalizeCreditLabel(m[1]);
  if (!label) return false;
  // 「作詞作曲」のような連結にも当たるよう包含で見る
  return LYRIC_CREDIT_LABEL_KEYS.some(known => label.includes(known));
};

const normalizeLyricHeaderText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

// 曲名を含む見出し行。曲名がそのまま歌い出しになる曲を巻き込まないよう、
// 「曲の頭に置かれている」「次の歌詞まで大きく空いている」「その空きが
// 他の行間隔と比べて明らかに異常」の3つが揃った時だけ見出しとみなす。
const isLyricTitleHeaderLine = (line, nextLine, medianGapSec, trackTitle) => {
  const title = normalizeLyricHeaderText(trackTitle);
  const text = normalizeLyricHeaderText(line?.text);
  if (!title || !text || title.length < 2) return false;
  if (!text.includes(title)) return false;
  if (typeof line?.time !== 'number' || line.time > 5) return false;
  if (typeof nextLine?.time !== 'number') return false;
  const gap = nextLine.time - line.time;
  if (gap < 10) return false;
  if (!(medianGapSec > 0) || gap < medianGapSec * 4) return false;
  return true;
};

const MAX_STRIPPED_HEADER_LINES = 6;

const stripLeadingHeaderLines = (lines, trackTitle) => {
  if (!Array.isArray(lines) || lines.length < 3) return lines;

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]?.time;
    const cur = lines[i]?.time;
    if (typeof prev === 'number' && typeof cur === 'number') gaps.push(cur - prev);
  }
  gaps.sort((a, b) => a - b);
  const medianGapSec = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  let start = 0;
  while (start < lines.length - 1 && start < MAX_STRIPPED_HEADER_LINES) {
    const line = lines[start];
    if (isLyricCreditLine(line?.text)) { start += 1; continue; }
    if (isLyricTitleHeaderLine(line, lines[start + 1], medianGapSec, trackTitle)) {
      start += 1;
      continue;
    }
    break;
  }

  if (!start) return lines;
  return lines.slice(start);
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

// 画面で「いまの行」を、次の行が始まるまで明るいまま残す。
//
// 終わり時刻を持つのは文字同期の行だけで、そこで active を外すと
// 色が #fff → rgba(255,255,255,0.3)、大きさが 1.05 → 0.95 に落ち、
// さらに .ytm-word-sync:not(.active) で塗りのグラデーションごと消える。
// 行間が空く曲では、その状態が数秒続く。実測: Dear (Mrs. GREEN APPLE) は
// 歌 166秒 に対して行間の空きが 101秒あり、点いて消えて点いて消えて、
// に見えていた。行同期の歌詞は終わり時刻を持たないのでこうならず、
// 「同期が細かい曲ほど見え方が悪くなる」という逆転になっていた。
//
// 他に本当に歌っている行があるならそちらに譲る(デュエット・重なり)。
const isPrimaryRowLitAtTime = (lines, primaryIndex, timeSec) => {
  const primary = Array.isArray(lines) ? lines[primaryIndex] : null;
  if (!primary) return false;
  const hasRange = Number.isFinite(primary._dynamicRenderStartSec) &&
    Number.isFinite(primary._dynamicRenderEndSec);
  if (!hasRange) return true;
  if (isLineDynamicallyActiveAtTime(primary, timeSec)) return true;
  if (timeSec < primary._dynamicRenderStartSec) return false;
  return !lines.some((line, i) => (
    i !== primaryIndex && isLineDynamicallyActiveAtTime(line, timeSec)
  ));
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
      // 行末の文字を「次の行が始まるまで」で割ると、間奏に入る行で破綻する。
      // 最後の 1〜2 文字が数秒後の時刻を持ち、歌い終わってだいぶ経ってから点く。
      // メイン側(api.js の parseDynamicLrc)は同じ補正を持っているのに、
      // ここ(sub = デュエットの右側)だけ抜けていた。右側の行末だけ遅れて点く。
      const tailCount = Math.max(1, Array.from(chunk).length);
      endMs = Math.min(endMs, prevMs + estimateCharDurationMs(chars) * tailCount);
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
    // 同内容の重複だけ落とす。別歌詞の同時進行は残す。
    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
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

// 歌詞ソースは「YTM 優先 / LRCHub 優先」の2択。どちらも他方(と残りの
// 取得元)へ自動で落ちるので、選んだせいで歌詞が出なくなることはない。
//
// 以前あった 'external'(SimpMusic / LyricsPlus のみ)は撤去した。
// あれは「優先」ではなく「他を全部禁止」という別種のつまみで、空振りすると
// 歌詞が出ない。新しい取得元を単体で評価するための一時的な項目だったが、
// その評価は終わり、両者とも通常の競走に参加している。
const normalizeSourceMode = (value) => (
  (value === 'ytm' || value === 'ytm_only') ? 'ytm'
    : (value === 'lrchub') ? 'lrchub'
      : 'ytm'
);

// Apple Music 風の同期表示は body のクラスで切り替える。
// 軽量モードでも動かす。
//
// 以前はここで一緒に止めていたが、止める根拠が無かった。
// 塗り(--sweep)も持ち上がり・膨らみ(transform)も Web Animations の
// キーフレームで合成側に渡してあり、メインスレッドの毎フレーム処理は 0。
// 軽量モードが本当に止めたいのは backdrop-filter のぼかしと背景ドリフトで、
// あちらは「ドリフトの毎フレーム、ビューポート全面のブラーを再計算」する
// (style.css の同名ブロックの注釈を参照)。桁が違う。
// 設定の文言も「背景アニメーション停止」であって、歌詞の話ではない。
//
// メインスレッドを毎フレーム使うのは光(--wg → text-shadow)だけなので、
// 軽量モードではそこだけ落とす(measureLyricLineSweep の _glow)。
const applyAppleSyncClass = () => {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('ytm-apple-sync', !!config.appleSyncStyle);
};

// YTM の取得を待つ上限。next → browse の2段直列で各段 5 秒あるので、
// 待ち切ると最大10秒ほど白紙になる。ここで切って先に他の歌詞を出し、
// 遅れて届いた YTM は applyLateLyricsUpgrade に差し替えを任せる。
const YTM_EARLY_WAIT_MS = 1500;

// いま表示している歌詞が「YTM優先」設定によって選ばれたものか。
// 通常の別ソースでは差し替えないが、アニメーション表示を有効にしている
// ときの LRCHub srv3 は表示モードそのものなので、後着でも受け付ける。
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

const getTimedTextPenOpacity = (pen) => {
  if (pen?.fo === undefined) return 1;
  const value = Number(pen.fo);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 254)) : 1;
};

const hasTimedTextVisibleEdge = (pen) => (
  !!pen &&
  String(pen.et || '0') !== '0' &&
  /^#[0-9a-f]{6}$/i.test(String(pen.ec || ''))
);

const isTimedTextPenVisible = (pen) => (
  getTimedTextPenOpacity(pen) > 0 || hasTimedTextVisibleEdge(pen)
);

const getTimedTextVisibleText = (segments, cuePenId, cuePen, pens) => {
  if (!isTimedTextPenVisible(cuePen)) return '';
  const normalizedCuePenId = String(cuePenId || '');
  const visible = (Array.isArray(segments) ? segments : []).filter((segment) => {
    const segmentPenId = String(segment?.penId || '');
    if (!segmentPenId || segmentPenId === normalizedCuePenId) return true;
    return isTimedTextPenVisible(pens?.get?.(segmentPenId) || {});
  });
  return normalizeTimedTextCaption(visible.map(segment => segment.text).join(''));
};

const buildTimedTextPlainLines = (events) => {
  const lines = [];
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  events.forEach((event) => {
    const sourceText = typeof event?.visibleText === 'string' ? event.visibleText : event?.text;
    const text = normalizeTimedTextCaption(sourceText);
    const norm = normalize(text);
    if (!norm) return;

    const last = lines[lines.length - 1];
    if (last && event.time <= (last.endTime || last.time) + 0.35) {
      const lastNorm = normalize(last.text);
      if (norm === lastNorm) {
        last.endTime = Math.max(last.endTime || last.time, event.endTime || event.time);
        return;
      }
      if (norm.includes(lastNorm) || lastNorm.includes(norm)) {
        if (norm.length >= lastNorm.length) {
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

// srv3 の短い <p> は、それ自体がアニメーションの1フレーム。
// 前後に許容時間を足すと、次の位置/透明度フレームまで同時表示されて
// 残像になるため、開始を含み終了を含まない区間で厳密に選ぶ。
const getActiveTimedTextEvents = (events, timeMs, limit = 24) => (
  (Array.isArray(events) ? events : [])
    .filter(event => (
      Number.isFinite(event?.startMs) &&
      Number.isFinite(event?.endMs) &&
      timeMs >= event.startMs &&
      timeMs < event.endMs
    ))
    .slice(-Math.max(1, Number(limit) || 24))
);

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
      const pen = pens.get(String(penId)) || {};
      const visibleText = getTimedTextVisibleText(segments, penId, pen, pens);
      // d が明示された srv3 の <p> は、その長さ自体がアニメーションの
      // 1フレーム。33ms/34ms の正規フレームを60msへ延ばすと、次の
      // フレームと重なって残像になる。欠落または0のときだけ補完する。
      const frameDurationMs = durationMs > 0 ? durationMs : 60;

      events.push({
        id: index,
        time: startMs / 1000,
        endTime: (startMs + frameDurationMs) / 1000,
        startMs,
        endMs: startMs + frameDurationMs,
        durationMs,
        text,
        visibleText,
        segments: segments.length ? segments : [{ text, penId }],
        penId,
        wpId,
        wsId,
        pen,
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
  if (ju === 1) return 'right';
  return 'center'; // srv3: ju=2
};

const getTimedTextScaledFontSize = (rawSize, fallback = 140) => {
  const numeric = Number(rawSize);
  const sourceSize = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(20, Math.min(98, sourceSize * 0.30));
};

const getTimedTextForegroundColor = (pen, fallback = '#FEFEFE') => {
  const color = /^#[0-9a-f]{6}$/i.test(String(pen?.fc || '')) ? pen.fc : fallback;
  const alpha = getTimedTextPenOpacity(pen);
  if (alpha >= 0.999) return color;
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
};

const getTimedTextShadow = (pen) => {
  if (hasTimedTextVisibleEdge(pen)) {
    return `0 0 2px ${pen.ec}, 0 2px 8px rgba(0,0,0,.72)`;
  }
  return getTimedTextPenOpacity(pen) > 0
    ? '0 2px 10px rgba(0,0,0,.72)'
    : 'none';
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
  const color = getTimedTextForegroundColor(pen);
  const textShadow = getTimedTextShadow(pen);

  return [
    `left:${left}%`,
    `top:${top}%`,
    `transform:${getTimedTextAnchorTransform(win.ap)}`,
    `--ytm-animated-base-font-size:${baseFontSize}px`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `text-shadow:${textShadow}`,
    `text-align:${getTimedTextAlign(event.windowStyle)}`,
    pen.i === '1' ? 'font-style:italic' : '',
  ].filter(Boolean).join(';');
};

const shouldApplyTimedTextSegmentPen = (segment, event) => {
  const segmentPenId = String(segment?.penId || '');
  const cuePenId = String(event?.penId || '');
  // p の pen は親要素ですでに適用済み。同じ pen を span にも適用すると
  // fo (opacity) が二重に掛かり、フェードフレームがほぼ見えなくなる。
  return !!segmentPenId && segmentPenId !== cuePenId;
};

const getTimedTextSegmentHtml = (event) => (
  ((segments, scale) => segments.map(segment => {
    if (!shouldApplyTimedTextSegmentPen(segment, event)) return escapeHtml(segment.text);
    const pen = animatedCaptionData?.pens?.get(String(segment.penId || event.penId)) || event.pen || {};
    const color = getTimedTextForegroundColor(pen, '#FEFEFE');
    const size = Number(pen.sz || 0);
    const style = [
      `color:${color}`,
      `text-shadow:${getTimedTextShadow(pen)}`,
      size ? `font-size:${(getTimedTextScaledFontSize(size, size) * scale).toFixed(2)}px` : '',
      pen.i === '1' ? 'font-style:italic' : '',
    ].filter(Boolean).join(';');
    return `<span${style ? ` style="${style}"` : ''}>${escapeHtml(segment.text)}</span>`;
  }).join(''))(event.segments || [{ text: event.text, penId: event.penId }], getAnimatedCaptionFontScale())
);

const syncTimedTextStage = (stage, activeEvents) => {
  if (!stage) return;
  const existing = new Map(
    Array.from(stage.children || []).map(node => [String(node.dataset?.srv3EventId || ''), node])
  );
  const activeIds = new Set();
  const ownerDocument = stage.ownerDocument || document;

  activeEvents.forEach((event) => {
    const eventId = String(event.id);
    activeIds.add(eventId);
    let cue = existing.get(eventId);
    if (!cue) {
      cue = ownerDocument.createElement('div');
      cue.className = 'ytm-animated-caption-cue';
      cue.dataset.srv3EventId = eventId;
      cue.style.cssText = getTimedTextCueStyle(event);
      cue.innerHTML = getTimedTextSegmentHtml(event);
    }
    // appendChild は既存nodeを破棄せず、srv3の重なり順だけを揃える。
    stage.appendChild(cue);
  });

  existing.forEach((cue, eventId) => {
    if (!activeIds.has(eventId)) cue.remove();
  });
};

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
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
    const pipBody = PipManager.pipWindow.document?.body;
    if (pipBody) {
      pipBody.classList.remove('ytm-no-lyrics', 'ytm-no-timestamp');
      pipBody.classList.add('ytm-animated-caption-mode');
      pipBody.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
    }
  }
  const now = getCurrentPlaybackTimeSec();
  updateAnimatedCaptionStage(typeof now === 'number' ? now : 0, true);
}

// 字幕の受け皿は毎フレーム同じ要素。入れ替わるのは歌詞を組み直した時だけなので、
// container に覚えさせて querySelector を毎フレーム走らせない。
const findAnimatedCaptionStage = (container) => {
  if (!container) return null;
  const cached = container._ytmCaptionStage;
  if (cached && cached.isConnected && container.contains(cached)) return cached;
  const found = container.querySelector('.ytm-animated-caption-stage');
  container._ytmCaptionStage = found;
  return found;
};

function updateAnimatedCaptionStage(currentTime, force = false) {
  if (!animatedCaptionData || !ui.lyrics) return;
  const stages = [findAnimatedCaptionStage(ui.lyrics)];
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    stages.push(findAnimatedCaptionStage(PipManager.pipLyricsContainer));
  }
  const availableStages = stages.filter(Boolean);
  if (!availableStages.length) return;
  const tMs = Math.max(0, currentTime * 1000);
  const active = getActiveTimedTextEvents(animatedCaptionData.events, tMs);
  const key = active.map(event => `${event.id}:${event.startMs}:${event.endMs}`).join('|');
  if (!force && key === animatedCaptionFrameKey) return;
  animatedCaptionFrameKey = key;
  availableStages.forEach(stage => {
    syncTimedTextStage(stage, active);
  });
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
// 動画/曲の切り替えが使える状態か。
//
// 以前はサイドガイドの項目数(childNodes.length >= 4)で非 Premium と
// 判断していた。YTM の UI が変わるだけで判定が裏返り、動画モードの
// セットアップが走らなくなったり、走るべきでない時に走ったりする。
//
// 判断材料は切り替えトグルそのものにする。存在して playback-mode を
// 持っていれば、実際に切り替えられる。
function isYTMPremiumUser() {
  const switcher = document.querySelector("ytmusic-av-toggle");
  const canSwitch = !!switcher && switcher.hasAttribute('playback-mode');
  if (switcher) switcher.classList.toggle('notpremium', !canSwitch);
  return canSwitch;
}

function preferLyricsDefault(targetKey, attempt = 0) {
  if (!targetKey || currentKey !== targetKey) return;
  // 設定で切れるようにした。以前は曲が変わるたびに必ず「曲」へ寄せていたので、
  // 「動画」を選んでいても毎曲戻され、動画モードに留まる手段が無かった。
  if (!config.preferSongMode) return;

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
// 目当ての要素が現れるまで待つ。
// 1 秒ごとの setInterval で探し続けると、見つかるまでの数十秒ずっと
// 空振りのクエリを回すことになる。DOM が動いた時だけ見に行く。
const waitForDomCondition = (check, timeoutMs) => new Promise((resolve) => {
  const first = check();
  if (first) { resolve(first); return; }

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    clearTimeout(timer);
    resolve(value);
  };
  const observer = new MutationObserver(() => {
    const value = check();
    if (value) finish(value);
  });
  const timer = setTimeout(() => finish(null), timeoutMs);
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

const hoverTimeInfoSetup = () => {
  // "m:ss" と "h:mm:ss" の両方を受ける。1 時間を超える曲(ライブ音源・
  // ミックス)で後ろの2つしか見ていなかったため、ホバーの時刻が NaN になっていた。
  const timeToSeconds = (str) => {
    const parts = String(str || '').split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
  };
  const formatHoverTime = (totalSeconds) => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };
  const removeHoverTimeInfo = () => {
    void waitForDomCondition(
      () => document.querySelector('#hover-time-info'),
      30000
    ).then(info => { if (info) info.remove(); });
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
    const findParts = () => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const sliderBar = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      );
      const slider = sliderBar?.parentElement?.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');
      if (!(slider && info && progresshandle && playerBar)) return null;
      return { progresshandle, info, slider, playerBar };
    };

    void waitForDomCondition(findParts, 60000).then((parts) => {
      if (!parts) return;
      const { progresshandle, info, slider, playerBar } = parts;
      const onMove = (e) => {
        const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
        const infoLeft = e.clientX;
        const relativeMouseX = e.clientX - marginLeft;
        const timeinfo = document.querySelector('#left-controls > span');
        if (!timeinfo) return;
        const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
        const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
        const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
        info.style.display = 'block';
        info.style.left = `${infoLeft}px`;
        info.textContent = formatHoverTime(hoverTimeSeconds);
      };
      const hide = () => {
        info.style.display = 'none';
      };
      slider.addEventListener('mousemove', onMove);
      slider.addEventListener('mouseout', hide);
      progresshandle.addEventListener('mousemove', onMove);
      progresshandle.addEventListener('mouseout', hide);
    });
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
    const res = await safeRuntimeSendMessage(
      { type: 'TRANSLATE', payload: { text: segmentsToTranslate, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } }
    );
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

// DeepL の結果置き場。曲(currentKey)と言語と歌詞本文が同じなら叩き直さない。
// 歌詞本文まで見るのは、取得元が差し替わって行が変わることがあるため。
const DEEPL_CACHE_MAX = 8;
const deepLTranslationCache = new Map();

const deepLCacheKey = (lines, langCode) => {
  const body = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '').join('\n');
  return `${currentKey || ''}///${langCode}///${body}`;
};

const translateWithDeepLCached = async (lines, langCode) => {
  const key = deepLCacheKey(lines, langCode);
  if (deepLTranslationCache.has(key)) return deepLTranslationCache.get(key);
  const translated = await translateTo(lines, langCode);
  if (!translated) return null;
  // 古いものから落とす。曲を跨いで無制限に溜めない。
  if (deepLTranslationCache.size >= DEEPL_CACHE_MAX) {
    deepLTranslationCache.delete(deepLTranslationCache.keys().next().value);
  }
  deepLTranslationCache.set(key, translated);
  return translated;
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
      const res = await safeRuntimeSendMessage(
        { type: 'TRANSLATE', payload: { text: requestTexts, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } }
      );

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

  const parts = splitBylineParts(aEl.textContent);

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
    mergeLyricsCandidates(p.mergeCandidates);
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
      const keepAnimatedStage = !!(
        config.useAnimatedCaptions &&
        animatedCaptionData &&
        document.body.classList.contains('ytm-animated-caption-mode')
      );
      // srv3 is the selected top-level display mode. A late DynamicLRC metadata
      // packet is an alternative representation, not permission to tear down
      // the animated stage and restore ordinary lyric rows.
      if (!keepAnimatedStage) {
        dynamicLines = p.dynamicLines;
        // re-render to attach per-char spans while keeping current lines/translations
        if (Array.isArray(lyricsData) && lyricsData.length) {
          renderLyrics(lyricsData);
        }
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

// ── 取得元の表示 ──────────────────────────────────────────
// 歌詞の出どころは LRCHub / YouTube Music / SimpMusic / LyricsPlus / LRCLIB と
// 増えたうえ、同じ曲でも「先に返した方が勝つ」ので実行のたびに変わりうる。
// 出し方はひと通りだけ: 手を動かした時に出て、止まれば引っ込む
// (body.ytm-pointer-active)。設定は置かない。
// 以前は「いまの取得元を画面に表示する」という設定があったが、手を動かした
// 時だけ出す方式にした時点で、OFF でも出るのに名前は「表示する」のままという
// 嘘になっていた。聴いている間は出ず、触れば出るなら、切りたい理由が無い。
// 選ばせる必要のない物を設定に並べない。
// デバッグ(ytm_debug)で増えるのはコンソールへの記録だけ。画面には出さない。
// フラグを立てた人が欲しいのは記録であって、消せない常設表示ではない。
const LYRICS_SOURCE_LABELS = {
  lrchub: 'LRCHub',
  lrclib: 'LRCLIB',
  ytm: 'YouTube Music',
  simpmusic: 'SimpMusic',
  lyricsplus: 'LyricsPlus',
};

// 並びは selectLyricsPayload の quality と対応させること。
// 統合時に上流が 3(単語同期) と 4(srv3 字幕) を入れ替えたので、
// ここも入れ替えてある。片方だけ直すと表示が嘘になる。
const LYRICS_QUALITY_LABELS = ['', '時刻なし', '行同期', '単語同期', '字幕同期'];

// ── 手を動かしている間だけ出すもの ──────────────────────
// 聴いているだけの間は画面に何も足さない。没入が主眼なので、常設の
// 表示は置かない。ただし「歌詞がずれている」と気づいた人は必ず何か
// 操作しようとしてマウスを動かすので、その瞬間に出す。
// 動画プレイヤーの操作盤と同じ作法。
//
// 「歌詞にホバーしたら」にはしない。バッジは左下、歌詞は右側なので、
// 手を伸ばす途中で条件が切れて消えてしまう。
const POINTER_IDLE_HIDE_MS = 2600;
let pointerIdleTimer = null;
// 手を置いたままでも届く mousemove がある。Chrome は scrollTop が動くと、
// カーソルの下にある物が変わったかを取り直すために、同じ座標の mousemove を
// 投げてくる。歌詞は行が変わるたびに毎フレーム scrollTop を書くので、画面の
// 上にカーソルを置いたままにしていると、曲が続くかぎりそれが届き続け、
// 「ずっと手を動かしている」ことになってバッジが引っ込まなかった。
// 座標が動いた時だけ本物の操作として扱う。
let lastPointerX = null;
let lastPointerY = null;

const notePointerActivity = (ev) => {
  if (typeof document === 'undefined' || !document.body) return;
  if (ev && ev.type === 'mousemove') {
    if (ev.clientX === lastPointerX && ev.clientY === lastPointerY) return;
    lastPointerX = ev.clientX;
    lastPointerY = ev.clientY;
  }
  document.body.classList.add('ytm-pointer-active');
  if (pointerIdleTimer) clearTimeout(pointerIdleTimer);
  pointerIdleTimer = setTimeout(() => {
    pointerIdleTimer = null;
    document.body.classList.remove('ytm-pointer-active');
  }, POINTER_IDLE_HIDE_MS);
};

const setupPointerActivityWatch = () => {
  if (typeof document === 'undefined') return;
  // 毎フレーム走るので、やるのはクラス付与とタイマー再設定だけに留める
  document.addEventListener('mousemove', notePointerActivity, { passive: true });
  document.addEventListener('mousedown', notePointerActivity, { passive: true });
};

// ── ズレ直し ────────────────────────────────────────────
// 歌詞のズレは、気づくのが歌詞を見ている時なのに、直すつまみは設定パネルの
// 奥にあった。同じ問題への答え(取得元を替える / ズレを直す)は同じ場所に
// 置く。値そのものは前からある config.syncOffset で、ここは入口だけ。
//
// 既定では曲が変わるとリセットされる(設定「曲が切り替わったときに
// オフセットをリセットしない」で変えられる)。曲ごとの手当てなので、
// 引きずらない方が既定として妥当。
const LYRIC_OFFSET_STEP_MS = 100;
const LYRIC_OFFSET_MAX_MS = 10000;

const formatLyricOffset = (ms) => {
  const sec = (Number(ms) || 0) / 1000;
  return `${sec > 0 ? '+' : ''}${sec.toFixed(1)}s`;
};

const refreshLyricOffsetUi = () => {
  if (!ui.uploadMenu) return;
  const el = ui.uploadMenu.querySelector('[data-role="offset-value"]');
  if (el) el.textContent = formatLyricOffset(config.syncOffset);
};

const applyLyricOffsetMs = (ms) => {
  const clamped = Math.max(-LYRIC_OFFSET_MAX_MS, Math.min(LYRIC_OFFSET_MAX_MS, Math.round(Number(ms) || 0)));
  config.syncOffset = clamped;
  refreshLyricOffsetUi();
  // 設定パネルを開いている時は、そちらの数値も合わせる
  const input = document.getElementById('sync-offset-input');
  if (input) input.valueAsNumber = clamped;
  void storage.set('ytm_sync_offset', clamped);
};

// 取得元バッジから歌詞メニューを開く。
// メニューは Lyrics ボタンにぶら下がっているので、その場で出すだけでよい。
const openLyricsMenu = () => {
  if (!ui.uploadMenu) return;
  refreshCandidateMenu();
  refreshLockMenu();
  refreshLyricOffsetUi();
  ui.uploadMenu.classList.add('visible');
};

// バッジは「⌄」を出している以上、押して開いたものは押して閉じられないと
// おかしい。開いている時に押しても閉じないのは、外側クリックで閉じる係が
// 捕捉段階(capture)で先に閉じ、その直後にここが開き直していたため。
// 閉じる係の方でバッジを除外し、開け閉ては全部ここが持つ。
const toggleLyricsMenu = () => {
  if (!ui.uploadMenu) return;
  if (ui.uploadMenu.classList.contains('visible')) {
    ui.uploadMenu.classList.remove('visible');
    hideCandidateHoverPreview();
    return;
  }
  openLyricsMenu();
};

function updateLyricsSourceDebugBadge(payload) {
  // この関数はテストで updateLyricsSourceState だけ切り出して実行されることがあり、
  // その文脈には YTMLog も document も無い。存在確認してから触る。
  if (typeof document === 'undefined' || !document.body) return;

  if (typeof YTMLog !== 'undefined' && YTMLog.enabled) {
    YTMLog.log('[CS] 歌詞ソース:', currentLyricsSource, payload?.sourceLabel || '');
  }
  // 取得元が分からない間は置かない
  if (!currentLyricsSource) {
    document.getElementById('ytm-lyrics-source-debug')?.remove();
    return;
  }

  let el = document.getElementById('ytm-lyrics-source-debug');
  if (!el) {
    el = createEl('div', 'ytm-lyrics-source-debug', '', '');
    // 押せるものになったので、読み上げからも隠さない
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.title = '歌詞の取得元を切り替える / ズレを直す';
    const open = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLyricsMenu();
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') open(ev);
    });
    // ボタン列の真下に置く。押すと開くメニューもそこにぶら下がっているので、
    // 見つける場所と操作する場所が揃う。画面の隅だと歌詞からも操作系からも
    // 離れた孤立した位置になり、気づかれない。
    // ボタン列がまだ無い時は body に置いて、下の CSS で隅に固定する。
    if (ui.btnArea && ui.btnArea.parentNode) {
      el.classList.add('ytm-source-inline');
      ui.btnArea.insertAdjacentElement('afterend', el);
    } else {
      document.body.appendChild(el);
    }
  }
  // sourceLabel は background が付ける実際に当たった経路名
  // (例: 'LRCHub search' / 'LRCHub retry')。無ければ ID から引く。
  const label = (typeof payload?.sourceLabel === 'string' && payload.sourceLabel.trim())
    ? payload.sourceLabel.trim()
    : (LYRICS_SOURCE_LABELS[currentLyricsSource] || currentLyricsSource);

  let quality = 0;
  try {
    quality = selectLyricsPayload(payload).quality;
  } catch (e) { /* 品質が読めなくても取得元は出す */ }
  const qualityLabel = LYRICS_QUALITY_LABELS[quality] || '';

  const parts = [label];
  if (qualityLabel) parts.push(qualityLabel);
  el.textContent = `歌詞ソース: ${parts.join(' / ')}`;
}

function updateLyricsSourceState(payload, notify = true) {
  currentLyricsSource = String(payload?.lyricsSource || payload?.source || '').trim().toLowerCase() || null;
  if (typeof updateLyricsSourceDebugBadge === 'function') {
    updateLyricsSourceDebugBadge(payload);
  }
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
  const availableDynamicLines = hasCharacterSyncedLines(payload?.dynamicLines)
    ? payload.dynamicLines
    : null;
  // 「アニメーション歌詞」は LRCHub の srv3 (animated_lyrics)。設定が ON の
  // ときは同じレコードに DynamicLRC があっても srv3 を明示的に選ぶ。
  const useAnimated = !!config.useAnimatedCaptions && !!animatedLyrics.trim();
  const nextDynamicLines = useAnimated ? null : availableDynamicLines;
  const mode = useAnimated
    ? 'animated'
    : (nextDynamicLines
      ? 'dynamic'
      : (/\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? 'synced' : (lyrics.trim() ? 'plain' : 'none')));
  const quality = useAnimated
    ? 4
    : (nextDynamicLines
      ? 3
      : (/\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? 2 : (lyrics.trim() ? 1 : 0)));
  return {
    text: useAnimated ? animatedLyrics : lyrics,
    lyrics,
    animatedLyrics,
    dynamicLines: nextDynamicLines,
    mode,
    quality,
  };
};

async function applyLateLyricsUpgrade(payload) {
  // 'ytm' も受ける。YouTube Music 側は時刻なしの歌詞を先に返しておいて、
  // 裏で同期版を探し当てたらここで差し替えにくる。
  // 差し替えてよいのはこの4つ。LrcLib は入れない。行同期止まりなので、
  // 暫定表示を格上げする側ではなく常に格下げされる側だから。
  // (配列をここに直書きしているのは、この関数がテストで単体切り出しされ、
  //  外側の定数が存在しない文脈で実行されるため)
  const lateSource = payload && payload.lyricsSource;
  const upgradableSources = ['lrchub', 'ytm', 'simpmusic', 'lyricsplus'];
  if (!payload || !upgradableSources.includes(lateSource) || !payload.success) return;
  if (!currentKey || payload.track_key !== currentKey) return;
  if (!activeLyricsRequestId || payload.request_id !== activeLyricsRequestId) return;
  if (payload.video_id && currentLyricsVideoId && payload.video_id !== currentLyricsVideoId) return;
  // A manual candidate choice is an explicit user decision; never replace it
  // with a request that started before that choice.
  if (selectedCandidateId || currentLyricsResultPriority >= 3) return;
  const selected = selectLyricsPayload(payload);
  if (!selected.text || !selected.text.trim()) return;
  // YTM優先で選ばれた通常歌詞へ別ソースを割り込ませない。ただし設定で
  // 要求された srv3 は通常の行同期とは異なる表示モードなので差し替える。
  // typeof は、この関数を単体切り出しするテスト環境向け。
  if (
    typeof currentLyricsFromPreferredYtm !== 'undefined' &&
    currentLyricsFromPreferredYtm &&
    selected.mode !== 'animated'
  ) return;
  if (currentLyricsResultPriority === 2 && selected.quality <= currentLyricsQuality) return;
  const requestId = activeLyricsRequestId;
  const targetKey = currentKey;
  const targetVideoId = currentLyricsVideoId;
  currentLyricsResultPriority = 2;
  currentLyricsQuality = selected.quality;

  // 遅れて届いた差し替え(特に YouTube Music)には候補一覧・requests・config・
  // 翻訳が入っていない。無条件に代入すると、LrcLib で暫定表示していた時の
  // 候補メニューが丸ごと消える。loadLyrics と同じく「あれば更新」に揃える。
  if (Array.isArray(payload.candidates) && payload.candidates.length) lyricsCandidates = payload.candidates;
  if (Array.isArray(payload.requests)) lyricsRequests = payload.requests;
  if (payload.config) lyricsConfig = payload.config;
  lyricsTranslationMap = {
    ...(lyricsTranslationMap || {}),
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
          candidates: LyricsCache.stripCandidateLyrics(lyricsCandidates) || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: lateSource,
          fetchedAt: Date.now(),
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

// video の時刻を曲内ローカル時間に直す。
//
// timeOffset(この曲が始まった video 時間)を書き換えるのは
//   ・曲が変わった時の tick
//   ・巻き戻りを見つけた rAF ループ
//   ・シーク(seeked)
// の 3 箇所だけ。表示のために時刻を読むだけの経路がついでに書き換えると、
// どこで値が変わったのか追えなくなる。ここでは読むだけ。
const toLocalPlaybackTime = (rawTime) => {
  // offset を下回っているなら、その曲は頭から掛け直されている
  const offset = (timeOffset > 0 && rawTime < timeOffset) ? 0 : timeOffset;
  return Math.max(0, rawTime - offset);
};

const getCurrentPlaybackTimeSec = () => {
  const v = document.querySelector('video');
  if (!v || typeof v.currentTime !== 'number' || Number.isNaN(v.currentTime)) return null;
  let t = toLocalPlaybackTime(v.currentTime);
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
// 「設定をリセット」で消すキー。ここに挙げたものだけを消す。
// 再生履歴(ytm_local_history)・歌詞キャッシュ("曲名///アーティスト")・
// クラウドの復活の呪文・解説のピン留めは設定ではないので入れない。
const SETTINGS_STORAGE_KEYS = [
  'ytm_deepl_key',
  'ytm_trans_enabled',
  'ytm_shared_trans_enabled',
  'ytm_left_align',
  'ytm_keep_past_lyrics',
  'ytm_prefer_song_mode',
  'ytm_apple_bg',
  'ytm_low_cpu_mode',
  'ytm_apple_sync_style',
  'ytm_animated_captions_enabled',
  'ytm_singer_colors_enabled',
  'ytm_lrclib_fallback',
  'ytm_meaning_always_show',
  'ytm_main_lang',
  'ytm_sub_lang',
  'ytm_ui_lang',
  'ytm_lyric_weight',
  'ytm_bg_brightness',
  'ytm_ui_scale',
  'ytm_sync_offset',
  'ytm_save_sync_offset',
  'ytm_lyric_source_mode',
  'ytm_queue_pinned',
];
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
        const track = normalizeSearchTrackTitle(metaNow?.title);
        const artist = metaNow?.artist || '';
        const res = await safeRuntimeSendMessage({
          type: 'GET_TRANSLATION',
          payload: {
            track,
            artist,
            youtube_url: youtubeUrl,
            video_id: getCurrentVideoId(),
            langs: missingLangs
          }
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
      // applyTranslations は遅着の差し替え・sub 歌詞の到着・設定保存でも
      // 走る。毎回 DeepL を叩くと同じ曲で何度も API 枠を消費するので、
      // 同じ歌詞・同じ言語なら前の結果を使い回す。
      const translatedTexts = await translateWithDeepLCached(baseLines, lang);
      if (translatedTexts && translatedTexts.length === baseLines.length) {
        const lines = baseLines.map((l, i) => ({
          time: l.time,
          text: translatedTexts[i]
        }));
        transLinesByLang[lang] = lines;
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


// ===================== Apple Music 風の文字同期 =====================
// Apple Music の歌詞が美しく見えるのは、次が同時に起きているため:
//   1. 塗りの先端が行を「ひと続きに」流れていく。境目はぼけている
//   2. 歌い終わった語はわずかに持ち上がったまま残る
//   3. 伸ばした音だけが膨らんで光り、また戻る。速い語は光らない
//
// ■ 描画の単位を「文字」ではなく「語」にしている理由
//   1文字ずつ span に切って inline-block にすると、文字の間で字形の詰め
//   (カーニング)が効かない。同じ英文で実測 3.3px 横に伸び、字の間が空く。
//   語単位なら 1.4px まで縮む。さらに1文字ずつ独立に持ち上げ・拡大すると
//   語がバラバラに動いてガタついて見える。
//   日本語のように空白で切れない言語は1字ずつに切る。全角どうしは
//   字形の詰めがほぼ効かないので、切っても隙間は出ない。
//
// ■ 塗りは行ぜんたいで1本の勾配として扱う
//   語ごとに 0→1 の勾配を持たせると、語の変わり目でぼかしが途切れて
//   境目が見える。そこで「行の先頭から何 px 進んだか」(--sweep)だけを
//   毎フレーム1回書き、各語は自分の開始位置(--wx)を引いて自分の
//   ところだけを描く。先端は語をまたいでひと続きに流れる。
//
// ■ 光と拡大は伸ばした音だけ
//   全部の語を光らせると、行がのっぺり明るくなって「いま歌っている所」が
//   分からなくなる。長さで強さを決め、短い語はほぼ素通しにする。
//   曲線は applemusic-like-lyrics が Apple Music を参照して置いたものに合わせた。

// 塗りの境目のぼかし半幅(文字サイズ基準)。ぼかしの幅はこの2倍。
//
// ここを広げすぎると、ぼかしが1文字まるごとを覆ってしまう。すると
// 先端が字を「横切る」のではなく、字が丸ごとフェードインすることになり、
// それが1文字ずつ順に起きて、かくんかくんと点いていくように見える。
// 全角の字は 1em あるので、ぼかしの幅は 1em より狭くないといけない。
// applemusic-like-lyrics は行の高さの半分(≒0.6em)を既定にしている。
const WORD_FEATHER_EM = 0.3;
// 伸ばした音がふくらむ時に持ち上がる量。歌い終わっても残さない。
//
// 以前は「歌い終わった語は持ち上がったまま残る」ようにしていたが、
// これだと語ごとに高さが違う階段ができる。歌った語は上、まだの語は下、
// その境目に段差が残るので、語と語の間に区切りがあるように見えてしまう。
// Apple Music の行は平らで、流れているのは塗りだけ。
// 動くのは伸ばした音だけにして、しかも元の高さへ戻す。
const WORD_LIFT_EM = 0.05;
// ふくらみの最短時間。速い語がパッと跳ねないようにする。
const WORD_LIFT_MIN_SEC = 1.0;
// 強調(拡大+光)の前倒し。声が当たる前から膨らみ始める。
const WORD_EMPHASIS_PREROLL_SEC = 0.4;
// 強調の全体の長さ。音の長さの 1.4 倍。
const WORD_EMPHASIS_STRETCH = 1.4;
// 次の語が無い時に1語へ割り当てる長さ
const WORD_DEFAULT_SEC = 0.4;
// 書き込みの量子化。粗いと長く伸ばす音で動きが飛び飛びになる。
const WORD_STEP = 512;
// 塗りの先端の px を刻む細かさ。粗いと、1フレームの進み幅が
// 刻み幅に丸められて速度が数%ずつ揺れる。動いている間はどのみち
// 毎フレーム書くので、細かくしても書き込み回数は増えない。
const SWEEP_STEP = 32;

// 端で微分が 0 になるので、増減の切り替わりで折れ線にならない
const smoothstep = (x) => (x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)));
// 両端が 0、中央が 1 の滑らかな山(ハン窓)。強調の立ち上がりと戻りに使う。
const bellCurve = (x) => (x <= 0 || x >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * x));

// 音の長さ → 強調の強さ。短い音はほぼ素通し、伸ばすほど急に強くなって頭打ち。
// 全部の語を光らせないのが肝。光らせると行がのっぺり明るくなり、
// 「いま歌っている所」が読み取れなくなる。
// 形は applemusic-like-lyrics のものに倣い、指数だけ緩めた。
// あちらは 1 秒未満をほぼ完全に落とすが、それだと速い曲で
// 一度も膨らまないまま終わってしまう。
const emphasisCurve = (durSec, scale) => {
  const x = durSec / scale;
  return x > 1 ? Math.sqrt(x) : Math.pow(x, 1.8);
};
const emphasisScaleAmount = (durSec) => Math.min(1.2, emphasisCurve(durSec, 1.8) * 0.7);
const emphasisGlowAmount = (durSec) => Math.min(0.7, emphasisCurve(durSec, 2.4) * 0.45);

const isSpaceGlyph = (c) => c === ' ' || c === ' ' || c === '\t' || c === '　';

// 日本語・中国語・韓国語は語の区切りに空白が無い。空白だけで切ると
// 行まるごとが1単位になってしまい、光と持ち上げが行全体に一様に掛かる
// (歌っている位置を光が追いかけなくなる)。
//
// かといって1字ずつ切ると、箱が字の数だけ増える。全角は字形の詰めが
// ほぼ効かないので総幅は変わらないのだが、箱が増えるほど字の間の見え方が
// 揃わなくなる。ブラウザの語区切りで切って、語の中はひと続きに組ませる。
// 塗りの位置は行ぜんたいの --sweep が持っているので、単位が語に粗くなっても
// 同期の細かさは落ちない。
const lyricUnitSegmenter = (() => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch (e) { /* 使えなければ下の簡易規則に落とす */ }
  return null;
})();

// 語区切りが使えない環境用の保険。全角は1字ずつに切る。
const CJK_GLYPH_RE = /[⺀-〾ぁ-㏿㐀-䶿一-鿿豈-﫿＀-ﾟ￠-￦가-힯]/;
// 拗音・促音・長音・濁点や閉じ括弧は、単独では1拍にならない。
// 前の字にぶら下げて「ちゃ」「きゅう」を一息で扱う。
const CJK_TAIL_RE = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ゛゜々〆、。，．！？!?)）」』】〕》〉”’]/;

// dynamicLines の chars を「1文字 + 開始秒」の並びに均す。
// chars は基本 1 文字ずつだが、プロバイダーによっては "Maybe " のような
// 語の塊で来る。塊のままだと語の切れ目が取れないので、次の時刻までを
// 文字数で割って配る。
const flattenLyricGlyphs = (chars, lineEndSec) => {
  const flat = [];
  if (!Array.isArray(chars)) return flat;

  const timeAt = (i) => {
    const v = Number(chars[i]?.t);
    return Number.isFinite(v) ? v / 1000 : null;
  };

  for (let i = 0; i < chars.length; i++) {
    const raw = String(chars[i]?.c ?? '');
    if (!raw) continue;
    const start = timeAt(i);

    let next = null;
    for (let j = i + 1; j < chars.length; j++) {
      const t = timeAt(j);
      if (t !== null) { next = t; break; }
    }
    if (next === null) {
      next = Number.isFinite(lineEndSec)
        ? lineEndSec
        : (start === null ? null : start + WORD_DEFAULT_SEC);
    }

    const glyphs = Array.from(raw);
    const step = (start !== null && next !== null && next > start)
      ? (next - start) / glyphs.length
      : 0;
    glyphs.forEach((g, k) => {
      flat.push({ c: g, t: start === null ? null : start + step * k });
    });
  }
  return flat;
};

// 空白で区切って語にまとめる。空白は語に含めず、素のテキストとして
// 語と語の間に置く(inline-block の中に入れると折り返せなくなる)。
const buildLyricWordUnits = (chars, lineEndSec) => {
  const flat = flattenLyricGlyphs(chars, lineEndSec);

  // ── 1文字ごとに空白を挟んだデータ ──────────────────────
  // 日本語の同期データには、文字と文字の間すべてに空白を入れたものがある。
  // 実測では、語タグの 83〜92% が空白で終わる曲が複数あった(滑らかに
  // 見える曲は 20%)。
  //
  // これをそのまま語の区切りとして扱うと、全部の文字が独立した単位になる。
  // 膨らみ・光・持ち上げは単位ごとに掛かって戻るので、1文字ずつ点いては
  // 止まって見える。行の幅も倍近くになり、折り返しも増える。
  //
  // 前後がどちらも CJK の空白は、語の区切りではなく書式。語を切らせない。
  // 英語のように本当に空白で語が分かれる言語は対象外(下の判定で外れる)。
  const isFormattingSpace = new Array(flat.length).fill(false);
  {
    let spaces = 0;
    let betweenCjk = 0;
    for (let i = 0; i < flat.length; i++) {
      if (!isSpaceGlyph(flat[i].c)) continue;
      spaces += 1;
      const prev = flat[i - 1];
      const next = flat[i + 1];
      if (prev && next && CJK_GLYPH_RE.test(prev.c) && CJK_GLYPH_RE.test(next.c)) {
        isFormattingSpace[i] = true;
        betweenCjk += 1;
      }
    }
    // 半分を超えていなければ、ふつうに語を分けている空白とみなす
    if (!spaces || betweenCjk / spaces <= 0.5) isFormattingSpace.fill(false);
  }

  // 語の頭になる位置を先に出す。Intl の語区切りは英語も日本語も
  // 同じ呼び方で扱えるので、言語で分岐しない。
  // 書式の空白を外した文字列で切ることで、本来の語のまとまりが出る。
  const boundaries = new Set();
  if (flat.length && lyricUnitSegmenter) {
    try {
      let text = '';
      const flatIndexAt = new Map();
      for (let i = 0; i < flat.length; i++) {
        if (isFormattingSpace[i]) continue;
        flatIndexAt.set(text.length, i);
        text += flat[i].c;
      }
      for (const seg of lyricUnitSegmenter.segment(text)) {
        const index = flatIndexAt.get(seg.index);
        if (index !== undefined) boundaries.add(index);
      }
    } catch (e) { /* 落ちたら下の簡易規則へ */ }
  }
  const useSegmenter = boundaries.size > 0;

  const units = [];
  let current = null;
  let currentIsCjk = false;

  flat.forEach((glyph, index) => {
    if (isSpaceGlyph(glyph.c)) {
      // 書式の空白は歌詞の一部ではないので、まるごと捨てる。
      //
      // 残すと二つの困りごとが出る。ひとつは単純に、字と字の間が
      // 空いて見えること。もうひとつは塗りの速さで、こちらの方が重い。
      // データは「<時刻>文字+空白」で区切られているため、区間の時間が
      // 文字と空白で等分される。つまり塗りは各区間の半分を、目に見えない
      // 空白の上で使う。文字の上だけ倍速で通り、空白の上で止まって見える。
      //
      // 捨てれば、その文字が区間の時間をまるごと使う。速さが揃う。
      if (isFormattingSpace[index]) return;
      const last = units[units.length - 1];
      if (last && last.type === 'space') last.text += glyph.c;
      else units.push({ type: 'space', text: glyph.c });
      current = null;
      return;
    }

    const isTail = CJK_TAIL_RE.test(glyph.c);
    let needsNewUnit;
    if (useSegmenter) {
      // 拗音・長音は語区切りに関わらず前へぶら下げる
      needsNewUnit = !current || (!isTail && boundaries.has(index));
    } else {
      const isCjk = CJK_GLYPH_RE.test(glyph.c);
      needsNewUnit = !current || (!isTail && (isCjk || currentIsCjk));
      if (needsNewUnit) currentIsCjk = isCjk;
    }

    if (needsNewUnit) {
      current = { type: 'word', text: '', times: [], offsets: [], endIndex: index };
      units.push(current);
    }
    current.offsets.push(current.text.length);
    current.text += glyph.c;
    current.times.push(glyph.t);
    current.endIndex = index;
  });

  // 各語の終わりは「その語の最後の文字の次に来るもの」の時刻。
  // 次の語の頭を使うと、語と語の間の無音ぶんまで塗りが伸びてしまう。
  for (const unit of units) {
    if (unit.type !== 'word') continue;
    let end = null;
    for (let i = unit.endIndex + 1; i < flat.length; i++) {
      // 捨てた書式空白の時刻は拾わない。データは「文字+空白」で1区間
      // なので、空白は区間の中点の時刻を持つ。これを語の終わりにすると、
      // そこから次の語の頭(区間の終わり)まで、進む px がゼロの区間が
      // できる。buildMonotoneTangents は進みがゼロの区間を見つけると
      // その両端の接線を 0 にするので、塗りが文字ごとに完全に止まる。
      // 実測では行の時間の 24〜29% が停止だった(滑らかな曲は 0%)。
      if (isFormattingSpace[i]) continue;
      if (flat[i].t !== null) { end = flat[i].t; break; }
    }
    const start = unit.times.find(t => t !== null) ?? null;
    if (end === null) end = Number.isFinite(lineEndSec) ? lineEndSec : null;
    unit.start = start;
    unit.end = (end !== null && start !== null && end > start)
      ? end
      : (start === null ? null : start + WORD_DEFAULT_SEC);
  }

  return units;
};

// ── 行ぜんたいの「時刻 → 進んだ px」表を作る ────────────────
// 語の横位置(offsetLeft)は変形の影響を受けない素の値。語の中の文字境界は
// Range で測る。こちらは変形が乗るが、使うのは語の中での比だけなので影響しない。
// 折り返した行では、2行目以降の語を1行目の右へ continue させた座標に直す
// (読む順に一本の帯として扱うため)。
const measureLyricLineSweep = (row) => {
  // PIP は別ウィンドウ・別文書。Range も getComputedStyle も
  // その文書のものを使わないと、取れる値が別の窓のものになる。
  const doc = row.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const view = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const spans = row._ytmWordSpans;
  if (!doc) {
    row._sweepReady = true;
    return;
  }
  if (!Array.isArray(spans) || !spans.length) {
    row._sweepReady = true;
    return;
  }
  // 歌詞パネルを開く前など、まだ場所を持っていない時に測ると
  // 全部 0 になる。済んだ印を付けずに帰って、あとで測り直させる。
  if (!row.offsetWidth && !row.offsetHeight) return;
  row._sweepReady = true;

  try {
    // 1. 語を表示上の行ごとにまとめ、行の幅を出す
    const rowsByTop = new Map();
    for (const span of spans) {
      const top = span.offsetTop;
      let bucket = rowsByTop.get(top);
      if (!bucket) rowsByTop.set(top, (bucket = { right: 0 }));
      bucket.right = Math.max(bucket.right, span.offsetLeft + span.offsetWidth);
    }
    const tops = Array.from(rowsByTop.keys()).sort((a, b) => a - b);
    let carry = 0;
    for (const top of tops) {
      rowsByTop.get(top).origin = carry;
      carry += rowsByTop.get(top).right;
    }

    // 2. 語の開始位置を CSS 変数として渡し、文字ごとの位置表を作る
    const times = [];
    const xs = [];
    const range = doc.createRange();

    for (const span of spans) {
      const origin = rowsByTop.get(span.offsetTop)?.origin || 0;
      const wordX = origin + span.offsetLeft;
      const width = span.offsetWidth;
      span._wx = wordX;
      span.style.setProperty('--wx', String(wordX));

      const node = span.firstChild;
      const offsets = span._offsets;
      let fractions = null;
      if (node && node.nodeType === 3 && Array.isArray(offsets) && offsets.length > 1) {
        const len = node.data.length;
        const raw = [];
        for (const offset of offsets) {
          range.setStart(node, 0);
          range.setEnd(node, Math.min(offset, len));
          raw.push(range.getBoundingClientRect().width);
        }
        const last = (() => {
          range.setStart(node, 0);
          range.setEnd(node, len);
          return range.getBoundingClientRect().width;
        })();
        if (last > 0) fractions = raw.map(w => w / last);
      }

      span._times.forEach((t, i) => {
        if (t === null) return;
        const frac = fractions ? (fractions[i] ?? (i / span._times.length)) : (i / span._times.length);
        times.push(t);
        xs.push(wordX + width * frac);
      });

      // 語の終わりも節目として入れる。入れないと最後の文字が
      // 語の右端まで塗り切るタイミングを表せない。
      if (Number.isFinite(span._end)) {
        times.push(span._end);
        xs.push(wordX + width);
      }
    }

    // 3. 時刻で並べ、単調にする(同時刻の重複はあとの方を残す)
    const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b] || xs[a] - xs[b]);
    const st = [];
    const sx = [];
    for (const i of order) {
      if (st.length && times[i] <= st[st.length - 1]) {
        sx[sx.length - 1] = Math.max(sx[sx.length - 1], xs[i]);
        continue;
      }
      st.push(times[i]);
      sx.push(Math.max(xs[i], sx.length ? sx[sx.length - 1] : 0));
    }
    row._sweepT = st;
    row._sweepX = sx;
    row._sweepM = buildMonotoneTangents(st, sx);
    row._sweepEnd = carry;
    row._sweepIndex = 0;

    // 4. ぼかし半幅は文字サイズ基準の px。行に一度だけ置く。
    const fontPx = (view ? parseFloat(view.getComputedStyle(row).fontSize) : NaN) || 32;
    row.style.setProperty('--feather', (WORD_FEATHER_EM * fontPx).toFixed(1));

    // 5. 語ごとの強調の強さ。長さで決まるので毎フレーム計算しない。
    for (const span of spans) {
      const dur = (Number.isFinite(span._end) && Number.isFinite(span._start) && span._end > span._start)
        ? span._end - span._start
        : WORD_DEFAULT_SEC;
      const scaleAmount = emphasisScaleAmount(dur);
      const glowAmount = emphasisGlowAmount(dur);
      // ここが小さい語は、膨らみも光も目に見えない。前倒しの窓を
      // 広げて毎フレーム --wg を書くだけ無駄になるので外す。
      // この閾値だと 0.4 秒より短い語は素通しになる。
      span._emp = scaleAmount > 0.05 || glowAmount > 0.05;
      span._empStart = span._start - WORD_EMPHASIS_PREROLL_SEC;
      span._empDur = Math.max(WORD_LIFT_MIN_SEC, dur) * WORD_EMPHASIS_STRETCH;
      span._amp = scaleAmount;
      // 光は持ち上がりと分ける。持ち上がりは合成側のキーフレームなので
      // 毎フレームの費用が無いが、光は --wg をメインスレッドから毎フレーム
      // 書き、text-shadow を描き直させる。軽量モードで落とすのはこちらだけ。
      // typeof で見ているのは、この関数がテストで単体切り出しされ、
      // 外側の config が存在しない文脈で実行されることがあるため。
      // ここで例外を出すと上の try/catch に落ちて塗りの表ごと消える。
      span._glow = span._emp &&
        !(typeof config !== 'undefined' && config && config.lowCpuMode);
      if (span._glow) {
        span.style.setProperty('--wglowa', glowAmount.toFixed(3));
        // 光の半径は語ごとに固定。半径を毎フレーム変えると、そのたびに
        // 字の影を描き直すことになって重い。動かすのは濃さだけ。
        span.style.setProperty('--wglowr', Math.min(0.3, glowAmount * 0.3).toFixed(3));
      }
    }
  } catch (e) {
    row._sweepT = null;
    row._sweepX = null;
  }
};

// ── 塗りの先端をなめらかに動かす ──────────────────────────
// 節目(文字の開始時刻とその横位置)の間を直線で結ぶと、節目ごとに
// 速度が段で変わる。文字は幅がまちまちなのに時間はほぼ等分なので、
// 細い字は速く、太い字は遅く進む。これが「カクカク」の見え方になる。
//
// 節目は必ず通しつつ、間を3次で結んで速度を連続にする。
// 接線は Fritsch-Carlson の重み付き調和平均で、単調性が壊れない
// (行き過ぎて戻る、が起きない)ものを選ぶ。
const buildMonotoneTangents = (ts, xs) => {
  const n = ts.length;
  const m = new Array(n).fill(0);
  if (n < 2) return m;

  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = ts[i + 1] - ts[i];
    d[i] = h[i] > 0 ? (xs[i + 1] - xs[i]) / h[i] : 0;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0)) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return m;
};

// 時刻 → 行の先頭から進んだ px
const lyricSweepAt = (row, t) => {
  const st = row._sweepT;
  const sx = row._sweepX;
  if (!st || st.length === 0) return 0;
  if (t <= st[0]) return 0;
  if (t >= st[st.length - 1]) return row._sweepEnd || sx[sx.length - 1];

  // 再生は基本前進する。前フレームの位置から続け、巻き戻った時だけ探し直す。
  let i = row._sweepIndex || 0;
  if (i >= st.length - 1) i = st.length - 2;
  if (t < st[i]) i = 0;
  while (i + 1 < st.length - 1 && t >= st[i + 1]) i++;
  row._sweepIndex = i;

  const t0 = st[i];
  const t1 = st[i + 1];
  const x0 = sx[i];
  const x1 = sx[i + 1];
  if (!(t1 > t0)) return x1;

  const h = t1 - t0;
  const u = (t - t0) / h;
  const sm = row._sweepM;
  if (!sm) return x0 + (x1 - x0) * u;

  // Hermite。節目では必ず x0 / x1 を通るので、声とのずれは増えない。
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * x0
    + (u3 - 2 * u2 + u) * h * sm[i]
    + (-2 * u3 + 3 * u2) * x1
    + (u3 - u2) * h * sm[i + 1];
};

// ── 文字の動き(持ち上がり・膨らみ) ────────────────────────
// 動きだけは毎フレーム JS で transform を書いてはいけない。
// Chrome はテキストの縦位置を整数ピクセルに丸める(横は小数対応、縦は非対応)。
// 持ち上がりは 0.05em = 32px なら 1.6px しかないので、丸められると
// 1〜2回のジャンプになる。これがカクカクの正体だった。
//
// キーフレームを先に作って Web Animations に渡すと、合成側で小数のまま
// 動かしてくれる。文字は一度だけ描かれ、あとは GPU が変形するだけになる。
// 時計合わせは行ごとに1回。ずれた時(シーク・一時停止)だけ直す。
//
// 塗り(--sweep)と光(--wg)は位置を動かさないので丸めの問題が無く、
// 毎フレーム書いたままで良い。合成できないプロパティなので、
// 同じアニメーションに混ぜると transform まで合成から外れてしまう。

// キーフレームの粗さ。間はブラウザが直線で埋めるので、
// 40ms も刻めば 0.05em の移動では差が見えない。
const MOTION_FRAME_MS = 40;
const MOTION_MIN_FRAMES = 8;
const MOTION_MAX_FRAMES = 40;

const MOTION_RESYNC_SEC = 0.08;

// 動きを持っている行。一時停止の時にまとめて止めるために覚えておく。
const _lyricMotionRows = new Set();

// 動くのは伸ばした音だけ。ふくらんで、元の高さと大きさへ戻る。
const buildLyricWordKeyframes = (span, origin) => {
  const from = span._empStart;
  const dur = span._empDur;
  if (!Number.isFinite(from) || !(dur > 0)) return null;

  const amp = span._amp || 0;
  const count = Math.max(
    MOTION_MIN_FRAMES,
    Math.min(MOTION_MAX_FRAMES, Math.round((dur * 1000) / MOTION_FRAME_MS)),
  );

  const frames = [];
  for (let i = 0; i <= count; i++) {
    const env = bellCurve(i / count);
    frames.push({
      offset: i / count,
      transform: `translateY(${(-WORD_LIFT_EM * env).toFixed(4)}em)`
        + ` scale(${(1 + env * amp * 0.085).toFixed(4)})`,
    });
  }

  return { frames, delay: (from - origin) * 1000, duration: dur * 1000 };
};

// 塗りの先端もキーフレームで渡す。節目(文字ごとの時刻と横位置)を
// そのままキーフレームにして、区間ごとに緩急を付ける。
// 3次エルミートは3次ベジェとまったく同じ形に書き直せるので、
// 前に入れた滑らかな曲線を1つも崩さずにブラウザへ渡せる。
// 節目の数だけで済むので、細かく刻んでキーフレームを量産しなくてよい。
const buildLyricSweepKeyframes = (row) => {
  const ts = row._sweepT;
  const xs = row._sweepX;
  const ms = row._sweepM;
  if (!ts || ts.length < 2) return null;

  const from = ts[0];
  const total = ts[ts.length - 1] - from;
  if (!(total > 0)) return null;

  const frames = [];
  for (let i = 0; i < ts.length; i++) {
    const offset = (ts[i] - from) / total;
    if (frames.length && offset <= frames[frames.length - 1].offset) continue;
    const frame = { offset: Math.min(1, Math.max(0, offset)), '--sweep': xs[i].toFixed(2) };

    if (i < ts.length - 1 && ms) {
      const h = ts[i + 1] - ts[i];
      const dx = xs[i + 1] - xs[i];
      if (h > 0 && dx > 0) {
        // エルミート → ベジェ。制御点の x は 1/3, 2/3 で固定になる。
        const y1 = Math.min(1, Math.max(0, (ms[i] * h) / (3 * dx)));
        const y2 = Math.min(1, Math.max(0, 1 - (ms[i + 1] * h) / (3 * dx)));
        frame.easing = `cubic-bezier(0.3333, ${y1.toFixed(4)}, 0.6667, ${y2.toFixed(4)})`;
      } else {
        frame.easing = 'linear';
      }
    }
    frames.push(frame);
  }

  if (frames.length < 2) return null;
  frames[0].offset = 0;
  frames[frames.length - 1].offset = 1;
  return { frames, from, duration: total * 1000 };
};

const createLyricWordMotion = (row) => {
  row._motionReady = true;
  const spans = row._ytmWordSpans;
  if (!spans || !spans.length) return;
  if (typeof spans[0].animate !== 'function') return;   // 使えない環境では動かさない

  const origin = spans.map(sp => sp._start).find(v => Number.isFinite(v));
  if (!Number.isFinite(origin)) return;
  row._motionOrigin = origin;

  const animations = [];

  // 塗り。行に1本だけ。
  const sweep = buildLyricSweepKeyframes(row);
  if (sweep && typeof row.animate === 'function') {
    try {
      const animation = row.animate(sweep.frames, {
        duration: sweep.duration,
        delay: (sweep.from - origin) * 1000,
        fill: 'both',
        easing: 'linear',   // 緩急はキーフレームごとに付けてある
      });
      animation.pause();
      animations.push(animation);
      row._sweepAnimated = true;
    } catch (e) {
      row._sweepAnimated = false;
    }
  }

  for (const span of spans) {
    // 速い語はまったく動かさない。動かすとその語だけ高さがずれて、
    // 語と語の間に段差ができる。
    if (!span._emp || !Number.isFinite(span._start)) continue;
    const built = buildLyricWordKeyframes(span, origin);
    if (!built) continue;
    const { frames, delay, duration } = built;
    try {
      const animation = span.animate(frames, {
        duration,
        delay,
        fill: 'both',
        easing: 'linear',   // 形はキーフレームに焼いてある
      });
      animation.pause();
      animations.push(animation);
    } catch (e) { /* 作れなくても塗りは動く */ }
  }
  row._motions = animations;
  if (animations.length) _lyricMotionRows.add(row);
};

const syncLyricWordMotion = (row, t, rate) => {
  const motions = row._motions;
  if (!motions || !motions.length) return;
  const local = (t - row._motionOrigin) * 1000;
  const now = performance.now();

  // 合わせ直しの要否は、アニメーション側の currentTime ではなく
  // 自前の記録で判断する。語ごとに長さが違うので、終わったものは
  // それぞれ別の時刻で止まってしまい、比較の相手にならない。
  //
  // 前回合わせた時から実時間ぶん進んだはずの位置と、曲の位置がずれて
  // いたら、シークか一時停止があったということ。
  if (row._motionSyncedAt !== undefined) {
    const predicted = row._motionSyncedLocal + (now - row._motionSyncedAt) * rate;
    if (Math.abs(predicted - local) <= MOTION_RESYNC_SEC * 1000) return;
  }

  for (const animation of motions) {
    try {
      animation.currentTime = local;
      if (animation.playbackRate !== rate) animation.playbackRate = rate;
      animation.play();
    } catch (e) { /* 破棄済み */ }
  }
  row._motionSyncedLocal = local;
  row._motionSyncedAt = now;
};

const stopLyricWordMotion = (row) => {
  const motions = row._motions;
  if (!motions) return;
  row._motionSyncedAt = undefined;
  for (const animation of motions) {
    try { animation.pause(); animation.currentTime = 0; } catch (e) { /* 破棄済み */ }
  }
};

// 一時停止でループが止まる時。走らせたままだと歌詞だけ動き続ける。
const pauseAllLyricWordMotion = () => {
  for (const row of _lyricMotionRows) {
    const motions = row._motions;
    if (!motions) continue;
    // 次に描く時、実時間とのずれで合わせ直される
    row._motionSyncedAt = undefined;
    for (const animation of motions) {
      try { if (animation.playState === 'running') animation.pause(); } catch (e) { /* 破棄済み */ }
    }
  }
};

const writeLyricVar = (el, key, cacheKey, value, step) => {
  const q = Math.round(value * step) / step;
  if (el[cacheKey] === q) return;
  el[cacheKey] = q;
  el.style.setProperty(key, String(q));
};

// PIP へは innerHTML で複製するので、span に持たせた JS のプロパティは
// 消える。data 属性に書いておいた時刻から組み直す。
const rehydrateLyricWordRow = (row) => {
  row._ytmRehydrated = true;
  const spans = Array.from(row.querySelectorAll('.lyric-word'));
  if (!spans.length) return null;

  for (const span of spans) {
    const times = String(span.dataset.wt || '')
      .split(',')
      .map(v => (v === '' ? null : Number(v)))
      .map(v => (v !== null && Number.isFinite(v) ? v : null));
    const glyphs = Array.from(span.textContent || '');
    const offsets = [];
    let at = 0;
    for (const g of glyphs) {
      offsets.push(at);
      at += g.length;
    }
    span._times = times.length ? times : [null];
    span._offsets = offsets;
    span._start = times.find(v => v !== null) ?? null;
    const end = Number(span.dataset.we);
    span._end = Number.isFinite(end) ? end : null;
    span._emp = false;
  }

  row._ytmWordSpans = spans;
  return spans;
};

const paintLyricWordRow = (row, t, rate = 1) => {
  let spans = row._ytmWordSpans;
  if (!spans && !row._ytmRehydrated) spans = rehydrateLyricWordRow(row);
  if (!spans || !spans.length) return;
  if (!row._sweepReady) measureLyricLineSweep(row);

  // 持ち上がりと膨らみは合成側に任せる。ここで transform を毎フレーム
  // 書くと、縦位置が整数ピクセルに丸められて 1〜2 回のジャンプになる。
  if (!row._motionReady) createLyricWordMotion(row);
  syncLyricWordMotion(row, t, rate);

  // 塗りもキーフレームで渡してある。渡せなかった時だけ自分で書く。
  if (!row._sweepAnimated) {
    writeLyricVar(row, '--sweep', '_sweep', lyricSweepAt(row, t), SWEEP_STEP);
  }

  // 光は位置を動かさないので丸めの問題が無い。合成できないプロパティ
  // なので、動きと同じアニメーションに混ぜると transform まで
  // 合成から外れてしまう。こちらは毎フレーム書く。
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span._glow || !Number.isFinite(span._start)) continue;
    const env = bellCurve((t - span._empStart) / span._empDur);
    writeLyricVar(span, '--wg', '_wg', env, WORD_STEP);
  }
};

// 計測は offsetLeft などを読むので、その場でレイアウトを1回確定させる。
// 行が主役になった瞬間にやると、ちょうど自動スクロールが走り出す所と
// 重なって一瞬つっかえる。描画が済んだ直後に、少しずつ先に済ませておく。
const prefetchLyricLineSweeps = (rows) => {
  const pending = rows.filter(r => r && !r._sweepReady);
  if (!pending.length) return;
  let index = 0;
  const step = () => {
    // 1フレームに詰め込みすぎると、そのフレームだけ伸びる
    const end = Math.min(index + 8, pending.length);
    for (; index < end; index++) {
      const row = pending[index];
      if (!row.isConnected || !row.offsetWidth) continue;
      // 複製されてきた行は語の情報を持っていないので、まず組み直す
      if (!row._ytmWordSpans && !row._ytmRehydrated) rehydrateLyricWordRow(row);
      if (!row._ytmWordSpans) continue;
      measureLyricLineSweep(row);
    }
    if (index < pending.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// 窓の幅や UI サイズが変わると語の横位置が動く。測り直さないと
// 塗りの位置が字とずれたままになる。
const invalidateLyricLineSweeps = () => {
  for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
    if (!container) continue;
    container.querySelectorAll('.lyric-line.ytm-word-sync')
      .forEach(row => { row._sweepReady = false; });
  }
};

const resetLyricWordRow = (row) => {
  const spans = row._ytmWordSpans;
  if (!spans || !spans.length) return;
  stopLyricWordMotion(row);
  if (!row._sweepAnimated) writeLyricVar(row, '--sweep', '_sweep', 0, SWEEP_STEP);
  row._sweepIndex = 0;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i]._emp) writeLyricVar(spans[i], '--wg', '_wg', 0, WORD_STEP);
  }
};

// ── 従来式(1文字ずつ点灯)の表示 ──────────────────────────
// Apple Music 風を切った時と、低負荷モードの時に使う。
// 次の文字が無い(行末)ときに1文字へ割り当てる長さ
const CHAR_DEFAULT_SPAN_SEC = 0.35;

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

// ── 行の終わり時刻を持たないデータの補完 ──────────────────
// 終わり時刻が無い時、これまでは一律「最後の文字 + 0.2 秒」を行の終わりに
// していた。伸ばして歌っている最後の音が0.2秒で塗り終わってしまい、
// 間奏に入る行ほど不自然に見える。かといって次の行頭まで伸ばすと、
// 間奏の長さぶん塗り続けることになる。行と行の間の空きは無音であって、
// そのぶん歌が伸びているわけではない。
//
// その行自身の文字の進み方から1文字ぶんの長さを見積もり、
// 次の行に食い込まない範囲に収める。
const DYNAMIC_TAIL_MIN_MS = 200;
const DYNAMIC_TAIL_MAX_MS = 900;
const DYNAMIC_TAIL_GUARD_MS = 50;

// 正規化は行をその場で書き換えるので、必ず複製に対して行う。
const deepCopyDynamicLines = (lines) => {
  if (!Array.isArray(lines)) return lines;
  try {
    return structuredClone(lines);
  } catch (e) {
    try { return JSON.parse(JSON.stringify(lines)); } catch (e2) { return lines; }
  }
};

const dynamicLineCharTimes = (line) => (
  (Array.isArray(line?.chars) ? line.chars : [])
    .map(char => (typeof char?.t === 'number' && Number.isFinite(char.t) ? char.t : null))
    .filter(t => t !== null)
    .sort((a, b) => a - b)
);

const fillDynamicLineEnds = (lines) => {
  if (!Array.isArray(lines)) return lines;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== 'object') continue;
    // もともと終わりを持っているデータには触らない
    const declared = [line.endTimeMs, line.end_ms, line.endMs, line.endTime]
      .map(v => Number(v))
      .find(v => Number.isFinite(v));
    if (Number.isFinite(declared)) continue;

    const times = dynamicLineCharTimes(line);
    if (times.length < 2) continue;
    const last = times[times.length - 1];

    const gaps = [];
    for (let k = 1; k < times.length; k++) {
      if (times[k] > times[k - 1]) gaps.push(times[k] - times[k - 1]);
    }
    if (!gaps.length) continue;
    gaps.sort((a, b) => a - b);
    // 中央値なので、行の中に伸ばした音が1つあっても引きずられない
    const typical = gaps[Math.floor(gaps.length / 2)];

    let tail = Math.min(DYNAMIC_TAIL_MAX_MS, Math.max(DYNAMIC_TAIL_MIN_MS, typical));

    const nextTimes = dynamicLineCharTimes(lines[i + 1]);
    const nextStart = nextTimes.length ? nextTimes[0] : null;
    if (typeof nextStart === 'number') {
      // 隙間より下限を優先すると次の行に食い込む。空きが無い行は触らない。
      const room = nextStart - last - DYNAMIC_TAIL_GUARD_MS;
      if (room <= 0) continue;
      tail = Math.min(tail, room);
    }

    line.endTimeMs = last + tail;
    // getDynamicLineEndSec がキャッシュしているので落としておく
    if (typeof line.__ytmEndSec === 'number') delete line.__ytmEndSec;
  }

  return lines;
};

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
      // 歌手メタデータはsrv3とは別APIから遅れて到着する。以前はその時点で
      // canonical LRCへ描画を切り替えていたため、Animated TimedTextが一瞬だけ
      // 表示されて通常歌詞へ戻っていた。自由配置のsrv3を表示ソースとして維持し、
      // 行メタデータだけをplainLinesへ対応付ける。
      lyricsData = applySingerMetadataToLines(
        timedTextData.plainLines || [],
        currentSingerMetadata,
        {
          canonicalLines: canonicalSingerLines,
          sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === rawLyrics.trim(),
        }
      );
      timedTextData.plainLines = lyricsData;
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
  // 歌手メタデータの照合はパース直後の行番号を前提にしているので、
  // 見出し行を落とす前の並びを別に取っておく。
  const parsedWithHeaders = parsed;
  parsed = stripLeadingHeaderLines(parsed, String(keyAtStart || '').split('///')[0]);
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
    : parsedWithHeaders;
  finalLines = applySingerMetadataToLines(finalLines, currentSingerMetadata, {
    canonicalLines,
    sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === rawLyrics.trim(),
  });
  finalLines = collapseCrossSideDuplicateLyrics(finalLines);

  // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
  //
  // 正規化は行オブジェクトをその場で書き換える。生データのまま持っておかないと、
  // あとから届いたレスポンスと JSON.stringify で比べた時に必ず不一致になり、
  // 同じ歌詞でも毎回 renderLyrics が走ってスクロール位置が飛ぶ。
  // キャッシュに入る中身も「正規化前/後」のどちらか不定になっていた。
  try {
    if (Array.isArray(dynamicLines) && dynamicLines.length) {
      dynamicLinesRaw = dynamicLines;
      dynamicLines = fillDynamicLineEnds(normalizeDynamicLinesToCharLevel(deepCopyDynamicLines(dynamicLines)));
    } else {
      dynamicLinesRaw = dynamicLines;
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

// 取得元をまたいだ候補の合流。「足す」だけで、今出ている候補や
// 選択状態には触らない。追加できた件数を返す。
const mergeLyricsCandidates = (incoming) => {
  if (!Array.isArray(incoming) || !incoming.length) return 0;
  const merged = Array.isArray(lyricsCandidates) ? lyricsCandidates.slice() : [];
  const knownIds = new Set(merged.map((cand, idx) => getCandidateId(cand, idx)));
  let added = 0;
  incoming.forEach(cand => {
    const id = cand && cand.id ? String(cand.id) : '';
    if (!id || knownIds.has(id)) return;
    knownIds.add(id);
    merged.push(cand);
    added += 1;
  });
  if (added) lyricsCandidates = merged;
  return added;
};

// YouTube Music は background を通らない(Service Worker の fetch は
// Origin: chrome-extension:// が付いて 403 で弾かれるため、content script が
// 直接叩いている)。そのぶん background が組む候補一覧にも入らないので、
// ここで他の取得元と同じ形に均して合流させる。
// これが無いと、取得だけして捨てているのにメニューには出てこない、という
// 状態になる(LRCHub優先では結果を見てすらいなかった)。
const YTM_CANDIDATE_ID = 'provider_ytm';

const buildYtmCandidate = (res) => {
  const lyrics = typeof res?.lyrics === 'string' ? res.lyrics.trim() : '';
  if (!lyrics) return null;
  // background の buildProviderCandidate と同じ形に揃える。
  // record_id は持たない = LRCHub のレコードではないので、選んでも
  // 追加取得も「この候補を選んだ」報告も走らない。
  return {
    id: YTM_CANDIDATE_ID,
    label: LYRICS_SOURCE_LABELS.ytm,
    providerCandidate: true,
    lyricsSource: 'ytm',
    lyrics,
    dynamicLines: null,
    animated_lyrics: null,
    record_id: null,
    lyricsComplete: true,
    has_synced: !!res.hasSynced,
    offset_ms: 0,
  };
};

// 時刻なしで出したあとから同期版が見つかることがある(別リリース探索)。
// 同じものを2つ並べず、同期版で置き換える。
const offerYtmCandidate = (res) => {
  const cand = buildYtmCandidate(res);
  if (!cand) return false;
  const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
  const at = list.findIndex((c, i) => getCandidateId(c, i) === YTM_CANDIDATE_ID);
  if (at < 0) return mergeLyricsCandidates([cand]) > 0;
  if (!cand.has_synced || list[at].has_synced) return false;
  const next = list.slice();
  next[at] = cand;
  lyricsCandidates = next;
  return true;
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

// 候補が持っている同期の粒度。selectLyricsPayload と違って表示設定には
// 依らせない。見せたいのは「この候補が何を持っているか」なので。
// 中身がまだ読み込まれていない候補(LRCHub の検索結果など)は null を返す。
const describeCandidateSync = (cand) => {
  if (!cand || typeof cand !== 'object') return null;
  const animated = cand.animated_lyrics || cand.timedtext || cand.timed_text;
  if (typeof animated === 'string' && animated.trim()) return '字幕同期';
  if (hasCharacterSyncedLines(cand.dynamicLines)) return '単語同期';
  const lyrics = typeof cand.lyrics === 'string' ? cand.lyrics : '';
  if (lyrics.trim()) {
    return /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? '行同期' : '時刻なし';
  }
  // 歌詞本体をまだ持っていない候補。has_synced だけは分かることがある
  if (cand.lyricsComplete !== true) {
    return cand.has_synced === true ? '行同期以上' : null;
  }
  return null;
};

const buildCandidateLabel = (cand, idx = 0) => {
  if (!cand || typeof cand !== 'object') return `候補${idx + 1}`;

  // 取得元をまたいだ候補は表示名をそのまま使う。
  // 下のファイル名処理はパス区切りで切り詰めるので通せない。
  if (typeof cand.label === 'string' && cand.label.trim()) return cand.label.trim();

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
  const canonicalLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : [];

  // Animated captions own their free-positioned stage. Singer metadata arrives
  // asynchronously, so update only the semantic line mapping and leave that
  // stage intact; renderLyrics() would remove ytm-animated-caption-mode.
  if (
    animatedCaptionData &&
    document.body.classList.contains('ytm-animated-caption-mode')
  ) {
    const animatedLines = Array.isArray(animatedCaptionData.plainLines)
      ? animatedCaptionData.plainLines
      : (Array.isArray(lyricsData) ? lyricsData : []);
    lyricsData = applySingerMetadataToLines(animatedLines, currentSingerMetadata, {
      canonicalLines,
      sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === renderedLyrics.trim(),
    });
    animatedCaptionData.plainLines = lyricsData;
    return;
  }

  if (!Array.isArray(lyricsData) || !lyricsData.length) return;
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
      return toLocalPlaybackTime(v.currentTime);
    }
  } catch (e) { }
  return null;
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
      const localTime = toLocalPlaybackTime(v.currentTime);
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

// ── 他の取得元をその場で探す ──────────────────────────────
// 通常の取得は LRCHub が答えた時点で他へ問い合わせずに切り上げる。
// おかげで無駄な通信は無いが、その歌詞が曲に合っていなかった時に
// 乗り換え先が1件も無い状態になる。ここはユーザーが明示的に頼んだ時
// だけ走る道で、自動では絶対に呼ばない。
let alternateLookupInFlight = false;
async function findAlternateLyricSources() {
  if (alternateLookupInFlight) return;
  const meta = getMetadata();
  if (!meta || !meta.title) {
    showToast('曲の情報が取れませんでした');
    return;
  }

  const requestKey = currentKey;
  const requestVideoId = currentLyricsVideoId || getCurrentVideoId() || '';

  // すでに手元にある取得元は聞き直さない
  const known = new Set(
    (Array.isArray(lyricsCandidates) ? lyricsCandidates : [])
      .filter(cand => cand && cand.providerCandidate)
      .map(cand => String(cand.lyricsSource || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (currentLyricsSource) known.add(currentLyricsSource);

  const videoEl = document.querySelector('video');
  const durationSec = (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0)
    ? Math.round(videoEl.duration)
    : null;

  alternateLookupInFlight = true;
  showToast('他の取得元を探しています...');
  try {
    const res = await safeRuntimeSendMessage({
      type: 'FIND_ALTERNATE_LYRICS',
      payload: {
        track: meta.title,
        artist: meta.artist || '',
        album: meta.album || '',
        duration_sec: durationSec,
        youtube_url: getCurrentVideoUrl(),
        video_id: requestVideoId,
        exclude: [...known],
      },
    });

    // 探している間に曲が変わっていたら、その結果はもう別の曲のもの
    if (
      requestKey !== currentKey ||
      requestVideoId !== (currentLyricsVideoId || getCurrentVideoId() || '')
    ) return;

    const added = mergeLyricsCandidates(res?.candidates);
    if (!added) {
      showToast('他の取得元には歌詞がありませんでした');
      return;
    }

    refreshCandidateMenu();
    showToast(`他の取得元を ${added} 件見つけました`);
    // 押した直後にメニューを閉じているので、結果を見せるために開き直す
    if (ui.uploadMenu) ui.uploadMenu.classList.add('visible');
  } finally {
    alternateLookupInFlight = false;
  }
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
  // 取得元をまたいだ候補を選べるようになったので、ここを 'lrchub' 固定にはできない。
  // 「歌詞ソース」表示とキャッシュに嘘が入る。
  const candidateSource = String(cand.lyricsSource || '').trim().toLowerCase() || 'lrchub';
  updateLyricsSourceState({ lyricsSource: candidateSource, fallbackUsed: false }, false);
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
      // 本人が選んだ取得元であることを残す。これが無いと次に同じ曲を
      // かけた時、キャッシュの優先度が 2 のままになり、裏で走った取得の
      // 結果(同じく 2)に上書きされる。選んだ歌詞が一瞬出てから
      // 差し替わるので、選んだこと自体が無かったことになっていた。
      // 手動アップロード(manualLyrics)と同じ重みで扱う。
      manualChoice: true,
      // 候補一覧も持たせる。次に開いた時、裏の取得が返ってくる前でも
      // メニューから選び直せるようにするため。
      candidates: Array.isArray(lyricsCandidates) ? LyricsCache.stripCandidateLyrics(lyricsCandidates) : null,
      lyricsSource: candidateSource,
      fetchedAt: Date.now(),
      fallbackUsed: false,
      lyricsQuality: selectedPayload.quality,
      offset_ms: Number.isFinite(Number(cand.offset_ms)) ? Number(cand.offset_ms) : 0,
    });
  }
  await applyLyricsText(nextLyricsText);
  // 「この候補を選んだ」の報告はしない。LRCHub 側に匿名で受け取る API が無く
  // (/api/record/lock はログイン必須、他は 404)、送っても届かないため。
  // 以前はここから 10 秒後にキャッシュを消して取り直していたが、報告が
  // 届かない以上、選んだ記録を捨てて最初から引き直すだけの動きだった。
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

  const appendCandidateButton = (cand, idx) => {
    const id = getCandidateId(cand, idx);
    const btn = document.createElement('button');
    btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
    btn.dataset.action = 'candidate';
    btn.dataset.candidateId = id;
    btn.textContent = buildCandidateLabel(cand, idx);
    // 同期の粒度を添える。どれを選べば単語単位で光るのかが、
    // 選ぶ前に分かるようにするため。
    const syncLabel = describeCandidateSync(cand);
    if (syncLabel) {
      const tag = document.createElement('span');
      tag.className = 'ytm-candidate-sync';
      tag.textContent = syncLabel;
      btn.appendChild(tag);
    }
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
  };

  // 取得元をまたいだ候補は別枠。いま画面に出ている取得元そのものは、
  // 同じものを2回並べても選ぶ意味が無いので伏せる。
  const ownCandidates = [];
  const providerCandidates = [];
  lyricsCandidates.forEach((cand, idx) => {
    if (!cand || !cand.providerCandidate) {
      ownCandidates.push({ cand, idx });
      return;
    }
    const id = getCandidateId(cand, idx);
    const isSelected = String(selectedCandidateId || '') === id;
    const source = String(cand.lyricsSource || '').trim().toLowerCase();
    if (!isSelected && source && source === currentLyricsSource) return;
    providerCandidates.push({ cand, idx });
  });

  ownCandidates.forEach(({ cand, idx }) => appendCandidateButton(cand, idx));

  if (providerCandidates.length) {
    if (ownCandidates.length) {
      const subtitle = document.createElement('div');
      subtitle.className = 'ytm-upload-menu-subtitle';
      subtitle.textContent = '他の取得元';
      list.appendChild(subtitle);
    }
    providerCandidates.forEach(({ cand, idx }) => appendCandidateButton(cand, idx));
  }

  if (!ownCandidates.length && !providerCandidates.length) {
    section.style.display = 'none';
  }

  // ボタンを跳ねさせるのは今までどおり「その歌詞自身の候補」がある時だけ。
  // 他の取得元は毎曲ぶら下がるので、ここで光らせると常時鳴るベルになる。
  if (ui.lyricsBtn) {
    ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    if (ownCandidates.length) {
      void ui.lyricsBtn.offsetWidth;
      ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
    }
  }
}

// 「歌詞を確定」ボタンは削除した。LRCHub 側に匿名で受け取る API が無く
// (/api/record/lock はログイン必須)、押しても必ず失敗していたため。
// 確定済みかどうかの状態は「歌詞同期を追加」の可否にだけ使う。
function refreshLockMenu() {
  if (!ui.uploadMenu) return;
  const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
  if (!addSyncBtn) return;
  const lockState = syncLyricsLockState();
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
      <button class="ytm-upload-menu-item" data-action="find-alternates">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></span>
        <span>他の取得元から探す / OtherSources</span>
      </button>
      <div class="ytm-upload-menu-offset">
        <div class="ytm-upload-menu-subtitle">ズレを直す / Timing</div>
        <div class="ytm-offset-row">
          <button class="ytm-offset-btn" data-action="offset-minus" title="歌詞を早める">−</button>
          <span class="ytm-offset-value" data-role="offset-value">0.0s</span>
          <button class="ytm-offset-btn" data-action="offset-plus" title="歌詞を遅らせる">＋</button>
          <button class="ytm-offset-btn ytm-offset-reset" data-action="offset-reset" title="0 に戻す">⟲</button>
        </div>
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
    // ズレ直しはメニューを閉じない。合うまで何度も押すものなので。
    const offsetBtn = ev.target.closest('.ytm-offset-btn');
    if (offsetBtn) {
      ev.stopPropagation();
      const step = offsetBtn.dataset.action === 'offset-minus' ? -LYRIC_OFFSET_STEP_MS
        : offsetBtn.dataset.action === 'offset-plus' ? LYRIC_OFFSET_STEP_MS
          : null;
      const next = step === null ? 0 : (Number(config.syncOffset) || 0) + step;
      applyLyricOffsetMs(next);
      return;
    }

    const target = ev.target.closest('.ytm-upload-menu-item');
    if (!target) return;
    if (target.classList.contains('ytm-upload-menu-item-disabled')) {
      const msg = target.dataset.disabledMessage || 'この操作は現在利用できません';
      showToast(msg);
      return;
    }
    const action = target.dataset.action;
    const candId = target.dataset.candidateId || null;
    toggleMenu(false);
    hideCandidateHoverPreview();
    if (action === 'local') {
      ui.input?.click();
    } else if (action === 'add-sync') {
      const videoUrl = getCurrentVideoUrl();
      const base = 'https://lrchub.coreone.work';
      const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
      window.open(lrchubUrl, '_blank');
    } else if (action === 'find-alternates') {
      void findAlternateLyricSources();
    } else if (action === 'candidate' && candId) {
      selectCandidateById(candId);
    }
  });

  if (!uploadMenuGlobalSetup) {
    uploadMenuGlobalSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.uploadMenu) return;
      if (!ui.uploadMenu.classList.contains('visible')) return;
      if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
      // 取得元バッジは自分で開け閉てする。ここで先に閉じると、直後に
      // バッジ側が開き直して二度と閉じられなくなる。
      if (ev.target?.closest?.('#ytm-lyrics-source-debug')) return;
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
  // 文字サイズが変わると語の横位置も変わる
  invalidateLyricLineSweeps();
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
  const appleSyncStored = await storage.get('ytm_apple_sync_style');
  if (appleSyncStored !== null) config.appleSyncStyle = !!appleSyncStored;
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
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_prefer_song_mode')}</span>
                <input type="checkbox" id="prefer-song-mode-toggle">
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
                <span class="setting-name">${t('settings_apple_sync')}</span>
                <input type="checkbox" id="apple-sync-toggle">
              </label>
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
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_shared_trans')}</span>
                <input type="checkbox" id="shared-trans-toggle">
              </label>
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
  document.getElementById('prefer-song-mode-toggle').checked = !!config.preferSongMode;
  document.getElementById('apple-bg-toggle').checked = !!config.appleBg;
  document.getElementById('low-cpu-toggle').checked = !!config.lowCpuMode;
  document.getElementById('apple-sync-toggle').checked = !!config.appleSyncStyle;
  document.getElementById('animated-caption-toggle').checked = !!config.useAnimatedCaptions;
  document.getElementById('singer-colors-toggle').checked = !!config.useSingerColors;
  document.getElementById('meaning-always-toggle').checked = !!config.alwaysShowMeaning;

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
      savedSourceMode,
      savedAppleSyncStyle,
      savedLowCpuMode
    ] = await Promise.all([
      storage.get('ytm_deepl_key'),
      storage.get('ytm_main_lang'),
      storage.get('ytm_sub_lang'),
      storage.get('ytm_trans_enabled'),
      storage.get('ytm_shared_trans_enabled'),
      storage.get('ytm_ui_lang'),
      storage.get('ytm_animated_captions_enabled'),
      storage.get('ytm_lrclib_fallback'),
      storage.get('ytm_lyric_source_mode'),
      storage.get('ytm_apple_sync_style'),
      storage.get('ytm_low_cpu_mode')
    ]);

    const prevDeepLKey = savedDeepLKey || '';
    const prevMainLang = savedMainLang || 'original';
    const prevSubLang = savedSubLang !== null ? savedSubLang : 'en';
    const prevUseTrans = savedUseTrans !== null ? savedUseTrans : false;
    const prevUseSharedTrans = savedSharedTrans !== null ? savedSharedTrans : false;
    const prevUiLang = savedUiLang || 'ja';
    const prevAnimatedCaptions = savedAnimatedCaptions !== null ? !!savedAnimatedCaptions : false;
    const prevUseLrcLibFallback = savedLrcLibFallback !== null ? !!savedLrcLibFallback : true;
    const prevSourceMode = normalizeSourceMode(savedSourceMode);
    const prevAppleSync = savedAppleSyncStyle !== null ? !!savedAppleSyncStyle : true;
    const prevLowCpu = savedLowCpuMode !== null ? !!savedLowCpuMode : false;

    // 画面から値を取得
    config.deepLKey = document.getElementById('deepl-key-input').value.trim();
    config.useTrans = document.getElementById('trans-toggle').checked;
    config.useSharedTranslateApi = document.getElementById('shared-trans-toggle').checked;
    config.leftAlignInfo = document.getElementById('left-align-toggle').checked;
    config.keepPastLyrics = document.getElementById('keep-past-lyrics-toggle').checked;
    config.preferSongMode = document.getElementById('prefer-song-mode-toggle').checked;
    config.appleBg = document.getElementById('apple-bg-toggle').checked;
    config.lowCpuMode = document.getElementById('low-cpu-toggle').checked;
    config.appleSyncStyle = document.getElementById('apple-sync-toggle').checked;
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
      storage.set('ytm_prefer_song_mode', config.preferSongMode),
      storage.set('ytm_apple_bg', config.appleBg),
      storage.set('ytm_low_cpu_mode', config.lowCpuMode),
      storage.set('ytm_apple_sync_style', config.appleSyncStyle),
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
    applyAppleSyncClass();
    if (PipManager.pipWindow?.document) {
      PipManager.pipWindow.document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
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
    // Apple Music 風と従来式では DOM の作りが違う(語ごとの span か
    // 1文字ずつの span か)。切り替えたら描き直さないと反映されない。
    const wordSyncChanged = prevAppleSync !== config.appleSyncStyle ||
      prevLowCpu !== config.lowCpuMode;
    const lyricsSourceChanged = (
      prevSourceMode !== config.lyricSourceMode ||
      prevUseLrcLibFallback !== config.useLrcLibFallback
    );
    const uiLanguageChanged = prevUiLang !== config.uiLang;
    const meaningAlwaysChanged = prevAlwaysShowMeaning !== config.alwaysShowMeaning;

    ui.settings.classList.remove('active');

    if (animatedCaptionsChanged || lyricsSourceChanged || wordSyncChanged) {
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
  //
  // 以前は storage.clear で全部消していた。説明文は「設定を初期状態に戻す」と
  // しか書いていないのに、再生履歴も歌詞キャッシュもクラウドの復活の呪文も
  // 巻き添えで消えていた。消すのは設定のキーだけにする。
  document.getElementById('clear-all-btn').onclick = async () => {
    if (!confirm('設定を初期状態に戻しますか？\n（再生履歴と保存済みの歌詞は残ります）')) return;
    await Promise.all(SETTINGS_STORAGE_KEYS.map(key => storage.remove(key)));
    location.reload();
  };

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
      <div class="replay-head">
        <h3>Daily Replay</h3>
        <div class="replay-head-right">
          <div class="ytm-lang-group">
            <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
            <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
            <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
          </div>
          <button class="replay-share-btn replay-icon-btn" aria-label="${t('replay_share_image')}" title="${t('replay_share_image')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.5 13.4l7 4.1M15.5 6.5l-7 4.1"/></svg></button>
          <button class="replay-close-btn ytm-unified-close-btn size-40"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

    `);

  document.body.appendChild(ui.replayPanel);

  ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
    ui.replayPanel.classList.remove('active');
  };

  // 共有はフッターの管理用ボタンの列から出して、見出しの隣に置く。
  // いちばん使うものが Restore / Backup / Cloud / リセット に埋もれていた。
  ui.replayPanel.querySelector('.replay-share-btn').onclick = async (ev) => {
    const btn = ev.currentTarget;
    // 押した時点の期間で作る。パネルを開いたまま期間を切り替えられる。
    const range = ui.replayPanel.dataset.range || 'day';
    const stats = await ReplayManager.getStats(range);
    if (!stats.totalPlays) return;
    btn.disabled = true;
    try {
      await ReplayShare.open(stats, range);
    } finally {
      btn.disabled = false;
    }
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
  // InnerTube の検索は ytm-lyrics.js の post に任せる。
  //
  // 以前はここに API キー直書き・hl/gl を 'ja'/'JP' 固定・タイムアウト無しの
  // 別実装を置いていた。同じ InnerTube を二重に実装していたので、
  // 片方だけ直すと食い違う。あちらはページの設定(言語・地域・
  // clientVersion・visitorData)を使い、タイムアウトも持っている。
  if (!window.YTMLyrics || typeof window.YTMLyrics.search !== 'function') {
    console.warn('[Switch] YTMLyrics.search が使えない');
    return [];
  }
  try {
    // params 無し = 曲・動画・アルバムなど全種類を返す
    const data = await window.YTMLyrics.search(q);
    if (!data) return [];

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
        <span>🔄 代替バージョンを検索: ${escapeHtml(meta.title)}</span>
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
  const currentTime = video && Number.isFinite(video.currentTime) ? toLocalPlaybackTime(video.currentTime) : 0;

  items.forEach(item => {
    const row = document.createElement('button');
    row.className = 'ytm-switch-item';
    row.innerHTML = `
        ${item.thumb ? `<img class="ytm-switch-thumb" src="${escapeHtml(item.thumb)}" alt="">` : '<div class="ytm-switch-thumb"></div>'}
        <div class="ytm-switch-info">
          <div class="ytm-switch-title">${escapeHtml(item.title)}</div>
          <div class="ytm-switch-channel">${escapeHtml(item.channel)}</div>
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

function initLayout() {
  // 既に組んだ UI がそのまま画面に居るなら、参照を取り直す必要は無い。
  // この関数は tick から毎回呼ばれるので、下の拾い直し(getElementById を
  // 十数回)が player-bar が動くたびに走っていた。
  // YTM が作り直した時は id で引いた結果が別物になるので、そこで通す。
  if (
    ui.wrapper && ui.wrapper.isConnected &&
    ui.lyrics && ui.lyrics.isConnected &&
    document.getElementById('ytm-custom-wrapper') === ui.wrapper
  ) {
    return;
  }

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
    // ここで refreshMeaningUi() は呼ばない。
    //
    // initLayout は tick から毎回通る(player-bar の属性が動くたび)。
    // 既存の UI を拾い直すだけのこの経路で解説パネルを作り直すと、
    // 開いている間ずっと、ホバー中もスクロール中も中身が innerHTML ごと
    // 組み直される。中身の更新は初回生成時と setLyricsMeaningData に任せる。
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

  // ここまで来たのは、器を新しく組んだ時だけ(既にあるならもっと上で帰っている)。
  // 組み直した直後の器は空なので、いま出していた歌詞をそのまま出し直す。
  // これが無いと、YTM 側の作り直しに巻き込まれて器ごと入れ替わった時、
  // 曲は鳴っているのに次の曲まで歌詞が出ないままになる。
  // applyLyricsText を通すのは、srv3(アニメーション字幕)とふつうの歌詞で
  // 組み方が違うため。あちらが今の設定に合わせて出し分ける。
  if (typeof lastRawLyricsText === 'string' && lastRawLyricsText.trim()) {
    void applyLyricsText(lastRawLyricsText);
  }
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
  const appleSyncStored = await storage.get('ytm_apple_sync_style');
  if (appleSyncStored !== null && appleSyncStored !== undefined) config.appleSyncStyle = !!appleSyncStored;
  applyAppleSyncClass();
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
  dynamicLinesRaw = null;
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
      // 「新ソースのみ」は取得元を確かめるためのモード。前に別の取得元で
      // 拾ってキャッシュした歌詞をそのまま出すと、画面に何が出ているのか
      // 分からなくなるので、そのキャッシュは使わずに引き直す。
      if (cacheMatchesVideo) {
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
        // 本人の決定(手動アップロード / 候補の選択)は最優先で据え置く。
        // 裏で走った取得に上書きさせない。
        const cachedIsUserChoice = !!(cached.manualLyrics || cached.manualChoice);
        if (cached.manualChoice && cached.candidateId) {
          // 選択中の印をメニューに戻し、遅れて届く差し替えも止める
          selectedCandidateId = String(cached.candidateId);
        }
        currentLyricsResultPriority = cachedIsUserChoice ? 3 : 2;
        dataPriority = currentLyricsResultPriority;
        currentLyricsQuality = cachedSelection.quality;
        dataQuality = cachedSelection.quality;
        updateLyricsSourceState({ ...cached, fallbackUsed: false }, !!data);
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
    const track = normalizeSearchTrackTitle(meta.title);
    const artist = meta.artist;
    const youtube_url = getCurrentVideoUrl();
    const video_id = requestVideoId;
    const translate_to = getRequestedLrchubTranslateLangs();
    // LyricsPlus はアルバム名と尺で候補を絞る。無ければ無いで動くが、
    // 同名異曲・別リリースを掴む確率がはっきり下がる。
    const videoEl = document.querySelector('video');
    const durationSec = (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0)
      ? Math.round(videoEl.duration)
      : null;
    const payload = {
      track,
      artist,
      album: (meta && meta.album) || '',
      duration_sec: durationSec,
      youtube_url,
      video_id,
      use_lrclib: config.useLrcLibFallback,
      lyric_source_mode: config.lyricSourceMode || 'ytm',
      request_id: requestId,
      track_key: thisKey,
    };
    if (translate_to.length) payload.translate_to = translate_to;

    // YouTube Music の行同期歌詞は content script からしか取れない
    // (Service Worker の fetch は Origin: chrome-extension:// が付いて YouTube に 403 で弾かれる)。
    // background への問い合わせと並列に走らせるので、待ち時間は増えない。
    // 優先設定に関わらず必ず走らせる。LRCHub優先でも、乗り換え先として
    // 候補メニューに並べるため。

    // 取ってきた歌詞を候補メニューへ流す。
    // background が組む候補一覧には YTM が入らない(あちらからは叩けない)ので、
    // ここで合流させないとメニューに出てこない。表示に使うかどうかとは
    // 無関係に、届いたら必ず並べる。
    // LRCHub優先では下の分岐(preferYtm || !backgroundHasLyrics)が結果を
    // 見てすらいなかったため、取得だけして捨てている状態になっていた。
    const noteYtmCandidate = (res) => {
      if (!res) return;
      // 待っている間に曲が変わっていたら、それは別の曲の歌詞
      if (thisKey !== currentKey || video_id !== (currentLyricsVideoId || '')) return;
      if (offerYtmCandidate(res)) refreshCandidateMenu();
    };

    const ytmPromise = (window.YTMLyrics && video_id)
      ? window.YTMLyrics.fetch(video_id, {
        // YTM が時刻なしの歌詞しか持っていない曲では、別リリースに同期版が
        // あることがある。その探索は数秒かかるので待たずに先へ進み、
        // 見つかった時だけここで差し替える。
        onUpgrade: (upgraded) => {
          if (!upgraded || !upgraded.hasSynced) return;
          // 候補の方も同期版に差し替える(時刻なしのまま残さない)
          noteYtmCandidate(upgraded);
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

    void ytmPromise
      .then(noteYtmCandidate)
      .catch(() => { /* 候補に出せないだけ。表示には影響しない */ });

    // 上限で打ち切った YTM を、届いた時に差し替える予約。
    // 曲が変わっていたら捨てる。差し替えてよいかの判断は
    // applyLateLyricsUpgrade 側(品質・手動選択・同一曲の確認)に任せる。
    const scheduleYtmLateUpgrade = () => {
      const lateKey = thisKey;
      const lateVideoId = video_id;
      const lateRequestId = requestId;
      void ytmPromise.then(late => {
        if (!late || !late.hasSynced || !late.lyrics) return;
        if (lateKey !== currentKey || lateVideoId !== (currentLyricsVideoId || '')) return;
        if (lateRequestId !== activeLyricsRequestId) return;
        YTMLog.log('[CS] YouTube Music が遅れて届いたので差し替えを試みる');
        return applyLateLyricsUpgrade({
          success: true,
          lyricsSource: 'ytm',
          lyrics: late.lyrics,
          animated_lyrics: null,
          dynamicLines: null,
          track_key: lateKey,
          request_id: lateRequestId,
          video_id: lateVideoId,
        });
      }).catch(() => { /* 遅れて届く方の失敗は表示に影響しない */ });
    };

    const backgroundPromise = safeRuntimeSendMessage({ type: 'GET_LYRICS', payload });

    // YTM優先で YTM が同期歌詞を持っているなら、LRCHub の完了を待つ意味はない。
    // 以前はここで background を無条件に await していたため、YTM が 250ms で
    // 返っていても LRCHub のレース(1.5秒)とフォールバック(各8秒)が終わるまで
    // 描画されず、並列に走らせた意味が消えていた。
    const preferYtmSource = (config.lyricSourceMode || 'ytm') === 'ytm';

    // YTM の待ちには上限を置く。
    //
    // YTM の取得は next → browse の2段直列で、各段のタイムアウトが 5 秒。
    // 別リリースや counterpart の探索に入るとさらに伸びる。ここで完了を
    // 待ち切ると、LRCHub が 300ms で答えていても最大10秒ほど白紙になる。
    // 並列に走らせている意味がこの一行で消えていた。
    //
    // 間に合わなければ先に他の歌詞を出し、YTM は届いた時に差し替える。
    // 差し替えの可否は applyLateLyricsUpgrade の判断に委ねる。あちらは
    // 品質が下がる差し替えを拒むので、同期の粗い YTM が単語同期を
    // 上書きすることはない。「YTM優先」が完全に通るのは YTM が間に合った
    // 回だけになるが、10秒の白紙を避ける方を採る。
    const ytmWaitMarker = {};
    const ytmRaced = preferYtmSource
      ? await Promise.race([
        ytmPromise,
        new Promise(resolve => setTimeout(() => resolve(ytmWaitMarker), YTM_EARLY_WAIT_MS)),
      ])
      : null;
    const ytmWaitTimedOut = ytmRaced === ytmWaitMarker;
    const ytmEarly = ytmWaitTimedOut ? null : ytmRaced;
    const skipWaitingBackground = !!(ytmEarly && ytmEarly.hasSynced);

    let res = skipWaitingBackground
      // 既に返っていればメタデータ(候補・翻訳・解説)ごと使えるので、短時間だけ待つ
      ? await Promise.race([
        backgroundPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 400)),
      ])
      : await backgroundPromise;

    if (skipWaitingBackground && res === null) {
      // 間に合わなかった分のメタデータを反映する。通常歌詞は YTM を
      // 維持するが、アニメーション表示が有効な srv3 は後着でも差し替える。
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
        if (selectLyricsPayload(late).mode === 'animated') {
          void applyLateLyricsUpgrade(late).catch((error) => {
            console.warn('[YTM] Failed to apply late srv3 lyrics:', error);
          });
        }
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
      const backgroundSelection = selectLyricsPayload(res);
      const backgroundHasLyrics = !!res?.success && !!backgroundSelection.text.trim();
      const backgroundHasSrv3 = backgroundHasLyrics && backgroundSelection.mode === 'animated';

      // LRCHub優先で、しかも LRCHub 側が既に歌詞を返しているなら YTM の結果は使わない。
      // ここで待つと、表示が YTM の完了まで丸ごと遅れてしまう
      // (カタログ解決が走る曲では1秒以上かかる)。走らせたままにして待たない。
      if (preferYtm || !backgroundHasLyrics) {
        // 上限で打ち切った回にここで待ち直すと、上の上限が無意味になる。
        // 他に歌詞があるならそれを出して、YTM は届いた時に差し替える。
        // 逆にどこからも歌詞が来ていないなら、YTM だけが頼りなので待つ。
        if (ytmWaitTimedOut && backgroundHasLyrics) {
          scheduleYtmLateUpgrade();
        } else {
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
          const useYtm = !!ytmRes && stillCurrent && !backgroundHasSrv3 &&
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
      // 比べるのは生データ同士。描画用に正規化した dynamicLines と比べると
      // 中身が同じでも必ず不一致になり、毎回描き直しになる。
      const shownDynamicLines = dynamicLinesRaw !== null ? dynamicLinesRaw : dynamicLines;
      const isDifferent = (preferredLyrics !== data) ||
        (JSON.stringify(selectedResponse.dynamicLines) !== JSON.stringify(shownDynamicLines)) ||
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
          candidates: LyricsCache.stripCandidateLyrics(lyricsCandidates) || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: res.lyricsSource || null,
          fetchedAt: Date.now(),
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

// Segmenter の生成は重いため1回だけ作って使い回す。
// 無防備に new すると、Intl.Segmenter が無い環境ではこのファイル全体の
// 読み込みが落ちて拡張が起動しない。lyricUnitSegmenter と同じ守り方にする。
const _jaWordSegmenter = (() => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch (e) { /* 使えなければ折り返しのまとめを諦める */ }
  return null;
})();

// ── 行の折り返し位置 ────────────────────────────────────────
// 「を」「の」で行が始まったり、拗音が行頭に落ちたりしないように、
// くっつけて良い所を判定する。同期ありの行と無しの行で判定が違うと
// 同じ曲の中で折り返し方が変わってしまうので、両方ここを通す。
const LYRIC_PHRASE_RULES = {
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
  hasKanji: (w) => /[一-鿿]/.test(w),
  isHiragana: (w) => /^[぀-ゟー]+$/.test(w),
  isKatakana: (w) => /^[゠-ヿー]+$/.test(w),
  startsWithSmallKana: (w) => /^[ぁぃぅぇぉっゃゅょゎゕゖ]/.test(w),
};

const shouldMergeLyricSegments = (word, nextWord) => {
  if (!nextWord) return false;
  const r = LYRIC_PHRASE_RULES;
  // 開き括弧は次の語に付く。閉じ括弧は suffixes にあって前の語に付くが、
  // 開き括弧には相棒が無く、単独のまとまりとして行末に取り残されていた。
  // 「君を知りたい(」で折り返して次の行が「君を知りたい)」になる。
  if (r.isOpenParen(word)) return true;
  if (r.startsWithSmallKana(nextWord)) return true;
  if (r.suffixes.has(nextWord)) return !r.isOpenParen(nextWord);
  if (r.hasKanji(word) && r.isHiragana(nextWord)) return true;
  if (r.isKatakana(word) && r.isKatakana(nextWord)) return true;
  if ((r.isEnglish(word) || r.isSpace(word)) &&
    (r.isEnglish(nextWord) || r.isSpace(nextWord))) return true;
  return false;
};

// 同期ありの行は語ごとの span に分かれている。そのままだと語と語の
// どこでも折り返せてしまい、「を」だけが行頭に落ちる。
// 同じ規則でまとめて、まとまりの中では折り返させない。
const groupLyricUnitsIntoPhrases = (units) => {
  const phrases = [];
  let current = null;

  for (let i = 0; i < units.length; i++) {
    if (!current) {
      current = [];
      phrases.push(current);
    }
    current.push(units[i]);

    const next = units[i + 1];
    if (!next) break;
    if (shouldMergeLyricSegments(units[i].text, next.text)) continue;
    current = null;
  }

  return phrases;
};

const optimizeLineBreaks = (text) => {
  if (!text) return '';

  // 語区切りが使えない環境では、まとめずに1行を1つの span にする。
  // 折り返しの見た目は落ちるが、歌詞は出る。
  if (!_jaWordSegmenter) return `<span class="lyric-phrase">${escapeHtml(text)}</span>`;

  const segments = Array.from(_jaWordSegmenter.segment(text));

  let html = '';
  let buffer = '';

  for (let i = 0; i < segments.length; i++) {
    const word = segments[i].segment;
    const next = segments[i + 1];

    buffer += word;

    if (!next) {
      html += `<span class="lyric-phrase">${escapeHtml(buffer)}</span>`;
      break;
    }

    if (shouldMergeLyricSegments(word, next.segment)) continue;

    html += `<span class="lyric-phrase">${escapeHtml(buffer)}</span>`;
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
  resetLyricScrollState(ui.lyrics);
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

  // Apple Music 風は語ごとの span、従来式は1文字ずつの span。
  // DOM の作りが違うので、設定が変わったら描き直す必要がある
  // (設定保存側で applyLyricsText を呼び直している)。
  // 低負荷モードでは従来式に落とす。毎フレームの塗り替えは
  // そもそも負荷を削りたい人向けではない。
  // 軽量モードでも文字同期を動かす。合成側に載っているので負荷の主因ではない
  // (applyAppleSyncClass の注釈を参照)。軽くするのは光だけ。
  const useWordSync = !!config.appleSyncStyle;

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

    const lineEndSec = (typeof line?._dynamicRenderEndSec === 'number')
      ? line._dynamicRenderEndSec
      : null;

    if (dyn && Array.isArray(dyn.chars) && dyn.chars.length && useWordSync) {
      // Apple Music 風: 語ごとに span を立てる。語の中の字形はブラウザに
      // そのまま組ませるので、字の間に隙間が出ない。
      const wordSpans = [];
      const units = buildLyricWordUnits(dyn.chars, lineEndSec);
      for (const phrase of groupLyricUnitsIntoPhrases(units)) {
        // まとまりごとに inline-block で包む。折り返せるのはこの外側だけ。
        const phraseSpan = createEl('span', '', 'lyric-phrase lyric-phrase-sync');
        for (const unit of phrase) {
          if (unit.type === 'space') {
            phraseSpan.appendChild(document.createTextNode(unit.text));
            continue;
          }
          if (!unit.text) continue;
          const wordSpan = createEl('span', '', 'lyric-word');
          wordSpan.textContent = unit.text;
          wordSpan._times = unit.times;
          wordSpan._offsets = unit.offsets;
          wordSpan._start = unit.start;
          wordSpan._end = unit.end;
          wordSpan._emp = false;
          // PIP は innerHTML で複製するので JS のプロパティが消える。
          // 向こうで組み直せるように、時刻は属性にも書いておく。
          wordSpan.dataset.wt = unit.times
            .map(t => (t === null ? '' : t.toFixed(3))).join(',');
          if (Number.isFinite(unit.end)) wordSpan.dataset.we = unit.end.toFixed(3);
          phraseSpan.appendChild(wordSpan);
          wordSpans.push(wordSpan);
        }
        if (phraseSpan.childNodes.length) mainSpan.appendChild(phraseSpan);
      }
      if (wordSpans.length) {
        row._ytmWordSpans = wordSpans;
        row.classList.add('ytm-word-sync');
      } else {
        mainSpan.textContent = '';
        mainSpan.innerHTML = optimizeLineBreaks(line ? line.text : '');
      }
    } else if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
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
      charSpans.forEach((sp, ci) => {
        const next = charSpans[ci + 1];
        const end = next ? next._ytmTime : lineEndSec;
        sp._ytmEnd = (Number.isFinite(end) && end > sp._ytmTime)
          ? end
          : sp._ytmTime + CHAR_DEFAULT_SPAN_SEC;
      });
      row._ytmCharSpans = charSpans;
    } else {
      const rawText = line ? line.text : '';
      mainSpan.innerHTML = optimizeLineBreaks(rawText);
    }
    row.appendChild(mainSpan);

    if (line && line.translation) {
      // 翻訳文はそのまま innerHTML に入れない。"<" を含むと以降が消える。
      const subSpan = createEl('span', '', 'lyric-translation');
      subSpan.textContent = line.translation;
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
  if (useWordSync) {
    prefetchLyricLineSweeps(Array.from(ui.lyrics.querySelectorAll('.lyric-line.ytm-word-sync')));
  }

  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
    if (useWordSync) {
      // PIP は幅が違うので語の横位置も違う。向こうの文書で測り直す。
      prefetchLyricLineSweeps(
        Array.from(PipManager.pipLyricsContainer.querySelectorAll('.lyric-line.ytm-word-sync')),
      );
    }
    if (PipManager.pipWindow.document) {
      // 歌詞が無い曲は PIP でも歌詞エリアごと畳む（通常ウィンドウと同じ扱い）
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-lyrics', !hasData);
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      PipManager.pipWindow.document.body.classList.remove('ytm-animated-caption-mode');
      PipManager.pipWindow.document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
      PipManager.pipWindow.document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    }
  }
}

const handleUpload = (e) => {
  const file = e.target.files[0];
  if (!file || !currentKey) return;
  const uploadKey = currentKey;
  const r = new FileReader();
  r.onload = async (ev) => {
    await storage.set(uploadKey, {
      cacheVersion: LYRICS_CACHE_VERSION,
      video_id: currentLyricsVideoId || getCurrentVideoId() || null,
      lyrics: String(ev.target.result || ''),
      dynamicLines: null,
      manualLyrics: true,
      lyricsSource: 'manual',
      fallbackUsed: false,
      noLyrics: false,
    });
    // 読み込んだ曲のままなら、そのまま出す。
    //
    // 以前は currentKey を潰して「曲が変わった」ことにし、tick に任せていた。
    // だが tick は player-bar の DOM が動いた時だけ走るので、何も触らないと
    // 読み込んだ歌詞がいつまでも出ない。走ったら走ったで初回ロード扱いになり、
    // 連続再生オフセットと同期オフセットが 0 に戻って歌詞がずれる。
    if (currentKey !== uploadKey) return;
    const metaNow = getMetadata();
    if (!metaNow) return;
    // manualLyrics はキャッシュ優先度 3。裏の取得で上書きされることはない。
    loadLyrics(metaNow);
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

// ── 行送りのスクロール ──────────────────────────────────
// ブラウザ内蔵の smooth スクロールは、動いている途中で次の行が来ると
// いまの動きを打ち切って新しい動きを始める。そこで速度が跳ねるので、
// 行がつぎつぎ変わる所ほどつっかえて見える。
// 自前のばねで動かすと、目標が変わっても今の速度のまま繋がる。
// 行き過ぎて戻らないよう臨界減衰(damping = 2√stiffness)にしてある。
const SCROLL_STIFFNESS = 120;
const SCROLL_DAMPING = 2 * Math.sqrt(SCROLL_STIFFNESS);
// これ以下になったら止める。残りコンマ数 px を延々と詰めない。
const SCROLL_SETTLE_PX = 0.5;
const SCROLL_SETTLE_VEL = 8;
// 自分が書いた位置からこれ以上ずれていたら、誰かが動かしたとみなして譲る
const SCROLL_HANDOVER_PX = 4;

const snapLyricScroll = (container) => {
  if (!container || container._scrollTarget === undefined) return;
  container.scrollTop = container._scrollTarget;
  // 書いた値ではなく、丸められた実際の値を覚える。
  // scrollTop は 0〜(scrollHeight - clientHeight) に丸められる。中央合わせの
  // 行き先は曲頭と曲末で範囲の外に出る(上下の余白 30vh に対し中央は
  // clientHeight/2 = 32.5vh。行が 5vh より低いと、1行目の行き先が負になる)。
  // ここで丸める前の値を覚えると、以後 stepLyricScroll の「誰かが動かした」
  // 判定が毎フレーム成立して、追従が二度と動かなくなる。
  // 歌詞をクリックすると後方シークになり即時ジャンプでここを通るので、
  // 曲頭の行を選ぶとその曲のあいだ自動スクロールが死んでいた。
  container._scrollPos = container.scrollTop;
  container._scrollLastWritten = container.scrollTop;
  container._scrollVel = 0;
  container._scrollTarget = undefined;
};

// 先頭へ戻す時など、ばねの外から scrollTop を書く場合はこれを通す。
// 記録を残したまま書き換えると、次のフレームで「誰かが動かした」と
// 誤判定して追従が止まる。
const resetLyricScrollState = (container, top = 0) => {
  if (!container) return;
  container.scrollTop = top;
  container._scrollTarget = undefined;
  container._scrollVel = 0;
  container._scrollPos = container.scrollTop;
  container._scrollLastWritten = container.scrollTop;
};

// ── 歌っている行を止める位置 ────────────────────────────────
// 既定は器の中央。狭い画面(縦積み)では、中央に置くと上半分が歌い終わった行で
// 埋まってしまい、これから来る歌詞の見える量が半分になる。CSS 側で
//   --ytm-lyrics-anchor-top-lines: 0.5
// のように「上から何行ぶん下げた所に置くか」を指定できるようにして、
// 画面の形ごとの判断は CSS(メディアクエリ)に持たせる。
//
// 行の高さを単位にしているので、文字サイズや UI サイズを変えても
// 上に残る余白の見た目が変わらない。
const LYRICS_ANCHOR_VAR = '--ytm-lyrics-anchor-top-lines';

const readLyricAnchorTopLines = (container) => {
  if (container._ytmAnchorLines !== undefined) return container._ytmAnchorLines;
  let value = null;
  try {
    const raw = container.ownerDocument.defaultView
      .getComputedStyle(container)
      .getPropertyValue(LYRICS_ANCHOR_VAR)
      .trim();
    const n = Number(raw);
    if (raw && Number.isFinite(n) && n >= 0) value = n;
  } catch (e) { /* 読めなければ中央に置く */ }
  container._ytmAnchorLines = value;
  return value;
};

// 器の上端から、その行の上端までの距離
const lyricAnchorOffset = (container, rowHeight) => {
  const lines = readLyricAnchorTopLines(container);
  if (lines === null) return (container.clientHeight / 2) - (rowHeight / 2);
  return lines * rowHeight;
};

const requestLyricScroll = (container, target, instant) => {
  if (!container) return;
  if (instant) {
    container._scrollTarget = target;
    snapLyricScroll(container);
    return;
  }
  // 前回自分が書いた位置から離れていたら、ユーザーが動かしたか
  // レイアウトが変わったということ。そこから引き継ぐ。
  const written = container._scrollLastWritten;
  if (written === undefined || Math.abs(container.scrollTop - written) > SCROLL_HANDOVER_PX) {
    container._scrollPos = container.scrollTop;
    container._scrollVel = 0;
  }
  container._scrollTarget = target;
};

const stepLyricScroll = (container, dt) => {
  if (!container || container._scrollTarget === undefined) return;

  // 動かしている最中にユーザーが触ったら、そちらを優先して手を引く
  if (container._scrollLastWritten !== undefined &&
    Math.abs(container.scrollTop - container._scrollLastWritten) > SCROLL_HANDOVER_PX) {
    container._scrollTarget = undefined;
    container._scrollVel = 0;
    // 途中で手を引いたなら、その行へは行き着いていない。
    // 「スクロール済み」の印を戻して次のフレームで出し直せるようにする。
    // これが無いと、翻訳の到着で行の高さが変わるなど、ユーザー操作以外で
    // scrollTop が動いた回に、次の行が来るまで追従が止まる。
    // 本当にユーザーが掴んでいる時は下の isUserScrolling で弾かれ、
    // 手を離して 3 秒すればどのみち印は戻る。
    container._lastScrolledIndex = -1;
    return;
  }

  const target = container._scrollTarget;
  let pos = container._scrollPos ?? container.scrollTop;
  let vel = container._scrollVel || 0;
  const diff = pos - target;

  if (Math.abs(diff) < SCROLL_SETTLE_PX && Math.abs(vel) < SCROLL_SETTLE_VEL) {
    snapLyricScroll(container);
    return;
  }

  vel += (-SCROLL_STIFFNESS * diff - SCROLL_DAMPING * vel) * dt;
  pos += vel * dt;

  container._scrollPos = pos;
  container._scrollVel = vel;
  container.scrollTop = pos;
  container._scrollLastWritten = container.scrollTop;

  // 自分で動かしているぶんの scroll イベントを、ユーザー操作と
  // 取り違えられないようにしておく(どちらの判定もこれを最初に見る)。
  container._suppressUserScrollUntil = performance.now() + 220;
  if (container === ui.lyrics) suppressUserScrollDetection(220);
};

let _lastScrollStepAt = 0;
const stepLyricScrolls = (nowMs) => {
  const dt = _lastScrollStepAt ? Math.min(0.05, (nowMs - _lastScrollStepAt) / 1000) : 0;
  _lastScrollStepAt = nowMs;
  if (dt <= 0) return;
  stepLyricScroll(ui.lyrics, dt);
  stepLyricScroll(PipManager.pipLyricsContainer, dt);
};

function startLyricRafLoop() {
  if (isRafLoopRunning) return;
  isRafLoopRunning = true;
  cancelLyricRaf();
  _cachedVideoEl = null;
  // 停止中に曲が変わっている可能性があるため、巻き戻り検出の基準をリセット
  _lastRafPlaybackTime = -1;
  // 一時停止をまたぐと「止まっていた間の実時間」が補間に乗ってしまう
  resetPlaybackClock();

  _lastScrollStepAt = 0;

  const loop = () => {
    const v = _cachedVideoEl || (_cachedVideoEl = document.querySelector('video'));
    // rAF が渡す時刻は使わない。PIP を開くとループが向こうの窓の
    // requestAnimationFrame に移り、時刻の原点が変わってしまう。
    stepLyricScrolls(performance.now());

    if (v) {
      if (PipManager.pipWindow) {
        PipManager.updatePlayState(v.paused);
      }

      const isPlaying = v.readyState > 0 && !v.paused && !v.ended;
      // 毎フレーム書かない。値が同じでも classList への代入は
      // スタイルの再計算対象になるので、変わった時だけ触る。
      if (isPlaying !== _lastPlayingStateForBodyClass) {
        _lastPlayingStateForBodyClass = isPlaying;
        document.body.classList.toggle('ytm-music-paused', !isPlaying);
      }

      if (isPlaying) {
        _playbackRateForMotion = (Number.isFinite(v.playbackRate) && v.playbackRate > 0)
          ? v.playbackRate
          : 1;
        let t = readSmoothPlaybackTime(v);
        const duration = v.duration || 1;

        // 連続再生（曲が変わっても currentTime がリセットされない）対応:
        // 現在の曲が始まった video 時間(timeOffset)を引いて曲内ローカル時間にする。
        // currentTime が offset を下回ったら曲がリセットされたとみなし offset を解除。
        if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
        t = toLocalPlaybackTime(t);
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

        // PipManager.progressRing を更新する処理がここにあったが、
        // その要素はどこでも生成されていないので毎フレーム空振りしていた。

        if (PipManager.pipWindow) {
          lyricRafWindow = PipManager.pipWindow;
          lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
        } else {
          lyricRafWindow = window;
          lyricRafId = requestAnimationFrame(loop);
        }
      } else {
        // 止まっている間はループが回らない。中途半端な位置で残らないよう着地させる。
        snapLyricScroll(ui.lyrics);
        snapLyricScroll(PipManager.pipLyricsContainer);
        // 文字の動きは合成側の時計で走っているので、明示的に止めないと
        // 一時停止中も歌詞だけ動き続ける。
        pauseAllLyricWordMotion();
        isRafLoopRunning = false;
      }
    } else {
      snapLyricScroll(ui.lyrics);
      snapLyricScroll(PipManager.pipLyricsContainer);
      pauseAllLyricWordMotion();
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

// 窓の大きさが変わったら、いまの行へ寄せ直す。
//
// 行を画面の真ん中に置く量は、その時の器の高さと行の位置から px で出している。
// 窓の幅が変わると縦積み↔横並びでレイアウトごと変わるので、前の大きさで
// 出した位置は意味を失う。それでも「この行へはもう寄せた」という印
// (_lastScrolledIndex)が残っているせいで、次の行が始まるまで誰も直さない。
// 実際、幅を変えて戻すと歌詞が画面の下に取り残されて消えたように見えた。
const recenterLyricsAfterResize = () => {
  for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
    if (!container) continue;
    // 画面の形が変わるとメディアクエリごと変わる。止める位置も読み直す。
    container._ytmAnchorLines = undefined;
    // 印を戻すと次のフレームで今の行へ寄せ直す。
    container._lastScrolledIndex = -1;
    // 直前の位置から流すと、変わったあとの見当違いな所から動き出す。
    container._instantNextScroll = true;
    // 追いかけている途中の目標も、前の大きさで出した px なので捨てる。
    container._scrollTarget = undefined;
    container._scrollVel = 0;
  }
};

// 窓の大きさが変わると語の横位置が動く。次に主役になった時に測り直させる。
let _sweepResizeTimer = null;
window.addEventListener('resize', () => {
  if (_sweepResizeTimer) clearTimeout(_sweepResizeTimer);
  _sweepResizeTimer = setTimeout(() => {
    _sweepResizeTimer = null;
    invalidateLyricLineSweeps();
    recenterLyricsAfterResize();
  }, 200);
});

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

// シークで offset を下回ったら、その曲は頭から掛け直されている。
// rAF ループは再生中しか回らないので、止めたままシークした時はここで直す。
document.addEventListener('seeked', (e) => {
  if (e.target.tagName !== 'VIDEO') return;
  const t = e.target.currentTime;
  if (typeof t === 'number' && timeOffset > 0 && t < timeOffset) timeOffset = 0;
}, true);



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

// ── 再生位置の補間 ────────────────────────────────────────
// video.currentTime は毎フレーム進むわけではない。YouTube Music が流すのは
// 実質音声だけのストリームで、currentTime は音声バッファのコールバック単位に
// まとめて進む(実測で数十 ms おき)。rAF は 60fps で回るので、そのまま使うと
// 同じ値が数フレーム続いたあと一段飛ぶ = 階段状の時間になる。
//
// 従来の「時刻を過ぎたら点灯」ではこの段差は見えなかった。1文字が数十 ms
// 遅れて点いても分からないため。塗りを連続にした途端に段差がそのまま
// 目に見えるようになった。
//
// やっていること:
//   1. 自前の時計をフレーム間の実経過時間ぶんだけ進める(ここが滑らかさの本体)
//   2. currentTime から作った推定値へ、毎フレームごくわずかだけ引き寄せる
// 2 を一気にやると段差が戻ってくる。currentTime 由来の推定値は
// 「更新されるまで古い値のまま」なので、それ自体がノコギリ状に揺れていて、
// そのまま採用すると 10ms 前後の凸凹が残る。少しずつ吸収して均す。
let _clockRawTime = -1;   // 最後に観測した currentTime そのもの
let _clockRawAt = 0;      // それを観測した performance.now()
let _clockOutTime = -1;   // 直前に返した推定値
let _clockOutAt = 0;      // それを返した performance.now()

// currentTime が止まっている間に推定値を進めてよい上限。
// バッファ切れ等で本当に止まった時、時計だけ走り続けるのを防ぐ。
const CLOCK_MAX_EXTRAPOLATION_SEC = 0.2;
// 推定値とのズレがこれを超えたらシーク・曲送りとみなして合わせ直す
const CLOCK_RESYNC_SEC = 0.35;
// 1フレームで吸収するズレの割合。小さいほど滑らかで、追従は遅くなる。
const CLOCK_CORRECTION = 0.12;
// 推定値からどこまで離れることを許すか。先走りは音より先に光るので厳しめ。
const CLOCK_MAX_LEAD_SEC = 0.08;
const CLOCK_MAX_LAG_SEC = 0.15;

const resetPlaybackClock = () => {
  _clockRawTime = -1;
  _clockRawAt = 0;
  _clockOutTime = -1;
  _clockOutAt = 0;
};

const readSmoothPlaybackTime = (v) => {
  const raw = v.currentTime;
  if (!Number.isFinite(raw)) return raw;

  const now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  const rate = (Number.isFinite(v.playbackRate) && v.playbackRate > 0) ? v.playbackRate : 1;

  if (raw !== _clockRawTime) {
    _clockRawTime = raw;
    _clockRawAt = now;
  }

  // currentTime は「最後に更新された時点では正確」。そこからの実経過を足す。
  const target = raw + Math.min(
    (now - _clockRawAt) / 1000 * rate,
    CLOCK_MAX_EXTRAPOLATION_SEC,
  );

  if (_clockOutTime < 0 || Math.abs(target - _clockOutTime) > CLOCK_RESYNC_SEC) {
    // 初回・シーク・曲送り・タブが止まっていた後。素直に合わせ直す。
    _clockOutTime = target;
    _clockOutAt = now;
    return _clockOutTime;
  }

  const predicted = _clockOutTime + (now - _clockOutAt) / 1000 * rate;
  let out = predicted + (target - predicted) * CLOCK_CORRECTION;
  if (out > target + CLOCK_MAX_LEAD_SEC) out = target + CLOCK_MAX_LEAD_SEC;
  if (out < target - CLOCK_MAX_LAG_SEC) out = target - CLOCK_MAX_LAG_SEC;

  _clockOutTime = out;
  _clockOutAt = now;
  return out;
};

let _hasDynamicRenderRanges = false;
// アクティブ行に1文字同期スパンが含まれるか。trueの間のみ毎フレームのDOM更新が必要。
// 安全側に倒して初期値はtrue（次のフレームで実態に合わせて更新される）
let _activeRowsHaveCharSpans = true;

function suppressUserScrollDetection(ms = 500) {
  _suppressUserScrollUntil = performance.now() + ms;
}

// 動きは合成側の時計で走るので、倍速再生に付いていくために
// 再生速度を渡す必要がある。毎フレーム video を読み直さずに済むよう、
// rAF ループが更新した値をここで使う。
let _playbackRateForMotion = 1;

// body のクラスを毎フレーム書き直さないための控え。
// null は「まだ一度も書いていない」= 次は必ず書く。
let _lastPlayingStateForBodyClass = null;

// アクティブ行の塗り(文字・語の進み)を1行ぶん更新する。
// 毎フレーム必要なのはここだけなので、行の状態が変わっていないフレームは
// この関数をアクティブ行にだけ当てる(全行の走査をしない)。
// 戻り値は「この行が文字単位の塗りを持っていたか」。
function paintActiveLyricRow(r, t) {
  // 行要素にキャッシュした配列を使う（毎フレームの querySelectorAll を回避）
  // PIP の行は複製なので _ytmWordSpans を持たない。クラスで見分けて
  // 一度だけ組み直す(rehydrate は paintLyricWordRow の中でやる)。
  const isWordSync = r._ytmWordSpans
    ? r._ytmWordSpans.length > 0
    : r.classList.contains('ytm-word-sync');
  if (isWordSync) {
    paintLyricWordRow(r, t, _playbackRateForMotion);
    return true;
  }

  let charSpans = r._ytmCharSpans;
  if (!charSpans) charSpans = r._ytmCharSpans = Array.from(r.querySelectorAll('.lyric-char'));
  if (charSpans.length === 0) return false;

  charSpans.forEach(sp => {
    if (sp._ytmTime === undefined) sp._ytmTime = parseFloat(sp.dataset.time || '0');
    const tt = sp._ytmTime;
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
  return true;
}

// 行どうしの突き合わせに使う文字列。NFKC 正規化と記号落としを毎フレーム
// やり直していた(アクティブ行と 1 つ前の行で毎フレーム 2 回)。
// 元の text が変わらない限り結果も変わらないので、行に覚えさせる。
const lyricCompareText = (line) => {
  if (!line || typeof line !== 'object') return normalizeLyricCompareTextStrict(line?.text);
  const raw = line.text;
  if (line._ytmCmpSrc === raw && typeof line._ytmCmpText === 'string') return line._ytmCmpText;
  const value = normalizeLyricCompareTextStrict(raw);
  line._ytmCmpSrc = raw;
  line._ytmCmpText = value;
  return value;
};

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
    const primaryLine = lyricsData[idx];
    const primaryHasDynamicRange = Number.isFinite(primaryLine?._dynamicRenderStartSec) &&
      Number.isFinite(primaryLine?._dynamicRenderEndSec);
    const primaryIsActive = isPrimaryRowLitAtTime(lyricsData, idx, t);
    if (primaryIsActive) activeIndices.add(idx);

    const currentLineTime = lyricsData[idx]?.time;
    if (primaryIsActive && typeof currentLineTime === 'number') {
      for (let i = idx - 1; i >= 0; i--) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
      for (let i = idx + 1; i < lyricsData.length; i++) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
    }

    if (primaryIsActive && activeIndices.size === 1) {
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
          const currentText = lyricCompareText(lyricsData[idx]);
          const prevText = lyricCompareText(lyricsData[prevIdx]);
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

        const activeText = lyricCompareText(activeLine);
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

          const otherText = lyricCompareText(otherLine);
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

  // 行の状態が変わっていないフレームでやることは、アクティブ行の塗り直しだけ。
  //
  // それでも今までは毎フレーム全行を走査していた。1曲 60〜100 行として
  // 秒 60 回、行ごとにクラス判定と past 判定が走る。歌詞が長い曲ほど重い。
  //
  // active の集合が変わらず、スクロールの追従も済んでいるなら、
  // 「どの行が past か」も前のフレームから変わらない(idx が動けば
  //  _lastScrolledIndex とずれて scrollPending が立つ)。塗る行だけ見る。
  const needsFullRowPass = activeChanged || scrollPending;

  targets.forEach(container => {
    const rows = container.children;
    if (rows.length === 0) return;

    if (!needsFullRowPass) {
      activeIndices.forEach(i => {
        const r = rows[i];
        if (!r || !r.classList.contains('lyric-line')) return;
        if (paintActiveLyricRow(r, t)) sawActiveCharSpans = true;
      });
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.classList.contains('lyric-line')) continue;
      const isActive = activeIndices.has(i);
      const isPrimary = (i === idx);
      // 歌い終わった行は active を外す(歌っていないのに光っていたら嘘)。
      // ただし past にはしない。past は不可視なので、次の行が始まるまでの
      // 間ずっと画面から歌詞が消える。
      //
      // 終わり時刻を持つのは文字同期の行だけなので、この差は「同期が細かい
      // 曲ほど画面が空になる」という逆転になっていた。実測: Dear
      // (Mrs. GREEN APPLE) は行間の空きが歌っている時間の6割あり
      // (歌 166秒 / 空き 101秒)、点いて消えて点いて消えて、に見えた。
      //
      // 次の行が始まれば idx が進み、この行は i < idx で past になる。
      // 消える時機が「自分が終わった時」から「次が始まる時」に変わるだけ。
      const isPast = idx >= 0 && !isActive && i < idx;
      // 値が同じでも classList への代入はスタイルの再計算対象になる。
      // 行数ぶん毎フレーム書いていたので、変わった時だけ触る。
      if (r._ytmIsPast !== isPast) {
        r._ytmIsPast = isPast;
        r.classList.toggle('lyric-past', isPast);
      }

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

          if (container === ui.lyrics) {
            // 見送る回で _instantNextScroll を消さない。消すと、次に動ける
            // ようになった時に 0 秒位置からゆっくり流れてしまう。
            if (isUserScrolling) continue;
            container._instantNextScroll = false;
            // 【通常再生画面】
            // getBoundingClientRect を使って要素の絶対位置から確実なスクロール量を計算
            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            const targetScroll = container.scrollTop + rRect.top - containerRect.top
              - lyricAnchorOffset(container, rRect.height);

            isProgrammaticScrolling = true;
            clearTimeout(programmaticScrollTimeout);
            clearTimeout(programmaticScrollMaxTimeout);
            programmaticScrollTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 150);
            programmaticScrollMaxTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 1200);
            if (scrollBehavior === 'auto') suppressUserScrollDetection(300);

            requestLyricScroll(container, targetScroll, scrollBehavior === 'auto');

            container._lastScrolledIndex = idx;
            ReplayManager.incrementLyricCount();
          } else {
            // 【PIP（小窓）】
            if (container._isUserScrolling) continue;
            container._instantNextScroll = false;

            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            const targetScroll = container.scrollTop + rRect.top - containerRect.top - (container.clientHeight * 0.35) + (rRect.height / 2);

            container._isProgrammaticScrolling = true;
            requestLyricScroll(container, targetScroll, scrollBehavior === 'auto');

            container._lastScrolledIndex = idx;
          }
        }

        if (paintActiveLyricRow(r, t)) sawActiveCharSpans = true;
      } else if (activeChanged && _previousActiveIndices.has(i)) {
        // 状態遷移: active→非active になった行のみリセット
        r.classList.remove('active');
        r.classList.remove('show-translation');

        if (r.classList.contains('ytm-word-sync')) {
          resetLyricWordRow(r);
        } else {
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

    // クラウド同期。曲が変わるたびに全履歴を送ると通信量が跳ねるので、
    // 前回から一定時間空いた時だけ走らせる(間隔は CloudSync 側)。
    if (currentKey !== null && CloudSync && typeof CloudSync.syncIfDue === 'function') {
      CloudSync.syncIfDue();
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
    lyricsApplyEpoch += 1;
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
    resetLyricScrollState(ui.lyrics);
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

// 背景に使う画像の読み込み世代。
// 曲が変わっても前の画像の読み込みは止まらない(DOM から外しても onload は
// 発火する)。前の画像が遅れて読み終わると、新しい背景を古いもので塗り潰す。
// アートワーク本体は replaceChildren で即座に入れ替わるので、
// 「背景だけ前の曲のまま」になる。世代を持たせて古い分を捨てる。
let _bgLoadToken = 0;

function updateMetaUI(meta) {
  ui.title.innerText = meta.title;
  ui.artist.innerText = meta.artist;

  if (meta.src) {
    const bgToken = ++_bgLoadToken;
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
      if (bgToken !== _bgLoadToken) return;   // もう次の曲になっている
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
      if (bgToken !== _bgLoadToken) return;
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
      // アーティスト名も URL も YTM の DOM から来る文字列なので、
      // innerHTML に埋め込まず要素として組む。名前に "<" が入るだけで
      // 以降が消えたり、href に細工が入ったりする。
      const frag = document.createDocumentFragment();

      artistLinks.forEach((link, index) => {
        const a = document.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        a.textContent = link.textContent.trim();
        frag.appendChild(a);
        if (index < artistLinks.length - 1) {
          frag.appendChild(document.createTextNode(' • '));
        }
      });
      ui.artist.replaceChildren(frag);
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
    savedAppleSync,
  ] = await Promise.all([
    storage.get('ytm_sync_offset'),
    storage.get('ytm_save_sync_offset'),
    storage.get('ytm_lrclib_fallback'),
    storage.get('ytm_lyric_source_mode'),
    storage.get('ytm_animated_captions_enabled'),
    storage.get('ytm_singer_colors_enabled'),
    storage.get('ytm_apple_sync_style'),
  ]);
  if (savedOffset !== null && Number.isFinite(Number(savedOffset))) config.syncOffset = Number(savedOffset);
  if (savedOffsetEnabled !== null) config.saveSyncOffset = !!savedOffsetEnabled;
  config.useLrcLibFallback = true;
  config.lyricSourceMode = normalizeSourceMode(savedSourceMode);
  if (savedAnimatedCaptions !== null) config.useAnimatedCaptions = !!savedAnimatedCaptions;
  if (savedAppleSync !== null) config.appleSyncStyle = !!savedAppleSync;
  if (savedSingerColors !== null) config.useSingerColors = !!savedSingerColors;
  document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
  applyAppleSyncClass();
  setupPointerActivityWatch();

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
  const preferSongModeStored = await storage.get('ytm_prefer_song_mode');
  if (preferSongModeStored !== null && preferSongModeStored !== undefined) {
    config.preferSongMode = !!preferSongModeStored;
  }

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
    // 既に次の tick を予約済みなら、中身を見る意味が無い。
    // 再生中はシークバーの属性変化が絶えず届くので、その回ぶんの
    // closest() をまるごと省ける。
    if (_tickScheduled) return;
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
