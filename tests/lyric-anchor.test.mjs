// 歌っている行を止める位置。
//
// 既定は器の中央。狭い画面(縦積み)で中央に置くと、上半分が歌い終わった行で
// 埋まって、これから来る歌詞の見える量が半分になる。CSS の
// --ytm-lyrics-anchor-top-lines で「上から何行ぶん下げた所に置くか」を
// 指定できるようにして、画面の形ごとの判断は CSS(メディアクエリ)に持たせる。
//
// 単位を行の高さにしてあるので、文字サイズや UI サイズを変えても
// 上に残る余白の見た目が変わらない。

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

const load = (cssValue) => {
  const context = vm.createContext({ Number, console })
  vm.runInContext(
    `${sliceBetween("const LYRICS_ANCHOR_VAR = '--ytm-lyrics-anchor-top-lines';", 'const requestLyricScroll')}
     this.offset = lyricAnchorOffset
     this.read = readLyricAnchorTopLines`,
    context,
  )
  const container = {
    clientHeight: 600,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ getPropertyValue: () => cssValue }),
      },
    },
  }
  return { ...context, container }
}

test('指定が無ければ中央に置く(従来どおり)', () => {
  const { offset, container } = load('')
  // 行の中心が器の中心に来る位置
  assert.equal(offset(container, 40), 300 - 20)
})

test('指定があれば上から N 行ぶん下げた所に置く', () => {
  const { offset, container } = load('0.5')
  assert.equal(offset(container, 40), 20)
  assert.equal(offset(container, 60), 30, '行の高さが変われば同じだけ変わる')
})

test('0 なら一番上にぴったり付ける', () => {
  const { offset, container } = load('0')
  assert.equal(offset(container, 40), 0)
})

test('読めない値は中央に落とす', () => {
  for (const bad of ['', '  ', 'auto', 'abc', '-1']) {
    const { offset, container } = load(bad)
    assert.equal(offset(container, 40), 280, `${bad} で中央に落ちていない`)
  }
})

test('一度読んだら覚える(毎回 getComputedStyle しない)', () => {
  let calls = 0
  const context = vm.createContext({ Number, console })
  vm.runInContext(
    `${sliceBetween("const LYRICS_ANCHOR_VAR = '--ytm-lyrics-anchor-top-lines';", 'const requestLyricScroll')}
     this.read = readLyricAnchorTopLines`,
    context,
  )
  const container = {
    clientHeight: 600,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => { calls += 1; return { getPropertyValue: () => '0.5' } },
      },
    },
  }
  context.read(container)
  context.read(container)
  context.read(container)
  assert.equal(calls, 1)
})

test('画面の形が変わったら読み直す', () => {
  const fn = sliceBetween('const recenterLyricsAfterResize = () => {', '// 窓の大きさが変わると語の横位置が動く')
  assert.match(fn, /_ytmAnchorLines = undefined/)
})

test('止める位置はスクロールの計算に使われている', () => {
  assert.match(uiSource, /- lyricAnchorOffset\(container, rRect\.height\);/)
  // 中央固定の計算が残っていないこと
  assert.ok(
    !/- \(container\.clientHeight \/ 2\) \+ \(rRect\.height \/ 2\)/.test(uiSource),
    '中央固定の計算が残っている',
  )
})
