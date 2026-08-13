// ============================================================
// YouTube Music 内部API (InnerTube) からの行同期歌詞取得
//
// ■ なぜ background ではなく content script でやるのか
//   YouTube は未知の Origin からの youtubei 呼び出しを 403 で弾く。
//   MV3 の Service Worker から fetch すると必ず
//   Origin: chrome-extension://<id> が付き、Origin は forbidden header
//   なので fetch 側から書き換えられない。
//   content script は music.youtube.com 上で動くため同一オリジンとなり、
//   Origin: https://music.youtube.com が付いて正常に通る。
//   → background からは FETCH_YTM_LYRICS メッセージでここに委譲する。
//
// ■ 仕組み
//   1. next   (WEB_REMIX)     … videoId → 歌詞タブの browseId (MPLYt...)
//   2. browse (ANDROID_MUSIC) … browseId → 行同期歌詞
//   同期版は ANDROID_MUSIC コンテキストでのみ返る。WEB_REMIX だと
//   プレーン歌詞しか返らない。判定は context.client の中身だけで行われ、
//   User-Agent は関係ない。
//
// ■ 実測での注意点
//   - UGC(歌ってみた等) は歌詞タブに unselectable が付く → browse を省略できる
//   - timedLyricsData があっても cueRange が全て 0 のことがある(約7%)
//     → 同期歌詞として使うと全行 00:00 に潰れるので必ず弾く
//   - 行単位のみ。文字カラオケは cueRange の実尺への均等配分で擬似的に作る
// ============================================================

