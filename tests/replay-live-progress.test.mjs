// 再生履歴の書き込み。
//
// 聴いている間、30 秒ごとに履歴(最大 1 万件・2MB 余り)をまるごと読んで、
// 最後の 1 件の秒数だけ直して書き戻していた。chrome.storage は書き込みのたびに
// 変更を見張っている所へ古い値と新しい値を丸ごと配るので、履歴が育った人ほど、
// 再生しているだけで重くなっていた。
//
// しかも 30 秒はバックグラウンド(サービスワーカー)が眠るまでの時間と同じで、
// 再生している間じゅう起こし続けていた。chrome.storage の小さなキーに書いても起きる。
//
// ・途中経過は、ページの localStorage の小さな 1 件にだけ書く(chrome.storage に触らない)
// ・履歴に畳むのは、次の曲を記録する時(1 回の再生につき、まるごとの読み書きは 1 度)
// ・履歴を読む側(集計・書き出し・クラウド同期)は、畳む前でも同じ数字になる

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const source = read('src/js/module/replay-manager.js')
const cloudSource = read('src/js/module/cloud-sync.js')

const makeManager = (initial = {}) => {
  const { local = {}, ...stored } = initial
  const store = new Map(Object.entries(stored))
  const ops = []
  // ページの localStorage の代わり
  const page = new Map(Object.entries(local).map(([k, v]) => [k, JSON.stringify(v)]))
  const live = () => (page.has(L) ? JSON.parse(page.get(L)) : null)
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
  const context = vm.createContext({
    console, Date, Number, Object, Array, JSON, Math, String, setTimeout,
    storage: {
      get: async (k) => { ops.push(['get', k]); return store.has(k) ? clone(store.get(k)) : null },
      set: async (k, v) => { ops.push(['set', k]); store.set(k, clone(v)) },
      remove: async (k) => { ops.push(['remove', k]); store.delete(k) },
    },
    localStorage: {
      getItem: (k) => (page.has(k) ? page.get(k) : null),
      setItem: (k, v) => { page.set(k, String(v)) },
      removeItem: (k) => { page.delete(k) },
    },
    ui: { replayPanel: null },
    config: { uiLang: 'ja' },
    t: (k) => k,
    getMetadata: () => ({ title: 'T', artist: 'A', src: null }),
    parseBylineArtist: (s) => s,
    document: { querySelector: () => null },
  })
  vm.runInContext(`${source}\nthis.mgr = ReplayManager`, context)
  return { mgr: context.mgr, store, ops, live, page }
}

const H = 'ytm_local_history'
const L = 'ytmi_replay_live'

test('途中経過は localStorage にだけ書き、chrome.storage には触らない', async () => {
  const { mgr, store, ops, live } = makeManager({ [H]: [{ id: 'old', title: 'x', artist: 'y', duration: 100, lyricLines: 3, timestamp: 1 }] })
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  ops.length = 0

  mgr.currentPlayTime = 61
  mgr.currentLyricLines = 9
  await mgr.updateDuration()
  assert.equal(ops.length, 0, `chrome.storage を読み書きしている: ${JSON.stringify(ops)}`)
  const entries = Object.values(live())
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'song')
  assert.equal(entries[0].duration, 61)
  assert.equal(entries[0].lyricLines, 9)
  // 履歴の本体は記録した時のまま
  assert.equal(store.get(H).at(-1).duration, 31)
})

test('履歴を読む側には、途中経過まで入った数字が出る', async () => {
  const { mgr } = makeManager({ [H]: [] })
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  mgr.currentPlayTime = 200
  mgr.currentLyricLines = 40
  await mgr.updateDuration()

  const history = await mgr.loadHistory()
  assert.equal(history.length, 1)
  assert.equal(history[0].duration, 200)
  assert.equal(history[0].lyricLines, 40)
  const stats = await mgr.getStats('all')
  assert.equal(stats.totalPlays, 1)
  assert.equal(stats.totalLyrics, '40')
})

test('次の曲を記録する時に畳み、途中経過を消す', async () => {
  const { mgr, store, live } = makeManager({ [H]: [] })
  mgr.currentVideoId = 'first'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  // 曲が変わる時、check は前の曲の残りを書く
  await mgr.updateDuration('first', 187, 22)

  mgr.currentVideoId = 'second'
  mgr.currentPlayTime = 31
  mgr.currentLyricLines = 0
  await mgr.recordNewPlay()
  const saved = store.get(H)
  assert.deepEqual(saved.map(h => [h.id, h.duration, h.lyricLines]), [['first', 187, 22], ['second', 31, 0]])
  assert.equal(live(), null, '畳んだ後も途中経過が残っている')
})

