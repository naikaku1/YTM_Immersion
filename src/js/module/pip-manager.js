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

      const pipDoc = this.pipWindow.document;

    
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          if (styleSheet.href) {
            const link = pipDoc.createElement('link');
            link.rel = 'stylesheet';
            link.type = styleSheet.type;
            link.media = styleSheet.media;
            link.href = styleSheet.href;
            pipDoc.head.appendChild(link);
          }
        } catch (e) { }
      });
      
      
      
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
          
          transition: transform 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.2), 
                      color 0.7s cubic-bezier(0.2, 0.8, 0.2, 1), 
                      filter 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) !important; 
          
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
        
        .lyric-translation { font-size: 0.6em; opacity: 0.5; font-weight: 600; margin-top: 4px; display: block; }
        
        body.ytm-no-timestamp .lyric-line { 
          color: #fff !important; 
          transform: scale(1) !important; 
          opacity: 1 !important; 
          cursor: default !important; 
          filter: blur(0px) !important; 
          text-shadow: 0 0 10px rgba(0, 0, 0, 0.3) !important; 
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
      if (document.body.classList.contains('ytm-no-timestamp')) pipDoc.body.classList.add('ytm-no-timestamp');

      const artworkUrl = ui.artwork.querySelector('img')?.src || '';
      
pipDoc.body.innerHTML = `
        <div id="pip-container">
            <div id="pip-bg-layer" style="background-image: url('${artworkUrl}')"></div>
            <div id="pip-noise-layer"></div>
            
            <div class="pip-header">
                <div class="artwork-box">
                    <img id="pip-img" src="${artworkUrl}" alt="">
                </div>
                <div class="info-box">
                    <div id="pip-title">${ui.title.textContent}</div>
                    <div id="pip-artist">${ui.artist.textContent}</div>
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

      startLyricRafLoop();

      this.pipWindow.addEventListener('pagehide', () => {
        this.pipWindow = null;
        this.pipLyricsContainer = null;
        startLyricRafLoop();
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

    updatePlayState: function (isPaused) {
      if (!this.pipWindow) return;
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