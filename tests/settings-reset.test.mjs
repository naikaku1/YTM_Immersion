// 「設定をリセット」の範囲。
//
// 以前は storage.clear で chrome.storage.local を丸ごと空にしていた。
// 説明文は「拡張機能のすべての設定を初期状態に戻します」としか書いていないのに、
// Daily Replay の再生履歴・歌詞キャッシュ・クラウドの復活の呪文まで消えていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const cloudSource = read('src/js/module/cloud-sync.js')

const start = uiSource.indexOf('const SETTINGS_STORAGE_KEYS = [')
assert.notEqual(start, -1, 'SETTINGS_STORAGE_KEYS should be present')
const end = uiSource.indexOf('];', start) + 2
const context = vm.createContext({})
vm.runInContext(`${uiSource.slice(start, end)}\nthis.keys = SETTINGS_STORAGE_KEYS`, context)
const keys = context.keys

test('消すのは設定のキーだけ', () => {
  assert.ok(keys.length > 10)
  keys.forEach(k => assert.match(k, /^ytm_/))
  assert.ok(!keys.includes('ytm_local_history'), '再生履歴を消している')
  assert.ok(!keys.includes('ytm_meaning_pinned_songs'), 'ピン留めを消している')
  assert.ok(!keys.some(k => k.includes('///')), '歌詞キャッシュを消している')
})

test('設定パネルが書き込むキーを取りこぼしていない', () => {
  const saveStart = uiSource.indexOf('    await Promise.all([\n      storage.set(\'ytm_deepl_key\'')
  assert.notEqual(saveStart, -1, '保存箇所の目印が変わっている')
  const saveBlock = uiSource.slice(saveStart, uiSource.indexOf('    ]);', saveStart))
  const written = [...saveBlock.matchAll(/storage\.set\('(ytm_[a-z_]+)'/g)].map(m => m[1])
  assert.ok(written.length > 10)
  written.forEach(k => {
    assert.ok(keys.includes(k), `リセットの対象から漏れている: ${k}`)
  })
})

test('storage.clear は残っていない', () => {
  assert.ok(!/clear: \(\) =>/.test(cloudSource), 'storage.clear が残っている')
  assert.ok(
    !/document\.getElementById\('clear-all-btn'\)\.onclick = storage\.clear/.test(uiSource),
    'リセットボタンが全消去に繋がっている',
  )
  assert.match(uiSource, /SETTINGS_STORAGE_KEYS\.map\(key => storage\.remove\(key\)\)/)
})
