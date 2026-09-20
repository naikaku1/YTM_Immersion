// 追加プロバイダー(NetEase / AMLL / KuGou / LiriQo)の取り込み。
//
// どれも「単語同期を増やす」ために入れたので、単語の時刻が落ちたまま
// 行同期として通ってしまうのが一番まずい。各フォーマットの読み取りと、
// 曲の取り違えを防ぐ点数付けをここで押さえる。
//
// 歌詞そのものは使わない。時刻の付き方だけを見たいので、
// 語はすべてこのファイルで作った仮の文字列。

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import zlib from 'node:zlib'

const {
  convertLiriqoTrack,
  decodeKrcBase64,
  fetchFromAmll,
  fetchFromKugou,
  fetchFromLiriqo,
  fetchFromNetease,
  inflateZlib,
  liriqoCoversTrack,
  parseKrc,
  PROVIDER_IDS,
  PROVIDER_ORIGINS,
  stripLeadingHeaderLines,
  parseLys,
  parseSimpleLrc,
  parseTtml,
  parseTtmlTime,
  parseYrc,
  pickBestLiriqoTrack,
  pickRemoteCandidate,
  scoreRemoteCandidate,
  EXTRA_PROVIDERS_ENABLED,
  PROVIDER_SWITCHES,
} = await import('../src/js/module/extra-providers.js')

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ── NetEase (yrc) ───────────────────────────────────────────

test('yrc は語ごとの絶対時刻を拾う', () => {
  const lines = parseYrc([
    '{"t":0,"c":[{"tx":"作词: "},{"tx":"x"}]}',
    '[1000,900](1000,300,0)あ(1300,300,0)い(1600,300,0)う',
    '[3000,600](3000,300,0)え(3300,300,0)お',
  ].join('\n'))

  assert.equal(lines.length, 2, 'メタ行({...})は歌詞として数えない')
  assert.equal(lines[0].startTimeMs, 1000)
  assert.equal(lines[0].text, 'あいう')
  assert.deepEqual(lines[0].chars, [
    { t: 1000, c: 'あ' },
    { t: 1300, c: 'い' },
    { t: 1600, c: 'う' },
  ])
  assert.equal(lines[1].chars[0].t, 3000)
})

test('yrc の語に空白が混じっても時刻はずれない', () => {
  const [line] = parseYrc('[0,600](0,200,0)la (200,200,0)lo')
  assert.deepEqual(line.chars, [{ t: 0, c: 'la ' }, { t: 200, c: 'lo' }])
})

// タグ探しと本文の取り込みを1本の正規表現でやると、区切りと同じ文字が
// 歌詞に入っていた時に丸ごと落ちる。(Ah) や (x2) のようなコーラス表記は
// 珍しくないので、ここが崩れると静かに歌詞が欠ける。
test('歌詞の中の括弧や山括弧を落とさない', () => {
  assert.equal(parseYrc('[0,1000](0,500,0)(Ah)(500,500,0)yeah')[0].text, '(Ah)yeah')
  assert.equal(parseYrc('[0,1000](0,500,0)na (500,500,0)(x2)')[0].text, 'na (x2)')
  assert.equal(parseLys('[0](Ah)(0,500) yeah(500,500)')[0].text, '(Ah) yeah')
  assert.equal(parseKrc('[0,1000]<0,500,0>(Ah)<500,500,0>yeah')[0].text, '(Ah)yeah')
  assert.equal(parseKrc('[0,1000]<0,500,0>a<b<500,500,0>c')[0].text, 'a<bc')
})

test('括弧が入っても語の時刻はずれない', () => {
  const [line] = parseYrc('[0,1000](0,500,0)(Ah)(500,500,0)yeah')
  assert.deepEqual(line.chars, [{ t: 0, c: '(Ah)' }, { t: 500, c: 'yeah' }])
})

