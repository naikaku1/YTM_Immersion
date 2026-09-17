// 「代替バージョンを検索」の InnerTube 呼び出し。
//
// lyrics-ui.js に API キー直書き・hl/gl 固定('ja'/'JP')・タイムアウト無しの
// 別実装があり、ytm-lyrics.js の post と二重になっていた。片方だけ直すと
// 食い違うので、ytm-lyrics.js 側に寄せる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const ytmSource = read('src/js/module/ytm-lyrics.js')

test('API キーを直書きしていない', () => {
  assert.ok(!/AIzaSy/.test(uiSource), 'API キーが残っている')
  assert.ok(!/youtubei\/v1\/search/.test(uiSource), '別実装の呼び出しが残っている')
})

test('検索は ytm-lyrics.js の post を通す', () => {
  assert.match(ytmSource, /search: \(query, params\) => post\(/)
  assert.match(uiSource, /await window\.YTMLyrics\.search\(q\)/)
})

test('検索は匿名で撃つ(利用者の検索履歴を汚さない)', () => {
  const start = ytmSource.indexOf('search: (query, params) => post(')
  const fn = ytmSource.slice(start, ytmSource.indexOf('),', start))
  assert.match(fn, /auth: false/)
})

test('post 側はタイムアウトを持っている', () => {
  const start = ytmSource.indexOf('const post = async (endpoint, client, extra, opts = {}) => {')
  assert.notEqual(start, -1)
  const fn = ytmSource.slice(start, start + 600)
  assert.match(fn, /new AbortController\(\)/)
  assert.match(fn, /controller\.abort\(\), TIMEOUT_MS/)
})

test('使えない時は空で返す', () => {
  const start = uiSource.indexOf('async function searchYTMAlternatives(meta) {')
  const fn = uiSource.slice(start, uiSource.indexOf('\n}', start))
  assert.match(fn, /typeof window\.YTMLyrics\.search !== 'function'/)
})
