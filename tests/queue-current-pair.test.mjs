// 動画モードで、曲は進むのに Up Next がずっと一番上の曲を「再生中」にしていた。
//
// 曲版と MV 版を持つ曲は、YTM のキューで 1 つの組
// (ytmusic-playlist-panel-video-wrapper-renderer)に 2 行入り、片方だけが見えている。
// 再生中の印(selected)は再生している版の行に付くので、見えていない方の行に
// 付くことがある。見える行だけで印を探すと見つからず、更新を見送り続けていた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const queueSource = fs.readFileSync(new URL('../src/js/module/queue-manager.js', import.meta.url), 'utf8')

const load = ({ videoId = null } = {}) => {
  const ctx = vm.createContext({
    document: {}, window: {}, location: { href: `https://music.youtube.com/watch?v=${videoId || ''}` },
    URL, Map, Set, Array, String,
    getCurrentVideoId: () => videoId,
  })
  vm.runInContext(`${queueSource}\nthis.QM = QueueManager;`, ctx)
  return ctx.QM
}

// pair: 組の要素(無ければ単独の行)
const item = (id, { selected = false, pair = null } = {}) => ({
  attrs: { 'data-ytmi-video-id': id, ...(selected ? { selected: '' } : {}) },
  hasAttribute(k) { return k in this.attrs },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
  querySelector: () => null,
  closest: (sel) => (sel === 'ytmusic-playlist-panel-video-wrapper-renderer' ? pair : null),
})
const pairOf = () => {
  const p = { members: [] }
  p.contains = (n) => p.members.includes(n)
  return p
}
const pairItems = (songId, mvId, { selected = null } = {}) => {
  const p = pairOf()
  const song = item(songId, { selected: selected === 'song', pair: p })
  const mv = item(mvId, { selected: selected === 'mv', pair: p })
  p.members.push(song, mv)
  return { song, mv }
}

test('印が見えている行にあれば、その行', () => {
  const QM = load()
  const rows = [item('a'), item('b', { selected: true }), item('c')]
  assert.equal(QM._findCurrentQueueIndex(rows, rows), 1)
})

test('印が組の見えていない方(MV 版)に付いていても、その組の見えている行を再生中とする', () => {
  const QM = load()
  const first = pairItems('s1', 'm1')
  const second = pairItems('s2', 'm2', { selected: 'mv' })
  const third = pairItems('s3', 'm3')
  // 見えているのは曲版の行だけ
  const visible = [first.song, second.song, third.song]
  const all = [first.song, first.mv, second.song, second.mv, third.song, third.mv]
  assert.equal(QM._findCurrentQueueIndex(visible, all), 1)
})

test('印がどこにも無い時は、再生中の videoId で引き当てる(組の見えていない方でも)', () => {
  const QM = load({ videoId: 'm3' })
  const first = pairItems('s1', 'm1')
  const second = pairItems('s2', 'm2')
  const third = pairItems('s3', 'm3')
  const visible = [first.song, second.song, third.song]
  const all = [first.song, first.mv, second.song, second.mv, third.song, third.mv]
  assert.equal(QM._findCurrentQueueIndex(visible, all), 2)
})

test('印も videoId も当たらなければ -1(描き直しを見送る今までの動き)', () => {
  const QM = load({ videoId: 'zzz' })
  const rows = [item('a'), item('b')]
  assert.equal(QM._findCurrentQueueIndex(rows, rows), -1)
})

test('syncQueue は見える行だけで印を探さない', () => {
  const sync = queueSource.slice(queueSource.indexOf('syncQueue: function'))
  assert.match(sync, /let currentIndex = this\._findCurrentQueueIndex\(visibleItems, allRawItems\);/)
})