// 間奏で表示を消すための行。実データにも出る(NetEase の lrc で
// 1曲あたり 7〜12 行あった)。捨てると間奏のあいだ直前の歌詞が光ったまま残る。
test('本文が空の行(間奏)を捨てない', () => {
  const lines = parseSimpleLrc('[00:01.00]あ\n[00:05.00]\n[00:09.00]い')
  assert.equal(lines.length, 3)
  assert.equal(lines[1].text, '')
  assert.deepEqual(lines[1].chars, [], '空行に文字を持たせない')
})

// サビの使い回しで1行に時刻が複数付く。先頭だけ剥がすと残りが本文に出る。
test('1行に時刻が複数あれば、その数だけ行を起こす', () => {
  const lines = parseSimpleLrc('[00:01.00][00:31.00]あい\n[00:10.00]うえ')
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.map(l => l.startTimeMs), [1000, 10000, 31000], '時刻順に並んでいない')
  for (const line of lines) {
    assert.doesNotMatch(line.text, /\[\d/, '時刻が本文に漏れている')
  }
})

test('全部が空行なら歌詞として扱わない', () => {
  assert.equal(convertLiriqoTrack({ timed: [{ start: 1000, text: '' }, { start: 2000, text: '' }] }), null)
})

// ── 行の終わり ──────────────────────────────────────────────
//
// 終わりを持たせないと、lyrics-ui.js は語を字に割るときの終端が分からず、
// 行の最後の語を「次の行が始まるまで」で引き延ばす。間奏に入る行で
// 最後の語が数秒かけて塗られていた(実測: KuGou の Bad Guy で最大 9.1 秒)。

test('yrc / krc の行の終わりは、見出しではなく最後の語から採る', () => {
  // 見出しの長さは当てにならない(実データで曲まるごとの長さが入っていた)。
  // 語は 500ms から 300ms なので、行の終わりは 800ms。
  assert.equal(parseYrc('[0,99999](0,500,0)あ(500,300,0)い')[0].endTimeMs, 800)
  assert.equal(parseKrc('[1000,99999]<0,500,0>あ<500,300,0>い')[0].endTimeMs, 1800)
})

test('lys と ttml も行の終わりを持つ', () => {
  assert.equal(parseLys('[0]la(0,500) lo(500,300)')[0].endTimeMs, 800)
  const ttml = '<tt><body><div><p begin="00:01.000" end="00:09.000">' +
    '<span begin="00:01.000" end="00:01.500">あ</span>' +
    '<span begin="00:01.500" end="00:02.000">い</span></p></div></body></tt>'
  // <p> の end(9秒)ではなく、最後の語の end(2秒)を採る
  assert.equal(parseTtml(ttml)[0].endTimeMs, 2000)
})

test('次の行にくっつくまで伸びた終わりは捨てる', () => {
  // 最後の語の終わりが次の行の開始と一致している = 尺を埋めるための水増し。
  // そのまま渡すと最後の語がその間ずっと塗られる。
  const result = convertLiriqoTrack({
    timed: [
      { start: 1000, end: 9000, text: 'ab', words: [{ start: 1000, end: 1500, text: 'a' }, { start: 1500, end: 9000, text: 'b' }] },
      { start: 9000, end: 10000, text: 'cd', words: [{ start: 9000, end: 9500, text: 'c' }, { start: 9500, end: 10000, text: 'd' }] },
    ],
  })
  assert.equal(result.dynamicLines[0].endTimeMs, undefined, '水増しされた終わりを渡している')
  assert.equal(result.dynamicLines[1].endTimeMs, 10000, '正直な終わりまで捨てている')
})

