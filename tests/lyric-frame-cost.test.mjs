// 毎フレームの行走査。
//
// 行の状態が変わっていないフレームでやることは、アクティブ行の塗り直しだけ。
// それでも今までは毎フレーム全行を走査し、行ごとにクラス判定と
// lyric-past の書き込みをしていた。1曲 60〜100 行 × 秒 60 回。
//
// 見た目は変えずに、変化の無いフレームでは塗る行だけ触るようにした。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)

const sliceBetween = (from, to) => {
  const start = lyricsUiSource.indexOf(from)
  const end = lyricsUiSource.indexOf(to, start)
  assert.ok(start !== -1 && end !== -1, `切り出しの目印が変わっている: ${from}`)
  return lyricsUiSource.slice(start, end)
}

const paintSource = sliceBetween('function paintActiveLyricRow(r, t)', 'function setupPlayerBarBlankClickGuard')
const litSource = sliceBetween('const isPrimaryRowLitAtTime', 'const isSameTimestamp')

class CountingClassList {
  constructor(counter, ...names) {
    this.counter = counter
    this.names = new Set(names)
  }
  add(...names) { this.counter.writes += 1; names.forEach(n => this.names.add(n)) }
  remove(...names) { this.counter.writes += 1; names.forEach(n => this.names.delete(n)) }
  contains(name) { this.counter.reads += 1; return this.names.has(name) }
  toggle(name, force) {
    this.counter.writes += 1
    const on = force === undefined ? !this.names.has(name) : !!force
    if (on) this.names.add(name)
    else this.names.delete(name)
    return on
  }
}

function makeRow(counter, charTimes) {
  const chars = (charTimes || []).map(t => ({
    classList: new CountingClassList(counter, 'char-pending'),
    dataset: { time: String(t) },
  }))
  return {
    counter,
    chars,
    classList: new CountingClassList(counter, 'lyric-line'),
    dataset: {},
    querySelectorAll() { return chars },
    getBoundingClientRect: () => ({ top: 0, height: 20 }),
  }
}

function createHarness(lyricsData, charTimesByIndex = {}) {
  const counters = lyricsData.map(() => ({ reads: 0, writes: 0 }))
  const rows = lyricsData.map((_, i) => makeRow(counters[i], charTimesByIndex[i]))
  const container = {
    children: rows,
    _lastScrolledIndex: -1,
    scrollTop: 0,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0, height: 400 }),
  }

  const context = {
    DYNAMIC_OVERLAP_TOLERANCE: 0.05,
    DUET_DUPLICATE_TOLERANCE: 1,
    PipManager: { pipWindow: null, pipLyricsContainer: null },
    ReplayManager: { incrementLyricCount() {} },
    dynamicLines: null,
    lyricsData,
    rows,
    ui: { lyrics: container },
    hasTimestamp: true,
    isUserScrolling: false,
    meaningPanelVisible: false,
    _playbackRateForMotion: 1,
    paintLyricWordRow() {},
    Array, Number, Math, Set, parseFloat, String, JSON,
    isLineDynamicallyActiveAtTime(line, time, tolerance = 0.05) {
      return Number.isFinite(line?._dynamicRenderStartSec) &&
        Number.isFinite(line?._dynamicRenderEndSec) &&
        time + tolerance >= line._dynamicRenderStartSec &&
        time <= line._dynamicRenderEndSec + tolerance
    },
    isSameTimestamp(a, b, tolerance = 0.05) {
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
    },
    normalizeLyricCompareTextStrict: (v) => String(v || '').replace(/\s+/g, '').toLowerCase(),
    scoreLyricTextMatch: (a, b) => (a === b ? 100 : 0),
    syncMeaningPanelToPlayback() {},
    // 行を止める位置。CSS の指定が無い時の既定(中央)と同じ
    lyricAnchorOffset: (c, rowHeight) => (c.clientHeight / 2) - (rowHeight / 2),
    requestLyricScroll() {},
    suppressUserScrollDetection() {},
    clearTimeout() {},
    setTimeout() { return 1 },
  }

  vm.runInNewContext(`
    ${litSource}
    let lastActiveIndex = -1;
    let _hasDynamicRenderRanges = false;
    let _previousActiveIndices = new Set();
    let _activeRowsHaveCharSpans = false;
    let isProgrammaticScrolling = false;
    let programmaticScrollTimeout = null;
    let programmaticScrollMaxTimeout = null;
    ${paintSource}
    globalThis.runAt = (time, scrolledIndex) => {
      ui.lyrics._lastScrolledIndex = scrolledIndex;
      updateLyricHighlight(time);
    };
  `, context, { filename: 'lyric-frame-cost.js' })

  return {
    rows,
    counters,
    runAt: (time, scrolledIndex) => context.runAt(time, scrolledIndex),
    state: () => rows.map(r => ({
      active: r.classList.names.has('active'),
      past: r.classList.names.has('lyric-past'),
      chars: r.chars.map(c => (c.classList.names.has('char-active') ? 1 : 0)),
    })),
  }
}

