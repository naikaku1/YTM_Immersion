// Daily Replay の集計。
//
// アーティストの再生回数を { count: 0 } で作って else 側でしか加算していなかった
// ため、全アーティストが 1 回ずつ少なく出ていた。1 回しか聴いていない
// アーティストは 0 回になり、トップアーティストの並びとシェア % もずれる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/js/module/replay-manager.js', import.meta.url),
  'utf8',
)

const start = source.indexOf('getStats: async function (range = \'day\') {')
assert.notEqual(start, -1, 'getStats should be present')
const end = source.indexOf('renderUI: async function () {', start)
assert.notEqual(end, -1, 'getStats end marker should be present')
const getStatsSource = source.slice(start, end).replace(/,\s*$/, '')

const runGetStats = (history) => {
  const context = vm.createContext({
    storage: { get: async () => history },
    console,
  })
  vm.runInContext(
    `this.holder = { HISTORY_KEY: 'k', formatDuration: (s) => String(s), ${getStatsSource} }`,
    context,
  )
  return context.holder.getStats('all')
}

const play = (title, artist, overrides = {}) => ({
  title,
  artist,
  duration: 200,
  timestamp: Date.now(),
  ...overrides,
})

test('1 回しか聴いていないアーティストも 1 回と数える', async () => {
  const stats = await runGetStats([play('A', 'あ')])
  assert.equal(stats.totalPlays, 1)
  assert.equal(stats.mostPlayedArtist.count, 1)
  assert.equal(stats.topArtists[0].count, 1)
  assert.equal(stats.topArtistShare, '100%')
})

test('複数アーティストの回数とシェアが再生数と合う', async () => {
  const stats = await runGetStats([
    play('A', 'あ'),
    play('B', 'あ'),
    play('C', 'い'),
    play('D', 'う'),
  ])
  const byName = Object.fromEntries(stats.topArtists.map(a => [a.name, a.count]))
  assert.deepEqual(byName, { 'あ': 2, 'い': 1, 'う': 1 })
  assert.equal(
    stats.topArtists.reduce((sum, a) => sum + a.count, 0),
    stats.totalPlays,
  )
  assert.equal(stats.topArtistShare, '50%')
})
