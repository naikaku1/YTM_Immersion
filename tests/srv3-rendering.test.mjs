import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const styleSource = fs.readFileSync(
  new URL('../src/css/style.css', import.meta.url),
  'utf8',
)
const pipManagerSource = fs.readFileSync(
  new URL('../src/js/module/pip-manager.js', import.meta.url),
  'utf8',
)
const suppliedSrv3Fixture = fs.readFileSync(
  new URL('./fixtures/srv3-animated.xml', import.meta.url),
  'utf8',
)

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(start, -1, `missing marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing marker: ${endMarker}`)
  return source.slice(start, end)
}

test('adjacent srv3 p frames switch exactly at their boundary without 40ms overlap', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const getActiveTimedTextEvents',
    'const parseTimedTextAnimation',
  )
  const context = {}
  vm.runInNewContext(
    `${helperSource}\nglobalThis.activeAt = getActiveTimedTextEvents;`,
    context,
    { filename: 'srv3-active-frames.js' },
  )

  // Extracted from the supplied srv3 pattern: two simultaneous windows move
  // to the next pair every 66/67ms.
  const events = [
    { id: 8, startMs: 39223, endMs: 39289 },
    { id: 9, startMs: 39223, endMs: 39289 },
    { id: 10, startMs: 39289, endMs: 39356 },
    { id: 11, startMs: 39289, endMs: 39356 },
  ]
  const idsAt = time => Array.from(context.activeAt(events, time), event => event.id)

  assert.deepEqual(idsAt(39222), [])
  assert.deepEqual(idsAt(39223), [8, 9])
  assert.deepEqual(idsAt(39288), [8, 9])
  assert.deepEqual(idsAt(39289), [10, 11])
  assert.deepEqual(idsAt(39356), [])
})

test('a paragraph pen is not applied again to its child span', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const shouldApplyTimedTextSegmentPen',
    'const getTimedTextSegmentHtml',
  )
  const context = {}
  vm.runInNewContext(
    `${helperSource}\nglobalThis.shouldApply = shouldApplyTimedTextSegmentPen;`,
    context,
    { filename: 'srv3-segment-pen.js' },
  )

  assert.equal(context.shouldApply({ penId: '15' }, { penId: '15' }), false)
  assert.equal(context.shouldApply({ penId: '16' }, { penId: '15' }), true)
  assert.equal(context.shouldApply({ penId: '' }, { penId: '' }), false)
})

test('transparent fills stay out of playback text unless their srv3 edge is visible', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const getTimedTextPenOpacity',
    'const buildTimedTextPlainLines',
  )
  const context = {
    normalizeTimedTextCaption(value) {
      return String(value || '').replace(/[\u200B\uFEFF]/g, '').trim()
    },
  }
  vm.runInNewContext(
    `${helperSource}\nglobalThis.visibleText = getTimedTextVisibleText;`,
    context,
    { filename: 'srv3-visible-text.js' },
  )

  const pens = new Map([
    ['2', { fo: '254' }],
    ['4', { fo: '0' }],
    ['30', { fo: '0', fc: '#000000', ec: '#FFFFFF', et: '3' }],
  ])
  const segments = [
    { text: 'visible', penId: '2' },
    { text: 'hidden future line', penId: '4' },
    { text: 'outlined', penId: '30' },
  ]
  assert.equal(context.visibleText(segments, '', {}, pens), 'visibleoutlined')
})

