  const QueueManager = {
    observer: null,


    // ===== Next-song lyrics prefetch (always) =====
    _prefetchLastAt: new Map(),
    _prefetchInFlight: new Set(),
    PREFETCH_DEDUP_MS: 6000,

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

      console.log('[Queue] Prefetch(next) lyrics:', title, '/', artist);

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

        // Don't overwrite existing good cache on transient failures
        if (!res || !res.success) return;

        const lyr = (res.lyrics || '');
        if (typeof lyr === 'string' && lyr.trim()) {
          storage.set(key, {
            lyrics: lyr,
            dynamicLines: res.dynamicLines || null,
            candidates: res.candidates || null,
            fetchedAt: Date.now(),
          }).then(() => {
            // Refresh highlight instantly if the panel is open
            if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
              this.syncQueue();
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
            // Refresh highlight instantly if the panel is open
            if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
              this.syncQueue();
            }
          });
        }
      });
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
            cursor:pointer;
            padding:6px 8px;
            border-radius:10px;
            border:1px solid rgba(255,255,255,0.18);
            background:rgba(255,255,255,0.06);
            color:inherit;
            font-size:14px;
            line-height:1;
            user-select:none;
          ">📌</button>
        </div>
        <div class="queue-list-content">
            <div class="lyric-loading">Loading...</div>
        </div>
      `);
      document.body.appendChild(panel);
      ui.queuePanel = panel;


      const PIN_KEY = 'ytm_queue_pinned';
      const pinBtn = panel.querySelector('.queue-pin');

      const applyPinnedUI = (pinned) => {
        if (!pinBtn) return;
        if (pinned) {
          pinBtn.dataset.pinned = '1';
          pinBtn.textContent = '📍';
          pinBtn.style.background = 'rgba(255,255,255,0.14)';
          pinBtn.style.border = '1px solid rgba(190, 255, 110, 0.55)';
          pinBtn.style.boxShadow = '0 0 0 1px rgba(190,255,110,0.18), 0 0 10px rgba(190,255,110,0.12)';
          pinBtn.style.transform = 'translateZ(0)';
        } else {
          pinBtn.dataset.pinned = '';
          pinBtn.textContent = '📌';
          pinBtn.style.background = 'rgba(255,255,255,0.06)';
          pinBtn.style.border = '1px solid rgba(255,255,255,0.18)';
          pinBtn.style.boxShadow = 'none';
        }
      };

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
                  panel.classList.remove('visible');
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
        this.syncQueue();
      };
      const closePanel = () => {
        if (this.pinned) return;
        leaveTimer = setTimeout(() => {
          panel.classList.remove('visible');
        }, 300);
      };

      trigger.addEventListener('mouseenter', openPanel);
      panel.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
      panel.addEventListener('mouseleave', closePanel);
      trigger.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!panel.matches(':hover')) closePanel();
        }, 100);
      });

      this.startObserver();
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

    startObserver: function () {
      const originalQueue = document.querySelector('ytmusic-player-queue');
      if (originalQueue && !this.observer) {
        this.observer = new MutationObserver(() => {
          if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
            this.syncQueue();
          }
        });
        this.observer.observe(originalQueue, {
          childList: true,
          subtree: true,
          attributes: true
        });
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
      if (currentIndex === -1) currentIndex = 0;

      const targetItems = visibleItems.slice(currentIndex);

      container.innerHTML = '';
      const seenKeys = new Set();

      targetItems.forEach((item, idx) => {
        const titleEl = item.querySelector('.song-title');
        const artistEl = item.querySelector('.byline');
        const imgEl = item.querySelector('.thumbnail img');

        const isPlaying = (idx === 0);

        if (!titleEl) return;

        const title = titleEl.textContent.trim();
        const artist = artistEl ? artistEl.textContent.trim() : '';


        if (idx === 1) {
          const videoId = this._extractVideoIdFromQueueItem(item);
          const youtubeUrl = videoId ? `https://youtu.be/${videoId}` : null;
          this._prefetchLyrics({ title, artist, videoId, youtubeUrl });
        }


        const uniqueKey = `${title}///${artist}`;
        if (seenKeys.has(uniqueKey)) return;
        seenKeys.add(uniqueKey);

        let src = '';
        if (imgEl && imgEl.src && !imgEl.src.startsWith('data:')) {
          src = imgEl.src;
        }

        const row = createEl('div', '', `queue-item ${isPlaying ? 'current' : ''}`);

        const imgHtml = src
          ? `<img src="${src}" loading="lazy">`
          : `<div style="display:flex;justify-content:center;align-items:center;width:100%;height:100%;background:#333;font-size:18px;">🎵</div>`;

        const indicatorHtml = isPlaying
          ? `<div class="queue-playing-indicator"><i></i><i></i><i></i></div>`
          : '';

        row.innerHTML = `
          <div class="queue-img">
            ${imgHtml}
            ${indicatorHtml}
          </div>
          <div class="queue-info">
            <div class="queue-title">${title}</div>
            <div class="queue-artist">${artist}</div>
          </div>
        `;

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

        container.appendChild(row);

        this._applyLoadedLyricsHighlight(row, uniqueKey);
      });
    }
  };

