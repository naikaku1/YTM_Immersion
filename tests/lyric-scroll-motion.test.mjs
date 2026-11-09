// 行送りのスクロール。
//
// 以前は rAF で毎フレーム scrollTop と各行の translate を書いていた。
// ばねの時間を performance.now() で進めていたのでフレームごとの進み幅がぶれ、
// scrollTop は画素単位に丸められるので止まり際が段になり、YTM 側が重い
// フレームでは歌詞も止まった。いまは scrollTop を行き先へ飛ばし、見た目の
// 動きは行ごとの translate として Web Animations(合成スレッド)に渡している。
//
// ここでは偽のアニメーションを自前の時計で進め、画面の上で行がどう見えるかを確かめる。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { makeLyrics, sliceBetween, uiSource } from './lyric-scroll-harness.mjs'

// ── 見た目 ──────────────────────────────────────────────

test('行が変わった瞬間、どの行も画面の上では動いていない', () => {
  // scrollTop を飛ばしたぶんを translate が打ち消す。打ち消し漏れがあると一瞬跳ぶ
  const h = makeLyrics()
  h.goTo(10, true)
  const before = h.rows.map(r => r.visualTop())
  h.goTo(11)
  const after = h.rows.map(r => r.visualTop())
  for (let i = 0; i < h.rows.length; i++) {
    const visible = before[i] > -100 && before[i] < h.container.clientHeight + 100
    if (visible) assert.ok(Math.abs(after[i] - before[i]) < 0.6, `行 ${i} が跳んだ: ${before[i]} → ${after[i]}`)
  }
})

test('scrollTop はすぐ行き先に着き、行は後から本来の位置へ着地する', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  const target = h.targetFor(11)
  h.goTo(11)
  assert.ok(Math.abs(h.container.scrollTop - target) <= 0.5)
  assert.ok(h.container._ytmRowMotion, '行が動いていない')
  h.settle()
  assert.equal(h.container._ytmRowMotion, undefined, '動きの後始末が残っている')
  for (const row of h.rows) assert.equal(row.translate(), 0)
  const center = h.rows[11].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1, `中央に来ていない: ${center}`)
})

test('時間差は上の行から順に付く', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  const delays = h.rows
    .filter(r => r.anims.length)
    .map(r => [r.index, r.anims.at(-1).delay])
  assert.ok(delays.length > 4)
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i][1] >= delays[i - 1][1], `行 ${delays[i][0]} が上の行より先に動く`)
  }
  assert.equal(delays[0][1], 0)
})

test('時間差を切ると、全行が一緒に動き、行き過ぎない', () => {
  const h = makeLyrics()
  h.config.lyricStagger = false
  h.goTo(10, true)
  h.goTo(12)
  const moving = h.rows.filter(r => r.anims.length)
  assert.ok(moving.length > 4)
  for (const row of moving) assert.equal(row.anims.at(-1).delay, 0)

  // 行き過ぎて戻ると、読んでいる行が一度通り過ぎる
  const row = h.rows[12]
  const end = row.naturalTop - h.container.scrollTop
  const ys = h.record(row, 120)
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] >= end - 0.01 && ys[i] <= ys[i - 1] + 0.01, `フレーム ${i} で戻った/行き過ぎた`)
  }
})

test('省電力では時間差を付けない', () => {
  const h = makeLyrics()
  h.config.lowCpuMode = true
  h.goTo(10, true)
  h.goTo(11)
  for (const row of h.rows.filter(r => r.anims.length)) assert.equal(row.anims.at(-1).delay, 0)
})

test('動いている途中に次の行が来ても、位置も速さも途切れない', () => {
  // ブラウザ内蔵の smooth はここで動きを打ち切るので速度が跳ねる
  const h = makeLyrics()
  h.config.lyricStagger = false
  h.goTo(10, true)
  const row = h.rows[14]
  const ys = h.record(row, 90, (f) => {
    if (f === 0) h.goTo(11)
    if (f === 15) h.goTo(12)
    if (f === 30) h.goTo(13)
  })
  const vel = ys.slice(1).map((y, i) => (y - ys[i]) * 60)
  const accel = vel.slice(1).map((v, i) => Math.abs(v - vel[i]))
  const peak = Math.max(...accel)
  for (const f of [14, 15, 29, 30]) {
    assert.ok(accel[f] < peak * 0.9, `行が変わったフレーム ${f} で速度が跳ねた (${accel[f].toFixed(0)} / ${peak.toFixed(0)})`)
  }
  for (const f of [15, 30]) {
    const jump = Math.abs(ys[f] - ys[f - 1])
    assert.ok(jump < Math.max(...ys.slice(1).map((y, i) => Math.abs(y - ys[i]))) + 0.5, `フレーム ${f} で跳んだ`)
  }
  h.settle()
  const center = h.rows[13].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1)
})

