// 取得の並列化。
//
// 3つの取得元(YouTube Music / LRCHub / LrcLib / SimpMusic)を同時に走らせて
// も、待ち方が直列だと意味が無い。実際に次の2つが直列に潰れていた。
//
//   - YTM: next → browse の2段(各5秒)を無条件に待ち切っていた。LRCHub が
//     300ms で答えていても最大10秒ほど白紙になる。
//   - SimpMusic: LRCHub を待つ 1.5 秒が明けてから起動していた。実測で
//     LRCHub の応答は 212〜4933ms とばらつき、4曲中2曲が 1.5 秒を超えた。
//     その回、SimpMusic は 336〜683ms で答えられたのに待たされていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const bgSource = read('src/js/background.js')

const indexOfAll = (src, needle) => {
  const at = src.indexOf(needle)
  assert.ok(at !== -1, `目印が見つからない: ${needle}`)
  return at
}

// ── YouTube Music ────────────────────────────────────────

test('YTM の待ちには上限がある', () => {
  assert.match(uiSource, /const YTM_EARLY_WAIT_MS = \d+;/)
  // 素の await ytmPromise が最初の待ちに戻っていないこと
  assert.doesNotMatch(
    uiSource,
    /const ytmEarly = preferYtmSource \? await ytmPromise : null/,
    '上限なしで待ち切る形に戻っている',
  )
  assert.match(uiSource, /ytmWaitTimedOut/)
})

test('上限で打ち切った回は待ち直さない', () => {
  // ここで await ytmPromise すると、上の上限が無意味になる
  assert.match(
    uiSource,
    /if \(ytmWaitTimedOut && backgroundHasLyrics\) \{\s*\n\s*scheduleYtmLateUpgrade\(\);/,
  )
})

test('打ち切った YTM は届いた時に差し替えを試みる', () => {
  assert.match(uiSource, /const scheduleYtmLateUpgrade = \(\) => \{/)
  // 曲が変わっていたら捨てること
  const fn = uiSource.slice(
    indexOfAll(uiSource, 'const scheduleYtmLateUpgrade'),
    indexOfAll(uiSource, 'const backgroundPromise = safeRuntimeSendMessage'),
  )
  assert.match(fn, /lateKey !== currentKey/)
  assert.match(fn, /lateRequestId !== activeLyricsRequestId/)
  assert.match(fn, /applyLateLyricsUpgrade\(/)
  assert.match(fn, /late\.hasSynced/, '同期歌詞の時だけ差し替えること')
})

test('YTM の取得自体は今までどおり background と同時に始まる', () => {
  const between = uiSource.slice(
    indexOfAll(uiSource, 'const ytmPromise = (window.YTMLyrics && video_id)'),
    indexOfAll(uiSource, 'const backgroundPromise = safeRuntimeSendMessage'),
  )
  assert.doesNotMatch(between, /\bawait\b/, '2つの起動の間に待ちが入っている')
})

// ── SimpMusic ────────────────────────────────────────────

test('SimpMusic は LRCHub を待つゲートより前に始まる', () => {
  const simpAt = indexOfAll(bgSource, 'const simpMusicRawTask =')
  const gateAt = indexOfAll(bgSource, 'const earlyPrimary = await Promise.race([')
  assert.ok(simpAt < gateAt, 'ゲートの後ろで起動している(1.5秒ぶん遅れる)')
})

test('LyricsPlus は据え置き(ゲートの後ろのまま)', () => {
  // 3ミラーとも歌詞を返さない(502 / 429 / 402)。毎曲叩く価値が無い
  const plusAt = indexOfAll(bgSource, 'const lyricsPlusRawTask =')
  const gateAt = indexOfAll(bgSource, 'const earlyPrimary = await Promise.race([')
  assert.ok(plusAt > gateAt, 'LyricsPlus まで毎曲叩く形になっている')
})

test('LRCHub が遅い回の先出しは、文字同期の SimpMusic を優先する', () => {
  const block = bgSource.slice(
    indexOfAll(bgSource, 'if (earlyPrimary === earlyMarker) {'),
    indexOfAll(bgSource, 'const searchRawTask ='),
  )
  assert.match(block, /simpMusicSettled && hasCharacterSyncedLines\(/,
    '文字同期を確かめずに先出ししている')
  assert.ok(
    block.indexOf('simpMusicSettled') < block.indexOf('lrcLibSettled'),
    '行同期の LrcLib を先に出している(直後に差し替わってちらつく)',
  )
})

test('LRCHub が即答で「持っていない」時は先出ししない', () => {
  // 先出しは「遅かった」回だけ。即答の回まで先出しすると、
  // そのあと来る単語同期に勝たせる機会を奪う
  assert.match(bgSource, /if \(earlyPrimary === earlyMarker\) \{/)
})