(() => {
  const INNERTUBE = 'https://music.youtube.com/youtubei/v1';
  const CLIENT_WEB = { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00' };
  const CLIENT_MOBILE = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' };
  const TIMEOUT_MS = 5000;
  // カタログ楽曲の探索は複数リクエストを伴うので、全体の上限を別に設ける
  const RESOLVE_BUDGET_MS = 8000;

  // VISITOR_DATA はページの inline script 内にある。
  // documentElement.innerHTML だと DOM 全体(300KB超)を同期シリアライズしてしまうので、
  // script タグの textContent だけを走査する。
  // 取れなくても匿名で取得できるため、null のままでも機能する。
  // 失敗は恒久メモ化せず、次回また探す(初期 script が未挿入の場合があるため)。
  let cachedVisitorData = null;
  const getVisitorData = () => {
    if (cachedVisitorData) return cachedVisitorData;
    try {
      for (const s of document.scripts) {
        const txt = s.textContent;
        if (!txt || txt.indexOf('VISITOR_DATA') === -1) continue;
        const m = txt.match(/"VISITOR_DATA":"([^"]+)"/);
        if (m) { cachedVisitorData = m[1]; break; }
      }
    } catch (e) { /* 取れなくても続行 */ }
    return cachedVisitorData;
  };

  const post = async (endpoint, client, extra) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const visitorId = getVisitorData();
    try {
      const res = await fetch(`${INNERTUBE}/${endpoint}?prettyPrint=false`, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(visitorId ? { 'X-Goog-Visitor-Id': visitorId } : {}),
        },
        body: JSON.stringify({
          context: { client: { ...client, hl: 'ja', gl: 'JP' }, user: {} },
          ...extra,
        }),
      });
      if (!res.ok) throw new Error(`innertube ${endpoint} HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const formatLrcTime = (seconds) => {
    const total = Math.max(0, seconds);
    const min = Math.floor(total / 60);
    const sec = Math.floor(total - min * 60);
    const cs = Math.floor((total - min * 60 - sec) * 100);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const findLyricsTab = (nextRes) => {
    const tabs = nextRes?.contents?.singleColumnMusicWatchNextResultsRenderer
      ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const ep = tab?.tabRenderer?.endpoint?.browseEndpoint;
      const pageType = ep?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && ep.browseId) {
        return { browseId: ep.browseId, unselectable: !!tab.tabRenderer.unselectable };
      }
    }
    return null;
  };

  const readLyrics = (browseRes) => {
    const data = browseRes?.contents?.elementRenderer?.newElement?.type
      ?.componentType?.model?.timedLyricsModel?.lyricsData;

    if (Array.isArray(data?.timedLyricsData) && data.timedLyricsData.length) {
      const lines = data.timedLyricsData.map(item => ({
        text: String(item.lyricLine || ''),
        startMs: Number(item.cueRange?.startTimeMilliseconds ?? 0) || 0,
        endMs: Number(item.cueRange?.endTimeMilliseconds ?? 0) || 0,
      })).filter(l => l.text);

      if (lines.some(l => l.endMs > l.startMs)) {
        return { kind: 'timed', source: data.sourceMessage || null, lines };
      }

      // cueRange が全て 0。本文は正常なのでプレーン歌詞に降格させる。
      // ANDROID_MUSIC のレスポンスは contents 直下が elementRenderer のみで
      // sectionListRenderer を持たないため、下のパスには落ちてこない。
      console.warn('[YTM] cueRange が全て 0 のためプレーン歌詞として扱う');
      const flattened = lines.map(l => l.text).join('\n');
      if (flattened.trim()) {
        return { kind: 'plain', source: data.sourceMessage || null, text: flattened };
      }
    }

    // YTM が「この曲に歌詞は無い」と明示的に返しているケース。
    // 実測: 歌詞未登録の新譜は全クライアントで musicMessageModel が返る
    // (WEB_REMIX では contents.messageRenderer)。
    // 空レスポンスと区別しておくと、無駄なカタログ探索を省ける。
    const model = browseRes?.contents?.elementRenderer?.newElement?.type?.componentType?.model;
    if (model && model.musicMessageModel) return { kind: 'none' };
    if (browseRes?.contents?.messageRenderer) return { kind: 'none' };

    const shelf = browseRes?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer;
    const plain = (shelf?.description?.runs || []).map(r => r.text).join('');
    if (plain.trim()) {
      return {
        kind: 'plain',
        source: (shelf?.footer?.runs || []).map(r => r.text).join('') || null,
        text: plain,
      };
    }
    return null;
  };

  const toLrc = (lines) =>
    lines.map(l => `[${formatLrcTime(l.startMs / 1000)}] ${l.text}`).join('\n');

  // ── ここから: MV動画 → カタログ楽曲 の解決 ──────────────────────────
  //
  // 同じ曲でも「MV動画(OMV)」の videoId では歌詞タブが unselectable になり、
  // 同期歌詞が取れない。歌詞を持つのは「カタログ楽曲(ATV)」の videoId だけ。
  // InnerTube には OMV → ATV を1発で引く公式フィールドが無い(調査済み)。
  //
  // 唯一の確実な手がかりはアルバムページで、行の watchEndpoint.videoId が OMV、
  // 同じ行のメニュー "View song credits" の browseId が MPTC<ATVのvideoId> になっている。
  // つまり「アルバムさえ見つかれば、行の videoId 完全一致で曖昧さゼロに解決できる」。
  //
  // 誤マッチ（別の曲の歌詞を出す）は歌詞が出ないより有害なので、
  // 解決後に必ず artist channelId で照合してから採用する。
  // channelId は MV とカタログで一致し、hl/gl を変えても不変（表示名は変わる）。

  const MARKER_RE = [
    /instrumental/i, /インスト/, /カラオケ/, /karaoke/i, /off\s*vocal/i, /オフボーカル/,
    /cover/i, /カバー/, /歌ってみた/, /弾いてみた/, /演奏してみた/, /ガイドメロディ/,
    /原曲歌手/, /オルゴール/, /music\s*box/i, /piano/i, /ピアノ/,
    /remix/i, /リミックス/, /live/i, /ライブ/, /ライヴ/, /acoustic/i, /アコースティック/,
  ];
  const markersOf = (s) => MARKER_RE.filter(re => re.test(String(s || ''))).map(re => re.source);

  const toHalfWidth = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g,
    c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // 比較用の正規化。括弧の中身は丸ごと落とす（マーカー判定は正規化前に済ませること）
  const normTitle = (s) => toHalfWidth(s)
    .replace(/[【〔（(\[［「『].*?[】〕）)\]］」』]/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

  // 再生中の曲の 曲名 / アーティストchannelId を next のキュー先頭から取る
  const readSourceMeta = (nextRes) => {
    const item = nextRes?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents?.[0]?.playlistPanelVideoRenderer;
    if (!item) return null;
    const runs = item?.longBylineText?.runs || item?.shortBylineText?.runs || [];
    const channelIds = [...new Set(runs
      .map(r => r?.navigationEndpoint?.browseEndpoint?.browseId)
      .filter(b => b && b.startsWith('UC')))];
    return {
      title: (item?.title?.runs || []).map(r => r.text).join(''),
      artistName: runs[0]?.text || '',
      channelIds,
    };
  };

  // 再生中のページに出ているアルバムリンクを読む。
  // YTM 自身が画面に出している情報なので、検索より速く確実。
  // 無関係なアルバムも混ざるが、採用判定は「行の videoId 完全一致」なので
  // 誤ったアルバムを拾っても実害はない。
  const readAlbumIdsFromDom = () => {
    try {
      const ids = new Set();
      for (const a of document.querySelectorAll('a[href*="browse/MPREb"]')) {
        const m = String(a.getAttribute('href') || '').match(/(MPREb_[A-Za-z0-9_-]+)/);
        if (m) ids.add(m[1]);
      }
      return [...ids];
    } catch (e) {
      return [];
    }
  };

  // 検索(アルバム/曲)から、関連しそうなアルバム browseId を集める
  const findAlbumCandidates = async (query) => {
    const ids = new Set();
    for (const params of ['EgWKAQIYAWoKEAoQAxAEEAkQBQ%3D%3D', 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D']) {
      try {
        const res = await post('search', CLIENT_WEB, { query, params });
        for (const m of JSON.stringify(res).matchAll(/"browseId":"(MPREb_[A-Za-z0-9_-]+)"/g)) {
          ids.add(m[1]);
          if (ids.size >= 6) break;
        }
      } catch (e) { /* 片方失敗しても続行 */ }
      if (ids.size >= 6) break;
    }
    return [...ids];
  };

  const readAlbumRows = async (browseId) => {
    const res = await post('browse', CLIENT_WEB, { browseId });
    const rows = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const r = node.musicResponsiveListItemRenderer;
      if (r) {
        let catalogId = null;
        for (const mi of (r?.menu?.menuRenderer?.items || [])) {
          const b = mi?.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (b && b.startsWith('MPTC')) catalogId = b.slice(4);
        }
        rows.push({
          videoId: r?.playlistItemData?.videoId || null,
          catalogId,
          title: (r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
            .map(x => x.text).join(''),
        });
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(res?.contents);
    return rows;
  };

  // カタログ解決の結果をセッション中だけ覚えておく。
  // カタログ楽曲が存在しない曲(MV しか無い曲)では検索+アルバム走査が毎回空振りし、
  // 再生のたびに1秒以上を捨てることになるため、失敗も含めて記憶する。
  const resolveCache = new Map();

  const resolveCatalogVideoId = async (videoId, src, deadline) => {
    if (resolveCache.has(videoId)) return resolveCache.get(videoId);
    const remember = (v) => {
      if (resolveCache.size > 200) resolveCache.clear();
      resolveCache.set(videoId, v);
      return v;
    };
    if (!src || !src.title) return null;

    // ページに出ているアルバムを先に試す。当たれば検索を1回も撃たずに済む。
    // ただし DOM のリンクにはサイドバー等の無関係なアルバムも混ざるので、
    // 外れても必ず検索へ落ちるようにし、browse の総回数に上限を設ける。
    // DOM 側で枠を使い切ると検索に到達できなくなるため、枠は別々に持つ。
    const MAX_DOM_PROBES = 2;
    const MAX_SEARCH_PROBES = 3;
    const seenAlbums = new Set();
    const fetched = [];

    const probeAlbums = async (ids, budget) => {
      let probes = 0;
      for (const bid of ids) {
        if (probes >= budget) return null;
        if (seenAlbums.has(bid)) continue;
        seenAlbums.add(bid);
        // 曲が変わっている可能性もあるので、探索は打ち切り時刻で必ず止める
        if (Date.now() > deadline) {
          console.log('[YTM] カタログ探索を時間切れで打ち切り');
          return null;
        }
        probes += 1;
        const rows = await readAlbumRows(bid).catch(() => []);
        if (rows.length) fetched.push(rows);

        // 第1段: 再生中の videoId がアルバム行そのものにある = 曖昧さゼロ
        const exact = rows.find(r => r.videoId === videoId);
        if (exact && exact.catalogId && exact.catalogId !== videoId) {
          console.log(`[YTM] カタログ楽曲を特定 (行の完全一致): ${exact.catalogId}`);
          return exact.catalogId;
        }
      }
      return null;
    };

    const fromDom = await probeAlbums(readAlbumIdsFromDom(), MAX_DOM_PROBES);
    if (fromDom) return remember(fromDom);

    if (Date.now() <= deadline) {
      const query = `${src.title.replace(/[【〔].*?[】〕]/g, ' ').slice(0, 80)} ${src.artistName}`.trim();
      const fromSearch = await probeAlbums(await findAlbumCandidates(query), MAX_SEARCH_PROBES);
      if (fromSearch) return remember(fromSearch);
    }

    if (!fetched.length) return remember(null);

    // 第2段: アルバムに載っていない別動画。曲名一致で拾う。
    // アルバムは既にアーティストで絞れているうえ、採用前に channelId で再照合するので
    // ここは緩めでよいが、instrumental/カラオケ等のマーカー差は必ず弾く。
    const srcMarkers = markersOf(src.title);
    const wanted = normTitle(src.title);
    if (!wanted) return remember(null);
    for (const rows of fetched) {
      for (const r of rows) {
        if (!r.catalogId || r.catalogId === videoId) continue;
        if (markersOf(r.title).some(m => !srcMarkers.includes(m))) continue;
        if (normTitle(r.title) !== wanted) continue;
        console.log(`[YTM] カタログ楽曲を特定 (曲名一致): ${r.catalogId}`);
        return remember(r.catalogId);
      }
    }
    console.log('[YTM] カタログ楽曲が見つからない（この曲は YTM に同期歌詞が無い可能性が高い）');
    return remember(null);
  };
// ────────────────────────────────────────────────────────────────

  // videoId から同期歌詞を1回試す。取れなければ null。
  const tryFetch = async (videoId) => {
    const nextRes = await post('next', CLIENT_WEB, { videoId });
    const tab = findLyricsTab(nextRes);
    if (!tab || tab.unselectable) return { nextRes, result: null, browseId: null };
    const result = readLyrics(await post('browse', CLIENT_MOBILE, { browseId: tab.browseId }));
    return { nextRes, result, browseId: tab.browseId };
  };

  // MPLYt_<アルバムトークン>-<番号> は既にカタログ楽曲そのものを指している。
  // サフィックスの無い MPLYt_<11文字> は動画スコープなので、
  // カタログ側を探しに行く価値がある。
  const isCatalogScopedBrowseId = (id) => /^MPLYt_.+-\d+$/.test(String(id || ''));

  const fetchYtmLyrics = async (videoId) => {
    if (!videoId) return null;

    let { nextRes, result, browseId } = await tryFetch(videoId);

    // YTM が「歌詞なし」と明示していて、かつ既にカタログ楽曲を見ているなら、
    // これ以上探しても出てこない。約1.4秒の無駄な探索を省く。
    if (result && result.kind === 'none' && isCatalogScopedBrowseId(browseId)) {
      console.log(`[YTM] この曲は YouTube Music に歌詞が登録されていない (${browseId})`);
      return null;
    }

    // 同期歌詞が取れなかった場合のみ、カタログ楽曲へのフォールバックを試す。
    // (プレーン歌詞しか無い場合も、カタログ側なら同期版がありうるので試す価値がある)
    if (!result || result.kind !== 'timed') {
      const src = readSourceMeta(nextRes);
      const deadline = Date.now() + RESOLVE_BUDGET_MS;
      const catalogId = src ? await resolveCatalogVideoId(videoId, src, deadline).catch(() => null) : null;

      if (catalogId) {
        const alt = await tryFetch(catalogId);
        const altSrc = readSourceMeta(alt.nextRes);
        // 採用前の最終ゲート: アーティストが一致しないものは絶対に使わない
        const sameArtist = !!(altSrc && src && altSrc.channelIds.some(id => src.channelIds.includes(id)));
        if (!sameArtist) {
          console.warn(`[YTM] カタログ候補 ${catalogId} はアーティスト不一致のため破棄`);
        } else if (alt.result && alt.result.kind === 'timed') {
          console.log(`[YTM] カタログ楽曲 ${catalogId} から同期歌詞を取得`);
          result = alt.result;
        } else if ((!result || result.kind === 'none') && alt.result && alt.result.kind !== 'none') {
          result = alt.result;
        }
      }
    }

    if (!result || result.kind === 'none') return null;

    if (result.kind === 'timed') {
      // dynamicLines(文字単位カラオケ)は生成しない。
      // YTM は行単位の cueRange しか持たないため、文字ごとの時刻を作ると
      // 実際の歌唱とズレた不自然な「一文字追従」になる。
      // 行単位のハイライトに任せる方が、持っている情報に忠実。
      return {
        lyrics: toLrc(result.lines),
        dynamicLines: null,
        hasSynced: true,
        ytmSource: result.source,
        candidates: [],
      };
    }
    return {
      lyrics: result.text,
      dynamicLines: null,
      hasSynced: false,
      ytmSource: result.source,
      candidates: [],
    };
  };

  // lyrics-ui.js から直接呼ぶ。
  // background を経由しないのは、Service Worker からの fetch には
  // Origin: chrome-extension://<id> が付いて YouTube に 403 で弾かれるため。
  // この content script は music.youtube.com 上で動くので同一オリジンで通る。
  window.YTMLyrics = {
    fetch: (videoId) => fetchYtmLyrics(videoId).catch(err => {
      console.warn('[YTM] lyrics fetch failed:', err);
      return null;
    }),
  };
})();