test('時間差の付いた動きの途中でも、行が変わった瞬間に跳ばない', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  for (let f = 0; f < 9; f++) h.clock.advance(1000 / 60)
  const before = h.rows.map(r => r.visualTop())
  h.goTo(12)
  const after = h.rows.map(r => r.visualTop())
  for (let i = 0; i < h.rows.length; i++) {
    if (before[i] < -100 || before[i] > h.container.clientHeight + 100) continue
    assert.ok(Math.abs(after[i] - before[i]) < 0.6, `行 ${i} が跳んだ: ${before[i]} → ${after[i]}`)
  }
})

test('遠くへ戻る時は時間差を付けず、途中に見える行も全部動かす', () => {
  // 手で先を読みに行った所から、歌っている行へ戻る時
  const h = makeLyrics()
  h.goTo(5, true)
  h.request(h.targetFor(5) + 2400, true, 5) // 画面何枚ぶんも下を見ている
  h.goTo(6)
  const moving = h.rows.filter(r => r.anims.length)
  for (const row of moving) assert.equal(row.anims.at(-1).delay, 0)
  // 動いている途中のどのフレームでも、画面の中に「動かされていない行」が居ない
  for (let f = 0; f < 60; f++) {
    for (const row of h.rows) {
      const y = row.visualTop()
      const onScreen = y > 0 && y < h.container.clientHeight
      if (onScreen && !row.anims.length) assert.fail(`行 ${row.index} だけ先に着いている (フレーム ${f})`)
    }
    h.clock.advance(1000 / 60)
  }
})

test('即時ジャンプはその場で着き、何も動かさない', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  h.goTo(30, true)
  assert.equal(h.container._ytmRowMotion, undefined)
  for (const row of h.rows) assert.equal(row.translate(), 0)
  assert.ok(Math.abs(h.container.scrollTop - h.targetFor(30)) <= 0.5)
})

test('Web Animations が無い環境でも、行き先には着く', () => {
  const h = makeLyrics({ withAnimate: false })
  h.goTo(10, true)
  h.goTo(11)
  assert.ok(Math.abs(h.container.scrollTop - h.targetFor(11)) <= 0.5)
  assert.equal(h.container._ytmRowMotion, undefined)
})

// ── 外から scrollTop が動いた時 ─────────────────────────

test('自分で書いた scrollTop のイベントでは、寄せ直しを頼まない', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  h.fireScroll()
  assert.equal(h.container._lastScrolledIndex, 11)
})

test('自分で書いた scroll イベントを、ユーザー操作と取り違えない印を置く', () => {
  const h = makeLyrics()
  h.clock.now = 1000
  h.goTo(11)
  assert.ok(h.container._suppressUserScrollUntil > 1000)
  // PIP 側の判定もこの値を見る
  const pipSource = fs.readFileSync(new URL('../src/js/module/pip-manager.js', import.meta.url), 'utf8')
  assert.match(pipSource, /_suppressUserScrollUntil \|\| 0\)\) return;/)
})

test('動いている途中に誰かが scrollTop を動かしたら、印を戻し、行はそのまま着地させる', () => {
  // 翻訳の到着で行の高さが変わる、ホイールで掴んだ、など。
  // 印を戻さないと次の行まで追従が止まる。行を止めると残りを一度に跳ぶ。
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  for (let f = 0; f < 5; f++) h.clock.advance(1000 / 60)
  const row = h.rows[12]
  const before = row.visualTop()
  h.container.scrollTop += 120
  h.fireScroll()
  assert.equal(h.container._lastScrolledIndex, -1)
  assert.ok(h.container._ytmRowMotion, '動いている行を止めた')
  assert.ok(Math.abs(row.visualTop() - (before - 120)) < 0.6, '行が跳んだ')

  // 次に頼まれた時は、いまの位置から寄せ直す
  h.goTo(11)
  h.settle()
  const center = h.rows[11].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1)
})

