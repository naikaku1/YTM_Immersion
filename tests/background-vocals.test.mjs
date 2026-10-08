// ハモリ(バックボーカル)。
//
// Apple Music 由来の歌詞は、本編と重なって歌われるハモリに印を付けてくる。
//   LyricsPlus / BuaaaBot の JSON : 音節の isBackground
//   TTML(AMLL・BuaaaBot)        : <span ttm:role="x-bg"> の中の語
//   .lys(AMLL)                  : 行属性 [6]〜[8] の行(本編の行のすぐ後ろ)
// これを本編に混ぜると「(Yes)I know I Mountain Dew…」のように 1 行に並んだり、
// 普通の行として割り込んだりする。本編の行に bg として持たせ、画面では行の下に
// 小さく出す。印の無い括弧は推測しない(読み仮名などと見分けが付かない)。
// 語はすべてこのファイルで作った仮の文字列。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

globalThis.chrome = {
  runtime: { lastError: null },
  storage: { local: { get: (_k, cb) => cb({}) } },
  permissions: {
    contains: (_p, cb) => cb(true),
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} },
  },
}

const { convertLyricsPlusResponse, makeBackgroundVocal } = await import('../src/js/module/api.js')
const { parseLys, parseTtml, convertBuaaaResponse } = await import('../src/js/module/extra-providers.js')

const text = (chars) => chars.map(ch => ch.c).join('')

test('LyricsPlus: 印の付いた音節は本編から外して bg にする', () => {
  const result = convertLyricsPlusResponse({
    lyrics: [
      {
        time: 55644,
        duration: 2349,
        text: '(Yes)Alpha beta gamma',
        syllabus: [
          { time: 55644, duration: 642, text: '(Yes)', isBackground: true },
          { time: 55911, duration: 250, text: 'Alpha ' },
          { time: 56161, duration: 318, text: 'beta ' },
          { time: 56479, duration: 300, text: 'gamma' },
        ],
      },
      { time: 60000, duration: 1000, text: 'Delta', syllabus: [{ time: 60000, duration: 1000, text: 'Delta' }] },
    ],
  })
  const [first, second] = result.dynamicLines
  assert.equal(first.text, 'Alpha beta gamma')
  assert.equal(text(first.chars), 'Alpha beta gamma')
  assert.equal(first.bg.text, 'Yes')                 // 括弧は外す
  assert.equal(first.bg.startTimeMs, 55644)
  assert.equal(first.bg.endTimeMs, 55644 + 642)
  assert.equal(first.startTimeMs, 55644)             // 行はハモリの始まりから光る
  assert.equal(second.bg, undefined)
  // LRC の本文にもハモリは混ぜない
  assert.match(result.lyrics, /\] Alpha beta gamma$/m)
  assert.doesNotMatch(result.lyrics, /Yes/)
})

test('LyricsPlus: ハモリだけの行は本編として残す', () => {
  const result = convertLyricsPlusResponse({
    lyrics: [{
      time: 1000,
      text: '(Ooh)',
      syllabus: [{ time: 1000, duration: 500, text: '(Ooh)', isBackground: true }],
    }],
  })
  assert.equal(result.dynamicLines[0].text, '(Ooh)')
  assert.equal(result.dynamicLines[0].bg, undefined)
})

test('.lys: [6]〜[8] の行は直前の本編の行に付ける', () => {
  const lines = parseLys([
    '[0]Alpha(1000,300) (0,0)beta(1300,300)',
    '[6]Echo(900,200)',
    '[1]Gamma(3000,300)',
    '[8]Far(3400,250) (0,0)away(3650,250)',
  ].join('\n'))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].text, 'Alpha beta')
  assert.equal(lines[0].bg.text, 'Echo')
  assert.equal(lines[0].startTimeMs, 900)
  assert.equal(lines[1].bg.text, 'Far away')
  assert.equal(lines[1].bg.endTimeMs, 3900)
})

test('TTML: 入れ子のハモリは 2 語目以降も本編に混ぜない', () => {
  const ttml = '<tt><body><div>'
    + '<p begin="00:01.000" end="00:04.000">'
    + '<span begin="00:01.000" end="00:01.500">Alpha</span> '
    + '<span begin="00:01.500" end="00:02.000">beta</span>'
    + '<span ttm:role="x-bg">'
    + '<span begin="00:02.100" end="00:02.400">(One</span> '
    + '<span begin="00:02.400" end="00:02.700">two</span> '
    + '<span begin="00:02.700" end="00:03.200">three)</span>'
    + '</span>'
    + '</p>'
    + '<p begin="00:05.000" end="00:06.000"><span begin="00:05.000" end="00:06.000">Gamma</span></p>'
    + '</div></body></tt>'
  const lines = parseTtml(ttml)
  assert.equal(lines.length, 2)
  // 語と語の間の空白(span の外)も拾う
  assert.equal(lines[0].text, 'Alpha beta')
  assert.equal(lines[0].bg.text, 'One two three')
  assert.equal(lines[0].bg.endTimeMs, 3200)
  assert.equal(lines[0].endTimeMs, 2000)             // 本編の終わりは本編の語から
  assert.equal(lines[1].bg, undefined)
})

