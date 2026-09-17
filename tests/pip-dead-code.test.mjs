// PIP の空振り処理。
//
//   - document.styleSheets の href を PIP に複製していた。拾えるのは YTM 本体の
//     CSS だけで、拡張の CSS は manifest 注入なので styleSheets に href 付きでは
//     出てこない。PIP に要らない CSS を読ませるだけだった。
//   - PipManager.progressRing はどこでも生成されないのに、rAF ループが
//     毎フレーム参照していた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('スタイルシートの複製をやめた', () => {
  const pip = read('src/js/module/pip-manager.js')
  assert.ok(!/\[\.\.\.document\.styleSheets\]/.test(pip), '複製ループが残っている')
})

test('PIP 自身のスタイルは残っている', () => {
  const pip = read('src/js/module/pip-manager.js')
  assert.match(pip, /const forceStyle = pipDoc\.createElement\('style'\);/)
})

test('progressRing の空振りをやめた', () => {
  const ui = read('src/js/module/lyrics-ui.js')
  assert.ok(!/PipManager\.progressRing\.style/.test(ui), 'progressRing の参照が残っている')
  assert.ok(!/if \(PipManager\.pipWindow && PipManager\.progressRing\)/.test(ui))
})
