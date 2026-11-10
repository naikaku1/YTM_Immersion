// 一時停止の確認を自動で閉じる(auto-continue.js)。
//
//   - 設定がオンの時だけ、出ている確認の「はい」を押す
//   - 見えていない確認(閉じた後に残っている要素)には触らない
//   - 押した直後は押し直さない
//   - 新機能は新しい module。設定のリセット・4 言語の文言・読み込み順も揃える

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const src = read('src/js/module/auto-continue.js')
const ui = read('src/js/module/lyrics-ui.js')
const ns = read('src/js/module/namespace.js')
const manifest = JSON.parse(read('manifest.json'))

// 確認ダイアログの代わり。クリックされた回数を数える
const makeDom = ({ hidden = false, display = '', buttonSelector = '#confirm-button button' } = {}) => {
  const clicks = { count: 0 }
  const button = { click: () => { clicks.count++ } }
  const holder = {
    getAttribute: (n) => (n === 'aria-hidden' && hidden ? 'true' : null),
    style: { display },
  }
  const dialog = {
    isConnected: true,
    closest: () => holder,
    querySelector: (sel) => (sel === buttonSelector ? button : null),
  }
  return { clicks, document: { querySelector: (sel) => (sel === 'ytmusic-you-there-renderer' ? dialog : null) } }
}

const load = (document, saved = true) => new Function('document', 'storage', 'setInterval', 'clearInterval',
  `${src}\nreturn AutoContinue;`)(
  document,
  { get: async () => saved },
  () => 1,
  () => {},
)

test('オンの時、出ている確認の「はい」を押す', () => {
  const { clicks, document } = makeDom()
  const mod = load(document)
  mod.setEnabled(true)
  assert.equal(mod._tick(10_000), true)
  assert.equal(clicks.count, 1)
})

test('オフの時は押さない', () => {
  const { clicks, document } = makeDom()
  const mod = load(document)
  assert.equal(mod._tick(10_000), false)
  assert.equal(clicks.count, 0)
})

test('閉じて隠れている確認には触らない', () => {
  for (const opts of [{ hidden: true }, { display: 'none' }]) {
    const { clicks, document } = makeDom(opts)
    const mod = load(document)
    mod.setEnabled(true)
    assert.equal(mod._tick(10_000), false)
    assert.equal(clicks.count, 0)
  }
})

test('確認が無い時は何もしない', () => {
  const mod = load({ querySelector: () => null })
  mod.setEnabled(true)
  assert.equal(mod._tick(10_000), false)
})

test('押した直後は押し直さない。時間が経てば次の確認を押す', () => {
  const { clicks, document } = makeDom()
  const mod = load(document)
  mod.setEnabled(true)
  mod._tick(10_000)
  assert.equal(mod._tick(11_000), false)
  assert.equal(clicks.count, 1)
  assert.equal(mod._tick(16_000), true)
  assert.equal(clicks.count, 2)
})

test('決定ボタンが見つからなくても、確認の中のボタンを押す', () => {
  const { clicks, document } = makeDom({ buttonSelector: 'button' })
  const mod = load(document)
  mod.setEnabled(true)
  assert.equal(mod._tick(10_000), true)
  assert.equal(clicks.count, 1)
})

test('保存値が true の時だけオンになる(初期はオフ)', async () => {
  const on = load({ querySelector: () => null }, true)
  await on.load()
  assert.equal(on.isEnabled(), true)
  const off = load({ querySelector: () => null }, null)
  await off.load()
  assert.equal(off.isEnabled(), false)
})

test('文言ではなく要素名で確認を探す(言語で変わるため)', () => {
  const code = src.replace(/\/\/.*$/gm, '')
  assert.match(code, /ytmusic-you-there-renderer/)
  assert.doesNotMatch(code, /[぀-ヿ一-鿿]|still listening/i)
})

test('設定のリセット対象・読み込み・保存に繋がっている', () => {
  assert.match(ui, /const SETTINGS_STORAGE_KEYS = \[[\s\S]*?'ytm_auto_continue'[\s\S]*?\];/)
  assert.match(ui, /storage\.set\('ytm_auto_continue', nextAutoContinue\)/)
  assert.match(ui, /await AutoContinue\.load\(\)/)
  assert.match(ui, /id="auto-continue-toggle"/)
})

test('manifest の content script に lyrics-ui.js より先に入っている', () => {
  const js = manifest.content_scripts[0].js
  assert.ok(js.indexOf('src/js/module/auto-continue.js') >= 0)
  assert.ok(js.indexOf('src/js/module/auto-continue.js') < js.indexOf('src/js/module/lyrics-ui.js'))
})

test('設定の文言は 4 言語ぶんある', () => {
  for (const key of ['settings_auto_continue', 'settings_auto_continue_desc']) {
    assert.equal(ns.split(`${key}:`).length - 1, 4, key)
  }
})
