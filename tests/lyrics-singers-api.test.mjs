import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  fetchLrchubSingerMetadata,
  getLrchubRecordId,
  normalizeLrchubSingerMetadata,
} from '../src/js/module/api.js';

const withMockFetch = async (mock, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test('normalizes LRCHub singer assignments, profiles, and derived summary', () => {
  const result = normalizeLrchubSingerMetadata({
    ok: true,
    record_id: 'record-42',
    video_id: 'video-7',
    line_count: 5,
    line_singers: [2, 0, '3', 33],
    singers: {
      2: { artist_name: ' Artist B ', color: '#6699ff' },
      3: { artist: 'Artist C', color: 'not-a-color' },
      33: { artist_name: 'ignored', color: '#FFFFFF' },
    },
    lyrics_revision: 'sha256:revision',
    effective_scope: 'video',
    inherited: false,
    has_song_config: true,
    has_video_override: true,
    song_config: { line_singers: [1, 2] },
    video_override: { line_singers: [2, 3] },
  });

  assert.deepEqual(result.line_singers, [2, 1, 3, 1, 1]);
  assert.deepEqual(result.singer_numbers, [1, 2, 3]);
  assert.equal(result.singer_count, 3);
  assert.deepEqual(result.singers['1'], { artist_name: '', color: '' });
  assert.deepEqual(result.singers['2'], { artist_name: 'Artist B', color: '#6699FF' });
  assert.deepEqual(result.singers['3'], { artist_name: 'Artist C', color: '' });
  assert.equal(result.singers['33'], undefined);
  assert.equal(result.record_id, 'record-42');
  assert.equal(result.effective_scope, 'video');
  assert.equal(result.has_video_override, true);
});

test('rejects an error response instead of creating default singer metadata', () => {
  assert.equal(normalizeLrchubSingerMetadata(null), null);
  assert.equal(normalizeLrchubSingerMetadata({ ok: false, error: 'RECORD_NOT_FOUND' }), null);
});

test('extracts record_id from the provider metadata returned by /api/lyrics', () => {
  assert.equal(
    getLrchubRecordId({ provider_meta: { record_id: 'song-key\nartist-key' } }),
    'song-key\nartist-key',
  );
  assert.equal(
    getLrchubRecordId({ providerMeta: { recordId: 'camel-case-record' } }),
    'camel-case-record',
  );
});

test('fetches singer metadata separately with record_id and the exact video_id', async () => {
  let requestedUrl = '';
  let requestedOptions = null;
  await withMockFetch(async (url, options) => {
    requestedUrl = String(url);
    requestedOptions = options;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        record_id: 'record-42',
        video_id: 'video-7',
        line_count: 3,
        line_singers: [1, 2, 1],
        singers: { 2: { artist_name: 'Artist B', color: '#112233' } },
      }),
    };
  }, async () => {
    const result = await fetchLrchubSingerMetadata({
      record_id: 'record-42',
      video_id: 'video-7',
      url: 'https://www.youtube.com/watch?v=ignored',
    });
    assert.deepEqual(result.line_singers, [1, 2, 1]);
  });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, '/api/record/singers');
  assert.equal(parsed.searchParams.get('record_id'), 'record-42');
  assert.equal(parsed.searchParams.get('video_id'), 'video-7');
  assert.equal(parsed.searchParams.has('url'), false);
  assert.deepEqual(requestedOptions, { method: 'GET', cache: 'no-store' });
});

test('uses a YouTube URL only when no video_id is available', async () => {
  let requestedUrl = '';
  await withMockFetch(async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ ok: true, record_id: 'record-url', line_count: 0, line_singers: [] }),
    };
  }, async () => {
    await fetchLrchubSingerMetadata({
      record_id: 'record-url',
      youtube_url: 'https://music.youtube.com/watch?v=video-url',
    });
  });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.has('video_id'), false);
  assert.equal(parsed.searchParams.get('url'), 'https://music.youtube.com/watch?v=video-url');
});

test('background keeps singer lookup independent and propagates record_id', () => {
  const source = fs.readFileSync(new URL('../src/js/background.js', import.meta.url), 'utf8');
  assert.match(source, /req\.type === 'GET_LYRIC_SINGERS'/);
  assert.match(source, /fetchLrchubSingerMetadata\(\{ record_id, video_id, youtube_url, url \}\)/);
  assert.match(source, /record_id: getLrchubRecordId\(hubRes\)/);
  assert.match(source, /record_id: getLrchubRecordId\(candRes\) \|\| getLrchubRecordId\(candidate\)/);
});

test('LRCHub record_id survives initial, late-upgrade, and candidate cache writes', () => {
  const source = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8');
  assert.match(source, /record_id: payload\.record_id \|\| null/);
  assert.match(source, /record_id: res\.record_id \|\| null/);
  assert.match(source, /const candidateRecordId = getCandidateRecordId\(cand\)/);
  assert.match(source, /record_id: candidateRecordId/);

  const helperSource = source.match(/const getCandidateRecordId = \(candidate\) => \{[\s\S]*?\n\};/)?.[0];
  assert.ok(helperSource, 'candidate record-id resolver should remain available');
  const getCandidateRecordId = Function(`${helperSource}; return getCandidateRecordId;`)();
  assert.equal(getCandidateRecordId({ record: { record_id: 'nested-record' } }), 'nested-record');
  assert.equal(getCandidateRecordId({ record: { id: 'nested-id' } }), 'nested-id');
  assert.equal(getCandidateRecordId({ provider_meta: { record_id: 'provider-record' } }), 'provider-record');
});

test('loaded singer metadata is retained for the same track/video/record context', () => {
  const source = fs.readFileSync(new URL('../src/js/module/lyrics-ui.js', import.meta.url), 'utf8');
  const sharedStateSource = fs.readFileSync(new URL('../src/js/module/cloud-sync.js', import.meta.url), 'utf8');
  assert.match(sharedStateSource, /let currentSingerMetadataKey = ''/);
  assert.match(source, /if \(!metadataContextChanged && currentSingerMetadata\)/);
  assert.match(source, /currentSingerMetadataKey = requestKey/);

  const queueSource = fs.readFileSync(new URL('../src/js/module/queue-manager.js', import.meta.url), 'utf8');
  assert.match(queueSource, /cacheVersion:\s*2/);
  assert.match(queueSource, /record_id:\s*res\.record_id \|\| null/);
  assert.match(queueSource, /lyricsSource:\s*res\.lyricsSource \|\| res\.source \|\| 'lrchub'/);
  assert.match(queueSource, /fallbackUsed:\s*!!res\.fallbackUsed/);
});