// lyrics-ui.js 側の見積もりは、行の中の語の間隔から出すので語が2つ要る。
// 語が1つの行はあちらが触らない(dynamic-line-tail.test.mjs 参照)ため、
// 次の行まで引き延ばされる。曲ぜんたいの間隔からこちらで埋める。
test('語が1つしかない行にも終わりを与える', () => {
  // 実データで起きていた並び: 語1つの行の終わりが次の行まで水増しされて
  // いて、水増しとして捨てたあと、その行だけ終わりが無い状態で残る。
  const result = convertLiriqoTrack({
    timed: [
      { start: 0, end: 900, text: 'ab', words: [{ start: 0, end: 400, text: 'a' }, { start: 400, end: 900, text: 'b' }] },
      { start: 1000, end: 9000, text: 'cd', words: [{ start: 1000, end: 9000, text: 'cd' }] },
      { start: 9000, end: 9500, text: 'ef', words: [{ start: 9000, end: 9400, text: 'e' }, { start: 9400, end: 9500, text: 'f' }] },
    ],
  })
  const single = result.dynamicLines[1]
  assert.equal(single.chars.length, 1, '前提が崩れている')
  assert.ok(single.endTimeMs > 1000, '終わりが入っていない')
  assert.ok(single.endTimeMs < 3000, `次の行まで引き延ばされている: ${single.endTimeMs}`)
})

// 次の行まで届いていない終わりは、水増しと伸ばし音を区別できない。
// 実データにも本物の伸ばし音がある(LiriQo の Lemon に 1.5 秒の語)ので、
// 「長いから」というだけで切らない。
test('次の行に届かない長い語は、伸ばし音として尊重する', () => {
  const result = convertLiriqoTrack({
    timed: [
      { start: 1000, end: 8000, text: 'ab', words: [{ start: 1000, end: 1500, text: 'a' }, { start: 1500, end: 8000, text: 'b' }] },
      { start: 12000, end: 13000, text: 'cd', words: [{ start: 12000, end: 12500, text: 'c' }, { start: 12500, end: 13000, text: 'd' }] },
    ],
  })
  assert.equal(result.dynamicLines[0].endTimeMs, 8000)
})

test('空きが無い行は終わりをいじらない', () => {
  const result = convertLiriqoTrack({
    timed: [
      { start: 0, end: 1000, text: 'ab', words: [{ start: 0, end: 500, text: 'a' }, { start: 500, end: 1000, text: 'b' }] },
      { start: 1000, end: 1020, text: 'cd', words: [{ start: 1000, end: 1020, text: 'cd' }] },
      { start: 1020, end: 2000, text: 'ef', words: [{ start: 1020, end: 1500, text: 'e' }, { start: 1500, end: 2000, text: 'f' }] },
    ],
  })
  assert.equal(result.dynamicLines[1].endTimeMs, undefined)
})

test('行同期しか無い lrc は chars を1つしか持たない', () => {
  const lines = parseSimpleLrc('[00:01.50]あい\n[00:03.25]うえ\n[ti:x]')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].startTimeMs, 1500)
  assert.equal(lines[1].startTimeMs, 3250)
  assert.equal(lines[0].chars.length, 1)
})

// ── AMLL (.lys / .ttml) ─────────────────────────────────────

test('lys は語の開始時刻を拾い、(0,0) の空白は直前の語に足す', () => {
  const [line] = parseLys('[0]la(686,334) (0,0)lo(1020,173) (0,0)li(1193,168)')
  assert.equal(line.startTimeMs, 686)
  assert.equal(line.text, 'la lo li')
  assert.deepEqual(line.chars, [
    { t: 686, c: 'la ' },
    { t: 1020, c: 'lo ' },
    { t: 1193, c: 'li' },
  ])
})

test('lys の空白を語として積まない(行頭へ飛ぶ事故を防ぐ)', () => {
  const [line] = parseLys('[0]la(500,100) (0,0)lo(700,100)')
  assert.ok(line.chars.every(ch => ch.t > 0), '時刻0の語が混ざっている')
})

test('TTML の時刻はいくつかの書き方を受ける', () => {
  assert.equal(parseTtmlTime('00:01.500'), 1500)
  assert.equal(parseTtmlTime('01:02:03.250'), 3723250)
  assert.equal(parseTtmlTime('12.5s'), 12500)
  assert.equal(parseTtmlTime('120ms'), 120)
  assert.equal(parseTtmlTime(''), null)
})

