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

test('単語同期の取得元はゲートの後ろのまま(据え置き)', () => {
  // LyricsPlus は3ミラーとも歌詞を返さない(502 / 429 / 402)。
  // AMLL / NetEase / KuGou もよそのサーバー。毎曲叩く価値が無い。
  //
  // 4つは startRichProviders にまとめてあり、定義はゲートより前にあるが、
  // 起きるのは呼ばれた時だけ。見るべきは「どこで呼んでいるか」。
  const gateAt = indexOfAll(bgSource, 'const earlyPrimary = await Promise.race([')
  const callSites = [...bgSource.matchAll(/startRichProviders\(\)/g)].map(m => m.index)
  assert.ok(callSites.length > 0, 'startRichProviders を誰も呼んでいない')
  callSites.forEach(at => {
    assert.ok(at > gateAt, 'ゲートより前に起こしている(毎曲叩く形になっている)')
  })
  // 定義がそのまま走り出していないこと(即時実行にすると据え置きが崩れる)
  assert.doesNotMatch(bgSource, /const startRichProviders = \(\) => \{[\s\S]*?\}\(\)/)
})

test('単語同期優先の回だけ、LRCHub が速くても取得元を起こす', () => {
  // ふだんは LRCHub が 1.5 秒以内に答えたらそこで打ち切る。
  // 「単語同期 優先」は行同期で確定させたくないので、その回だけ続ける。
  const block = bgSource.slice(
    indexOfAll(bgSource, 'if (earlyPrimary && earlyPrimary !== earlyMarker) {'),
    indexOfAll(bgSource, 'if (earlyPrimary === earlyMarker) {'),
  )
  assert.match(block, /preferWordSync && deliveredHubQuality < 4/,
    '行同期止まりかどうかを見ずに起こしている')
  assert.match(block, /startRichProviders\(\)\.selections/)
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

