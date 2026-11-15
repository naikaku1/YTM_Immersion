import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { englishToHangul, arpabetToHangul, kanaToHangul } from '../src/js/module/pronunciation-core.js';
import { pronounceLines } from '../src/js/module/pronunciation-engine.js';

test('common English lyric words use familiar Hangul, without translating meaning', () => {
  assert.equal(englishToHangul('Hello, I love you!'), '헬로, 아이 러브 유!');
  assert.equal(englishToHangul('Beautiful world'), '뷰티풀 월드');
  assert.equal(englishToHangul('You’re my baby'), '유어 마이 베이비');
  assert.equal(englishToHangul('안녕 hello ♥'), '안녕 헬로 ♥');
});

test('unsupported words and scripts are preserved rather than guessed', () => {
  assert.equal(englishToHangul('안녕하세요'), '');
  assert.equal(englishToHangul('你好世界'), '');
  assert.equal(englishToHangul('😀 123 <script>'), '');
  assert.equal(englishToHangul('hello xyzzyfrobnitz'), '헬로 xyzzyfrobnitz');
  assert.equal(englishToHangul('constructor toString'), '');
});

test('ARPABET handles consonant clusters, glides, diphthongs and final consonants', () => {
  assert.equal(arpabetToHangul('S T AA1 R'), '스타');
  assert.equal(arpabetToHangul('M UW1 N'), '문');
  assert.equal(arpabetToHangul('S K AY1'), '스카이');
  assert.equal(arpabetToHangul('K W IH1 N'), '퀸');
  assert.equal(arpabetToHangul('SH AY1 N'), '샤인');
  assert.equal(arpabetToHangul('B UH1 K S'), '북스');
  assert.equal(englishToHangul('moon sky', { moon: 'M UW1 N', sky: 'S K AY1' }), '문 스카이');
});

test('kana conversion supports small kana, sokuon, halfwidth, and long vowels', () => {
  assert.equal(kanaToHangul('きゃ キャ'), '캬 캬');
  assert.equal(kanaToHangul('ガッコー'), '각코');
  assert.equal(kanaToHangul('コンピューター'), '콘퓨타');
  assert.equal(kanaToHangul('ﾊﾛｰ'), '하로');
  assert.equal(kanaToHangul('ティー フォー'), '티 포');
});

const assetRoot = new URL('../', import.meta.url);
const assetReads = [];
const originalFetch = globalThis.fetch;
globalThis.chrome = { runtime: { getURL: path => new URL(path, assetRoot).href } };
globalThis.fetch = async url => {
  assert.equal(new URL(url).protocol, 'file:', 'pronunciation must only read packaged assets');
  assetReads.push(url);
  return new Response(await readFile(fileURLToPath(url)));
};
test.after(() => { globalThis.fetch = originalFetch; });

test('real bundled English dictionary reads irregular spellings and loads once', async () => {
  const result = await pronounceLines(['Hello, I love you', 'moon sky', '안녕', 'hello xyzzyfrobnitz']);
  assert.deepEqual(result, ['헬로, 아이 러브 유', '문 스카이', '', '헬로 xyzzyfrobnitz']);
  assert.equal(assetReads.length, 1);
  await pronounceLines(['moon sky']);
  assert.equal(assetReads.length, 1);
});

test('real IPADIC resolves kanji and Japanese particles, with mixed English', async () => {
  const texts = ['こんにちは', '君の名前を呼ぶ', '私はあなたが好きです', '学校へ行こう', 'ありがとう', 'hello 世界'];
  const result = await pronounceLines(texts);
  assert.deepEqual(result, ['콘니치와', '키미노나마에오요부', '와타시와아나타가스키데스', '각코에이코우', '아리가토', '헬로 세카이']);
  assert.equal(assetReads.length, 13);
  assert.deepEqual(await pronounceLines(texts), result);
  assert.equal(assetReads.length, 13, 'no dictionary reload on replay');
});

test('Han-only songs are not silently pronounced in Japanese', async () => {
  assert.deepEqual(await pronounceLines(['世界和平', '你好']), ['', '']);
  assert.deepEqual(await pronounceLines(['世界'], { japanese: true }), ['세카이']);
});

