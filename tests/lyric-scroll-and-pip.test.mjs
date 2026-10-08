import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const lyricsUiSource = read('src/js/module/lyrics-ui.js')
const pipSource = read('src/js/module/pip-manager.js')
const styleSource = read('src/css/style.css')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing marker: ${endMarker}`)
  return source.slice(start, end)
}

// 行送りのスクロールは lyric-scroll-motion.test.mjs で見ている。

// ── PIP ─────────────────────────────────────────────────

test('PIP rows rebuild their word timings from the copied markup', () => {
  // PIP へは innerHTML で複製するので JS のプロパティは消える
  const painter = sourceBetween(
    lyricsUiSource,
    'const rehydrateLyricWordRow',
    'const paintLyricWordRow',
  )
  const context = { Array, Number, String }
  vm.runInNewContext(`${painter}\nthis.rehydrate = rehydrateLyricWordRow;`, context)

  const span = {
    dataset: { wt: '1.000,1.250,1.500', we: '2.000' },
    textContent: '未だに',
    classList: { contains: () => true },
  }
  const row = { querySelectorAll: () => [span] }
  const spans = context.rehydrate(row)

  assert.equal(spans.length, 1)
  assert.deepEqual(Array.from(span._times), [1, 1.25, 1.5])
  assert.deepEqual(Array.from(span._offsets), [0, 1, 2])
  assert.equal(span._start, 1)
  assert.equal(span._end, 2)
  assert.equal(row._ytmRehydrated, true)
})

test('word timings are written to attributes so they survive the copy', () => {
  assert.match(lyricsUiSource, /wordSpan\.dataset\.wt = unit\.times/)
  assert.match(lyricsUiSource, /wordSpan\.dataset\.we = unit\.end\.toFixed\(3\)/)
})

test('measurement uses the document the line actually lives in', () => {
  // PIP は別ウィンドウ・別文書。main の document で測ると別の窓の値になる。
  const fn = sourceBetween(lyricsUiSource, 'const measureLyricLineSweep', 'const lyricSweepAt')
  assert.match(fn, /row\.ownerDocument/)
  assert.match(fn, /doc\.createRange\(\)/)
  assert.match(fn, /view \? parseFloat\(view\.getComputedStyle\(row\)/)
  assert.ok(!/[^.]\bdocument\.createRange/.test(fn), 'must not fall back to the main document')
})

test('the PIP window carries the same word-sync rules as the main window', () => {
  // 片方だけ直すと PIP で塗りが動かなくなる
  const pipCss = sourceBetween(pipSource, '.lyric-line.ytm-word-sync {', '.lyric-translation')
  for (const needed of [
    '--sweep',
    '--wx',
    'background-clip: text',
    '-webkit-text-fill-color: transparent',
    'var(--wglowr)',
    'var(--feather)',
    'transform-origin: 50% 78%',
  ]) {
    assert.ok(pipCss.includes(needed), `PIP stylesheet is missing ${needed}`)
    assert.ok(styleSource.includes(needed), `main stylesheet is missing ${needed}`)
  }
  // --sweep は型を宣言しておかないと Web Animations で動かせない。
  // 宣言は文書ごとなので、PIP にも要る。
  assert.match(pipSource, /@property --sweep \{[^}]*syntax: '<number>'/)
  assert.match(styleSource, /@property --sweep \{[\s\S]*?syntax: '<number>'/)

  // 塗りの停止位置の式がずれていないこと
  const stop = 'calc((var(--sweep) - var(--wx) - var(--feather)) * 1px)'
  assert.ok(pipCss.includes(stop), 'PIP fill stops drifted')
  assert.ok(styleSource.includes(stop), 'main fill stops drifted')
  // どちらも transform は書かない(Web Animations が動かす)
  for (const [name, css] of [['PIP', pipCss], ['main', styleSource]]) {
    const rule = css.slice(css.indexOf('.lyric-line.ytm-word-sync .lyric-word {'))
      .slice(0, 600).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/[^-]transform:/.test(rule), `${name} must not set transform itself`)
  }
})

// PIP の見た目は、この中に書いた1枚の文字列が全部。閉じ括弧をひとつ落とすと
// そこから下のルールが丸ごと前のルールの中身として捨てられ、操作ボタンが
// 素の <button>(小さな白い四角)になって左上に転がる。実際にそうなっていた。
const pipStyleSheet = (() => {
  const start = pipSource.indexOf('forceStyle.textContent = `')
  assert.notEqual(start, -1, 'PIP のスタイルの目印が変わっている')
  const from = start + 'forceStyle.textContent = `'.length
  const end = pipSource.indexOf('`;', from)
  assert.notEqual(end, -1, 'PIP のスタイルの終わりが見つからない')
  return pipSource.slice(from, end)
})()

