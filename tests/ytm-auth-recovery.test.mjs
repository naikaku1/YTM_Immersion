// YTM 認証の無効化。
//
// 401/403 を受けたら authDisabled = true にしたきり戻す口が無く、ログインし
// 直してもそのタブが開いている限り匿名のままだった。ログイン限定の歌詞が
// セッション中ずっと取れなくなる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/js/module/ytm-lyrics.js', import.meta.url),
  'utf8',
)

const start = source.indexOf('  const AUTH_RETRY_MS = 30 * 60 * 1000;')
assert.notEqual(start, -1, 'AUTH_RETRY_MS should be present')
const end = source.indexOf('  const canAuthenticate = () => (', start)
const block = source.slice(start, end)

const load = (cookieRef, nowRef) => {
  const context = vm.createContext({
    readCookie: (name) => (name === 'SAPISID' ? cookieRef.value : ''),
    Date: { now: () => nowRef.value },
  })
  vm.runInContext(
    `${block}\nthis.isDisabled = isAuthDisabled\nthis.disable = disableAuthForNow\nthis.retryMs = AUTH_RETRY_MS`,
    context,
  )
  return context
}

test('拒否された直後は匿名で通す', () => {
  const cookie = { value: 'abc' }
  const now = { value: 1000 }
  const ctx = load(cookie, now)
  assert.equal(ctx.isDisabled(), false)
  ctx.disable()
  assert.equal(ctx.isDisabled(), true)
})

test('一定時間たてば試し直す', () => {
  const cookie = { value: 'abc' }
  const now = { value: 1000 }
  const ctx = load(cookie, now)
  ctx.disable()
  now.value = 1000 + ctx.retryMs - 1
  assert.equal(ctx.isDisabled(), true)
  now.value = 1000 + ctx.retryMs
  assert.equal(ctx.isDisabled(), false)
})

test('ログインし直したらすぐ試し直す', () => {
  const cookie = { value: 'abc' }
  const now = { value: 1000 }
  const ctx = load(cookie, now)
  ctx.disable()
  assert.equal(ctx.isDisabled(), true)
  cookie.value = 'xyz'
  assert.equal(ctx.isDisabled(), false, 'Cookie が変わっても匿名のまま')
})

test('戻す口の無い authDisabled は残っていない', () => {
  assert.ok(!/authDisabled = true/.test(source))
  assert.ok(!/let authDisabled = false/.test(source))
})
