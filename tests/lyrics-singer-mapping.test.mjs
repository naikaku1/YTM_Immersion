import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  fetchLrchubSingerMetadata,
  normalizeLrchubLyricsResponse,
  normalizeLrchubSingerMetadata,
} from '../src/js/module/api.js'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const namespaceSource = fs.readFileSync(
  new URL('../src/js/module/namespace.js', import.meta.url),
  'utf8',
)
const styleSource = fs.readFileSync(
  new URL('../src/css/style.css', import.meta.url),
  'utf8',
)

const helperStart = lyricsUiSource.indexOf('const parseLRCInternal')
const helperEnd = lyricsUiSource.indexOf('// ===== duet helpers =====', helperStart)
assert.notEqual(helperStart, -1, 'LRC parser must be present')
assert.notEqual(helperEnd, -1, 'singer helper boundary must be present')
const helperSource = lyricsUiSource.slice(helperStart, helperEnd)

class FakeClassList {
  constructor() {
    this.values = new Set()
  }

  add(...names) {
    names.forEach(name => this.values.add(name))
  }

  contains(name) {
    return this.values.has(name)
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force)
    if (enabled) this.values.add(name)
    else this.values.delete(name)
    return enabled
  }
}

class FakeStyle {
  constructor() {
    this.values = new Map()
  }

  getPropertyValue(name) {
    return this.values.get(name) || ''
  }

  removeProperty(name) {
    this.values.delete(name)
  }

  setProperty(name, value) {
    this.values.set(name, String(value))
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || '').toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.classList = new FakeClassList()
    this.className = ''
    this.dataset = {}
    this.style = new FakeStyle()
    this.textContent = ''
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }
}

function createSingerHarness() {
  const document = {
    createElement(tagName) {
      return new FakeElement(tagName, document)
    },
  }
  const context = { document }
  vm.runInNewContext(`
    ${helperSource}
    globalThis.singerTestApi = {
      parseLRCInternal,
      normalizeSingerNumber,
      normalizeSingerColor,
      hasSingerDisplayMetadata,
      applySingerMetadataToLines,
      applySingerMetadataToRow,
    };
  `, context, { filename: 'lyrics-singer-helpers.js' })

  return {
    ...context.singerTestApi,
    createRow() {
      const row = document.createElement('div')
      row.classList.add('lyric-line')
      const main = document.createElement('span')
      main.className = 'lyric-main'
      row.appendChild(main)
      return row
    },
  }
}

test('LRC parsing keeps the physical singer-assignment index', () => {
  const { parseLRCInternal } = createSingerHarness()
  const timed = parseLRCInternal([
    '[ar:Metadata does not count]',
    '[00:01.00][00:02.00] Echo',
    '',
    'untimed text does not count',
    '[00:03.00] Final',
  ].join('\n'))

  assert.equal(timed.hasTs, true)
  assert.deepEqual(Array.from(timed.lines, line => line.time), [1, 2, 3])
  assert.deepEqual(
    Array.from(timed.lines, line => line.source_index),
    [0, 0, 1],
    'all timestamp expansions from one physical timed row must share its assignment',
  )

  const plain = parseLRCInternal('First\n\nThird\n')
  assert.equal(plain.hasTs, false)
  assert.deepEqual(Array.from(plain.lines, line => line.text), ['First', '', 'Third', ''])
  assert.deepEqual(
    Array.from(plain.lines, line => line.source_index),
    [0, 1, 2, 3],
    'blank and trailing plain rows must keep their physical indexes',
  )
})

test('physical assignments drive parity, safe colors, and text-only artist labels', () => {
  const api = createSingerHarness()
  const parsed = api.parseLRCInternal(
    '[00:01.00][00:02.00] Echo\n[00:03.00] Final',
  )
  const metadata = {
    singer_count: 2,
    line_singers: [2, 3],
    singers: {
      2: {
        artist_name: '<img src=x onerror=globalThis.pwned=true>',
        color: 'url(javascript:alert(1))',
      },
      3: { artist_name: 'Artist Three', color: '#12abEf' },
    },
  }
  const lines = api.applySingerMetadataToLines(parsed.lines, metadata)
  const rows = lines.map((line) => {
    const row = api.createRow()
    api.applySingerMetadataToRow(row, line, metadata)
    return row
  })

  assert.deepEqual(Array.from(lines, line => line.singerNumber), [2, 2, 3])
  assert.deepEqual(Array.from(rows, row => row.dataset.singerNumber), ['2', '2', '3'])
  assert.equal(rows[0].classList.contains('singer-even'), true)
  assert.equal(rows[1].classList.contains('singer-even'), true)
  assert.equal(rows[2].classList.contains('singer-odd'), true)
  assert.equal(rows[0].classList.contains('singer-odd'), false)
  assert.equal(rows[2].classList.contains('singer-even'), false)

  assert.equal(lines[0].singerColor, '')
  assert.equal('singerColor' in rows[0].dataset, false)
  assert.equal(rows[0].style.getPropertyValue('--ytm-singer-color'), '')
  assert.equal(lines[2].singerColor, '#12ABEF')
  assert.equal(rows[2].dataset.singerColor, '#12ABEF')
  assert.equal(rows[2].style.getPropertyValue('--ytm-singer-color'), '#12ABEF')

  const unsafeLabel = rows[0].children.at(-1)
  assert.equal(unsafeLabel.className, 'lyric-singer-name')
  assert.equal(
    unsafeLabel.textContent,
    '<img src=x onerror=globalThis.pwned=true>',
    'artist metadata must be inserted as text rather than HTML',
  )
  assert.equal(globalThis.pwned, undefined)
})

