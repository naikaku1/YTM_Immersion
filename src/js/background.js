import * as CloudSync from './module/bg-cloud-sync.js';
import * as API from './module/api.js';

// ── デバッグログ ────────────────────────────────────────────
// Service Worker には localStorage が無いので chrome.storage を見る。
// 既定は無効。有効化は content script 側と同じ ytm_debug キー。
const YTMLog = (() => {
  let enabled = false;
  const noop = () => { };
  const api = {
    enabled: false,
    log: (...a) => { if (enabled) console.log('[YTM]', ...a); },
    info: (...a) => { if (enabled) console.info('[YTM]', ...a); },
    debug: (...a) => { if (enabled) console.debug('[YTM]', ...a); },
  };
  try {
    chrome.storage.local.get(['ytm_debug'], (res) => {
      enabled = res && (res.ytm_debug === '1' || res.ytm_debug === true);
      api.enabled = enabled;
    });
  } catch (e) { /* 読めなければ無効のまま */ }
  return api;
})();


// フォールバック段で「先着した方」を確定させる前に置く猶予。
// 表示前に一度だけ待つ値なので、伸ばすとそのまま歌詞の初回表示が遅れる。
const FALLBACK_GRACE_MS = 600;

// LRCHub の一次問い合わせをどこまで待って「先に出す」判断をするか。
const EARLY_HUB_WAIT_MS = 1500;

// 待ちを重ねない。上の猶予は「最初の有効な結果が出てから」の総量として
// 使い、段ごとに足し算しない。以前は 1.5 秒 + 0.6 秒 + 0.8 秒と積み上がり、
// LrcLib の歌詞が手元にあるのに最大 2.9 秒あとまで出せなかった。
const POST_FALLBACK_GRACE_MS = 800;

// 文字(語)単位の時刻を実際に持っているか。本体は api.js。
// GET_LYRICS と FIND_ALTERNATE_LYRICS の両方から使うのでモジュール直下に置く。
const hasCharacterSyncedLines = API.hasCharacterSyncedLines;

// ── 別の曲のデータを弾く ──────────────────────────────────
// 取得元によっては、videoId に紐づいたレコードの中身が別の曲ということが
// ある。実測: 夢灯籠(S6kjwLlKXnk / 131秒)のレコードに「夏のせい」の歌詞が
// 入っていた。songTitle も artistName も正しく「夢灯籠 / RADWIMPS」なので、
// メタデータを突き合わせても気づけない。
//
// 手がかりは時刻。歌詞の最後の行が曲の終わりを大きく超えていたら、
// その歌詞はこの曲のものではない。上の例では歌詞が 317 秒まで続いていた
// (曲の 2.4 倍)。曲の長さは <video>.duration の実測値なので信用できる。
//
// 版違いで数十秒ずれる正しいデータを巻き込まないよう、弾くのは
// 「明らかに別物」だけに絞る。手元の正しい5曲での超過は最大 62 秒だった。
const LYRICS_OVERSHOOT_RATIO = 1.25;
const LYRICS_OVERSHOOT_MARGIN_SEC = 30;

const lastLyricTimeSec = (lyrics) => {
  const text = String(lyrics ?? '');
  if (!text) return null;
  let last = null;
  // [mm:ss.xx] と [hh:mm:ss.xx] の両方
  const re = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
  let m;
  while ((m = re.exec(text))) {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const sec = Number(String(m[3]).replace(':', '.'));
    if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
    const t = h * 3600 + min * 60 + sec;
    if (last === null || t > last) last = t;
  }
  return last;
};

const lyricsBelongToTrack = (lyrics, durationSec) => {
  const duration = Number(durationSec);
  // 長さが分からない時は判断しない。弾く方に倒すと歌詞が出なくなる
  if (!Number.isFinite(duration) || duration <= 0) return true;
  const last = lastLyricTimeSec(lyrics);
  if (last === null) return true;   // 時刻なしの歌詞は対象外
  return last <= duration * LYRICS_OVERSHOOT_RATIO + LYRICS_OVERSHOOT_MARGIN_SEC;
};

// 取得元をまたいだ候補メニューの表示名
const PROVIDER_CANDIDATE_LABELS = {
  lrchub: 'LRC Hub',
  lrclib: 'LrcLib',
  simpmusic: 'SimpMusic',
  lyricsplus: 'LyricsPlus',
};

