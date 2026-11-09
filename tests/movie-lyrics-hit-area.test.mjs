// 動画モードの歌詞は、字のある所だけを押せる・乗せて明るくなる所にする。
// 行は帯の幅いっぱいの箱なので、短い行の左に空いた映像の上を押してもその行へ
// 飛び、ダブルクリックの全画面も効かなかった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')
const LINE = 'body.ytm-custom-layout.ytm-movie-lyrics #my-lyrics-container.moviemode .lyric-line'
const BOXES = `${LINE} :is(.lyric-main, .lyric-translation, .lyric-bg, .lyric-singer-name)`
const rule = (sel, from = 0) => {
  const at = css.indexOf(`${sel} {`, from)
  assert.ok(at !== -1, `${sel} が無い`)
  return css.slice(at, css.indexOf('}', at))
}

test('行そのものは押せず、中の本文・訳・ハモリ・歌手名の箱を字の幅に縮めて押せるようにする', () => {
  const lines = css.split(`${LINE} {`).slice(1).map(s => s.slice(0, s.indexOf('}')))
  assert.ok(lines.some(r => /pointer-events: none;/.test(r)), '行の pointer-events: none が無い')
  const boxes = rule(BOXES)
  assert.match(boxes, /width: fit-content;/)
  assert.match(boxes, /max-width: 100%;/)
  assert.match(boxes, /margin-left: auto;/)
  assert.match(boxes, /pointer-events: auto;/)
})

test('縦長の窓(左揃え)では、縮めた箱も左に寄せる', () => {
  const media = css.slice(css.indexOf('@media (max-aspect-ratio: 5/4) {'))
  const boxes = rule(BOXES, css.length - media.length)
  assert.match(boxes, /margin-left: 0;/)
  assert.match(boxes, /margin-right: auto;/)
})
