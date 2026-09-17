// runtime.sendMessage の lastError 未確認。
//
// Service Worker が寝ている / 応答が無いとき、コールバックの中で
// chrome.runtime.lastError を読まないと "Unchecked runtime.lastError" が
// コンソールに残り続け、本当のエラーが埋もれる。
// content 側の送信はすべて safeRuntimeSendMessage を通す。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

test('生の chrome.runtime.sendMessage が残っていない', () => {
  assert.ok(!/chrome\.runtime\.sendMessage/.test(uiSource))
})

test('EXT.runtime.sendMessage を直に呼ぶのは safeRuntimeSendMessage だけ', () => {
  const start = uiSource.indexOf('const safeRuntimeSendMessage = (message) => {')
  assert.notEqual(start, -1)
  const end = uiSource.indexOf('\n};', start)
  const before = uiSource.slice(0, start)
  const after = uiSource.slice(end)
  assert.ok(!/EXT\.runtime\.sendMessage\(/.test(before), '前方に直呼びが残っている')
  assert.ok(!/EXT\.runtime\.sendMessage\(/.test(after), '後方に直呼びが残っている')
})

test('safeRuntimeSendMessage は lastError を読む', () => {
  const start = uiSource.indexOf('const safeRuntimeSendMessage = (message) => {')
  const fn = uiSource.slice(start, uiSource.indexOf('\n};', start))
  assert.match(fn, /EXT\.runtime\.lastError/)
})
