import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { runBackground } from './background-harness.mjs'
// 取得元どうしの突き合わせは実物を使う
const RealAgreement = await import('../src/js/module/lyrics-agreement.js')

globalThis.chrome = globalThis.chrome || {
  storage: { local: { get: (keys, cb) => cb({}) } },
}
// background.js が api.js から受け取る素の道具。stub で潰すと、
// 実際には API 側にある実装が抜けたまま通ってしまう。
const RealAPI = await import('../src/js/module/api.js')

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

function createBackgroundHarness({ api = {}, disabledSources = [] } = {}) {
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
    hasCharacterSyncedLines: RealAPI.hasCharacterSyncedLines,
    getLrchubRecordId: RealAPI.getLrchubRecordId,
  }

  const context = {
    API: { ...defaultApi, ...api },
    // extra-providers.js。既定は「有効だが誰も持っていない」。
    Extra: {
      EXTRA_PROVIDERS_ENABLED: true,
      fetchFromAmll: async () => null,
      fetchFromNetease: async () => null,
      fetchFromKugou: async () => null,
      fetchFromLiriqo: async () => null,
    },
    // lyric-sources.js。既定は「標準の取得元は全部オン」。
    Sources: { loadDisabledSources: async () => new Set(disabledSources) },
    Agreement: RealAgreement,
    CloudSync: {
      CLOUD_STORAGE_KEY: 'test-cloud-state',
      DEFAULT_CLOUD_STATE: {},
    },
    chrome,
  }

  runBackground(context)

  assert.equal(messageListeners.length, 1, 'background must register one message listener')

  return {
    responses,
    sentMessages,
    // 表示中の歌詞を差し替える通知だけを数える。取得元をまたいだ候補の
    // 追加通知(LYRICS_META_UPDATE)は同じ chrome.tabs.sendMessage を通るが、
    // 歌詞には触れないので「差し替えが起きていないこと」の判定には入れない。
    get lyricsUpdates() {
      return sentMessages.filter(entry => entry.message?.type === 'LYRICS_DATA_UPDATE')
    },
    get candidateUpdates() {
      return sentMessages.filter(entry => entry.message?.type === 'LYRICS_META_UPDATE')
    },
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
  assert.equal(harness.lyricsUpdates.length, 0)

  primaryHub.resolve({
    lyrics: '[00:01.00]hub line',
    dynamicLines: [{
      startTimeMs: 1000,
      chars: [{ c: 'H', t: 1000 }],
    }],
  })
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1, 'late Hub data must not call sendResponse again')
  assert.equal(harness.lyricsUpdates.length, 1, 'late Hub data must emit exactly one update')
  const update = harness.lyricsUpdates[0]
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
        lyrics: '[00:01.00]same song first line\n[00:05.00]same song second line',
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
  assert.equal(harness.lyricsUpdates.length, 0)

  searchHub.resolve({
    lyrics: '[00:01.00]same song first line\n[00:05.00]same song second line',
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
  assert.equal(harness.lyricsUpdates.length, 1)
  const updatePayload = harness.lyricsUpdates[0].message.payload
  assert.equal(harness.lyricsUpdates[0].message.type, 'LYRICS_DATA_UPDATE')
  assert.equal(updatePayload.sourceLabel, 'LRCHub search')
  assert.equal(updatePayload.lyricsQuality, 4)
  assert.equal(updatePayload.dynamicLines[0].chars.length, 2)
  assertRequestIdentity(updatePayload)
})

