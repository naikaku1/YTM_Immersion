// 曲モードでも動画モードでも、Immersion の空いている所をダブルクリックしたら全画面。
// 全画面は YouTube Music 自身の全画面ボタンを押して入る(YTM の f キーと食い違わない)。
// 押せる物・歌詞の行・ジャケット・曲名の上では何もしない。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8')
const start = uiSource.indexOf('const FULLSCREEN_DBLCLICK_IGNORE')
const end = uiSource.indexOf('// ── 曲送り直後のメタデータの食い違い')

// closest は、要素が持つ「祖先の選択子」の一覧に、聞かれた選択子のどれかが入っていれば当たる
const el = (...ancestors) => ({
  closest: (sel) => (sel.split(', ').some(s => ancestors.includes(s)) ? {} : null),
})

const setup = ({ immersion = true, ytmButton = true, fullscreen = false } = {}) => {
  const listeners = {}
  const calls = []
  const button = { click: () => calls.push('ytm-button') }
  const doc = {
    body: { classList: { contains: (c) => c === 'ytm-custom-layout' && immersion } },
    addEventListener: (type, fn) => { listeners[type] = fn },
    querySelector: (sel) => (sel === 'ytmusic-player .fullscreen-button' && ytmButton ? { querySelector: () => button } : null),
    fullscreenElement: fullscreen ? {} : null,
    exitFullscreen: () => { calls.push('exit'); return Promise.resolve() },
    documentElement: { requestFullscreen: () => { calls.push('request'); return Promise.resolve() } },
  }
  new Function('document', 'console', uiSource.slice(start, end))(doc, console)
  const fire = (type, target, extra = {}) => {
    let prevented = false
    listeners[type]({ target, button: 0, detail: 2, preventDefault: () => { prevented = true }, ...extra })
    return prevented
  }
  return { calls, fire }
}

test('空いている所(背景・歌詞の行の間・映像の上)のダブルクリックで YTM の全画面ボタンを押す', () => {
  for (const target of [el('#ytm-custom-wrapper'), el('#ytm-custom-bg')]) {
    const h = setup()
    assert.equal(h.fire('dblclick', target), true)
    assert.deepEqual(h.calls, ['ytm-button'])
  }
})

test('押せる物・歌詞の行・ジャケット・曲名の上では何もしない', () => {
  for (const inner of ['button', 'a', '.lyric-line', '#ytm-artwork-container', '#ytm-custom-title', '#ytm-custom-artist', '#ytm-btn-area', '#ytm-meaning-panel', 'ytmusic-av-toggle', 'input']) {
    const h = setup()
    assert.equal(h.fire('dblclick', el('#ytm-custom-wrapper', inner)), false, inner)
    assert.equal(h.fire('mousedown', el('#ytm-custom-wrapper', inner)), false, inner)
    assert.deepEqual(h.calls, [], inner)
  }
})

test('Immersion の外(YTM の画面・プレイヤーバー)や、Immersion を閉じている時は何もしない', () => {
  const outside = setup()
  outside.fire('dblclick', el('ytmusic-player-bar'))
  assert.deepEqual(outside.calls, [])
  const closed = setup({ immersion: false })
  closed.fire('dblclick', el('#ytm-custom-wrapper'))
  assert.deepEqual(closed.calls, [])
})

// YTM の全画面ボタンは入るだけで、全画面中に押しても戻らない(実機)
test('全画面の時は exitFullscreen で戻る(YTM のボタンは押さない)', () => {
  const h = setup({ fullscreen: true })
  h.fire('dblclick', el('#ytm-custom-wrapper'))
  assert.deepEqual(h.calls, ['exit'])
})

test('YTM の全画面ボタンが見つからない時は、ページごと全画面にする', () => {
  const h = setup({ ytmButton: false })
  h.fire('dblclick', el('#ytm-custom-wrapper'))
  assert.deepEqual(h.calls, ['request'])
})

test('空いている所の 2 回目の押し下げでは、文字が選ばれないようにする(1 回目・右ボタンは止めない)', () => {
  const h = setup()
  assert.equal(h.fire('mousedown', el('#ytm-custom-wrapper')), true)
  assert.equal(h.fire('mousedown', el('#ytm-custom-wrapper'), { detail: 1 }), false)
  assert.equal(h.fire('mousedown', el('#ytm-custom-wrapper'), { button: 2 }), false)
})

// 曲モードの曲名の欄は左の列の下半分まで広がっている。欄ごと外すと、空いて見える所でも効かなかった
test('曲名の欄の空いている所(曲名・ボタン列の外)では効く', () => {
  const h = setup()
  h.fire('dblclick', el('#ytm-custom-wrapper', '#ytm-custom-info-area'))
  assert.deepEqual(h.calls, ['ytm-button'])
})
