// 曲が変わった時の「曲 / 動画」。
//
// 以前は設定が無く、利用者が「動画」を選んでいても毎曲 .song-button を
// click していた(最大 10 回リトライ)。動画モードに留まる手段が無かった。
// 次に ON/OFF の設定にしたが、OFF は YouTube Music 任せで、選んだ方が続くとは
// 限らなかった。今は 3 択: 「曲に切り替える」(既定・今までどおり)・
// 「前のまま」(最後に自分で選んだ方を続ける。MV の無い曲だけは曲)・
// 「YouTube Music に任せる」。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const uiSource = read('src/js/module/lyrics-ui.js')
const namespaceSource = read('src/js/module/namespace.js')

test('既定は「曲に切り替える」(今までの動き)', () => {
  assert.match(namespaceSource, /trackChangePlaybackMode: 'song',/)
})

test('設定パネルに 3 択で出て保存される。以前の OFF は「YouTube Music に任せる」に引き継ぐ', () => {
  assert.match(uiSource, /id="track-change-mode-group"/)
  for (const v of ['song', 'keep', 'ytm']) {
    assert.match(uiSource, new RegExp(`data-value="${v}">\\$\\{t\\('settings_track_change_${v}'\\)\\}`))
  }
  assert.match(uiSource, /setupLangPills\('track-change-mode-group'/)
  assert.match(uiSource, /storage\.set\('ytm_track_change_mode', normalizeTrackChangeMode\(config\.trackChangePlaybackMode\)\)/)
  assert.match(uiSource, /storage\.get\('ytm_track_change_mode'\)/)
  assert.match(uiSource, /\(await storage\.get\('ytm_prefer_song_mode'\)\) === false\) \{[^}]*config\.trackChangePlaybackMode = 'ytm';/)
  // 閉じて取り消した時に戻す・リセットで消す
  assert.match(uiSource, /const SETTINGS_LIVE_KEYS = \[[^\]]*'trackChangePlaybackMode'/)
  for (const key of ['ytm_track_change_mode', 'ytm_last_playback_mode', 'ytm_prefer_song_mode']) {
    assert.match(uiSource.slice(uiSource.indexOf('const SETTINGS_STORAGE_KEYS'), uiSource.indexOf('];', uiSource.indexOf('const SETTINGS_STORAGE_KEYS'))), new RegExp(`'${key}'`))
  }
})

test('4 言語ぶんの文言がある', () => {
  for (const key of ['settings_track_change_mode', 'settings_track_change_mode_desc', 'settings_track_change_song', 'settings_track_change_keep', 'settings_track_change_ytm']) {
    const hits = namespaceSource.match(new RegExp(`${key}: "`, 'g')) || []
    assert.equal(hits.length, 4, key)
  }
})

// 読み込み直後のトグルは playback-mode が "NONE" のまま在り、少しして
// OMV_PREFERRED に決まる(実機)。"NONE" で諦めていたので、リンクから
// 開いたり読み込み直したりすると動画のまま残った
test('playback-mode が決まる前("NONE")は待ち、動画に決まったら「曲」へ切り替える', () => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  assert.ok(start !== -1 && end !== -1)
  const timers = []
  let clicks = 0
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'NONE',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const preferLyricsDefault = new Function('document', 'config', 'currentKey', 'setTimeout', 'MouseEvent',
    `${uiSource.slice(start, end + 2)}\nreturn preferLyricsDefault;`)(
    { querySelector: () => switcher, addEventListener: () => {} }, { trackChangePlaybackMode: 'song' }, 'song', (fn) => timers.push(fn), class { })
  preferLyricsDefault('song')
  assert.equal(clicks, 0)
  assert.equal(timers.length, 1, '"NONE" では待ち直す')
  timers.shift()()
  assert.equal(clicks, 0)
  switcher.mode = 'OMV_PREFERRED'
  timers.shift()()
  assert.equal(clicks, 1)
  // 曲に決まっていれば何もしない
  switcher.mode = 'ATV_PREFERRED'
  timers.length = 0
  preferLyricsDefault('song')
  assert.equal(timers.length, 0)
})