test('srv3 fo controls foreground alpha without hiding an outline-only cue', () => {
  const visibilitySource = sourceBetween(
    lyricsUiSource,
    'const getTimedTextPenOpacity',
    'const getTimedTextVisibleText',
  )
  const colorSource = sourceBetween(
    lyricsUiSource,
    'const getTimedTextForegroundColor',
    'const getAnimatedCaptionFontScale',
  )
  const context = {}
  vm.runInNewContext(
    `${visibilitySource}\n${colorSource}\n` +
      'globalThis.foreground = getTimedTextForegroundColor;' +
      'globalThis.shadow = getTimedTextShadow;',
    context,
    { filename: 'srv3-pen-alpha.js' },
  )

  assert.equal(context.foreground({ fc: '#FEFEFE', fo: '127' }), 'rgba(254,254,254,0.500)')
  assert.equal(context.foreground({ fc: '#000000', fo: '0', ec: '#FFFFFF', et: '3' }), 'rgba(0,0,0,0.000)')
  assert.match(context.shadow({ fo: '0', ec: '#FFFFFF', et: '3' }), /#FFFFFF/)
  assert.equal(context.shadow({ fo: '0', et: '0' }), 'none')
})

test('progressive srv3 snapshots retain the first semantic start time', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const buildTimedTextPlainLines',
    '// srv3 の短い <p>',
  )
  const context = {
    normalizeTimedTextCaption(value) { return String(value || '').trim() },
  }
  vm.runInNewContext(
    `${helperSource}\nglobalThis.buildLines = buildTimedTextPlainLines;`,
    context,
    { filename: 'srv3-progressive-lines.js' },
  )

  const lines = JSON.parse(JSON.stringify(context.buildLines([
    { time: 35.619, endTime: 36.553, visibleText: '嗚呼' },
    { time: 36.553, endTime: 36.820, visibleText: '嗚呼 何' },
    { time: 36.820, endTime: 37.087, visibleText: '嗚呼 何も' },
  ])))
  assert.deepEqual(lines, [{ time: 35.619, text: '嗚呼 何も' }])
})

test('srv3 justification values map to left, right, and center', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const getTimedTextAlign',
    'const getTimedTextScaledFontSize',
  )
  const context = {}
  vm.runInNewContext(
    `${helperSource}\nglobalThis.align = getTimedTextAlign;`,
    context,
    { filename: 'srv3-justification.js' },
  )

  assert.equal(context.align({ ju: '0' }), 'left')
  assert.equal(context.align({ ju: '1' }), 'right')
  assert.equal(context.align({ ju: '2' }), 'center')
})

test('srv3 cues preserve explicit newlines and do not override frame opacity or position', () => {
  const cueRule = styleSource.match(/\.ytm-animated-caption-cue\s*\{[^}]*\}/)?.[0] || ''
  assert.ok(cueRule, 'srv3 cue CSS should be present')
  assert.match(cueRule, /white-space:\s*pre\s*;/)
  assert.doesNotMatch(cueRule, /animation\s*:/)
  assert.doesNotMatch(styleSource, /@keyframes\s+ytm-caption-pop/)

  const pipCueRule = pipManagerSource.match(/body\.ytm-animated-caption-mode \.ytm-animated-caption-cue\s*\{[^}]*\}/)?.[0] || ''
  assert.ok(pipCueRule, 'PiP must define the srv3 cue box independently of the main document')
  assert.match(pipCueRule, /position:\s*absolute\s*;/)
  assert.match(pipCueRule, /white-space:\s*pre\s*;/)
  assert.doesNotMatch(pipCueRule, /animation\s*:/)

  const stageUpdate = sourceBetween(
    lyricsUiSource,
    'function updateAnimatedCaptionStage',
    'function setupMovieMode',
  )
  assert.match(stageUpdate, /getActiveTimedTextEvents\(animatedCaptionData\.events, tMs\)/)
})

