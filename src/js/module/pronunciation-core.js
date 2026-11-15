// Local, approximate Korean readings. This is pronunciation, never translation.
// Unknown words/scripts remain intact rather than inventing a reading.
const INITIAL = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWEL = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINAL = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const syllable = (initial, vowel) => String.fromCharCode(0xAC00 + INITIAL.indexOf(initial) * 588 + VOWEL.indexOf(vowel) * 28);
export const attachFinal = (text, final) => {
  if (!text) return ({ 'ㄴ': '은', 'ㅁ': '음', 'ㅇ': '응', 'ㄹ': '을', 'ㄱ': '으크', 'ㅅ': '읏', 'ㅂ': '읍' }[final] || '');
  const at = text.length - 1;
  const code = text.charCodeAt(at) - 0xAC00;
  if (code < 0 || code >= 11172 || code % 28) return text + ({ 'ㄴ': '은', 'ㅁ': '음', 'ㅇ': '응', 'ㄹ': '을', 'ㄱ': '으크', 'ㅅ': '읏', 'ㅂ': '읍' }[final] || '');
  return text.slice(0, at) + String.fromCharCode(text.charCodeAt(at) + FINAL.indexOf(final));
};

// Common lyric words use familiar Korean spellings rather than a literal
// phoneme transcription (CMUdict's hello /həloʊ/ would otherwise be 허로우).
const EN_COMMON = Object.freeze({
  hello: '헬로', hi: '하이', hey: '헤이', yeah: '예', oh: '오', ooh: '우',
  love: '러브', loves: '러브스', loved: '러브드', loving: '러빙', lover: '러버',
  you: '유', your: '유어', yours: '유어스', yourself: '유어셀프',
  i: '아이', "i'm": '아임', "i'll": '아일', "i've": '아이브', "i'd": '아이드',
  me: '미', my: '마이', mine: '마인', we: '위', our: '아워', us: '어스',
  "you're": '유어', "you'll": '유윌', "you've": '유브', "we're": '위어',
  a: '어', an: '언', the: '더', to: '투', of: '오브', and: '앤드',
  in: '인', on: '온', it: '잇', is: '이즈', this: '디스', that: '댓',
  baby: '베이비', babe: '베이브', boy: '보이', girl: '걸',
  beautiful: '뷰티풀', beauty: '뷰티', world: '월드', heart: '하트',
  night: '나이트', tonight: '투나이트', light: '라이트', right: '라이트',
  time: '타임', life: '라이프', dream: '드림', dreams: '드림스',
  forever: '포에버', together: '투게더', never: '네버', ever: '에버',
  always: '올웨이즈', again: '어게인', away: '어웨이', stay: '스테이',
  want: '원트', wanna: '워너', gonna: '거너', gotta: '가러',
  know: '노', no: '노', now: '나우', go: '고', so: '소',
  all: '올', for: '포', with: '위드', without: '위다웃',
  "don't": '돈트', "can't": '캔트', "won't": '원트',
  say: '세이', see: '시', feel: '필', feeling: '필링',
  dance: '댄스', music: '뮤직', sing: '싱', song: '송',
  happy: '해피', tears: '티어스', kiss: '키스', miss: '미스',
});
const EN_VOWELS = { AA: '아', AE: '애', AH: '어', AO: '오', AW: '아우', AY: '아이', EH: '에', ER: '어', EY: '에이', IH: '이', IY: '이', OW: '오', OY: '오이', UH: '우', UW: '우' };
const EN_INITIALS = { B: 'ㅂ', CH: 'ㅊ', D: 'ㄷ', DH: 'ㄷ', F: 'ㅍ', G: 'ㄱ', HH: 'ㅎ', JH: 'ㅈ', K: 'ㅋ', L: 'ㄹ', M: 'ㅁ', N: 'ㄴ', NG: 'ㅇ', P: 'ㅍ', R: 'ㄹ', S: 'ㅅ', SH: 'ㅅ', T: 'ㅌ', TH: 'ㅅ', V: 'ㅂ', Z: 'ㅈ', ZH: 'ㅈ' };
const EN_CODA = { L: 'ㄹ', M: 'ㅁ', N: 'ㄴ', NG: 'ㅇ' };
const EN_EXTRA = { B: '브', CH: '치', D: '드', DH: '드', F: '프', G: '그', HH: '흐', JH: '지', K: '크', L: '르', M: '므', N: '느', NG: '응', P: '프', R: '어', S: '스', SH: '시', T: '트', TH: '스', V: '브', W: '우', Y: '이', Z: '즈', ZH: '지' };
const GLIDE = {
  Y: { '아': '야', '애': '얘', '어': '여', '에': '예', '오': '요', '우': '유', '이': '이' },
  W: { '아': '와', '애': '왜', '어': '워', '에': '웨', '오': '워', '우': '우', '이': '위' },
};

