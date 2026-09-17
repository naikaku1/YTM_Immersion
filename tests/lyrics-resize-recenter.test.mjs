// 窓の大きさを変えて戻すと、歌詞が画面の下に取り残されて消えたように見える。
//
// 行を画面の真ん中に置く量は、その時の器の高さと行の位置から px で出している。
// 窓の幅が変わると縦積み↔横並びでレイアウトごと変わるので、前の大きさで出した
// 位置は意味を失う。それでも「この行へはもう寄せた」という印(_lastScrolledIndex)
// が残っているため、次の行が始まるまで誰も直さない。
//
// 追従の途中なら stepLyricScroll の「誰かが動かした」判定が印を戻すが、
// 落ち着くと snapLyricScroll が _scrollTarget を捨てるので、そこも通らない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

const makeContainer = () => ({
  _lastScrolledIndex: 12,
  _instantNextScroll: false,
  _scrollTarget: 4000,
  _scrollVel: 42,
})

const run = (pip) => {
  const lyrics = makeContainer()
  const context = vm.createContext({
    ui: { lyrics },
    PipManager: { pipLyricsContainer: pip },
  })
  vm.runInContext(
    `${sliceBetween('const recenterLyricsAfterResize = () => {', '// 窓の大きさが変わると語の横位置が動く')}\nrecenterLyricsAfterResize()`,
    context,
  )
  return lyrics
}

test('寄せ直しの印を戻す', () => {
  const lyrics = run(null)
  assert.equal(lyrics._lastScrolledIndex, -1, '寄せ済みの印が残っている')
})

test('前の大きさで出した行き先は捨てる', () => {
  const lyrics = run(null)
  assert.equal(lyrics._scrollTarget, undefined)
  assert.equal(lyrics._scrollVel, 0)
})

test('見当違いな所から流さずに飛ばす', () => {
  const lyrics = run(null)
  assert.equal(lyrics._instantNextScroll, true)
})

test('PIP を開いていれば PIP も直す', () => {
  const pip = makeContainer()
  run(pip)
  assert.equal(pip._lastScrolledIndex, -1)
  assert.equal(pip._scrollTarget, undefined)
  assert.equal(pip._instantNextScroll, true)
})

test('PIP が閉じていても落ちない', () => {
  assert.doesNotThrow(() => run(null))
  assert.doesNotThrow(() => run(undefined))
})

test('大きさが変わった時に呼ぶ', () => {
  const handler = sliceBetween("window.addEventListener('resize', () => {", '\n});')
  assert.match(handler, /recenterLyricsAfterResize\(\)/)
  // 語の測り直しも今までどおり
  assert.match(handler, /invalidateLyricLineSweeps\(\)/)
  // 連打で毎回走らないよう間引いていること
  assert.match(handler, /clearTimeout\(_sweepResizeTimer\)/)
})

// 器ごと作り直された時の保険。
//
// YTM 側の作り直しに巻き込まれて #ytm-custom-wrapper が画面から消えると、
// initLayout は新しい器を組む。組んだ直後の器は空なので、いま出していた歌詞を
// 出し直さないと、曲は鳴っているのに次の曲まで歌詞が出ないままになる。
test('器を組み直したら、いまの歌詞を出し直す', () => {
  const build = sliceBetween("if (isYTMPremiumUser()) setupMovieMode();", '\n}')
  assert.match(build, /applyLyricsText\(lastRawLyricsText\)/)
  assert.match(build, /typeof lastRawLyricsText === 'string' && lastRawLyricsText\.trim\(\)/)
})

test('出し直しは組み直した時だけ(既にあるなら手前で帰る)', () => {
  const head = sliceBetween('function initLayout() {', 'const existingWrapper')
  assert.match(head, /return;/)
  const at = uiSource.indexOf('function initLayout() {')
  const earlyReturn = uiSource.indexOf('return;', at)
  const restore = uiSource.indexOf('applyLyricsText(lastRawLyricsText)', at)
  assert.ok(earlyReturn < restore, '既存 UI の経路でも出し直している')
})