const lines = [
  { time: 0, text: 'いち' },
  { time: 10, text: 'に' },
  { time: 20, text: 'さん' },
  { time: 30, text: 'よん' },
  { time: 40, text: 'ご' },
]

test('変化の無いフレームでは、塗らない行を触らない', () => {
  const h = createHarness(lines.map(l => ({ ...l })), { 1: [10, 10.5, 11] })
  h.runAt(10.0, 1) // 状態が変わるフレーム(全行を見る)
  const before = h.counters.map(c => ({ ...c }))
  h.runAt(10.2, 1) // 同じ行のまま進むだけのフレーム
  const after = h.counters.map(c => ({ ...c }))

  lines.forEach((_, i) => {
    if (i === 1) return // アクティブ行は塗るので触る
    assert.equal(after[i].writes, before[i].writes, `${i} 行目に書き込んでいる`)
    assert.equal(after[i].reads, before[i].reads, `${i} 行目を読んでいる`)
  })
})

test('変化の無いフレームでも、文字の塗りは進む', () => {
  const h = createHarness(lines.map(l => ({ ...l })), { 1: [10, 10.5, 11] })
  h.runAt(10.0, 1)
  assert.deepEqual(h.state()[1].chars, [1, 0, 0])
  h.runAt(10.6, 1)
  assert.deepEqual(h.state()[1].chars, [1, 1, 0], '同じ行のままだと文字が進まない')
  h.runAt(11.2, 1)
  assert.deepEqual(h.state()[1].chars, [1, 1, 1])
})

test('行が変わるフレームでは active と lyric-past を組み直す', () => {
  const h = createHarness(lines.map(l => ({ ...l })), { 1: [10], 2: [20] })
  h.runAt(10.0, 1)
  assert.equal(h.state()[1].active, true)
  assert.equal(h.state()[0].past, true)

  h.runAt(20.0, 1) // idx が進む = scrollPending が立つ
  const s = h.state()
  assert.equal(s[2].active, true, '新しい行が active になっていない')
  assert.equal(s[1].active, false, '前の行の active が残っている')
  assert.equal(s[1].past, true, '前の行が past になっていない')
  assert.equal(s[3].past, false, 'まだ来ていない行を past にしている')
})

test('巻き戻しでも past が正しく戻る', () => {
  const h = createHarness(lines.map(l => ({ ...l })), { 1: [10], 2: [20] })
  h.runAt(30.0, 3)
  assert.equal(h.state()[1].past, true)
  h.runAt(10.0, 1)
  const s = h.state()
  assert.equal(s[1].active, true)
  assert.equal(s[2].past, false, '巻き戻したのに past のまま')
  assert.equal(s[3].past, false)
})

test('lyric-past は変わった時だけ書く', () => {
  const h = createHarness(lines.map(l => ({ ...l })), { 1: [10] })
  h.runAt(10.0, 1)
  // idx を動かさずに全行走査を起こす(スクロール未追従の状態)
  const before = h.counters[4].writes
  h.runAt(10.1, -1)
  h.runAt(10.2, -1)
  assert.equal(h.counters[4].writes, before, 'past が変わらない行に書き続けている')
})
