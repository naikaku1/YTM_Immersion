// 自動で次の曲に移った時、歌詞が一番下まで飛ぶことがあった(報告)。
// 新しい歌詞を前の曲の時刻(曲の終わり近く)で光らせると、最後の行が選ばれる。
// 曲が変わるのを見届けてから数秒は、「変わってからの経過」より大きく進んだ
// 時刻を前の曲のものとみなし、曲の頭として扱う。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const start = uiSource.indexOf('let _trackStartGuardAt = 0;')
const end = uiSource.indexOf('const getCurrentPlaybackTimeSec = () => {')

const load = () => {
  const clock = { now: 0 }
  const api = new Function('performance', `${uiSource.slice(start, end)}
    return { check: isImplausibleTrackStartTime, arm: (at) => { _trackStartGuardAt = at }, armed: () => _trackStartGuardAt };`)(
    { now: () => clock.now })
  return { clock, ...api }
}

test('曲が変わって 1 秒で 210 秒の位置は前の曲の時刻(曲の頭として扱う)', () => {
  const g = load()
  g.arm(1000)
  g.clock.now = 2000
  assert.equal(g.check(210, 1), true)
  // 曲の頭から数秒の時刻は正しい
  assert.equal(g.check(0.8, 1), false)
  assert.equal(g.check(4.5, 1), false)
})

test('見張るのは曲が変わってから 8 秒だけ。見届けていない時(途中から開いた等)は見張らない', () => {
  const g = load()
  assert.equal(g.check(210, 1), false)
  g.arm(1000)
  g.clock.now = 1000 + 9000
  assert.equal(g.check(210, 1), false)
  assert.equal(g.armed(), 0)
})

test('曲が変わった時に見張り始め、シークしたらやめる。rAF ループと時刻の読み出しの両方で使う', () => {
  assert.match(uiSource, /_trackStartGuardAt = sawTransition \? performance\.now\(\) : 0;/)
  const seeked = uiSource.slice(uiSource.indexOf("document.addEventListener('seeked'"))
  assert.match(seeked.slice(0, seeked.indexOf('}, true);')), /_trackStartGuardAt = 0;/)
  assert.match(uiSource, /if \(isImplausibleTrackStartTime\(t, _playbackRateForMotion\)\) t = 0;/)
  const read = uiSource.slice(end, uiSource.indexOf('\n};', end))
  assert.match(read, /if \(isImplausibleTrackStartTime\(t, [^)]*\)\) return 0;/)
})