test('手で動かした後でも、次に頼まれた行まで追従する', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  h.settle()
  h.container.scrollTop = 1800 // ホイールで先を読みに行った
  h.fireScroll()
  h.container._lastScrolledIndex = -1 // 手を離して 3 秒後
  h.goTo(11)
  h.settle()
  const center = h.rows[11].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1, `戻っていない: ${center}`)
  assert.equal(h.container._lastScrolledIndex, 11, '同じ行への頼み直しが続く')
})

// ── 端 ─────────────────────────────────────────────────
//
// 歌詞をクリックすると後方シークになり、即時ジャンプを通る。曲頭の行を中央に
// 寄せる行き先は 0 を下回ることがある。丸める前の値を「書いた位置」として
// 覚えると、以後ずっと「誰かが動かした」と誤判定して追従が死ぬ。

test('範囲外へ即時ジャンプしても、記録は実際の位置に合う', () => {
  const h = makeLyrics()
  h.request(-18, true, 0)
  assert.equal(h.container.scrollTop, 0)
  assert.equal(h.container._scrollLastWritten, 0)
  h.goTo(3)
  h.fireScroll()
  assert.equal(h.container._lastScrolledIndex, 3, '自分の書いた位置を他人の操作と取り違えた')
})

test('曲末のように下の端を超えた行き先でも、記録は実際の位置に合う', () => {
  const h = makeLyrics()
  const max = h.container.scrollHeight - h.container.clientHeight
  h.request(max + 400, false, 59)
  assert.equal(h.container.scrollTop, max)
  assert.equal(h.container._scrollLastWritten, max)
  h.settle()
  h.goTo(20)
  h.settle()
  const center = h.rows[20].visualTop() + 43 / 2
  assert.ok(Math.abs(center - h.container.clientHeight / 2) < 1)
})

test('動きの外から先頭へ戻す時は、記録も動きも一緒に戻す', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.goTo(11)
  h.resetState()
  assert.equal(h.container.scrollTop, 0)
  assert.equal(h.container._scrollLastWritten, 0)
  assert.equal(h.container._ytmRowMotion, undefined)
  for (const row of h.rows) assert.equal(row.translate(), 0)
})

// ── 手で読んだ後の復帰 ──────────────────────────────────

test('読んでいた過去行は、戻る動きが着いてから消す', () => {
  const h = makeLyrics()
  h.goTo(10, true)
  h.container.classList.add('ytm-user-browsing-lyrics')
  h.container._ytmResumeFadeAfterScroll = true
  h.goTo(11)
  assert.ok(h.container.classList.contains('ytm-user-browsing-lyrics'), '動き出す前に消した')
  h.settle()
  assert.ok(!h.container.classList.contains('ytm-user-browsing-lyrics'), '着いても消えない')
  assert.equal(h.container._ytmResumeFadeAfterScroll, false)
})

// ── ばねの式 ────────────────────────────────────────────

test('ばねの式は、細かく積分した結果と一致する', () => {
  const h = makeLyrics()
  for (const [k, c] of [[145, 19], [120, 2 * Math.sqrt(120)], [100, 40]]) {
    for (const [y0, v0] of [[-120, 0], [80, -300], [0, 500]]) {
      let y = y0
      let v = v0
      const dt = 1 / 20000
      for (let i = 1; i <= 20000 * 0.6; i++) {
        v += (-k * y - c * v) * dt
        y += v * dt
        if (i % 2000 === 0) {
          const s = h.spring(k, c, y0, v0, i * dt)
          assert.ok(Math.abs(s.y - y) < 0.05, `k=${k} c=${c} y0=${y0} v0=${v0} t=${i * dt}: ${s.y} vs ${y}`)
          assert.ok(Math.abs(s.v - v) < 1, `速度が合わない k=${k} c=${c}`)
        }
      }
    }
  }
})

// ── 毎フレームの仕事 ────────────────────────────────────

test('rAF のループは、スクロールのために何もしない', () => {
  // 以前は毎フレーム scrollTop を読み書きしていた。読むだけでも、
  // 文字の塗りで汚れたスタイルとレイアウトをその場で確定させることになる。
  const loop = sliceBetween('function startLyricRafLoop', '\n// 窓の大きさが変わったら')
  assert.doesNotMatch(loop, /scrollTop/)
  assert.doesNotMatch(loop, /stepLyricScroll/)
  assert.doesNotMatch(loop, /snapLyricScroll/)
})