test('BuaaaBot: JSON で印が消えていても、付いてくる TTML に印があればそちらで組む', () => {
  const ttml = '<tt><body><div>'
    + '<p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:01.500">Al</span><span begin="00:01.500" end="00:02.000">pha</span>'
    + '<span ttm:role="x-bg"><span begin="00:02.000" end="00:02.800">（Echo）</span></span></p>'
    + '<p begin="00:04.000" end="00:05.000"><span begin="00:04.000" end="00:04.500">Be</span><span begin="00:04.500" end="00:05.000">ta</span></p>'
    + '</div></body></tt>'
  const json = {
    lyrics: [
      { time: 1000, duration: 2000, syllabus: [{ time: 1000, duration: 500, text: 'Al' }, { time: 1500, duration: 500, text: 'pha' }, { time: 2000, duration: 800, text: '（Echo）' }] },
      { time: 4000, duration: 1000, syllabus: [{ time: 4000, duration: 500, text: 'Be' }, { time: 4500, duration: 500, text: 'ta' }] },
    ],
    ttml,
  }
  const result = convertBuaaaResponse(json, {})
  assert.equal(result.dynamicLines[0].text, 'Alpha')
  assert.equal(result.dynamicLines[0].bg.text, 'Echo')
  // 印の無い TTML なら今までどおり JSON から(混ざったまま)
  const plain = convertBuaaaResponse({ ...json, ttml: ttml.replace(/ ttm:role="x-bg"/, '') }, {})
  assert.equal(plain.dynamicLines[0].bg, undefined)
  assert.equal(plain.dynamicLines[0].text, 'Alpha（Echo）')
})

test('括弧は前後そろっている時だけ外し、空になったら作らない', () => {
  assert.equal(makeBackgroundVocal([{ t: 1, c: '(Ah' }, { t: 2, c: 'ha)' }]).text, 'Ahha')
  assert.equal(makeBackgroundVocal([{ t: 1, c: '(Ah' }, { t: 2, c: 'ha' }]).text, '(Ahha')
  assert.equal(makeBackgroundVocal([{ t: 1, c: '()' }]), null)
  assert.equal(makeBackgroundVocal([]), null)
})

test('画面: 本編の下に出し、塗りは本編と別に走らせ、行はハモリの間も点けておく', () => {
  const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
  assert.match(ui, /const bgEl = dyn \? buildLyricBackgroundRow\(dyn\.bg, useWordSync\) : null;/)
  // 本編(.lyric-main)の後ろに置く。歌詞カード・Discord が読む本編に混ざらない
  assert.ok(ui.indexOf('row.appendChild(bgEl);') > ui.indexOf('row.appendChild(mainSpan);'))
  // 本編の最後の語は本編の終わりで塗る。行が点いている区間だけをハモリまで伸ばす
  assert.match(ui, /const lineEndSec = mainEndSec;/)
  assert.match(ui, /line\._dynamicRenderEndSec = Math\.max\(line\._dynamicRenderEndSec, bgEndSec\);/)
  // 光っている行ではハモリも塗り、外れたら戻す
  assert.match(ui, /if \(bgHost\) paintLyricWordRow\(bgHost, t, _playbackRateForMotion\);/)
  assert.match(ui, /if \(bgHost\) resetLyricWordRow\(bgHost\);/)
  const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.lyric-bg \{[^}]*font-size: 0\.6em;/)
  // ふだんは畳み、光った行で開く(Apple Music と同じ割り込み方)
  assert.match(css, /\.lyric-bg \{[^}]*max-height: 0;[^}]*opacity: 0;/)
  assert.match(css, /\.lyric-line\.active \.lyric-bg \{[^}]*max-height: 6em;/)
  // 止める位置はハモリを除いた高さで決める(その行だけずれない)
  assert.match(ui, /lyricAnchorOffset\(container, lyricRowAnchorHeight\(r, rRect\)\)/)
  assert.match(ui, /\(lyricRowAnchorHeight\(r, rRect\) \/ 2\)/)
  assert.match(css, /\.lyric-bg\.ytm-bg-sync \{[^}]*--sweep: 0;/)
})

test('まとまりの端の空白は inline-block の外に出す(語の間が詰まって見える)', () => {
  const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
  const fn = ui.slice(ui.indexOf('const appendLyricWordSpans'), ui.indexOf('const buildLyricBackgroundRow'))
  assert.match(fn, /while \(from < to && group\[from\]\.type === 'space'\) from \+= 1;/)
  assert.match(fn, /while \(to > from && group\[to - 1\]\.type === 'space'\) to -= 1;/)
  assert.match(fn, /if \(tail\) target\.appendChild\(document\.createTextNode\(tail\)\);\n  \}\n  return wordSpans;/)
})

test('行が最初の語より先に光っても(先に歌われるハモリ)、本編の塗りは語の時刻まで待つ', () => {
  const ui = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
  const src = ui.slice(ui.indexOf('const syncLyricWordMotion'), ui.indexOf('const stopLyricWordMotion'))
  const context = { performance: { now: () => 1000 }, MOTION_RESYNC_SEC: 0.12 }
  vm.runInNewContext(`${src}\nthis.sync = syncLyricWordMotion;`, context)
  // ブラウザの Animation と同じく、負の時刻のまま play() すると 0 に巻き戻る
  const animation = {
    currentTime: 0,
    playState: 'paused',
    playbackRate: 1,
    play() { if (this.currentTime < 0) this.currentTime = 0; this.playState = 'running' },
    pause() { this.playState = 'paused' },
  }
  const row = { _motions: [animation], _motionOrigin: 31.045 }
  context.sync(row, 29.5, 1)   // 本編は 31.045 秒から。ハモリで行は 29.46 秒から光る
  assert.equal(animation.playState, 'paused')
  assert.ok(Math.abs(animation.currentTime - (29.5 - 31.045) * 1000) < 1e-6)
  context.sync(row, 31.2, 1)   // 本編が始まったら走らせる
  assert.equal(animation.playState, 'running')
  assert.ok(Math.abs(animation.currentTime - 155) < 1e-6)
})
