// A separate subtitle below the original lyric. Never changes word/character
// spans, karaoke timings, ruby, or the text used by lyric cards and translation.
const KoreanPronunciation = (() => {
  const STORAGE_KEY = 'ytm_korean_pronunciation';
  const SIZE_KEY = 'ytm_korean_pronunciation_size';
  const subtitles = new Set();
  let fontSize = 20;
  const normalizeSize = value => Number.isFinite(Number(value)) && value !== null ? Math.max(14, Math.min(36, Math.round(Number(value)))) : 20;
  const cache = new Map();
  const inflight = new Map();
  const LIMIT = 1024;
  let enabled = true;
  let loaded = null;

  const remember = (key, reading) => {
    cache.set(key, reading);
    while (cache.size > LIMIT) cache.delete(cache.keys().next().value);
  };
  const currentTarget = () => typeof config === 'undefined' ? 'ko' : (['ko', 'ja', 'en'].includes(config.uiLang) ? config.uiLang : null);
  const needsReading = (text, japanese, target) => {
    if (typeof text !== 'string' || !text || text.length > 1000) return false;
    const hasLatin = /[A-Za-z]/.test(text), hasHangul = /[가-힣]/.test(text);
    const hasJapanese = /[ぁ-ゖァ-ヺ]/.test(text) || (japanese && /[\u3400-\u9fff]/.test(text));
    return target === 'ko' ? hasLatin || hasJapanese : target === 'ja' ? hasLatin || hasHangul : hasHangul || hasJapanese;
  };
  const request = (texts, japanese, target) => {
    const key = JSON.stringify([target, japanese, texts]);
    if (inflight.has(key)) return inflight.get(key);
    const job = safeRuntimeSendMessage({ type: 'GET_KOREAN_PRONUNCIATION', payload: { texts, japanese, target } })
      .then(result => {
        if (!result?.success || !Array.isArray(result.lines) || result.lines.length !== texts.length) return;
        result.lines.forEach((reading, i) => {
          if (typeof reading === 'string' && reading) remember(`${target}:${japanese}:${texts[i]}`, { reading, segments: result.segments?.[i] || [] });
        });
      }).catch(() => {}).finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };

  const requestBatches = (texts, japanese, target, apply) => {
    for (let at = 0; at < texts.length; at += 80) {
      const batch = texts.slice(at, at + 80);
      void request(batch, japanese, target).then(() => { if (apply) batch.forEach(apply); });
    }
  };

  // Measure original text only after layout. One observer per document handles
  // resizing; playback never performs pronunciation conversion or measurement.
  const observers = new WeakMap();
  const observed = new Map();
  const syncWrap = (main, sub) => {
    const doc = main.ownerDocument;
    if (!doc?.createTreeWalker || !doc.createRange || !sub._ytmSegments?.length) return;
    const walker = doc.createTreeWalker(main, 4);
    const nodes = []; let node, offset = 0;
    while ((node = walker.nextNode())) { nodes.push({ node, start: offset, end: offset + node.data.length }); offset += node.data.length; }
    const range = doc.createRange(); let lastTop = null;
    const starts = [];
    for (const part of sub._ytmSegments) {
      if (!part.text.trim()) { starts.push(false); continue; }
      const entry = nodes.find(item => part.start >= item.start && part.start < item.end);
      if (!entry) { starts.push(false); continue; }
      const at = part.start - entry.start;
      range.setStart(entry.node, at); range.setEnd(entry.node, Math.min(at + 1, entry.node.data.length));
      const rect = range.getBoundingClientRect();
      if (!rect.height) { starts.push(false); continue; }
      starts.push(lastTop !== null && rect.top > lastTop + rect.height * 0.5);
      lastTop = rect.top;
    }
    sub.querySelectorAll('.lyric-pronunciation-break').forEach(br => br.remove());
    sub._ytmSegments.forEach((part, index) => {
      if (!starts[index]) return;
      const br = doc.createElement('br'); br.className = 'lyric-pronunciation-break';
      part.node.before(br);
    });
  };
  const observeWrap = (main, sub) => {
    const view = main.ownerDocument?.defaultView;
    if (!view?.requestAnimationFrame) return;
    const update = () => view.requestAnimationFrame(() => { if (main.isConnected && sub.isConnected) syncWrap(main, sub); });
    update();
    if (!view.ResizeObserver) return;
    let observer = observers.get(main.ownerDocument);
    if (!observer) {
      observer = new view.ResizeObserver(entries => entries.forEach(entry => entry.target._ytmReadingWrap?.()));
      observers.set(main.ownerDocument, observer);
    }
    main._ytmReadingWrap = update;
    observer.observe(main);
    observed.set(main, observer);
  };

  const decorateEntries = (entries, japanese) => {
    const target = currentTarget();
    if (!enabled || !target) return;
    for (const sub of subtitles) if (!sub.isConnected) subtitles.delete(sub);
    for (const [main, observer] of observed) {
      if (!main.isConnected) { observer.unobserve(main); observed.delete(main); }
    }
    const pending = new Map();
    for (const [host, raw] of entries) {
      const text = String(raw || '');
      if (!needsReading(text, japanese, target)) continue;
      const sub = host.ownerDocument.createElement('span');
      sub.className = 'lyric-pronunciation caption-2';
      sub.lang = target;
      sub.style.fontSize = `${fontSize}px`;
      subtitles.add(sub);
      host._ytmPronunciation = sub;
      sub.setAttribute('aria-label', target === 'ja' ? '発音' : target === 'en' ? 'Pronunciation' : '한글 발음');
      const main = host.querySelector('.lyric-main');
      if (main) main.after(sub); else host.appendChild(sub);
      const apply = () => {
        if (!enabled || currentTarget() !== target || !sub.isConnected) return;
        const value = cache.get(`${target}:${japanese}:${text}`);
        const reading = value?.reading || '';
        sub.textContent = '';
        sub._ytmSegments = [];
        if (reading && value.segments.length && main) {
          for (const part of value.segments) {
            const span = sub.ownerDocument.createElement('span');
            span.className = 'lyric-pronunciation-word';
            span.textContent = part.text;
            sub.appendChild(span);
            sub._ytmSegments.push({ ...part, node: span });
          }
        } else sub.textContent = reading;
        sub.hidden = !reading;
        if (reading && sub._ytmSegments.length && main) observeWrap(main, sub);
      };
      if (cache.has(`${target}:${japanese}:${text}`)) apply();
      else {
        if (!pending.has(text)) pending.set(text, []);
        pending.get(text).push(apply);
      }
    }
    // Bound message size and coalesce repeated chorus lines. The same batch in
    // the main window and PiP shares one in-flight request.
    requestBatches([...pending.keys()], japanese, target, text => {
      pending.get(text).forEach(apply => apply());
    });
  };

  const decorate = container => {
    if (!container || !enabled) return;
    // PiP may have copied already decorated rows.
    container.querySelectorAll('.lyric-pronunciation').forEach(node => node.remove());
    const entries = Array.from(container.querySelectorAll('.lyric-line')).map(row => [row, row.querySelector('.lyric-main')?.textContent || '']);
    const japanese = entries.some(([, text]) => /[ぁ-ゖァ-ヺ]/.test(text));
    decorateEntries(entries, japanese);
  };

  return {
    load: () => loaded || (loaded = Promise.all([storage.get(STORAGE_KEY), storage.get(SIZE_KEY)]).then(([value, size]) => { enabled = value !== false; fontSize = normalizeSize(size); }).catch(() => {})),
    getSize: () => fontSize,
    setSize: async value => {
      fontSize = normalizeSize(value);
      for (const sub of subtitles) {
        if (!sub.isConnected) subtitles.delete(sub);
        else sub.style.fontSize = `${fontSize}px`;
      }
      await storage.set(SIZE_KEY, fontSize);
    },
    paintTimed: (row, time, spans) => {
      const sub = row._ytmPronunciation;
      if (!sub || !sub.isConnected || !sub._ytmSegments?.length || !spans?.length) return false;
      const main = row.querySelector('.lyric-main');
      if (!main) return false;
      if (!sub._ytmTimeline || sub._ytmTimelineSpans !== spans) {
        const source = main.textContent || '';
        const points = []; let cursor = 0;
        for (const span of spans) {
          const text = span.textContent || '';
          const offset = source.indexOf(text, cursor);
          if (offset < 0) { sub._ytmTimeline = []; break; }
          const times = span._times || [Number(span.dataset?.time)];
          let at = 0, glyphIndex = 0;
          for (const ch of text) {
            const time = times[glyphIndex++] ?? times[0];
            points.push({ offset: offset + at, time: Number.isFinite(time) ? time : null, end: Number.isFinite(span._end) ? span._end : null });
            at += ch.length;
          }
          cursor = offset + text.length;
        }
        const timed = points.filter(point => Number.isFinite(point.time));
        sub._ytmTimeline = sub._ytmSegments.map(part => {
          const inside = timed.filter(point => point.offset >= part.start && point.offset < part.end);
          if (!inside.length) return null;
          const first = inside[0], last = inside[inside.length - 1];
          const next = timed.find(point => point.offset >= part.end && point.time > last.time);
          return { start: first.time, end: next?.time ?? last.end ?? last.time + 0.2 };
        });
        sub._ytmTimelineSpans = spans;
      }
      if (!sub._ytmTimeline?.some(Boolean)) return false;
      sub.classList.remove('lyric-pronunciation-sync');
      sub.classList.add('lyric-pronunciation-timed');
      sub._ytmSegments.forEach((part, i) => {
        const range = sub._ytmTimeline[i];
        if (!range) return;
        const progress = Math.round(Math.max(0, Math.min(1, (time - range.start) / Math.max(0.001, range.end - range.start))) * 100);
        if (part.progress !== progress) { part.progress = progress; part.node.style.setProperty('--pronunciation-progress', `${progress}%`); }
      });
      return true;
    },
    paint: (row, progress) => {
      const sub = row._ytmPronunciation;
      if (!sub || !sub.isConnected || !Number.isFinite(progress)) return;
      const value = Math.round(Math.max(0, Math.min(1, progress)) * 100);
      if (sub._ytmProgress === value) return;
      sub._ytmProgress = value;
      sub.classList.add('lyric-pronunciation-sync');
      sub.style.setProperty('--pronunciation-progress', `${value}%`);
    },
    isEnabled: () => enabled,
    setEnabled: async value => {
      enabled = !!value;
      if (!enabled) document.querySelectorAll('.lyric-pronunciation').forEach(node => node.remove());
      await storage.set(STORAGE_KEY, enabled);
    },
    decorate,
    decorateCue: (cue, text, japanese) => decorateEntries([[cue, text]], japanese),
    prepare: texts => {
      if (!enabled) return;
      const target = currentTarget();
      if (!target) return;
      const japanese = texts.some(text => /[ぁ-ゖァ-ヺ]/.test(text));
      const unique = [...new Set(texts.filter(text => needsReading(text, japanese, target) && !cache.has(`${target}:${japanese}:${text}`)))];
      requestBatches(unique, japanese, target);
    },
  };
})();
