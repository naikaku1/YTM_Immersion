// DeepL 翻訳の叩き直しと、翻訳結果の外部送信。
//
// applyTranslations は遅着の差し替え・sub 歌詞の到着・設定保存でも走るので、
// 同じ曲で何度も DeepL を叩いて API 枠を消費していた。
// 併せて、翻訳結果を LRCHub へ POST していた REGISTER_TRANSLATION を削除した。
// 送信先 https://lrchub.coreone.work/api/translation は 404 で受け口が無く、
// 共有されないまま歌詞テキストだけがサーバーに届いていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const bgSource = read('src/js/background.js')

const sliceBetween = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return src.slice(start, end)
}

const makeCache = (translateTo) => {
  const context = vm.createContext({ Map, String, console, currentKey: 'song///artist', translateTo })
  vm.runInContext(
    `${sliceBetween(uiSource, 'const DEEPL_CACHE_MAX =', 'const translateTo = async (lines, langCode) => {')}\nthis.fn = translateWithDeepLCached\nthis.max = DEEPL_CACHE_MAX\nthis.cache = deepLTranslationCache`,
    context,
  )
  return context
}

const lines = [{ time: 0, text: 'hello' }, { time: 1, text: 'world' }]

test('同じ曲・同じ歌詞・同じ言語なら 1 回だけ叩く', async () => {
  let calls = 0
  const ctx = makeCache(async () => { calls += 1; return ['やあ', 'せかい'] })
  assert.deepEqual(await ctx.fn(lines, 'ja'), ['やあ', 'せかい'])
  assert.deepEqual(await ctx.fn(lines, 'ja'), ['やあ', 'せかい'])
  assert.deepEqual(await ctx.fn(lines, 'ja'), ['やあ', 'せかい'])
  assert.equal(calls, 1)
})

test('言語が違えば叩き直す', async () => {
  let calls = 0
  const ctx = makeCache(async () => { calls += 1; return ['a', 'b'] })
  await ctx.fn(lines, 'ja')
  await ctx.fn(lines, 'en')
  assert.equal(calls, 2)
})

test('歌詞が差し替わったら叩き直す', async () => {
  let calls = 0
  const ctx = makeCache(async () => { calls += 1; return ['a', 'b'] })
  await ctx.fn(lines, 'ja')
  await ctx.fn([{ time: 0, text: 'bye' }, { time: 1, text: 'world' }], 'ja')
  assert.equal(calls, 2)
})

test('失敗は覚えない', async () => {
  let calls = 0
  const ctx = makeCache(async () => { calls += 1; return null })
  await ctx.fn(lines, 'ja')
  await ctx.fn(lines, 'ja')
  assert.equal(calls, 2)
})

test('無制限には溜めない', async () => {
  const ctx = makeCache(async () => ['a', 'b'])
  for (let i = 0; i < ctx.max + 5; i++) {
    await ctx.fn([{ time: 0, text: `line-${i}` }], 'ja')
  }
  assert.ok(ctx.cache.size <= ctx.max)
})

test('翻訳結果を外部へ送らない', () => {
  assert.ok(!/REGISTER_TRANSLATION/.test(uiSource), 'content 側に送信が残っている')
  assert.ok(!/REGISTER_TRANSLATION/.test(bgSource), 'background 側に受け口が残っている')
  assert.ok(!/api\/translation/.test(bgSource), '翻訳の POST 先が残っている')
})