test('1 回の再生で、履歴をまるごと読み書きするのは 1 度だけ', async () => {
  const { mgr, ops } = makeManager({ [H]: [] })
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  for (let sec = 61; sec <= 241; sec += 30) {
    mgr.currentPlayTime = sec
    await mgr.updateDuration()
  }
  await mgr.updateDuration('song', 250, 0)
  assert.equal(ops.filter(([op, k]) => op === 'set' && k === H).length, 1)
  assert.equal(ops.filter(([op, k]) => op === 'get' && k === H).length, 1)
  // 履歴のほかに chrome.storage へ書く物も無い(書くたびにバックグラウンドが起きる)
  assert.equal(ops.filter(([op]) => op === 'set' || op === 'remove').length, 1)
})

test('このタブが記録していない曲の途中経過は書かない', async () => {
  const { mgr, live } = makeManager({ [H]: [] })
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  await mgr.updateDuration('other', 99, 1)
  assert.equal(live(), null)
})

test('畳むのは同じ再生だけ。短い数字では上書きしない', () => {
  const { mgr } = makeManager()
  const history = [
    { id: 'a', timestamp: 10, duration: 100, lyricLines: 5 },
    { id: 'a', timestamp: 20, duration: 30, lyricLines: 1 },
  ]
  mgr._foldLive(history, {
    a_20: { id: 'a', timestamp: 20, duration: 180, lyricLines: 12 },
    a_10: { id: 'a', timestamp: 10, duration: 50, lyricLines: 2 },
    gone_5: { id: 'gone', timestamp: 5, duration: 999, lyricLines: 9 },
    broken: null,
  })
  assert.deepEqual(history, [
    { id: 'a', timestamp: 10, duration: 100, lyricLines: 5 },
    { id: 'a', timestamp: 20, duration: 180, lyricLines: 12 },
  ])
  // 壊れた値が入っていても落ちない
  assert.deepEqual(mgr._foldLive([{ id: 'a', timestamp: 1, duration: 1 }], [1, 2]), [{ id: 'a', timestamp: 1, duration: 1 }])
})

test('畳まれないまま残った途中経過は溜めない', async () => {
  const stale = {}
  for (let i = 0; i < 20; i++) stale[`s${i}_${i}`] = { id: `s${i}`, timestamp: i, duration: 1, lyricLines: 0 }
  const { mgr, live } = makeManager({ [H]: [], local: { [L]: stale } })
  mgr._liveId = 'song'
  mgr._liveStamp = 1000
  await mgr.updateDuration('song', 60, 0)
  assert.equal(Object.keys(live()).length, mgr.LIVE_MAX_ENTRIES)
  assert.ok(live().song_1000, '今の曲のぶんを落としている')
})

test('止めた時・閉じる時は、まだ書いていないぶんだけを、その場で書く', async () => {
  const { mgr, ops, live, page } = makeManager({ [H]: [] })
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  // 記録していない曲では何も書かない
  mgr.flushProgress()
  assert.equal(page.size, 0)

  await mgr.recordNewPlay()
  mgr.hasRecordedCurrent = true
  mgr.lastSaveTime = 31
  ops.length = 0
  // 記録した直後は、書くものが無い
  mgr.flushProgress()
  assert.equal(page.size, 0)

  // タブを閉じる時は待ってもらえない。戻った時点で書けていること
  mgr.currentPlayTime = 95
  mgr.flushProgress()
  assert.equal(Object.values(live())[0].duration, 95)
  assert.equal(mgr.lastSaveTime, 95)
  assert.equal(ops.length, 0, 'chrome.storage に書いている')
})

test('localStorage が使えない・壊れていても、記録は続く', async () => {
  const { mgr, store, page } = makeManager({ [H]: [] })
  page.set(L, '{こわれた')
  mgr.currentVideoId = 'song'
  mgr.currentPlayTime = 31
  await mgr.recordNewPlay()
  assert.equal(store.get(H).length, 1)
  assert.deepEqual(await mgr.loadHistory(), store.get(H))

  // localStorage に触ると例外になる環境(保存を禁じている等)
  const blocked = makeManager({ [H]: [] })
  const denied = () => { throw new Error('denied') }
  blocked.page.get = denied
  blocked.page.set = denied
  blocked.page.has = denied
  blocked.mgr.currentVideoId = 'song'
  blocked.mgr.currentPlayTime = 31
  await blocked.mgr.recordNewPlay()
  await blocked.mgr.updateDuration('song', 60, 0)
  blocked.mgr.flushProgress()
  // 途中経過は残せないが、記録した時点の秒数は履歴にある
  assert.equal((await blocked.mgr.loadHistory())[0].duration, 31)
})

test('履歴を消したら途中経過も消し、消した後の再生時間を書かない', () => {
  assert.match(source, /storage\.remove\(this\.HISTORY_KEY\);\s*this\._writeLive\(null\);\s*this\._liveId = null;\s*this\._liveStamp = null;/)
})

test('書き出し・復元・クラウド同期も、途中経過まで入った履歴を使う', () => {
  assert.match(source, /exportHistory: async function \(\) \{\s*const history = await this\.loadHistory\(\);/)
  assert.match(source, /const current = await this\.loadHistory\(\);/)
  assert.match(cloudSource, /function getLocalHistory\(\) \{[\s\S]{0,200}ReplayManager\.loadHistory\(\)/)
})
