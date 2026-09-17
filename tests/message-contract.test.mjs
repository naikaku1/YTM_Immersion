// content ↔ background のメッセージ契約。
//
// 型が両側に文字列リテラルで散らばっているので、片方を消しても気づけない。
// 実際「歌詞を確定」の SELECT_LYRICS_CANDIDATE は送信側だけが残り、
// background に受け口が無いまま「必ず失敗するボタン」になっていた。
//
// ここでは送りっぱなし(受け口の無い送信)と、送る側のいない受け口を落とす。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8')

const contentFiles = [
  'src/js/content.js',
  ...fs.readdirSync(new URL('src/js/module', root))
    .filter(f => f.endsWith('.js') && !['api.js', 'bg-cloud-sync.js'].includes(f))
    .map(f => path.posix.join('src/js/module', f)),
]
const contentSource = contentFiles.map(read).join('\n')
const backgroundSource = read('src/js/background.js')

const uniq = (list) => [...new Set(list)].sort()

// content から background へ送っている型
const sentFromContent = uniq(
  (contentSource.match(/type:\s*'([A-Z][A-Z_]+)'/g) || [])
    .map(m => m.match(/'([A-Z_]+)'/)[1]),
)
// background が受ける型
const handledInBackground = uniq(
  (backgroundSource.match(/req\.type === '([A-Z_]+)'/g) || [])
    .map(m => m.match(/'([A-Z_]+)'/)[1]),
)
// background から content へ送っている型
const sentFromBackground = uniq(
  (backgroundSource.match(/type:\s*'([A-Z][A-Z_]+)'/g) || [])
    .map(m => m.match(/'([A-Z_]+)'/)[1]),
)
// content が受ける型
const handledInContent = uniq(
  (contentSource.match(/msg\.type (?:===|!==) '([A-Z_]+)'/g) || [])
    .map(m => m.match(/'([A-Z_]+)'/)[1]),
)

test('content が送る型は background が必ず受ける', () => {
  sentFromContent
    .filter(type => !handledInContent.includes(type))
    .forEach(type => {
      assert.ok(
        handledInBackground.includes(type),
        `background に受け口が無い: ${type}`,
      )
    })
})

test('background が送る型は content が必ず受ける', () => {
  sentFromBackground
    .filter(type => !handledInBackground.includes(type))
    .forEach(type => {
      assert.ok(
        handledInContent.includes(type),
        `content に受け口が無い: ${type}`,
      )
    })
})

test('送る側のいない受け口を残さない', () => {
  handledInBackground.forEach(type => {
    assert.ok(
      sentFromContent.includes(type),
      `誰も送っていない受け口: ${type}`,
    )
  })
})
