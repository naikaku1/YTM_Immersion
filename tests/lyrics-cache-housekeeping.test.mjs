// 歌詞キャッシュの肥大。
//
// 「曲名///アーティスト」のキーに、候補一覧(最大 30 件ぶんの歌詞本文)まで
// 丸ごと保存していた。消す手段は設定の「全削除」だけで、聴いた曲のぶんだけ
// 増え続ける。
//
// ・引き直せる候補(LRCHub のレコードを指すもの)の本文は保存しない
// ・起動時に 1 回、古い順に間引いて上限に収める
// ・本人が決めたもの(手動アップロード / 候補の選択)は間引かない

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const cacheSource = read('src/js/module/lyrics-cache.js')
const uiSource = read('src/js/module/lyrics-ui.js')
const contentSource = read('src/js/content.js')

const load = (store) => {
  const removed = []
  const context = vm.createContext({
    Object, Array, Number, Promise, Date, console,
    chrome: {
      runtime: {},
      storage: {
        local: {
          get: (_keys, cb) => cb(store),
          remove: (keys, cb) => { removed.push(...keys); cb() },
        },
      },
    },
  })
  vm.runInContext(`${cacheSource}\nthis.mod = LyricsCache`, context)
  return { mod: context.mod, removed }
}

test('引き直せる候補の本文は保存しない', () => {
  const { mod } = load({})
  const out = mod.stripCandidateLyrics([
    { id: 'a', record_id: 'r1', label: 'LRCHub', lyrics: '[00:01.00] x', dynamicLines: [{}] },
  ])
  assert.equal(out[0].lyrics, undefined)
  assert.equal(out[0].dynamicLines, undefined)
  assert.equal(out[0].lyricsComplete, false)
  assert.equal(out[0].label, 'LRCHub', 'ラベルまで落としている')
  assert.equal(out[0].record_id, 'r1')
})

test('引き直せない候補の本文は残す', () => {
  const { mod } = load({})
  const out = mod.stripCandidateLyrics([
    { id: 'provider_ytm', providerCandidate: true, lyricsSource: 'ytm', lyrics: 'keep me' },
  ])
  assert.equal(out[0].lyrics, 'keep me')
})


test('上限以下なら何も消さない', async () => {
  const store = { 'a///b': { lyrics: 'x', fetchedAt: 1 }, 'setting': 1 }
  const { mod, removed } = load(store)
  assert.equal(await mod.prune(), 0)
  assert.equal(removed.length, 0)
})

test('古い順に間引き、本人が決めたものは残す', async () => {
  const store = { 'settings-key': 1 }
  for (let i = 0; i < 1100; i++) {
    store[`song${i}///artist`] = { lyrics: 'x', fetchedAt: i + 1 }
  }
  store['mine///artist'] = { lyrics: 'x', fetchedAt: 0, manualLyrics: true }
  store['chosen///artist'] = { lyrics: 'x', fetchedAt: 0, manualChoice: true }
  const { mod, removed } = load(store)
  const count = await mod.prune()
  assert.equal(count, 1100 - mod.MAX_ENTRIES)
  assert.ok(!removed.includes('mine///artist'), '手動アップロードを消している')
  assert.ok(!removed.includes('chosen///artist'), '選んだ歌詞を消している')
  assert.ok(!removed.includes('settings-key'), '設定を消している')
  assert.ok(removed.includes('song0///artist'), '古いものが残っている')
  assert.ok(!removed.includes('song1099///artist'), '新しいものを消している')
})

// 起動のたびに保存してある物を全部(再生履歴まで)読み込んでいた。
// キーの名前だけ読めば、ほとんどの人は中身を読まずに済む。
const loadWithKeys = (store) => {
  const removed = []
  const reads = []
  const context = vm.createContext({
    Object, Array, Number, Promise, Date, console,
    chrome: {
      runtime: {},
      storage: {
        local: {
          getKeys: (cb) => cb(Object.keys(store)),
          get: (keys, cb) => {
            reads.push(keys)
            cb(keys === null ? store : Object.fromEntries(keys.map(k => [k, store[k]])))
          },
          remove: (keys, cb) => { removed.push(...keys); cb() },
        },
      },
    },
  })
  vm.runInContext(`${cacheSource}\nthis.mod = LyricsCache`, context)
  return { mod: context.mod, removed, reads }
}

test('上限以下なら、保存してある中身を読まない', async () => {
  const store = { ytm_local_history: new Array(10000).fill({ id: 'x' }), 'a///b': { lyrics: 'x', fetchedAt: 1 } }
  const { mod, removed, reads } = loadWithKeys(store)
  assert.equal(await mod.prune(), 0)
  assert.equal(reads.length, 0, '中身を読んでいる')
  assert.equal(removed.length, 0)
})

test('上限を超えた時も、読むのは歌詞のぶんだけ', async () => {
  const store = { ytm_local_history: [{ id: 'x' }], 'settings-key': 1 }
  for (let i = 0; i < 1100; i++) store[`song${i}///artist`] = { lyrics: 'x', fetchedAt: i + 1 }
  store['mine///artist'] = { lyrics: 'x', fetchedAt: 0, manualLyrics: true }
  const { mod, removed, reads } = loadWithKeys(store)
  assert.equal(await mod.prune(), 1100 - mod.MAX_ENTRIES)
  assert.equal(reads.length, 1)
  assert.ok(Array.isArray(reads[0]) && reads[0].every(k => k.includes('///')), '歌詞でない物まで読んでいる')
  assert.ok(!removed.includes('mine///artist'))
  assert.ok(removed.includes('song0///artist'))
})

test('保存時に軽くしてから書く', () => {
  const writes = uiSource.match(/candidates: [^\n]*lyricsCandidates[^\n]*/g) || []
  assert.ok(writes.length >= 3)
  writes.forEach(line => {
    assert.match(line, /LyricsCache\.stripCandidateLyrics\(/, `素のまま保存している: ${line}`)
  })
  assert.equal((uiSource.match(/fetchedAt: Date\.now\(\)/g) || []).length, 3, '保存時刻を入れていない')
})

test('起動時に 1 回だけ間引く', () => {
  assert.match(contentSource, /void LyricsCache\.prune\(\);/)
})
