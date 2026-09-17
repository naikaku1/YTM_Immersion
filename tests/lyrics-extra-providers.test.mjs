import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import * as API from '../src/js/module/api.js'

// ── SimpMusic ────────────────────────────────────────────────

test('pickBestSimpMusicEntry prefers rich sync over a better-voted line-only entry', () => {
  const best = API.pickBestSimpMusicEntry([
    { syncedLyrics: '[00:01.00] line only', vote: '9' },
    { richSyncLyrics: '[00:01.00] <00:01.00>word', vote: '0' },
  ])
  assert.equal(best.vote, '0')
  assert.ok(best.richSyncLyrics)
})

test('pickBestSimpMusicEntry uses votes only to break ties within the same sync level', () => {
  const best = API.pickBestSimpMusicEntry([
    { syncedLyrics: '[00:01.00] low', vote: '-2' },
    { syncedLyrics: '[00:01.00] high', vote: '5' },
  ])
  assert.match(best.syncedLyrics, /high/)
})

test('pickBestSimpMusicEntry ignores entries with no lyrics at all', () => {
  assert.equal(API.pickBestSimpMusicEntry([{ plainLyric: '   ', vote: '9' }]), null)
  assert.equal(API.pickBestSimpMusicEntry([]), null)
})

test('convertSimpMusicEntry turns rich sync into word-level dynamic lines', () => {
  const converted = API.convertSimpMusicEntry({
    richSyncLyrics: "[00:27.39] <00:27.39>I&#x27;ve <00:27.74>been\n[00:30.18] <00:30.18>on <00:30.64>my",
  })

  // 行頭のタイムタグは formatLrcTime の丸めで最大 10ms 早くなる(既存挙動)。
  // 正確な時刻は dynamicLines 側の ms が持つので、ここでは形だけ確かめる。
  assert.match(converted.lyrics, /^\[00:27\.39\] I've been\n\[00:30\.1\d\] on my$/)
  assert.equal(converted.dynamicLines.length, 2)
  // HTML エンティティが本文に残っていないこと
  assert.ok(!converted.lyrics.includes('&#x27;'))
  // 文字単位まで展開され、時刻が単調増加していること
  const times = converted.dynamicLines[0].chars.map(ch => ch.t)
  assert.ok(times.length > 5)
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  assert.equal(converted.dynamicLines[0].chars[0].c, 'I')
})

test('convertSimpMusicEntry falls back to synced then plain lyrics', () => {
  assert.equal(
    API.convertSimpMusicEntry({ syncedLyrics: '[00:01.00] synced' }).lyrics,
    '[00:01.00] synced',
  )
  assert.equal(API.convertSimpMusicEntry({ syncedLyrics: '[00:01.00] synced' }).dynamicLines, null)
  assert.equal(API.convertSimpMusicEntry({ plainLyric: 'plain' }).lyrics, 'plain')
  assert.equal(API.convertSimpMusicEntry({ plainLyric: '  ' }), null)
  assert.equal(API.convertSimpMusicEntry(null), null)
})

test('fetchFromSimpMusic does nothing without a video id', async () => {
  assert.equal(await API.fetchFromSimpMusic({}), null)
  assert.equal(await API.fetchFromSimpMusic({ video_id: '  ' }), null)
})

// ── LyricsPlus ───────────────────────────────────────────────

test('convertLyricsPlusResponse maps syllables onto dynamic lines', () => {
  const converted = API.convertLyricsPlusResponse({
    type: 'Word',
    lyrics: [
      {
        time: 32873,
        text: 'Maybe you',
        syllabus: [
          { time: 32873, duration: 473, text: 'Maybe ' },
          { time: 33346, duration: 167, text: 'you' },
        ],
      },
    ],
  })

  assert.equal(converted.lyrics, '[00:32.87] Maybe you')
  assert.deepEqual(converted.dynamicLines[0].chars, [
    { t: 32873, c: 'Maybe ' },
    { t: 33346, c: 'you' },
  ])
  assert.equal(converted.dynamicLines[0].startTimeMs, 32873)
})

test('convertLyricsPlusResponse drops dynamic lines when no syllable timing exists', () => {
  const converted = API.convertLyricsPlusResponse({
    type: 'Line',
    lyrics: [
      { time: 1000, text: 'first' },
      { time: 2000, text: 'second', syllabus: [] },
    ],
  })

  assert.equal(converted.lyrics, '[00:01.00] first\n[00:02.00] second')
  assert.equal(converted.dynamicLines, null)
})

test('convertLyricsPlusResponse rejects empty or error-shaped payloads', () => {
  assert.equal(API.convertLyricsPlusResponse({ lyrics: [] }), null)
  assert.equal(API.convertLyricsPlusResponse({}), null)
  assert.equal(API.convertLyricsPlusResponse({ lyrics: [{ text: 'no time' }] }), null)
})

test('fetchFromLyricsPlus needs both a title and an artist', async () => {
  assert.equal(await API.fetchFromLyricsPlus({ track: 'x' }), null)
  assert.equal(await API.fetchFromLyricsPlus({ artist: 'y' }), null)
})

// ── background の勝ち抜け順序 ────────────────────────────────

const backgroundSource = fs.readFileSync(
  new URL('../src/js/background.js', import.meta.url),
  'utf8',
).replace(/^import .*?;\r?$/gm, '')

function createBackgroundHarness({ api = {} } = {}) {
  const messageListeners = []
  const responses = []
  const sentMessages = []

  const chrome = {
    runtime: { lastError: null, onInstalled: { addListener() {} }, onMessage: { addListener(l) { messageListeners.push(l) } } },
    storage: { local: { get() {}, set() {} } },
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
    fetchFromSimpMusic: async () => null,
    fetchFromLyricsPlus: async () => null,
    withTimeout: promise => promise,
    // 猶予待ちを 0 に潰すと「先に返した方が勝つ」がマイクロタスクの
    // 並び順だけで決まってしまい、実際の挙動を試せない。
    // 実時間は使うが、テストが遅くならないよう上限を切る。
    delay: ms => new Promise(resolve => setTimeout(resolve, Math.min(Number(ms) || 0, 10))),
    normalizeLrchubMeaningPayload: () => null,
    normalizeLrchubTranslations: () => ({}),
    // background.js が api.js から受け取る素の道具。stub で潰すと、
    // 実際には API 側にある実装が抜けたまま通ってしまう。
    hasCharacterSyncedLines: API.hasCharacterSyncedLines,
    getLrchubRecordId: API.getLrchubRecordId,
  }

  vm.runInNewContext(backgroundSource, {
    API: { ...defaultApi, ...api },
    CloudSync: { CLOUD_STORAGE_KEY: 'test-cloud-state', DEFAULT_CLOUD_STATE: {} },
    chrome,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch,
    self: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  }, { filename: 'src/js/background.js' })

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
      messageListeners[0]({ type: 'GET_LYRICS', payload }, { tab: { id: 7 } }, r => responses.push(r))
    },
    dispatchMessage(type, payload) {
      const replies = []
      messageListeners[0]({ type, payload }, { tab: { id: 7 } }, r => replies.push(r))
      return replies
    },
  }
}