test('TTML は span ごとの時刻を拾い、ハモリ(x-bg)は混ぜない', () => {
  const ttml = [
    '<tt><body><div>',
    '<p begin="00:01.000" end="00:03.000">',
    '<span begin="00:01.000" end="00:01.500">あ</span>',
    '<span begin="00:01.500" end="00:02.000">い</span>',
    '<span ttm:role="x-bg" begin="00:01.200" end="00:02.400">',
    '<span begin="00:01.200" end="00:01.800">ハモ</span></span>',
    '</p>',
    '<p begin="00:05.000" end="00:06.000">',
    '<span begin="00:05.000" end="00:05.400">&amp;う</span></p>',
    '</div></body></tt>',
  ].join('')

  const lines = parseTtml(ttml)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].startTimeMs, 1000)
  assert.equal(lines[0].text, 'あい', 'ハモリが本編に混ざっている')
  assert.deepEqual(lines[0].chars.map(ch => ch.t), [1000, 1500])
  assert.equal(lines[1].text, '&う', 'XML の実体参照が戻っていない')
})

// ── KuGou (krc) ─────────────────────────────────────────────

test('krc の語は行頭からの差なので絶対時刻に直す', () => {
  const [line] = parseKrc('[5000,900]<0,300,0>あ<300,300,0>い<600,300,0>う')
  assert.equal(line.startTimeMs, 5000)
  assert.deepEqual(line.chars.map(ch => ch.t), [5000, 5300, 5600])
  assert.equal(line.text, 'あいう')
})

test('krc のヘッダー行は歌詞にしない', () => {
  const lines = parseKrc('[ti:x]\n[ar:y]\n[offset:0]\n[0,300]<0,300,0>あ')
  assert.equal(lines.length, 1)
})

// KuGou の krc は先頭に「曲名 - 歌手」とクレジット行を必ず持っていて、
// lyrics-ui.js 側の見出し落としでは(次の歌詞まで10秒の条件に当たらず)
// 落ちない。実測7曲中5曲が素通りした。
const krcWithHeader = (want) => ([
  { startTimeMs: 0, text: `${want.track} - ${want.artist}`, chars: [{ t: 0, c: 'x' }] },
  { startTimeMs: 300, text: '詞：だれか', chars: [{ t: 300, c: 'x' }] },
  { startTimeMs: 600, text: '曲：だれか', chars: [{ t: 600, c: 'x' }] },
  ...Array.from({ length: 8 }, (_, i) => ({
    startTimeMs: 5000 + i * 1000,
    text: `歌詞${i}`,
    chars: [{ t: 5000 + i * 1000, c: 'あ' }],
  })),
])

test('krc の見出しとクレジットを先頭から落とす', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const kept = stripLeadingHeaderLines(krcWithHeader(want), want)
  assert.equal(kept.length, 8)
  assert.equal(kept[0].startTimeMs, 5000)
})

// 実際に画面へ出てしまった形。作詞者が2名いると行が41文字になり、
// 「行全体が24文字以内」という条件では落ちなかった。
// クレジットの長さは名前の数で決まるので、長さで判定してはいけない。
test('名前が長いクレジット行も落とす', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = [
    { startTimeMs: 0, text: '词：Aaa Bbb"TheLongestNickname"/Ccc Ddd', chars: [{ t: 0, c: 'x' }] },
    { startTimeMs: 300, text: '曲：Aaa Bbb"TheLongestNickname"/Eee Fff', chars: [{ t: 300, c: 'x' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      startTimeMs: 5000 + i * 1000, text: `歌詞${i}`, chars: [{ t: 5000 + i * 1000, c: 'あ' }],
    })),
  ]
  const kept = stripLeadingHeaderLines(lines, want)
  assert.equal(kept.length, 8, `落としきれていない: ${kept.length}行残った`)
})

