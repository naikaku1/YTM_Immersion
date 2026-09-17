// LRCHub への1曲あたりの往復回数。
//
//   - 同じパラメータの primary と retry を必ず同時に投げていた(常に2往復)。
//   - 検索でぶら下がった候補を最大 30 件、直列に /api/record で引いていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const bgSource = read('src/js/background.js')
const apiSource = read('src/js/module/api.js')

test('引き直しは primary が答えられなかった時だけ', () => {
  assert.match(bgSource, /const retryRawTask = primarySelectionTask\.then\(result => \(result \? null : startRetry\(\)\)\);/)
  assert.match(bgSource, /const retrySelectionTask = primarySelectionTask\.then\(result => \(/)
  // 無条件に makeRawHubTask で作る形に戻っていないこと
  assert.ok(
    !/const retryRawTask = makeRawHubTask\(/.test(bgSource),
    '引き直しを無条件に投げている',
  )
})

test('引き直しは二重に走らない', () => {
  const start = bgSource.indexOf('const startRetry = () => {')
  assert.notEqual(start, -1)
  const fn = bgSource.slice(start, bgSource.indexOf('};', start))
  assert.match(fn, /if \(!retryStarted\)/)
})

test('候補の引き直しは上限つき', () => {
  assert.match(apiSource, /const LRCHUB_CANDIDATE_LOOKUP_LIMIT = 3;/)
  assert.match(apiSource, /const lookupCount = Math\.min\(candidates\.length, LRCHUB_CANDIDATE_LOOKUP_LIMIT\);/)
  assert.match(apiSource, /for \(let i = 0; i < lookupCount; i\+\+\)/)
})
