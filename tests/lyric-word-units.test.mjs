// 動きの単位(語)の切り方。
//
// 日本語の同期データには、文字と文字の間すべてに空白を入れたものがある。
// 実測では、語タグの 83〜92% が空白で終わる曲が複数あった(滑らかに見える
// 曲は 20%)。これを語の区切りとして扱うと全部の文字が独立した単位になり、
// 膨らみ・光・持ち上げが1文字ずつ掛かって戻るので、点いては止まって見える。
//
// 前後がどちらも CJK の空白は書式とみなして語を切らない。
// 英語のように本当に語を分けている空白は、これまでどおり切る。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const start = source.indexOf('const isSpaceGlyph')
const end = source.indexOf('// ── 行ぜんたいの「時刻 → 進んだ px」表を作る')
assert.ok(start !== -1 && end !== -1, '切り出しの目印が変わっていないか確認')

const sandbox = { console, Intl, WORD_DEFAULT_SEC: 0.4 }
vm.createContext(sandbox)
vm.runInContext(
  `${source.slice(start, end)}\nglobalThis._b = buildLyricWordUnits`,
  sandbox,
)
const buildLyricWordUnits = sandbox._b

// "あ い う" のように1文字ごとに空白を挟んだ入力を作る
const spaced = (glyphs, stepMs = 200) => {
  const chars = []
  let t = 0
  glyphs.forEach((g, i) => {
    chars.push({ c: g, t })
    t += stepMs
    if (i < glyphs.length - 1) { chars.push({ c: ' ', t }); t += stepMs }
  })
  return chars
}
const plain = (glyphs, stepMs = 200) =>
  glyphs.map((g, i) => ({ c: g, t: i * stepMs }))

const words = (units) => units.filter(u => u.type === 'word')
const glyphCount = (unit) => Array.from(unit.text.replace(/\s/g, '')).length

test('CJK の間に挟まった空白は語を切らない', () => {
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星']), 20))
  assert.ok(units.length < 5, `1文字ずつに割れている (${units.length}語)`)
  const total = units.reduce((sum, u) => sum + glyphCount(u), 0)
  assert.equal(total, 5, '文字が消えたり増えたりしないこと')
})

test('書式の空白は捨てる', () => {
  // 残すと字の間が空いて見える。さらに、データは「文字+空白」で1区間なので
  // 区間の時間が両者で等分され、塗りが半分の時間を見えない空白の上で使う。
  // 捨てれば文字が区間をまるごと使い、塗りの速さが揃う。
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星']), 20))
  assert.ok(units.every(u => !/\s/.test(u.text)), '空白が残っている')
})

test('捨てた空白の時刻を語の終わりにしない', () => {
  // データは「文字+空白」で1区間なので、空白は区間の中点の時刻を持つ。
  // 語の終わりをそこに置くと、次の語の頭(区間の終わり)までの間、
  // 塗りが進む px がゼロになる。単調3次の接線はその両端で 0 になるので、
  // 塗りは文字ごとに完全に止まる。実測では行の時間の 24〜29% が停止で、
  // 滑らかに見える曲は 0% だった。
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星'], 100), 20))
  assert.ok(units.length > 1, '比べる語が2つ以上あること')
  for (let i = 0; i < units.length - 1; i++) {
    assert.equal(units[i].end, units[i + 1].start,
      `${i} 番目の語の終わりと次の語の頭が離れている(その間、塗りが止まる)`)
  }
})

test('語の終わりは区間の中点ではなく区間の終わり', () => {
  // 真@0 ␣@100 夏@200 ␣@300 夜@400。元データの区間は 0→200→400 で、
  // 空白はその中点。真を含む語は 100 ではなく 200 で終わること。
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜'], 100), 20))
  // 最後の語だけは行の終わり(第2引数)を使うので対象外
  const tags = new Set(['0.000', '0.200', '0.400'])
  for (const u of units.slice(0, -1)) {
    assert.ok(tags.has(u.end.toFixed(3)),
      `語 "${u.text}" の終わりが ${u.end} — 元データに無い時刻(空白の中点)`)
  }
})