// 取得元1つぶんを候補メニューの1項目に均す。
// 選んだ時に追加取得が要らないよう、歌詞本文まで持たせておく。
const buildProviderCandidate = (providerId, res) => {
  const lyrics = typeof res?.lyrics === 'string' ? res.lyrics.trim() : '';
  if (!lyrics) return null;
  return {
    id: `provider_${providerId}`,
    label: PROVIDER_CANDIDATE_LABELS[providerId] || providerId,
    providerCandidate: true,
    lyricsSource: providerId,
    lyrics,
    dynamicLines: hasCharacterSyncedLines(res.dynamicLines) ? res.dynamicLines : null,
    animated_lyrics: res.animated_lyrics || res.timedtext || res.timed_text || null,
    record_id: providerId === 'lrchub' ? getLrchubRecordId(res) : null,
    lyricsComplete: true,
    has_synced: /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics),
    offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
  };
};

// 本体は api.js。ここで二重に持つと、拾うキーが片方だけ増えた時に食い違う。
const getLrchubRecordId = API.getLrchubRecordId;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(CloudSync.CLOUD_STORAGE_KEY, (items) => {
    if (!items || !items[CloudSync.CLOUD_STORAGE_KEY]) {
      chrome.storage.local.set({ [CloudSync.CLOUD_STORAGE_KEY]: CloudSync.DEFAULT_CLOUD_STATE });
    }
  });
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !req.type) {
    return;
  }

  if (req.type === 'GET_CLOUD_STATE') {
    CloudSync.loadCloudState()
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'SAVE_RECOVERY_TOKEN') {
    const token = typeof req.token === 'string' ? req.token.trim() : '';
    CloudSync.saveCloudState({ recoveryToken: token || null })
      .then(state => sendResponse({ ok: true, state }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (req.type === 'OPEN_LOGIN_PAGE') {
    (async () => {
      try {
        const state = await CloudSync.loadCloudState();
        const base = (state.serverBaseUrl || CloudSync.DEFAULT_CLOUD_STATE.serverBaseUrl || '').replace(/\/+$/, '');
        const loginPath = state.loginPath || CloudSync.DEFAULT_CLOUD_STATE.loginPath || '/auth/discord';
        const url = base + loginPath;
        chrome.tabs.create({ url }, () => {
          if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          else sendResponse({ ok: true, url });
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'GET_LYRIC_SINGERS') {
    const { record_id, video_id, youtube_url, url } = req.payload || {};
    (async () => {
      try {
        const singerMetadata = await API.withTimeout(
          API.fetchLrchubSingerMetadata({ record_id, video_id, youtube_url, url }),
          5000,
          'lrchub singers'
        );
        if (!singerMetadata) {
          sendResponse({ success: false, singerMetadata: null });
          return;
        }
        sendResponse({ success: true, singerMetadata });
      } catch (e) {
        sendResponse({ success: false, singerMetadata: null, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'SYNC_HISTORY') {
    const history = Array.isArray(req.history) ? req.history : (req.payload && Array.isArray(req.payload.history) ? req.payload.history : []);
    (async () => {
      try {
        const result = await CloudSync.cloudSyncHistory(history);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'TRANSLATE') {
    const { text, apiKey, targetLang, useSharedTranslateApi } = req.payload || {};
    const target = targetLang || 'JA';
    const texts = Array.isArray(text) ? text : [text];

    const translateViaDeepL = async () => {
      if (!apiKey) throw new Error('DeepL API key is missing');
      const endpoint = apiKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      const body = { text: texts, target_lang: target };

      const res = await API.withTimeout(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
        20000,
        'deepl translate timeout'
      );

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`DeepL translate failed: ${res.status} ${msg}`);
      }

      const data = await res.json();
      if (!data || !Array.isArray(data.translations)) {
        throw new Error('DeepL translate: invalid response');
      }
      return {
        translations: data.translations,
        engine: 'deepl',
        plan: apiKey.endsWith(':fx') ? 'free' : 'pro',
      };
    };

    (async () => {
      try {
        if (useSharedTranslateApi) {
          sendResponse({ success: false, error: 'Shared translation is fetched from LRCHub /api/lyrics.' });
          return;
        }
        const deepl = await translateViaDeepL();
        sendResponse({
          success: true,
          translations: deepl.translations,
          engine: deepl.engine,
          plan: deepl.plan,
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  // 歌詞取得
  if (req.type === 'GET_LYRICS') {
    const {
      track,
      artist,
      youtube_url,
      video_id,
      album,
      duration_sec,
      use_lrclib = true,
      offset_ms,
      translate_to,
      translation_source,
      lyric_source_mode = 'standard',
      request_id,
      track_key,
    } = req.payload || {};
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const resolvedVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
    const hasTranslateRequest = Array.isArray(translate_to) ? translate_to.length > 0 : !!translate_to;
    const lrchubLyricsMethod = hasTranslateRequest ? 'GET' : 'POST';

    YTMLog.log('[BG] GET_LYRICS', { track, artist, lyric_source_mode });

    let responded = false;
    const sendOnce = (payload) => {
      if (responded) return;
      responded = true;
      sendResponse(payload);
    };

    (async () => {
      const requestIdentity = {
        request_id: request_id || null,
        track_key: track_key || null,
        track: track || '',
        artist: artist || '',
        video_id: resolvedVideoId || null,
      };

      const getHubLyricsQuality = (hubRes) => {
        const animated = hubRes?.animated_lyrics || hubRes?.timedtext || hubRes?.timed_text;
        // srv3 はアニメーション表示そのもの。DynamicLRC が先着していても
        // 後着の srv3 を content script へ届けられるよう最上位にする。
        if (typeof animated === 'string' && animated.trim()) return 5;
        if (hasCharacterSyncedLines(hubRes?.dynamicLines)) return 4;
        if (typeof hubRes?.lyrics === 'string' && /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(hubRes.lyrics)) return 2;
        return typeof hubRes?.lyrics === 'string' && hubRes.lyrics.trim() ? 1 : 0;
      };

      const buildLrcLibPayload = (lrcLibRes, fallbackUsed) => ({
        success: true,
        record_id: null,
        lyrics: lrcLibRes.lyrics,
        animated_lyrics: null,
        dynamicLines: null,
        subLyrics: '',
        hasSelectCandidates: Array.isArray(lrcLibRes.candidates) && lrcLibRes.candidates.length > 1,
        candidates: lrcLibRes.candidates || [],
        lyricsSource: 'lrclib',
        fallbackUsed: !!fallbackUsed,
        offset_ms: 0,
        ...requestIdentity,
      });

      // providerId は content script 側が「今どこの歌詞か」を見る値。
      // 既定は 'lrchub'。LRCHub 以外のプロバイダーは自分の ID を渡す。
      const buildHubLyricsPayload = (hubRes, sourceLabel, providerId = 'lrchub') => {
        const candidates = Array.isArray(hubRes.candidates) ? hubRes.candidates : [];
        const meaningData = hubRes.meaningData || API.normalizeLrchubMeaningPayload(hubRes);
        return {
          success: true,
          record_id: getLrchubRecordId(hubRes),
          lyrics: hubRes.lyrics,
          animated_lyrics: hubRes.animated_lyrics || hubRes.timedtext || hubRes.timed_text || null,
          dynamicLines: hasCharacterSyncedLines(hubRes.dynamicLines) ? hubRes.dynamicLines : null,
          subLyrics: typeof hubRes.subLyrics === 'string' ? hubRes.subLyrics : '',
          hasSelectCandidates: candidates.length > 1,
          candidates,
          config: hubRes.config || null,
          requests: hubRes.requests || [],
          meaningData,
          songSummary: hubRes.songSummary || hubRes.song_summary || hubRes.final_summary || null,
          comments: Array.isArray(hubRes.comments) ? hubRes.comments : [],
          rating: hubRes.rating || null,
          translations: hubRes.translations || null,
          lrcMap: {
            ...API.normalizeLrchubTranslations(hubRes.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes.translations),
            // normalizeLrchubLyricsResponse has already aligned timed
            // translations to the selected video's timeline.
            ...API.normalizeLrchubTranslations(hubRes.lrcMap)
          },
          lyricsSource: providerId,
          sourceLabel,
          fallbackUsed: false,
          lyricsQuality: getHubLyricsQuality(hubRes),
          offset_ms: Number.isFinite(Number(hubRes.offset_ms)) ? Number(hubRes.offset_ms) : 0,
          ...requestIdentity,
        };
      };

      const pushLyricsUpdate = async (payload) => {
        if (!tabId) return false;
        try {
          const sent = chrome.tabs.sendMessage(tabId, {
            type: 'LYRICS_DATA_UPDATE',
            payload,
          });
          if (sent && typeof sent.then === 'function') await sent;
          return true;
        } catch (e) {
          YTMLog.debug('[BG] Late lyrics update skipped:', e);
          return false;
        }
      };

      // ── 取得元をまたいだ候補 ────────────────────────────
      // 自動選択が1つを選んだあとも、他の取得元が返した歌詞は捨てずに
      // 候補メニューへ流しておく。上流のデータが壊れている・別テイクの
      // タイムラインが入っている、といった自動判定では気付けない外れを、
      // その場で1クリックで乗り換えられるようにするため。
      //
      // 表示中の歌詞には触れない専用の経路(LYRICS_META_UPDATE)で送る。
      // 出したものが後から勝手に入れ替わる方が体験としては悪い。
      const offeredProviderCandidates = new Set();
      const offerProviderCandidate = (providerId, res) => {
        if (!tabId || !res || offeredProviderCandidates.has(providerId)) return;
        const candidate = buildProviderCandidate(providerId, res);
        if (!candidate) return;
        offeredProviderCandidates.add(providerId);
        try {
          chrome.tabs.sendMessage(tabId, {
            type: 'LYRICS_META_UPDATE',
            payload: {
              video_id: resolvedVideoId || null,
              mergeCandidates: [candidate],
            },
          });
        } catch (e) {
          YTMLog.debug('[BG] Provider candidate offer skipped:', e);
        }
      };

      const asHubResult = (source, res, providerId = 'lrchub') => {
        if (!(res && typeof res.lyrics === 'string' && res.lyrics.trim())) return null;
        // 中身が別の曲のレコードはここで落とす。候補メニューにも出さない
        // (この関門を通った結果にだけ offerProviderCandidate が掛かる)。
        if (!lyricsBelongToTrack(res.lyrics, duration_sec)) {
          YTMLog.log(
            `[BG] ${source} の歌詞は別の曲とみなして不採用 ` +
            `(歌詞は ${Math.round(lastLyricTimeSec(res.lyrics))}秒まで / 曲は ${duration_sec}秒)`
          );
          return null;
        }
        return { source, res, providerId };
      };

      const firstValidResult = (tasks) => new Promise(resolve => {
        const pendingTasks = tasks.filter(Boolean);
        if (!pendingTasks.length) {
          resolve(null);
          return;
        }
        let pending = pendingTasks.length;
        let settled = false;
        pendingTasks.forEach(task => {
          Promise.resolve(task)
            .then(result => {
              pending -= 1;
              if (result && !settled) {
                settled = true;
                resolve(result);
              } else if (pending === 0 && !settled) {
                settled = true;
                resolve(null);
              }
            })
            .catch(() => {
              pending -= 1;
              if (pending === 0 && !settled) {
                settled = true;
                resolve(null);
              }
            });
        });
      });

      let deliveredHubQuality = 0;
      let deliveredProviderId = null;
      const resolvedHubResults = [];

      const sendHubLyrics = (hubRes, sourceLabel, providerId = 'lrchub') => {
        YTMLog.log(`[BG] Won: ${sourceLabel}`);
        deliveredHubQuality = Math.max(deliveredHubQuality, getHubLyricsQuality(hubRes));
        deliveredProviderId = providerId;
        sendOnce(buildHubLyricsPayload(hubRes, sourceLabel, providerId));
      };

      const pushHubUpgrade = async (hubResult) => {
        if (!responded || !hubResult?.res) return false;
        const providerId = hubResult.providerId || 'lrchub';
        // LRCHub の歌詞には翻訳・解説・候補が同じタイムラインで乗っている。
        // 外部プロバイダーが単語同期という一点だけで上書きすると、
        // 表示済みの翻訳ごと消えてしまうので差し替えない。
        // (逆向き、LRCHub が外部を上書きするのは品質が上がるので許す)
        if (providerId !== 'lrchub' && deliveredProviderId === 'lrchub') return false;
        const quality = getHubLyricsQuality(hubResult.res);
        if (quality <= deliveredHubQuality) return false;
        deliveredHubQuality = quality;
        deliveredProviderId = providerId;
        YTMLog.log(`[BG] Upgrading lyrics quality to ${hubResult.source} (${quality})`);
        return pushLyricsUpdate(buildHubLyricsPayload(hubResult.res, hubResult.source, providerId));
      };

      const pushBestResolvedHubUpgrade = () => {
        const best = resolvedHubResults
          .slice()
          .sort((a, b) => getHubLyricsQuality(b.res) - getHubLyricsQuality(a.res))[0];
        if (best) void pushHubUpgrade(best);
      };

      const makeRawHubTask = (source, promise, warningLabel, providerId = 'lrchub') => (
        Promise.resolve(promise)
          .then(res => asHubResult(source, res, providerId))
          .then(result => {
            if (result) {
              resolvedHubResults.push(result);
              offerProviderCandidate(providerId, result.res);
              if (responded) void pushHubUpgrade(result);
            }
            return result;
          })
          .catch(e => {
            console.warn(`[BG] ${warningLabel} fetch failed:`, e);
            return null;
          })
      );

      // Keep the raw promise as well as the timeout-limited selection promise.
      // The raw promise can still upgrade a temporary LrcLib result later.
      const primaryRawTask = makeRawHubTask(
        'LRCHub',
        API.fetchFromLrchub({
          track,
          artist,
          youtube_url,
          video_id: resolvedVideoId,
          offset_ms,
          translate_to,
          translation_source,
          method: lrchubLyricsMethod,
        }),
        'LRCHub'
      );
      const primarySelectionTask = API.withTimeout(primaryRawTask, 8000, 'lrchub')
        .catch(e => {
          console.warn('[BG] LRCHub selection timed out:', e);
          return null;
        });

      // LrcLib は LRCHub と同時に走らせる。
      //
      // 以前はこの下の「LRCHub を待つ 1.5 秒」が明けてから作っていたので、
      // LRCHub が遅い回はその 1.5 秒ぶん、まるごと何も始まっていなかった。
      // 行同期止まりの歌詞しか無い曲ほどこの待ちが体感に直結する。
      // LrcLib は公開 API で、無料枠の共用サーバー(SimpMusic / LyricsPlus)を
      // 気遣う理由もないため、常時並走させてよい。
      let lrcLibSettled = null;
      const lrcLibTask = use_lrclib
        ? API.withTimeout(API.fetchFromLrcLib(track, artist, duration_sec), 8000, 'lrclib')
          // 他の取得元と同じ関門を通す(別の曲のデータをここでも弾く)
          .then(res => asHubResult('LrcLib', res, 'lrclib'))
          .then(result => {
            if (result) {
              lrcLibSettled = result;
              offerProviderCandidate('lrclib', result.res);
            }
            return result;
          })
          .catch(e => {
            console.warn('[BG] LrcLib fetch failed:', e);
            return null;
          })
        : Promise.resolve(null);

      // SimpMusic も LRCHub と同時に走らせる。
      //
      // 以前は下の「LRCHub を待つ 1.5 秒」が明けてから作っていた。実測では
      // LRCHub の応答は 212ms 〜 4933ms とばらつきが大きく、4曲中2曲で
      // 1.5 秒を超えた。その回、SimpMusic は 336〜683ms で答えられたのに
      // 1.5 秒待たされていた。
      //
      // videoId ひとつの単純な GET で、しかもキャッシュがあるので1曲につき
      // 生涯1回しか叩かない。文字同期の主力でもあるので常時並走させる。
      // LyricsPlus はこの下のまま据え置く。track/artist/album/duration の
      // 検索をミラー横断で投げる重い経路で、実測でも3ミラーとも歌詞を
      // 返さない(502 / 429 / 402)。毎曲叩いても得るものが無い。
      let simpMusicSettled = null;
      const simpMusicRawTask = (typeof API.fetchFromSimpMusic === 'function' && resolvedVideoId)
        ? makeRawHubTask(
          'SimpMusic',
          API.fetchFromSimpMusic({ video_id: resolvedVideoId }),
          'SimpMusic',
          'simpmusic',
        ).then(result => {
          if (result) simpMusicSettled = result;
          return result;
        })
        : null;
      const simpMusicSelectionTask = simpMusicRawTask
        ? API.withTimeout(simpMusicRawTask, 6000, 'simpmusic').catch(() => null)
        : null;

      const earlyMarker = {};
      const earlyPrimary = await Promise.race([
        primarySelectionTask,
        API.delay(EARLY_HUB_WAIT_MS).then(() => earlyMarker),
      ]);
      if (earlyPrimary && earlyPrimary !== earlyMarker) {
        sendHubLyrics(earlyPrimary.res, earlyPrimary.source, earlyPrimary.providerId);
        pushBestResolvedHubUpgrade();
        // DynamicLRC (4) が先着していても、最上位の srv3 (5) を検索する。
        if (getHubLyricsQuality(earlyPrimary.res) < 5) {
          const earlySearchTask = makeRawHubTask(
            'LRCHub search',
            API.fetchFromLrchubSearch({ track, artist, limit: 30, translate_to, video_id: resolvedVideoId }),
            'LRCHub search'
          );
          await API.withTimeout(earlySearchTask, 5000, 'lrchub search upgrade').catch(() => null);
        }
        return;
      }

      // 先出しするのは LRCHub が「遅かった」回だけ。
      // 「持っていない」と即答した回まで先出しすると、そのあと来る
      // 単語同期(SimpMusic / LyricsPlus)に勝たせる機会を奪ってしまう。
      // その判定は下のフォールバック段に任せる。
      //
      // 遅かった回にかぎっては、もう手元にある歌詞を出してしまう。
      // 白紙のまま数秒待たせるよりは早く出す方がいい。
      // あとから LRCHub が届けば、品質を見て差し替わる。
      //
      // 出す順は「文字同期を持っている SimpMusic」→「LrcLib」。
      // SimpMusic を同時に走らせるようにしたので、遅い回ではたいてい
      // 先に届いている。ここで行同期の LrcLib を挟むと、すぐ下の
      // フォールバック段が SimpMusic を選び直して一瞬ちらつく。
      // 文字同期を要求するのは下の段と同じ基準。上流の取り込みが崩れた
      // レコードに「速かった」というだけで勝たせないため。
      if (earlyPrimary === earlyMarker) {
        if (simpMusicSettled && hasCharacterSyncedLines(simpMusicSettled.res?.dynamicLines)) {
          YTMLog.log('[BG] Won temporarily: SimpMusic (LRCHub slow)');
          sendHubLyrics(simpMusicSettled.res, simpMusicSettled.source, simpMusicSettled.providerId);
        } else if (lrcLibSettled) {
          YTMLog.log('[BG] Won temporarily: LrcLib (LRCHub slow)');
          sendOnce(buildLrcLibPayload(lrcLibSettled.res, true));
          deliveredProviderId = 'lrclib';
        }
      }

      const searchRawTask = makeRawHubTask(
        'LRCHub search',
        API.fetchFromLrchubSearch({ track, artist, limit: 30, translate_to, video_id: resolvedVideoId }),
        'LRCHub search'
      );
      // 引き直しは primary が答えられなかった時だけ。
      // 以前は同じパラメータの2本を必ず同時に投げていたので、LRCHub が
      // 素直に答えた曲でも1曲あたり常に2往復していた。
      let retryStarted = null;
      const startRetry = () => {
        if (!retryStarted) {
          retryStarted = makeRawHubTask(
            'LRCHub retry',
            API.fetchFromLrchub({
              track,
              artist,
              youtube_url,
              video_id: resolvedVideoId,
              offset_ms,
              translate_to,
              translation_source,
              method: lrchubLyricsMethod,
            }),
            'LRCHub retry'
          );
        }
        return retryStarted;
      };
      // 関門は primarySelectionTask(8秒で必ず決着する)側に置く。生の
      // primaryRawTask を待つと、LRCHub が黙り込んだ時に引き直しも
      // それを待つ形になり、下の allSettled がいつまでも返らない。
      const searchSelectionTask = API.withTimeout(searchRawTask, 5000, 'lrchub search').catch(() => null);
      const retryRawTask = primarySelectionTask.then(result => (result ? null : startRetry()));
      const retrySelectionTask = primarySelectionTask.then(result => (
        result ? null : API.withTimeout(startRetry(), 5000, 'lrchub retry').catch(() => null)
      ));
      const hubSelectionTask = firstValidResult([
        primarySelectionTask,
        searchSelectionTask,
        retrySelectionTask,
      ]);
      const rawHubTask = firstValidResult([
        primaryRawTask,
        searchRawTask,
        retryRawTask,
      ]);
      // ── 追加プロバイダー ──────────────────────────────────
      // LRCHub がここまでで歌詞を返せなかった曲だけが対象。
      // どちらも単語(音節)同期を返せるので LrcLib より前に置くが、
      // 勝ち抜けは早い者勝ちなので実際には3つの競走になる。
      // 立ち上げをここまで遅らせているのは、LRCHub が答えられる大半の曲で
      // 無料の共用サーバーを無駄に叩かないため。
      const lyricsPlusRawTask = (typeof API.fetchFromLyricsPlus === 'function')
        ? makeRawHubTask(
          'LyricsPlus',
          API.fetchFromLyricsPlus({ track, artist, album, duration: duration_sec }),
          'LyricsPlus',
          'lyricsplus',
        )
        : null;
      const lyricsPlusSelectionTask = lyricsPlusRawTask
        ? API.withTimeout(lyricsPlusRawTask, 8000, 'lyricsplus').catch(() => null)
        : null;

      // フォールバック段の中では、単語同期を返せる2つを LrcLib より優先したい。
      // ただ firstValidResult は純粋な早い者勝ちなので、ほぼ同時に返ると
      // 行同期止まりの LrcLib が勝ってしまう。LrcLib が先着した時だけ、
      // 短い猶予を置いて2つを待つ(LRCHub 対 LrcLib と同じ考え方)。
      const richFallbackTask = firstValidResult([
        simpMusicSelectionTask,
        lyricsPlusSelectionTask,
      ]);
      const fallbackSelectionTask = (async () => {
        const first = await firstValidResult([richFallbackTask, lrcLibTask]);
        if (!first) return first;

        if (first.providerId !== 'lrclib') {
          // 上の2つを LrcLib より前に置いている理由は「単語同期を返せるから」
          // の一点なので、行同期しか持って来なかった回はその理由が消える。
          // 実際、上流の取り込みが崩れて全行が1文字ずつ欠けたまま配信されて
          // いる曲があり、それでも「速かった」というだけで勝っていた。
          // 同じ品質どうしなら、より枯れている LrcLib に譲る。
          // 待つのは表示前の一度きり。画面に出たあとで差し替えはしない。
          if (hasCharacterSyncedLines(first.res?.dynamicLines)) return first;
          const lrcLibMarker = {};
          const lrcLib = await Promise.race([
            lrcLibTask,
            API.delay(FALLBACK_GRACE_MS).then(() => lrcLibMarker),
          ]);
          return (lrcLib && lrcLib !== lrcLibMarker) ? lrcLib : first;
        }

        const richMarker = {};
        const rich = await Promise.race([
          richFallbackTask,
          API.delay(FALLBACK_GRACE_MS).then(() => richMarker),
        ]);
        // ここでも条件は同じ。単語同期を持って来た時だけ LrcLib を追い越せる。
        if (rich && rich !== richMarker && hasCharacterSyncedLines(rich.res?.dynamicLines)) {
          return rich;
        }
        return first;
      })();

      const winner = await firstValidResult([hubSelectionTask, fallbackSelectionTask]);
      if (winner && winner.providerId === 'lrchub') {
        sendHubLyrics(winner.res, winner.source, winner.providerId);
        pushBestResolvedHubUpgrade();
        await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
        return;
      }

      if (winner) {
        // すでに LrcLib を先に出してある回は、ここで待つ意味が無い。
        // 表示は済んでいるので、あとは pushHubUpgrade が差し替える。
        // ここで待つと「出ているのに待たされる」時間が積み上がるだけ。
        if (!responded) {
          const graceMarker = {};
          const graceHub = await Promise.race([
            hubSelectionTask,
            API.delay(POST_FALLBACK_GRACE_MS).then(() => graceMarker),
          ]);
          if (graceHub && graceHub !== graceMarker) {
            sendHubLyrics(graceHub.res, graceHub.source, graceHub.providerId);
            pushBestResolvedHubUpgrade();
            await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
            return;
          }

          YTMLog.log(`[BG] Won temporarily: ${winner.source}`);
          if (winner.providerId === 'lrclib') {
            // LrcLib は行同期止まりなので、あとから LRCHub が届いたら譲る前提の
            // 「暫定表示」として扱う(fallbackUsed = true)。
            sendOnce(buildLrcLibPayload(winner.res, true));
            deliveredProviderId = 'lrclib';
          } else {
            sendHubLyrics(winner.res, winner.source, winner.providerId);
          }
        }
        pushBestResolvedHubUpgrade();

        const lateHub = await rawHubTask;
        if (lateHub) {
          YTMLog.log(`[BG] Upgrading ${winner.source} lyrics to ${lateHub.source}`);
          await pushHubUpgrade(lateHub);
        }
        return;
      }

      YTMLog.log('[BG] No lyrics found');
      sendOnce({
        success: false,
        lyrics: '',
        ...requestIdentity,
      });

      const lateHub = await firstValidResult([
        rawHubTask,
        simpMusicRawTask,
        lyricsPlusRawTask,
      ]);
      if (lateHub) {
        await pushHubUpgrade(lateHub);
      }
    })().catch((error) => {
      console.error('[BG] GET_LYRICS failed unexpectedly:', error);
      sendOnce({
        success: false,
        lyrics: '',
        request_id: request_id || null,
        track_key: track_key || null,
        track: track || '',
        artist: artist || '',
        video_id: resolvedVideoId || null,
      });
    });
    return true;
  }

  // 取得元をまたいだ候補のオンデマンド取得。
  //
  // GET_LYRICS は LRCHub が答えた時点で他へ問い合わせずに切り上げる
  // (答えられる大半の曲で無料の共用サーバーを無駄に叩かないため)。
  // その代わり、表示中の歌詞が曲に合っていない時に乗り換え先が
  // 1件も無い状態になる。ユーザーがメニューから明示的に頼んだ時だけ、
  // まだ聞いていない取得元を叩きにいく。自動では走らせない。
  if (req.type === 'FIND_ALTERNATE_LYRICS') {
    const {
      track,
      artist,
      album,
      duration_sec,
      youtube_url,
      video_id,
      exclude,
    } = req.payload || {};
    const alternateVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
    const skip = new Set(
      (Array.isArray(exclude) ? exclude : [])
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );

    (async () => {
      const tasks = [];
      const collect = (providerId, makePromise, label) => {
        if (skip.has(providerId)) return;
        tasks.push(
          Promise.resolve()
            .then(makePromise)
            .then(res => buildProviderCandidate(providerId, res))
            .catch(e => {
              console.warn(`[BG] ${label} alternate fetch failed:`, e);
              return null;
            })
        );
      };

      collect('lrchub', () => API.withTimeout(
        API.fetchFromLrchub({
          track,
          artist,
          youtube_url,
          video_id: alternateVideoId,
          method: 'POST',
        }),
        8000,
        'lrchub alternate'
      ), 'LRCHub');

      if (alternateVideoId && typeof API.fetchFromSimpMusic === 'function') {
        collect('simpmusic', () => API.withTimeout(
          API.fetchFromSimpMusic({ video_id: alternateVideoId }),
          8000,
          'simpmusic alternate'
        ), 'SimpMusic');
      }

      if (typeof API.fetchFromLyricsPlus === 'function') {
        collect('lyricsplus', () => API.withTimeout(
          API.fetchFromLyricsPlus({ track, artist, album, duration: duration_sec }),
          10000,
          'lyricsplus alternate'
        ), 'LyricsPlus');
      }

      collect('lrclib', () => API.withTimeout(
        API.fetchFromLrcLib(track, artist, duration_sec),
        8000,
        'lrclib alternate'
      ), 'LrcLib');

      const candidates = (await Promise.all(tasks)).filter(Boolean);
      YTMLog.log('[BG] FIND_ALTERNATE_LYRICS ->', candidates.map(c => c.lyricsSource));
      sendResponse({ success: true, candidates });
    })();
    return true;
  }

  if (req.type === 'GET_CANDIDATE_LYRICS') {
    const { candidate, translate_to, video_id, youtube_url } = req.payload || {};

    (async () => {
      try {
        const resolvedCandidateVideoId = video_id || API.extractVideoIdFromUrl(youtube_url) || '';
        const candRes = await API.fetchLrchubCandidateLyrics(candidate, translate_to, resolvedCandidateVideoId);
        if (candRes && candRes.lyrics && candRes.lyrics.trim()) {
          sendResponse({
            success: true,
            record_id: getLrchubRecordId(candRes) || getLrchubRecordId(candidate),
            lyrics: candRes.lyrics,
            lyricsComplete: true,
            animated_lyrics: candRes.animated_lyrics || candRes.timedtext || candRes.timed_text || null,
            dynamicLines: candRes.dynamicLines || null,
            offset_ms: Number.isFinite(Number(candRes.offset_ms)) ? Number(candRes.offset_ms) : 0,
            lyricsSource: 'lrchub',
            fallbackUsed: false,
            meaningData: candRes.meaningData || API.normalizeLrchubMeaningPayload(candRes),
            songSummary: candRes.songSummary || candRes.song_summary || candRes.final_summary || null,
            comments: Array.isArray(candRes.comments) ? candRes.comments : [],
            rating: candRes.rating || null,
            translations: candRes.translations || null,
            lrcMap: {
              ...API.normalizeLrchubTranslations(candRes.lrc_map),
              ...API.normalizeLrchubTranslations(candRes.translations),
              ...API.normalizeLrchubTranslations(candRes.lrcMap)
            },
            has_synced: /\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(candRes.lyrics)
          });
          return;
        }
        sendResponse({ success: false, lyrics: '' });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

  if (req.type === 'GET_TRANSLATION') {
    const payload = req.payload || {};
    const { track, artist, youtube_url, video_id, lang, langs, translation_source } = payload;

    (async () => {
      const vid = video_id || API.extractVideoIdFromUrl(youtube_url);
      const reqLangs = Array.isArray(langs) && langs.length ? langs : (lang ? [lang] : []);
      const translateTo = reqLangs.map(API.toLrchubTranslateLang).filter(Boolean);
      
      try {
        let lrcMap = {};
        if (translateTo.length) {
          const hubRes = await API.withTimeout(
            API.fetchFromLrchub({
              track,
              artist,
              youtube_url,
              video_id: video_id || vid,
              translate_to: translateTo,
              translation_source,
              method: 'GET'
            }),
            20000,
            'lrchub translation'
          );
          lrcMap = {
            ...API.normalizeLrchubTranslations(hubRes?.lrc_map),
            ...API.normalizeLrchubTranslations(hubRes?.translations),
            ...API.normalizeLrchubTranslations(hubRes?.lrcMap)
          };
        }

        if (Object.keys(lrcMap).length) {
          sendResponse({
            success: true,
            lrcMap,
            missing: reqLangs.filter(l => !lrcMap[API.toUiLangKey(l)])
          });
          return;
        }

        sendResponse({
          success: true,
          lrcMap: {},
          missing: reqLangs
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();
    return true;
  }

});
