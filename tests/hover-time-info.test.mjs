// プレイヤーバーのホバー時刻。
//
// timeToSeconds が "m:ss" 前提で、1 時間を超える曲(ライブ音源・ミックス)では
// "1:05:30" の後ろ 2 つしか見ておらず NaN になっていた。
// ついでに、要素を待つ 1 秒ポーリング(最大 60 回)を MutationObserver にした。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const setupStart = uiSource.indexOf('const hoverTimeInfoSetup = () => {')
assert.notEqual(setupStart, -1)
const setupEnd = uiSource.indexOf('const parseLRCNoFlag', setupStart)
const setupSource = uiSource.slice(setupStart, setupEnd)

const helpers = (() => {
  const from = setupSource.indexOf('  const timeToSeconds = (str) => {')
  const to = setupSource.indexOf('  const removeHoverTimeInfo')
  const context = vm.createContext({ String, Number, Math })
  vm.runInContext(
    `${setupSource.slice(from, to)}\nthis.toSeconds = timeToSeconds\nthis.format = formatHoverTime`,
    context,
  )
  return context
})()

test('m:ss を読む', () => {
  assert.equal(helpers.toSeconds('3:45'), 225)
  assert.equal(helpers.toSeconds('0:05'), 5)
})

test('h:mm:ss を読む', () => {
  assert.equal(helpers.toSeconds('1:05:30'), 3930)
  assert.equal(helpers.toSeconds('2:00:00'), 7200)
})

test('読めない文字列は 0 にする(NaN を返さない)', () => {
  assert.equal(helpers.toSeconds(''), 0)
  assert.equal(helpers.toSeconds('--'), 0)
  assert.equal(helpers.toSeconds(null), 0)
})

test('1 時間を超えたら h:mm:ss で出す', () => {
  assert.equal(helpers.format(225), '3:45')
  assert.equal(helpers.format(3930), '1:05:30')
  assert.equal(helpers.format(0), '0:00')
  assert.equal(helpers.format(-5), '0:00')
})

test('1 秒ポーリングをやめた', () => {
  assert.ok(!/setInterval\(/.test(setupSource), 'ポーリングが残っている')
  assert.match(setupSource, /waitForDomCondition\(/)
  assert.match(uiSource, /const waitForDomCondition = \(check, timeoutMs\) => new Promise/)
  assert.match(uiSource, /new MutationObserver\(\(\) => \{/)
})
