import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/js/module/korean-pronunciation.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness({ stored = null, uiLang = 'ko' } = {}) {
  const requests = [], writes = [], nodes = [];
  class Element {
    constructor(className = '') { this.className = className; this.dataset = {}; this.children = []; this.textContent = ''; this.hidden = false; this.connected = true; this.ownerDocument = document; this.style = { setProperty(key, value) { this[key] = value; } }; this.classList = { add: name => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; }, remove: name => { this.className = this.className.split(' ').filter(x => x !== name).join(' '); } }; nodes.push(this); }
    get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
    appendChild(node) { this.children = this.children.filter(child => child !== node); this.children.push(node); node.parent = this; node.connected = true; }
    before(node) { const at = this.parent.children.indexOf(this); this.parent.children.splice(at, 0, node); node.parent = this.parent; }
    after(node) { const at = this.parent.children.indexOf(this); this.parent.children.splice(at + 1, 0, node); node.parent = this.parent; }
    setAttribute(name, value) { this[name] = value; }
    remove() { this.connected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { const name = selector.slice(1); return this.children.flatMap(child => [...(child.className.split(' ').includes(name) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  const document = { createElement: () => new Element(), querySelectorAll: selector => nodes.filter(node => node.isConnected && node.className.split(' ').includes(selector.slice(1))) };
  const context = vm.createContext({
    document, console, Promise, Set, Map, config: { uiLang },
    storage: { get: async () => stored, set: async (...args) => writes.push(args) },
    safeRuntimeSendMessage: message => { const task = deferred(); requests.push({ message, ...task }); return task.promise; },
  });
  vm.runInContext(`${source}\nthis.api = KoreanPronunciation`, context);
  function container(texts) {
    const host = new Element();
    for (const text of texts) {
      const row = new Element('lyric-line');
      const main = new Element('lyric-main'); main.textContent = text;
      row.appendChild(main); host.appendChild(row);
    }
    return host;
  }
  const uiSource = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8');
  const start = uiSource.indexOf('const syncTimedTextStage =');
  const end = uiSource.indexOf('function renderAnimatedTimedText', start);
  Object.assign(context, { getTimedTextCueStyle: () => '', getTimedTextSegmentHtml: () => '', animatedCaptionData: {} });
  vm.runInContext(`${uiSource.slice(start, end)}\nthis.syncTimedTextStage = syncTimedTextStage`, context);
  return { api: context.api, requests, writes, container, document, syncTimedTextStage: context.syncTimedTextStage };
}

test('enabled by default; original synchronized spans remain unchanged while readings load', async () => {
  const h = harness(); await h.api.load();
  const host = h.container(['hello', '안녕']);
  const originals = host.querySelectorAll('.lyric-main');
  h.api.decorate(host);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].message.type, 'GET_KOREAN_PRONUNCIATION');
  assert.deepEqual(Array.from(h.requests[0].message.payload.texts), ['hello']);
  assert.equal(host.querySelectorAll('.lyric-pronunciation').length, 1);
  assert.deepEqual(host.querySelectorAll('.lyric-main'), originals);
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  assert.equal(host.querySelector('.lyric-pronunciation').textContent, '헬로');
  assert.equal(originals[0].textContent, 'hello');
});

test('repeated chorus lines and PiP coalesce, then replay uses the line cache', async () => {
  const h = harness();
  const main = h.container(['hello', 'hello']); const pip = h.container(['hello', 'hello']);
  h.api.decorate(main); h.api.decorate(pip);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].message.payload.texts.length, 1);
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  for (const host of [main, pip]) assert.ok(host.querySelectorAll('.lyric-pronunciation').every(node => node.textContent === '헬로'));
  h.api.decorate(main);
  assert.equal(h.requests.length, 1);
  assert.equal(main.querySelectorAll('.lyric-pronunciation').length, 2);
});

test('detached old track and disabled subtitles cannot be restored by a late response', async () => {
  const h = harness(); const host = h.container(['hello']);
  h.api.decorate(host); const sub = host.querySelector('.lyric-pronunciation'); host.connected = false;
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  assert.equal(sub.textContent, '');
  const next = h.container(['world']); h.api.decorate(next);
  await h.api.setEnabled(false);
  h.requests[1].resolve({ success: true, lines: ['월드'] }); await flush();
  assert.equal(next.querySelectorAll('.lyric-pronunciation').length, 0);
  assert.deepEqual(h.writes, [['ytm_korean_pronunciation', false]]);
});

test('saved off preference makes no pronunciation requests', async () => {
  const h = harness({ stored: false }); await h.api.load();
  h.api.decorate(h.container(['hello']));
  assert.equal(h.requests.length, 0);
});

test('readings are literal text; neither markup nor unsupported lines become HTML', async () => {
  const h = harness(); const host = h.container(['hello <b>world</b>', '你好']); h.api.decorate(host);
  assert.equal(host.querySelectorAll('.lyric-pronunciation').length, 1);
  h.requests[0].resolve({ success: true, lines: ['헬로 <b>월드</b>'] }); await flush();
  const sub = host.querySelector('.lyric-pronunciation');
  assert.equal(sub.textContent, '헬로 <b>월드</b>'); assert.equal(sub.children.length, 0);
});

test('Japanese song context includes Han-only lines and preserves batch size bounds', () => {
  const h = harness(); const host = h.container(['ありがとう', '世界', ...Array.from({ length: 90 }, (_, i) => `hello ${i}`)]);
  h.api.decorate(host);
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(req => req.message.payload.japanese && req.message.payload.texts.length <= 80));
  assert.ok(h.requests.some(req => req.message.payload.texts.includes('世界')));
});

