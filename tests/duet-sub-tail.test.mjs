// デュエット右側(sub)の行末。
//
// メイン側(api.js の parseDynamicLrc)は、行末の文字を「次の行が始まるまで」で
// 割らないように estimateCharDurationMs で上限を掛けている。sub 側の
// parseDynamicLrcForSub にはその補正が無く、右側だけ行末の文字が数秒後に
// 点灯していた(間奏に入る行ほど目立つ)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')

const sliceBetween = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return src.slice(start, end)
}

const context = vm.createContext({ String, Number, Array, Math, parseInt, console })
vm.runInContext(
  sliceBetween(namespaceSource, 'const CHAR_DURATION_FALLBACK_MS', '// ── byline'),
  context,
)
vm.runInContext(
  `${sliceBetween(uiSource, 'const parseDynamicLrcForSub = (text) => {', '// Dynamic.lrc形式かどうかを判定')}\nthis.parse = parseDynamicLrcForSub`,
  context,
)
const parseSub = context.parse

// 1行目は 0.2 秒刻みで歌い、そのあと 30 秒の間奏をはさんで次の行が来る。
const lrc = [
  '[00:00.00]<00:00.00>あ<00:00.20>い<00:00.40>う<00:00.60>え お',
  '[00:30.00]<00:30.00>か',
].join('\n')

test('行末の文字が間奏のぶんまで引き伸ばされない', () => {
  const lines = parseSub(lrc)
  assert.equal(lines.length, 2)
  const chars = lines[0].chars
  const last = chars[chars.length - 1]
  // 補正前は最後の文字が 30 秒近くまで持っていかれていた
  assert.ok(last.t < 3000, `行末が遅すぎる: ${last.t}ms`)
})

test('タグの付いている文字の時刻は変えない', () => {
  const lines = parseSub(lrc)
  const chars = lines[0].chars
  assert.equal(chars[0].t, 0)
  assert.equal(chars[1].t, 200)
  assert.equal(chars[2].t, 400)
})

test('行の開始時刻はこれまでどおり', () => {
  const lines = parseSub(lrc)
  assert.equal(lines[0].startTimeMs, 0)
  assert.equal(lines[1].startTimeMs, 30000)
})
