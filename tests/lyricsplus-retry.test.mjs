// LyricsPlus の聞き直し。
//
// サーバーは「曲名・歌手・長さ」の組ごとに最初に取れた結果を覚えて返し続ける。
// その組で QQ Music や Musixmatch が覚えられていると、Apple Music の単語同期
// (語の時刻が細かく、ハモリの印が付く)がその長さでは二度と返らない。
// 実測(OMG / NewJeans): 長さ 212 は QQ Music、長さ無しは Apple。
// Apple の単語同期でなければ長さ無しでも聞き直し、曲に合う時だけ採る。
// 通信を差し替えるのでファイルを分けてある。語は仮の文字列。

import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.chrome = { runtime: { lastError: null }, storage: { local: { get: (_k, cb) => cb({}) } } }

const requests = []
let respond = () => null
globalThis.fetch = async (url) => {
  const u = new URL(url)
  requests.push(u)
  const body = respond(u)
  if (!body) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => body }
}

const { fetchFromLyricsPlus, lyricsPlusFitsTrack } = await import('../src/js/module/api.js')

const rows = (endSec, { background = false } = {}) => {
  const out = []
  for (let t = 10; t < endSec; t += 10) {
    out.push({
      time: t * 1000,
      duration: 2000,
      text: 'Alpha beta',
      syllabus: [
        { time: t * 1000, duration: 500, text: 'Alpha ' },
        { time: t * 1000 + 500, duration: 500, text: 'beta' },
        ...(background ? [{ time: t * 1000 + 1000, duration: 800, text: '(Echo)', isBackground: true }] : []),
      ],
    })
  }
  out[out.length - 1].duration = (endSec - out[out.length - 1].time / 1000) * 1000
  return out
}

const apple = (endSec) => ({ type: 'Word', metadata: { source: 'Apple' }, lyrics: rows(endSec, { background: true }) })
const qq = (endSec) => ({ type: 'Word', metadata: { source: 'QQ Music' }, lyrics: rows(endSec) })

const params = { track: 'Song', artist: 'Artist', duration: 212 }

test('長さ付きで Apple 以外が返ったら、長さ無しで聞き直して Apple を採る', async () => {
  requests.length = 0
  respond = (u) => (u.searchParams.has('duration') ? qq(205) : apple(205))
  const result = await fetchFromLyricsPlus(params)
  assert.ok(result.dynamicLines.some(line => line.bg), 'ハモリ付きの方を採る')
  assert.equal(result._lyricsPlusMeta, undefined, '判断用の印は外して返す')
  assert.ok(requests.some(u => !u.searchParams.has('duration')))
})

test('長さ付きで Apple が返ったら聞き直さない', async () => {
  requests.length = 0
  respond = () => apple(205)
  await fetchFromLyricsPlus(params)
  assert.ok(requests.every(u => u.searchParams.get('duration') === '212'))
})

test('聞き直した歌詞が曲に合わない(別バージョン)なら元の方を使う', async () => {
  // MV(212 秒)に音源の歌詞(170 秒で終わる)は合わない
  respond = (u) => (u.searchParams.has('duration') ? qq(205) : apple(170))
  const result = await fetchFromLyricsPlus(params)
  assert.ok(!result.dynamicLines.some(line => line.bg))
})

test('長さが分からない時は今までどおり 1 回だけ', async () => {
  requests.length = 0
  respond = () => qq(205)
  await fetchFromLyricsPlus({ track: 'Song', artist: 'Artist' })
  const queries = new Set(requests.map(u => u.search))
  assert.equal(queries.size, 1)
})

test('曲に合うかは「歌詞の終わりが曲の終わりの 20 秒以内」', () => {
  assert.equal(lyricsPlusFitsTrack(200_000, 212), true)
  assert.equal(lyricsPlusFitsTrack(212_500, 212), true)
  assert.equal(lyricsPlusFitsTrack(170_000, 201), false)   // Espresso の MV と音源
  assert.equal(lyricsPlusFitsTrack(220_000, 212), false)   // 曲より長い
  assert.equal(lyricsPlusFitsTrack(null, 212), false)
})
