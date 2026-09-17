// 歌詞検索に投げる曲名の正規化。
//
// 以前の /\s*[\(-\[].*?[\)-]].*/ は、末尾の [\)-]] が「) または - の直後に
// リテラルの ]」を要求するため、普通の曲名には一度も当たっていなかった。
// "(feat. X)" や " - Remix" が付いたまま各プロバイダへ飛んでいた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const namespaceSource = fs.readFileSync(
  new URL('../src/js/module/namespace.js', import.meta.url),
  'utf8',
)

const start = namespaceSource.indexOf('const normalizeSearchTrackTitle = (s) => {')
assert.notEqual(start, -1, 'normalizeSearchTrackTitle should be present')
const end = namespaceSource.indexOf('};', start) + 2
const context = vm.createContext({})
vm.runInContext(`${namespaceSource.slice(start, end)}\nthis.fn = normalizeSearchTrackTitle`, context)
const normalize = context.fn

test('括弧の中身を落とす', () => {
  assert.equal(normalize('Song (Live)'), 'Song')
  assert.equal(normalize('Song [MV]'), 'Song')
  assert.equal(normalize('Song (feat. X)'), 'Song')
  assert.equal(normalize('曲名（TVサイズ）'), '曲名')
  assert.equal(normalize('曲名【MV】'), '曲名')
})

test('スペースで挟まれたハイフン以降を落とす', () => {
  assert.equal(normalize('Song - Remix'), 'Song')
  assert.equal(normalize('Song – Live Version'), 'Song')
  assert.equal(normalize('Song (feat. X) - Live'), 'Song')
})

test('曲名の一部のハイフンは残す', () => {
  assert.equal(normalize('Re-Bye'), 'Re-Bye')
  assert.equal(normalize('X-Ray'), 'X-Ray')
})

test('全部落ちる曲名は元のまま返す', () => {
  assert.equal(normalize('(Interlude)'), '(Interlude)')
  assert.equal(normalize(''), '')
  assert.equal(normalize(null), '')
})

test('普通の曲名は変えない', () => {
  assert.equal(normalize('Song'), 'Song')
  assert.equal(normalize('  Song  '), 'Song')
})