test('行の動きは translate のキーフレームで合成側に渡す', () => {
  const motion = sliceBetween('// ── 行送りのスクロール', '// ── 歌っている行を止める位置')
  assert.match(motion, /row\.animate\(/)
  assert.match(motion, /translate: `0 \$\{/)
  assert.doesNotMatch(uiSource, /style\.translate =/)
})

test('行の位置を測る所は、動いている最中のずれを引いてから使う', () => {
  const block = sliceBetween('if (isPrimary && idx !== (container._lastScrolledIndex ?? -1)) {', 'if (paintActiveLyricRow(r, t)) sawActiveCharSpans = true;')
  const uses = block.match(/rRect\.top - lyricRowScrollOffset\(r\)/g) || []
  assert.equal(uses.length, 2, '通常画面と PIP の両方で引くこと')
})

test('行が変わった時の寄せは、組み込みの smooth スクロールを使わない', () => {
  assert.ok(!/scrollTo\(\{\s*top: targetScroll/.test(uiSource))
  assert.match(uiSource, /requestLyricScroll\(container, targetScroll/)
})

// 非常に速い歌詞(0.15 秒ごとに行が変わる)。以前は上へ流れ去った行も行のたびに
// 動かし直していたので、動いている行が 1 行ごとに増え続け(0.15 秒ごとで 237 行)、
// それが時間差の順番に数えられて、見えている行の待ちが 1 秒近くまで伸びた。
// 今の行の下の行が遅れ、後から拾われた行に追い越されて重なり、最後は歌詞が
// 画面の下へ落ちて見えなくなった(実機)。
test('速い歌詞でも、動く行は増え続けず、行どうしが重ならず、今の行は画面に残る', () => {
  for (const interval of [300, 150, 100]) {
    const h = makeLyrics({ rowCount: 400, clientHeight: 411 })
    h.goTo(0, true)
    let line = 0
    let next = 0
    let maxMotion = 0
    for (let f = 0; f < 60 * 20; f++) {
      if (f * (1000 / 60) >= next && line < 390) { h.goTo(++line); next += interval }
      maxMotion = Math.max(maxMotion, h.container._ytmRowMotion?.size || 0)
      for (let i = 0; i < h.rows.length - 1; i++) {
        const a = h.rows[i].visualTop()
        const b = h.rows[i + 1].visualTop()
        if (a < -50 || b > 411 + 50) continue
        assert.ok(b - a - 43 > 20, `${interval}ms: 行 ${i} と ${i + 1} が詰まった (${(b - a - 43).toFixed(1)}px)`)
      }
      h.clock.advance(1000 / 60)
    }
    assert.ok(maxMotion < 20, `${interval}ms: 動いている行が増え続けた (${maxMotion})`)
    const top = h.rows[line].visualTop()
    assert.ok(top > 0 && top + 43 < 411, `${interval}ms: 今の行が画面の外 (${top.toFixed(0)}px)`)
  }
})

// 行の間隔がばらつく曲(遅い行の直後に速い行)。行が変わった時、まだ動いていた行は
// 待ち 0 で動き続けるのに、その上で止まり終えていた行には時間差の待ちが新しく
// 付いていた。今の行の 2〜3 行下が止まって待つ間に、下の行が追い越して重なった(実機)。
test('行の間隔がばらついても、下の行が上の行を追い越さない', () => {
  const h = makeLyrics({ rowCount: 200, clientHeight: 530 })
  h.goTo(0, true)
  let seed = 1
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let line = 0
  let next = 0
  for (let f = 0; f < 60 * 30; f++) {
    if (f * (1000 / 60) >= next && line < 190) { h.goTo(++line); next += 400 * (0.4 + rnd() * 1.2) }
    for (let i = Math.max(0, line - 4); i < line + 6; i++) {
      const a = h.rows[i].visualTop()
      const b = h.rows[i + 1].visualTop()
      if (Math.max(a, b) >= 530 || Math.min(a, b) + 43 <= 0) continue
      assert.ok(b - a - 43 > 20, `行 ${i} と ${i + 1} が詰まった (今の行 ${line}, ${(b - a - 43).toFixed(1)}px)`)
    }
    h.clock.advance(1000 / 60)
  }
})

test('上の行は、下の行より後に動き出さない', () => {
  assert.match(uiSource, /moving\[i\]\.delay = Math\.min\(moving\[i\]\.delay, moving\[i \+ 1\]\.delay\);/)
})
