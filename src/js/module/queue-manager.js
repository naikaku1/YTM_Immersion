  const QueueManager = {
    observer: null,


    // ===== Next-song lyrics prefetch (always) =====
    _prefetchLastAt: new Map(),
    _prefetchInFlight: new Set(),
    PREFETCH_DEDUP_MS: 6000,

    // YTM のキュー DOM からは videoId もサムネイル URL も取れない
    // (実測: ytmusic-player-queue-item の中に a 要素が1つも無く、
    //  img は画面外だと 1x1 の data: プレースホルダのまま)。
    // ytm-lyrics.js が取得済みの InnerTube のキューを曲名で引き当てて補う。
    _normalizeTitleForQueue: function (s) {
      return String(s || '')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/[^\p{L}\p{N}]/gu, '')
        .toLowerCase();
    },

    _buildQueueIndex: function () {
      const index = new Map();
      try {
        if (!window.YTMLyrics || typeof window.YTMLyrics.queue !== 'function') return index;
        const currentId = new URL(location.href).searchParams.get('v');
        // まだ取得できていない時は空で返ってくる。届いたら一度だけ描き直す。
        const entries = window.YTMLyrics.queue(currentId, () => {
          this._renderedSignature = null;
          this.syncQueue();
        }) || [];
        for (const entry of entries) {
          const key = this._normalizeTitleForQueue(entry.title);
          if (key && !index.has(key)) index.set(key, entry);
        }
      } catch (e) { /* 引けなくても従来どおり DOM だけで描画する */ }
      return index;
    },

    _extractVideoIdFromQueueItem: function (queueItem) {
      try {
        const a =
          queueItem.querySelector('a[href*="watch"]') ||
          queueItem.querySelector('a[href*="youtu"]') ||
          queueItem.querySelector('a');
        const href = a ? (a.href || a.getAttribute('href')) : null;
        if (!href) return null;
        const u = new URL(href, location.origin);
        // /watch?v=...
        const v = u.searchParams.get('v');
        if (v) return v;
        // youtu.be/<id>
        if (u.hostname.includes('youtu.be')) {
          const parts = (u.pathname || '').split('/').filter(Boolean);
          return parts[0] || null;
        }
      } catch (e) { }
      return null;
    },

    _prefetchLyrics: function (meta) {
      const title = (meta && meta.title) ? String(meta.title).trim() : '';
      const artist = (meta && meta.artist) ? String(meta.artist).trim() : '';
      if (!title) return;

      const key = `${title}///${artist}`;
      const now = Date.now();

      const last = this._prefetchLastAt.get(key) || 0;
      if (now - last < this.PREFETCH_DEDUP_MS) return;
      if (this._prefetchInFlight.has(key)) return;

      this._prefetchLastAt.set(key, now);
      this._prefetchInFlight.add(key);

      const videoId = meta && meta.videoId ? meta.videoId : null;
      const youtubeUrl = meta && meta.youtubeUrl ? meta.youtubeUrl : (videoId ? `https://youtu.be/${videoId}` : null);

      YTMLog.log('[Queue] Prefetch(next) lyrics:', title, '/', artist);

      chrome.runtime.sendMessage({
        type: 'GET_LYRICS',
        payload: {
          track: title,
          artist: artist,
          youtube_url: youtubeUrl,
          video_id: videoId,
        }
      }, (res) => {
        this._prefetchInFlight.delete(key);
        // Service Worker が寝ている等で応答が来ないと chrome.runtime.lastError が
        // 立つ。参照しないと未処理エラーとしてコンソールに残り続けるので必ず読む。
        if (chrome.runtime.lastError) return;

        // Don't overwrite existing good cache on transient failures
        if (!res || !res.success) return;

        const lyr = (res.lyrics || '');
        if (typeof lyr === 'string' && lyr.trim()) {
          storage.set(key, {
            cacheVersion: 2,
            record_id: res.record_id || null,
            video_id: videoId,
            lyrics: lyr,
            dynamicLines: res.dynamicLines || null,
            candidates: res.candidates || null,
            lyricsSource: res.lyricsSource || res.source || 'lrchub',
            fallbackUsed: !!res.fallbackUsed,
            fetchedAt: Date.now(),
          }).then(() => {
            // Refresh highlight instantly if the panel is open.
            // syncQueue() だと署名が同じで再構築がスキップされ、枠線が更新されない。
            if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
              this._refreshHighlights();
            }
          });
        } else {
          // Remember "no lyrics" result so Up Next can show an orange hint.
          // But don't overwrite already cached real lyrics.
          storage.get(key).then((cached0) => {
            const existing = cached0 && typeof cached0.lyrics === 'string' ? cached0.lyrics : '';
            const hasReal = existing && existing.trim() && existing !== NO_LYRICS_SENTINEL;
            if (hasReal) return;
            return storage.set(key, {
              lyrics: NO_LYRICS_SENTINEL,
              dynamicLines: null,
              candidates: res.candidates || null,
              noLyrics: true,
              fetchedAt: Date.now(),
            });
          }).then(() => {
            // Refresh highlight instantly if the panel is open.
            // syncQueue() だと署名が同じで再構築がスキップされ、枠線が更新されない。
            if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
              this._refreshHighlights();
            }
          });
        }
      });
    },

    // 行を作り直さずに枠線(歌詞あり/なし)だけ更新する
    _refreshHighlights: function () {
      if (!ui.queuePanel) return;
      ui.queuePanel.querySelectorAll('.queue-item').forEach(row => {
        const key = row.dataset.lyricsKey;
        if (key) this._applyLoadedLyricsHighlight(row, key);
      });
    },

    // 曲名に < > & が含まれると innerHTML でマークアップが壊れる
    _escapeHtml: function (value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    _applyLoadedLyricsHighlight: function (row, key) {
      if (!row || !key) return;
      storage.get(key).then(cached => {
        if (!row.isConnected) return;
        const lyr = cached && typeof cached.lyrics === 'string' ? cached.lyrics : '';
        const noLyrics = (cached && cached.noLyrics) || (lyr === NO_LYRICS_SENTINEL);
        const hasLyrics = (typeof lyr === 'string' && lyr.trim() && lyr !== NO_LYRICS_SENTINEL);

        if (hasLyrics) {
          // Slight glowing yellow-green border (lyrics ready)
          row.dataset.lyricsLoaded = '1';
          row.dataset.lyricsMissing = '';
          row.style.border = '1px solid rgba(190, 255, 110, 0.65)';
          row.style.boxShadow = '0 0 0 1px rgba(190, 255, 110, 0.20), 0 0 14px rgba(190, 255, 110, 0.14)';
          row.style.borderRadius = row.style.borderRadius || '12px';
          return;
        }

        if (noLyrics) {
          // Orange border (no lyrics found)
          row.dataset.lyricsLoaded = '';
          row.dataset.lyricsMissing = '1';
          row.style.border = '1px solid rgba(255, 170, 60, 0.70)';
          row.style.boxShadow = '0 0 0 1px rgba(255, 170, 60, 0.22), 0 0 14px rgba(255, 170, 60, 0.16)';
          row.style.borderRadius = row.style.borderRadius || '12px';
          return;
        }
      });
    },
    init: function () {
      if (ui.queuePanel) return;
      const trigger = createEl('div', 'ytm-queue-trigger');
      document.body.appendChild(trigger);
      const panel = createEl('div', 'ytm-queue-panel', '', `
        <div class="queue-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <h3 style="margin:0;line-height:1.1;">Up Next</h3>
          <button class="queue-pin" type="button" title="Pin" aria-label="Pin Up Next" style="
            display:inline-flex;
            align-items:center;
            justify-content:center;
            cursor:pointer;
            width:30px;
            height:30px;
            padding:0;
            border-radius:10px;
            border:1px solid rgba(255,255,255,0.18);
            background:rgba(255,255,255,0.06);
            color:inherit;
            line-height:1;
            user-select:none;
          "></button>
        </div>
        <div class="queue-list-content">
            <div class="lyric-loading">Loading...</div>
        </div>
      `);
      document.body.appendChild(panel);
      ui.queuePanel = panel;


      const PIN_KEY = 'ytm_queue_pinned';
      const pinBtn = panel.querySelector('.queue-pin');

      // ピンは絵文字だと環境ごとに字形も色も揃わないので、他のボタンと同じ
      // インライン SVG(currentColor 追従)で描く。留めている時だけ塗りつぶす。
      const pinSvg = (filled) => `
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"
             fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor"
             stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.1 1.9h3.8v3.6l1.9 2.4H4.2l1.9-2.4V1.9Z"/>
          <path d="M8 8.1v6" fill="none"/>
        </svg>`;

      const applyPinnedUI = (pinned) => {
        if (!pinBtn) return;
        pinBtn.innerHTML = pinSvg(pinned);
        pinBtn.title = pinned ? 'Unpin' : 'Pin';
        pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
        if (pinned) {
          pinBtn.dataset.pinned = '1';
          pinBtn.style.color = 'rgb(190, 255, 110)';
          pinBtn.style.background = 'rgba(255,255,255,0.14)';
          pinBtn.style.border = '1px solid rgba(190, 255, 110, 0.55)';
          pinBtn.style.boxShadow = '0 0 0 1px rgba(190,255,110,0.18), 0 0 10px rgba(190,255,110,0.12)';
          pinBtn.style.transform = 'translateZ(0)';
        } else {
          pinBtn.dataset.pinned = '';
          pinBtn.style.color = 'inherit';
          pinBtn.style.background = 'rgba(255,255,255,0.06)';
          pinBtn.style.border = '1px solid rgba(255,255,255,0.18)';
          pinBtn.style.boxShadow = 'none';
        }
      };
      applyPinnedUI(false);

      // Load persisted pin state
      storage.get(PIN_KEY).then((v) => {
        this.pinned = !!v;
        applyPinnedUI(this.pinned);
        if (this.pinned) openPanel();
      });

      if (pinBtn) {
        pinBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.pinned = !this.pinned;
          storage.set(PIN_KEY, this.pinned);
          applyPinnedUI(this.pinned);
          if (this.pinned) {
            openPanel();
          } else {
            // If unpinned and not hovered, close immediately
            setTimeout(() => {
              try {
                if (!panel.matches(':hover') && !trigger.matches(':hover')) {
                  closePanel(true);
                }
              } catch (e) { }
            }, 0);
          }
        });
      }


      let leaveTimer = null;
      const openPanel = () => {
        clearTimeout(leaveTimer);
        panel.classList.add('visible');
        this.startObserver();
        this.syncQueue();
      };
      const closePanel = (immediate = false) => {
        if (this.pinned) return;
        const action = () => {
          panel.classList.remove('visible');
          this.stopObserver();
        };
        if (immediate) {
          clearTimeout(leaveTimer);
          action();
        } else {
          clearTimeout(leaveTimer);
          leaveTimer = setTimeout(action, 300);
        }
      };

      trigger.addEventListener('mouseenter', openPanel);
      panel.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
      panel.addEventListener('mouseleave', () => closePanel(false));
      trigger.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!panel.matches(':hover')) closePanel(false);
        }, 100);
      });
    },

    onSongChanged: function () {
      this.syncQueue();
      [500, 1000, 2000, 3000].forEach(ms => {
        setTimeout(() => {
          if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
            this.syncQueue();
          }
        }, ms);
      });
    },

    _isObserving: false,

    startObserver: function () {
      const originalQueue = document.querySelector('ytmusic-player-queue');
      if (originalQueue && !this.observer) {
        // attributes:true を無条件で見ていたため、キュー内のあらゆる属性変化
        // (ホバー・進捗・遅延読み込み等) で発火し、そのたびに全行を作り直して
        // ちらつき＋スクロール位置リセットが起きていた。
        // 監視は selected の変化に絞り、さらにデバウンスする。
        this.observer = new MutationObserver(() => {
          if (!ui.queuePanel || !ui.queuePanel.classList.contains('visible')) return;
          clearTimeout(this._syncDebounce);
          this._syncDebounce = setTimeout(() => this.syncQueue(), 120);
        });
      }
      if (originalQueue && this.observer && !this._isObserving) {
        this.observer.observe(originalQueue, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['selected']
        });
        this._isObserving = true;
      }
    },

    stopObserver: function () {
      if (this.observer && this._isObserving) {
        this.observer.disconnect();
        this._isObserving = false;
      }
    },

    syncQueue: function () {
      if (!ui.queuePanel) return;
      if (!this.observer) this.startObserver();

      const container = ui.queuePanel.querySelector('.queue-list-content');
      const allRawItems = document.querySelectorAll('ytmusic-player-queue-item');

      const visibleItems = Array.from(allRawItems).filter(item => item.offsetParent !== null);

      if (visibleItems.length === 0) return;

      let currentIndex = visibleItems.findIndex(item => item.hasAttribute('selected'));
      if (currentIndex === -1) {
        // 曲の切り替わり中、YTM は selected を一瞬外す。
        // ここで 0 に落とすとキューの先頭を「再生中」として描き直してしまい、
        // 曲送りのたびにリストが頭に飛ぶ。既に描画済みなら更新を見送る。
        if (this._renderedSignature) return;
        currentIndex = 0;
      }

      const targetItems = visibleItems.slice(currentIndex);

      // 中身が変わっていないのに innerHTML を作り直すと、スクロール位置が戻り
      // クリックハンドラも張り直しになる。署名で差分を見て無駄な再構築を避ける。
      const signature = targetItems.map(item => {
        const t = item.querySelector('.song-title');
        return `${this._extractVideoIdFromQueueItem(item) || ''}:${t ? t.textContent.trim() : ''}`;
      }).join('|');
      if (signature && signature === this._renderedSignature) return;
      this._renderedSignature = signature;

      container.innerHTML = '';
      const seenIds = new Set();
      const queueIndex = this._buildQueueIndex();

      let renderedCount = 0;
      targetItems.forEach((item, idx) => {
        const titleEl = item.querySelector('.song-title');
        const artistEl = item.querySelector('.byline');
        const imgEl = item.querySelector('.thumbnail img');

        if (!titleEl) return;

        const title = titleEl.textContent.trim();
        const artist = artistEl ? artistEl.textContent.trim() : '';
        const queueEntry = queueIndex.get(this._normalizeTitleForQueue(title)) || null;
        const videoId = this._extractVideoIdFromQueueItem(item)
          || (queueEntry ? queueEntry.videoId : null);

        // 重複判定は videoId で行う。曲名+アーティストだと、ミックスや
        // リピートで同じ曲がキューに複数回入っているとき正当な行まで消えていた。
        const dedupeKey = videoId || `${title}///${artist}`;
        if (seenIds.has(dedupeKey)) return;
        seenIds.add(dedupeKey);

        const isPlaying = (renderedCount === 0);
        // 先読みは重複除去後の「次の曲」に対して行う。
        // 以前は除去前の idx===1 を見ていたため、その行が重複で消えると
        // 画面に出ていない曲を先読みしていた。
        if (renderedCount === 1) {
          this._prefetchLyrics({
            title, artist, videoId,
            youtubeUrl: videoId ? `https://youtu.be/${videoId}` : null,
          });
        }

        // YouTube Music 側の歌詞は content script からしか取れないので、
        // これから流れる数曲ぶんをここで温めておく。videoId 単位でメモ化される
        // ため、実際に曲が変わった時にはネットワーク往復ゼロで表示できる。
        // 数曲先まで持っておくと、曲送りを連打された時も待ちが出ない。
        if (renderedCount >= 1 && renderedCount <= 3 && videoId &&
          window.YTMLyrics && typeof window.YTMLyrics.fetch === 'function') {
          window.YTMLyrics.fetch(videoId).catch(() => { });
        }
        renderedCount += 1;

        const uniqueKey = `${title}///${artist}`;

        // YTM のキューはサムネイルを遅延読み込みしており、画面外の行の img は
        // 1x1 の透明 GIF (data:) のまま。実測では最初はキュー全行がこの状態で、
        // そのままだと Up Next のジャケットがほぼ全部プレースホルダになる。
        //   1. DOM が本物を持っていればそれ(正方形のアートワーク)
        //   2. InnerTube のキューにあるアートワーク URL
        //   3. videoId から i.ytimg.com のサムネイル
        let src = '';
        if (imgEl && imgEl.src && !imgEl.src.startsWith('data:')) {
          src = imgEl.src;
        } else if (queueEntry && queueEntry.thumbnail) {
          src = queueEntry.thumbnail;
        } else if (videoId) {
          src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
        }

        const row = createEl('div', '', `queue-item ${isPlaying ? 'current' : ''}`);

        const imgHtml = src
          ? `<img src="${src}" loading="lazy">`
          : `<div class="queue-img-fallback">♪</div>`;

        const indicatorHtml = isPlaying
          ? `<div class="queue-playing-indicator"><i></i><i></i><i></i></div>`
          : '';

        row.innerHTML = `
          <div class="queue-img">
            ${imgHtml}
            ${indicatorHtml}
          </div>
          <div class="queue-info">
            <div class="queue-title">${this._escapeHtml(title)}</div>
            <div class="queue-artist">${this._escapeHtml(artist)}</div>
          </div>
        `;

        // サムネイルが 404 等で落ちた時だけ記号に差し替える。
        // インラインの onerror は YTM の CSP で実行されないので、必ずここで張る。
        const rowImg = row.querySelector('.queue-img img');
        if (rowImg) {
          rowImg.addEventListener('error', () => {
            const fallback = createEl('div', '', 'queue-img-fallback', '♪');
            rowImg.replaceWith(fallback);
          }, { once: true });
        }

        row.onclick = (e) => {
          e.stopPropagation();
          const playButton = item.querySelector('.play-button') || item.querySelector('ytmusic-play-button-renderer');
          if (playButton) {
            playButton.click();
          } else {
            item.click();
          }
          setTimeout(() => this.syncQueue(), 500);
        };

        row.dataset.lyricsKey = uniqueKey;
        container.appendChild(row);

        this._applyLoadedLyricsHighlight(row, uniqueKey);
      });
    }
  };
