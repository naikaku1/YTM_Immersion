// 動画/曲の切り替えが使えるかの判定。
//
// 以前はサイドガイドの項目数(childNodes.length >= 4)で非 Premium と
// 判断していた。YTM の UI が変わるだけで判定が裏返り、動画モードの
// セットアップが走らなくなったり、走るべきでない時に走ったりする。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const start = uiSource.indexOf('function isYTMPremiumUser() {')
assert.notEqual(start, -1)
const fnSource = uiSource.slice(start, uiSource.indexOf('\n}', start) + 2)

const run = (switcher) => {
  const context = vm.createContext({
    document: { querySelector: (sel) => (sel === 'ytmusic-av-toggle' ? switcher : null) },
  })
  vm.runInContext(`${fnSource}\nthis.fn = isYTMPremiumUser`, context)
  return context.fn()
}

const makeSwitcher = (mode) => {
  const classes = new Set()
  return {
    hasAttribute: (name) => name === 'playback-mode' && mode !== undefined,
    classList: {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name) },
      has: (name) => classes.has(name),
    },
    _classes: classes,
  }
}

test('トグルがあって playback-mode を持っていれば切り替えられる', () => {
  const switcher = makeSwitcher('ATV_PREFERRED')
  assert.equal(run(switcher), true)
  assert.ok(!switcher._classes.has('notpremium'))
})

test('トグルが無ければ切り替えられない', () => {
  assert.equal(run(null), false)
})

test('playback-mode が無ければ notpremium を付ける', () => {
  const switcher = makeSwitcher(undefined)
  assert.equal(run(switcher), false)
  assert.ok(switcher._classes.has('notpremium'))
})

test('ガイドの項目数を見ていない', () => {
  assert.ok(!/childNodes\.length >= 4/.test(fnSource), '項目数で判定している')
  assert.ok(!/ytmusic-guide-signin-promo-renderer/.test(fnSource))
})
