  const PipManager = {
    async start() {
      if (document.pictureInPictureElement) return;


      try {
        this.pipWindow = await documentPictureInPicture.requestWindow({
          width: 380,
          height: 600,
        });
      } catch (e) {
        console.error('PiP failed:', e);
        return;
      }

      // 新しい窓のアイコンは初期状態。前の窓で覚えた値が残っていると
      // 「同じだから触らない」で正しく出ないので、開くたびに忘れる。
      this._lastPlayStateIsPaused = null;

      const pipDoc = this.pipWindow.document;

    
      // ここで document.styleSheets の href を PIP に複製していたが、
      // 拾えるのは YTM 本体の CSS だけ。拡張の CSS は manifest 注入なので
      // styleSheets には href 付きで出てこない。PIP に要らない CSS を
      // 読み込ませるだけだったので外した。PIP の見た目は下の forceStyle と
      // updateLyrics 側が全部持っている。
      
      
      
const forceStyle = pipDoc.createElement('style');
      forceStyle.textContent = `
        /* 画面全体：SF Proへのこだわりと背景の固定 */
        html, body {
          margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background: #000;
          position: fixed; inset: 0;
          font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
          color: #fff; cursor: default;
          -webkit-font-smoothing: antialiased;
        }
        
        #pip-container {
          position: absolute; inset: 0; overflow: hidden;
          isolation: isolate; 
        }
        
        /* 背景レイヤー：明るさを0.8まで上げ、ブラーを滑らかに */
        #pip-bg-layer {
          position: absolute; inset: -20%;
          background-size: cover; background-position: center;
          filter: blur(80px) saturate(1.4) brightness(0.8);
          z-index: -3; transition: background-image 1.2s ease;
        }
        
        #pip-noise-layer {
          position: absolute; inset: 0; z-index: -2; opacity: 0.04; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
        }
        
        /* ヘッダー：アートワークと文字の階層を明確に */
        .pip-header {
            position: absolute; top: 0; left: 0; width: 100%;
            display: flex; flex-direction: row; align-items: center; gap: 14px;
            padding: 28px 24px 10px 24px; box-sizing: border-box;
            z-index: 10; pointer-events: none;
        }
        .artwork-box {
            width: 52px; height: 52px; flex-shrink: 0; 
            border-radius: 8px; overflow: hidden; 
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            pointer-events: auto;
        }
        .artwork-box img { width: 100%; height: 100%; object-fit: cover; }
        .info-box { 
            flex-grow: 1; text-align: left; 
            display: flex; flex-direction: column; justify-content: center; 
            pointer-events: auto; overflow: hidden;
        }
        #pip-title {
            font-size: 16px; font-weight: 700; margin-bottom: 1px;
            display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
        }
        #pip-artist {
            font-size: 14px; color: rgba(255,255,255,0.5); font-weight: 500;
            display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
        }

        /* 歌詞エリア：マスクのグラデーションをより滑らかに */
        #pip-lyrics-container {
            position: absolute; inset: 0;
            overflow-y: auto; text-align: left;
            padding: 120px 24px 160px 24px; 
            box-sizing: border-box;
            mask-image: linear-gradient(to bottom, transparent 0%, transparent 70px, black 120px, black 70%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, transparent 0%, transparent 70px, black 120px, black 70%, transparent 100%);
            -ms-overflow-style: none; scrollbar-width: none;
            z-index: 5; overscroll-behavior: contain;
        }
#pip-lyrics-container::-webkit-scrollbar { display: none; }

        /* ロード中の表示を中央に配置 */
        .lyric-loading {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.2);
            z-index: 1;
            pointer-events: none;
        }

        /* 歌詞が無い曲は歌詞エリアごと畳み、アートワークを主役にする。
           通常ウィンドウの body.ytm-no-lyrics と同じ考え方。
           「見つかりません」と出すより、最初からそういう画面に見せる。 */
        body.ytm-no-lyrics #pip-lyrics-container { display: none !important; }

        body.ytm-no-lyrics .pip-header {
            position: absolute;
            inset: 0;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            gap: 18px;
            padding: 48px 28px 150px 28px;
            text-align: center;
        }
        body.ytm-no-lyrics .artwork-box {
            width: 190px; height: 190px;
            border-radius: 14px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.45);
        }
        body.ytm-no-lyrics .info-box {
            flex-grow: 0;
            align-items: center;
            text-align: center;
        }
        body.ytm-no-lyrics #pip-title {
            font-size: 21px; -webkit-line-clamp: 2; margin-bottom: 4px;
        }
        body.ytm-no-lyrics #pip-artist { font-size: 15px; }
        body.ytm-no-lyrics #pip-like-btn {
            position: absolute; top: 20px; right: 20px;
        }

        /* srv3 は動画座標の 16:9 ステージを維持して表示する。 */
        body.ytm-animated-caption-mode #pip-lyrics-container {
          display: block !important;
          left: 50%; top: 50%; right: auto; bottom: auto;
          width: min(100vw, 177.7778vh);
          height: min(56.25vw, 100vh);
          padding: 0;
          overflow: hidden;
          transform: translate(-50%, -50%);
          mask-image: none;
          -webkit-mask-image: none;
        }
        body.ytm-animated-caption-mode .ytm-animated-caption-stage {
          position: relative;
          width: 100%; height: 100%;
          overflow: hidden;
          pointer-events: none;
        }
        body.ytm-animated-caption-mode .ytm-animated-caption-cue {
          position: absolute;
          display: inline-block;
          max-width: none;
          white-space: pre;
          text-wrap: nowrap;
          word-break: keep-all;
          overflow-wrap: normal;
          font-weight: 800;
          line-height: 1.18;
          letter-spacing: 0;
          will-change: opacity, transform;
        }

        .lyric-line {
      
          font-size: 26px !important; 
          font-weight: 800 !important;
          letter-spacing: -0.015em !important;
          margin-bottom: 16px !important; 
          line-height: 1.35 !important;
          
          color: rgba(255, 255, 255, 0.25) !important; 
          filter: blur(1.5px) !important;
          transform: scale(0.85) !important; 
          transform-origin: left center !important; 
          
          /* 以前は transform に cubic-bezier(..., 1.2) を使っており、
             終点を行き過ぎてから戻る＝「もちっと」した動きになっていた。
             オーバーシュートしないカーブに変え、時間も詰めて素直に止める。 */
          transition: transform 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
                      color 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
                      filter 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
          
          cursor: pointer !important;
          text-align: left !important; 
          width: 100% !important;
          text-shadow: none !important; 
        }
        
        .lyric-line:hover { 
          color: rgba(255, 255, 255, 0.6) !important; 
        }

        .lyric-line.active {
            color: #fff !important; 
            transform: scale(1) !important; 
            filter: blur(0px) !important; 
            text-shadow: 0 0 20px rgba(255, 255, 255, 0.2) !important; 
        }
        .lyric-line.active .lyric-char { display: inline-block; transition: opacity 0.2s linear; }
        .lyric-line.active .lyric-char.char-pending { opacity: 0.25 !important; }
        .lyric-line.active .lyric-char.char-active { opacity: 1 !important; }

        /* ── Apple Music 風の同期表示（PIP 版）──────────────
           PIP は別文書で、本体の style.css を読んでいない。
           意味は src/css/style.css の同名ブロックと同じ:
             行に --sweep (先頭から進んだ px) と --feather (ぼかし半幅 px)
             語に --wx (語の開始位置 px) / --wg / --wglowa / --wglowr
           持ち上がりと膨らみは Web Animations 側(lyrics-ui.js)。
           両方を直す時は必ず片方だけにならないようにすること。
           片方だけ直っていないことを tests/lyrics-apple-sync.test.mjs が見ている。 */
        @property --sweep { syntax: '<number>'; inherits: true; initial-value: 0; }
        .lyric-line.ytm-word-sync { --feather: 10; --ytm-rest-alpha: 0.26; }
        .lyric-line.ytm-word-sync.active { --ytm-rest-alpha: 0.4; }
        .lyric-phrase.lyric-phrase-sync { margin: 0; }
        .lyric-line.ytm-word-sync .lyric-word {
          --wx: 0; --feather: 10; --wg: 0; --wglowa: 0; --wglowr: 0;
          display: inline-block;
          white-space: pre;
          /* transform は Web Animations が合成側で動かす(本体と同じ) */
          transform-origin: 50% 78%;
          transition: none;
        }
        .lyric-line.ytm-word-sync.active .lyric-word {
          /* background-size / background-position は使わないこと。
             画像からはみ出した語が透明になって消える(本体側の注釈を参照)。 */
          background-image: linear-gradient(90deg,
              currentColor calc((var(--sweep) - var(--wx) - var(--feather)) * 1px),
              color-mix(in srgb, currentColor calc(var(--ytm-rest-alpha) * 100%), transparent)
                calc((var(--sweep) - var(--wx) + var(--feather)) * 1px));
          background-repeat: no-repeat;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 calc(var(--wglowr) * 1em)
            color-mix(in srgb,
              color-mix(in srgb, currentColor 55%, #fff)
              calc(var(--wg) * var(--wglowa) * 100%), transparent) !important;
        }
        .lyric-line.ytm-word-sync:not(.active) .lyric-word {
          background-image: none;
          -webkit-text-fill-color: currentColor;
          text-shadow: none !important;
        }

        /* 通常画面と同じく、再生が終わった行は位置を保ったままフェードする。 */
        #pip-lyrics-container .lyric-line.lyric-past {
          opacity: 0 !important;
          visibility: hidden;
          pointer-events: none;
          transition: transform 0.5s, color 0.5s, filter 0.5s,
                      opacity 1.2s ease 0.3s, visibility 0s linear 1.5s !important;
        }
        #pip-lyrics-container.ytm-user-browsing-lyrics .lyric-line.lyric-past,
        body.ytm-keep-past-lyrics #pip-lyrics-container .lyric-line.lyric-past {
          opacity: 0.3 !important;
          visibility: visible;
          pointer-events: auto;
          transition: transform 0.5s, color 0.5s, filter 0.5s,
                      opacity 0.2s ease, visibility 0s !important;
        }
        
        .lyric-translation { font-size: 0.6em; opacity: 0.5; font-weight: 600; margin-top: 4px; display: block; }
        
        body.ytm-no-timestamp .lyric-line { 
          color: #fff !important; 
          transform: scale(1) !important; 
          opacity: 1 !important; 
          cursor: default !important; 
          filter: blur(0px) !important; 
          text-shadow: 0 0 10px rgba(0, 0, 0, 0.3) !important; 
        }

        .lyric-line.singer-odd {
          text-align: left !important;
          transform-origin: left center !important;
          padding-left: 0 !important;
          padding-right: 14px !important;
        }
        .lyric-line.singer-even {
          text-align: right !important;
          transform-origin: right center !important;
          padding-left: 14px !important;
          padding-right: 0 !important;
        }
        .lyric-line.singer-even .lyric-main,
        .lyric-line.singer-even .lyric-singer-name { text-align: right !important; }
        .lyric-line.singer-odd .lyric-main,
        .lyric-line.singer-odd .lyric-singer-name { text-align: left !important; }
        .lyric-singer-name {
          display: block;
          margin-bottom: 3px;
          font-size: 0.42em;
          font-weight: 700;
          letter-spacing: 0.04em;
          opacity: 0.72;
        }
        body.ytm-singer-colors-enabled .lyric-line[data-singer-color],
        body.ytm-singer-colors-enabled .lyric-line[data-singer-color].active,
        body.ytm-singer-colors-enabled.ytm-no-timestamp .lyric-line[data-singer-color] {
          color: var(--ytm-singer-color) !important;
        }

        .lyric-line {
          text-wrap: balance !important;
          word-break: keep-all !important;     
          overflow-wrap: break-word !important; 
        }
        .lyric-phrase {
          display: inline-block !important;       
          margin: 0 1px !important;           
        }
        
        .controls-box { 
            position: absolute; bottom: 0; left: 0; width: 100%;
            display: flex; align-items: center; justify-content: center; gap: 36px; 
            padding: 30px 0 50px 0; box-sizing: border-box;
            z-index: 20; 
            background: linear-gradient(to top, rgba(0,0,0,0.15) 0%, transparent 100%);
            pointer-events: none; 
        }
        .control-btn {
            pointer-events: auto;
            background: rgba(255, 255, 255, 0.1); border: none;
            border-radius: 50%; 
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #fff; transition: all 0.2s ease;
        }
        .control-btn:hover { background: rgba(255, 255, 255, 0.2); transform: scale(1.05); }
        .control-btn:active { transform: scale(0.92); background: rgba(255, 255, 255, 0.3); }
        .control-btn svg { fill: currentColor; pointer-events: none; }
        
        .main-btn { width: 52px; height: 52px; }
        .main-btn svg { width: 32px; height: 32px; }
        .sub-btn { width: 42px; height: 42px; }
        .sub-btn svg { width: 20px; height: 20px; }
        
        .top-right-btn { width: 36px; height: 36px; flex-shrink: 0; background: rgba(255, 255, 255, 0.1); }
        .top-right-btn svg { width: 18px; height: 18px; }
        .top-right-btn.liked { color: #ffffff; }
      `;
      
            
            
            pipDoc.head.appendChild(forceStyle);
      pipDoc.body.className = 'ytm-pip-mode';
      if (document.body.classList.contains('ytm-no-lyrics')) pipDoc.body.classList.add('ytm-no-lyrics');
      if (document.body.classList.contains('ytm-no-timestamp')) pipDoc.body.classList.add('ytm-no-timestamp');
      if (document.body.classList.contains('ytm-animated-caption-mode')) pipDoc.body.classList.add('ytm-animated-caption-mode');
      if (document.body.classList.contains('ytm-keep-past-lyrics')) pipDoc.body.classList.add('ytm-keep-past-lyrics');
      if (document.body.classList.contains('ytm-singer-colors-enabled')) pipDoc.body.classList.add('ytm-singer-colors-enabled');

      // 曲名・アーティスト名・画像 URL は YTM から来る文字列。そのまま
      // innerHTML に入れると "<" ひとつで PIP の中身が崩れる。
      const artworkUrl = escapeHtml(ui.artwork.querySelector('img')?.src || '');
      const pipTitle = escapeHtml(ui.title.textContent);
      const pipArtist = escapeHtml(ui.artist.textContent);
      
pipDoc.body.innerHTML = `
        <div id="pip-container">
            <div id="pip-bg-layer" style="background-image: url('${artworkUrl}')"></div>
            <div id="pip-noise-layer"></div>
            
            <div class="pip-header">
                <div class="artwork-box">
                    <img id="pip-img" src="${artworkUrl}" alt="">
                </div>
                <div class="info-box">
                    <div id="pip-title">${pipTitle}</div>
                    <div id="pip-artist">${pipArtist}</div>
                </div>
                <button id="pip-like-btn" class="control-btn top-right-btn">
                    <svg viewBox="0 0 24 24"><path id="pip-like-icon-path" d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>
                </button>
            </div>

            <div id="pip-lyrics-container"></div>
            
            <div class="controls-box">
                <button id="pip-prev-btn" class="control-btn sub-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button id="pip-play-pause-btn" class="control-btn main-btn">
                    <svg id="pip-play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <svg id="pip-pause-icon" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <button id="pip-next-btn" class="control-btn sub-btn">
                    <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                </button>
            </div>
        </div>
      `;

      this.pipLyricsContainer = pipDoc.getElementById('pip-lyrics-container');
      this.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      this.pipLyricsContainer._lastScrolledIndex = -1;
      this.pipLyricsContainer._isUserScrolling = false;
      this.pipLyricsContainer._isProgrammaticScrolling = false;
      let userScrollPipTimeout = null;

      this.pipLyricsContainer.addEventListener('scroll', () => {
        if (!this.pipLyricsContainer) return;
        // 自動スクロールは毎フレーム scrollTop を書くので、その間の
        // scroll イベントをユーザー操作と取り違えない
        // (lyrics-ui の stepLyricScroll がこの時刻を伸ばし続ける)。
        if (performance.now() < (this.pipLyricsContainer._suppressUserScrollUntil || 0)) return;
        if (this.pipLyricsContainer._isProgrammaticScrolling) {
          this.pipLyricsContainer._isProgrammaticScrolling = false;
          return;
        }
        this.pipLyricsContainer._isUserScrolling = true;
        this.pipLyricsContainer.classList.add('ytm-user-browsing-lyrics');
        clearTimeout(userScrollPipTimeout);
        userScrollPipTimeout = setTimeout(() => {
          if (this.pipLyricsContainer) {
            this.pipLyricsContainer._isUserScrolling = false;
            this.pipLyricsContainer._lastScrolledIndex = -1;
            this.pipLyricsContainer.classList.remove('ytm-user-browsing-lyrics');
          }
        }, 2000);
      }, { passive: true });

      const likeBtn = pipDoc.getElementById('pip-like-btn');
      const prevBtn = pipDoc.getElementById('pip-prev-btn'); // ★ 追加
      const playBtn = pipDoc.getElementById('pip-play-pause-btn');
      const nextBtn = pipDoc.getElementById('pip-next-btn');

      likeBtn.addEventListener('click', () => {
        const likeWrapper = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like') || document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer .like');
        if (likeWrapper) {
          const btn = likeWrapper.querySelector('button') || likeWrapper.querySelector('tp-yt-paper-icon-button') || likeWrapper;
          btn.click();
          setTimeout(() => PipManager.updateLikeState(pipDoc), 200);
        }
      });

      prevBtn.addEventListener('click', () => {
        const prevWrapper = document.querySelector('ytmusic-player-bar .previous-button') || document.querySelector('ytmusic-player-bar [aria-label="前へ"]') || document.querySelector('ytmusic-player-bar [aria-label="Previous track"]');
        if (prevWrapper) {
          const btn = prevWrapper.querySelector('button') || prevWrapper.querySelector('tp-yt-paper-icon-button') || prevWrapper;
          btn.click();
        }
      });

      playBtn.addEventListener('click', () => {
        const wrapper = document.querySelector('ytmusic-player-bar #play-pause-button') || document.querySelector('ytmusic-player-bar .play-pause-button');
        if (wrapper) {
          const btn = wrapper.querySelector('button') || wrapper.querySelector('tp-yt-paper-icon-button') || wrapper;
          btn.click();
        } else {
          const v = document.querySelector('video');
          if (v) v.paused ? v.play() : v.pause();
        }
      });

      nextBtn.addEventListener('click', () => {
        const nextWrapper = document.querySelector('ytmusic-player-bar .next-button') || document.querySelector('ytmusic-player-bar [aria-label="次へ"]') || document.querySelector('ytmusic-player-bar [aria-label="Next track"]');
        if (nextWrapper) {
          const btn = nextWrapper.querySelector('button') || nextWrapper.querySelector('tp-yt-paper-icon-button') || nextWrapper;
          btn.click();
        }
      });

      PipManager.updateLikeState(pipDoc);
      
      const videoEl = document.querySelector('video');
      PipManager.updatePlayState(videoEl ? videoEl.paused : true);

      this.pipLyricsContainer.addEventListener('click', (e) => {
        const target = e.target.closest('.lyric-line');
        if (!target) return;
        const timeStr = target.dataset.startTime;
        if (timeStr) {
          const time = parseFloat(timeStr);
          if (!isNaN(time)) {
            const v = document.querySelector('video');
            if (v) v.currentTime = time + timeOffset;
          }
        }
      });

      // 開閉時はウィンドウが切り替わるので、ループを張り直す必要がある。
      // startLyricRafLoop() は実行中ガードで弾かれてしまう。
      (window.restartLyricRafLoop || startLyricRafLoop)();

      this.pipWindow.addEventListener('pagehide', () => {
        this.pipWindow = null;
        this.pipLyricsContainer = null;
        this._lastPlayStateIsPaused = null;
        (window.restartLyricRafLoop || startLyricRafLoop)();
      });
    },

    pipWindow: null,
    pipLyricsContainer: null,

    toggle: async function () {
      if (this.pipWindow) {
        this.pipWindow.close();
        return;
      }
      await this.start();
    },

    updateLikeState: function (targetDoc) {
      const doc = targetDoc || (this.pipWindow ? this.pipWindow.document : null);
      if (!doc) return;
      const likeBtn = doc.getElementById('pip-like-btn');
      if (!likeBtn) return;

      let isLiked = false;
      const likeButtonElement = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like button') || document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer .like button');

      if (likeButtonElement) {
        isLiked = likeButtonElement.getAttribute('aria-pressed') === 'true';
      } else {
        const ytmLikeRenderer = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
        if (ytmLikeRenderer && ytmLikeRenderer.hasAttribute('like-status')) {
          isLiked = ytmLikeRenderer.getAttribute('like-status') === 'LIKE';
        }
      }

      // 星のアイコンのパス定義


      const STAR_OUTLINE = "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z";
      const STAR_FILLED = "M12 17.27L18.18 21l-1.63-7.03L22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

      const likeIconPath = doc.getElementById('pip-like-icon-path');
      if (likeIconPath) {
        likeIconPath.setAttribute('d', isLiked ? STAR_FILLED : STAR_OUTLINE);
      }

      if (isLiked) {
        likeBtn.classList.add('liked');
      } else {
        likeBtn.classList.remove('liked');
      }
    },

    updateMeta: function (title, artist) {
      if (!this.pipWindow) return;
      const pipDoc = this.pipWindow.document;
      const tEl = pipDoc.getElementById('pip-title');
      const aEl = pipDoc.getElementById('pip-artist');
      const iEl = pipDoc.getElementById('pip-img');
      const bgEl = pipDoc.getElementById('pip-bg-layer');
      if (tEl) tEl.textContent = title;
      if (aEl) aEl.textContent = artist;
      if (ui.artwork.querySelector('img')) {
        const src = ui.artwork.querySelector('img').src;
        if (iEl) iEl.src = src;
        if (bgEl) bgEl.style.backgroundImage = `url(${src})`;
      }
      this.updateLikeState(pipDoc);
    },

    resetLyrics: function () {
      if (this.pipWindow && this.pipLyricsContainer) {
        // 余計なスタイルを消して、クラスだけで制御
        this.pipLyricsContainer.innerHTML = '<div class="lyric-loading">Loading...</div>';
      }
    },

    // 毎フレーム呼ばれる。状態が変わっていない回は DOM を触らない
    // (getElementById 2 回 + style 書き込み 2 回が毎フレーム走っていた)。
    _lastPlayStateIsPaused: null,

    updatePlayState: function (isPaused) {
      if (!this.pipWindow) return;
      if (isPaused === this._lastPlayStateIsPaused) return;
      this._lastPlayStateIsPaused = isPaused;
      const playIcon = this.pipWindow.document.getElementById('pip-play-icon');
      const pauseIcon = this.pipWindow.document.getElementById('pip-pause-icon');
      if (playIcon && pauseIcon) {
        if (isPaused) {
          playIcon.style.display = 'block';
          pauseIcon.style.display = 'none';
        } else {
          playIcon.style.display = 'none';
          pauseIcon.style.display = 'block';
        }
      }
    }
    
    
  };
