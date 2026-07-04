// ===================== Liquid Glass Module =====================
// Aave「Building Glass for the Web」流のリキッドグラス実装。
// canvas で生成した変位マップ (R=横曲げ / G=縦曲げ / 128=中立) を
// feImage → feDisplacementMap に流し込み、backdrop-filter: url(#...) で
// 「本物の屈折レンズ」を実現する。色収差はスケール違いの3パス合成。
//
// ティア構成:
//   Tier 1: SVGフィルタによる真の屈折 (プローブ成功時のみ body.ytm-lg-on)
//   Tier 2: 高品位 blur() ガラス + 粒子/ハイライト (body.ytm-lg-fx / style.css 側)
//   Tier 3: 既存の半透明背景のみ (クラス無し = 従来の見た目)
//
// パフォーマンス原則:
//   - 変位マップの再生成は ResizeObserver 契機のみ。毎フレーム再生成は絶対にしない
//     (位置の変化はコストゼロ — フィルタは要素に追従する)。
//   - RAFループ (events.js tick / lyricsLoader / progressHandle) には一切コードを足さない。
//   - マップはサイズ+形状キーでキャッシュし、DPR は 2 でキャップする。
//   - 同時レンズ数はアーキタイプ5種 (bar/nav/pill/toast/pop) に抑える。

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const DEFS_SVG_ID = 'ytm-lg-defs';
  const GRAIN_ID = 'ytm-lg-grain';

  // 1x1 透明PNG。ホストページCSPが feImage の data: 読み込みを許すかのプローブ用
  const PROBE_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // 面アーキタイプ定義。cssVar は style.css 側の var(--ytm-lg-filter-*) と対応する。
  //   radius    : 角丸 (css px)
  //   bezel     : 屈折する縁バンドの幅 (css px)
  //   curvature : 変位プロファイルの指数 (大きいほど縁に張り付く)
  //   scale     : リム最大変位 (css px, ガラスの「深さ」)
  //   chroma    : 色収差量 (記事のデモ値 0.20 前後)
  //   blur      : フロスト量 (css px) / saturate : 彩度ブースト
  //   size      : 代表サイズ。bar/nav は ResizeObserver で実寸に更新される
  const SURFACES = {
    bar:   { cssVar: '--ytm-lg-filter-bar',   radius: 40, bezel: 34, curvature: 2.2, scale: 26, chroma: 0.20, blur: 5,  saturate: 1.7, size: [975, 80] },
    nav:   { cssVar: '--ytm-lg-filter-nav',   radius: 20, bezel: 18, curvature: 2.2, scale: 18, chroma: 0.20, blur: 8,  saturate: 1.6, size: [1100, 64] },
    pill:  { cssVar: '--ytm-lg-filter-pill',  radius: 17, bezel: 13, curvature: 2.0, scale: 12, chroma: 0.25, blur: 3,  saturate: 1.5, size: [96, 35] },
    toast: { cssVar: '--ytm-lg-filter-toast', radius: 20, bezel: 15, curvature: 2.0, scale: 13, chroma: 0.22, blur: 6,  saturate: 1.5, size: [240, 40] },
    pop:   { cssVar: '--ytm-lg-filter-pop',   radius: 18, bezel: 16, curvature: 2.2, scale: 16, chroma: 0.20, blur: 10, saturate: 1.6, size: [280, 220] }
  };

  // 内部状態
  let inited = false;
  let enabled = true;        // 設定トグル (ytm_liquid_glass)
  let grainReady = false;    // 粒子フィルタ defs 注入済みか
  let tier1Ready = false;    // 屈折フィルタが使える状態か (プローブ成功 + フィルタ構築済み)
  let filterSeq = 0;         // フレッシュな id を毎回振るための連番 (フィルタ出力キャッシュ対策)
  const mapCache = new Map();      // 変位マップキャッシュ: "wxhxrxbezxcv" -> dataUri
  const liveFilterNodes = {};      // アーキタイプ -> 現行 <filter> ノード
  const resizeTimers = {};         // アーキタイプ -> デバウンスタイマー
  const lastSizes = {};            // アーキタイプ -> 直近の実寸
  const observedEls = new WeakSet();
  let finderTimer = null;

  // ---------- ユーティリティ ----------

  const createSvgEl = (doc, name, attrs) => {
    const el = doc.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    }
    return el;
  };

  // 隠しSVG (defs 置き場)。display:none はエンジンによってフィルタが無効化されるため
  // 0x0 の fixed で置く。
  const ensureDefsRoot = (doc) => {
    let svg = doc.getElementById(DEFS_SVG_ID);
    if (svg) return svg.querySelector('defs');
    svg = createSvgEl(doc, 'svg', {
      id: DEFS_SVG_ID,
      width: '0',
      height: '0',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;';
    const defs = createSvgEl(doc, 'defs');
    svg.appendChild(defs);
    (doc.body || doc.documentElement).appendChild(svg);
    return defs;
  };

  // 粒子ノイズフィルタ (feTurbulence — 画像を読まないので CSP セーフ)。
  // ::after のスペキュラグラデの上に ~数% の白ノイズを乗せてバンディングを防ぐ。
  const buildGrainFilter = (doc, defs) => {
    if (doc.getElementById(GRAIN_ID)) return;
    const f = createSvgEl(doc, 'filter', {
      id: GRAIN_ID,
      x: '-10%', y: '-10%', width: '120%', height: '120%',
      'color-interpolation-filters': 'sRGB'
    });
    f.appendChild(createSvgEl(doc, 'feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: '0.8',
      numOctaves: '2',
      seed: '7',
      stitchTiles: 'stitch',
      result: 'ytmLgNoise'
    }));
    // 輝度 → 微小アルファの白粒子へ
    f.appendChild(createSvgEl(doc, 'feColorMatrix', {
      in: 'ytmLgNoise',
      type: 'matrix',
      values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.05 0.05 0.05 0 0',
      result: 'ytmLgGrainWhite'
    }));
    f.appendChild(createSvgEl(doc, 'feComposite', {
      in: 'ytmLgGrainWhite',
      in2: 'SourceGraphic',
      operator: 'over'
    }));
    defs.appendChild(f);
  };

  // ---------- 変位マップ生成 ----------
  // 角丸矩形のSDF(符号付き距離場)の勾配方向に沿って、縁バンド内だけ内向きに変位。
  // 記事の4回対称最適化: 左上1/4象限のみ計算し、X/Y を符号反転して4象限へミラー
  // (ピクセル計算量 25%)。
  const generateDisplacementMap = (w, h, radius, bezel, curvature) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // DPRは2でキャップ
    const mapW = Math.max(2, Math.round(w * dpr));
    const mapH = Math.max(2, Math.round(h * dpr));
    const key = `${mapW}x${mapH}x${radius}x${bezel}x${curvature}`;
    const cached = mapCache.get(key);
    if (cached) return cached;

    const r = Math.min(radius * dpr, mapW / 2, mapH / 2);
    const bez = Math.min(bezel * dpr, mapW / 2, mapH / 2);
    const cv = document.createElement('canvas');
    cv.width = mapW;
    cv.height = mapH;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(mapW, mapH);
    const d = img.data;
    const halfW = Math.ceil(mapW / 2);
    const halfH = Math.ceil(mapH / 2);
    const cx = mapW / 2;
    const cy = mapH / 2;
    const ex = mapW / 2 - r; // 直線エッジの半長
    const ey = mapH / 2 - r;

    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        // 中心基準の座標 (負象限)
        const px = x + 0.5 - cx;
        const py = y + 0.5 - cy;
        const qx = Math.abs(px) - ex;
        const qy = Math.abs(py) - ey;
        const ax = Math.max(qx, 0);
        const ay = Math.max(qy, 0);
        const outside = Math.hypot(ax, ay);
        const sdf = outside + Math.min(Math.max(qx, qy), 0) - r; // 内側で負
        let dx = 0;
        let dy = 0;
        if (sdf < 0 && -sdf < bez) {
          // 縁バンド内: SDF勾配 (外向き法線) に沿って変位。
          // リムで最大、バンド内端で 0 に減衰する curvature プロファイル。
          const t = 1 - (-sdf / bez);
          const m = Math.pow(t, curvature);
          let gx;
          let gy;
          if (outside > 0) {
            gx = ax / outside;
            gy = ay / outside;
          } else if (qx > qy) {
            gx = 1;
            gy = 0;
          } else {
            gx = 0;
            gy = 1;
          }
          // 負象限なので符号を戻す
          gx *= Math.sign(px) || -1;
          gy *= Math.sign(py) || -1;
          dx = -gx * m; // 内向きに曲げてレンズの拡大鏡っぽい見た目に
          dy = -gy * m;
        }
        const R = Math.round(128 + dx * 127);
        const G = Math.round(128 + dy * 127);
        const mx = mapW - 1 - x;
        const my = mapH - 1 - y;
        // 4象限に書き込み (縦軸ミラーで X 反転、横軸ミラーで Y 反転)
        let i = (y * mapW + x) * 4;
        d[i] = R; d[i + 1] = G; d[i + 2] = 128; d[i + 3] = 255;
        i = (y * mapW + mx) * 4;
        d[i] = 255 - R; d[i + 1] = G; d[i + 2] = 128; d[i + 3] = 255;
        i = (my * mapW + x) * 4;
        d[i] = R; d[i + 1] = 255 - G; d[i + 2] = 128; d[i + 3] = 255;
        i = (my * mapW + mx) * 4;
        d[i] = 255 - R; d[i + 1] = 255 - G; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const result = cv.toDataURL('image/png');
    if (mapCache.size > 24) mapCache.clear(); // 念のため無限成長を防ぐ
    mapCache.set(key, result);
    return result;
  };

  // ---------- SVGフィルタ構築 ----------
  // primitiveUnits=objectBoundingBox なので、px 値は bbox 基準に正規化して渡す。
  //   feDisplacementMap.scale : 1 = bbox対角 / sqrt(2)
  //   feGaussianBlur.stdDeviation : X は幅基準・Y は高さ基準の2値
  const obbScale = (px, w, h) => px / (Math.hypot(w, h) / Math.SQRT2);

  // 色収差 = スケール違いの変位3パス (R/G/B) を加算合成。
  // アルファは3重加算にならないよう B パスだけに乗せる。
  const buildLensFilter = (surfaceKey, mapUri, s, w, h) => {
    const defs = ensureDefsRoot(document);
    filterSeq += 1;
    const id = `ytm-lg-${surfaceKey}-${filterSeq}`; // 毎回フレッシュな id (フィルタ出力キャッシュ対策)
    const doc = document;
    const f = createSvgEl(doc, 'filter', {
      id: id,
      x: '0', y: '0', width: '100%', height: '100%',
      'color-interpolation-filters': 'sRGB', // 必須。既定の linearRGB は中立グレー128がズレる
      primitiveUnits: 'objectBoundingBox'
    });

    const feImage = createSvgEl(doc, 'feImage', {
      x: '0', y: '0', width: '1', height: '1',
      preserveAspectRatio: 'none',
      result: 'ytmLgMap'
    });
    feImage.setAttribute('href', mapUri);
    feImage.setAttributeNS(XLINK_NS, 'xlink:href', mapUri);
    f.appendChild(feImage);

    const passes = [
      // [結果名, 変位スケール, カラーマトリクス(アルファはBパスのみ)]
      ['R', s.scale * (1 + s.chroma), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 0'],
      ['G', s.scale,                  '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 0'],
      ['B', s.scale * (1 - s.chroma), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']
    ];
    passes.forEach(([ch, px, matrix]) => {
      f.appendChild(createSvgEl(doc, 'feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'ytmLgMap',
        scale: String(obbScale(px, w, h)),
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: `ytmLgD${ch}`
      }));
      f.appendChild(createSvgEl(doc, 'feColorMatrix', {
        in: `ytmLgD${ch}`,
        type: 'matrix',
        values: matrix,
        result: `ytmLgC${ch}`
      }));
    });

    // 加算合成 (k2 + k3) で3チャンネルを再結合
    f.appendChild(createSvgEl(doc, 'feComposite', {
      in: 'ytmLgCR', in2: 'ytmLgCG',
      operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0',
      result: 'ytmLgCRG'
    }));
    f.appendChild(createSvgEl(doc, 'feComposite', {
      in: 'ytmLgCRG', in2: 'ytmLgCB',
      operator: 'arithmetic', k1: '0', k2: '1', k3: '1', k4: '0',
      result: 'ytmLgRefract'
    }));

    // フロスト + 彩度ブースト (CSS 側は url() 1発で済むようフィルタ内に持つ)
    f.appendChild(createSvgEl(doc, 'feGaussianBlur', {
      in: 'ytmLgRefract',
      stdDeviation: `${s.blur / w} ${s.blur / h}`,
      result: 'ytmLgBlur'
    }));
    f.appendChild(createSvgEl(doc, 'feColorMatrix', {
      in: 'ytmLgBlur',
      type: 'saturate',
      values: String(s.saturate)
    }));

    defs.appendChild(f);
    return { id: id, node: f };
  };

  // フィルタを再構築して CSS 変数を差し替える。
  // 旧ノードは次フレームで除去 (先に消すと1フレーム未フィルタが挟まる)。
  const rebuildSurface = (surfaceKey, w, h) => {
    const s = SURFACES[surfaceKey];
    if (!s) return;
    try {
      const mapUri = generateDisplacementMap(w, h, s.radius, s.bezel, s.curvature);
      const built = buildLensFilter(surfaceKey, mapUri, s, w, h);
      document.documentElement.style.setProperty(s.cssVar, `url("#${built.id}")`);
      const old = liveFilterNodes[surfaceKey];
      liveFilterNodes[surfaceKey] = built.node;
      if (old && old.parentNode) {
        requestAnimationFrame(() => {
          if (old.parentNode) old.parentNode.removeChild(old);
        });
      }
      lastSizes[surfaceKey] = [w, h];
    } catch (e) {
      console.warn('[YTM Immersion] LiquidGlass: filter rebuild failed:', e);
    }
  };

  // ---------- サイズ追従 (bar / nav のみ実寸追従) ----------
  // 記事のパフォーマンス原則: マップ再生成は「サイズが変わったときだけ」。
  const scheduleRebuild = (surfaceKey, w, h) => {
    const prev = lastSizes[surfaceKey];
    if (prev && Math.abs(prev[0] - w) < 1 && Math.abs(prev[1] - h) < 1) return;
    clearTimeout(resizeTimers[surfaceKey]);
    resizeTimers[surfaceKey] = setTimeout(() => rebuildSurface(surfaceKey, w, h), 120);
  };

  const observeSurfaceEl = (surfaceKey, el) => {
    if (!el || observedEls.has(el)) return;
    observedEls.add(el);
    try {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          let w = 0;
          let h = 0;
          const bb = entry.borderBoxSize && entry.borderBoxSize[0];
          if (bb) {
            w = bb.inlineSize;
            h = bb.blockSize;
          } else {
            const rect = entry.target.getBoundingClientRect();
            w = rect.width;
            h = rect.height;
          }
          if (w > 1 && h > 1) scheduleRebuild(surfaceKey, w, h);
        }
      });
      ro.observe(el, { box: 'border-box' });
    } catch (e) {
      // ResizeObserver が使えなくても代表サイズのフィルタで動く
    }
  };

  // プレイヤーバー / ナビバーは Polymer 管理の常設要素。
  // 出現まで軽量リトライで探す (RAFループには乗せない)。
  const findAndObserve = () => {
    const bar = document.querySelector('ytmusic-player-bar');
    if (bar) observeSurfaceEl('bar', bar);
    const nav = document.querySelector('ytmusic-nav-bar');
    if (nav) observeSurfaceEl('nav', nav);
    return !!(bar && nav);
  };

  const startElementFinder = () => {
    if (findAndObserve()) return;
    let tries = 0;
    clearInterval(finderTimer);
    finderTimer = setInterval(() => {
      tries += 1;
      if (findAndObserve() || tries > 60) {
        clearInterval(finderTimer);
        finderTimer = null;
      }
    }, 500);
  };

  // ---------- ティア判定 ----------

  const supportsSvgBackdrop = () => {
    try {
      return CSS.supports('backdrop-filter', 'url(#x)') ||
        CSS.supports('-webkit-backdrop-filter', 'url(#x)');
    } catch (e) {
      return false;
    }
  };

  // feImage の data: 読み込みはホストページの img-src CSP に従うため実行時プローブする
  const probeDataImage = (cb) => {
    try {
      const img = new Image();
      img.onload = () => cb(true);
      img.onerror = () => cb(false);
      img.src = PROBE_PNG;
    } catch (e) {
      cb(false);
    }
  };

  // ---------- クラスゲート ----------
  // body.ytm-lg-fx : defs 注入済み (粒子 + ハイライト装飾が有効)
  // body.ytm-lg-on : Tier 1 屈折フィルタ有効 (style.css の url() ルールが発火)
  const applyClasses = () => {
    const body = document.body;
    if (!body) return;
    body.classList.toggle('ytm-lg-fx', enabled && grainReady);
    body.classList.toggle('ytm-lg-on', enabled && tier1Ready);
  };

  // Tier 1 有効化: 全アーキタイプのフィルタを構築してから ytm-lg-on を付与する
  // (url() 参照切れ = backdrop-filter 全滅の Chromium 挙動があるため、順序が重要)
  const enableTier1 = () => {
    Object.keys(SURFACES).forEach((key) => {
      const s = SURFACES[key];
      const size = lastSizes[key] || s.size;
      rebuildSurface(key, size[0], size[1]);
    });
    tier1Ready = true;
    applyClasses();
    startElementFinder();
    // ウィンドウリサイズで要素が差し替わった場合に備えて再探索 (イベント駆動のみ)
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimers._find);
      resizeTimers._find = setTimeout(findAndObserve, 300);
    });
  };

  // ---------- 公開API ----------

  const LiquidGlass = {
    init() {
      if (inited) return;
      inited = true;
      try {
        // 粒子フィルタは CSP セーフなので無条件に注入 (Tier 2 でも使う)
        const defs = ensureDefsRoot(document);
        buildGrainFilter(document, defs);
        grainReady = true;
      } catch (e) {
        console.warn('[YTM Immersion] LiquidGlass: defs injection failed:', e);
      }

      // 設定トグルの読み込み (既存の --ytm-bg-brightness と同じ流儀で storage から)
      const applySaved = (saved) => {
        if (saved !== undefined && saved !== null) enabled = !!saved;
        if (window.ConfigModule?.ConfigManager) {
          window.ConfigModule.ConfigManager.set('liquidGlass', enabled);
        }
        applyClasses();
      };
      try {
        if (window.Storage?.storage) {
          window.Storage.storage.get('ytm_liquid_glass')
            .then(applySaved)
            .catch(() => applySaved(undefined));
        } else {
          applySaved(undefined);
        }
      } catch (e) {
        applySaved(undefined);
      }

      // Tier 1 プローブ
      if (supportsSvgBackdrop()) {
        probeDataImage((ok) => {
          if (ok) {
            enableTier1();
            console.log('[YTM Immersion] LiquidGlass: Tier 1 (refraction) enabled');
          } else {
            applyClasses();
            console.log('[YTM Immersion] LiquidGlass: data: image blocked, staying on Tier 2');
          }
        });
      } else {
        applyClasses();
        console.log('[YTM Immersion] LiquidGlass: svg backdrop-filter unsupported, staying on Tier 2');
      }
    },

    // 設定トグル。永続化は呼び出し側 (uiManager / config) が行う
    setEnabled(v) {
      enabled = !!v;
      applyClasses();
    },

    isEnabled: () => enabled,

    getTier: () => (tier1Ready ? 1 : (grainReady ? 2 : 3)),

    // 別 document (PiPウィンドウ) に粒子フィルタ defs を複製する。
    // backdrop-filter: url(#...) は同一 document 内の defs しか参照できないため。
    injectGrainDefs(doc) {
      try {
        if (!doc || doc.getElementById(GRAIN_ID)) return;
        const defs = ensureDefsRoot(doc);
        buildGrainFilter(doc, defs);
      } catch (e) {
        console.warn('[YTM Immersion] LiquidGlass: PiP grain injection failed:', e);
      }
    }
  };

  // Export for module system
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LiquidGlass };
  } else {
    window.LiquidGlassModule = { LiquidGlass };
  }

})();
