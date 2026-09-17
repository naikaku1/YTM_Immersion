// 連続再生オフセット(timeOffset)の扱い。
//
// timeOffset は「この曲が始まった video 時間」。YTM の連続再生では曲が
// 変わっても currentTime が 0 に戻らないことがあるので、これを引いて
// 曲内ローカル時間を出している。
//
// 以前は時刻を読むだけのはずの getCurrentPlaybackTimeSec が、ついでに
// timeOffset を 0 に書き換えていた(rAF ループと同じ処理が 2 箇所)。
// 書き換える場所は「曲が変わった時の tick」「巻き戻りを見つけた rAF ループ」
// 「シーク」の 3 箇所だけにする。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const start = uiSource.indexOf('const toLocalPlaybackTime = (rawTime) => {')
assert.notEqual(start, -1, 'toLocalPlaybackTime should be present')
const fnSource = uiSource.slice(start, uiSource.indexOf('\n};', start) + 3)

const run = (rawTime, offset) => {
  const context = vm.createContext({ Math, timeOffset: offset })
  vm.runInContext(`${fnSource}\nthis.out = toLocalPlaybackTime(${rawTime})\nthis.offset = timeOffset`, context)
  return context
}

test('オフセットを引いて曲内時間にする', () => {
  assert.equal(run(130, 100).out, 30)
})

test('オフセットが無ければそのまま', () => {
  assert.equal(run(30, 0).out, 30)
})

test('巻き戻ったら曲の頭から掛け直されたとみなす', () => {
  assert.equal(run(5, 100).out, 5)
})

test('読むだけで timeOffset を書き換えない', () => {
  const ctx = run(5, 100)
  assert.equal(ctx.offset, 100, '読み取りの副作用で書き換えている')
})

test('書き換えるのは 3 箇所だけ', () => {
  const writes = uiSource.match(/timeOffset = (?:0|currentTime);/g) || []
  // tick(3 通りの分岐) + rAF ループ + seeked
  assert.equal(writes.length, 5, `timeOffset の書き換えが増減している: ${writes.length}`)
  // 時刻を読むだけの関数が書き換えていないこと
  const getter = uiSource.slice(
    uiSource.indexOf('const getCurrentPlaybackTimeSec = () => {'),
    uiSource.indexOf('const findMeaningIndexByTime'),
  )
  assert.ok(!/timeOffset = /.test(getter), 'getter が書き換えている')
})

test('シークでも直す', () => {
  const start = uiSource.indexOf("document.addEventListener('seeked'")
  assert.notEqual(start, -1, 'seeked を見ていない')
  const fn = uiSource.slice(start, uiSource.indexOf('}, true);', start))
  assert.match(fn, /timeOffset > 0 && t < timeOffset\) timeOffset = 0/)
})
