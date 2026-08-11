import * as CloudSync from './module/bg-cloud-sync.js';
import * as API from './module/api.js';

const getLrchubRecordId = (value) => {
  if (typeof API.getLrchubRecordId === 'function') return API.getLrchubRecordId(value);
  if (!value || typeof value !== 'object') return null;
  const id = value.record_id || value.recordId ||
    value.provider_meta?.record_id || value.provider_meta?.recordId ||
    value.providerMeta?.record_id || value.providerMeta?.recordId ||
    value.record?.record_id || value.record?.id || null;
  return id === null || id === undefined || id === '' ? null : String(id);
};

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

  if (req.type === 'SET_SERVER_BASE_URL') {
    const url = typeof req.serverBaseUrl === 'string' ? req.serverBaseUrl.trim() : '';
    CloudSync.saveCloudState({ serverBaseUrl: url || CloudSync.DEFAULT_CLOUD_STATE.serverBaseUrl })
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

  if (req.type === 'GET_COMMUNITY_REMAINING') {
    (async () => {
      try {
        const data = await API.fetchCommunityRemaining();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
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

    console.log('[BG] GET_LYRICS', { track, artist, lyric_source_mode });

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

      const hasCharacterSyncedLines = (value) => (
        Array.isArray(value) && value.some(line => (
          Array.isArray(line?.chars) && line.chars.some(char => {
            const hasText = [char?.c, char?.char, char?.text, char?.caption, char?.value]
              .some(text => String(text ?? '').length > 0);
            const hasTime = [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
              .some(time => time !== null && time !== undefined &&
                !(typeof time === 'string' && !time.trim()) && Number.isFinite(Number(time)));
            return hasText && hasTime;
          })
        ))
      );

      const getHubLyricsQuality = (hubRes) => {
        if (hasCharacterSyncedLines(hubRes?.dynamicLines)) return 4;
        const animated = hubRes?.animated_lyrics || hubRes?.timedtext || hubRes?.timed_text;
        if (typeof animated === 'string' && animated.trim()) return 3;
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

      const buildHubLyricsPayload = (hubRes, sourceLabel) => {
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
          lyricsSource: 'lrchub',
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
          console.debug('[BG] Late lyrics update skipped:', e);
          return false;
        }
      };

      const asHubResult = (source, res) => (
        res && typeof res.lyrics === 'string' && res.lyrics.trim()
          ? { source, res }
          : null
      );

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

      if (lyric_source_mode === 'lrclib') {
        try {
          const lrcLibRes = await API.withTimeout(
            API.fetchFromLrcLib(track, artist),
            8000,
            'lrclib only'
          );
          if (lrcLibRes && lrcLibRes.lyrics && lrcLibRes.lyrics.trim()) {
            console.log('[BG] Won: LrcLib (LrcLib Only Mode)');
            sendOnce(buildLrcLibPayload(lrcLibRes, false));
            return;
          }
        } catch (e) {
          console.warn('[BG] LrcLib fetch failed in LrcLib Only Mode:', e);
        }
        sendOnce({
          success: false,
          lyrics: '',
          ...requestIdentity,
        });
        return;
      }

      let deliveredHubQuality = 0;
      const resolvedHubResults = [];

      const sendHubLyrics = (hubRes, sourceLabel) => {
        console.log(`[BG] Won: ${sourceLabel}`);
        deliveredHubQuality = Math.max(deliveredHubQuality, getHubLyricsQuality(hubRes));
        sendOnce(buildHubLyricsPayload(hubRes, sourceLabel));
      };

      const pushHubUpgrade = async (hubResult) => {
        if (!responded || !hubResult?.res) return false;
        const quality = getHubLyricsQuality(hubResult.res);
        if (quality <= deliveredHubQuality) return false;
        deliveredHubQuality = quality;
        console.log(`[BG] Upgrading lyrics quality to ${hubResult.source} (${quality})`);
        return pushLyricsUpdate(buildHubLyricsPayload(hubResult.res, hubResult.source));
      };

      const pushBestResolvedHubUpgrade = () => {
        const best = resolvedHubResults
          .slice()
          .sort((a, b) => getHubLyricsQuality(b.res) - getHubLyricsQuality(a.res))[0];
        if (best) void pushHubUpgrade(best);
      };

      const makeRawHubTask = (source, promise, warningLabel) => (
        Promise.resolve(promise)
          .then(res => asHubResult(source, res))
          .then(result => {
            if (result) {
              resolvedHubResults.push(result);
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

      const earlyMarker = {};
      const earlyPrimary = await Promise.race([
        primarySelectionTask,
        API.delay(1500).then(() => earlyMarker),
      ]);
      if (earlyPrimary && earlyPrimary !== earlyMarker) {
        sendHubLyrics(earlyPrimary.res, earlyPrimary.source);
        pushBestResolvedHubUpgrade();
        if (getHubLyricsQuality(earlyPrimary.res) < 4) {
          const earlySearchTask = makeRawHubTask(
            'LRCHub search',
            API.fetchFromLrchubSearch({ track, artist, limit: 30, translate_to, video_id: resolvedVideoId }),
            'LRCHub search'
          );
          await API.withTimeout(earlySearchTask, 5000, 'lrchub search upgrade').catch(() => null);
        }
        return;
      }

      const searchRawTask = makeRawHubTask(
        'LRCHub search',
        API.fetchFromLrchubSearch({ track, artist, limit: 30, translate_to, video_id: resolvedVideoId }),
        'LRCHub search'
      );
      const retryRawTask = makeRawHubTask(
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
      const searchSelectionTask = API.withTimeout(searchRawTask, 5000, 'lrchub search').catch(() => null);
      const retrySelectionTask = API.withTimeout(retryRawTask, 5000, 'lrchub retry').catch(() => null);
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
      const lrcLibTask = use_lrclib
        ? API.withTimeout(API.fetchFromLrcLib(track, artist), 8000, 'lrclib')
          .then(res => (
            res && typeof res.lyrics === 'string' && res.lyrics.trim()
              ? { source: 'LrcLib', res }
              : null
          ))
          .catch(e => {
            console.warn('[BG] LrcLib fetch failed:', e);
            return null;
          })
        : Promise.resolve(null);

      const winner = await firstValidResult([hubSelectionTask, lrcLibTask]);
      if (winner && winner.source !== 'LrcLib') {
        sendHubLyrics(winner.res, winner.source);
        pushBestResolvedHubUpgrade();
        await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
        return;
      }

      if (winner && winner.source === 'LrcLib') {
        const graceMarker = {};
        const graceHub = await Promise.race([
          hubSelectionTask,
          API.delay(800).then(() => graceMarker),
        ]);
        if (graceHub && graceHub !== graceMarker) {
          sendHubLyrics(graceHub.res, graceHub.source);
          pushBestResolvedHubUpgrade();
          await Promise.allSettled([primarySelectionTask, searchSelectionTask, retrySelectionTask]);
          return;
        }

        console.log('[BG] Won temporarily: LrcLib');
        sendOnce(buildLrcLibPayload(winner.res, true));
        pushBestResolvedHubUpgrade();

        const lateHub = await rawHubTask;
        if (lateHub) {
          console.log(`[BG] Upgrading LrcLib lyrics to ${lateHub.source}`);
          await pushHubUpgrade(lateHub);
        }
        return;
      }

      console.log('[BG] No lyrics found');
      sendOnce({
        success: false,
        lyrics: '',
        ...requestIdentity,
      });

      const lateHub = await rawHubTask;
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

  if (req.type === 'REGISTER_TRANSLATION') {
    const { youtube_url, video_id, lang, lyrics } = req.payload;
    const body = { lang, lyrics };
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;

    fetch(`https://lrchub.coreone.work/api/translation?_=${API.getCacheBuster()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(json => {
        sendResponse({ success: !!json.ok, raw: json });
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true;
  }

});

self.addEventListener('fetch', (event) => {
  if (event.preloadResponse) {
    event.waitUntil(event.preloadResponse);
  }
});
