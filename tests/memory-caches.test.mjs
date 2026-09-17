// セッション中に溜まるキャッシュ。
//
// 上限に達したら Map を丸ごと clear する形だったので、
//   ・いま再生している曲のぶんまで巻き添えで消え、直後に取り直しが走る
//   ・よく戻る曲でも、溜まり方次第で毎回落ちる
// 古い順に必要なぶんだけ落とす形にした。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const namespaceSource = read('src/js/module/namespace.js')
const ytmSource = read('src/js/module/ytm-lyrics.js')
const queueSource = read('src/js/module/queue-manager.js')

const start = namespaceSource.indexOf('const trimMapToLimit = (map, limit, isPinned) => {')
assert.notEqual(start, -1, 'trimMapToLimit should be present')
const context = vm.createContext({ Map, Number })
vm.runInContext(
  `${namespaceSource.slice(start, namespaceSource.indexOf('\n};', start) + 3)}\nthis.trim = trimMapToLimit`,
  context,
)
const trim = context.trim

const mapOf = (n) => {
  const m = new Map()
  for (let i = 0; i < n; i++) m.set(`k${i}`, i)
  return m
}

test('上限までは何も落とさない', () => {
  const m = mapOf(5)
  assert.equal(trim(m, 5), 0)
  assert.equal(m.size, 5)
})

test('超えたぶんだけ古い順に落とす', () => {
  const m = mapOf(10)
  assert.equal(trim(m, 6), 4)
  assert.equal(m.size, 6)
  assert.ok(!m.has('k0'))
  assert.ok(!m.has('k3'))
  assert.ok(m.has('k4'), '新しい側まで落としている')
  assert.ok(m.has('k9'))
})

test('残すと指定したものは落とさない', () => {
  const m = mapOf(10)
  trim(m, 3, (k) => k === 'k0')
  assert.ok(m.has('k0'), '残すはずのものを落としている')
  assert.equal(m.size, 3)
})

test('全部が対象外なら何も落とさない(無限ループしない)', () => {
  const m = mapOf(10)
  assert.equal(trim(m, 3, () => true), 0)
  assert.equal(m.size, 10)
})

test('Map 以外を渡しても壊れない', () => {
  assert.equal(trim(null, 3), 0)
  assert.equal(trim({}, 3), 0)
})

test('丸ごと消す形が残っていない', () => {
  assert.ok(!/lyricsCache\.clear\(\)/.test(ytmSource), '歌詞キャッシュを丸ごと消している')
  assert.ok(!/queueCache\.clear\(\)/.test(ytmSource), 'キューのキャッシュを丸ごと消している')
  assert.ok(!/resolveCache\.clear\(\)/.test(ytmSource), 'カタログ解決を丸ごと消している')
})

test('それぞれ上限が置かれている', () => {
  assert.match(ytmSource, /const LYRICS_CACHE_LIMIT = \d+;/)
  assert.match(ytmSource, /const QUEUE_CACHE_LIMIT = \d+;/)
  assert.match(ytmSource, /const RESOLVE_CACHE_LIMIT = \d+;/)
  assert.match(queueSource, /PREFETCH_HISTORY_LIMIT: \d+,/)
  assert.match(queueSource, /trimMapToLimit\(this\._prefetchLastAt/)
})

test('差し替え待ちの付いた歌詞は落とさない', () => {
  const at = ytmSource.indexOf('trimMapToLimit(\n      lyricsCache,')
  assert.notEqual(at, -1, '歌詞キャッシュを上限で抑えていない')
  const call = ytmSource.slice(at, ytmSource.indexOf(');', at))
  assert.match(call, /upgradeWaiters\.has\(id\)/)
})

test('使った歌詞は新しい側へ回す', () => {
  const at = ytmSource.indexOf('if (lyricsCache.has(videoId)) {')
  assert.notEqual(at, -1)
  const block = ytmSource.slice(at, ytmSource.indexOf('\n    }', at))
  assert.match(block, /lyricsCache\.delete\(videoId\)/)
  assert.match(block, /lyricsCache\.set\(videoId, hit\)/)
})
