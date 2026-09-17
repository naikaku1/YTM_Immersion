import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const lyricsUiSource = fs.readFileSync(
  new URL('../src/js/module/lyrics-ui.js', import.meta.url),
  'utf8',
)
const contentSource = fs.readFileSync(
  new URL('../src/js/content.js', import.meta.url),
  'utf8',
)
const styleSource = fs.readFileSync(
  new URL('../src/css/style.css', import.meta.url),
  'utf8',
)
const pipManagerSource = fs.readFileSync(
  new URL('../src/js/module/pip-manager.js', import.meta.url),
  'utf8',
)

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

function extractFunctionDeclaration(source, functionName) {
  const marker = `function ${functionName}`
  const markerStart = source.indexOf(marker)
  assert.notEqual(markerStart, -1, `missing function: ${functionName}`)
  const start = source.slice(Math.max(0, markerStart - 6), markerStart) === 'async '
    ? markerStart - 6
    : markerStart
  const openBrace = source.indexOf('{', start)
  assert.notEqual(openBrace, -1, `missing function body: ${functionName}`)

  let depth = 0
  let state = 'code'
  let escaped = false
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]

    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code'
        index += 1
      }
      continue
    }
    if (state !== 'code') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (
        (state === 'single-quote' && char === "'") ||
        (state === 'double-quote' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code'
      }
      continue
    }

    if (char === '/' && next === '/') {
      state = 'line-comment'
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      state = 'block-comment'
      index += 1
      continue
    }
    if (char === "'") {
      state = 'single-quote'
      continue
    }
    if (char === '"') {
      state = 'double-quote'
      continue
    }
    if (char === '`') {
      state = 'template'
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  assert.fail(`unterminated function: ${functionName}`)
}

function createPayloadHarness(useAnimatedCaptions = true) {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const hasCharacterSyncedLines',
    'async function applyLateLyricsUpgrade',
  )
  const context = {
    config: { useAnimatedCaptions },
  }
  vm.runInNewContext(
    `${helperSource}\nglobalThis.helpers = { hasCharacterSyncedLines, selectLyricsPayload };`,
    context,
    { filename: 'lyrics-ui-payload-helpers.js' },
  )
  return context.helpers
}

test('enabled srv3 animation wins over DynamicLRC and line-only display modes', () => {
  const { hasCharacterSyncedLines, selectLyricsPayload } = createPayloadHarness(true)
  const dynamicLines = [{
    start_ms: '1000',
    chars: [{ char: 'あ', startTimeMs: '1050' }],
  }]
  const payload = {
    lyrics: '[00:01.00] line lyrics',
    animated_lyrics: '<timedtext format="3"><body><p t="1000" d="500">animated lyrics</p></body></timedtext>',
    dynamicLines,
  }

  assert.equal(hasCharacterSyncedLines(dynamicLines), true)
  const selected = selectLyricsPayload(payload)
  assert.equal(selected.text, payload.animated_lyrics)
  assert.equal(selected.dynamicLines, null)
  assert.equal(selected.mode, 'animated')
  assert.equal(selected.quality, 4)

  const withoutAnimated = selectLyricsPayload({ ...payload, animated_lyrics: '' })
  assert.equal(withoutAnimated.text, payload.lyrics)
  assert.equal(withoutAnimated.dynamicLines, dynamicLines)
  assert.equal(withoutAnimated.mode, 'dynamic')
  assert.equal(withoutAnimated.quality, 3)

  const animationDisabled = createPayloadHarness(false).selectLyricsPayload(payload)
  assert.equal(animationDisabled.text, payload.lyrics)
  assert.equal(animationDisabled.dynamicLines, dynamicLines)
  assert.equal(animationDisabled.mode, 'dynamic')
  assert.equal(animationDisabled.quality, 3)

  const lineOnly = createPayloadHarness(false).selectLyricsPayload({
    lyrics: payload.lyrics,
    animated_lyrics: payload.animated_lyrics,
  })
  assert.equal(lineOnly.text, payload.lyrics)
  assert.equal(lineOnly.quality, 2)
})

test('a late character-sync event cannot be downgraded by the original line callback', () => {
  const lateUpgradeSource = extractFunctionDeclaration(lyricsUiSource, 'applyLateLyricsUpgrade')
  assert.match(
    lateUpgradeSource,
    /currentLyricsResultPriority\s*===\s*2\s*&&\s*selected\.quality\s*<=\s*currentLyricsQuality/,
  )

  const responseSource = sourceBetween(
    lyricsUiSource,
    "YTMLog.log('[CS] GET_LYRICS response:', res);",
    "console.error('GET_LYRICS failed', e);",
  )
  assert.match(
    responseSource,
    /selectedResponse\.quality\s*<\s*currentLyricsQuality/,
  )
  assert.match(
    responseSource,
    /selectedResponse\.quality\s*===\s*currentLyricsQuality/,
  )
  assert.match(lyricsUiSource, /dataQuality\s*!==\s*currentLyricsQuality/)
})

