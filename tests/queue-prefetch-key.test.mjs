// キューの先読みキャッシュ。
//
// 先読みのキーは .byline の textContent をそのままアーティストにしていたが、
// byline は「アーティスト • アルバム • 年」のことがある。本再生側
// (getMetadata)は先頭だけをアーティストとして扱うので、キーが食い違って
// 先読みが一度も当たらず、storage に別キーで溜まり続けていた。
// videoId が無い行も先読みしていたが、本再生側は video_id 一致を要求するので
// 拾われない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const namespaceSource = read('src/js/module/namespace.js')
const queueSource = read('src/js/module/queue-manager.js')
const uiSource = read('src/js/module/lyrics-ui.js')

const start = namespaceSource.indexOf('const splitBylineParts = (text) =>')
assert.notEqual(start, -1, 'splitBylineParts should be present')
const end = namespaceSource.indexOf('// ── 歌詞検索に投げる曲名の正規化', start)
const context = vm.createContext({ String, Array })
vm.runInContext(
  `${namespaceSource.slice(start, end)}\nthis.split = splitBylineParts\nthis.artist = parseBylineArtist`,
  context,
)

test('byline からアーティストだけを取り出す', () => {
  assert.equal(context.artist('歌手 • アルバム • 2024'), '歌手')
  assert.equal(context.artist('歌手'), '歌手')
  assert.equal(context.artist(''), '')
  assert.equal(context.artist(null), '')
  assert.deepEqual([...context.split('歌手 • アルバム • 2024')], ['歌手', 'アルバム', '2024'])
})

test('キューも本再生と同じ切り出し方を使う', () => {
  assert.match(queueSource, /const artist = parseBylineArtist\(bylineText\);/)
  assert.ok(
    !/const artist = artistEl \? artistEl\.textContent\.trim\(\) : ''/.test(queueSource),
    'byline を丸ごとアーティストにしている',
  )
  assert.match(uiSource, /const parts = splitBylineParts\(aEl\.textContent\);/)
})

test('videoId が取れた時だけ先読みする', () => {
  assert.match(queueSource, /if \(renderedCount === 1 && videoId\) \{/)
})

test('画面に出す文字はこれまでどおり byline 全体', () => {
  assert.match(queueSource, /class="queue-artist">\$\{this\._escapeHtml\(bylineText\)\}/)
})