// 既知の語だけに絞ると、想定外のラベルで打ち切ってその後ろを取りこぼす。
// 実測(KuGou / Lemon)では「原唱：」で止まり、次の词・曲が素通りしていた。
test('見慣れないラベルでも、短ければクレジットとして落とす', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = [
    { startTimeMs: 0, text: '原唱：だれか', chars: [{ t: 0, c: 'x' }] },
    { startTimeMs: 300, text: '词：だれか', chars: [{ t: 300, c: 'x' }] },
    { startTimeMs: 600, text: '曲：だれか', chars: [{ t: 600, c: 'x' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      startTimeMs: 5000 + i * 1000, text: `歌詞${i}`, chars: [{ t: 5000 + i * 1000, c: 'あ' }],
    })),
  ]
  assert.equal(stripLeadingHeaderLines(lines, want).length, 8)
})

test('長いラベルは既知の語でなければ歌詞として残す', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = [
    // ラベルが長く、クレジット語でもない = 歌詞の一部とみなす
    { startTimeMs: 0, text: 'これはとても長い呼びかけです：そして続く', chars: [{ t: 0, c: 'あ' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      startTimeMs: 5000 + i * 1000, text: `歌詞${i}`, chars: [{ t: 5000 + i * 1000, c: 'あ' }],
    })),
  ]
  assert.equal(stripLeadingHeaderLines(lines, want).length, 9, '歌詞を消している')
})

test('表示側のクレジット判定にも1文字ラベルが入っている', () => {
  const ui = read('src/js/module/lyrics-ui.js')
  const list = ui.slice(ui.indexOf('const LYRIC_CREDIT_LABELS = ['), ui.indexOf('];', ui.indexOf('const LYRIC_CREDIT_LABELS = [')))
  for (const label of ['词', '曲', '原唱']) {
    assert.ok(list.includes(`'${label}'`), `${label} が表示側の一覧に無い`)
  }
})

test('見出しを持たない krc には触らない', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = Array.from({ length: 10 }, (_, i) => ({
    startTimeMs: i * 1000, text: `歌詞${i}`, chars: [{ t: i * 1000, c: 'あ' }],
  }))
  assert.equal(stripLeadingHeaderLines(lines, want).length, 10)
})

test('見出し落としは1行でも外れたらそこで止める', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = [
    { startTimeMs: 0, text: 'テスト曲 - テスト歌手', chars: [{ t: 0, c: 'x' }] },
    { startTimeMs: 300, text: 'ふつうの歌い出し', chars: [{ t: 300, c: 'あ' }] },
    { startTimeMs: 600, text: '詞：だれか', chars: [{ t: 600, c: 'x' }] },
    ...Array.from({ length: 8 }, (_, i) => ({
      startTimeMs: 5000 + i * 1000, text: `歌詞${i}`, chars: [{ t: 5000 + i * 1000, c: 'あ' }],
    })),
  ]
  const kept = stripLeadingHeaderLines(lines, want)
  assert.equal(kept.length, 10, '歌い出しの先で止まっていない')
  assert.equal(kept[0].text, 'ふつうの歌い出し')
})

test('短い歌詞を見出しで削り切らない', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手' }
  const lines = [
    { startTimeMs: 0, text: 'テスト曲 - テスト歌手', chars: [{ t: 0, c: 'x' }] },
    { startTimeMs: 300, text: '詞：だれか', chars: [{ t: 300, c: 'x' }] },
    { startTimeMs: 600, text: '歌詞', chars: [{ t: 600, c: 'あ' }] },
  ]
  assert.equal(stripLeadingHeaderLines(lines, want).length, 3)
})

test('krc は krc1 を外して XOR し、zlib を展開できる', async () => {
  const key = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
    0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]
  const plain = '[0,300]<0,300,0>あ'
  const deflated = zlib.deflateSync(Buffer.from(plain, 'utf8'))
  const scrambled = Buffer.alloc(deflated.length)
  for (let i = 0; i < deflated.length; i++) scrambled[i] = deflated[i] ^ key[i % 16]
  const payload = Buffer.concat([Buffer.from('krc1', 'latin1'), scrambled]).toString('base64')

  const bytes = decodeKrcBase64(payload)
  assert.ok(bytes, '復号に失敗している')
  assert.equal(await inflateZlib(bytes), plain)
})

