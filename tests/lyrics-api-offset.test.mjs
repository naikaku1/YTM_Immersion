import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
}

const apiSource = fs.readFileSync(
  new URL('../src/js/module/api.js', import.meta.url),
  'utf8',
)
const api = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString('base64')}`)

const VIDEO_A = 'aaaaaaaaaaa'
const VIDEO_B = 'bbbbbbbbbbb'

const sha256 = value => createHash('sha256').update(String(value), 'utf8').digest('hex')

async function withMockFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  try {
    return await callback()
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = originalFetch
  }
}

async function withCryptoReplacement(value, callback) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: originalDescriptor?.enumerable ?? true,
    value,
    writable: true,
  })
  try {
    return await callback()
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'crypto', originalDescriptor)
    else delete globalThis.crypto
  }
}

test('main /api/lyrics response is not offset a second time', async () => {
  await withMockFetch(
    async () => ({
      ok: true,
      async json() {
        return {
          video_id: VIDEO_A,
          offset_ms: 2000,
          synced_lyrics: '[00:12.000] Already shifted',
          lrc_map: { ja: '[00:10.000] Translation still canonical' },
          provider_meta: {
            video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
          },
        }
      },
    }),
    async () => {
      const result = await api.fetchFromLrchub({
        track: 'Song',
        artist: 'Artist',
        video_id: VIDEO_A,
      })

      assert.equal(result.lyrics, '[00:12.000] Already shifted')
      assert.equal(result.synced_lyrics, '[00:12.000] Already shifted')
      assert.equal(result.offset_ms, 2000)
      assert.equal(result.lrcMap.ja, '[00:12.000] Translation still canonical')
    },
  )
})

test('raw lyrics use the exact video positive offset', () => {
  const result = api.normalizeLrchubLyricsResponse(
    {
      synced_lyrics: '[00:10.000] Line',
      dynamic_lrc: '[00:10.000]<00:10.500>A',
      provider_meta: {
        video_links: [
          { video_id: VIDEO_A, offset_ms: 2000 },
          { video_id: VIDEO_B, offset_ms: 500 },
        ],
      },
    },
    { videoId: VIDEO_A, applyVideoOffset: true },
  )

  assert.equal(result.synced_lyrics, '[00:12.000] Line')
  assert.equal(result.dynamic_lrc, '[00:12.000]<00:12.500>A')
  assert.equal(result.offset_ms, 2000)
})

test('raw lyrics apply negative offsets and clamp timestamps at zero', () => {
  const result = api.normalizeLrchubLyricsResponse(
    {
      dynamic_lrc: '[00:01.00]<00:00.50>A',
      video_links: [{ video_id: VIDEO_A, offset_ms: -1000 }],
    },
    { videoId: VIDEO_A, applyVideoOffset: true },
  )

  assert.equal(result.dynamic_lrc, '[00:00.00]<00:00.00>A')
  assert.equal(result.offset_ms, -1000)
  assert.equal(result.dynamicLines[0].startTimeMs, 0)
  assert.equal(result.dynamicLines[0].chars[0].t, 0)
})

test('a video mismatch never borrows another video offset', () => {
  const payload = {
    video_id: VIDEO_A,
    offset_ms: 2000,
    synced_lyrics: '[00:10.000] Line',
    video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
  }

  assert.equal(api.getLrchubVideoOffsetMs(payload, VIDEO_B), 0)
  const result = api.normalizeLrchubLyricsResponse(payload, {
    videoId: VIDEO_B,
    applyVideoOffset: true,
  })
  assert.equal(result.lyrics, '[00:10.000] Line')
  assert.equal(result.offset_ms, 0)
})

test('an identity-free direct offset is not borrowed for a requested video', () => {
  const payload = {
    offset_ms: 2000,
    synced_lyrics: '[00:10.000] Line',
  }

  assert.equal(api.getLrchubVideoOffsetMs(payload, VIDEO_A), 0)
  assert.equal(
    api.normalizeLrchubLyricsResponse(payload, {
      videoId: VIDEO_A,
      applyVideoOffset: true,
    }).lyrics,
    '[00:10.000] Line',
  )
})

test('video link maps are normalized and applied to the matching video', () => {
  const payload = {
    synced_lyrics: '[00:10.000] Line',
    provider_meta: {
      video_links: {
        [VIDEO_A]: { offset_ms: 1500 },
        [VIDEO_B]: -500,
      },
    },
  }

  assert.equal(api.getLrchubVideoOffsetMs(payload, VIDEO_A), 1500)
  assert.equal(api.getLrchubVideoOffsetMs(payload, VIDEO_B), -500)
  assert.equal(
    api.normalizeLrchubLyricsResponse(payload, {
      videoId: VIDEO_A,
      applyVideoOffset: true,
    }).lyrics,
    '[00:11.500] Line',
  )
})

test('nested record.record_id fetches and normalizes the selected record', async () => {
  let requestedUrl = ''
  await withMockFetch(
    async (url) => {
      requestedUrl = String(url)
      return {
        ok: true,
        async json() {
          return {
            record: {
              record_id: 'nested-record-42',
              synced_lyrics: '[00:10.000] Candidate',
              video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
            },
          }
        },
      }
    },
    async () => {
      const candidate = {
        record: {
          record_id: 'nested-record-42',
          synced_lyrics: '[00:10.000] Truncated preview',
        },
      }
      assert.equal(api.getLrchubRecordId(candidate), 'nested-record-42')

      const result = await api.fetchLrchubCandidateLyrics(candidate, null, VIDEO_A)
      assert.equal(new URL(requestedUrl).searchParams.get('record_id'), 'nested-record-42')
      assert.equal(result.lyrics, '[00:12.000] Candidate')
      assert.equal(result.offset_ms, 2000)
    },
  )
})

test('a search preview is used only when its full record cannot be loaded', async () => {
  await withMockFetch(
    async () => ({
      ok: true,
      async json() {
        return null
      },
    }),
    async () => {
      const result = await api.fetchLrchubCandidateLyrics(
        {
          record_id: 'missing-record',
          synced_lyrics: '[00:10.000] Preview fallback',
          video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
        },
        null,
        VIDEO_A,
      )
      assert.equal(result.lyrics, '[00:12.000] Preview fallback')
    },
  )
})

test('dynamic object aliases are normalized to renderer c/t fields before shifting', () => {
  const result = api.normalizeLrchubLyricsResponse(
    {
      dynamic_lyrics: [{
        start_ms: 10000,
        endTime: 11000,
        chars: [
          { char: '一', startTimeMs: 10000 },
          { text: '文', time: 10500 },
        ],
      }],
      video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
    },
    { videoId: VIDEO_A, applyVideoOffset: true },
  )

  assert.equal(result.lyrics, '[00:12.00] 一文')
  assert.equal(result.dynamicLines[0].startTimeMs, 12000)
  assert.equal(result.dynamicLines[0].endTimeMs, 13000)
  assert.deepEqual(
    result.dynamicLines[0].chars.map(({ c, t }) => ({ c, t })),
    [
      { c: '一', t: 12000 },
      { c: '文', t: 12500 },
    ],
  )
})

test('timed translations shift together with the base lyrics', () => {
  const result = api.normalizeLrchubLyricsResponse(
    {
      synced_lyrics: '[00:10.000] Original',
      lrc_map: {
        ja: '[00:10.000]翻訳',
      },
      translations: {
        en: { synced_lyrics: '[00:10.000] Translation' },
      },
      video_links: [{ video_id: VIDEO_A, offset_ms: 2000 }],
    },
    { videoId: VIDEO_A, applyVideoOffset: true },
  )

  assert.equal(result.lyrics, '[00:12.000] Original')
  assert.equal(result.lrcMap.ja, '[00:12.000]翻訳')
  assert.equal(result.lrcMap.en, '[00:12.000] Translation')
})

test('unflagged animated lyrics stay on their original timeline', () => {
  const animated = '<timedtext><body><p t="1000" d="500">Hi</p></body></timedtext>'
  const result = api.normalizeLrchubLyricsResponse(
    {
      animated_lyrics: animated,
      provider_meta: {
        video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
      },
    },
    { videoId: VIDEO_A, applyVideoOffset: true },
  )

  assert.equal(result.animated_lyrics, animated)
  assert.equal(result.lyrics, animated)
  assert.equal(result.offset_ms, 1200)
})

test('raw flagged animated lyrics shift only after their payload hash is verified', async () => {
  const animated = '<timedtext><body><p t="1000" d="500"><s t="120">Hi</s></p></body></timedtext>'
  const result = await api.fetchLrchubCandidateLyrics(
    {
      animated_lyrics: animated,
      provider_meta: {
        video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(animated),
      },
    },
    null,
    VIDEO_A,
  )

  assert.match(result.animated_lyrics, /<p t="2200" d="500">/)
  assert.match(result.animated_lyrics, /<s t="120">Hi<\/s>/)
  assert.equal(result.lyrics, result.animated_lyrics)
  assert.equal(result._ytmAnimatedOffsetAppliedForVideoId, VIDEO_A)
  assert.equal(result._ytmAnimatedOffsetAppliedMs, 1200)
})

test('verified animated lyrics with outer blank lines still shift the selected lyrics', async () => {
  const animated = '\n<timedtext><body><p t="1000" d="500">Hi</p></body></timedtext>\n'
  const result = await api.normalizeRawLrchubLyricsForVideo(
    {
      animated_lyrics: animated,
      provider_meta: {
        video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(animated),
      },
    },
    VIDEO_A,
  )

  assert.match(result.animated_lyrics, /<p t="2200" d="500">/)
  assert.equal(result.lyrics, result.animated_lyrics)
})

test('an animated payload with a mismatched hash remains unchanged', async () => {
  const animated = '<timedtext><body><p t="1000">Hi</p></body></timedtext>'
  const result = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: animated,
      animated_lyrics: animated,
      provider_meta: {
        video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(`${animated} changed`),
      },
    },
    VIDEO_A,
  )

  assert.equal(result.animated_lyrics, animated)
  assert.equal(result.lyrics, animated)
  assert.equal(result._ytmAnimatedOffsetAppliedForVideoId, undefined)
})

test('unflagged LRC-shaped animated lyrics bypass the generic lyrics shift', async () => {
  const animated = '[00:01.00]<00:01.20>A'
  const result = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: animated,
      animated_lyrics: animated,
      video_links: [{ video_id: VIDEO_A, offset_ms: 1000 }],
    },
    VIDEO_A,
  )

  assert.equal(result.animated_lyrics, animated)
  assert.equal(result.lyrics, animated)

  const padded = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: animated,
      animated_lyrics: `  ${animated}\n`,
      video_links: [{ video_id: VIDEO_A, offset_ms: 1000 }],
    },
    VIDEO_A,
  )
  assert.equal(padded.lyrics, animated)
  assert.equal(padded.animated_lyrics, animated)
})

test('flagged animated lyrics do not borrow an exact offset from another video', async () => {
  const animated = '<timedtext><body><p t="1000">Hi</p></body></timedtext>'
  const result = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: animated,
      animated_lyrics: animated,
      provider_meta: {
        video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(animated),
      },
    },
    VIDEO_B,
  )

  assert.equal(result.animated_lyrics, animated)
  assert.equal(result.lyrics, animated)
  assert.equal(result.offset_ms, 0)
})

test('main /api/lyrics keeps server-shifted animated lyrics on their current timeline', async () => {
  const canonical = '<timedtext><body><p t="1000">Hi</p></body></timedtext>'
  const shifted = '<timedtext><body><p t="2200">Hi</p></body></timedtext>'
  await withMockFetch(
    async () => ({
      ok: true,
      async json() {
        return {
          video_id: VIDEO_A,
          offset_ms: 1200,
          lyrics: shifted,
          animated_lyrics: shifted,
          provider_meta: {
            video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
            animated_lyrics_offset_normalized: true,
            animated_lyrics_offset_normalized_hash: sha256(canonical),
          },
        }
      },
    }),
    async () => {
      const result = await api.fetchFromLrchub({
        track: 'Animated Song',
        artist: 'Artist',
        video_id: VIDEO_A,
      })
      assert.equal(result.animated_lyrics, shifted)
      assert.equal(result.lyrics, shifted)
    },
  )
})

test('verified animated JSON and text start fields use LRCHub millisecond and second units', async () => {
  const animatedJson = JSON.stringify({
    frames: [{ t: 1000, start: '1.5', duration: 250 }],
  })
  const jsonResult = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: animatedJson,
      animated_lyrics: animatedJson,
      video_links: [{ video_id: VIDEO_A, offset_ms: 500 }],
      provider_meta: {
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(animatedJson),
      },
    },
    VIDEO_A,
  )
  assert.deepEqual(JSON.parse(jsonResult.animated_lyrics), {
    frames: [{ t: 1500, start: '2', duration: 250 }],
  })

  const timedText = "<timedtext><text start = '1.5'>Hi</text></timedtext>"
  const textResult = await api.normalizeRawLrchubLyricsForVideo(
    {
      lyrics: timedText,
      animated_lyrics: timedText,
      video_links: [{ video_id: VIDEO_A, offset_ms: 500 }],
      provider_meta: {
        animated_lyrics_offset_normalized: true,
        animated_lyrics_offset_normalized_hash: sha256(timedText),
      },
    },
    VIDEO_A,
  )
  assert.match(textResult.animated_lyrics, /<text start = '2'>/)
})

test('Web Crypto failure leaves hash-protected animated lyrics unchanged', async () => {
  const animated = '<timedtext><body><p t="1000">Hi</p></body></timedtext>'
  await withCryptoReplacement(
    {
      subtle: {
        async digest() {
          throw new Error('digest unavailable')
        },
      },
    },
    async () => {
      const result = await api.normalizeRawLrchubLyricsForVideo(
        {
          lyrics: animated,
          animated_lyrics: animated,
          video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
          provider_meta: {
            animated_lyrics_offset_normalized: true,
            animated_lyrics_offset_normalized_hash: sha256(animated),
          },
        },
        VIDEO_A,
      )
      assert.equal(result.animated_lyrics, animated)
      assert.equal(result.lyrics, animated)
    },
  )
})

test('hashless flagged animated lyrics use an offset marker to remain idempotent', async () => {
  const animated = '<timedtext><body><p t="1000">Hi</p></body></timedtext>'
  const raw = {
    lyrics: animated,
    animated_lyrics: animated,
    video_links: [{ video_id: VIDEO_A, offset_ms: 1200 }],
    provider_meta: {
      animated_lyrics_offset_normalized: true,
    },
  }

  const once = await api.normalizeRawLrchubLyricsForVideo(raw, VIDEO_A)
  const twice = await api.normalizeRawLrchubLyricsForVideo(once, VIDEO_A)
  assert.match(once.animated_lyrics, /<p t="2200">/)
  assert.equal(twice.animated_lyrics, once.animated_lyrics)
  assert.equal(twice.lyrics, once.lyrics)
})