test('animated cue subtitles are separate from the caption text', async () => {
  const h = harness(); const cue = h.container([]);
  h.api.decorateCue(cue, 'hello', false);
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  assert.equal(cue.querySelector('.lyric-pronunciation').textContent, '헬로');
});

test('a failed pronunciation request leaves the original visible and can be retried', async () => {
  const h = harness(); const host = h.container(['hello']);
  h.api.decorate(host);
  h.requests[0].resolve({ success: false }); await flush();
  assert.equal(host.querySelector('.lyric-main').textContent, 'hello');
  assert.equal(host.querySelector('.lyric-pronunciation').hidden, true);
  h.api.decorate(host);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ success: true, lines: ['헬로'] }); await flush();
  assert.equal(host.querySelector('.lyric-pronunciation').textContent, '헬로');
});

test('reenabling pronunciation uses cached readings without another request', async () => {
  const h = harness(); const host = h.container(['hello']); h.api.decorate(host);
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  await h.api.setEnabled(false); await h.api.setEnabled(true); h.api.decorate(host);
  assert.equal(h.requests.length, 1);
  assert.equal(host.querySelector('.lyric-pronunciation').textContent, '헬로');
});


test('size persists, is clamped, and updates existing subtitles', async () => {
  const h = harness(); await h.api.load(); const host = h.container(['hello']); h.api.decorate(host);
  const sub = host.querySelector('.lyric-pronunciation');
  assert.equal(sub.style.fontSize, '20px');
  await h.api.setSize(28);
  assert.equal(sub.style.fontSize, '28px');
  assert.deepEqual(h.writes.at(-1), ['ytm_korean_pronunciation_size', 28]);
  await h.api.setSize(100); assert.equal(h.api.getSize(), 36);
});

test('synchronized reading follows progress and seeking backwards', async () => {
  const h = harness(); const host = h.container(['hello']); h.api.decorate(host);
  const row = host.querySelector('.lyric-line'); const sub = host.querySelector('.lyric-pronunciation');
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  h.api.paint(row, 0.75); assert.equal(sub.style['--pronunciation-progress'], '75%');
  h.api.paint(row, 0.2); assert.equal(sub.style['--pronunciation-progress'], '20%');
  assert.ok(sub.className.includes('lyric-pronunciation-sync'));
});


test('Japanese reading segments follow source character timestamps, including seeking', async () => {
  const h = harness(); const host = h.container(['東京へ行こう']); h.api.decorate(host);
  const row = host.querySelector('.lyric-line');
  h.requests[0].resolve({ success: true, lines: ['토쿄에이코우'], segments: [[
    { start: 0, end: 2, text: '토쿄' }, { start: 2, end: 3, text: '에' }, { start: 3, end: 6, text: '이코우' },
  ]] }); await flush();
  const sub = host.querySelector('.lyric-pronunciation');
  const spans = [
    { textContent: '東京', _times: [1, 1.4], _end: 2 },
    { textContent: 'へ', _times: [2], _end: 3 },
    { textContent: '行こう', _times: [3, 3.4, 3.8], _end: 4.2 },
  ];
  assert.equal(h.api.paintTimed(row, 2.5, spans), true);
  assert.equal(sub.children[0].style['--pronunciation-progress'], '100%');
  assert.equal(sub.children[1].style['--pronunciation-progress'], '50%');
  assert.equal(sub.children[2].style['--pronunciation-progress'], '0%');
  h.api.paintTimed(row, 1.5, spans);
  assert.equal(sub.children[0].style['--pronunciation-progress'], '50%');
  assert.equal(sub.children[1].style['--pronunciation-progress'], '0%');
});


