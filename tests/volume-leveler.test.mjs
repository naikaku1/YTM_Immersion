// 小さい曲・動画の音量を上げて揃える(volume-leveler.js + page/loudness-bridge.js)。
// YouTube は大きい曲だけを下げ、小さい曲は上げない。同じ曲でも MV が曲版より
// 7 dB ほど小さかった(日向坂46「君はハニーデュー」: 曲版 +1.05 dB、MV -6.78 dB。実機)。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const levelerSource = read('src/js/module/volume-leveler.js')
const manifest = JSON.parse(read('manifest.json'))

const loadLeveler = () => new Function('document', 'MutationObserver', 'AudioContext', 'console',
  `${levelerSource}\nreturn VolumeLeveler;`)(
  { querySelector: () => null, documentElement: { getAttribute: () => null }, addEventListener: () => {} },
  class { observe() {} }, class {}, console)

test('小さい分だけ上げ、大きい曲(YouTube が下げている)は触らない', () => {
  const { _boostDbFor: boost } = loadLeveler()
  assert.equal(boost('wRzPuptA6yw:-6.78', 'wRzPuptA6yw'), 6.78)
  assert.equal(boost('oqL1ebtffi4:1.05', 'oqL1ebtffi4'), 0)
  assert.equal(boost('abc:-25.00', 'abc'), 10, '上げ幅には上限')
})

test('値が今の曲のものでない時・値が無い時は上げない', () => {
  const { _boostDbFor: boost } = loadLeveler()
  assert.equal(boost('wRzPuptA6yw:-6.78', 'oqL1ebtffi4'), 0)
  assert.equal(boost('wRzPuptA6yw:', 'wRzPuptA6yw'), 0)
  assert.equal(boost(null, 'x'), 0)
})

test('AudioContext が動いていない時は通さない(止まったまま通すと音が消える)', () => {
  assert.match(levelerSource, /return ctx\.state === 'running' \? ctx : null;/)
  const applyAt = levelerSource.indexOf('const apply = async')
  const ensureAt = levelerSource.indexOf('await ensureContext()', applyAt)
  const buildAt = levelerSource.indexOf('buildGraph(audio, video)', applyAt)
  assert.ok(ensureAt !== -1 && buildAt > ensureAt)
  assert.match(levelerSource, /if \(!audio\) \{/)
})

test('上げる時は後ろにリミッターを置き、上げない時は素通しにつなぐ', () => {
  assert.match(levelerSource, /createDynamicsCompressor\(\)/)
  assert.match(levelerSource, /graph\.source\.connect\(boosting \? graph\.gain : ctx\.destination\)/)
})

test('音の大きさはページ側の小さな橋渡しが置く。新しい権限は足さない', () => {
  const main = manifest.content_scripts.find(c => c.world === 'MAIN')
  assert.deepEqual(main.js, ['src/js/page/loudness-bridge.js', 'src/js/page/queue-bridge.js', 'src/js/page/quality-bridge.js'])
  assert.deepEqual(main.matches, ['https://music.youtube.com/*'])
  const iso = manifest.content_scripts.find(c => c.world !== 'MAIN')
  assert.ok(iso.js.indexOf('src/js/module/volume-leveler.js') < iso.js.indexOf('src/js/module/lyrics-ui.js'))
  const bridge = read('src/js/page/loudness-bridge.js')
  assert.doesNotMatch(bridge, /fetch\(|XMLHttpRequest|postMessage/)
})

// 曲が変わった時、getPlayerResponse() が新しい曲になるのが loadeddata・playing より
// 後のことがある。その 2 つだけで読んでいたので、小さい曲が上がらないまま流れ、
// 次に一時停止→再生した時(playing)に急に大きくなっていた。
test('音の大きさは再生中も読み直す(一時停止→再生で急に大きくならない)', () => {
  const bridge = read('src/js/page/loudness-bridge.js')
  assert.match(bridge, /\['loadeddata', 'playing', 'timeupdate'\]\) document\.addEventListener\(type, publish, true\)/)
  // 同じ値なら属性を書かない(書くたびに拡張側の見張りが起きる)
  assert.match(bridge, /getAttribute\('data-ytmi-loudness'\) !== value/)
})