test('空白の無いデータと同じ形になる', () => {
  // 名残り桜のように空白を持たない曲は元から語が途切れず繋がっている。
  // 空白を挟んだデータも同じ形に揃うこと。
  const a = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星'], 100), 20))
  const b = words(buildLyricWordUnits(plain(['真', '夏', '夜', '空', '星'], 200), 20))
  const shape = (us) => us.map(u => `${u.text}:${u.start}-${u.end}`).join('|')
  assert.equal(shape(a), shape(b))
})

test('書式の空白を捨てても、文字ごとの時刻は元のまま', () => {
  // 捨てた空白のぶん時刻を詰めてはいけない。声とずれる。
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜'], 100), 20))
  const times = Array.from(units.flatMap(u => u.times))
  assert.equal(times.length, 3)
  assert.equal(times[0].toFixed(3), '0.000')
  assert.equal(times[1].toFixed(3), '0.200')
  assert.equal(times[2].toFixed(3), '0.400')
})

test('英語の語間の空白はこれまでどおり語を切る', () => {
  const chars = []
  let t = 0
  for (const g of 'one two three') { chars.push({ c: g, t }); t += 100 }
  const units = words(buildLyricWordUnits(chars, 10))
  assert.equal(units.length, 3)
  assert.equal(units[0].text.trim(), 'one')
  assert.equal(units[1].text.trim(), 'two')
  assert.equal(units[2].text.trim(), 'three')
})

test('空白の過半数が CJK 間でなければ、書式とみなさない', () => {
  // 空白3つのうち CJK に挟まれているのは1つだけ
  const chars = []
  let t = 0
  for (const g of '和 ab cd ef') { chars.push({ c: g, t }); t += 100 }
  const units = words(buildLyricWordUnits(chars, 10))
  assert.ok(units.length >= 4, `語が繋がってしまっている (${units.length}語)`)
})

test('空白の無いデータは今までどおり', () => {
  const before = words(buildLyricWordUnits(plain(['真', '夏', '夜', '空', '星']), 10))
  assert.ok(before.length >= 1)
  const total = before.reduce((sum, u) => sum + glyphCount(u), 0)
  assert.equal(total, 5)
})

test('語の時刻と文字の対応が崩れない', () => {
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星']), 20))
  for (const unit of units) {
    assert.equal(unit.times.length, Array.from(unit.text).length,
      '文字ごとの時刻の数が本文の長さと合っていること')
    assert.equal(unit.offsets.length, unit.times.length)
    assert.ok(Number.isFinite(unit.start), '開始時刻が出ていること')
    assert.ok(Number.isFinite(unit.end) && unit.end > unit.start, '終わりが開始より後')
  }
})

test('時刻は単調に増えたまま', () => {
  const units = words(buildLyricWordUnits(spaced(['真', '夏', '夜', '空', '星']), 20))
  // vm コンテキスト内で作られた配列なので deepEqual は使えない。
  // 並びそのものを直接確かめる。
  const times = Array.from(units.flatMap(u => u.times)).filter(t => t !== null)
  assert.ok(times.length > 1)
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] >= times[i - 1], `${i} 番目で時刻が戻っている`)
  }
})

test('行頭の書式空白で語が壊れない', () => {
  const chars = [{ c: ' ', t: 0 }, ...spaced(['真', '夏', '夜'], 20).map(
    c => ({ ...c, t: c.t + 100 }))]
  const units = words(buildLyricWordUnits(chars, 10))
  const total = units.reduce((sum, u) => sum + glyphCount(u), 0)
  assert.equal(total, 3)
})

test('韓国語の語と語の間の空白は残す(分かち書き)', () => {
  // 「울 것 같을 때」が「울것같을때」に詰まっていた(実機: OMG / NewJeans)
  const chars = [
    { c: '울 ', t: 0 }, { c: '것 ', t: 260 }, { c: '같을 ', t: 520 }, { c: '때', t: 930 },
  ]
  const units = buildLyricWordUnits(chars, 1.5)
  const text = units.map(u => u.text).join('')
  assert.equal(text.trim(), '울 것 같을 때')
  assert.equal(words(units).length, 4)
})