test('the supplied animated srv3 fixture and its short frames stay in the regression suite', () => {
  assert.match(suppliedSrv3Fixture, /^<\?xml version="1\.0" encoding="utf-8" \?>\s*<timedtext format="3">/)
  assert.equal((suppliedSrv3Fixture.match(/<pen\b/g) || []).length, 51)
  assert.equal((suppliedSrv3Fixture.match(/<wp\b/g) || []).length, 108)
  assert.equal((suppliedSrv3Fixture.match(/<ws\b/g) || []).length, 3)
  assert.equal((suppliedSrv3Fixture.match(/<p\b/g) || []).length, 308)
  assert.match(suppliedSrv3Fixture, /<p t="39723" d="34"/)
  assert.match(suppliedSrv3Fixture, /<p t="84535" d="33"/)

  const parserSource = sourceBetween(
    lyricsUiSource,
    'const parseTimedTextAnimation',
    'const getTimedTextAnchorTransform',
  )
  assert.match(parserSource, /const frameDurationMs = durationMs > 0 \? durationMs : 60/)
  assert.doesNotMatch(parserSource, /Math\.max\(60,\s*durationMs/)
})

test('persistent cues keep their DOM identity while adjacent srv3 frames change', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const syncTimedTextStage',
    'function renderAnimatedTimedText',
  )
  const context = {
    document: null,
    getTimedTextCueStyle(event) { return `left:${event.id}px` },
    getTimedTextSegmentHtml(event) { return event.text },
  }
  vm.runInNewContext(
    `${helperSource}\nglobalThis.syncStage = syncTimedTextStage;`,
    context,
    { filename: 'srv3-keyed-stage.js' },
  )

  const stage = {
    children: [],
    ownerDocument: {
      createElement() {
        const node = {
          className: '',
          dataset: {},
          style: { cssText: '' },
          innerHTML: '',
          remove() {
            const index = stage.children.indexOf(node)
            if (index >= 0) stage.children.splice(index, 1)
          },
        }
        return node
      },
    },
    appendChild(node) {
      const previousIndex = this.children.indexOf(node)
      if (previousIndex >= 0) this.children.splice(previousIndex, 1)
      this.children.push(node)
    },
  }

  context.syncStage(stage, [
    { id: 1, text: 'long cue' },
    { id: 2, text: 'short frame A' },
  ])
  const persistentCue = stage.children.find(node => node.dataset.srv3EventId === '1')

  context.syncStage(stage, [
    { id: 1, text: 'long cue' },
    { id: 3, text: 'short frame B' },
  ])
  assert.strictEqual(
    stage.children.find(node => node.dataset.srv3EventId === '1'),
    persistentCue,
  )
  assert.deepEqual(stage.children.map(node => node.dataset.srv3EventId), ['1', '3'])
})

test('singer metadata that arrives before srv3 rendering cannot select canonical LRC', async () => {
  const applySource = sourceBetween(
    lyricsUiSource,
    'async function applyLyricsText',
    '// ===================== 歌詞候補・ロック関連',
  )
  const context = {}
  vm.runInNewContext(`
    let currentKey = 'Song///Artist';
    let currentLyricsVideoId = 'video-1';
    let lyricsApplyEpoch = 0;
    let lastRawLyricsText = '';
    let dynamicLines = null;
    let duetSubDynamicLines = null;
    let lyricsData = [];
    let currentSingerCanonicalLyrics = '[00:01.00]animated line';
    let currentSingerMetadata = { line_singers: [2] };
    let meaningPanelVisible = false;
    const config = { useAnimatedCaptions: true };
    const parsedTimedText = {
      plainLines: [{ time: 1, text: 'animated line' }],
      events: [{ id: 1, startMs: 1000, endMs: 1500 }],
    };
    let animatedRenderCount = 0;
    let ordinaryRenderCount = 0;
    function parseTimedTextAnimation() { return parsedTimedText; }
    function hasCharacterSyncedLines() { return false; }
    function parseLRCInternal() {
      return { lines: [{ time: 1, text: 'animated line', source_index: 0 }] };
    }
    function applySingerMetadataToLines(lines) {
      return lines.map(line => ({ ...line, singerNumber: 2 }));
    }
    function renderAnimatedTimedText() { animatedRenderCount += 1; }
    function renderLyrics() { ordinaryRenderCount += 1; }
    function emphasizeSummaryButtonAfterLyricsLoad() {}
    function refreshMeaningUi() {}
    function syncMeaningPanelToPlayback() {}
    ${applySource}
    globalThis.applySrv3 = applyLyricsText;
    globalThis.readState = () => ({
      animatedRenderCount,
      ordinaryRenderCount,
      singerNumber: lyricsData[0]?.singerNumber,
      rawPreserved: lastRawLyricsText.startsWith('<timedtext'),
    });
  `, context, { filename: 'srv3-early-singer-metadata.js' })

  await context.applySrv3('<timedtext format="3"><body><p t="1000" d="500">animated line</p></body></timedtext>')
  assert.deepEqual(
    { ...context.readState() },
    {
      animatedRenderCount: 1,
      ordinaryRenderCount: 0,
      singerNumber: 2,
      rawPreserved: true,
    },
  )
})

