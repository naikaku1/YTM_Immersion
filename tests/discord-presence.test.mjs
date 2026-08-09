import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const bridgeSource = fs.readFileSync(
  new URL('../src/js/module/discord-presence.js', import.meta.url),
  'utf8',
)

function createBridgeHarness() {
  const elementsById = new Map()
  const documentListeners = new Map()
  const mediaListeners = new Map()
  const intervals = []
  const animatedCues = []
  const activeRows = [{
    textContent: 'fallback row',
    querySelector: selector => (
      selector === '.lyric-main' ? { textContent: '  Current lyric line  ' } : null
    ),
  }]
  let dispatchedUpdates = 0
  let playbackLyric = 'Current lyric line'

  const media = {
    currentTime: 42.8,
    duration: 180,
    ended: false,
    paused: false,
    readyState: 4,
    addEventListener(name, listener) {
      mediaListeners.set(name, listener)
    },
    removeEventListener(name, listener) {
      if (mediaListeners.get(name) === listener)
        mediaListeners.delete(name)
    },
  }

  const document = {
    head: {
      appendChild(element) {
        elementsById.set(element.id, element)
      },
    },
    documentElement: {
      appendChild(element) {
        elementsById.set(element.id, element)
      },
    },
    createElement() {
      return {
        dataset: {},
        hidden: false,
        id: '',
        textContent: '',
        type: '',
        setAttribute() {},
      }
    },
    getElementById(id) {
      return elementsById.get(id) || null
    },
    addEventListener(name, listener) {
      documentListeners.set(name, listener)
    },
    querySelector(selector) {
      if (selector.includes('video'))
        return media
      if (selector === '.ad-interrupting, .ad-showing')
        return null
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('.ytm-animated-caption-cue'))
        return animatedCues
      if (selector.includes('.lyric-line.active'))
        return activeRows
      return []
    },
  }

  const context = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type
      }
    },
    Date,
    document,
    getCurrentVideoUrl: () => 'https://youtu.be/test-video-id',
    getMetadata: () => ({
      album: 'Test Album',
      artist: 'Test Artist',
      src: 'https://i.ytimg.com/vi/test/maxresdefault.jpg',
      title: 'Test Song',
    }),
    location: {
      href: 'https://music.youtube.com/watch?v=test-video-id',
    },
    navigator: {
      mediaSession: {
        metadata: null,
      },
    },
    setInterval(callback, delay) {
      intervals.push({ callback, delay })
      return intervals.length
    },
    YTMImmersionDiscordLyrics: {
      getCurrentPlaybackLyricText: () => playbackLyric,
    },
    URL,
  }
  context.window = {
    addEventListener(name, listener) {
      documentListeners.set(name, listener)
    },
    dispatchEvent(event) {
      if (event.type === 'ytm-immersion-presence-update')
        dispatchedUpdates += 1
    },
  }

  vm.runInNewContext(bridgeSource, context, {
    filename: 'discord-presence.js',
  })

  return {
    activeRows,
    animatedCues,
    get dispatchedUpdates() {
      return dispatchedUpdates
    },
    getSnapshot() {
      const bridge = elementsById.get('ytm-immersion-discord-presence')
      assert.ok(bridge, 'bridge element should be created')
      return JSON.parse(bridge.textContent)
    },
    intervals,
    media,
    mediaListeners,
    documentListeners,
    setPlaybackLyric(value) {
      playbackLyric = value
    },
  }
}

test('publishes track, artwork, lyric, timing, and playback state', () => {
  const harness = createBridgeHarness()
  const snapshot = harness.getSnapshot()

  assert.equal(snapshot.schema, 1)
  assert.equal(snapshot.source, 'ytm-immersion')
  assert.equal(snapshot.title, 'Test Song')
  assert.equal(snapshot.artist, 'Test Artist')
  assert.equal(snapshot.album, 'Test Album')
  assert.equal(snapshot.artwork, 'https://i.ytimg.com/vi/test/maxresdefault.jpg')
  assert.equal(snapshot.lyric, 'Current lyric line')
  assert.equal(snapshot.url, 'https://music.youtube.com/watch?v=test-video-id')
  assert.equal(snapshot.playbackState, 'playing')
  assert.equal(snapshot.currentTime, 42)
  assert.equal(snapshot.duration, 180)
  assert.equal(typeof snapshot.startedAt, 'number')
  assert.equal(typeof snapshot.endsAt, 'number')
  assert.equal(harness.intervals[0].delay, 250)
})

test('falls back to animated captions and switches to the pause state immediately', () => {
  const harness = createBridgeHarness()
  harness.setPlaybackLyric(null)
  harness.animatedCues.push(
    { textContent: 'Previous cue' },
    { textContent: 'Animated current cue' },
  )
  harness.media.paused = true
  harness.mediaListeners.get('pause')()

  const snapshot = harness.getSnapshot()
  assert.equal(snapshot.lyric, 'Animated current cue')
  assert.equal(snapshot.playbackState, 'paused')
  assert.equal(snapshot.startedAt, null)
  assert.equal(snapshot.endsAt, null)
  assert.equal(harness.dispatchedUpdates, 2)
})

test('updates from playback time while the highlighted DOM row is stale', () => {
  const harness = createBridgeHarness()
  harness.setPlaybackLyric('Later lyric from media clock')
  harness.media.currentTime = 58.4
  harness.mediaListeners.get('timeupdate')()

  const snapshot = harness.getSnapshot()
  assert.equal(snapshot.lyric, 'Later lyric from media clock')
  assert.equal(snapshot.currentTime, 58)
  assert.equal(harness.activeRows[0].querySelector('.lyric-main').textContent.trim(), 'Current lyric line')
})

test('keeps an intentional timed-caption gap empty instead of reviving stale DOM', () => {
  const harness = createBridgeHarness()
  harness.setPlaybackLyric('')
  harness.media.currentTime = 60
  harness.mediaListeners.get('seeking')()

  assert.equal(harness.getSnapshot().lyric, '')
})

test('resynchronizes immediately when the page becomes visible again', () => {
  const harness = createBridgeHarness()
  harness.setPlaybackLyric('Lyric after resume')
  harness.documentListeners.get('visibilitychange')()

  assert.equal(harness.getSnapshot().lyric, 'Lyric after resume')
})

test('does not dispatch a duplicate update when the snapshot is unchanged', () => {
  const harness = createBridgeHarness()
  assert.equal(harness.dispatchedUpdates, 1)

  harness.intervals[0].callback()

  assert.equal(harness.dispatchedUpdates, 1)
})
