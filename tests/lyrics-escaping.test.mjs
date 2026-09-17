// 歌詞・曲名・アーティスト名を innerHTML に生で流していた問題。
//
// 歌詞に "<" があると、そこから先が HTML として解釈されてその行が消える。
// Enhanced LRC の語タグ(<00:12.34>)が lyrics 文字列で来た場合も同じで、
// parseLRCInternal は行頭の [..] しか剥がさないため語タグが残っていた。
// Replay の Restore で読む JSON は利用者のファイルなので、任意の
// マークアップが混ざり得る。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')

const sliceBetween = (src, from, to) => {
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return src.slice(start, end)
}

// ── エスケープ本体 ──────────────────────────────────────

const escapeContext = vm.createContext({})
vm.runInContext(
  `${sliceBetween(namespaceSource, 'const escapeHtml = (value) =>', '// ── 歌詞検索に投げる曲名の正規化')}\nthis.fn = escapeHtml`,
  escapeContext,
)
const escapeHtml = escapeContext.fn

test('escapeHtml は namespace.js に 1 つだけ', () => {
  assert.equal(escapeHtml('I <3 you'), 'I &lt;3 you')
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;')
  assert.ok(!/const escapeHtml = /.test(uiSource), 'lyrics-ui.js に定義が残っている')
  assert.ok(!/function escHtml\(/.test(uiSource), 'escHtml が残っている')
})

// ── 語タグの除去 ────────────────────────────────────────

const parseContext = vm.createContext({})
vm.runInContext(
  `${sliceBetween(uiSource, 'const parseLRCInternal = (lrc) => {', 'const parseBaseLRC')}\nthis.fn = parseLRCInternal`,
  parseContext,
)
const parseLRCInternal = parseContext.fn

test('Enhanced LRC の語タグを表示文字列から落とす', () => {
  const { lines } = parseLRCInternal('[00:01.00] <00:01.00>a <00:01.50>b')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, 'a b')
})

test('タイムスタンプが無い歌詞でも語タグを落とす', () => {
  const { lines } = parseLRCInternal('<00:01.00>hello <00:02.00>world')
  assert.equal(lines[0].text, 'hello world')
})

test('歌詞の中の "<" は消さない', () => {
  const { lines } = parseLRCInternal('[00:01.00] I <3 you')
  assert.equal(lines[0].text, 'I <3 you')
})

// ── 出力側 ──────────────────────────────────────────────

test('折り返しのまとまりをエスケープしてから組む', () => {
  const fn = sliceBetween(uiSource, 'const optimizeLineBreaks = (text) => {', '\n};')
  const spans = fn.match(/<span class="lyric-phrase">\$\{[^}]+\}<\/span>/g) || []
  assert.ok(spans.length >= 2, 'lyric-phrase を組む箇所が見つからない')
  spans.forEach(span => {
    assert.match(span, /\$\{escapeHtml\((?:buffer|text)\)\}/, '生の文字列を入れている')
  })
})

test('翻訳行は textContent で入れる', () => {
  const fn = sliceBetween(uiSource, "if (line && line.translation) {", 'row.classList.add(\'has-translation\')')
  assert.ok(!/createEl\('span', '', 'lyric-translation', line\.translation\)/.test(fn),
    '翻訳文を innerHTML に流している')
  assert.match(fn, /subSpan\.textContent = line\.translation;/)
})

test('アーティストのリンクは要素として組む', () => {
  const fn = sliceBetween(uiSource, 'if (artistLinks.length > 0) {', 'retryCount++;')
  assert.ok(!/artistHTML/.test(fn), 'innerHTML で組み立てている')
  assert.match(fn, /a\.textContent = link\.textContent\.trim\(\);/)
  assert.match(fn, /a\.href = link\.href;/)
})

test('PIP と Replay は曲名・アーティスト名をエスケープする', () => {
  const pipSource = read('src/js/module/pip-manager.js')
  assert.match(pipSource, /const pipTitle = escapeHtml\(/)
  assert.match(pipSource, /const pipArtist = escapeHtml\(/)
  assert.ok(!/\$\{ui\.title\.textContent\}/.test(pipSource), 'PIP が曲名を生で流している')

  const replaySource = read('src/js/module/replay-manager.js')
  assert.ok(!/\$\{song\.title\}/.test(replaySource), 'Replay が曲名を生で流している')
  assert.ok(!/\$\{song\.artist\}/.test(replaySource), 'Replay がアーティスト名を生で流している')
  assert.match(replaySource, /\$\{escapeHtml\(song\.title\)\}/)
})

// Intl.Segmenter が無い環境では、トップレベルの new でこのファイル全体の
// 読み込みが落ちて拡張が起動しなかった。
test('Intl.Segmenter が無くても読み込みが落ちない', () => {
  assert.ok(
    !/^const _jaWordSegmenter = new Intl\.Segmenter/m.test(uiSource),
    'トップレベルで無防備に new している',
  )
  const fn = sliceBetween(uiSource, 'const _jaWordSegmenter = (() => {', '// ── 行の折り返し位置')
  assert.match(fn, /try \{/)
  assert.match(fn, /Intl\.Segmenter/)
  assert.match(fn, /return null;/)

  const opt = sliceBetween(uiSource, 'const optimizeLineBreaks = (text) => {', '\n};')
  assert.match(opt, /if \(!_jaWordSegmenter\) return/, '不在時のフォールバックが無い')
})
