// 狭い画面(縦積み)のレイアウト。
//
// 以前は次の 4 つが噛み合っていなかった:
//   ・上下の余白が非対称(上だけ 10vh に上書き、下は 30vh のまま)。JS の中央寄せは
//     「器の高さの半分」を前提にしているので、曲の序盤と終盤の行が中央まで来られず
//     見出しの真下やプレイヤーバーの上に貼り付いていた。
//   ・wrapper の padding・見出しの高さ・gap・歌詞の 65vh を手で足していたので、
//     窓の大きさによっては合計が 100vh を超え、歌詞の下がバーに潜った。
//   ・左右も非対称(右 16px / 左 44px)で、歌詞の光学中心がずれていた。
//   ・切り替えが orientation だったので、横長でも狭い窓が横並びのまま潰れた。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const NARROW = '@media (max-width: 900px) {'
const at = css.indexOf(NARROW)
assert.notEqual(at, -1, '狭い画面のブロックが見つからない')

// 対応する閉じ括弧までを切り出す
const block = (() => {
  let depth = 0
  for (let i = at + NARROW.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(at, i + 1)
    }
  }
  assert.fail('ブロックが閉じていない')
})()

const ruleIn = (source, selector) => {
  const start = source.indexOf(selector + ' {')
  assert.notEqual(start, -1, `見つからない: ${selector}`)
  return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start))
}