// ── LiriQo ──────────────────────────────────────────────────

test('LiriQo は同期の細かい候補を選ぶ', () => {
  const best = pickBestLiriqoTrack([
    { provider: 'a', syncLevel: 'line', timed: [{ start: 0, text: 'x' }] },
    { provider: 'b', syncLevel: 'syllable', timed: [{ start: 0, text: 'x' }] },
    { provider: 'c', syncLevel: 'word', timed: [{ start: 0, text: 'x' }] },
  ])
  assert.equal(best.provider, 'b')
})

test('LiriQo は timed が空の候補を選ばない', () => {
  const best = pickBestLiriqoTrack([
    { provider: 'a', syncLevel: 'syllable', timed: [] },
    { provider: 'b', syncLevel: 'line', timed: [{ start: 0, text: 'x' }] },
  ])
  assert.equal(best.provider, 'b')
})

test('LiriQo の words を文字時刻に均す', () => {
  const result = convertLiriqoTrack({
    syncLevel: 'syllable',
    timed: [
      { start: 1000, end: 2000, text: 'あい', words: [
        { start: 1000, end: 1500, text: 'あ' },
        { start: 1500, end: 2000, text: 'い' },
      ] },
    ],
  })
  assert.ok(result.dynamicLines, '単語同期が落ちている')
  assert.deepEqual(result.dynamicLines[0].chars.map(ch => ch.t), [1000, 1500])
  assert.match(result.lyrics, /^\[00:01\.00\] あい$/)
})

test('行の中で時刻が巻き戻ったら直前に合わせて止める', () => {
  const result = convertLiriqoTrack({
    syncLevel: 'syllable',
    timed: [
      { start: 1000, text: 'あいう', words: [
        { start: 1000, text: 'あ' },
        { start: 1800, text: 'い' },
        { start: 1200, text: 'う' },   // 上流のデータの傷(実測で1箇所あった)
      ] },
    ],
  })
  assert.deepEqual(result.dynamicLines[0].chars.map(ch => ch.t), [1000, 1800, 1800])
  assert.equal(result.dynamicLines[0].text, 'あいう', '語の並びを時刻で入れ替えてはいけない')
})

// videoId で引いた時に、別の曲の歌詞が付いて返ってきたことがある。
// 向こうのメタデータは正しい曲名を言うので、時間軸でしか見抜けない。
test('曲の長さに対して歌詞が短すぎたら別の曲とみなす', () => {
  const rows = [{ start: 1000, end: 4000 }, { start: 190000, end: 194000 }]
  assert.equal(liriqoCoversTrack(rows, 275), false, '3分14秒ぶんの歌詞が4分35秒の曲に通っている')
  assert.equal(liriqoCoversTrack(rows, 213), true, '当たっている歌詞まで落としている')
})

// 変換後の dynamicLines で測っていた時は、行同期しか無い回に null が渡って
// 素通りしていた。別の曲が来るのは単語同期の時だけとは限らない。
test('行同期しか無い回も長さで見る', () => {
  const rows = [{ start: 1000 }, { start: 194000 }]
  assert.equal(liriqoCoversTrack(rows, 275), false, '行同期だと素通りしている')
})

test('曲の長さが分からない時は長さで判断しない', () => {
  const rows = [{ start: 1000, end: 2000 }]
  assert.equal(liriqoCoversTrack(rows, null), true)
  assert.equal(liriqoCoversTrack(rows, 0), true)
})

