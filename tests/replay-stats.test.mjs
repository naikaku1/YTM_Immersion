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

const runGetStats = (history, alias = {}) => {
  const context = vm.createContext({
    storage: { get: async () => history },
    console,
    __alias: alias,
  })
  vm.runInContext(
    'this.holder = { HISTORY_KEY: \'k\', formatDuration: (s) => String(s),'
    + ' _loadArtistAlias: async () => __alias, ' + getStatsSource + ' }',
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

// 同じアーティストが 2 組に割れる。
//
// music.youtube.com で確かめたところ、同じ曲で
//   navigator.mediaSession.metadata.artist → "Yorushika"
//   プレイヤーバーの byline            → "ヨルシカ"
// と、取得元によって表記が違った。getMetadata はこの 2 つを
// 状況で使い分けるので、同じ人が両方の表記で履歴に入っていた。
// 集計は対応表で束ねる。
test('対応表があれば別表記でも 1 人として数える', async () => {
  const stats = await runGetStats(
    [
      play('A', 'ヨルシカ'),
      play('B', 'Yorushika'),
      play('C', 'Yorushika'),
      play('D', 'aimyon'),
    ],
    { 'Yorushika': 'ヨルシカ', 'ヨルシカ': 'ヨルシカ' },
  )
  assert.equal(stats.topArtists.length, 2)
  assert.equal(stats.topArtists[0].count, 3)
  assert.equal(stats.topArtistShare, '75%')
})

test('束ねた 1 人は画面に出る表記で表示する', async () => {
  const stats = await runGetStats(
    [play('A', 'Nogizaka46'), play('B', 'Nogizaka46'), play('C', '乃木坂46')],
    { 'Nogizaka46': '乃木坂46', '乃木坂46': '乃木坂46' },
  )
  // 履歴上はローマ字の方が多いが、表示は画面に出る表記に寄せる。
  assert.equal(stats.topArtists[0].name, '乃木坂46')
  assert.equal(stats.topArtists[0].count, 3)
})

test('同じ曲がアーティスト表記のせいで 2 件に割れない', async () => {
  const stats = await runGetStats(
    [
      play('サマータイムシンデレラ', '緑黄色社会'),
      play('サマータイムシンデレラ', 'Ryokuoushoku Shakai'),
    ],
    { 'Ryokuoushoku Shakai': '緑黄色社会', '緑黄色社会': '緑黄色社会' },
  )
  assert.equal(stats.topSongs.length, 1)
  assert.equal(stats.topSongs[0].count, 2)
  assert.equal(stats.topSongs[0].artist, '緑黄色社会')
})

test('対応表が無ければ今までどおり名前ごとに数える', async () => {
  const stats = await runGetStats([play('A', 'ヨルシカ'), play('B', 'Yorushika')])
  assert.equal(stats.topArtists.length, 2)
})

test('対応表が配列で入っていても落ちない', async () => {
  const stats = await runGetStats([play('A', 'あ')], [])
  assert.equal(stats.totalPlays, 1)
})

// 束ねてよい組み合わせの判定。
//
// 「表記ゆれだから同じ人」と決めつけて束ねると、別のアーティストが
// 1 人にまとめられる。片方だけが日本語の時に限る、という条件を守る。
const guardSource = (() => {
  const start = source.indexOf('_hasCjk: function (text) {')
  const end = source.indexOf('_loadArtistAlias: async function () {')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return source.slice(start, end).replace(/,\s*$/, '')
})()

const guard = (() => {
  const context = vm.createContext({})
  vm.runInContext(`this.holder = { ${guardSource} }`, context)
  return context.holder
})()

test('ローマ字と日本語の組だけを同じ人として束ねる', () => {
  assert.equal(guard._looksSameArtist('ヨルシカ', 'Yorushika'), true)
  assert.equal(guard._looksSameArtist('乃木坂46', 'Nogizaka46'), true)
  assert.equal(guard._looksSameArtist('緑黄色社会', 'Ryokuoushoku Shakai'), true)
})

test('別のアーティストどうしは束ねない', () => {
  // どちらもラテン文字。byline 側だけ feat. が付いている場合など。
  assert.equal(guard._looksSameArtist('=LOVE', 'CUTIE STREET'), false)
  assert.equal(guard._looksSameArtist('KANA-BOON', 'KANA-BOON & X'), false)
  // どちらも日本語。
  assert.equal(guard._looksSameArtist('乃木坂46', '日向坂46'), false)
  // 同じ名前、空、長すぎるもの。
  assert.equal(guard._looksSameArtist('aimyon', 'aimyon'), false)
  assert.equal(guard._looksSameArtist('', 'ヨルシカ'), false)
  assert.equal(guard._looksSameArtist('ヨ'.repeat(61), 'x'), false)
})

// 既存の履歴からの対応表づくり。
//
// 聴き直さなくても、同じ videoId が両方の表記で記録されていれば
// そこから「同じ人」だと分かる。曲名だけが同じものは別人がいるので使わない。
const backfillSource = (() => {
  const start = source.indexOf('_backfillArtistAlias: async function () {')
  const end = source.indexOf('_rememberArtistAlias: async function (canonical, other) {')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return source.slice(start, end).replace(/,\s*$/, '')
})()

const runBackfill = async (history, alias = {}) => {
  const written = []
  const context = vm.createContext({
    storage: {
      get: async () => history,
      set: async (k, v) => { written.push([k, v]) },
    },
    console,
    __alias: alias,
  })
  vm.runInContext(
    'this.holder = { HISTORY_KEY: \'k\', ARTIST_ALIAS_KEY: \'a\','
    + ' _hasCjk: function (t) { return /[\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff]/.test(String(t || \'\')) },'
    + ' _looksSameArtist: function (a, b) {'
    + '   if (!a || !b || a === b) return false;'
    + '   if (a.length > 60 || b.length > 60) return false;'
    + '   return this._hasCjk(a) !== this._hasCjk(b); },'
    + ' _loadArtistAlias: async () => __alias, ' + backfillSource + ' }',
    context,
  )
  const learned = await context.holder._backfillArtistAlias()
  return { learned, written }
}

const at = (id, artist) => ({ id, title: 't', artist, duration: 1, timestamp: Date.now() })

test('同じ曲が両方の表記で記録されていれば対応表を作れる', async () => {
  const { learned, written } = await runBackfill([
    at('vid1', 'Nogizaka46'),
    at('vid1', '乃木坂46'),
  ])
  assert.equal(learned, 1)
  assert.deepEqual(written[0][1], { 'Nogizaka46': '乃木坂46', '乃木坂46': '乃木坂46' })
})

test('表記が 1 つしか無い曲からは何も作らない', async () => {
  const { learned, written } = await runBackfill([
    at('vid1', 'Nogizaka46'),
    at('vid2', 'Nogizaka46'),
  ])
  assert.equal(learned, 0)
  assert.equal(written.length, 0)
})

test('日本語表記が 2 つある曲には触らない', async () => {
  const { learned } = await runBackfill([
    at('vid1', '乃木坂46'),
    at('vid1', '日向坂46'),
    at('vid1', 'Nogizaka46'),
  ])
  assert.equal(learned, 0)
})

test('曲名が同じだけの別の曲は束ねない', async () => {
  // 「シルエット」は別のアーティストにも存在しうる。videoId が違えば触らない。
  const { learned } = await runBackfill([
    at('vid1', 'KANA-BOON'),
    at('vid2', 'かなブーン'),
  ])
  assert.equal(learned, 0)
})

// YTM に問い合わせて表記を揃える。
//
// YTM は同じアーティストでも曲ごとに別の表記を付ける(公式音源は
// "aimyon"、MV は「あいみょん」)。履歴の中を見比べても判定できないので
// YTM に聞くが、聞いた結果をそのまま信じて別人を束ねてはいけない。
const syncSource = (() => {
  const start = source.indexOf('_syncArtistNamesFromYtm: async function (onProgress) {')
  const end = source.indexOf('_rememberArtistAlias: async function (canonical, other) {')
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  return source.slice(start, end).replace(/,\s*$/, '')
})()

const runSync = async (history, answers, alias = {}) => {
  const asked = []
  const written = []
  const context = vm.createContext({
    storage: {
      get: async (k) => (k === 'a' ? alias : history),
      set: async (k, v) => { written.push([k, v]) },
    },
    console: { log() {}, warn() {} },
    setTimeout: (fn) => fn(),
    YTMArtistLookup: {
      byName: async (name) => {
        asked.push(name)
        if (answers[name] instanceof Error) throw answers[name]
        return answers[name] ? { name: answers[name], browseId: 'UC_x' } : null
      },
    },
  })
  vm.runInContext(
    'this.holder = { HISTORY_KEY: \'h\', ARTIST_ALIAS_KEY: \'a\','
    + ' _hasCjk: function (t) { return /[\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff]/.test(String(t || \'\')) },'
    + ' _looksSameArtist: function (a, b) {'
    + '   if (!a || !b || a === b) return false;'
    + '   if (a.length > 60 || b.length > 60) return false;'
    + '   return this._hasCjk(a) !== this._hasCjk(b); },'
    + ' _loadArtistAlias: async function () { return await storage.get(this.ARTIST_ALIAS_KEY) }, '
    + syncSource + ' }',
    context,
  )
  const learned = await context.holder._syncArtistNamesFromYtm()
  return { learned, asked, written }
}

const rec = (artist) => ({ id: 'v' + artist, title: 't', artist, duration: 1, timestamp: Date.now() })

test('ローマ字の表記だけを YTM に問い合わせる', async () => {
  const { asked } = await runSync(
    [rec('aimyon'), rec('乃木坂46'), rec('KANA-BOON'), rec('aimyon')],
    { aimyon: 'あいみょん', 'KANA-BOON': 'KANA-BOON' },
  )
  // 日本語表記は聞かない。同じ名前は 1 回だけ。
  assert.deepEqual(asked, ['aimyon', 'KANA-BOON'])
})

test('返ってきた表記が日本語なら統合する', async () => {
  const { learned, written } = await runSync([rec('aimyon')], { aimyon: 'あいみょん' })
  assert.equal(learned, 1)
  assert.deepEqual(written[0][1], { 'aimyon': 'あいみょん', 'あいみょん': 'あいみょん' })
})

test('同じ名前が返ってきただけなら何もしない', async () => {
  const { learned, written } = await runSync([rec('KANA-BOON')], { 'KANA-BOON': 'KANA-BOON' })
  assert.equal(learned, 0)
  assert.equal(written.length, 0)
})

test('見つからない・失敗しても止まらない', async () => {
  const { learned, asked } = await runSync(
    [rec('Unknown'), rec('Broken'), rec('aimyon')],
    { Unknown: null, Broken: new Error('network'), aimyon: 'あいみょん' },
  )
  assert.deepEqual(asked, ['Unknown', 'Broken', 'aimyon'])
  assert.equal(learned, 1)
})

test('解決済みの表記は二度と問い合わせない', async () => {
  const { asked } = await runSync(
    [rec('aimyon'), rec('Yorushika')],
    { aimyon: 'あいみょん', Yorushika: 'ヨルシカ' },
    { 'aimyon': 'あいみょん', 'あいみょん': 'あいみょん' },
  )
  assert.deepEqual(asked, ['Yorushika'])
})