test('a later srv3 result upgrades an earlier DynamicLRC response', async () => {
  const searchHub = deferred()
  const neverResolve = () => new Promise(() => {})

  const harness = createBackgroundHarness({
    api: {
      delay: neverResolve,
      fetchFromLrchub: async () => ({
        lyrics: '[00:01.00]same song first line\n[00:05.00]same song second line',
        dynamicLines: [{
          startTimeMs: 1000,
          chars: [{ c: 'D', t: 1000 }],
        }],
      }),
      fetchFromLrchubSearch: () => searchHub.promise,
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsQuality, 4)
  // 取得元をまたいだ候補提示(LYRICS_META_UPDATE)も同じ経路で飛ぶので、
  // 歌詞の差し替え(LYRICS_DATA_UPDATE)だけを数える。
  assert.equal(harness.lyricsUpdates.length, 0)

  const srv3 = '<timedtext format="3"><body><p t="1000" d="500">animated</p></body></timedtext>'
  searchHub.resolve({
    lyrics: '[00:01.00]same song first line\n[00:05.00]same song second line',
    animated_lyrics: srv3,
  })
  await flushMicrotasks()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.lyricsUpdates.length, 1)
  const updatePayload = harness.lyricsUpdates[0].message.payload
  assert.equal(updatePayload.lyricsQuality, 5)
  assert.equal(updatePayload.animated_lyrics, srv3)
  assert.equal(updatePayload.sourceLabel, 'LRCHub search')
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

// 設定の「歌詞ソース」タブでオフにした標準の取得元は、どの経路からも叩かない
test('オフにした LRCHub と LrcLib には問い合わせず、残りの取得元で歌詞を出す', async () => {
  const called = []
  const harness = createBackgroundHarness({
    disabledSources: ['lrchub', 'lrclib'],
    api: {
      fetchFromLrchub: async () => { called.push('lrchub'); return { lyrics: '[00:01.00]hub' } },
      fetchFromLrchubSearch: async () => { called.push('lrchub search'); return null },
      fetchFromLrcLib: async () => { called.push('lrclib'); return { lyrics: '[00:01.00]lrclib' } },
      fetchFromSimpMusic: async () => ({ lyrics: '[00:01.00]simp line' }),
    },
  })

  harness.dispatch(requestPayload)
  await flushMicrotasks(200)

  assert.deepEqual(called, [])
  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'simpmusic')
  assert.equal(harness.responses[0].lyrics, '[00:01.00]simp line')
})

// LRCHub には動画 ID で引く本来の経路(手動登録はここ)と、曲名で探す検索がある。
// 混んで本来の経路が遅れた回に検索が別の曲を当て、後から本来の経路が正しい
// 歌詞を返しても、品質が同じなので替えずに外れを出し続けていた
// (星野源のライブ映像で Superorganism「Into The Sun」の歌詞が出た)
const RIGHT_SONG = '[00:18.82]目が覚めて涎を拭いたら\n[00:24.16]窓辺に光が微笑んでた\n[00:30.00]家族の歌'
const OTHER_SONG = "[00:00.00](Where are we? Where are we?)\n[00:17.47]Don't mind me, I'm just a fruit fly\n[00:26.31]And I can't even look you in the eye"

test('曲名検索で出した歌詞は、動画 ID で引いた中身の違う歌詞が届いたら訂正として替える', async () => {
  const primaryHub = deferred()
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: () => primaryHub.promise,
      fetchFromLrchubSearch: async () => ({ lyrics: OTHER_SONG }),
    },
  })
  harness.dispatch(requestPayload)
  // 本来の経路は 1.5 秒待っても答えない → 検索が先に出る
  for (let i = 0; i < 40 && !harness.responses.length; i++) await new Promise(r => setTimeout(r, 100))
  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].sourceLabel, 'LRCHub search')
  assert.match(harness.responses[0].lyrics, /fruit fly/)

  primaryHub.resolve({ lyrics: RIGHT_SONG })
  await flushMicrotasks()
  const updates = harness.lyricsUpdates.map(u => u.message.payload)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].sourceLabel, 'LRCHub')
  assert.match(updates[0].lyrics, /涎を拭いたら/)
  // 品質が同じ(行同期どうし)なので、UI が受けるよう訂正として送る
  assert.equal(updates[0].correction, true)
  assert.equal(updates[0].replaces, 'lrchub')
})

test('動画 ID で引いた歌詞は、中身の違う曲名検索の結果で上書きしない(品質が高くても)', async () => {
  const searchHub = deferred()
  const neverResolve = () => new Promise(() => {})
  const harness = createBackgroundHarness({
    api: {
      delay: neverResolve,
      fetchFromLrchub: async () => ({ lyrics: RIGHT_SONG }),
      fetchFromLrchubSearch: () => searchHub.promise,
    },
  })
  harness.dispatch(requestPayload)
  await flushMicrotasks()
  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].sourceLabel, 'LRCHub')

  searchHub.resolve({
    lyrics: OTHER_SONG,
    dynamicLines: [{ startTimeMs: 0, chars: [{ c: 'W', t: 0 }, { c: 'h', t: 100 }] }],
  })
  await flushMicrotasks()
  assert.equal(harness.lyricsUpdates.length, 0)
})

test('UI: 曲名検索でキャッシュした歌詞は、動画 ID で引けた中身の違う歌詞で替える', () => {
  const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
  // キャッシュに経路を残す(最初の取得と、後から届いた差し替えの両方)
  assert.match(ui, /lyricsSource: res\.lyricsSource \|\| null,\s*sourceLabel: res\.sourceLabel \|\| null,/)
  assert.match(ui, /lyricsSource: lateSource,\s*sourceLabel: payload\.sourceLabel \|\| null,/)
  assert.match(ui, /const cachedFromTitleSearch = cachedSourceLabel === 'LRCHub search';/)
  assert.match(ui, /\(res\?\.agreement === 'confirmed' \|\| \(responseFromVideo && cachedFromTitleSearch\)\)/)
})
