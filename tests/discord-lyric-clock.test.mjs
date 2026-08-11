import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const resolverMatch = lyricsUiSource.match(
  /const getCurrentPlaybackLyricText = \(\) => \{[\s\S]*?\n\};\n\nconst getCurrentRenderedLyricText/,
)

assert.ok(resolverMatch, 'playback-clock lyric resolver should be present')
const resolverSource = resolverMatch[0].replace(/\n\nconst getCurrentRenderedLyricText$/, '')

function createResolverHarness({
  animatedCaptionData = null,
  currentKey = 'Test Song///Test Artist',
  currentTime = 0,
  dynamicLines = null,
  hasTimestamp = true,
  lyricsData = [],
  useAnimatedCaptions = false,
} = {}) {
  const context = {
    DUET_DUPLICATE_TOLERANCE: 1,
    animatedCaptionData,
    config: { useAnimatedCaptions },
    currentKey,
    currentTime,
    dynamicLines,
    hasTimestamp,
    lyricsData,
    getCurrentPlaybackTimeSec() {
      return context.currentTime
    },
    getMetadata() {
      return { title: 'Test Song', artist: 'Test Artist' }
    },
    isLineDynamicallyActiveAtTime(line, time) {
      return Number.isFinite(line?._dynamicRenderStartSec) &&
        Number.isFinite(line?._dynamicRenderEndSec) &&
        time >= line._dynamicRenderStartSec &&
        time <= line._dynamicRenderEndSec
    },
    isSameTimestamp(a, b, tolerance = 0.05) {
      return typeof a === 'number' &&
        typeof b === 'number' &&
        Math.abs(a - b) <= tolerance
    },
    normalizeLyricCompareTextStrict(value) {
      return String(value || '').replace(/\s+/g, '').toLowerCase()
    },
    scoreLyricTextMatch(a, b) {
      return a === b ? 100 : 0
    },
  }

  vm.runInNewContext(
    `${resolverSource}\nglobalThis.resolveCurrentLyric = getCurrentPlaybackLyricText`,
    context,
    { filename: 'getCurrentPlaybackLyricText.js' },
  )
  return context
}

test('resolves regular timed lyrics directly from media time without rAF state', () => {
  const harness = createResolverHarness({
    currentTime: 12,
    lyricsData: [
      { time: 0, text: 'First line' },
      { time: 10, text: 'Second line' },
      { time: 20, text: 'Third line' },
    ],
  })

  assert.equal(harness.resolveCurrentLyric(), 'Second line')
  harness.currentTime = 22
  assert.equal(harness.resolveCurrentLyric(), 'Third line')
})

test('combines simultaneous lyric rows and includes active dynamic ranges', () => {
  const harness = createResolverHarness({
    currentTime: 10.5,
    lyricsData: [
      { time: 5, text: 'Dynamic harmony', _dynamicRenderStartSec: 10, _dynamicRenderEndSec: 12 },
      { time: 10, text: 'Left vocal', duetSide: 'left' },
      { time: 10, text: 'Right vocal', duetSide: 'right' },
    ],
  })

  assert.equal(
    harness.resolveCurrentLyric(),
    'Dynamic harmony / Left vocal / Right vocal',
  )
})

test('distinguishes animated-caption gaps from unavailable timed data', () => {
  const animated = createResolverHarness({
    animatedCaptionData: {
      events: [{ startMs: 1000, endMs: 2000, text: 'Animated line' }],
    },
    currentTime: 1.5,
    useAnimatedCaptions: true,
  })
  assert.equal(animated.resolveCurrentLyric(), 'Animated line')

  animated.currentTime = 3
  assert.equal(animated.resolveCurrentLyric(), '')

  const unavailable = createResolverHarness({
    currentTime: 3,
    hasTimestamp: false,
    lyricsData: [{ text: 'Untimed text' }],
  })
  assert.equal(unavailable.resolveCurrentLyric(), null)
})

test('clears old lyrics immediately when playback metadata changes tracks', () => {
  const harness = createResolverHarness({
    currentKey: 'Previous Song///Previous Artist',
    currentTime: 12,
    lyricsData: [{ time: 10, text: 'Old song lyric' }],
  })

  assert.equal(harness.resolveCurrentLyric(), '')
})

test('track-change observer has a background timer fallback for paused rAF', () => {
  const observerStart = lyricsUiSource.indexOf('const setupObserver = () => {')
  const observerSource = lyricsUiSource.slice(observerStart)
  const trackResetSource = lyricsUiSource.slice(
    lyricsUiSource.indexOf('currentKey = key;'),
    lyricsUiSource.indexOf('updateMetaUI(meta);'),
  )

  assert.notEqual(observerStart, -1)
  assert.match(observerSource, /const scheduleTick = \(\) => \{/)
  assert.match(observerSource, /document\.hidden \? 0 : 250/)
  assert.match(observerSource, /setTimeout\(\s*runScheduledTick/)
  assert.match(trackResetSource, /animatedCaptionData = null;/)
})