test('待っている間に利用者が自分で「動画」を押したら、その曲では「曲」へ押し戻さない', () => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  const timers = []
  let clicks = 0
  let onClick = null
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'NONE',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const doc = { querySelector: () => switcher, addEventListener: (type, fn) => { if (type === 'click') onClick = fn } }
  const preferLyricsDefault = new Function('document', 'config', 'currentKey', 'setTimeout', 'MouseEvent',
    `${uiSource.slice(start, end + 2)}\nreturn preferLyricsDefault;`)(
    doc, { trackChangePlaybackMode: 'song' }, 'song', (fn) => timers.push(fn), class { })
  preferLyricsDefault('song')
  assert.equal(timers.length, 1)
  // 拡張自身のクリック(isTrusted: false)は数えない
  onClick({ isTrusted: false, target: { closest: () => ({}) } })
  // 利用者が「動画」を押した
  onClick({ isTrusted: true, target: { closest: (sel) => (sel === 'ytmusic-av-toggle' ? {} : null) } })
  switcher.mode = 'OMV_PREFERRED'
  timers.shift()()
  assert.equal(clicks, 0, '押し戻した')
})

// MV は曲名・アーティストの書き方が曲版と違うことがある(日向坂46「君はハニーデュー」)。
// 「動画」を押すと曲のキーが変わり、別の曲と見なして「曲」へ押し戻していた(実機)
test('「動画」を押した直後にキーが変わっても押し戻さない。少し経ってからの曲替わりは今までどおり', () => {
  const start = uiSource.indexOf('let _userPlaybackModeKey')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  const timers = []
  let clicks = 0
  let onClick = null
  let now = 1000
  const songBtn = { dispatchEvent: () => { clicks++; switcher.mode = 'ATV_PREFERRED' }, click: () => {} }
  const switcher = {
    mode: 'ATV_PREFERRED',
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    querySelector: () => songBtn,
  }
  const doc = { querySelector: () => switcher, addEventListener: (type, fn) => { if (type === 'click') onClick = fn } }
  const { preferLyricsDefault, setKey } = new Function('document', 'config', 'setTimeout', 'MouseEvent', 'Date', 'PREFER_SONG_MAX_ATTEMPTS',
    `let currentKey = 'song';\n${uiSource.slice(start, end + 2)}\nreturn { preferLyricsDefault, setKey: (k) => { currentKey = k } };`)(
    doc, { trackChangePlaybackMode: 'song' }, (fn) => timers.push(fn), class { }, { now: () => now }, 20)
  onClick({ isTrusted: true, target: { closest: (sel) => (sel === 'ytmusic-av-toggle' ? {} : null) } })
  switcher.mode = 'OMV_PREFERRED'
  now += 300
  setKey('mv')
  preferLyricsDefault('mv')
  assert.equal(clicks, 0, 'MV へ切り替えた直後に押し戻した')
  // キーは 1 回では落ち着かず、アーティスト名の書き方が行き来する(実機)
  now += 300
  setKey('mv///日向坂46')
  preferLyricsDefault('mv///日向坂46')
  now += 5000
  setKey('mv///Hinatazaka46')
  preferLyricsDefault('mv///Hinatazaka46')
  assert.equal(clicks, 0, 'アーティスト名の書き方が変わっただけで押し戻した')
  // その MV が終わって次の曲になったら、今までどおり「曲」へ
  now += 200000
  setKey('next')
  preferLyricsDefault('next')
  assert.equal(clicks, 1)
})

// 「前のまま」: 最後に自分で選んだ方を、次の曲にも続ける
const makeKeep = ({ mode, hasVideo = true, last = null, setting = 'keep' } = {}) => {
  const start = uiSource.indexOf('const PREFER_SONG_MAX_ATTEMPTS')
  const end = uiSource.indexOf('\n}', uiSource.indexOf('function preferLyricsDefault('))
  const timers = []
  const clicks = []
  const stored = {}
  const listeners = []
  const button = (name, to) => ({
    dispatchEvent: () => { clicks.push(name); switcher.mode = to },
    click: () => {},
  })
  const songBtn = button('song', 'ATV_PREFERRED')
  const videoBtn = button('video', 'OMV_PREFERRED')
  const switcher = {
    mode,
    hasVideo,
    getAttribute: (k) => (k === 'playback-mode' ? switcher.mode : null),
    hasAttribute: (k) => (k === 'selected-item-has-video' ? switcher.hasVideo : false),
    querySelector: (sel) => (sel.includes('video-button') ? videoBtn : songBtn),
  }
  const doc = { querySelector: () => switcher, addEventListener: (type, fn) => { if (type === 'click') listeners.push(fn) } }
  const api = new Function('document', 'config', 'setTimeout', 'MouseEvent', 'storage',
    `let currentKey = 'a';\n${uiSource.slice(start, end + 2)}
    _lastUserPlaybackMode = ${JSON.stringify(last)};
    return { preferLyricsDefault, setKey: (k) => { currentKey = k }, last: () => _lastUserPlaybackMode };`)(
    doc, { trackChangePlaybackMode: setting }, (fn) => timers.push(fn), class { },
    { set: (k, v) => { stored[k] = v } })
  const userClick = (cls) => listeners.forEach(fn => fn({
    isTrusted: true,
    target: { closest: (sel) => (sel === 'ytmusic-av-toggle' || sel === `.${cls}` ? {} : null) },
  }))
  const flush = () => { let n = 0; while (timers.length && n++ < 100) timers.shift()() }
  return { ...api, switcher, clicks, stored, userClick, flush, timers }
}

