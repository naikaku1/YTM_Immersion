// 共有翻訳の「残り文字数」表示。
//
// UI は display:none、更新タイマー(ensureCommunityRemainingTimer)はどこからも
// 呼ばれておらず、機能として死んでいた。にもかかわらず取得側は同じ URL を
// 2 回ずつ、各 20 秒タイムアウトで並べており、最大 80 秒待ち得た。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('残り文字数の実装が残っていない', () => {
  const files = [
    'src/js/module/lyrics-ui.js',
    'src/js/background.js',
    'src/js/module/api.js',
  ]
  files.forEach(f => {
    const src = read(f)
    assert.ok(!/COMMUNITY_REMAINING/.test(src), `${f} に残っている`)
    assert.ok(!/communityRemaining/.test(src), `${f} に残っている`)
    assert.ok(!/community\/remaining/.test(src), `${f} に残っている`)
  })
})

test('共有翻訳のトグル自体は残っている', () => {
  const ui = read('src/js/module/lyrics-ui.js')
  assert.match(ui, /id="shared-trans-toggle"/)
  assert.match(ui, /config\.useSharedTranslateApi = document\.getElementById\('shared-trans-toggle'\)\.checked;/)
})