test('行同期しか無ければ dynamicLines を渡さない', () => {
  const result = convertLiriqoTrack({
    syncLevel: 'line',
    timed: [
      { start: 1000, text: 'あい' },
      { start: 2000, text: 'うえ' },
    ],
  })
  assert.equal(result.dynamicLines, null, '文字時刻が無いのに単語同期として渡している')
  assert.match(result.lyrics, /\[00:01\.00\] あい/)
})

// ── 曲の取り違え ────────────────────────────────────────────

test('曲名がかすりもしない候補は落とす', () => {
  assert.equal(scoreRemoteCandidate(
    { title: 'まったく別の曲', artist: 'A', durationSec: 250 },
    { track: 'テスト曲', artist: 'A', durationSec: 250 },
  ), -1)
})

test('長さが大きく違う版は選ばない', () => {
  const want = { track: 'テスト曲', artist: 'テスト歌手', durationSec: 250 }
  const picked = pickRemoteCandidate([
    { id: 'live', title: 'テスト曲', artist: 'テスト歌手', durationSec: 400 },
    { id: 'studio', title: 'テスト曲', artist: 'テスト歌手', durationSec: 251 },
  ], want)
  assert.equal(picked.id, 'studio')
})

test('長さが分からない時でも曲名とアーティストが合えば通す', () => {
  const picked = pickRemoteCandidate(
    [{ id: 'x', title: 'テスト曲', artist: 'テスト歌手', durationSec: null }],
    { track: 'テスト曲', artist: 'テスト歌手', durationSec: null },
  )
  assert.equal(picked.id, 'x')
})

test('曲名だけ合っていて長さが外れた候補は捨てる', () => {
  const picked = pickRemoteCandidate(
    [{ id: 'cover', title: 'テスト曲', artist: '別の人', durationSec: 120 }],
    { track: 'テスト曲', artist: 'テスト歌手', durationSec: 250 },
  )
  assert.equal(picked, null)
})

// ── 配線と入切 ──────────────────────────────────────────────

test('既定は全部有効', () => {
  assert.equal(EXTRA_PROVIDERS_ENABLED, true)
  assert.deepEqual(PROVIDER_SWITCHES, {
    netease: true, amll: true, kugou: true, liriqo: true,
  })
})

