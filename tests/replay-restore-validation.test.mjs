// Daily Replay の Restore。
//
// 配列でありさえすれば中身を見ずにマージしていた。読むのは利用者のファイルなので、
// timestamp が無い要素が混ざると sort が NaN になり、getStats の
// new Date(NaN) まで巻き込む。Export 側は click 直後に revokeObjectURL していて、
// ブラウザが読み出す前に URL が無効になることがあった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/js/module/replay-manager.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return source.slice(start, end)
}

const context = vm.createContext({ Number, String })
vm.runInContext(
  `this.holder = { ${sliceBetween('_isValidHistoryEntry: function (entry) {', '    importHistory: function () {').replace(/,\s*$/, '')} }`,
  context,
)
const mgr = context.holder

test('履歴として成立する要素だけ通す', () => {
  const ok = { id: 'abc', title: '曲', artist: '歌手', timestamp: 1700000000000 }
  assert.equal(mgr._isValidHistoryEntry(ok), true)
  assert.equal(mgr._isValidHistoryEntry(null), false)
  assert.equal(mgr._isValidHistoryEntry('文字列'), false)
  assert.equal(mgr._isValidHistoryEntry({ ...ok, timestamp: undefined }), false, 'timestamp 欠落を通している')
  assert.equal(mgr._isValidHistoryEntry({ ...ok, timestamp: 'いつか' }), false)
  assert.equal(mgr._isValidHistoryEntry({ ...ok, id: '' }), false)
  assert.equal(mgr._isValidHistoryEntry({ ...ok, title: 42 }), false)
})

test('数値でない値は 0 に均す', () => {
  const out = mgr._sanitizeHistoryEntry({
    id: 'abc', title: '曲', artist: '歌手', timestamp: '1700000000000',
    duration: 'ながい', lyricLines: null, src: 123,
  })
  assert.equal(out.duration, 0)
  assert.equal(out.lyricLines, 0)
  assert.equal(out.timestamp, 1700000000000)
  assert.equal(out.src, null)
})

test('読めない要素は飛ばしてマージする', () => {
  const fn = sliceBetween('const data = JSON.parse(ev.target.result);', 'alert(\'無効なファイル形式です。\')')
  assert.match(fn, /filter\(entry => this\._isValidHistoryEntry\(entry\)\)/)
  assert.match(fn, /map\(entry => this\._sanitizeHistoryEntry\(entry\)\)/)
  assert.match(fn, /if \(!valid\.length\)/)
})

test('Export の URL は即座に捨てない', () => {
  assert.match(source, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1000\);/)
  assert.ok(!/a\.click\(\);\n\s*URL\.revokeObjectURL\(url\);/.test(source))
})