test('reading breaks follow measured source lines and change on resize', async () => {
  const h = harness(); let split = 2, update;
  h.document.defaultView = { requestAnimationFrame: cb => cb(), ResizeObserver: class {
    constructor(callback) { update = callback; } observe(target) { this.target = target; } unobserve() {}
  } };
  h.document.createTreeWalker = main => { let done = false; return { nextNode: () => done ? null : (done = true, { data: main.textContent }) }; };
  h.document.createRange = () => ({ setStart(node, at) { this.at = at; }, setEnd() {}, getBoundingClientRect() { return { top: this.at >= split ? 20 : 0, height: 10 }; } });
  const host = h.container(['君の名前を呼ぶ']); h.api.decorate(host);
  h.requests[0].resolve({ success: true, lines: ['키미노 나마에오 요부'], segments: [[
    { start: 0, end: 1, text: '키미' }, { start: 1, end: 2, text: '노 ' },
    { start: 2, end: 4, text: '나마에' }, { start: 4, end: 5, text: '오 ' }, { start: 5, end: 7, text: '요부' },
  ]] }); await flush();
  const sub = host.querySelector('.lyric-pronunciation'), main = host.querySelector('.lyric-main');
  assert.equal(sub.children.findIndex(child => child.className === 'lyric-pronunciation-break'), 2);
  split = 5; update([{ target: main }]);
  assert.equal(sub.children.findIndex(child => child.className === 'lyric-pronunciation-break'), 4);
});


test('display language selects reading target and Chinese never sends lyric text', async () => {
  for (const target of ['ko', 'ja', 'en']) {
    const h = harness({ uiLang: target }); const host = h.container([target === 'ko' ? 'hello' : '사랑해']);
    h.api.decorate(host);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].message.payload.target, target);
    assert.equal(host.querySelector('.lyric-pronunciation').lang, target);
  }
  const h = harness({ uiLang: 'zh' }); h.api.decorate(h.container(['hello', '사랑해', 'こんにちは']));
  assert.equal(h.requests.length, 0);
});

test('rows already written in display language do not request a reading', () => {
  for (const [uiLang, text] of [['ko', '사랑해'], ['ja', 'こんにちは'], ['en', 'hello']]) {
    const h = harness({ uiLang }); const host = h.container([text]); h.api.decorate(host);
    assert.equal(h.requests.length, 0); assert.equal(host.querySelector('.lyric-pronunciation'), null);
  }
});


test('prefetched readings are applied when a new animated cue attaches', async () => {
  const h = harness(); h.api.prepare(['hello']);
  h.requests[0].resolve({ success: true, lines: ['헬로'] }); await flush();
  const create = h.document.createElement;
  h.document.createElement = tag => { const node = create(tag); node.connected = false; return node; };
  const stage = h.container([]);
  h.syncTimedTextStage(stage, [{ id: 1, text: 'hello' }]);
  assert.equal(stage.querySelector('.lyric-pronunciation').textContent, '헬로');
  assert.equal(h.requests.length, 1);
  const cue = stage.children[0];
  h.syncTimedTextStage(stage, [{ id: 1, text: 'hello' }]);
  assert.equal(stage.children[0], cue);
  assert.equal(cue.querySelectorAll('.lyric-pronunciation').length, 1);
});

test('caption prefetch skips same-language rows and preserves mixed-script readings', () => {
  for (const [uiLang, own, foreign] of [['ja', 'こんにちは', '사랑해'], ['en', 'hello', 'こんにちは'], ['ko', '안녕', 'hello']]) {
    const h = harness({ uiLang });
    h.api.prepare([own]); assert.equal(h.requests.length, 0);
    h.api.prepare([own, foreign, foreign, `${own} ${foreign}`]);
    assert.deepEqual(Array.from(h.requests[0].message.payload.texts), [foreign, `${own} ${foreign}`]);
  }
  const h = harness({ uiLang: 'zh' }); h.api.prepare(['hello', 'こんにちは']);
  assert.equal(h.requests.length, 0);
});

test('out-of-order batches update every repeated main and PiP row once', async () => {
  const h = harness();
  const texts = [...Array.from({ length: 165 }, (_, i) => `hello ${i}`), 'hello 0', 'hello 164'];
  const main = h.container(texts), pip = h.container(texts);
  h.api.decorate(main); h.api.decorate(pip);
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests.map(request => request.message.payload.texts.length), [80, 80, 5]);
  for (const request of [...h.requests].reverse()) {
    request.resolve({ success: true, lines: request.message.payload.texts.map(text => `발음 ${text}`) });
    await flush();
  }
  for (const host of [main, pip]) {
    assert.deepEqual(host.querySelectorAll('.lyric-pronunciation').map(node => node.textContent), texts.map(text => `발음 ${text}`));
  }
});
