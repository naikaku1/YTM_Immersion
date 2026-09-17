// キャッシュ表示のあと、ネットワーク結果が同じでも毎回描き直していた問題。
//
// applyLyricsText は dynamicLines をその場で正規化する(chars の展開・
// endTimeMs の付与)。あとから届いた生のレスポンスと JSON.stringify で
// 比べるので必ず不一致になり、needsRendering が立って renderLyrics が
// innerHTML を空にする。再生中にスクロール位置が飛ぶ。
// キャッシュに入る dynamicLines も「正規化前/後」のどちらか不定だった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')

const sliceBetween = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return src.slice(start, end)
}

test('正規化は複製に対して行う', () => {
  const context = vm.createContext({ structuredClone, JSON, Array, console })
  vm.runInContext(
    `${sliceBetween(uiSource, 'const deepCopyDynamicLines = (lines) => {', 'const dynamicLineCharTimes')}\nthis.fn = deepCopyDynamicLines`,
    context,
  )
  const copy = context.fn
  const src = [{ startTimeMs: 0, text: 'ab', chars: [{ t: 0, c: 'ab' }] }]
  const out = copy(src)
  out[0].chars[0].c = 'x'
  out[0].endTimeMs = 999
  assert.equal(src[0].chars[0].c, 'ab', '元データが書き換わっている')
  assert.equal(src[0].endTimeMs, undefined)
})

test('applyLyricsText は生データを残してから正規化する', () => {
  const fn = sliceBetween(uiSource, '// Normalize Dynamic lyrics:', 'lyricsData = finalLines;')
  assert.match(fn, /dynamicLinesRaw = dynamicLines;/)
  assert.match(fn, /deepCopyDynamicLines\(dynamicLines\)/)
  const rawAt = fn.indexOf('dynamicLinesRaw = dynamicLines;')
  const normAt = fn.indexOf('normalizeDynamicLinesToCharLevel(')
  assert.ok(rawAt < normAt, '正規化のあとに生データを控えている')
})

test('レスポンスとの突き合わせは生データ同士', () => {
  const fn = sliceBetween(uiSource, 'const shownDynamicLines =', 'currentLyricsResultPriority = responsePriority;')
  assert.match(fn, /dynamicLinesRaw !== null \? dynamicLinesRaw : dynamicLines/)
  assert.match(
    fn,
    /JSON\.stringify\(selectedResponse\.dynamicLines\) !== JSON\.stringify\(shownDynamicLines\)/,
  )
})

test('曲が変わったら生データも捨てる', () => {
  assert.match(uiSource, /dynamicLines = null;\n  dynamicLinesRaw = null;/)
})
