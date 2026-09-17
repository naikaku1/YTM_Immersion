// 解説パネルの作り直し。
//
// initLayout は tick から毎回通る(player-bar の属性が動くたび)。既存 UI を
// 拾い直すだけの経路でも refreshMeaningUi() を呼んでいたため、解説パネルを
// 開いている間、ホバー中もスクロール中も innerHTML ごと組み直されていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const initLayoutAt = uiSource.indexOf('function initLayout() {')
assert.notEqual(initLayoutAt, -1)
const reusePath = uiSource.slice(
  initLayoutAt,
  uiSource.indexOf("ui.bg = createEl('div', 'ytm-custom-bg');", initLayoutAt),
)

test('既存 UI を拾い直す経路では作り直さない', () => {
  assert.ok(!/\n\s*refreshMeaningUi\(\);/.test(reusePath), '毎回 refreshMeaningUi を呼んでいる')
})

test('初回生成時には作る', () => {
  const buildPath = uiSource.slice(
    uiSource.indexOf("ui.bg = createEl('div', 'ytm-custom-bg');", initLayoutAt),
    uiSource.indexOf('let lyricsLateRetryTimer = null;', initLayoutAt),
  )
  assert.match(buildPath, /refreshMeaningUi\(\);/)
})

test('解説データが届いた時には作り直す', () => {
  const start = uiSource.indexOf('function setLyricsMeaningData(')
  assert.notEqual(start, -1)
  const fn = uiSource.slice(start, uiSource.indexOf('\n}', start))
  assert.match(fn, /refreshMeaningUi\(\)/)
})