const requestPayload = {
  track: 'Extra Song',
  artist: 'Extra Artist',
  album: 'Extra Album',
  duration_sec: 200,
  video_id: 'video-abc',
  request_id: 'request-1',
  track_key: 'track-1',
  lyric_source_mode: 'standard',
  use_lrclib: true,
}

async function settle() {
  // API.delay の上限(10ms)を何度か跨ぐまで進める
  for (let i = 0; i < 12; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
}

test('SimpMusic wins when LRCHub has nothing, and is reported as its own source', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromSimpMusic: async ({ video_id }) => {
        assert.equal(video_id, 'video-abc')
        // 単語同期を持っているので LrcLib を追い越してよい
        return {
          lyrics: '[00:01.00] simp line',
          dynamicLines: [{ startTimeMs: 1000, text: 'simp line', chars: [{ t: 1000, c: 's' }] }],
        }
      },
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'simpmusic')
  assert.equal(harness.responses[0].sourceLabel, 'SimpMusic')
  assert.equal(harness.responses[0].lyrics, '[00:01.00] simp line')
})

// SimpMusic / LyricsPlus を LrcLib より前に置いている理由は
// 「単語同期を返せるから」の一点。行同期しか無い回はその理由が消える。
// 上流の取り込みが崩れて全行が1文字ずつ欠けたまま配信されている曲があり、
// それでも「速かった」というだけで勝っていたのを止める。
test('a line-synced-only SimpMusic result defers to LrcLib', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromSimpMusic: async () => ({ lyrics: '[00:01.00] simp line', dynamicLines: null }),
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'lrclib')
  assert.equal(harness.responses[0].lyrics, '[00:01.00] lrclib line')
})

test('a line-synced-only SimpMusic result still wins when LrcLib has nothing', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromSimpMusic: async () => ({ lyrics: '[00:01.00] simp line', dynamicLines: null }),
      fetchFromLrcLib: async () => null,
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'simpmusic')
  assert.equal(harness.responses[0].lyrics, '[00:01.00] simp line')
})