test('srv3 can replace preferred YTM lyrics both immediately and after the 400ms race', () => {
  const lateUpgradeSource = extractFunctionDeclaration(lyricsUiSource, 'applyLateLyricsUpgrade')
  assert.match(
    lateUpgradeSource,
    /currentLyricsFromPreferredYtm[\s\S]*?selected\.mode\s*!==\s*'animated'/,
  )

  const loadSource = sourceBetween(
    lyricsUiSource,
    'const backgroundPromise = safeRuntimeSendMessage',
    "console.error('GET_LYRICS failed', e);",
  )
  assert.match(loadSource, /selectLyricsPayload\(late\)\.mode\s*===\s*'animated'/)
  assert.match(loadSource, /applyLateLyricsUpgrade\(late\)/)
  assert.match(loadSource, /backgroundHasSrv3/)
  assert.match(loadSource, /!backgroundHasSrv3/)
})

// 歌い終わった行は active を外す(歌っていないのに光っていたら嘘)。
// ただし past にはしない。past は不可視なので、次の行が始まるまで画面から
// 歌詞が消える。終わり時刻を持つのは文字同期の行だけなので、そのままだと
// 「同期が細かい曲ほど画面が空になる」という逆転になる。
// 実測: Dear (Mrs. GREEN APPLE) は行間の空きが歌っている時間の6割あり
// (歌 166秒 / 空き 101秒)、点いて消えて点いて消えて、に見えていた。
// 消える時機を「自分が終わった時」から「次が始まった時」へ移してある。
test('finished DynamicLRC rows become past rows in the main view and PiP', () => {
  const highlightSource = extractFunctionDeclaration(lyricsUiSource, 'updateLyricHighlight')
  assert.match(highlightSource, /primaryHasDynamicRange/)
  assert.match(highlightSource, /primaryIsActive/)
  assert.match(highlightSource, /classList\.toggle\('lyric-past', isPast\)/)
  // 自分の終わりで消さないこと
  assert.doesNotMatch(highlightSource, /primaryDynamicEnded/)
  assert.match(highlightSource, /const isPast = idx >= 0 && !isActive && i < idx;/)

  assert.match(pipManagerSource, /#pip-lyrics-container \.lyric-line\.lyric-past/)
  assert.match(pipManagerSource, /ytm-user-browsing-lyrics/)
  assert.match(pipManagerSource, /ytm-keep-past-lyrics/)
})

test('srv3 frames are mirrored to the open PiP stage', () => {
  const renderSource = extractFunctionDeclaration(lyricsUiSource, 'renderAnimatedTimedText')
  const updateSource = extractFunctionDeclaration(lyricsUiSource, 'updateAnimatedCaptionStage')
  assert.match(renderSource, /PipManager\.pipLyricsContainer\.innerHTML\s*=\s*ui\.lyrics\.innerHTML/)
  // 受け皿の取得は findAnimatedCaptionStage 経由(毎フレームの querySelector を避ける)
  assert.match(updateSource, /findAnimatedCaptionStage\(PipManager\.pipLyricsContainer\)/)
  assert.match(
    lyricsUiSource,
    /const findAnimatedCaptionStage = \(container\) => \{[\s\S]*?querySelector\('\.ytm-animated-caption-stage'\)/,
  )
  assert.match(updateSource, /availableStages\.forEach/)
  assert.match(pipManagerSource, /body\.ytm-animated-caption-mode #pip-lyrics-container/)
})

test('late metadata cannot replace an active srv3 stage with ordinary lyric rows', () => {
  const metaListenerSource = sourceBetween(
    lyricsUiSource,
    "if (msg.type !== 'LYRICS_META_UPDATE') return;",
    '// candidates/config が更新されたらメニューを再描画',
  )
  assert.match(metaListenerSource, /const keepAnimatedStage\s*=\s*!!\(/)
  assert.match(metaListenerSource, /config\.useAnimatedCaptions/)
  assert.match(metaListenerSource, /animatedCaptionData/)
  assert.match(metaListenerSource, /ytm-animated-caption-mode/)
  assert.match(metaListenerSource, /if \(!keepAnimatedStage\)\s*\{[\s\S]*?renderLyrics\(lyricsData\)/)
})

test('character-sync detection accepts supported text and timestamp aliases', () => {
  const { hasCharacterSyncedLines } = createPayloadHarness()
  const aliasPairs = [
    { c: 'A', t: 100 },
    { char: 'B', startTimeMs: '200' },
    { text: 'C', start_ms: 300 },
    { caption: 'D', startMs: 400 },
    { value: 'E', time: 500 },
  ]

  for (const char of aliasPairs) {
    assert.equal(hasCharacterSyncedLines([{ chars: [char] }]), true)
  }
  assert.equal(hasCharacterSyncedLines([{ chars: [{ char: 'missing time' }] }]), false)
  assert.equal(hasCharacterSyncedLines([{ chars: [{ char: 'null time', t: null }] }]), false)
  assert.equal(hasCharacterSyncedLines([{ chars: [{ char: 'empty time', t: '' }] }]), false)
  assert.equal(hasCharacterSyncedLines([{ chars: [{ char: 'blank time', t: '   ' }] }]), false)
  assert.equal(hasCharacterSyncedLines([{ chars: [{ c: '', char: 'alias text', t: '', startTimeMs: 600 }] }]), true)
})

test('dynamic character aliases are normalized to renderer c/t fields', () => {
  const normalizeSource = extractFunctionDeclaration(
    lyricsUiSource,
    'normalizeDynamicLinesToCharLevel',
  )
  const context = {}
  vm.runInNewContext(
    `${normalizeSource}\nglobalThis.normalize = normalizeDynamicLinesToCharLevel;`,
    context,
    { filename: 'lyrics-ui-dynamic-normalizer.js' },
  )

  const normalized = context.normalize([{
    start_ms: '1000',
    chars: [
      { char: 'あ', startTimeMs: '1050' },
      { text: 'い', start_ms: 1125 },
      { caption: 'う', startMs: '1200' },
      { value: 'え', time: 1275 },
    ],
  }])
  const plain = JSON.parse(JSON.stringify(normalized))

  assert.equal(plain[0].startTimeMs, 1000)
  assert.equal(plain[0].text, 'あいうえ')
  assert.deepEqual(
    plain[0].chars.map(({ c, t }) => ({ c, t })),
    [
      { c: 'あ', t: 1050 },
      { c: 'い', t: 1125 },
      { c: 'う', t: 1200 },
      { c: 'え', t: 1275 },
    ],
  )

  const aliasFallback = JSON.parse(JSON.stringify(context.normalize([{
    startTimeMs: '',
    start_ms: 500,
    chars: [{ c: '', char: 'F', t: '', startTimeMs: 600 }],
  }])))
  assert.equal(aliasFallback[0].startTimeMs, 500)
  assert.deepEqual(
    aliasFallback[0].chars.map(({ c, t }) => ({ c, t })),
    [{ c: 'F', t: 600 }],
  )
})

test('dynamic line matching ignores blank primary timestamps and uses valid aliases', () => {
  const helperSource = sourceBetween(
    lyricsUiSource,
    'const toFiniteDynamicTime',
    'const getDynamicLineEndSec',
  )
  const context = {}
  vm.runInNewContext(
    `${helperSource}\nglobalThis.getStart = getDynamicLineStartSec;`,
    context,
    { filename: 'lyrics-ui-dynamic-line-start.js' },
  )

  assert.equal(context.getStart({ startTimeMs: '', start_ms: 1250 }), 1.25)
  assert.equal(context.getStart({ startTimeMs: '   ', chars: [{ t: '', startTimeMs: 1500 }] }), 1.5)
})

test('legacy string cache is provisional while new manual cache remains authoritative', () => {
  const cacheSource = sourceBetween(
    lyricsUiSource,
    "} else if (typeof cached === 'string') {",
    "} else if (typeof cached === 'object') {",
  )
  const legacyBody = cacheSource.slice(cacheSource.indexOf('{') + 1)
  const legacyContext = { cached: '[00:01.00] legacy line' }
  vm.runInNewContext(`
    let data = null;
    let dataPriority = 99;
    let currentLyricsResultPriority = 99;
    ${legacyBody}
    globalThis.result = { data, dataPriority, currentLyricsResultPriority };
  `, legacyContext, { filename: 'lyrics-ui-legacy-cache.js' })

  assert.equal(legacyContext.result.data, legacyContext.cached)
  assert.ok(legacyContext.result.dataPriority < 2)
  assert.ok(legacyContext.result.currentLyricsResultPriority < 2)

  const objectCacheSource = sourceBetween(
    lyricsUiSource,
    "} else if (typeof cached === 'object') {",
    'syncLyricsLockState();',
  )
  assert.match(
    objectCacheSource,
    /currentLyricsResultPriority\s*=\s*cachedIsUserChoice\s*\?\s*3\s*:\s*2/,
  )
})

// 以前は「旧デフォルト standard の時だけ LrcLib を暫定扱いにする」判定が
// あったが、standard は選択肢から消えており normalizeSourceMode も返さない。
// 到達しない条件だったので畳んだ。
//
// 残る分かれ目は「本人が決めたかどうか」だけ。手動アップロードと、
// 候補メニューでの取得元の選択がそれにあたる。ここを 2 のままにすると、
// 次に同じ曲をかけた時に裏で走った取得(同じく 2)へ上書きされ、
// 選んだ歌詞が一瞬出てから差し替わる。
test('本人が決めた歌詞はキャッシュから戻しても最優先', () => {
  const objectCacheSource = sourceBetween(
    lyricsUiSource,
    "} else if (typeof cached === 'object') {",
    'syncLyricsLockState();',
  )
  assert.doesNotMatch(objectCacheSource, /cachedLrcLibIsFallback/,
    '到達しない暫定判定が戻っている')
  assert.doesNotMatch(lyricsUiSource, /\|\| 'standard'\) === 'standard'/,
    "normalizeSourceMode が返さない 'standard' を見ている")

  assert.match(
    objectCacheSource,
    /cachedIsUserChoice = !!\(cached\.manualLyrics \|\| cached\.manualChoice\)/,
    '候補の選択が本人の決定として扱われていない',
  )
  assert.match(
    objectCacheSource,
    /currentLyricsResultPriority = cachedIsUserChoice \? 3 : 2;/,
  )
  assert.match(
    objectCacheSource,
    /selectedCandidateId = String\(cached\.candidateId\)/,
    '選択中の印がメニューに戻らない',
  )
})

test('候補を選んだら、その事実と候補一覧ごと保存する', () => {
  const save = sourceBetween(
    lyricsUiSource,
    'async function selectCandidateById(candId) {',
    'await applyLyricsText(nextLyricsText);',
  )
  assert.match(save, /manualChoice: true/, '本人の決定として保存していない')
  assert.match(save, /candidateId: cand\.id \|\| candId/)
  assert.match(save, /candidates: Array\.isArray\(lyricsCandidates\)/,
    '候補一覧を残していない(次に開いた時に選び直せない)')
  assert.match(save, /lyricsSource: candidateSource/)
})

test('late LRCHub upgrade rejects stale track, request, and video identities', async () => {
  const lateUpgradeSource = extractFunctionDeclaration(lyricsUiSource, 'applyLateLyricsUpgrade')
  const createHarness = () => {
    const context = {}
    vm.runInNewContext(`
      let currentKey = 'Song///Artist';
      let activeLyricsRequestId = 'request-1';
      let currentLyricsVideoId = 'video-1';
      let selectedCandidateId = null;
      let currentLyricsResultPriority = 1;
      let payloadSelections = 0;
      function selectLyricsPayload() {
        payloadSelections += 1;
        return { text: '' };
      }
      ${lateUpgradeSource}
      globalThis.run = applyLateLyricsUpgrade;
      globalThis.selectionCount = () => payloadSelections;
    `, context, { filename: 'lyrics-ui-late-upgrade.js' })
    return context
  }
  const validPayload = {
    success: true,
    lyricsSource: 'lrchub',
    track_key: 'Song///Artist',
    request_id: 'request-1',
    video_id: 'video-1',
  }

  for (const patch of [
    { track_key: 'Other///Artist' },
    { request_id: 'request-old' },
    { video_id: 'video-old' },
  ]) {
    const harness = createHarness()
    await harness.run({ ...validPayload, ...patch })
    assert.equal(harness.selectionCount(), 0)
  }

  const currentHarness = createHarness()
  await currentHarness.run(validPayload)
  assert.equal(currentHarness.selectionCount(), 1)
})

test('normalized timed translations win over raw translation payloads in the UI', () => {
  const lateUpgradeSource = extractFunctionDeclaration(lyricsUiSource, 'applyLateLyricsUpgrade')
  const rawIndex = lateUpgradeSource.indexOf('normalizeTranslationsToLrcMapLocal(payload.translations)')
  const normalizedIndex = lateUpgradeSource.indexOf('normalizeTranslationsToLrcMapLocal(payload.lrcMap)')

  assert.ok(rawIndex >= 0)
  assert.ok(normalizedIndex > rawIndex)
  assert.match(
    lyricsUiSource,
    /normalizeTranslationsToLrcMapLocal\(res\?\.translations\)[\s\S]{0,160}normalizeTranslationsToLrcMapLocal\(res\?\.lrcMap\)/,
  )
})

test('same-title video changes and candidate awaits carry explicit identity guards', () => {
  const tickGuard = /currentKey\s*!==\s*key\s*\|\|\s*\(currentLyricsVideoId\s*\|\|\s*''\)\s*!==\s*videoId/
  assert.match(lyricsUiSource, tickGuard)

  const candidateSource = extractFunctionDeclaration(lyricsUiSource, 'ensureCandidateLyricsLoaded')
  assert.match(candidateSource, /const candidateKeyAtStart\s*=\s*currentKey/)
  assert.match(candidateSource, /const candidateVideoAtStart\s*=\s*currentLyricsVideoId\s*\|\|\s*getCurrentVideoId\(\)\s*\|\|\s*''/)
  assert.match(
    candidateSource,
    /currentKey\s*!==\s*candidateKeyAtStart[\s\S]*?currentLyricsVideoId[\s\S]*?!==\s*candidateVideoAtStart[\s\S]*?lyricsCandidates\s*!==\s*candidateListAtStart/,
  )
  assert.match(candidateSource, /candidateNeedsFullRecord/)
  assert.match(candidateSource, /cand\?\.lyricsComplete\s*!==\s*true/)
})

test('cold start waits for persisted lyric settings before observation and playback loops', () => {
  const settingsSource = sourceBetween(
    lyricsUiSource,
    'const runtimeSettingsReady',
    '// ===================== 初期化',
  )
  for (const key of [
    'ytm_sync_offset',
    'ytm_save_sync_offset',
    'ytm_lrclib_fallback',
    'ytm_lyric_source_mode',
    'ytm_animated_captions_enabled',
  ]) {
    assert.match(settingsSource, new RegExp(`storage\\.get\\('${key}'\\)`))
  }
  assert.match(
    contentSource,
    /Promise\.resolve\(runtimeSettingsReady\)\.then\(\(\)\s*=>\s*\{[\s\S]*?setupObserver\(\)[\s\S]*?startLyricRafLoop\(\)/,
  )
})

// 候補を選んだあとの「報告」と「10秒後の取り直し」は削除した。
//
// LRCHub には匿名で「この候補を選んだ」を受け取る API が無い
// (/api/record/lock はログイン必須、/api/select 等は 404)。報告が届かないのに
// storage.remove + loadLyrics だけが走ると、「選んだ」記録ごと消えて
// 取得が最初からやり直しになる。実際「SimpMusic に切り替えたのに
// 10秒後 YTM に戻る」不具合が出ていた。
test('候補を選んでも、あとから取り直して戻さない', () => {
  const fn = sourceBetween(
    lyricsUiSource,
    'async function selectCandidateById(candId) {',
    'let lyricsLockState = null;',
  )
  assert.ok(!fn.includes('SELECT_LYRICS_CANDIDATE'), '届かない報告を送っている')
  assert.ok(!fn.includes('storage.remove'), '選んだ記録を消している')
  assert.ok(!fn.includes('setTimeout'), '遅れて取り直している')
})

test('選んだこと自体は保存されている', () => {
  const fn = sourceBetween(
    lyricsUiSource,
    'async function selectCandidateById(candId) {',
    'let lyricsLockState = null;',
  )
  assert.ok(fn.indexOf('manualChoice: true') !== -1, '選択の記録が保存されていない')
})

// 遅れて届いた差し替え(特に YouTube Music)には候補一覧・requests・config・
// 翻訳が入っていない。無条件に代入すると、LrcLib で暫定表示していた時の
// 候補メニューや翻訳が丸ごと消える。loadLyrics と同じ「あれば更新」に揃える。
test('遅着の差し替えで候補メニュー・requests・翻訳を消さない', () => {
  const fn = extractFunctionDeclaration(lyricsUiSource, 'applyLateLyricsUpgrade')
  assert.match(
    fn,
    /if \(Array\.isArray\(payload\.candidates\) && payload\.candidates\.length\) lyricsCandidates = payload\.candidates;/,
  )
  assert.match(fn, /if \(Array\.isArray\(payload\.requests\)\) lyricsRequests = payload\.requests;/)
  assert.match(fn, /if \(payload\.config\) lyricsConfig = payload\.config;/)
  assert.ok(
    !/lyricsCandidates = Array\.isArray\(payload\.candidates\) \? payload\.candidates : null/.test(fn),
    '候補一覧を null で潰す形に戻っている',
  )
  // 翻訳も既存のものを残したうえで重ねること
  assert.match(fn, /lyricsTranslationMap = \{\s*\n\s*\.\.\.\(lyricsTranslationMap \|\| \{\}\),/)
})
