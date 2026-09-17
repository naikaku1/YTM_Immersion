// Apple Music 風の動く背景(軽量モード OFF)の素材切れ。
//
// 回る2枚は ％で大きさを指定していた。％は画面の縦横比をそのまま形にするので、
// 横長の画面では高さ(160% = 画面高の1.6倍)が画面幅に届かない。
// rotate(90deg) の位相でその短い辺が横に来て、画面の端に切れ目が見えていた。
//
// ここでは「どの縦横比・どの位相でも覆い切れるか」を数字で確かめる。
// 形は内接円で見る(角が丸いぶん実際にはもう少し余裕がある)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const css = fs.readFileSync(new URL('../src/css/style.css', import.meta.url), 'utf8')

const ruleBody = (selector) => {
  const at = css.indexOf(selector)
  assert.notEqual(at, -1, `見つからない: ${selector}`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const sizeOf = (selector) => {
  const body = ruleBody(selector)
  const width = body.match(/width:\s*([\d.]+)vmax/)
  const height = body.match(/height:\s*([\d.]+)vmax/)
  assert.ok(width && height, `${selector} が vmax で指定されていない(％だと縦横比で形が変わる)`)
  assert.equal(width[1], height[1], `${selector} が正方形でない`)
  return Number(width[1])
}

const keyframesOf = (name) => {
  const at = css.indexOf(`@keyframes ${name}`)
  assert.notEqual(at, -1, `見つからない: ${name}`)
  const block = css.slice(at, css.indexOf('\n}', at))
  return [...block.matchAll(/transform:\s*translate\(([-\d.]+)%,\s*([-\d.]+)%\)\s*scale\(([\d.]+)\)/g)]
    .map(m => ({ tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }))
}

// 画面を覆えていない位相があれば、その不足量(vmax)を返す
const worstMargin = (sizeVmax, frames, w, h) => {
  const vmax = Math.max(w, h) / 100
  const size = sizeVmax * vmax
  const diagHalf = Math.hypot(w, h) / 2
  let margin = Infinity
  for (let i = 0; i < frames.length - 1; i++) {
    for (let s = 0; s <= 1; s += 0.02) {
      const a = frames[i]
      const b = frames[i + 1]
      const tx = (a.tx + (b.tx - a.tx) * s) / 100 * size
      const ty = (a.ty + (b.ty - a.ty) * s) / 100 * size
      const scale = a.scale + (b.scale - a.scale) * s
      margin = Math.min(margin, size * scale / 2 - (Math.hypot(tx, ty) + diagHalf))
    }
  }
  return margin / vmax
}

const viewports = [
  ['16:9', 1920, 1080],
  ['ほぼ正方形', 865, 879],
  ['21:9', 2560, 1080],
  ['縦長', 600, 1000],
  ['極端な横長', 3440, 900],
  ['極端な縦長', 500, 1200],
]

const layers = [
  ['::before', 'body.ytm-apple-bg #ytm-custom-bg::before', 'amFluid1'],
  ['::after', 'body.ytm-apple-bg #ytm-custom-bg::after', 'amFluid2'],
]

test('大きさは画面の縦横比に引きずられない', () => {
  layers.forEach(([label, selector]) => {
    const body = ruleBody(selector)
    assert.ok(!/width:\s*[\d.]+%/.test(body), `${label} が％指定に戻っている`)
    assert.ok(sizeOf(selector) >= 150, `${label} が小さすぎる`)
  })
})

test('どの縦横比・どの位相でも画面を覆う', () => {
  layers.forEach(([label, selector, anim]) => {
    const size = sizeOf(selector)
    const frames = keyframesOf(anim)
    assert.ok(frames.length >= 2, `${anim} のキーフレームが読めない`)
    viewports.forEach(([vpLabel, w, h]) => {
      const margin = worstMargin(size, frames, w, h)
      assert.ok(margin > 0, `${label} が ${vpLabel} で ${(-margin).toFixed(1)}vmax 足りない`)
    })
  })
})

test('画面の外へ出たぶんは切られる(はみ出しても邪魔しない)', () => {
  assert.match(ruleBody('#ytm-custom-bg {'), /overflow:\s*hidden/)
})

test('中央に置く(端を基準にすると回った時に寄る)', () => {
  layers.forEach(([label, selector]) => {
    const body = ruleBody(selector)
    const size = sizeOf(selector)
    const top = body.match(/top:\s*calc\(50% - ([\d.]+)vmax\)/)
    const left = body.match(/left:\s*calc\(50% - ([\d.]+)vmax\)/)
    assert.ok(top && left, `${label} が中央基準で置かれていない`)
    assert.equal(Number(top[1]) * 2, size, `${label} の縦位置が中央からずれている`)
    assert.equal(Number(left[1]) * 2, size, `${label} の横位置が中央からずれている`)
  })
})