// 自動選択が外した時の出口。負けた取得元も候補として届いている必要がある。
test('losing providers are offered as candidates without replacing the lyrics', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromSimpMusic: async () => ({
        lyrics: '[00:01.00] simp line',
        dynamicLines: [{ startTimeMs: 1000, text: 'simp line', chars: [{ t: 1000, c: 's' }] }],
      }),
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses[0].lyricsSource, 'simpmusic')

  const offered = harness.candidateUpdates
    .flatMap(entry => entry.message.payload.mergeCandidates || [])
  const lrcLibCandidate = offered.find(cand => cand.lyricsSource === 'lrclib')
  assert.ok(lrcLibCandidate, '負けた LrcLib も候補として届くこと')
  assert.equal(lrcLibCandidate.lyrics, '[00:01.00] lrclib line')
  assert.equal(lrcLibCandidate.providerCandidate, true)
  assert.equal(lrcLibCandidate.label, 'LrcLib')
  // 候補はそれ自身で選べるところまで揃っていること(選択時に追加取得を走らせない)
  assert.equal(lrcLibCandidate.lyricsComplete, true)
  assert.equal(lrcLibCandidate.has_synced, true)

  // 候補の通知が歌詞を差し替えていないこと
  assert.equal(harness.lyricsUpdates.length, 0)
  assert.ok(
    harness.candidateUpdates.every(entry => !('lyrics' in entry.message.payload)),
    '候補通知は歌詞本文を運ばないこと',
  )
})

test('the same provider is never offered as a candidate twice', async () => {
  const harness = createBackgroundHarness({
    api: {
      // primary / search / retry の3回とも同じ LRCHub が答える
      fetchFromLrchub: async () => ({ lyrics: '[00:01.00] hub line' }),
      fetchFromLrchubSearch: async () => ({ lyrics: '[00:01.00] hub search line' }),
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  const offered = harness.candidateUpdates
    .flatMap(entry => entry.message.payload.mergeCandidates || [])
  assert.equal(offered.filter(cand => cand.lyricsSource === 'lrchub').length, 1)
})

test('LyricsPlus receives the album and duration the content script supplied', async () => {
  let seen = null
  const harness = createBackgroundHarness({
    api: {
      fetchFromLyricsPlus: async (params) => {
        seen = params
        return { lyrics: '[00:01.00] plus line', dynamicLines: null }
      },
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  // vm コンテキスト内で作られたオブジェクトなので deepEqual は使えない
  assert.equal(seen.track, 'Extra Song')
  assert.equal(seen.artist, 'Extra Artist')
  assert.equal(seen.album, 'Extra Album')
  assert.equal(seen.duration, 200)
  assert.equal(harness.responses[0].lyricsSource, 'lyricsplus')
})

test('an external provider never replaces lyrics already delivered by LRCHub', async () => {
  let releaseSimp
  const simpPromise = new Promise(resolve => { releaseSimp = resolve })

  const harness = createBackgroundHarness({
    api: {
      // LRCHub は行同期だけ返す(品質2)。SimpMusic は単語同期(品質4)を
      // 遅れて返すが、LRCHub の翻訳を巻き添えにするので差し替えてはいけない。
      fetchFromLrchub: async () => ({ lyrics: '[00:01.00] hub line' }),
      fetchFromSimpMusic: () => simpPromise,
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'lrchub')

  releaseSimp({
    lyrics: '[00:01.00] simp line',
    dynamicLines: [{ startTimeMs: 1000, text: 'simp line', chars: [{ t: 1000, c: 's' }] }],
  })
  await settle()

  assert.equal(harness.lyricsUpdates.length, 0, 'no LYRICS_DATA_UPDATE should be pushed')
})


// ── 他の取得元をその場で探す ──────────────────────────────
// 通常の取得は LRCHub が答えた時点で打ち切るので、その歌詞が曲に
// 合っていなかった時に乗り換え先が無い。ユーザーが明示的に頼んだ時だけ
// 残りの取得元を叩く道を用意した。自動では走らない。

test('FIND_ALTERNATE_LYRICS returns the providers that were never consulted', async () => {
  const asked = []
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: async () => { asked.push('lrchub'); return { lyrics: '[00:01.00] hub line' } },
      fetchFromLrcLib: async () => { asked.push('lrclib'); return { lyrics: '[00:02.00] lrclib line', candidates: [] } },
      fetchFromSimpMusic: async () => { asked.push('simpmusic'); return { lyrics: '[00:03.00] simp line' } },
      fetchFromLyricsPlus: async () => { asked.push('lyricsplus'); return null },
    },
  })

  const replies = harness.dispatchMessage('FIND_ALTERNATE_LYRICS', {
    track: 'Extra Song',
    artist: 'Extra Artist',
    duration_sec: 200,
    video_id: 'video-abc',
    exclude: ['lrchub'],
  })
  await settle()

  assert.equal(replies.length, 1)
  assert.equal(replies[0].success, true)

  // 除外した取得元は叩かない
  assert.ok(!asked.includes('lrchub'), '表示中の取得元は聞き直さない')

  // vm コンテキスト内で作られた配列なので deepEqual は使えない
  const sources = replies[0].candidates.map(cand => cand.lyricsSource).sort().join(',')
  assert.equal(sources, 'lrclib,simpmusic')

  const lrcLib = replies[0].candidates.find(cand => cand.lyricsSource === 'lrclib')
  assert.equal(lrcLib.providerCandidate, true)
  assert.equal(lrcLib.label, 'LrcLib')
  assert.equal(lrcLib.lyrics, '[00:02.00] lrclib line')
  assert.equal(lrcLib.lyricsComplete, true)
})

test('FIND_ALTERNATE_LYRICS survives a provider that throws', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: async () => { throw new Error('boom') },
      fetchFromLrcLib: async () => ({ lyrics: '[00:02.00] lrclib line', candidates: [] }),
      fetchFromSimpMusic: async () => { throw new Error('boom') },
      fetchFromLyricsPlus: async () => { throw new Error('boom') },
    },
  })

  const replies = harness.dispatchMessage('FIND_ALTERNATE_LYRICS', {
    track: 'Extra Song',
    artist: 'Extra Artist',
    video_id: 'video-abc',
  })
  await settle()

  assert.equal(replies[0].success, true)
  assert.equal(replies[0].candidates.length, 1)
  assert.equal(replies[0].candidates[0].lyricsSource, 'lrclib')
})

test('FIND_ALTERNATE_LYRICS reports nothing rather than failing when no one has lyrics', async () => {
  const harness = createBackgroundHarness()

  const replies = harness.dispatchMessage('FIND_ALTERNATE_LYRICS', {
    track: 'Extra Song',
    artist: 'Extra Artist',
    video_id: 'video-abc',
  })
  await settle()

  assert.equal(replies[0].success, true)
  assert.equal(replies[0].candidates.length, 0)
})


// ── プレーン歌詞の待ち時間 ────────────────────────────────
// LrcLib は LRCHub と同時に走らせる。以前は「LRCHub を待つ 1.5 秒」が
// 明けてから初めて起動していたので、LRCHub が遅い回はそのぶん丸ごと
// 何も始まっていなかった。

test('LRCHub が遅い時は、手元にある LrcLib を先に出す', async () => {
  const neverResolve = () => new Promise(() => {})
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: neverResolve,
      fetchFromLrchubSearch: neverResolve,
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
      fetchFromSimpMusic: async () => null,
      fetchFromLyricsPlus: async () => null,
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].lyricsSource, 'lrclib')
  assert.equal(harness.responses[0].fallbackUsed, true, '暫定表示として出すこと')
  assert.equal(harness.responses[0].lyrics, '[00:01.00] lrclib line')
})

