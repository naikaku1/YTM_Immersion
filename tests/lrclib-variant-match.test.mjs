// LrcLib の候補選び。
//
// 以前はアーティスト名しか見ておらず、条件に合う「最初の1件」を返していた。
// 同じ曲の別テイク(「曲名」と「曲名 - From THE FIRST TAKE」など)が
// 並んでいると、再生中の動画と無関係な方を掴んだまま最初から最後まで
// ずれ続ける。曲名と尺で点を付けて選び直せるようにした。
//
// 段の順番(完全一致アーティスト→部分一致、同期あり→なし)は変えていない。
// 変えたのは「段の中でどれを取るか」だけなので、今まで歌詞が出ていた曲が
// 空振りになることはない。

import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.chrome = globalThis.chrome || {
  storage: { local: { get: (keys, cb) => cb({}) } },
}

const API = await import('../src/js/module/api.js')

const synced = '[00:01.00] line'
const plain = 'line'

const studio = {
  id: 1,
  trackName: 'テスト曲',
  artistName: 'テスト歌手',
  duration: 249,
  syncedLyrics: synced,
}
const firstTake = {
  id: 2,
  trackName: 'テスト曲 - From THE FIRST TAKE',
  artistName: 'テスト歌手',
  duration: 250,
  syncedLyrics: synced,
}
const shortEdit = {
  id: 3,
  trackName: 'テスト曲',
  artistName: 'テスト歌手',
  duration: 92,
  syncedLyrics: synced,
}

test('曲名が完全一致する版を選ぶ (別テイクを再生している時)', () => {
  const hit = API.pickBestLrcLibHit([studio, firstTake], 'テスト歌手', {
    track: 'テスト曲 - From THE FIRST TAKE',
    durationSec: 250,
  })
  assert.equal(hit.id, firstTake.id)
})

test('素の曲を再生している時に別テイクを掴まない', () => {
  const hit = API.pickBestLrcLibHit([firstTake, studio], 'テスト歌手', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit.id, studio.id)
})

test('曲名が同じなら尺で決める', () => {
  const hit = API.pickBestLrcLibHit([shortEdit, studio], 'テスト歌手', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit.id, studio.id)
})

test('手掛かりが無ければ従来どおり最初の1件', () => {
  const hit = API.pickBestLrcLibHit([firstTake, studio], 'テスト歌手')
  assert.equal(hit.id, firstTake.id)
})

test('曲名が完全一致でも、同期なしより同期ありを優先する (従来の段の順番)', () => {
  const exactButPlain = {
    id: 4,
    trackName: 'テスト曲',
    artistName: 'テスト歌手',
    duration: 249,
    plainLyrics: plain,
  }
  const hit = API.pickBestLrcLibHit([exactButPlain, firstTake], 'テスト歌手', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit.id, firstTake.id)
})

test('アーティストが一致しなければ従来どおり選ばない', () => {
  const hit = API.pickBestLrcLibHit([studio], '別の歌手', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit, null)
})

test('尺が大きく外れていても曲名の完全一致は覆らない', () => {
  const wrongDurationExact = {
    id: 5,
    trackName: 'テスト曲',
    artistName: 'テスト歌手',
    duration: 400,
    syncedLyrics: synced,
  }
  const rightDurationOther = {
    id: 6,
    trackName: 'ぜんぜん違う曲',
    artistName: 'テスト歌手',
    duration: 249,
    syncedLyrics: synced,
  }
  const hit = API.pickBestLrcLibHit([rightDurationOther, wrongDurationExact], 'テスト歌手', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit.id, wrongDurationExact.id)
})

test('曲名の表記ゆれ(全角空白・大文字小文字)を吸収する', () => {
  const spaced = {
    id: 7,
    trackName: 'Test　Song',
    artistName: 'テスト歌手',
    duration: 249,
    syncedLyrics: synced,
  }
  const other = {
    id: 8,
    trackName: 'Another Song',
    artistName: 'テスト歌手',
    duration: 249,
    syncedLyrics: synced,
  }
  const hit = API.pickBestLrcLibHit([other, spaced], 'テスト歌手', {
    track: 'test song',
    durationSec: 249,
  })
  assert.equal(hit.id, spaced.id)
})

// アーティスト名が取れない曲(MediaSession 未設定・UGC など)がある。
// 以前は target が空の時点で null を返していたので、検索結果があっても
// 歌詞が採用されなかった。候補メニューには並ぶのに何も出ない状態になる。
test('アーティスト名が無くても曲名と尺で選ぶ', () => {
  const right = {
    id: 20,
    trackName: 'テスト曲',
    artistName: '誰か',
    duration: 249,
    syncedLyrics: synced,
  }
  const wrong = {
    id: 21,
    trackName: 'ぜんぜん違う曲',
    artistName: '別の誰か',
    duration: 400,
    syncedLyrics: synced,
  }
  const hit = API.pickBestLrcLibHit([wrong, right], '', {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.ok(hit, 'アーティスト名が無いだけで諦めている')
  assert.equal(hit.id, right.id)
})

test('アーティスト名が無い時も同期歌詞を時刻なしより優先する', () => {
  const plainOnly = {
    id: 22,
    trackName: 'テスト曲',
    artistName: '誰か',
    duration: 249,
    plainLyrics: plain,
  }
  const syncedHit = {
    id: 23,
    trackName: 'テスト曲',
    artistName: '別の誰か',
    duration: 249,
    syncedLyrics: synced,
  }
  const hit = API.pickBestLrcLibHit([plainOnly, syncedHit], null, {
    track: 'テスト曲',
    durationSec: 249,
  })
  assert.equal(hit.id, syncedHit.id)
})

test('候補が空なら今までどおり null', () => {
  assert.equal(API.pickBestLrcLibHit([], '', { track: 'テスト曲' }), null)
  assert.equal(
    API.pickBestLrcLibHit([{ id: 24, trackName: 'テスト曲' }], '', { track: 'テスト曲' }),
    null,
    '歌詞を持たない項目を拾っている',
  )
})