// 行ごとの括弧の深さ。0 = ルールの外。
const cssDepthAt = (css, needle) => {
  const upto = css.indexOf(needle)
  assert.notEqual(upto, -1, `PIP stylesheet is missing ${needle}`)
  const head = css.slice(0, upto)
  return (head.match(/\{/g) || []).length - (head.match(/\}/g) || []).length
}

test('the PIP stylesheet closes every rule it opens', () => {
  const opens = (pipStyleSheet.match(/\{/g) || []).length
  const closes = (pipStyleSheet.match(/\}/g) || []).length
  assert.equal(opens, closes, 'PIP のスタイルで括弧が閉じていない')
})

test('the PIP controls keep their own rules (not swallowed by a broken block)', () => {
  // ここが 0 でなければ、前のルールが閉じられていないということ。
  for (const selector of [
    '#pip-lyrics-container .lyric-line.lyric-past {',
    '.lyric-translation {',
    '.controls-box {',
    '.control-btn {',
    '.main-btn {',
    '.sub-btn {',
    '.top-right-btn {',
  ]) {
    assert.equal(cssDepthAt(pipStyleSheet, selector), 0, `${selector} が別のルールの中に入っている`)
  }
})

test('PIP rows are measured in their own window after being copied', () => {
  assert.match(lyricsUiSource, /PipManager\.pipLyricsContainer\.querySelectorAll\('\.lyric-line\.ytm-word-sync, \.lyric-bg\.ytm-bg-sync'\)/)
  assert.match(lyricsUiSource, /if \(!row\._ytmWordSpans && !row\._ytmRehydrated\) rehydrateLyricWordRow\(row\)/)
})

test('a resized PIP window re-measures too', () => {
  const fn = sourceBetween(lyricsUiSource, 'const invalidateLyricLineSweeps', 'const resetLyricWordRow')
  assert.match(fn, /PipManager\.pipLyricsContainer/)
})

// ── 折り返し ────────────────────────────────────────────

const phraseSource = sourceBetween(
  lyricsUiSource,
  'const LYRIC_PHRASE_RULES',
  'const optimizeLineBreaks',
)

function loadPhrases() {
  const context = { Set, RegExp }
  vm.runInNewContext(
    `${phraseSource}
     this.merge = shouldMergeLyricSegments;
     this.group = groupLyricUnitsIntoPhrases;`,
    context,
  )
  return context
}

const units = (...texts) => texts.map(t => ({
  type: /^\s+$/.test(t) ? 'space' : 'word',
  text: t,
}))

test('a particle never starts a new line on its own', () => {
  const { group } = loadPhrases()
  const phrases = group(units('未だに', 'あなた', 'の', 'こと', 'を', '夢', 'に', 'みる'))
  for (const phrase of phrases) {
    assert.ok(
      !['の', 'を', 'に', 'は', 'が'].includes(phrase[0].text),
      `a phrase must not begin with a particle: ${phrase[0].text}`,
    )
  }
  assert.ok(phrases.length > 1, 'the line must still be breakable somewhere')
})

test('a small kana never falls to the start of a line', () => {
  const { merge } = loadPhrases()
  assert.equal(merge('ち', 'ゃ'), true)
  assert.equal(merge('き', 'ゅ'), true)
})

test('an opening bracket starts a new phrase instead of trailing the previous one', () => {
  const { merge } = loadPhrases()
  assert.equal(merge('夢', '「'), false)
  assert.equal(merge('夢', '」'), true)
})

test('the synced and unsynced paths break lines by the same rule', () => {
  // 同じ曲の中で、同期のある行と無い行で折り返しが変わると目立つ
  assert.match(lyricsUiSource, /const shouldMergeLyricSegments = \(word, nextWord\) => \{/)
  const optimize = sourceBetween(lyricsUiSource, 'const optimizeLineBreaks', '\nfunction renderLyrics')
  assert.match(optimize, /shouldMergeLyricSegments\(word, next\.segment\)/)
  const grouping = sourceBetween(lyricsUiSource, 'const groupLyricUnitsIntoPhrases', 'const optimizeLineBreaks')
  assert.match(grouping, /shouldMergeLyricSegments\(units\[i\]\.text, next\.text\)/)
})

test('synced phrases carry no extra side margin', () => {
  // 中の語がすでに inline-block なので、外側で余白を足すと
  // 語と語の間だけ広がって字の間が不揃いに見える
  const rule = sourceBetween(styleSource, '.lyric-phrase.lyric-phrase-sync {', '}')
  assert.match(rule, /margin:\s*0;/)
  assert.match(lyricsUiSource, /'lyric-phrase lyric-phrase-sync'/)
})