test('先に出した LrcLib は、あとから届いた LRCHub の単語同期に差し替わる', async () => {
  let releaseHub
  const hubPromise = new Promise(resolve => { releaseHub = resolve })
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: () => hubPromise,
      fetchFromLrchubSearch: () => new Promise(() => {}),
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
      fetchFromSimpMusic: async () => null,
      fetchFromLyricsPlus: async () => null,
    },
  })

  harness.dispatch(requestPayload)
  await settle()
  assert.equal(harness.responses[0].lyricsSource, 'lrclib')

  releaseHub({
    lyrics: '[00:01.00] hub line',
    dynamicLines: [{ startTimeMs: 1000, text: 'hub line', chars: [{ t: 1000, c: 'h' }] }],
  })
  await settle()

  assert.equal(harness.responses.length, 1, 'sendResponse は一度きり')
  const updates = harness.lyricsUpdates
  assert.equal(updates.length, 1, '差し替えは LYRICS_DATA_UPDATE で届く')
  assert.equal(updates[0].message.payload.lyricsSource, 'lrchub')
  assert.equal(updates[0].message.payload.lyricsQuality, 4)
})

test('LRCHub が「持っていない」と即答した回は、先出しせず単語同期に勝たせる', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: async () => null,
      fetchFromLrchubSearch: async () => null,
      fetchFromLrcLib: async () => ({ lyrics: '[00:01.00] lrclib line', candidates: [] }),
      fetchFromSimpMusic: async () => ({
        lyrics: '[00:01.00] simp line',
        dynamicLines: [{ startTimeMs: 1000, text: 'simp line', chars: [{ t: 1000, c: 's' }] }],
      }),
    },
  })

  harness.dispatch(requestPayload)
  await settle()

  assert.equal(harness.responses[0].lyricsSource, 'simpmusic')
})