test('切り替えは向きではなく幅で見る', () => {
  // orientation で切ると、横長でも狭い窓が横並びのまま潰れる
  assert.ok(
    !/@media \(orientation: portrait\) \{\s*\n\s*body\.ytm-custom-layout #ytm-custom-wrapper/.test(css),
    'レイアウトの切り替えが orientation に戻っている',
  )
})

test('見出しと歌詞は grid の auto + 1fr で分ける', () => {
  const wrapper = ruleIn(block, 'body.ytm-custom-layout #ytm-custom-wrapper')
  // 上に display:flex !important があるので、こちらも !important が要る
  assert.match(wrapper, /display:\s*grid\s*!important/)
  assert.match(wrapper, /grid-template-rows:\s*auto minmax\(0, 1fr\)/)
  // 列を書かないと「中身なりの幅」になり、曲名が短い曲では見出しも歌詞も
  // 画面の真ん中に寄って細くなる(実測: 470px 幅で歌詞の器が 293px、
  // 左端から 89px の位置。歌詞が数文字で折り返していた)
  assert.match(wrapper, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  // 横並びの align-items:center が残ると、container-type:size の歌詞が高さ 0 に潰れる
  assert.match(wrapper, /align-items:\s*stretch/)
  // プレイヤーバーのぶんは変数で持つ(マジックナンバーを置かない)
  assert.match(wrapper, /--ytm-player-safe:/)
  assert.match(wrapper, /padding:[^;]*var\(--ytm-player-safe\)/)
})

test('歌詞の高さは固定の vh にしない', () => {
  const stage = ruleIn(block, 'body.ytm-custom-layout #ytm-lyrics-stage')
  assert.ok(!/height:\s*\d+vh/.test(stage), '固定の vh に戻っている(足し算が合わなくなる)')
  assert.match(stage, /container-type:\s*size/)
})

test('歌っている行は上から 0.5 行ぶん下げた所に止める', () => {
  const cont = ruleIn(block, 'body.ytm-custom-layout #my-lyrics-container')
  assert.match(cont, /--ytm-lyrics-anchor-top-lines:\s*0\.5/)
})

test('上下の余白は器の高さぶん(1行目と最終行が同じ高さで光る)', () => {
  const cont = ruleIn(block, 'body.ytm-custom-layout #my-lyrics-container')
  const top = cont.match(/padding-top:\s*([\d.]+)cqh;/)
  const bottom = cont.match(/padding-bottom:\s*([\d.]+)cqh;/)
  assert.ok(top && bottom, '上下の余白が器を基準(cqh)にしていない')
  // 合計が器の高さぶんあれば、1行目も最終行も好きな位置まで来られる
  assert.equal(Number(top[1]) + Number(bottom[1]), 100, '上下の合計が器の高さぶんない')
  // 上は「止める位置」を下回ってはいけない(1行目だけ上に寄る)
  assert.ok(Number(top[1]) > 0, '上の余白が無いと1行目が止める位置まで上がれない')
})

test('上の暈しは歌っている行にかからない', () => {
  const cont = ruleIn(block, 'body.ytm-custom-layout #my-lyrics-container')
  const mask = cont.match(/mask-image:\s*linear-gradient\(to bottom, transparent, black ([\d.]+)%/)
  assert.ok(mask, '狭い画面用の暈しが指定されていない')
  // 行の高さ(35px 前後)より内側で暈しが終わっていること。
  // 器 600px として 4% = 24px。0.5 行(17px)の位置に来る行が透けない。
  assert.ok(Number(mask[1]) <= 6, `上の暈しが濃すぎる(${mask[1]}%)`)
})

test('左右の余白も対称', () => {
  const cont = ruleIn(block, 'body.ytm-custom-layout #my-lyrics-container')
  const left = cont.match(/padding-left:\s*([^;]+);/)
  const right = cont.match(/padding-right:\s*([^;]+);/)
  assert.ok(left && right, '左右の余白が指定されていない')
  assert.equal(left[1].trim(), right[1].trim(), '左右が非対称(歌詞の光学中心がずれる)')
})

test('見出しは 2 段に収める', () => {
  const col = ruleIn(block, 'body.ytm-custom-layout #ytm-custom-left-col')
  assert.match(col, /grid-template-areas:\s*\n?\s*"art title\s+toggle"/)
  assert.match(col, /"btns btns\s+btns"/)
  // 中身(曲名・アーティスト・ボタン列・トグル)を直接この格子へ並べる
  assert.match(ruleIn(block, 'body.ytm-custom-layout #ytm-custom-info-area'), /display:\s*contents/)
  // 取得元バッジを流れに乗せると、それだけで 1 段増える
  assert.match(
    ruleIn(block, 'body.ytm-custom-layout #ytm-lyrics-source-debug.ytm-source-inline'),
    /position:\s*fixed/,
  )
})

test('長い曲名でトグルを押し出さない', () => {
  const text = ruleIn(block, 'body.ytm-custom-layout #ytm-custom-title,\n  body.ytm-custom-layout #ytm-custom-artist')
  assert.match(text, /text-overflow:\s*ellipsis/)
  assert.match(text, /min-width:\s*0/)
})

test('曲/動画トグルは moviemode の固定配置を邪魔しない', () => {
  const toggle = ruleIn(block, 'body.ytm-custom-layout div#ytm-custom-wrapper ytmusic-av-toggle:not(.moviemode)')
  assert.match(toggle, /grid-area:\s*toggle/)
})

// 重ねて出すものは、画面より広いと端が切れて触れなくなる。
// 設定パネルは 840x620 の固定だったので、470px 幅の窓では左のタブ列も
// 右端も画面の外に出ていた(実測: 本文 322px に対し 840px)。
test('重ねて出すパネルが画面に収まる', () => {
  const settings = ruleIn(block, '#ytm-settings-panel')
  assert.match(settings, /width:\s*calc\(100vw - \d+px\)/)
  assert.match(settings, /height:\s*min\([^)]+\)/)

  // 左のタブ列を細くして、本文に幅を回す
  assert.match(ruleIn(block, '.settings-tabs'), /width:\s*\d+px/)
  assert.match(ruleIn(block, '.settings-tab-btn span'), /text-overflow:\s*ellipsis/)

  for (const sel of ['#ytm-switch-panel', '#ytm-queue-panel']) {
    assert.match(ruleIn(block, sel), /width:\s*min\([^)]*100vw[^)]*\)/, `${sel} が画面幅を見ていない`)
  }
})

// 文字のボタン(Lyrics / PIP)だけが UI サイズに追従し、アイコンのボタンは
// 8px 12px / 16px の固定だった。横画面は flex の stretch で高さが揃って
// いたが、縦画面は align-items:center にしたため差が出た
// (実測: 文字 33px / アイコン 42px)。
test('ボタンの大きさが揃っている', () => {
  const btn = ruleIn(block, 'body.ytm-custom-layout #ytm-btn-area .ytm-glass-btn')
  const icon = ruleIn(block, 'body.ytm-custom-layout #ytm-btn-area .ytm-glass-btn.icon-btn')
  const h = btn.match(/height:\s*(\d+)px/)
  const w = icon.match(/width:\s*(\d+)px/)
  assert.ok(h, '高さを決めていない(中身の量で高さが変わる)')
  assert.ok(w, 'アイコンのボタンが正方形になっていない')
  assert.equal(h[1], w[1], 'アイコンのボタンが真円にならない')
  assert.match(btn, /align-items:\s*center/)
  assert.match(btn, /flex:\s*0 0 auto/, '幅が足りない時に縮んで大きさがばらける')
  // 中の SVG も揃える
  assert.match(ruleIn(block, 'body.ytm-custom-layout #ytm-btn-area .ytm-glass-btn svg'), /width:\s*\d+px/)
})