test('alternate lyric views remap by normalized line text without consuming later matches', () => {
  const api = createSingerHarness()
  const metadata = {
    line_singers: [1, 2, 3],
    singers: {},
  }
  const canonicalLines = [
    { text: 'Verse', source_index: 0 },
    { text: 'Dynamic only', source_index: 1 },
    { text: 'Chorus', source_index: 2 },
  ]
  const displayedLines = [
    { text: 'Synced only', source_index: 0 },
    { text: 'Chorus', source_index: 1 },
  ]
  const mapped = api.applySingerMetadataToLines(displayedLines, metadata, {
    canonicalLines,
    sameSource: false,
  })

  assert.deepEqual(
    Array.from(mapped, line => line.singerNumber),
    [1, 3],
    'index fallback must not steal a canonical line that has a later exact match',
  )
})

test('plain outer blanks keep API singer indexes without creating label-only rows', () => {
  const api = createSingerHarness()
  const raw = '\nLead\n\nTail\n'
  const normalized = normalizeLrchubLyricsResponse({ plain_lyrics: raw })
  assert.equal(normalized.lyrics, raw)

  const parsed = api.parseLRCInternal(normalized.lyrics)
  const metadata = {
    line_count: 5,
    line_singers: [2, 2, 1, 1, 2],
    singers: {
      1: { artist_name: 'Singer One', color: '#112233' },
      2: { artist_name: 'Singer Two', color: '#445566' },
    },
  }
  const mapped = api.applySingerMetadataToLines(parsed.lines, metadata, {
    canonicalLines: parsed.lines,
    sameSource: true,
  })
  assert.deepEqual(Array.from(mapped, line => line.singerNumber), [2, 2, 1, 1, 2])

  const blankRows = mapped
    .filter(line => !line.text)
    .map((line) => {
      const row = api.createRow()
      api.applySingerMetadataToRow(row, line, metadata)
      return row
    })
  assert.equal(blankRows.every(row => row.children.length === 1), true)

  const leadRow = api.createRow()
  api.applySingerMetadataToRow(leadRow, mapped[1], metadata)
  assert.equal(leadRow.children.at(-1).textContent, 'Singer Two')
})

test('one configured even-numbered singer still uses right alignment, color, and name', () => {
  const api = createSingerHarness()
  const parsed = api.parseLRCInternal('First\nSecond')
  const metadata = {
    singer_count: 1,
    line_count: 2,
    line_singers: [2, 2],
    singers: { 2: { artist_name: 'Solo Two', color: '#6699ff' } },
  }
  assert.equal(api.hasSingerDisplayMetadata(metadata), true)
  const mapped = api.applySingerMetadataToLines(parsed.lines, metadata, {
    canonicalLines: parsed.lines,
  })
  const firstRow = api.createRow()
  api.applySingerMetadataToRow(firstRow, mapped[0], metadata)
  assert.equal(firstRow.classList.contains('singer-even'), true)
  assert.equal(firstRow.dataset.singerColor, '#6699FF')
  assert.equal(firstRow.children.at(-1).textContent, 'Solo Two')
})

test('a stale singer line count is not applied to a different lyric revision', () => {
  const api = createSingerHarness()
  const parsed = api.parseLRCInternal('First\nSecond')
  const mapped = api.applySingerMetadataToLines(parsed.lines, {
    line_count: 3,
    line_singers: [2, 1, 2],
    singers: {},
  }, { canonicalLines: parsed.lines })
  assert.equal(api.hasSingerDisplayMetadata({
    line_count: 3,
    line_singers: [2, 1, 2],
    singers: {},
  }, parsed.lines), false)
  assert.equal(mapped.every(line => line.singerNumber === undefined), true)
})

test('API normalization and no-record fetch keep unsafe data and unnecessary requests out', async () => {
  const normalized = normalizeLrchubSingerMetadata({
    ok: true,
    line_count: 2,
    line_singers: [false, 2.5],
    singers: {
      1: { artist_name: 'One', color: '#abcdef' },
      2: { artist_name: 'Two', color: 'var(--host-color)' },
    },
  })
  assert.deepEqual(normalized.line_singers, [1, 1])
  assert.equal(normalized.singers['1'].color, '#ABCDEF')
  assert.equal(normalized.singers['2'].color, '')

  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('fetch must not run without record_id')
  }
  try {
    assert.equal(await fetchLrchubSingerMetadata({ video_id: 'video-only' }), null)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(fetchCalls, 0)
})

test('the color preference is persisted and gates custom-color CSS', () => {
  assert.match(namespaceSource, /useSingerColors:\s*true/)
  assert.match(lyricsUiSource, /storage\.get\('ytm_singer_colors_enabled'\)/)
  assert.match(
    lyricsUiSource,
    /storage\.set\('ytm_singer_colors_enabled',\s*config\.useSingerColors\)/,
  )
  assert.match(
    lyricsUiSource,
    /classList\.toggle\('ytm-singer-colors-enabled',\s*!!config\.useSingerColors\)/,
  )
  assert.match(
    styleSource,
    /body\.ytm-singer-colors-enabled\s+\.lyric-line\[data-singer-color\]/,
  )
})
