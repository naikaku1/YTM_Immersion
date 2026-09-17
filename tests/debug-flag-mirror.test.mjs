// デバッグログの有効化。
//
// README と namespace.js は localStorage の ytm_debug を立てろと言うが、
// background(Service Worker)と api.js は chrome.storage.local を見ている。
// Service Worker に localStorage は無いので、写さないと background 側の
// ログは一生出なかった。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const namespaceSource = read('src/js/module/namespace.js')

const runLog = ({ localValue, storedValue }) => {
  const calls = { set: [], remove: [] }
  const context = vm.createContext({
    console,
    localStorage: { getItem: () => localValue },
    globalThis: {
      chrome: {
        storage: {
          local: {
            get: (_k, cb) => cb(storedValue === undefined ? {} : { ytm_debug: storedValue }),
            set: (v) => calls.set.push(v),
            remove: (k) => calls.remove.push(k),
          },
        },
      },
    },
  })
  const start = namespaceSource.indexOf('const YTMLog = (() => {')
  const end = namespaceSource.indexOf('})();', start) + 5
  vm.runInContext(`${namespaceSource.slice(start, end)}\nthis.log = YTMLog`, context)
  return { calls, log: context.log }
}

test('localStorage で立てたら chrome.storage にも写す', () => {
  const { calls, log } = runLog({ localValue: '1', storedValue: undefined })
  assert.equal(log.enabled, true)
  assert.deepEqual(calls.set.map(v => v.ytm_debug), ['1'])
})

test('localStorage から消したら chrome.storage からも消す', () => {
  const { calls, log } = runLog({ localValue: null, storedValue: '1' })
  assert.equal(log.enabled, false)
  assert.deepEqual(calls.remove, ['ytm_debug'])
})

test('同じ状態なら書き込まない', () => {
  const { calls } = runLog({ localValue: '1', storedValue: '1' })
  assert.equal(calls.set.length, 0)
  assert.equal(calls.remove.length, 0)
})

test('README が両方に効くと書いてある', () => {
  assert.match(read('README.md'), /chrome\.storage\.local` にも写される/)
})