test('前のまま: 動画を選んでいたら、次の曲も MV があれば動画にする', () => {
  const h = makeKeep({ mode: 'ATV_PREFERRED', last: 'video' })
  h.setKey('b')
  h.preferLyricsDefault('b')
  assert.deepEqual(h.clicks, ['video'])
  assert.equal(h.switcher.mode, 'OMV_PREFERRED')
})

test('前のまま: MV の無い曲は曲のまま。選んだ方(動画)は覚えたままで、次に MV のある曲で動画に戻る', () => {
  const h = makeKeep({ mode: 'ATV_PREFERRED', hasVideo: false, last: 'video' })
  h.setKey('b')
  h.preferLyricsDefault('b')
  h.flush()
  assert.deepEqual(h.clicks, [], 'MV の無い曲で「動画」を押した')
  assert.equal(h.last(), 'video')
  h.switcher.hasVideo = true
  h.setKey('c')
  h.preferLyricsDefault('c')
  assert.deepEqual(h.clicks, ['video'])
})

test('前のまま: MV の印が遅れて付いたら、付いてから動画にする', () => {
  const h = makeKeep({ mode: 'ATV_PREFERRED', hasVideo: false, last: 'video' })
  h.setKey('b')
  h.preferLyricsDefault('b')
  assert.deepEqual(h.clicks, [])
  assert.equal(h.timers.length, 1, '印が付くのを待っていない')
  h.switcher.hasVideo = true
  h.timers.shift()()
  assert.deepEqual(h.clicks, ['video'])
})

test('前のまま: 曲を選んでいたら、YTM が動画にしても曲へ戻す', () => {
  const h = makeKeep({ mode: 'OMV_PREFERRED', last: 'song' })
  h.setKey('b')
  h.preferLyricsDefault('b')
  assert.deepEqual(h.clicks, ['song'])
})

test('前のまま: まだ一度も選んでいなければ何もしない。YouTube Music に任せるなら何もしない', () => {
  for (const opts of [{ last: null }, { last: 'video', setting: 'ytm' }, { last: 'song', setting: 'ytm' }]) {
    const h = makeKeep({ mode: opts.last === 'song' ? 'OMV_PREFERRED' : 'ATV_PREFERRED', ...opts })
    h.setKey('b')
    h.preferLyricsDefault('b')
    h.flush()
    assert.deepEqual(h.clicks, [], JSON.stringify(opts))
  }
})

test('曲に切り替える(既定)は、前に動画を選んでいても曲へ戻す(今までどおり)', () => {
  const h = makeKeep({ mode: 'OMV_PREFERRED', last: 'video', setting: 'song' })
  h.setKey('b')
  h.preferLyricsDefault('b')
  assert.deepEqual(h.clicks, ['song'])
})

test('自分で押した方を覚えて保存する。拡張自身のクリックは数えない', () => {
  const h = makeKeep({ mode: 'ATV_PREFERRED' })
  h.userClick('video-button')
  assert.equal(h.last(), 'video')
  assert.equal(h.stored.ytm_last_playback_mode, 'video')
  h.userClick('song-button')
  assert.equal(h.last(), 'song')
  assert.equal(h.stored.ytm_last_playback_mode, 'song')
  // 拡張が押した分(isTrusted: false)は入らない
  h.setKey('b')
  h.switcher.mode = 'OMV_PREFERRED'
  h.preferLyricsDefault('b')
  assert.equal(h.last(), 'song')
})