test('invalid and oversized messages fail before tokenization', async () => {
  for (const input of [null, 'hello', Array(401).fill('hello'), ['x'.repeat(1001)], [{}]]) {
    await assert.rejects(pronounceLines(input), /Invalid pronunciation input/);
  }
});

test('every shipped dictionary and tokenizer matches its provenance checksum', async () => {
  const base = new URL('../src/assets/pronunciation/', import.meta.url);
  const sources = JSON.parse(await readFile(new URL('sources.json', base)));
  assert.ok(sources.cmudict.entries > 120000);
  for (const [path, checksum] of Object.entries(sources.sha256)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(path, base))).digest('hex'), checksum, path);
  }
});


test('detailed Japanese readings retain source ranges across kanji, particles and spaces', async () => {
  const engine = await import('../src/js/module/pronunciation-engine.js');
  const result = await engine.pronounceDetailed(['東京へ 行こう'], { japanese: true });
  const parts = result.segments[0];
  assert.ok(parts.some(part => part.start === 0 && part.end === 2 && part.text === '토쿄'));
  assert.ok(parts.some(part => part.text === ' '));
  assert.equal(parts.map(part => part.text).join(''), result.lines[0]);
  assert.ok(parts.every(part => part.end > part.start));
});


test('Japanese lyrics join particles and conjugations and space clear phrase boundaries', async () => {
  const { pronounceDetailed } = await import('../src/js/module/pronunciation-engine.js');
  const input = ['君の名前を呼ぶ', '呼んでいる', '愛してる', 'ずっと', 'どれだけ仆ははらい切れるんだろう'];
  const result = await pronounceDetailed(input, { japanese: true });
  assert.deepEqual(result.lines, ['키미노 나마에오 요부', '욘데이루', '아이시테루', '즛토', '도레다케 보쿠와 하라이키레룬다로우']);
  assert.ok(result.lines.every(line => !/[\x00-\x1f]/.test(line)));
  for (const parts of result.segments) assert.ok(parts.every(part => part.start < part.end));
});

test('unknown Japanese kanji are preserved rather than guessed', async () => {
  const { pronounceDetailed } = await import('../src/js/module/pronunciation-engine.js');
  const { lines } = await pronounceDetailed(['仆と𠮷野'], { japanese: true });
  assert.ok(lines[0].includes('仆'));
});

test('unknown kana and split small kana in lyric examples are fully pronounced', async () => {
  const { pronounceDetailed } = await import('../src/js/module/pronunciation-engine.js');
  const texts = ['カチッとコロコロブルブルドキドキ', 'やる気のボタンをポチッとな！', 'どりょくのちからってすごい！(えっへん)'];
  const result = await pronounceDetailed(texts, { japanese: true });
  assert.deepEqual(result.lines, ['카칫토 코로코로부루부루도키도키', '야루키노 보탄오 포칫토나！', '도료쿠노치카랏테스고이！(엣헨)']);
  assert.ok(result.lines.every(line => !/[ぁ-ゖァ-ヺ]/.test(line)));
  assert.ok(result.segments[2].length > 3, 'remaining words retain separate timing ranges');
  for (let i = 0; i < texts.length; i++) {
    assert.equal(result.segments[i][0].start, 0);
    assert.equal(result.segments[i].at(-1).end, texts[i].length);
    for (let j = 1; j < result.segments[i].length; j++) assert.equal(result.segments[i][j - 1].end, result.segments[i][j].start);
  }
});


test('readings follow Korean, Japanese and English display languages', async () => {
  const { pronounceDetailed } = await import('../src/js/module/pronunciation-engine.js');
  const get = async (text, target, japanese = false) => (await pronounceDetailed([text], { target, japanese })).lines[0];
  assert.equal(await get('사랑해', 'ja'), 'サランヘ');
  assert.equal(await get('사랑해', 'en'), 'saranghae');
  assert.equal(await get('君の名前を呼ぶ', 'en', true), 'kimino namaeo yobu');
  assert.equal(await get('Hello world', 'ja'), 'ハロー ワールド');
  assert.equal(await get('Hello world', 'ko'), '헬로 월드');
  assert.equal(await get('사랑해', 'ko'), '');
  assert.equal(await get('こんにちは', 'ja', true), '');
  assert.equal(await get('hello', 'en'), '');
});
