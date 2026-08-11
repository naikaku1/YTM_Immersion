import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const backgroundSource = fs.readFileSync(
  new URL('../src/js/background.js', import.meta.url),
  'utf8',
).replace(/^import .*?;\r?$/gm, '')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(iterations = 80) {
  for (let index = 0; index < iterations; index += 1)
    await Promise.resolve()
}

function createBackgroundHarness({ api = {} } = {}) {
  const messageListeners = []
  const responses = []
  const sentMessages = []

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener)
        },
      },
    },
    storage: {
      local: {
        get() {},
        set() {},
      },
    },
    tabs: {
      sendMessage(tabId, message) {
        sentMessages.push({ tabId, message })
        return Promise.resolve()
      },
    },
  }

  const defaultApi = {
    extractVideoIdFromUrl: () => '',
    fetchFromLrcLib: async () => null,
    fetchFromLrchub: async () => null,
    fetchFromLrchubSearch: async () => null,
    withTimeout: promise => promise,
    delay: async () => undefined,
    normalizeLrchubMeaningPayload: () => null,
    normalizeLrchubTranslations: () => ({}),
  }

  const context = {
    API: { ...defaultApi, ...api },
    CloudSync: {
      CLOUD_STORAGE_KEY: 'test-cloud-state',
      DEFAULT_CLOUD_STATE: {},
    },
    chrome,
    console: {
      debug() {},
      error() {},
      log() {},
      warn() {},
    },
    fetch,
    self: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  }

  vm.runInNewContext(backgroundSource, context, {
    filename: 'src/js/background.js',
  })

  assert.equal(messageListeners.length, 1, 'background must register one message listener')

  return {
    responses,
    sentMessages,
    dispatch(payload) {
      const keepChannelOpen = messageListeners[0](
        { type: 'GET_LYRICS', payload },
        { tab: { id: 7 } },
        response => responses.push(response),
      )
      assert.equal(keepChannelOpen, true)
    },
  }
}

const requestPayload = {
  track: 'Race Song',
  artist: 'Test Artist',
  video_id: 'video-123',
  request_id: 'request-456',
  track_key: 'track-789',
  lyric_source_mode: 'standard',
  use_lrclib: true,
}

function assertRequestIdentity(payload) {
  assert.equal(payload.request_id, requestPayload.request_id)
  assert.equal(payload.track_key, requestPayload.track_key)
  assert.equal(payload.track, requestPayload.track)
  assert.equal(payload.artist, requestPayload.artist)
  assert.equal(payload.video_id, requestPayload.video_id)
}

test('standard mode responds once with LrcLib fallback, then pushes a late LRCHub replacement', async () => {
  const primaryHub = deferred()
  let hubFetchCount = 0

  const harness = createBackgroundHarness({
    api: {
      fetchFromLrcLib: async () => ({
        lyrics: '[00:01.00]fallback line',
        candidates: [],
      }),
      fetchFromLrchub: () => {
        hubFetchCount += 1
        return hubFetchCount === 1 ? primaryHub.promise : Promise.resolve(null)
      },
      fetchFromLrchubSearch: async () => null,
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].success, true)
  assert.equal(harness.responses[0].lyricsSource, 'lrclib')
  assert.equal(harness.responses[0].fallbackUsed, true)
  assert.equal(harness.responses[0].lyrics, '[00:01.00]fallback line')
  assertRequestIdentity(harness.responses[0])
  assert.equal(harness.sentMessages.length, 0)

  primaryHub.resolve({
    lyrics: '[00:01.00]hub line',
    dynamicLines: [{
      startTimeMs: 1000,
      chars: [{ c: 'H', t: 1000 }],
    }],
  })
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1, 'late Hub data must not call sendResponse again')
  assert.equal(harness.sentMessages.length, 1, 'late Hub data must emit exactly one update')
  const update = harness.sentMessages[0]
  assert.equal(update.tabId, 7)
  assert.equal(update.message.type, 'LYRICS_DATA_UPDATE')
  assert.equal(update.message.payload.lyricsSource, 'lrchub')
  assert.equal(update.message.payload.sourceLabel, 'LRCHub')
  assert.equal(update.message.payload.fallbackUsed, false)
  assert.equal(update.message.payload.lyricsQuality, 4)
  assert.equal(update.message.payload.dynamicLines[0].chars[0].c, 'H')
  assertRequestIdentity(update.message.payload)
})