test('禁止ヘッダー(Referer / Cookie)に頼っていない', () => {
  const source = read('src/js/module/extra-providers.js')
  const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
  assert.ok(!/['"]Referer['"]\s*:/i.test(code), 'fetch では Referer を送れない')
  assert.ok(!/['"]Cookie['"]\s*:/i.test(code), 'fetch では Cookie を送れない')
})

test('background.js が4つとも呼んでいる', () => {
  const source = read('src/js/background.js')
  for (const fn of ['fetchFromAmll', 'fetchFromNetease', 'fetchFromKugou', 'fetchFromLiriqo']) {
    assert.ok(source.includes(`Extra.${fn}`), `${fn} が配線されていない`)
  }
  // 候補メニューの表示名が無いと、乗り換え先に ID がそのまま出る。
  for (const id of ['amll', 'netease', 'kugou', 'liriqo']) {
    assert.match(source, new RegExp(`^\\s{2}${id}: '`, 'm'))
  }
})

test('LiriQo は重いので最初の競走には出さない', () => {
  const source = read('src/js/background.js')
  const start = source.indexOf('const richFallbackTask = firstValidResult([')
  assert.notEqual(start, -1)
  const block = source.slice(start, source.indexOf(']);', start))
  assert.ok(!/liriqo/i.test(block), 'LiriQo が毎回の競走に混ざっている')
  assert.match(block, /richSelectionTasks/)

  // 単語同期を返せる4つは1か所でまとめて起こす。取りこぼすと
  // 「フォールバック段では走るが単語同期優先では走らない」がすぐ起きる。
  const starter = source.slice(
    source.indexOf('const startRichProviders = () => {'),
    source.indexOf('// LiriQo だけは別扱い'),
  )
  for (const name of ['LyricsPlus', 'fetchFromAmll', 'fetchFromNetease', 'fetchFromKugou']) {
    assert.ok(starter.includes(name), `${name} が startRichProviders に入っていない`)
  }
  assert.ok(!/fetchFromLiriqo/.test(starter), 'LiriQo が一緒に起きてしまう')
})

// 通信先を host_permissions に書くと、更新のたびに Chrome が
// 「権限が増えたので無効化しました」を出す。判定はホスト集合の差分なので、
// 既に9ホスト持っていても新しい1つで増加になる。任意の権限にしておく。
test('通信先は必須ではなく任意の権限に置く', () => {
  const manifest = JSON.parse(read('manifest.json'))
  const optional = manifest.optional_host_permissions || []
  const required = manifest.host_permissions || []
  for (const host of [
    'https://music.163.com/*',
    'https://raw.githubusercontent.com/*',
    'https://cdn.jsdelivr.net/*',
    'https://krcs.kugou.com/*',
    'https://lyrics.kugou.com/*',
    'https://api.liriqo-alfarrizi.workers.dev/*',
  ]) {
    assert.ok(optional.includes(host), `${host} が optional_host_permissions に無い`)
    assert.ok(!required.includes(host), `${host} を必須にすると更新時に無効化される`)
  }
})

test('求める権限と実際に叩くホストが食い違わない', () => {
  const manifest = JSON.parse(read('manifest.json'))
  const optional = new Set(manifest.optional_host_permissions || [])
  const used = new Set(Object.values(PROVIDER_ORIGINS).flat())
  for (const origin of used) {
    assert.ok(optional.has(origin), `${origin} を叩くのに manifest で求めていない`)
  }
  for (const origin of optional) {
    assert.ok(used.has(origin), `${origin} を求めているが誰も使っていない`)
  }
})

test('AMLL は曲IDの割り出しに NetEase を使うので、その権限も要る', () => {
  assert.ok(PROVIDER_ORIGINS.amll.includes('https://music.163.com/*'))
})

test('取得元と通信先の対応に抜けが無い', () => {
  assert.deepEqual(PROVIDER_IDS.slice().sort(), Object.keys(PROVIDER_SWITCHES).sort())
})

// ここは chrome が無い Node なので、許可の問い合わせは必ず失敗する。
// その状態で fetch に進んでしまうと、許可していない利用者から通信が出る。
test('許可が無ければ通信しない', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined', '前提が崩れている')
  for (const [name, fn] of Object.entries({ fetchFromAmll, fetchFromKugou, fetchFromLiriqo, fetchFromNetease })) {
    assert.equal(
      await fn({ track: 'テスト曲', artist: 'テスト歌手', durationSec: 200, video_id: 'abc' }),
      null,
      `${name} が許可の無いまま動いている`,
    )
  }
})

test('許可ページが manifest から開ける', () => {
  const manifest = JSON.parse(read('manifest.json'))
  assert.equal(manifest.options_ui?.page, 'src/options.html')
  assert.ok(fs.existsSync(new URL('../src/options.html', import.meta.url)))
  assert.ok(fs.existsSync(new URL('../src/js/options.js', import.meta.url)))
})

test('許可ページが触る要素が揃っている', () => {
  const html = read('src/options.html')
  const js = read('src/js/options.js')
  // 通信先を書き写すと「許可したのに動かない」になるので、定義は1か所から読む
  assert.match(js, /import \{[^}]*PROVIDER_ORIGINS[^}]*\} from '\.\/module\/extra-providers\.js'/)
  assert.match(html, /<script type="module" src="js\/options\.js">/)
  for (const id of ['title', 'lead', 'note-privacy', 'status', 'providers']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} が options.html に無い`)
    assert.ok(js.includes(`'${id}'`), `#${id} を options.js が使っていない`)
  }
})

test('background から許可ページを開ける', () => {
  const source = read('src/js/background.js')
  assert.match(source, /OPEN_EXTRA_PROVIDERS_SETUP/)
  assert.match(source, /chrome\.runtime\.openOptionsPage\(/)
})
