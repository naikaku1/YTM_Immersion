import * as CloudSync from './module/bg-cloud-sync.js';
import * as API from './module/api.js';


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

    const fetchSharedJson = async (payload) => {
      const tryFetch = async (url, init, label) => {
        const res = await API.withTimeout(fetch(url, init), 20000, label || 'shared translate timeout');
        const rawText = await res.text().catch(() => '');
        let data = null;
        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch (e) {
          // JSON 以外でも data は null のまま
        }
        if (!res.ok) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : (rawText || res.statusText);
          throw new Error(`shared translate http ${res.status}: ${msg}`);
        }
        if (!data || (data.ok !== undefined && !data.ok)) {
          const msg = (data && (data.error || data.message)) ? (data.error || data.message) : 'invalid response';
          throw new Error(`shared translate: ${msg}`);
        }
        return data;
      };

      const jsonInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };

      let lastErr = null;

      // 1) JSON で両方の URL を試す（/ の有無でリダイレクトが起きる環境対策）
      for (const url of API.SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, jsonInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      // 2) それでも駄目な場合、プリフライト回避用にフォーム送信も試す（サーバーが受ければ動く）
      //    ※ Content-Type を application/json にしない（simple request）
      const formBody = new URLSearchParams();
      if (Array.isArray(payload.text)) {
        // バッチはフォーム送信だと仕様が不明なので個別に任せる
        throw lastErr || new Error('shared translate failed');
      }
      formBody.set('text', String(payload.text ?? ''));
      formBody.set('target_lang', String(payload.target_lang ?? ''));
      const formInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: formBody.toString(),
      };

      for (const url of API.SHARED_TRANSLATE_ENDPOINTS) {
        try {
          return await tryFetch(url, formInit, 'shared translate timeout');
        } catch (e) {
          lastErr = e;
        }
      }

      throw lastErr || new Error('shared translate failed');
    };;

    const translateViaShared = async () => {
      const toTranslations = (arr) => arr.map(v => ({ text: (v ?? '').toString() }));

      // ★修正: 個別リクエストへのフォールバック (pMap) を完全に削除し、一括送信のみを行う
      try {
        // 全行をまとめて送信
        const data = await fetchSharedJson({ text: texts, target_lang: target });

        // パターン1: { text: ["訳文1", "訳文2"...] } の形式
        if (Array.isArray(data.text)) {
          return {
            translations: toTranslations(data.text),
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }

        // パターン2: { translations: [{text: "訳文1"}, ...] } の形式
        if (Array.isArray(data.translations)) {
          const mapped = data.translations.map(x => ({ text: (x && x.text !== undefined ? x.text : x) ?? '' }));
          return {
            translations: mapped,
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }

        // パターン3: 単一の文字列 (リクエストが1行だった場合など)
        if (typeof data.text === 'string') {
          return {
            translations: [{ text: data.text }],
            detected_source_language: data.detected_source_language || null,
            engine: data.engine || 'shared',
            plan: data.plan || null,
          };
        }

        // 想定外のフォーマット
        throw new Error('Invalid response format from shared API');

      } catch (e) {
        // バッチ失敗時はエラーを投げ、上位の DeepL フォールバックを作動させる
        console.warn('[BG] Shared batch translation failed:', e);
        throw e;
      }
    };

    (async () => {
      try {
        if (useSharedTranslateApi) {
          const shared = await translateViaShared();
          sendResponse({
            success: true,
            translations: shared.translations,
            detected_source_language: shared.detected_source_language,
            engine: shared.engine,
            plan: shared.plan,
          });
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
        // 共有翻訳が落ちてても DeepL キーがあれば自動フォールバック
        if (useSharedTranslateApi && apiKey) {
          try {
            const deepl = await translateViaDeepL();
            sendResponse({
              success: true,
              translations: deepl.translations,
              engine: deepl.engine,
              plan: deepl.plan,
              fallback_from: 'shared',
              fallback_error: String(e),
            });
            return;
          } catch (e2) {
            sendResponse({ success: false, error: `${String(e2)} (shared failed: ${String(e)})` });
            return;
          }
        }
        sendResponse({ success: false, error: String(e) });
      }
    })();

    return true;
  }


  // 歌詞取得
  if (req.type === 'GET_LYRICS') {
    const { track, artist, youtube_url, video_id } = req.payload || {};
    const tabId = sender && sender.tab ? sender.tab.id : null;

    console.log('[BG] GET_LYRICS (Hub + GitHub)', { track, artist });

    (async () => {
      const timeoutMs = 15000;

      const mergeCandidateLists = (...lists) => {
        const out = [];
        const seen = new Set();
        for (const list of lists) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const key = String(
              item.id ||
              item.candidate_id ||
              item.path ||
              item.select ||
              item.raw_url ||
              `${item.artist || ''}///${item.title || ''}`
            );
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(item);
          }
        }
        return out;
      };

      const pHub = API.withTimeout(
        API.fetchFromLrchub(track, artist, youtube_url, video_id),
        timeoutMs, 'lrchub'
      ).then(res => ({ source: 'hub', data: res })).catch(e => ({ source: 'hub', error: e }));

      const vidForGit = video_id || API.extractVideoIdFromUrl(youtube_url);
      let pGit = Promise.resolve({ source: 'git', data: { lyrics: '', dynamicLines: null, subLyrics: '', candidates: [] } });
      if (vidForGit) {
        pGit = API.fetchFromGithub(vidForGit)
          .then(res => ({ source: 'git', data: res }))
          .catch(e => ({ source: 'git', error: e }));
      }

      let responded = false;
      const sendOnce = (payload) => {
        if (responded) return;
        responded = true;
        sendResponse(payload);
      };

      const pushMetaUpdate = (meta) => {
        if (!tabId) return;
        try {
          chrome.tabs.sendMessage(tabId, { type: 'LYRICS_META_UPDATE', payload: meta });
        } catch (e) {
        }
      };

      let hubRes = null;
      let gitRes = null;

      const getHubCandidates = () => (hubRes && !hubRes.error && hubRes.data && Array.isArray(hubRes.data.candidates)) ? hubRes.data.candidates.slice() : [];
      const getGitCandidates = () => (gitRes && !gitRes.error && gitRes.data && Array.isArray(gitRes.data.candidates)) ? gitRes.data.candidates.slice() : [];

      const handleHub = async () => {
        hubRes = await pHub;
        const sharedCandidates = mergeCandidateLists(getGitCandidates(), getHubCandidates());
        const sharedConfig = hubRes && !hubRes.error && hubRes.data ? (hubRes.data.config || null) : null;
        const sharedRequests = hubRes && !hubRes.error && hubRes.data && Array.isArray(hubRes.data.requests) ? hubRes.data.requests.slice() : [];
        const hasCandidates = sharedCandidates.length > 0;

        if (!responded && hubRes && !hubRes.error && hubRes.data && hubRes.data.lyrics && hubRes.data.lyrics.trim()) {
          const d = hubRes.data;
          console.log('[BG] Won (fast): LRCHub');
          sendOnce({
            success: true,
            lyrics: d.lyrics,
            dynamicLines: d.dynamicLines || null,
            subLyrics: (typeof d.subLyrics === 'string' ? d.subLyrics : ''),
            hasSelectCandidates: d.hasSelectCandidates || hasCandidates,
            candidates: sharedCandidates,
            config: sharedConfig,
            requests: sharedRequests,
            githubFallback: false,
          });
          return;
        }

        if (responded && (hasCandidates || sharedConfig || (sharedRequests && sharedRequests.length))) {
          const vid = video_id || API.extractVideoIdFromUrl(youtube_url);
          pushMetaUpdate({
            video_id: vid,
            hasSelectCandidates: hasCandidates,
            candidates: sharedCandidates,
            config: sharedConfig,
            requests: sharedRequests,
          });
        }
      };

      const handleGit = async () => {
        gitRes = await pGit;
        const mergedCandidates = mergeCandidateLists(getGitCandidates(), getHubCandidates());

        try {
          if (gitRes && !gitRes.error && gitRes.data) {
            const meta = { video_id: vidForGit };
            let shouldPush = false;
            if (typeof gitRes.data.subLyrics === 'string' && gitRes.data.subLyrics.trim()) {
              meta.subLyrics = gitRes.data.subLyrics;
              shouldPush = true;
            }
            if (Array.isArray(gitRes.data.dynamicLines) && gitRes.data.dynamicLines.length) {
              meta.dynamicLines = gitRes.data.dynamicLines;
              shouldPush = true;
            }
            if (mergedCandidates.length) {
              meta.hasSelectCandidates = true;
              meta.candidates = mergedCandidates;
              shouldPush = true;
            }
            if (shouldPush) pushMetaUpdate(meta);
          }
        } catch (e) {
        }

        if (!responded && gitRes && !gitRes.error && gitRes.data && typeof gitRes.data.lyrics === 'string' && gitRes.data.lyrics.trim()) {
          const d = gitRes.data;
          console.log('[BG] Won (fast): GitHub');
          sendOnce({
            success: true,
            lyrics: d.lyrics,
            dynamicLines: d.dynamicLines || null,
            subLyrics: (typeof d.subLyrics === 'string' ? d.subLyrics : ''),
            hasSelectCandidates: mergedCandidates.length > 0,
            candidates: mergedCandidates,
            config: null,
            requests: [],
            githubFallback: true,
          });
        }
      };

      await Promise.allSettled([handleHub(), handleGit()]);
      if (responded) return;

      const sharedCandidates = mergeCandidateLists(getGitCandidates(), getHubCandidates());
      const sharedConfig = hubRes && !hubRes.error && hubRes.data ? (hubRes.data.config || null) : null;
      const sharedRequests = hubRes && !hubRes.error && hubRes.data && Array.isArray(hubRes.data.requests) ? hubRes.data.requests.slice() : [];
      const hasCandidates = sharedCandidates.length > 0;

      console.log('[BG] No lyrics found (Hub+GitHub)');
      sendOnce({
        success: false,
        lyrics: '',
        dynamicLines: null,
        hasSelectCandidates: hasCandidates,
        candidates: sharedCandidates,
        config: sharedConfig,
        requests: sharedRequests,
      });

    })();

    return true;
  }

  if (req.type === 'GET_CANDIDATE_LYRICS') {
    const payload = req.payload || {};
    const video_id = payload.video_id || API.extractVideoIdFromUrl(payload.youtube_url || '');
    const candidate_id = payload.candidate_id || null;
    const candidate = payload.candidate && typeof payload.candidate === 'object' ? payload.candidate : {};

    (async () => {
      try {
        const lyrics = await API.fetchCandidateLyrics(video_id, candidate_id, candidate);
        if (typeof lyrics === 'string' && lyrics.trim()) {
          sendResponse({
            success: true,
            lyrics: lyrics.trim(),
            candidate_id: candidate_id || candidate.id || candidate.candidate_id || null,
            path: candidate.path || candidate.select || candidate.name || candidate.file || candidate.filename || ''
          });
          return;
        }
        sendResponse({
          success: false,
          error: 'Candidate lyrics not found',
          candidate_id: candidate_id || candidate.id || candidate.candidate_id || null,
          path: candidate.path || candidate.select || candidate.name || candidate.file || candidate.filename || ''
        });
      } catch (e) {
        sendResponse({ success: false, error: String(e) });
      }
    })();

    return true;
  }

  if (req.type === 'SELECT_LYRICS_CANDIDATE') {
    const { youtube_url, video_id, candidate_id, request, action, lock } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (candidate_id) body.candidate_id = candidate_id;
    const reqKey = request || action;
    if (reqKey) body.request = reqKey;
    if (typeof lock !== 'undefined') body.lock = String(lock);

    if ((!body.youtube_url && !body.video_id) || (!body.candidate_id && !body.request)) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/lyrics_select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, raw: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }

  if (req.type === 'GET_TRANSLATION') {
    const payload = req.payload || {};
    const { youtube_url, video_id, lang, langs } = payload;

    (async () => {
      const reqLangs = Array.isArray(langs) && langs.length ? langs : (lang ? [lang] : []);
      if (!reqLangs.length) {
        sendResponse({ success: true, lrcMap: {}, missing: [] });
        return;
      }

      const vid = video_id || API.extractVideoIdFromUrl(youtube_url);
      const lrcMap = {};
      const missingSet = new Set();

      // 1) GitHub translation/<lang>.txt を最優先で試す
      if (vid) {
        await Promise.all(reqLangs.map(async (l) => {
          const url = `https://raw.githubusercontent.com/LRCHub/${vid}/main/translation/${l}.txt`;
          try {
            const r = await fetch(url, { cache: 'no-store' });
            if (!r.ok) return;
            const text = (await r.text()) || '';
            if (text.trim()) {
              lrcMap[l] = text;
            }
          } catch (e) {
          }
        }));
      }

      const remaining = reqLangs.filter(l => !(l in lrcMap));

      // 2) まだ無いものだけ LRCHub API にフォールバック
      if (remaining.length) {
        try {
          const url = new URL('https://lrchub.coreone.work/api/translation');
          if (youtube_url) url.searchParams.set('youtube_url', youtube_url);
          else if (video_id) url.searchParams.set('video_id', video_id);
          else if (vid) url.searchParams.set('video_id', vid);

          remaining.forEach(l => url.searchParams.append('lang', l));

          const text = await fetch(url.toString(), { method: 'GET' }).then(r => r.text());
          try {
            const json = JSON.parse(text);
            if (json && json.lrc_map) {
              Object.keys(json.lrc_map).forEach(k => {
                if (!lrcMap[k] && json.lrc_map[k]) lrcMap[k] = json.lrc_map[k];
              });
            }
            const missing = json.missing_langs || [];
            missing.forEach(m => missingSet.add(m));
          } catch (e) {
            // JSON parse failed -> treat as missing
            remaining.forEach(m => missingSet.add(m));
          }
        } catch (e) {
          remaining.forEach(m => missingSet.add(m));
        }
      }

      // GitHub + API どちらにも無かった lang を missing に入れる
      reqLangs.forEach(l => {
        if (!lrcMap[l]) missingSet.add(l);
      });

      sendResponse({ success: true, lrcMap, missing: Array.from(missingSet) });
    })().catch(err => sendResponse({ success: false, error: String(err) }));

    return true;
  }


  if (req.type === 'REGISTER_TRANSLATION') {
    const { youtube_url, video_id, lang, lyrics } = req.payload;
    const body = { lang, lyrics };
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;

    fetch('https://lrchub.coreone.work/api/translation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, raw: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
      })
      .catch(err => sendResponse({ success: false, error: err.toString() }));

    return true;
  }

  if (req.type === 'SHARE_REGISTER') {
    const { youtube_url, video_id, phrase, text, lang, time_ms, time_sec } = req.payload || {};
    const body = {};
    if (youtube_url) body.youtube_url = youtube_url;
    else if (video_id) body.video_id = video_id;
    if (phrase || text) body.phrase = phrase || text;
    if (lang) body.lang = lang;
    if (typeof time_ms === 'number') body.time_ms = time_ms;
    else if (typeof time_sec === 'number') body.time_sec = time_sec;

    if ((!body.youtube_url && !body.video_id) || !body.phrase) {
      sendResponse({ success: false, error: 'missing params' });
      return;
    }

    fetch('https://lrchub.coreone.work/api/share/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.text())
      .then(text => {
        try {
          const json = JSON.parse(text);
          sendResponse({ success: !!json.ok, data: json });
        } catch (e) {
          sendResponse({ success: false, error: 'Invalid JSON', raw: text });
        }
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

