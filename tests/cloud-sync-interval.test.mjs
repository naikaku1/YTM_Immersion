// クラウド同期の頻度。
//
// 曲が変わるたびに全履歴(最大 10,000 件)を POST していた。サーバー側 API は
// 全件受け取る作りで差分を送れないので、間隔で抑える。
// 手動の「同期」ボタンは今までどおり即時に走る。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const cloudSource = read('src/js/module/cloud-sync.js')
const uiSource = read('src/js/module/lyrics-ui.js')

const sliceBetween = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return src.slice(start, end)
}

const makeSyncIfDue = (syncNow) => {
  const context = vm.createContext({ Date, Promise, console, syncNow })
  vm.runInContext(
    `${sliceBetween(cloudSource, 'const AUTO_SYNC_INTERVAL_MS =', 'function loadInitialState()')}\nthis.fn = syncIfDue\nthis.interval = AUTO_SYNC_INTERVAL_MS`,
    context,
  )
  return context
}

test('曲送りのたびには送らない', async () => {
  let calls = 0
  const ctx = makeSyncIfDue(async () => { calls += 1; return { ok: true } })
  await ctx.fn()
  await ctx.fn()
  await ctx.fn()
  assert.equal(calls, 1, '間隔を無視して送っている')
})

test('走っている最中は重ねない', async () => {
  let calls = 0
  let release
  const ctx = makeSyncIfDue(() => {
    calls += 1
    return new Promise(r => { release = r })
  })
  const first = ctx.fn()
  await ctx.fn()
  assert.equal(calls, 1)
  release({ ok: true })
  await first
})

test('間隔は 10 分', () => {
  const ctx = makeSyncIfDue(async () => ({ ok: true }))
  assert.equal(ctx.interval, 10 * 60 * 1000)
})

test('曲の切り替わりからは syncIfDue を呼ぶ', () => {
  assert.match(uiSource, /CloudSync\.syncIfDue\(\);/)
  assert.ok(!/CloudSync\.syncNow\(\);/.test(uiSource), '無条件の syncNow が残っている')
})

test('手動の同期ボタンは今までどおり即時', () => {
  const fn = sliceBetween(cloudSource, "syncBtn.addEventListener('click'", '});')
  assert.match(fn, /syncNow\(\)/)
})
