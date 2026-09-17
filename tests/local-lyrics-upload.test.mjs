// ローカル LRC の読み込み。
//
// 以前は storage.set を待たずに currentKey = null にして「曲が変わった」ことに
// していた。だが tick は player-bar の DOM が動いた時だけ走るので、何も触らないと
// 読み込んだ歌詞がいつまでも出ない。走ったら走ったで初回ロード扱いになり、
// 連続再生オフセット(timeOffset)と同期オフセット(syncOffset)が 0 に戻って
// 曲の途中で読み込むと歌詞がずれていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const start = source.indexOf('const handleUpload = (e) => {')
assert.notEqual(start, -1, 'handleUpload should be present')
const end = source.indexOf('let isRafLoopRunning = false;', start)
assert.notEqual(end, -1, 'handleUpload end marker should be present')
const fn = source.slice(start, end)

test('currentKey を潰して曲の切り替わりを装わない', () => {
  assert.ok(!/currentKey = null/.test(fn), 'currentKey を null にしている')
})

test('保存を待ってから読み直す', () => {
  assert.match(fn, /await storage\.set\(/)
  assert.match(fn, /loadLyrics\(metaNow\)/)
  const setAt = fn.indexOf('await storage.set(')
  const loadAt = fn.indexOf('loadLyrics(metaNow)')
  assert.ok(setAt < loadAt, '保存より先に読み直している')
})

test('読み込み中に曲が変わったら出さない', () => {
  assert.match(fn, /if \(currentKey !== uploadKey\) return;/)
})