test('a later character-synced Hub result upgrades an earlier line-synced Hub response', async () => {
  const searchHub = deferred()
  const neverResolve = () => new Promise(() => {})

  const harness = createBackgroundHarness({
    api: {
      delay: neverResolve,
      fetchFromLrchub: async () => ({
        lyrics: '[00:01.00]line synced',
        dynamicLines: [{ chars: [{ c: 'invalid', t: null }] }],
      }),
      fetchFromLrchubSearch: () => searchHub.promise,
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'lrchub')
  assert.equal(harness.responses[0].sourceLabel, 'LRCHub')
  assert.equal(harness.responses[0].lyricsQuality, 2)
  assert.equal(harness.responses[0].dynamicLines, null)
  assertRequestIdentity(harness.responses[0])
  assert.equal(harness.sentMessages.length, 0)

  searchHub.resolve({
    lyrics: '[00:01.00]character synced',
    dynamicLines: [{
      startTimeMs: 1000,
      chars: [
        { c: 'C', t: 1000 },
        { c: 'S', t: 1100 },
      ],
    }],
  })
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.sentMessages.length, 1)
  const updatePayload = harness.sentMessages[0].message.payload
  assert.equal(harness.sentMessages[0].message.type, 'LYRICS_DATA_UPDATE')
  assert.equal(updatePayload.sourceLabel, 'LRCHub search')
  assert.equal(updatePayload.lyricsQuality, 4)
  assert.equal(updatePayload.dynamicLines[0].chars.length, 2)
  assertRequestIdentity(updatePayload)
})

test('the initial Hub payload exposes provider_meta.record_id for singer lookup', async () => {
  const neverResolve = () => new Promise(() => {})
  const harness = createBackgroundHarness({
    api: {
      delay: neverResolve,
      fetchFromLrchub: async () => ({
        lyrics: '[00:01.00]duet line',
        provider_meta: { record_id: 'duet-song\nduet-artist' },
      }),
      fetchFromLrchubSearch: async () => null,
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].record_id, 'duet-song\nduet-artist')
  assert.equal(harness.responses[0].lyricsSource, 'lrchub')
})

test('standard mode reaches a failure response when LrcLib times out and Hub has no lyrics', async () => {
  const timeoutLabels = []
  const neverResolve = () => new Promise(() => {})

  const harness = createBackgroundHarness({
    api: {
      fetchFromLrcLib: neverResolve,
      fetchFromLrchub: async () => null,
      fetchFromLrchubSearch: async () => null,
      withTimeout(promise, _milliseconds, label) {
        timeoutLabels.push(label)
        if (label === 'lrclib')
          return Promise.reject(new Error('simulated LrcLib timeout'))
        return promise
      },
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.ok(timeoutLabels.includes('lrclib'))
  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].success, false)
  assert.equal(harness.responses[0].lyrics, '')
  assertRequestIdentity(harness.responses[0])
  assert.equal(harness.sentMessages.length, 0)
})

test('normalized timed translations override raw Hub translation fields', async () => {
  const neverResolve = () => new Promise(() => {})
  const harness = createBackgroundHarness({
    api: {
      delay: neverResolve,
      fetchFromLrchub: async () => ({
        lyrics: '[00:12.00]hub line',
        lrc_map: { ja: '[00:10.00]raw map' },
        translations: { ja: '[00:10.00]raw translation' },
        lrcMap: { ja: '[00:12.00]normalized translation' },
      }),
      normalizeLrchubTranslations: value => value || {},
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lrcMap.ja, '[00:12.00]normalized translation')
})
