// 毎フレーム・毎 tick の同じ探し物。
//
//   - 行どうしの突き合わせ文字列(NFKC 正規化 + 記号落とし)を毎フレーム作り直す
//   - 字幕の受け皿を毎フレーム querySelector で探す
//   - initLayout が tick のたびに UI の参照を getElementById で十数回拾い直す
//   - シークバーの属性変化のたびに、tick を予約済みでも mutation を全部見る

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const uiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = uiSource.indexOf(from)
  const end = uiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return uiSource.slice(start, end)
}

test('突き合わせ文字列は行に覚えさせる', () => {
  let calls = 0
  const context = vm.createContext({
    normalizeLyricCompareTextStrict(text) {
      calls += 1
      return String(text || '').toLowerCase()
    },
  })
  vm.runInContext(
    `${sliceBetween('const lyricCompareText = (line) => {', 'function updateLyricHighlight')}\nthis.fn = lyricCompareText`,
    context,
  )
  const line = { text: 'Hello' }
  assert.equal(context.fn(line), 'hello')
  assert.equal(context.fn(line), 'hello')
  assert.equal(context.fn(line), 'hello')
  assert.equal(calls, 1, '毎回作り直している')
})

test('text が差し替わったら作り直す', () => {
  let calls = 0
  const context = vm.createContext({
    normalizeLyricCompareTextStrict(text) {
      calls += 1
      return String(text || '').toLowerCase()
    },
  })
  vm.runInContext(
    `${sliceBetween('const lyricCompareText = (line) => {', 'function updateLyricHighlight')}\nthis.fn = lyricCompareText`,
    context,
  )
  const line = { text: 'Hello' }
  context.fn(line)
  line.text = 'World'
  assert.equal(context.fn(line), 'world', '古い結果を返している')
  assert.equal(calls, 2)
})

test('字幕の受け皿は覚えて使い回す', () => {
  const context = vm.createContext({})
  vm.runInContext(
    `${sliceBetween('const findAnimatedCaptionStage = (container) => {', 'function updateAnimatedCaptionStage')}\nthis.fn = findAnimatedCaptionStage`,
    context,
  )
  let queries = 0
  const stage = { isConnected: true }
  const container = {
    contains: (el) => el === stage,
    querySelector: () => { queries += 1; return stage },
  }
  assert.equal(context.fn(container), stage)
  assert.equal(context.fn(container), stage)
  assert.equal(queries, 1, '毎回探している')

  // 歌詞を組み直して受け皿が入れ替わったら探し直す
  stage.isConnected = false
  context.fn(container)
  assert.equal(queries, 2, '入れ替わっても探し直していない')
})

test('initLayout は UI がそのまま居るなら何もしない', () => {
  const fn = sliceBetween('function initLayout() {', 'const existingWrapper')
  assert.match(fn, /ui\.wrapper && ui\.wrapper\.isConnected/)
  assert.match(fn, /document\.getElementById\('ytm-custom-wrapper'\) === ui\.wrapper/)
})

test('tick を予約済みなら mutation を見ない', () => {
  const fn = sliceBetween('const observer = new MutationObserver((mutations) => {', 'observer.observe(targetNode')
  const guardAt = fn.indexOf('if (_tickScheduled) return;')
  const someAt = fn.indexOf('mutations.some(')
  assert.ok(guardAt !== -1, '予約済みの打ち切りが無い')
  assert.ok(guardAt < someAt, '全部見てから打ち切っている')
})