test('late singer metadata keeps the active srv3 stage instead of restoring canonical LRC', async () => {
  const refreshSource = sourceBetween(
    lyricsUiSource,
    'const refreshRenderedSingerMetadata',
    'const requestSingerMetadataForLyrics',
  )
  const applySource = sourceBetween(
    lyricsUiSource,
    'async function applyLyricsText',
    '// ===================== 歌詞候補・ロック関連',
  )
  assert.doesNotMatch(applySource, /return applyLyricsText\(canonicalLyrics\)/)
  assert.match(applySource, /timedTextData\.plainLines\s*=\s*lyricsData/)

  const context = {
    document: {
      body: {
        classList: {
          contains(name) { return name === 'ytm-animated-caption-mode' },
        },
      },
    },
    parseLRCInternal() {
      return { lines: [{ time: 1, text: 'animated line', source_index: 0 }] }
    },
    applySingerMetadataToLines(lines) {
      return lines.map(line => ({ ...line, singerNumber: 2, singerColor: '#6699FF' }))
    },
  }
  vm.runInNewContext(`
    let currentSingerCanonicalLyrics = '[00:01.00]animated line';
    let lastRawLyricsText = '<timedtext format="3"><body><p t="1000" d="500">animated line</p></body></timedtext>';
    let currentSingerMetadata = { line_singers: [2] };
    let lyricsData = [{ time: 1, text: 'animated line' }];
    let animatedCaptionData = { plainLines: lyricsData, events: [{ id: 1 }] };
    let regularRenderCount = 0;
    function renderLyrics() { regularRenderCount += 1; }
    ${refreshSource}
    globalThis.refreshSinger = refreshRenderedSingerMetadata;
    globalThis.readState = () => ({
      regularRenderCount,
      singerNumber: lyricsData[0]?.singerNumber,
      sameAnimatedObject: animatedCaptionData.plainLines === lyricsData,
      stillAnimated: !!animatedCaptionData,
    });
  `, context, { filename: 'srv3-late-singer-metadata.js' })

  await context.refreshSinger()
  assert.deepEqual(
    { ...context.readState() },
    {
      regularRenderCount: 0,
      singerNumber: 2,
      sameAnimatedObject: true,
      stillAnimated: true,
    },
  )
})

test('singer metadata still re-renders ordinary LRC when no srv3 stage is active', async () => {
  const refreshSource = sourceBetween(
    lyricsUiSource,
    'const refreshRenderedSingerMetadata',
    'const requestSingerMetadataForLyrics',
  )
  const context = {
    document: {
      body: { classList: { contains() { return false } } },
    },
    parseLRCInternal() {
      return { lines: [{ time: 1, text: 'regular line', source_index: 0 }] }
    },
    applySingerMetadataToLines(lines) {
      return lines.map(line => ({ ...line, singerNumber: 2 }))
    },
  }
  vm.runInNewContext(`
    let currentSingerCanonicalLyrics = '[00:01.00]regular line';
    let lastRawLyricsText = '[00:01.00]regular line';
    let currentSingerMetadata = { line_singers: [2] };
    let lyricsData = [{ time: 1, text: 'regular line' }];
    let animatedCaptionData = null;
    let regularRenderCount = 0;
    function renderLyrics() { regularRenderCount += 1; }
    ${refreshSource}
    globalThis.refreshSinger = refreshRenderedSingerMetadata;
    globalThis.readState = () => ({ regularRenderCount, singerNumber: lyricsData[0]?.singerNumber });
  `, context, { filename: 'regular-lrc-late-singer-metadata.js' })

  await context.refreshSinger()
  assert.deepEqual(
    { ...context.readState() },
    { regularRenderCount: 1, singerNumber: 2 },
  )
})