export function arpabetToHangul(raw) {
  const phones = String(raw || '').replace(/[012]/g, '').split(/\s+/).filter(Boolean);
  let out = '', pending = '';
  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    if (EN_VOWELS[phone]) {
      let vowel = EN_VOWELS[phone];
      let glide = '';
      if (pending.endsWith(' Y') || pending === 'Y') glide = 'Y';
      if (pending.endsWith(' W') || pending === 'W') glide = 'W';
      const consonants = pending.split(' ').filter(Boolean);
      if (glide) { consonants.pop(); vowel = (GLIDE[glide][vowel[0]] || vowel[0]) + vowel.slice(1); }
      const onset = consonants.pop();
      for (const c of consonants) out += EN_EXTRA[c] || '';
      let initial = EN_INITIALS[onset] || 'ㅇ';
      if (onset === 'SH' || onset === 'ZH') vowel = (GLIDE.Y[vowel[0]] || vowel[0]) + vowel.slice(1);
      // Combine the onset with the vowel's first syllable; preserve diphthongs.
      const firstCode = vowel.charCodeAt(0) - 0xAC00;
      out += syllable(initial, VOWEL[Math.floor((firstCode % 588) / 28)]) + vowel.slice(1);
      pending = '';
    } else if (phone === 'R' && out && EN_VOWELS[phones[i - 1]] && !EN_VOWELS[phones[i + 1]]) {
      // Post-vocalic r is expressed by the preceding vowel in Korean spelling.
    } else if (['K', 'P', 'T'].includes(phone) && out && !pending &&
      ['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH'].includes(phones[i - 1]) && !EN_VOWELS[phones[i + 1]]) {
      out = attachFinal(out, { K: 'ㄱ', P: 'ㅂ', T: 'ㅅ' }[phone]);
    } else if (EN_CODA[phone] && out && !EN_VOWELS[phones[i + 1]] && !pending) {
      out = attachFinal(out, EN_CODA[phone]);
    } else {
      pending += (pending ? ' ' : '') + phone;
    }
  }
  for (const c of pending.split(' ').filter(Boolean)) out += EN_EXTRA[c] || '';
  return out;
}

export function englishToHangul(text, dictionary = {}) {
  let changed = false;
  const reading = String(text || '').replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, word => {
    const key = word.toLowerCase().replace(/’/g, "'");
    const value = Object.hasOwn(EN_COMMON, key) ? EN_COMMON[key]
      : Object.hasOwn(dictionary, key) ? arpabetToHangul(dictionary[key]) : '';
    if (value) changed = true;
    return value || word;
  });
  return changed ? reading : '';
}

const KANA = new Map();
for (const [kana, korean] of [
  ['アイウエオ', ['아', '이', '우', '에', '오']],
  ['カキクケコ', ['카', '키', '쿠', '케', '코']],
  ['ガギグゲゴ', ['가', '기', '구', '게', '고']],
  ['サシスセソ', ['사', '시', '스', '세', '소']],
  ['ザジズゼゾ', ['자', '지', '즈', '제', '조']],
  ['タチツテト', ['타', '치', '쓰', '테', '토']],
  ['ダヂヅデド', ['다', '지', '즈', '데', '도']],
  ['ナニヌネノ', ['나', '니', '누', '네', '노']],
  ['ハヒフヘホ', ['하', '히', '후', '헤', '호']],
  ['バビブベボ', ['바', '비', '부', '베', '보']],
  ['パピプペポ', ['파', '피', '푸', '페', '포']],
  ['マミムメモ', ['마', '미', '무', '메', '모']],
  ['ヤユヨ', ['야', '유', '요']],
  ['ラリルレロ', ['라', '리', '루', '레', '로']],
  ['ワヰヱヲヴ', ['와', '이', '에', '오', '부']],
  ['ァィゥェォャュョヮ', ['아', '이', '우', '에', '오', '야', '유', '요', '와']],
]) [...kana].forEach((ch, i) => KANA.set(ch, korean[i]));
for (const [base, initial] of Object.entries({ キ: 'ㅋ', ギ: 'ㄱ', シ: 'ㅅ', ジ: 'ㅈ', チ: 'ㅊ', ニ: 'ㄴ', ヒ: 'ㅎ', ビ: 'ㅂ', ピ: 'ㅍ', ミ: 'ㅁ', リ: 'ㄹ' })) {
  for (const [small, vowel] of Object.entries({ ャ: 'ㅑ', ュ: 'ㅠ', ョ: 'ㅛ', ェ: 'ㅖ' })) KANA.set(base + small, syllable(initial, vowel));
}
for (const [kana, reading] of Object.entries({ ティ: '티', ディ: '디', トゥ: '투', ドゥ: '두', ファ: '파', フィ: '피', フェ: '페', フォ: '포', ウィ: '위', ウェ: '웨', ウォ: '워', ヴァ: '바', ヴィ: '비', ヴェ: '베', ヴォ: '보', ツァ: '차', ツィ: '치', ツェ: '체', ツォ: '초' })) KANA.set(kana, reading);

export function kanaToHangul(text) {
  const kana = String(text || '').normalize('NFKC').replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  let out = '';
  for (let i = 0; i < kana.length; i++) {
    const ch = kana[i];
    if (ch === 'ー') continue;
    if (ch === 'ン') { out = attachFinal(out, 'ㄴ'); continue; }
    if (ch === 'ッ') {
      const next = kana[i + 1] || '';
      out = attachFinal(out, /[カキクケコガギグゲゴ]/.test(next) ? 'ㄱ' : /[パピプペポバビブベボ]/.test(next) ? 'ㅂ' : 'ㅅ');
      continue;
    }
    const pair = KANA.get(kana.slice(i, i + 2));
    if (pair) { out += pair; i++; } else out += KANA.get(ch) || ch;
  }
  return out;
}

export function japaneseToHangul(text, tokenizer, dictionary = {}) {
  const tokens = tokenizer.tokenize(String(text || ''));
  let changed = false;
  const reading = tokens.map(token => {
    const surface = token.surface_form;
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(surface)) {
      const kana = token.pronunciation || token.reading || surface;
      const converted = kanaToHangul(kana);
      if (converted !== surface) changed = true;
      return converted;
    }
    const english = englishToHangul(surface, dictionary);
    if (english) changed = true;
    return english || surface;
  }).join('');
  return changed ? reading : '';
}
