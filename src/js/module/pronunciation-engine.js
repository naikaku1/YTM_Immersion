import { Tokenizer, DynamicDictionaries } from '../vendor/kuromoji.js';
import { toRomaji, toKatakana } from '../vendor/wanakana.js';
import './korean-ruby.js';
import { englishToHangul, japaneseToHangul, kanaToHangul, attachFinal } from './pronunciation-core.js';

// Runs in the extension service worker, away from playback and lyric animation.
// Only packaged data is fetched; lyric text never goes to a pronunciation server.
const HAS_LATIN = /[A-Za-z]/;
const HAS_KANA = /[ぁ-ゖァ-ヺ]/;
const HAS_HAN = /[\u3400-\u9fff]/;
let englishPromise = null;
let japanesePromise = null;
const lineCache = new Map();
const CACHE_LIMIT = 1024;

async function loadGzip(file) {
  const response = await fetch(chrome.runtime.getURL(`src/assets/pronunciation/${file}`));
  if (!response.ok) throw new Error('Pronunciation dictionary unavailable');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function loadEnglish() {
  if (!englishPromise) englishPromise = loadGzip('en.json.gz')
    .then(buffer => JSON.parse(new TextDecoder().decode(buffer)))
    .catch(error => { englishPromise = null; throw error; });
  return englishPromise;
}

function loadJapanese() {
  if (!japanesePromise) japanesePromise = (async () => {
    const files = ['base', 'check', 'tid', 'tid_pos', 'tid_map', 'cc', 'unk', 'unk_pos', 'unk_map', 'unk_char', 'unk_compat', 'unk_invoke'];
    const buffers = await Promise.all(files.map(file => loadGzip(`ja/${file}.dat.gz`)));
    const [base, check, tid, pos, map, cc, unk, unkPos, unkMap, chars, compat, invoke] = buffers;
    const dic = new DynamicDictionaries();
    dic.loadTrie(new Int32Array(base), new Int32Array(check));
    dic.loadTokenInfoDictionaries(new Uint8Array(tid), new Uint8Array(pos), new Uint8Array(map));
    dic.loadConnectionCosts(new Int16Array(cc));
    dic.loadUnknownDictionaries(new Uint8Array(unk), new Uint8Array(unkPos), new Uint8Array(unkMap), new Uint8Array(chars), new Uint32Array(compat), new Uint8Array(invoke));
    return new Tokenizer(dic);
  })().catch(error => { japanesePromise = null; throw error; });
  return japanesePromise;
}

export async function pronounceLines(texts, { japanese = false } = {}) {
  if (!Array.isArray(texts) || texts.length > 400 || texts.some(text => typeof text !== 'string' || text.length > 1000)) throw new Error('Invalid pronunciation input');
  const songIsJapanese = japanese || texts.some(text => HAS_KANA.test(text));
  const mode = songIsJapanese ? 'ja' : 'en';
  const missing = texts.filter(text => !lineCache.has(`${mode}:${text}`));
  // Load dictionaries independently, so an unavailable Japanese dictionary
  // cannot suppress English readings on a mixed-language track.
  const [english, tokenizer] = await Promise.all([
    missing.some(text => HAS_LATIN.test(text)) ? loadEnglish().catch(() => null) : null,
    songIsJapanese && missing.some(text => HAS_KANA.test(text) || HAS_HAN.test(text)) ? loadJapanese().catch(() => null) : null,
  ]);
  const lines = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const key = `${mode}:${text}`;
    let reading = lineCache.get(key);
    if (reading === undefined) {
      if (songIsJapanese && (HAS_KANA.test(text) || HAS_HAN.test(text))) {
        reading = tokenizer ? japaneseToHangul(text, tokenizer, english || {})
          : HAS_HAN.test(text) ? '' : kanaToHangul(englishToHangul(text, english || {}) || text);
      } else reading = englishToHangul(text, english || {});
      // Failed dictionary loads must remain retryable.
      if ((!HAS_LATIN.test(text) || english) && (!songIsJapanese || !HAS_HAN.test(text) || tokenizer)) {
        lineCache.set(key, reading);
        while (lineCache.size > CACHE_LIMIT) lineCache.delete(lineCache.keys().next().value);
      }
    }
    lines.push(reading);
    if (i % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return lines;
}

// English approximation in Japanese kana, derived from local CMU phonemes.
const EN_KANA_EXCEPTIONS = { hello: 'ハロー', love: 'ラブ', you: 'ユー', world: 'ワールド', baby: 'ベイビー', music: 'ミュージック', i: 'アイ' };
const KANA_ONSET = { B:'b', CH:'ch', D:'d', DH:'z', F:'f', G:'g', HH:'h', JH:'j', K:'k', L:'r', M:'m', N:'n', P:'p', R:'r', S:'s', SH:'sh', T:'t', TH:'s', V:'b', W:'w', Y:'y', Z:'z', ZH:'j' };
const KANA_VOWEL = { AA:'a', AE:'a', AH:'a', AO:'o', AW:'au', AY:'ai', EH:'e', ER:'aa', EY:'ei', IH:'i', IY:'ii', OW:'oo', OY:'oi', UH:'u', UW:'uu' };
const KANA_END = { B:'bu', CH:'chi', D:'do', DH:'zu', F:'fu', G:'gu', HH:'h', JH:'ji', K:'ku', L:'ru', M:'mu', N:'n', NG:'n', P:'pu', R:'a', S:'su', SH:'shu', T:'to', TH:'su', V:'bu', W:'u', Y:'i', Z:'zu', ZH:'ji' };
function englishKana(word, dictionary) {
  const key = word.toLowerCase().replace(/’/g, "'");
  if (Object.hasOwn(EN_KANA_EXCEPTIONS, key)) return EN_KANA_EXCEPTIONS[key];
  if (!dictionary || !Object.hasOwn(dictionary, key)) return word;
  const phones = dictionary[key].replace(/[012]/g, '').split(/\s+/).filter(Boolean);
  let result = '', pending = [];
  for (const phone of phones) {
    if (!KANA_VOWEL[phone]) { pending.push(phone); continue; }
    while (pending.length > 1) result += KANA_END[pending.shift()] || '';
    result += (KANA_ONSET[pending.shift()] || '') + KANA_VOWEL[phone];
  }
  for (const phone of pending) result += KANA_END[phone] || '';
  return result ? toKatakana(result) : word;
}
function convertEnglish(text, target, dictionary) {
  if (target === 'en') return text;
  if (target === 'ko') return englishToHangul(text, dictionary || {}) || text;
  return text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, word => englishKana(word, dictionary));
}
function convertKorean(text, target) {
  if (target === 'ko') return text;
  const ruby = globalThis.YtmKoreanRuby;
  if (!ruby) return text;
  return text.replace(/[가-힣]+/g, word => target === 'ja' ? ruby._kanaWord(word) : ruby._latinWord(word));
}
const japaneseReading = (kana, target) => target === 'en' ? toRomaji(kana) : kanaToHangul(kana);

// Tokenize each new line once, retain source ranges for highlighting, and only
// insert spaces at boundaries supported by grammatical analysis.
const detailCache = new Map();
export async function pronounceDetailed(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length > 400 || texts.some(text => typeof text !== 'string' || text.length > 1000)) throw new Error('Invalid pronunciation input');
  const target = ['ko', 'ja', 'en'].includes(options.target) ? options.target : 'ko';
  const japanese = options.japanese || texts.some(text => HAS_KANA.test(text));
  const tokenizer = japanese && texts.some(text => HAS_KANA.test(text) || HAS_HAN.test(text)) ? await loadJapanese().catch(() => null) : null;
  const dictionary = texts.some(text => HAS_LATIN.test(text)) ? await loadEnglish().catch(() => null) : {};
  const results = [];
  for (const text of texts) {
    const key = `${target}:${japanese}:${text}`;
    if (detailCache.has(key)) { results.push(detailCache.get(key)); continue; }
    let units = [], changed = false, valid = true;
    if (japanese && (HAS_KANA.test(text) || HAS_HAN.test(text))) {
      if (!tokenizer) { results.push({ line: '', segments: [] }); continue; }
      const tokens = tokenizer.tokenize(text);
      let pos = 0, previous = null, previousKana = null;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i], surface = token.surface_form;
        // IPADIC can swallow the rest of a hiragana line into one unknown
        // token when it starts with a small kana. Reanalyse after that kana so
        // the remaining words keep their own timing and grammatical boundaries.
        if (token.word_type === 'UNKNOWN' && /^[ゃゅょぁぃぅぇぉゎっャュョァィゥェォヮッ]/.test(surface) && surface.length > 1) {
          const first = surface[0];
          tokens.splice(i, 1, { ...token, surface_form: first, reading: first, pronunciation: first }, ...tokenizer.tokenize(surface.slice(1)));
          i--; continue;
        }
        const start = text.indexOf(surface, pos);
        if (start < 0) { valid = false; break; }
        const gap = text.slice(pos, start);
        if (gap) units.push({ start: pos, end: start, text: gap });
        const kana = token.pronunciation || token.reading || (HAS_KANA.test(surface) ? surface : null);
        const joinsPreviousKana = !gap && /^[ゃゅょぁぃぅぇぉゎっャュョァィゥェォヮッ]/.test(surface) && previousKana && units.length;
        if (joinsPreviousKana) {
          const prior = units[units.length - 1];
          prior.text = target === 'ja' ? text.slice(prior.start, start + surface.length) : japaneseReading(previousKana + kana, target);
          prior.end = start + surface.length;
          previousKana += kana; pos = prior.end; previous = token; changed = true; continue;
        }
        const independent = (token.pos === '名詞' && token.pos_detail_1 !== '非自立') || (token.pos === '動詞' && token.pos_detail_1 === '自立');
        const breakBefore = !gap && previous?.pos === '助詞' && previous.pos_detail_1 !== '接続助詞' && independent;
        if (breakBefore && units.length && !/\s$/.test(units[units.length - 1].text)) units[units.length - 1].text += ' ';
        let value;
        // This common substitution is restricted to a pronoun followed by a particle.
        if (surface === '仆' && tokens[i + 1]?.surface_form === 'は' && tokens[i + 1]?.pos === '助詞') value = target === 'ja' ? surface : target === 'en' ? 'boku' : '보쿠';
        else if (/[가-힣]/.test(surface)) value = convertKorean(surface, target);
        else if (/[\u3040-\u30ff\u3400-\u9fff]/.test(surface)) {
          value = target === 'ja' ? surface : target === 'en' && token.pos === '助詞' && surface === 'を' ? 'o' : kana ? japaneseReading(kana, target) : surface;
          if (target === 'ko' && kana === 'ン' && units.length && /[가-힣]$/.test(units[units.length - 1].text)) {
            const prior = units[units.length - 1];
            prior.text = attachFinal(prior.text, 'ㄴ'); prior.end = start + surface.length;
            pos = start + surface.length; previous = token; changed = true; continue;
          }
        } else value = convertEnglish(surface, target, dictionary);
        if (value !== surface) changed = true;
        units.push({ start, end: start + surface.length, text: value });
        pos = start + surface.length; previous = token;
        previousKana = kana && /^[ぁ-ゖァ-ヺー]+$/.test(kana) ? kana : null;
      }
      if (pos < text.length) units.push({ start: pos, end: text.length, text: text.slice(pos) });
    } else {
      const re = /[가-힣]+|[A-Za-z]+(?:['’][A-Za-z]+)*|[^가-힣A-Za-z]+/g;
      for (const match of text.matchAll(re)) {
        const value = /[가-힣]/.test(match[0]) ? convertKorean(match[0], target) : convertEnglish(match[0], target, dictionary);
        if (value !== match[0]) changed = true;
        units.push({ start: match.index, end: match.index + match[0].length, text: value });
      }
    }
    const result = valid && changed ? { line: units.map(part => part.text).join(''), segments: units } : { line: '', segments: [] };
    if (dictionary !== null && valid) {
      detailCache.set(key, result);
      while (detailCache.size > CACHE_LIMIT) detailCache.delete(detailCache.keys().next().value);
    }
    results.push(result);
  }
  return { lines: results.map(result => result.line), segments: results.map(result => result.segments) };
}
