import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const readSource = relativePath => fs.readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8'
)

const namespaceSource = readSource('src/js/module/namespace.js')
const lyricsUiSource = readSource('src/js/module/lyrics-ui.js')
const styleSource = readSource('src/css/style.css')
const uiTranslations = JSON.parse(readSource('src/lang/ui.json'))

test('singer color reflection is enabled by default and persisted through settings', () => {
  assert.match(namespaceSource, /useSingerColors:\s*true/)
  assert.match(lyricsUiSource, /id="singer-colors-toggle"/)
  assert.match(lyricsUiSource, /storage\.get\('ytm_singer_colors_enabled'\)/)
  assert.match(
    lyricsUiSource,
    /storage\.set\('ytm_singer_colors_enabled',\s*config\.useSingerColors\)/
  )
  assert.match(
    lyricsUiSource,
    /classList\.toggle\('ytm-singer-colors-enabled',\s*!!config\.useSingerColors\)/
  )
})

test('singer color setting has labels in every supported UI locale', () => {
  for (const lang of ['ja', 'en', 'ko', 'zh']) {
    assert.equal(typeof uiTranslations[lang]?.settings_singer_colors, 'string')
    assert.ok(uiTranslations[lang].settings_singer_colors.length > 0)
  }

  assert.match(namespaceSource, /settings_singer_colors:\s*"歌手ごとの色を歌詞に反映する"/)
  assert.match(namespaceSource, /settings_singer_colors:\s*"Apply singer colors to lyrics"/)
})

test('singer rows use parity alignment and gate custom colors behind the preference', () => {
  assert.match(
    styleSource,
    /\.lyric-line\.singer-odd\s*\{[^}]*text-align:\s*left;[^}]*transform-origin:\s*left;/s
  )
  assert.match(
    styleSource,
    /\.lyric-line\.singer-even\s*\{[^}]*text-align:\s*right;[^}]*transform-origin:\s*right;/s
  )
  assert.match(
    styleSource,
    /body\.ytm-singer-colors-enabled\s+\.lyric-line\[data-singer-color\]\s*\{\s*color:\s*var\(--ytm-singer-color\);\s*\}/s
  )
  assert.match(styleSource, /\.lyric-singer-name\s*\{/)
})
