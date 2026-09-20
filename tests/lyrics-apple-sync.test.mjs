import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

globalThis.chrome = globalThis.chrome || {
  storage: { local: { get: (keys, cb) => cb({}) } },
}
// background.js が api.js から受け取る素の道具。stub で潰すと、
// 実際には API 側にある実装が抜けたまま通ってしまう。
const RealAPI = await import('../src/js/module/api.js')

const lyricsUiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')
const styleSource = read('src/css/style.css')
const pipSource = read('src/js/module/pip-manager.js')
const backgroundSource = read('src/js/background.js')
  .replace(/^import .*?;\r?$/gm, '')

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing marker: ${endMarker}`)
  return source.slice(start, end)
}

// ── 文字ごとの塗り・光の計算 ─────────────────────────────

const painterSource = sourceBetween(
  lyricsUiSource,
  '// 塗りの境目のぼかし半幅(文字サイズ基準)',
  '// ── 従来式(1文字ずつ点灯)の表示',
)

// 実装は DOM を触るので、必要な分だけ用意して VM で動かす。
function loadPainter({ charWidth = 10 } = {}) {
  const view = { getComputedStyle: () => ({ fontSize: '32px' }) }
  const clock = { now: 0 }
  const context = {
    Math,
    Number,
    Array,
    String,
    Set,
    Intl,
    performance: { now: () => clock.now },
    window: view,
    getComputedStyle: view.getComputedStyle,
    document: {
      defaultView: view,
      createRange: () => {
        let end = 0
        return {
          setStart() {},
          setEnd(_node, offset) { end = offset },
          getBoundingClientRect: () => ({ width: end * charWidth }),
        }
      },
    },
  }
  vm.runInNewContext(
    painterSource +
    '\nthis.buildLyricWordUnits = buildLyricWordUnits;' +
    '\nthis.buildMonotoneTangents = buildMonotoneTangents;' +
    '\nthis.measureLyricLineSweep = measureLyricLineSweep;' +
    '\nthis.lyricSweepAt = lyricSweepAt;' +
    '\nthis.paintLyricWordRow = paintLyricWordRow;' +
    '\nthis.resetLyricWordRow = resetLyricWordRow;' +
    '\nthis.emphasisScaleAmount = emphasisScaleAmount;' +
    '\nthis.emphasisGlowAmount = emphasisGlowAmount;' +
    '\nthis.bellCurve = bellCurve;' +
    '\nthis.smoothstep = smoothstep;',
    context,
  )
  context.clock = clock
  return context
}

const chars = (pairs) => pairs.map(([c, t]) => ({ c, t }))

// ── 描画の単位に切り分ける ──────────────────────────────

test('Latin text is grouped into words, with the spaces left outside the spans', () => {
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['a', 0], ['b', 100], [' ', 200], ['c', 300]]),
    1,
  )
  assert.deepEqual(Array.from(units, u => u.type), ['word', 'space', 'word'])
  assert.equal(units[0].text, 'ab')
  assert.equal(units[2].text, 'c')
  // 空白を span に入れると折り返せなくなるので、必ず別扱いにする
  assert.equal(units[1].text, ' ')
})

test('syllable chunks of one word are merged into a single span', () => {
  // LyricsPlus は "may" "be" のように音節で送ってくる。
  // 語として1つの span にまとめないと、字形の詰めが効かず隙間が出る。
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['m', 0], ['a', 50], ['y', 100], ['b', 800], ['e', 900]]),
    1.5,
  )
  assert.equal(units.length, 1)
  assert.equal(units[0].text, 'maybe')
  // 語の中の時刻は捨てない。塗りの位置はここから引く。
  assert.equal(units[0].times.length, 5)
  assert.equal(units[0].times[3], 0.8)
})

test('CJK is split at word boundaries, not at every character', () => {
  // 1字ずつ切ると箱が字の数だけ増え、字の間の見え方が揃わなくなる。
  // 行まるごと1つでも駄目(光が歌っている位置を追いかけなくなる)。
  const { buildLyricWordUnits } = loadPainter()
  const text = '未だにあなたのことを'
  const units = buildLyricWordUnits(
    chars(Array.from(text).map((c, i) => [c, i * 250])),
    2.5,
  )
  const texts = Array.from(units, u => u.text)
  assert.ok(units.length > 1, 'the whole line must not be one unit')
  assert.ok(units.length < Array.from(text).length, 'must not be one unit per character')
  assert.equal(texts.join(''), text, 'no character may be lost')
  // ブラウザの語区切りに沿っていること
  assert.ok(texts.includes('未だに'), `unexpected split: ${texts.join('|')}`)
  assert.ok(texts.includes('あなた'), `unexpected split: ${texts.join('|')}`)
})

test('every glyph keeps its own timing even inside a multi-character unit', () => {
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['未', 0], ['だ', 250], ['に', 500]]),
    1,
  )
  const first = units[0]
  assert.equal(first.text, '未だに')
  // 語にまとめても、塗りの位置は文字ごとの時刻から引く
  assert.deepEqual(Array.from(first.times), [0, 0.25, 0.5])
  assert.deepEqual(Array.from(first.offsets), [0, 1, 2])
})

test('small kana and long vowel marks never start a unit of their own', () => {
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['ち', 0], ['ゃ', 60], ['ー', 120], ['と', 300]]),
    1,
  )
  for (const unit of units) {
    assert.ok(
      !/^[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]/.test(unit.text),
      `a unit must not start with a small kana: ${unit.text}`,
    )
  }
})

test('a Latin run next to CJK is split at the boundary', () => {
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['君', 0], ['n', 100], ['o', 150], ['声', 300]]),
    1,
  )
  const texts = Array.from(units, u => u.text)
  assert.equal(texts.join(''), '君no声')
  assert.ok(texts.includes('no'), `latin run must stay whole: ${texts.join('|')}`)
})

test('a word ends when the next glyph starts, not when the next word starts', () => {
  const { buildLyricWordUnits } = loadPainter()
  const units = buildLyricWordUnits(
    chars([['a', 0], [' ', 500], ['b', 2000]]),
    3,
  )
  // 語と語の間の無音まで塗りを伸ばさない
  assert.equal(units[0].end, 0.5)
})

// ── 行を流れる1本の先端 ──────────────────────────────────

function makeSpan(text, times, offsets) {
  const style = {}
  const animateCalls = []
  return {
    animateCalls,
    animate(frames, options) {
      const animation = {
        currentTime: 0,
        playbackRate: 1,
        playState: 'idle',
        playCount: 0,
        pause() { this.playState = 'paused' },
        play() { this.playState = 'running'; this.playCount += 1 },
      }
      animateCalls.push({ frames, options, animation })
      return animation
    },
    firstChild: { nodeType: 3, data: text },
    _times: times,
    _offsets: offsets ?? times.map((_, i) => i),
    _start: times[0],
    _end: times[times.length - 1] + 0.2,
    _emp: false,
    offsetTop: 0,
    offsetLeft: 0,
    offsetWidth: text.length * 10,
    style: { setProperty(k, v) { style[k] = v } },
    props: style,
    writes: 0,
  }
}

function makeRow(spans) {
  const style = {}
  let writes = 0
  return {
    _ytmWordSpans: spans,
    offsetWidth: 400,
    offsetHeight: 40,
    style: { setProperty(k, v) { writes += 1; style[k] = v } },
    props: style,
    get writeCount() { return writes },
  }
}

test('the fill front is one continuous position for the whole line', () => {
  // 語ごとに 0→1 の勾配を閉じると、語の変わり目でぼかしが途切れて
  // 境目が見える。行の先頭からの px を1つだけ持つのが正解。
  const { measureLyricLineSweep, lyricSweepAt } = loadPainter()
  const a = makeSpan('ab', [0, 0.5])
  const b = makeSpan('cd', [1, 1.5])
  b.offsetLeft = 30
  const row = makeRow([a, b])
  measureLyricLineSweep(row)

  assert.equal(a.props['--wx'], '0')
  assert.equal(b.props['--wx'], '30')

  // 時間が進むほど前へしか動かない
  let prev = -1
  for (let t = 0; t <= 2; t += 0.02) {
    const x = lyricSweepAt(row, t)
    assert.ok(x >= prev - 1e-9, `sweep went backwards at ${t}`)
    prev = x
  }
  assert.equal(lyricSweepAt(row, -1), 0)
  assert.ok(lyricSweepAt(row, 99) >= 50)
})

test('the front reaches a word exactly when that word starts', () => {
  const { measureLyricLineSweep, lyricSweepAt } = loadPainter()
  const a = makeSpan('ab', [0, 0.5])
  const b = makeSpan('cd', [2, 2.5])
  b.offsetLeft = 30
  const row = makeRow([a, b])
  measureLyricLineSweep(row)
  // 2秒目に2語目の左端(30px)に来る。手前の無音はそこへ向かって進むだけ。
  assert.ok(Math.abs(lyricSweepAt(row, 2) - 30) < 0.5)
})

test('a wrapped line is laid out as one reading path', () => {
  const { measureLyricLineSweep, lyricSweepAt } = loadPainter()
  const a = makeSpan('ab', [0, 0.5])          // 1行目
  const b = makeSpan('cd', [1, 1.5])          // 2行目に折り返した語
  b.offsetTop = 40
  b.offsetLeft = 0
  const row = makeRow([a, b])
  measureLyricLineSweep(row)
  // 2行目の語は1行目の右へ続いた座標になる。0 のままだと
  // 折り返した瞬間に先端が左へ飛ぶ。
  assert.equal(a.props['--wx'], '0')
  assert.equal(b.props['--wx'], '20')
  assert.ok(lyricSweepAt(row, 1.2) > 20)
})

test('seeking backwards re-finds the position instead of sticking', () => {
  const { measureLyricLineSweep, lyricSweepAt } = loadPainter()
  const a = makeSpan('abcd', [0, 0.5, 1, 1.5])
  const row = makeRow([a])
  measureLyricLineSweep(row)
  const late = lyricSweepAt(row, 1.4)
  const early = lyricSweepAt(row, 0.2)
  assert.ok(early < late, 'must follow a backward seek')
})

test('the front does not change speed in steps at every character', () => {
  // 文字は幅がまちまちなのに時間はほぼ等分なので、節目を直線で結ぶと
  // 細い字は速く、太い字は遅く進む。その段差が「カクカク」に見える。
  const { measureLyricLineSweep, lyricSweepAt } = loadPainter()
  const a = makeSpan('abcdefgh', [0, 0.18, 0.36, 0.54, 0.72, 0.90, 1.08, 1.26])
  a._end = 1.44
  a.offsetWidth = 126
  const row = makeRow([a])
  measureLyricLineSweep(row)

  // 幅を不揃いにする(細い字と太い字が交互)
  const widths = [7, 22, 9, 25, 8, 21, 10, 24]
  let x = 0
  row._sweepX = widths.map(w => { const v = x; x += w; return v })
  row._sweepX.push(x)
  row._sweepT = [0, 0.18, 0.36, 0.54, 0.72, 0.90, 1.08, 1.26, 1.44]

  const sampleWith = (tangents) => {
    row._sweepM = tangents
    const out = []
    for (let t = 0; t <= 1.44; t += 1 / 60) {
      row._sweepIndex = 0
      out.push(lyricSweepAt(row, t))
    }
    return out
  }
  const worstJump = (series) => {
    const v = series.slice(1).map((p, i) => (p - series[i]) * 60)
    return Math.max(...v.slice(1).map((s, i) => Math.abs(s - v[i])))
  }

  const smooth = sampleWith(loadPainter().buildMonotoneTangents(row._sweepT, row._sweepX))
  const linear = sampleWith(null)
  assert.ok(
    worstJump(smooth) < worstJump(linear) * 0.6,
    `smoothed ${worstJump(smooth).toFixed(0)} vs linear ${worstJump(linear).toFixed(0)}`,
  )
})

test('smoothing the front still hits every character exactly on time', () => {
  const { buildMonotoneTangents, lyricSweepAt } = loadPainter()
  const ts = [0, 0.2, 0.5, 0.55, 1.4]
  const xs = [0, 12, 40, 41, 90]
  const row = { _sweepT: ts, _sweepX: xs, _sweepEnd: 90, _sweepIndex: 0 }
  row._sweepM = buildMonotoneTangents(ts, xs)
  for (let i = 0; i < ts.length; i += 1) {
    row._sweepIndex = 0
    assert.ok(
      Math.abs(lyricSweepAt(row, ts[i]) - xs[i]) < 1e-6,
      `knot ${i} drifted`,
    )
  }
})

test('smoothing never lets the front run backwards or overshoot', () => {
  const { buildMonotoneTangents, lyricSweepAt } = loadPainter()
  // 極端に不揃いな区間(長い無音のあと一気に進む)でも壊れないこと
  const ts = [0, 0.05, 0.1, 2.0, 2.05, 2.1]
  const xs = [0, 40, 42, 44, 90, 130]
  const row = { _sweepT: ts, _sweepX: xs, _sweepEnd: 130, _sweepIndex: 0 }
  row._sweepM = buildMonotoneTangents(ts, xs)
  let prev = -1
  for (let t = 0; t <= 2.1; t += 1 / 240) {
    row._sweepIndex = 0
    const x = lyricSweepAt(row, t)
    assert.ok(x >= prev - 1e-9, `went backwards at ${t.toFixed(3)}`)
    assert.ok(x <= 130 + 1e-6, `overshot to ${x} at ${t.toFixed(3)}`)
    prev = x
  }
})

// ── 強調は伸ばした音だけ ────────────────────────────────

test('short syllables are barely emphasised and long ones bloom', () => {
  const { emphasisScaleAmount, emphasisGlowAmount } = loadPainter()
  assert.ok(emphasisScaleAmount(0.2) < 0.02, 'a fast syllable must stay flat')
  assert.ok(emphasisGlowAmount(0.2) < 0.02)
  assert.ok(emphasisGlowAmount(3) > 0.4, 'a held note must actually glow')
  // 単調で、頭打ちがある
  let prev = -1
  for (const d of [0.1, 0.5, 1, 2, 4, 8, 30]) {
    const g = emphasisGlowAmount(d)
    assert.ok(g >= prev, 'must not go down as the note gets longer')
    prev = g
  }
  assert.ok(emphasisScaleAmount(30) <= 1.2)
  assert.ok(emphasisGlowAmount(30) <= 0.7)
})

test('the emphasis envelope starts and ends at rest', () => {
  const { bellCurve } = loadPainter()
  assert.equal(bellCurve(0), 0)
  assert.equal(bellCurve(1), 0)
  assert.equal(bellCurve(-0.5), 0)
  assert.equal(bellCurve(2), 0)
  assert.ok(Math.abs(bellCurve(0.5) - 1) < 1e-9)
  // 両端の傾きが 0 なので、点いたり消えたりが折れて見えない
  assert.ok(bellCurve(0.01) < 0.002)
  assert.ok(bellCurve(0.99) < 0.002)
})

test('emphasis begins before the syllable is actually sung', () => {
  const { measureLyricLineSweep } = loadPainter()
  const a = makeSpan('aaaa', [2, 2.8, 3.6, 4.4])
  a._end = 5.4
  const row = makeRow([a])
  measureLyricLineSweep(row)
  assert.ok(a._emp, 'a 3.4s note must qualify for emphasis')
  assert.ok(a._empStart < a._start, 'must start rising before the onset')
  assert.ok(Math.abs((a._start - a._empStart) - 0.4) < 1e-9)
})

test('the glow radius is fixed per word so only its alpha animates', () => {
  // 半径を毎フレーム変えると、そのたびに字の影を描き直すことになる。
  const { measureLyricLineSweep } = loadPainter()
  const a = makeSpan('aaaa', [0, 1, 2, 3])
  a._end = 4
  const row = makeRow([a])
  measureLyricLineSweep(row)
  assert.ok(Number(a.props['--wglowr']) > 0)
  assert.ok(Number(a.props['--wglowr']) <= 0.3)
  assert.ok(Number(a.props['--wglowa']) > 0)
})

// ── 毎フレームの書き込み ────────────────────────────────

test('the fill costs one style write per line, not one per word', () => {
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const spans = ['aa', 'bb', 'cc', 'dd'].map((txt, i) => {
    const sp = makeSpan(txt, [i * 0.3, i * 0.3 + 0.15])
    sp.offsetLeft = i * 25
    return sp
  })
  const row = makeRow(spans)
  measureLyricLineSweep(row)
  row._sweepReady = true
  const before = row.writeCount
  paintLyricWordRow(row, 0.42)
  const sweepWrites = row.writeCount - before
  assert.equal(sweepWrites, 1)
  assert.ok('--sweep' in row.props)
})

test('a settled word stops being written to every frame', () => {
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('aa', [0, 0.1])
  const row = makeRow([a])
  measureLyricLineSweep(row)

  let writes = 0
  a.style.setProperty = (k, v) => { writes += 1; a.props[k] = v }

  paintLyricWordRow(row, 30)   // とっくに歌い終わった状態
  const settled = writes
  paintLyricWordRow(row, 30.02)
  paintLyricWordRow(row, 30.04)
  assert.equal(writes, settled, 'settled words must stop writing styles')
})

test('words that do not qualify for emphasis are never given a glow value', () => {
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('a', [0])
  a._end = 0.12                      // 速い語
  const row = makeRow([a])
  measureLyricLineSweep(row)
  a._emp = false
  paintLyricWordRow(row, 0.06)
  assert.ok(!('--wg' in a.props), 'a fast syllable must cost nothing extra')
})

test('the motion is handed to the browser instead of written every frame', () => {
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('aaaa', [0, 0.4, 0.8, 1.2])
  a._end = 1.6
  const row = makeRow([a])
  measureLyricLineSweep(row)

  paintLyricWordRow(row, 0.5)
  assert.equal(a.animateCalls.length, 1, 'each word gets one animation')
  // transform をスタイルに書いていないこと
  assert.ok(!Object.keys(a.props).some(k => k === 'transform'))

  const { frames, options } = a.animateCalls[0]
  assert.ok(frames.length >= 8, 'too few keyframes to look smooth')
  assert.equal(options.fill, 'both', 'the lift must stay after the word ends')
  assert.equal(options.easing, 'linear', 'the shape is baked into the keyframes')
  for (const frame of frames) assert.match(frame.transform, /translateY\(-?[\d.]+em\) scale\([\d.]+\)/)
})

test('an ordinary word is never moved at all', () => {
  // 歌った語を持ち上げたままにすると、語ごとに高さが違う階段ができる。
  // 歌った語は上、まだの語は下、その境目に段差が残るので、語と語の間に
  // 区切りがあるように見えてしまう。行は平らのままにする。
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('aa', [0, 0.1])
  a._end = 0.2                       // 速い語
  const row = makeRow([a])
  measureLyricLineSweep(row)
  paintLyricWordRow(row, 0.1)

  assert.ok(!a._emp, 'a 0.2s word must not qualify for emphasis')
  assert.equal(a.animateCalls.length, 0, 'an ordinary word must not be animated')
  assert.ok(!Object.keys(a.props).includes('transform'))
})

test('a held note returns to where it started', () => {
  // 上がりっぱなしにしないこと。戻らないと階段になる。
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('aaaa', [0, 0.5, 1, 1.5])
  a._end = 2
  const row = makeRow([a])
  measureLyricLineSweep(row)
  paintLyricWordRow(row, 0)

  assert.ok(a._emp, 'a 2s note must qualify')
  const frames = a.animateCalls[0].frames
  const lifts = frames.map(f => Number(f.transform.match(/translateY\((-?[\d.]+)em\)/)[1]))
  assert.equal(lifts[0], 0, 'must start at rest')
  assert.equal(lifts[lifts.length - 1], 0, 'must end back at rest')
  assert.ok(Math.min(...lifts) < -0.04, 'must actually rise in the middle')
})

test('the swell of a held note goes up and comes back', () => {
  const { measureLyricLineSweep, paintLyricWordRow } = loadPainter()
  const a = makeSpan('aaaa', [0, 1, 2, 3])
  a._end = 4
  const row = makeRow([a])
  measureLyricLineSweep(row)
  paintLyricWordRow(row, 0)

  const scales = a.animateCalls[0].frames
    .map(f => Number(f.transform.match(/scale\(([\d.]+)\)/)[1]))
  assert.ok(Math.abs(scales[0] - 1) < 1e-6, 'must start at its own size')
  assert.ok(Math.abs(scales[scales.length - 1] - 1) < 1e-6, 'must come back')
  assert.ok(Math.max(...scales) > 1.02, 'a 4s note must actually swell')
})

test('the animation clock is only corrected when it has drifted', () => {
  const api = loadPainter()
  const { measureLyricLineSweep, paintLyricWordRow, clock } = api
  const a = makeSpan('aaaa', [0, 0.6, 1.2, 1.8])
  a._end = 2.4
  const row = makeRow([a])
  measureLyricLineSweep(row)

  clock.now = 0
  paintLyricWordRow(row, 0.2)
  const animation = a.animateCalls[0].animation
  const afterStart = animation.playCount
  assert.ok(afterStart > 0, 'must start playing')

  // 曲も実時間も同じだけ進んだ間は触らない。毎フレーム currentTime を
  // 書くと合成側から主スレッドへ落ちてしまう。
  for (let i = 1; i <= 30; i += 1) {
    clock.now = i * 16.7
    paintLyricWordRow(row, 0.2 + (i * 16.7) / 1000)
  }
  assert.equal(animation.playCount, afterStart, 'must not re-seek every frame')

  // シーク: 実時間は進んでいないのに曲だけ飛んだ
  paintLyricWordRow(row, 8)
  assert.ok(animation.playCount > afterStart, 'a seek must resync')
  assert.equal(animation.currentTime, 8000)
})

test('resuming after a pause puts the motion back in step', () => {
  const api = loadPainter()
  const { measureLyricLineSweep, paintLyricWordRow, clock } = api
  const a = makeSpan('aaaa', [0, 0.6, 1.2, 1.8])
  a._end = 2.4
  const row = makeRow([a])
  measureLyricLineSweep(row)

  clock.now = 0
  paintLyricWordRow(row, 0.2)
  const animation = a.animateCalls[0].animation
  const before = animation.playCount

  // 5秒止まっていた: 実時間だけ進んで曲は進んでいない
  clock.now = 5000
  paintLyricWordRow(row, 0.25)
  assert.ok(animation.playCount > before, 'must resync after a pause')
  assert.equal(animation.currentTime, 250)
})

test('the motion stops when playback stops', () => {
  // 合成側の時計は再生と無関係に進むので、明示的に止めないと
  // 一時停止中も歌詞だけ動き続ける
  assert.match(lyricsUiSource, /const pauseAllLyricWordMotion = \(\) => \{/)
  assert.match(lyricsUiSource, /pauseAllLyricWordMotion\(\);\n\s*isRafLoopRunning = false;/)
})

test('the motion follows the playback rate', () => {
  assert.match(lyricsUiSource, /animation\.playbackRate !== rate/)
  assert.match(lyricsUiSource, /_playbackRateForMotion = /)
})

test('a line going inactive rewinds its motion', () => {
  const { measureLyricLineSweep, paintLyricWordRow, resetLyricWordRow } = loadPainter()
  const a = makeSpan('aaaa', [0, 0.6, 1.2, 1.8])
  a._end = 2.4
  const row = makeRow([a])
  measureLyricLineSweep(row)
  paintLyricWordRow(row, 0.2)
  const animation = a.animateCalls[0].animation
  resetLyricWordRow(row)
  assert.equal(animation.currentTime, 0)
  assert.equal(animation.playState, 'paused')
  assert.equal(Number(row.props['--sweep']), 0)
})

// ── 設定と CSS ───// ── 設定と CSS ───────────────────────────────────────────

test('Apple-style sync is on by default and persisted through settings', () => {
  assert.match(namespaceSource, /appleSyncStyle:\s*true/)
  assert.match(lyricsUiSource, /id="apple-sync-toggle"/)
  assert.match(lyricsUiSource, /storage\.get\('ytm_apple_sync_style'\)/)
  assert.match(lyricsUiSource, /storage\.set\('ytm_apple_sync_style',\s*config\.appleSyncStyle\)/)
})

// 軽量モードでも文字同期は動かす。塗りも持ち上がりも Web Animations の
// キーフレームで合成側に渡してあり、メインスレッドの毎フレーム処理は 0。
// 軽量モードが止めたいのは backdrop-filter のぼかしと背景ドリフトで、
// 設定の文言も「背景アニメーション停止」であって歌詞の話ではない。
// 軽量モードで落とすのは光(--wg → text-shadow)だけ。
// 詳しくは tests/lyric-lightweight-sync.test.mjs を参照。
test('Apple-style sync keeps running in the low CPU mode', () => {
  assert.match(
    lyricsUiSource,
    /classList\.toggle\('ytm-apple-sync', !!config\.appleSyncStyle\)/,
  )
  assert.doesNotMatch(lyricsUiSource, /config\.appleSyncStyle && !config\.lowCpuMode/)
})

test('the gradient fill keeps currentColor so singer colors survive', () => {
  const rule = sourceBetween(
    styleSource,
    'body.ytm-custom-layout.ytm-apple-sync .lyric-line.ytm-word-sync.active .lyric-word {',
    '}',
  )
  // color を透明にすると currentColor まで透明になり色分けが死ぬ
  assert.ok(!/[^-]color:\s*transparent/.test(rule), 'must not null out color itself')
  assert.match(rule, /-webkit-text-fill-color:\s*transparent/)
  assert.match(rule, /background-clip:\s*text/)
  assert.match(rule, /currentColor/)
})

test('the fill is positioned in absolute px from a line-wide front', () => {
  // 語ごとに 0%→100% で閉じると、語の変わり目でぼかしが途切れて境目が見える。
  const rule = sourceBetween(
    styleSource,
    'body.ytm-custom-layout.ytm-apple-sync .lyric-line.ytm-word-sync.active .lyric-word {',
    '\n}',
  )
  const stops = rule.match(/linear-gradient\([\s\S]*?\);/)[0]
  assert.match(stops, /calc\(\(var\(--sweep\) - var\(--wx\) - var\(--feather\)\) \* 1px\)/)
  assert.match(stops, /calc\(\(var\(--sweep\) - var\(--wx\) \+ var\(--feather\)\) \* 1px\)/)
})

test('the fill never sizes or positions its background image', () => {
  // 文字自体の色は透明で、見えているのは背景だけ。背景に大きさや位置を
  // 与えると、画像からはみ出した語がまるごと消える。まだ歌っていない語は
  // 先端が遠いので必ずはみ出す。
  // 停止位置を箱の外に置けば、グラデーションが両端の色を引き伸ばして
  // 語全体を塗ってくれる。
  for (const [name, css] of [
    ['main', sourceBetween(
      styleSource,
      'body.ytm-custom-layout.ytm-apple-sync .lyric-line.ytm-word-sync',
      '\n/* 前後の行では素のテキストに戻す',
    )],
    ['PIP', sourceBetween(pipSource, '.lyric-line.ytm-word-sync {', '.lyric-translation')],
  ]) {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/background-size:/.test(body), `${name}: background-size hides words`)
    assert.ok(!/background-position:/.test(body), `${name}: background-position hides words`)
    // 透明にしているのは text-fill だけで、背景は必ず届いていること
    assert.match(body, /-webkit-text-fill-color:\s*transparent/)
  }
})

test('the soft edge stays narrower than a full-width character', () => {
  // ぼかしが 1em を超えると、先端が字を横切らずに字が丸ごとフェードイン
  // する。それが1文字ずつ順に起きて、かくんかくんと点いて見える。
  const feather = Number(lyricsUiSource.match(/const WORD_FEATHER_EM = ([\d.]+);/)[1])
  assert.ok(feather * 2 < 1, `the ramp is ${feather * 2}em, wider than a CJK glyph`)
  assert.ok(feather * 2 > 0.3, 'too narrow reads as a hard edge')
})

test('the word styling only applies to a line that has word timing', () => {
  const selectors = (styleSource.match(/^body\.ytm-custom-layout\.ytm-apple-sync[^{]*\{/gm) || [])
    .filter(sel => sel.includes('.lyric-word'))
  assert.ok(selectors.length >= 3, 'expected the base, active and inactive rules')
  for (const selector of selectors) {
    assert.ok(
      selector.includes('.ytm-word-sync'),
      `selector must be gated on word data: ${selector.trim()}`,
    )
  }
  assert.match(lyricsUiSource, /row\.classList\.add\('ytm-word-sync'\)/)
})

test('the CSS does not try to move the words itself', () => {
  // Chrome はテキストの縦位置を整数ピクセルに丸める。0.05em の移動を
  // CSS で毎フレーム書いても 1〜2 回のジャンプにしかならない。
  // 動きは Web Animations に渡して合成側で小数のまま動かす。
  const rule = sourceBetween(
    styleSource,
    'body.ytm-custom-layout.ytm-apple-sync .lyric-line.ytm-word-sync .lyric-word {',
    '\n}',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/[^-]transform:/.test(rule), 'transform must come from the animation')
  assert.ok(!/will-change/.test(rule), 'the animation promotes the element on its own')
  assert.match(rule, /transform-origin:\s*50% 78%/)
})

test('a line that is not active drops back to plain text', () => {
  // 塗りの先端が来ない行に掛けたままだと、薄い色で固まる。
  const rule = sourceBetween(
    styleSource,
    'body.ytm-custom-layout.ytm-apple-sync .lyric-line.ytm-word-sync:not(.active) .lyric-word {',
    '}',
  )
  assert.match(rule, /background-image:\s*none/)
  assert.match(rule, /-webkit-text-fill-color:\s*currentColor/)
  assert.match(rule, /text-shadow:\s*none/)
})

test('a line without layout yet is measured again later, not written off', () => {
  // 歌詞パネルを開く前に測ると全部 0 になる。そのまま「済み」にすると
  // 塗りの位置が永久にずれたままになる。
  const { measureLyricLineSweep } = loadPainter()
  const a = makeSpan('aa', [0, 0.1])
  const row = makeRow([a])
  row.offsetWidth = 0
  row.offsetHeight = 0
  measureLyricLineSweep(row)
  assert.ok(!row._sweepReady, 'must retry once the line has a size')

  row.offsetWidth = 40
  row.offsetHeight = 40
  measureLyricLineSweep(row)
  assert.ok(row._sweepReady)
  assert.ok(row._sweepT.length > 0)
})

test('word positions are re-measured when the layout can have moved', () => {
  // 窓の幅や UI サイズが変わると語の横位置が動く
  assert.match(lyricsUiSource, /const invalidateLyricLineSweeps = \(\) => \{/)
  assert.match(lyricsUiSource, /row\._sweepReady = false;/)
  assert.match(lyricsUiSource, /window\.addEventListener\('resize'/)
  // UI サイズの変更でも測り直す
  const applyUiScale = lyricsUiSource.slice(lyricsUiSource.indexOf('function applyUiScale'))
  assert.match(applyUiScale.slice(0, 800), /invalidateLyricLineSweeps\(\)/)
})

test('measurement is spread over frames instead of blocking the render', () => {
  const fn = sourceBetween(lyricsUiSource, 'const prefetchLyricLineSweeps', 'const invalidateLyricLineSweeps')
  assert.match(fn, /requestAnimationFrame/)
  // 1フレームに詰め込みすぎない
  assert.match(fn, /Math\.min\(index \+ \d+, pending\.length\)/)
})

test('switching the sync style re-renders, because the DOM differs', () => {
  // 語ごとの span と1文字ずつの span では作りが違う
  assert.match(lyricsUiSource, /const wordSyncChanged = prevAppleSync !== config\.appleSyncStyle/)
  assert.match(lyricsUiSource, /prevLowCpu !== config\.lowCpuMode/)
  assert.match(
    lyricsUiSource,
    /if \(animatedCaptionsChanged \|\| lyricsSourceChanged \|\| wordSyncChanged\)/,
  )
})

// ── 歌詞ソースの選択 ──────────────────────────────────────

// 選択肢は「YTM 優先 / LRCHub 優先」の2つだけ。どちらも他方(と残りの
// 取得元)へ自動で落ちる。以前あった 'external'(SimpMusic / LyricsPlus のみ)は
// 撤去した。あれは優先ではなく「他を全部禁止」という別種のつまみで、
// 空振りすると歌詞が出ない。設定のせいで歌詞が出ない状態を作らないこと。
test('選べるのは2つだけで、どちらも他所へ落ちられる', () => {
  const normalizerSource = sourceBetween(
    lyricsUiSource,
    'const normalizeSourceMode = (value) => (',
    ');',
  ) + ');'
  const context = {}
  vm.runInNewContext(`${normalizerSource}\nthis.n = normalizeSourceMode;`, context)

  const seen = new Set()
  for (const v of ['ytm', 'ytm_only', 'lrchub', 'external', 'standard', 'lrclib',
    undefined, null, '', 'でたらめ']) seen.add(context.n(v))
  assert.deepEqual([...seen].sort(), ['lrchub', 'ytm'],
    '2つ以外の値を返している(落ちない排他モードが復活していないか)')
})

test('設定画面に並ぶ取得元は3つ', () => {
  const group = sourceBetween(lyricsUiSource, 'id="lyric-source-group"', '</div>')
  const pills = group.match(/data-value="[^"]+"/g) || []
  assert.deepEqual(pills, [
    'data-value="ytm"',
    'data-value="lrchub"',
    // 上2つが「どこに先に聞くか」なのに対し、これだけ軸が違う。
    // どのサーバーでもいいので単語同期を持っている方を採る。
    'data-value="wordsync"',
  ])
})

test('並んでいる取得元は3つとも保存できる', () => {
  const normalize = sourceBetween(lyricsUiSource, 'const normalizeSourceMode =', '\n);')
  for (const mode of ['ytm', 'lrchub', 'wordsync']) {
    assert.match(normalize, new RegExp(`'${mode}'`), `${mode} が正規化で落ちる`)
  }
})

test('撤去した「新ソースのみ」の名残が残っていない', () => {
  for (const src of [lyricsUiSource, namespaceSource, read('src/js/background.js')]) {
    assert.doesNotMatch(src, /settings_source_external|externalOnly|=== 'external'/)
  }
})

function createBackgroundHarness({ api = {} } = {}) {
  const messageListeners = []
  const responses = []

  const defaultApi = {
    extractVideoIdFromUrl: () => '',
    fetchFromLrcLib: async () => null,
    fetchFromLrchub: async () => null,
    fetchFromLrchubSearch: async () => null,
    fetchFromSimpMusic: async () => null,
    fetchFromLyricsPlus: async () => null,
    withTimeout: promise => promise,
    delay: ms => new Promise(resolve => setTimeout(resolve, Math.min(Number(ms) || 0, 10))),
    normalizeLrchubMeaningPayload: () => null,
    normalizeLrchubTranslations: () => ({}),
    hasCharacterSyncedLines: RealAPI.hasCharacterSyncedLines,
    getLrchubRecordId: RealAPI.getLrchubRecordId,
  }

  vm.runInNewContext(backgroundSource, {
    API: { ...defaultApi, ...api },
    // extra-providers.js。既定は「有効だが誰も持っていない」。
    Extra: {
      EXTRA_PROVIDERS_ENABLED: true,
      fetchFromAmll: async () => null,
      fetchFromNetease: async () => null,
      fetchFromKugou: async () => null,
      fetchFromLiriqo: async () => null,
    },
    CloudSync: { CLOUD_STORAGE_KEY: 'k', DEFAULT_CLOUD_STATE: {} },
    chrome: {
      runtime: { lastError: null, onInstalled: { addListener() {} }, onMessage: { addListener(l) { messageListeners.push(l) } } },
      storage: { local: { get() {}, set() {} } },
      tabs: { sendMessage: () => Promise.resolve() },
    },
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch,
    self: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  }, { filename: 'src/js/background.js' })

  return {
    responses,
    dispatch(payload) {
      messageListeners[0]({ type: 'GET_LYRICS', payload }, { tab: { id: 1 } }, r => responses.push(r))
    },
  }
}

const basePayload = {
  track: 'Trial Song',
  artist: 'Trial Artist',
  album: 'Trial Album',
  duration_sec: 180,
  video_id: 'video-1',
  request_id: 'req-1',
  track_key: 'key-1',
  use_lrclib: true,
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await new Promise(resolve => setTimeout(resolve, 5))
}

// どのモードでも「歌詞が見つからない」で終わるのは、全部の取得元が
// 空振りした時だけであること。設定を選んだせいで探し先が減ってはいけない。
for (const mode of ['ytm', 'lrchub']) {
  test(`${mode}: 主たる取得元が空でも他所へ落ちる`, async () => {
    const harness = createBackgroundHarness({
      api: {
        fetchFromLrchub: async () => null,
        fetchFromLrchubSearch: async () => null,
        fetchFromLrcLib: async () => null,
        fetchFromSimpMusic: async () => ({ lyrics: '[00:01.00] simp' }),
      },
    })
    harness.dispatch({ ...basePayload, lyric_source_mode: mode })
    await settle()

    assert.equal(harness.responses.length, 1)
    assert.equal(harness.responses[0].lyricsSource, 'simpmusic',
      '他の取得元が持っているのに諦めている')
  })
}

test('全部の取得元が空振りした時だけ失敗を返す', async () => {
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: async () => null,
      fetchFromLrchubSearch: async () => null,
      fetchFromLrcLib: async () => null,
      fetchFromSimpMusic: async () => null,
      fetchFromLyricsPlus: async () => null,
    },
  })
  harness.dispatch({ ...basePayload, lyric_source_mode: 'ytm' })
  await settle()

  assert.equal(harness.responses.length, 1)
  assert.equal(harness.responses[0].success, false)
  assert.equal(harness.responses[0].track_key, 'key-1')
})

test('新しい取得元にも曲の情報がそのまま渡る', async () => {
  let simpArgs = null
  let plusArgs = null
  const harness = createBackgroundHarness({
    api: {
      fetchFromLrchub: async () => null,
      fetchFromLrchubSearch: async () => null,
      fetchFromLrcLib: async () => null,
      fetchFromSimpMusic: async (args) => { simpArgs = { ...args }; return null },
      fetchFromLyricsPlus: async (args) => { plusArgs = { ...args }; return { lyrics: '[00:01.00] plus' } },
    },
  })
  harness.dispatch({ ...basePayload, lyric_source_mode: 'ytm' })
  await settle()

  assert.equal(simpArgs.video_id, 'video-1')
  assert.equal(plusArgs.track, 'Trial Song')
  assert.equal(plusArgs.album, 'Trial Album')
  assert.equal(plusArgs.duration, 180)
  assert.equal(harness.responses[0].lyricsSource, 'lyricsplus')
})

test('queue prefetch requests use the same source mode as playback', () => {
  const queueSource = read('src/js/module/queue-manager.js')
  assert.match(queueSource, /lyric_source_mode:\s*\(typeof config !== 'undefined' && config\.lyricSourceMode\)/)
})
