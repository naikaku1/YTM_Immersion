// Discord 連携の同期の回数。
//
// 再生中は <video> の timeupdate(1 秒 4 回)と 500ms のタイマーが重なり、
// そのたびに曲名・動画 ID・広告・今の歌詞をページから読み直していた。
// 「変わっていないか見る」だけの回は間引き、再生・停止・シークはその場で見る。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/js/module/now-playing.js', import.meta.url), 'utf8')

const load = ({ enabled = true } = {}) => {
  const clock = { now: 1_000_000 }
  const state = { reads: 0, sent: [], timer: null }
  const mediaListeners = new Map()
  const media = {
    paused: false, ended: false, readyState: 4, currentTime: 10, duration: 200, playbackRate: 1,
    addEventListener: (name, fn) => mediaListeners.set(name, fn),
    removeEventListener: () => {},
  }
  class FakeDate extends Date { static now() { return clock.now } }
  const context = vm.createContext({
    Date: FakeDate, JSON, Math, Number, URL, TextEncoder, Promise, Object,
    crypto: { randomUUID: () => 'session' },
    chrome: {
      runtime: {
        id: 'ext', lastError: null,
        sendMessage: (message, done) => { state.sent.push(message); done({ ok: true }) },
        onMessage: { addListener() {} },
      },
      storage: {
        local: { get: (_key, cb) => cb({ ytm_discord_enabled: enabled }) },
        onChanged: { addListener() {} },
      },
    },
    document: {
      querySelector: (selector) => (selector.startsWith('video') ? media : null),
      addEventListener() {},
    },
    window: { addEventListener() {} },
    setInterval: (fn) => { state.timer = fn },
    config: {},
    // ページから読み直すもの。呼ばれた回数を数える
    getMetadata: () => { state.reads += 1; return { title: 'Song', artist: 'Artist', album: '', src: 'https://example.com/a.jpg' } },
    getCurrentVideoId: () => 'video123456',
    isAdPlayingNow: () => false,
  })
  vm.runInContext(source, context)
  return { clock, state, fire: (type) => mediaListeners.get(type)({ type }) }
}

test('再生中の見直しは 1 秒 2 回ほどに収まる', () => {
  const { clock, state, fire } = load()
  state.reads = 0
  // 1 秒ぶん: timeupdate が 250ms ごと、タイマーが 500ms ごと
  for (let ms = 0; ms < 1000; ms += 250) {
    clock.now += 250
    fire('timeupdate')
    if (ms % 500 === 250) state.timer()
  }
  assert.ok(state.reads <= 3, `1 秒に ${state.reads} 回読み直している`)
  assert.ok(state.reads >= 2, '見直しが止まっている')
})

test('再生・停止・シークは間引かず、その場で見る', () => {
  const { clock, state, fire } = load()
  state.reads = 0
  clock.now += 10
  fire('pause')
  clock.now += 10
  fire('seeked')
  clock.now += 10
  fire('play')
  assert.equal(state.reads, 3)
})

test('連携を切っている間は、ページを読み直さない', () => {
  const { clock, state } = load({ enabled: false })
  state.reads = 0
  // 切っている間は <video> のイベントも聞いていない。来るのはタイマーだけ
  for (let i = 0; i < 8; i++) { clock.now += 500; state.timer() }
  assert.equal(state.reads, 0)
  assert.equal(state.sent.length, 0)
})
