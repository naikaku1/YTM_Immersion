// 動画モードの PiP。MV を captureStream で写して映し、歌詞は下に重ねる。
// YTM の video 要素は動かさない(動かすとプレイヤーが壊れる)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const pipSource = read('src/js/module/pip-manager.js')
const uiSource = read('src/js/module/lyrics-ui.js')

const fakeTrack = (kind) => ({ kind, readyState: 'live', stop() { this.readyState = 'ended' } })
const setup = (mode) => {
  const tracks = [fakeTrack('video'), fakeTrack('audio')]
  const stream = {
    getTracks: () => tracks.slice(),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    removeTrack: (t) => tracks.splice(tracks.indexOf(t), 1),
  }
  const listeners = {}
  const source = {
    captureStream: () => stream,
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type) => { delete listeners[type] },
  }
  const pipVideo = { srcObject: null, play: () => Promise.resolve() }
  const classes = new Set()
  const pipDoc = {
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } },
    getElementById: (id) => (id === 'pip-video' ? pipVideo : null),
  }
  const state = { moviemode: mode }
  const PipManager = new Function('document', 'console', 'state',
    `let moviemode; Object.defineProperty(state, 'set', { value: (v) => { moviemode = v } }); moviemode = state.moviemode;\n${pipSource}\nreturn PipManager;`)(
    { querySelector: () => source }, console, state)
  PipManager.pipWindow = { document: pipDoc }
  return { PipManager, state, tracks, pipVideo, classes, listeners }
}

test('動画モードなら MV の映像だけを写し、音の写しは止める', () => {
  const { PipManager, tracks, pipVideo, classes, listeners } = setup(true)
  PipManager.syncVideoMode()
  assert.ok(classes.has('ytm-pip-video'))
  assert.ok(pipVideo.srcObject)
  assert.deepEqual(tracks.map(t => t.kind), ['video'])
  assert.equal(typeof listeners.loadeddata, 'function', '曲が変わって映像が差し替わったら写し直す')
})

test('曲モードに戻ったら・PiP を閉じたら写しを止める', () => {
  const { PipManager, state, tracks, pipVideo, classes, listeners } = setup(true)
  PipManager.syncVideoMode()
  const video = tracks[0]
  state.set(false)
  PipManager.syncVideoMode()
  assert.ok(!classes.has('ytm-pip-video'))
  assert.equal(video.readyState, 'ended')
  assert.equal(pipVideo.srcObject, null)
  assert.equal(listeners.loadeddata, undefined)
  assert.match(pipSource, /addEventListener\('pagehide', \(\) => \{[\s\S]*?this\.detachVideo\(\);/)
})

test('動画モードで開く PiP は 16:9 の窓', () => {
  assert.match(pipSource, /videoMode\s*\? \{ width: 640, height: 360 \}/)
})

test('開いている PiP も、曲/動画の切り替えと曲替わりに付いてくる', () => {
  assert.match(uiSource, /moviemode = newMoviemode;[\s\S]{0,600}PipManager\.syncVideoMode\(\)/)
  assert.match(uiSource, /PipManager\.updateMeta\(shownTitleFor\(meta\), \(ui\.artist && ui\.artist\.textContent\) \|\| meta\.artist\);\s*PipManager\.syncVideoMode\(\);/)
})

test('動画モードの PiP は、今の行以外もぼかさず(本体の動画モードと同じ)、今の行と次の行の 2 行だけ見せる', () => {
  assert.match(pipSource, /body\.ytm-pip-video \.lyric-line,\s*body\.ytm-pip-video \.lyric-line\.active \{\s*filter: none !important;/)
  const band = pipSource.slice(pipSource.indexOf('body.ytm-pip-video:not(.ytm-animated-caption-mode) #pip-lyrics-container {'))
  const rule = band.slice(0, band.indexOf('}'))
  // 帯は行 2 本ぶん(行の高さ 1.35em + 行間 0.45em = 1.8em)。字の大きさは行と同じ式
  assert.match(rule, /font-size: clamp\(15px, 3\.6vw, 34px\);/)
  assert.match(pipSource, /body\.ytm-pip-video \.lyric-line\.singer-even \{\s*font-size: clamp\(15px, 3\.6vw, 34px\) !important;/)
  assert.match(rule, /height: 3\.6em;/)
  // 今の行を帯の上端に止める。下の余白は最後の行も上端まで上がれるぶん
  assert.match(rule, /--ytm-lyrics-anchor-top-lines: 0;/)
  assert.match(rule, /padding: 0 0 3\.6em 0;/)
  // PiP も CSS の止める位置を読む(無い時は今までどおり 35% の所)
  assert.match(uiSource, /const anchor = readLyricAnchorTopLines\(container\) === null\s*\? \(container\.clientHeight \* 0\.35\) - \(anchorHeight \/ 2\)\s*: lyricAnchorOffset\(container, anchorHeight\);/)
})

test('PiP の曲/動画を切り替えたら、止める位置を読み直して今の行へ寄せ直す', () => {
  let recentered = 0
  const { PipManager, state } = setup(true)
  PipManager.pipLyricsContainer = {}
  globalThis.recenterLyricsAfterResize = () => { recentered++ }
  try {
    PipManager.syncVideoMode()
    assert.equal(recentered, 1)
    PipManager.syncVideoMode()
    assert.equal(recentered, 1, '変わっていなければ寄せ直さない')
    state.set(false)
    PipManager.syncVideoMode()
    assert.equal(recentered, 2)
  } finally {
    delete globalThis.recenterLyricsAfterResize
  }
})

// 映像の上のボタンが半透明の丸だと、MV の明暗が丸に透けて場面ごとにチカチカした。
// :hover が一瞬外れた時も、ボタン一式が消えてすぐ戻り、点滅して見えた。
test('動画モードの PiP のボタンは丸を描かず、一瞬 :hover が外れても消えない', () => {
  const rule = (sel) => {
    const at = pipSource.indexOf(`${sel} {`)
    assert.ok(at !== -1, `${sel} が無い`)
    return pipSource.slice(at, pipSource.indexOf('}', at))
  }
  const btn = rule('body.ytm-pip-video .control-btn')
  assert.match(btn, /background: transparent;/)
  assert.match(btn, /backdrop-filter: none;/)
  assert.match(rule('body.ytm-pip-video .control-btn:hover'), /background: transparent;/)
  // 隠す時だけ待つ(出す時は待たない)
  assert.match(pipSource, /body\.ytm-pip-video \.controls-box \{ opacity: 0; transition: opacity 0\.25s ease 0\.4s; \}/)
  assert.match(rule('body.ytm-pip-video:hover .controls-box'), /transition-delay: 0s;/)
})
