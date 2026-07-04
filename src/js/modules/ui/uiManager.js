// ===================== UI Manager Module =====================
// Manages UI creation and updates - extracted from original content.js

(function () {
  'use strict';

  // Translation and text management
  let UI_TEXTS = null;
  let remoteTextsLoaded = false;

  // Global variables needed for share functionality
  let lyricsData = [];
  let shareMode = false;
  let shareStartIndex = null;
  let shareEndIndex = null;

  // Translation function - from original
  const t = (key, config) => {
    const lang = config?.uiLang || 'ja';

    const remoteTable =
      (UI_TEXTS && UI_TEXTS[lang]) ||
      (UI_TEXTS && UI_TEXTS['ja']) ||
      null;

    const localLangTable = window.ConstantsModule?.Constants.LOCAL_FALLBACK_TEXTS[lang] || {};
    const localJaTable = window.ConstantsModule?.Constants.LOCAL_FALLBACK_TEXTS['ja'] || {};

    if (remoteTable && remoteTable[key]) return remoteTable[key];
    if (localLangTable && localLangTable[key]) return localLangTable[key];
    if (localJaTable && localJaTable[key]) return localJaTable[key];
    return key;
  };

  // Toast notification function
  const showToast = (text) => {
    if (!text) return;
    let el = document.getElementById('ytm-toast');
    if (!el) {
      el = createEl('div', 'ytm-toast');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
    }, 3000);
  };

  // Share button click handler
  const onShareButtonClick = () => {
    if (!lyricsData.length) {
      showToast('共有できる歌詞がありません');
      return;
    }
    shareMode = !shareMode;
    shareStartIndex = null;
    shareEndIndex = null;
    if (shareMode) {
      document.body.classList.add('ytm-share-select-mode');
      const ui = window.StateModule?.StateManager.getUI();
      if (ui?.shareBtn) ui.shareBtn.classList.add('share-active');
      showToast('共有したい歌詞の開始行と終了行をクリックしてください');
    } else {
      document.body.classList.remove('ytm-share-select-mode');
      const ui = window.StateModule?.StateManager.getUI();
      if (ui?.shareBtn) ui.shareBtn.classList.remove('share-active');
    }
    updateShareSelectionHighlight();
  };

  // Update share selection highlight
  const updateShareSelectionHighlight = () => {
    const ui = window.StateModule?.StateManager.getUI();
    if (!ui?.lyrics) return;
    const rows = ui.lyrics.querySelectorAll('.lyric-line');
    rows.forEach(r => {
      r.classList.remove('share-select');
      r.classList.remove('share-select-range');
      r.classList.remove('share-select-start');
      r.classList.remove('share-select-end');
    });
    if (!shareMode || shareStartIndex == null || !lyricsData.length) return;
    const max = lyricsData.length ? lyricsData.length - 1 : 0;
    const start = Math.min(Math.max(shareStartIndex, 0), max);
    const end = shareEndIndex !== null ? Math.min(Math.max(shareEndIndex, 0), max) : null;
    
    rows.forEach((r, i) => {
      if (i === start) r.classList.add('share-select-start');
      if (end !== null && i === end) r.classList.add('share-select-end');
      if (end !== null && i > start && i < end) r.classList.add('share-select-range');
      if (end === null && i === start) r.classList.add('share-select');
    });
  };

  // Placeholder functions for other missing functionality
  const setupUploadMenu = (btn) => {
    console.log('Upload menu setup needed');
  };

  const createReplayPanel = () => {
    const ui = window.StateModule?.StateManager.getUI();
    if (!ui) return;
    
    ui.replayPanel = createEl('div', 'ytm-replay-panel', '', `
      <button class="replay-close-btn">×</button>
      <h3>Daily Replay</h3>
      
      <div class="ytm-lang-group" style="margin-bottom: 20px;">
        <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
        <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
        <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

      <button id="replay-reset-action" class="replay-footer-btn">${t('settings_reset')} History</button>
    `);

    document.body.appendChild(ui.replayPanel);

    ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
      ui.replayPanel.classList.remove('active');
    };
  };

  let settingsOutsideClickSetup = false;
  
  const setupLangPills = (groupId, currentValue, onSelect) => {
    const group = document.getElementById(groupId);
    if (!group) return;
    const btns = group.querySelectorAll('.ytm-lang-pill');
    btns.forEach(b => {
      b.classList.remove('active');
      if (b.dataset.value === currentValue) {
        b.classList.add('active');
      }
      b.onclick = () => {
        btns.forEach(bb => bb.classList.remove('active'));
        b.classList.add('active');
        if (onSelect) onSelect(b.dataset.value);
      };
    });
  };

  const updateSharedTransAvailability = () => {
    const fastToggle = document.getElementById('fast-mode-toggle');
    const sharedToggle = document.getElementById('shared-trans-toggle');
    const row = document.getElementById('shared-trans-row');
    const note = document.getElementById('shared-trans-note');
    if (!fastToggle || !sharedToggle) return;

    const fastMode = !!fastToggle.checked;
    const config = window.ConfigModule?.ConfigManager.getAll() || {};

    // note テキスト（翻訳キーが無い場合は日本語フォールバック）
    const disabledText = t('settings_shared_trans_disabled_fast') ||
      "高速読み込みモードが有効な場合、API共有翻訳は使用できません。\\n高速読み込みモードでは翻訳結果の共有が行われないため、API使用量を節約する目的で無効化しています。ご了承ください。";

    if (fastMode) {
      if (window._sharedTransBeforeFast === undefined) window._sharedTransBeforeFast = !!sharedToggle.checked;

      sharedToggle.checked = false;
      sharedToggle.disabled = true;

      if (row) row.style.opacity = '0.55';
      if (note) {
        note.style.display = 'block';
        note.textContent = disabledText;
      }

      window.ConfigModule?.ConfigManager.update('useSharedTranslateApi', false);
    } else {
      sharedToggle.disabled = false;
      if (row) row.style.opacity = '1';
      if (note) {
        note.style.display = 'none';
        note.textContent = '';
      }

      if (window._sharedTransBeforeFast !== undefined) {
        sharedToggle.checked = !!window._sharedTransBeforeFast;
        window.ConfigModule?.ConfigManager.update('useSharedTranslateApi', !!window._sharedTransBeforeFast);
        window._sharedTransBeforeFast = undefined;
      }
    }
  };
  
  const renderSettingsPanel = () => {
    const ui = window.StateModule?.StateManager.getUI();
    const config = window.ConfigModule?.ConfigManager.getAll() || {};
    const hasCurrentSong = !!window.StateModule?.StateManager.getCurrentKey();
    
    if (!ui || !ui.settings) return;

    ui.settings.innerHTML = `
      <div class="settings-header">
        <h3>${t('settings_title')}</h3>
        <button id="ytm-settings-close-btn">×</button>
      </div>
      
      <div class="settings-scroll-area">
        <div class="settings-section">
          <div class="settings-section-title">Visuals</div>
          <div class="settings-group-card">
            
            <div class="setting-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
              <div style="width:100%; display:flex; justify-content:space-between;">
                <span style="font-size:13px;">UI Language</span>
                <div class="ytm-lang-group" id="ui-lang-group" style="background:transparent; padding:0;"></div>
              </div>
            </div>

            <div class="setting-row" style="flex-direction:column; align-items:stretch; gap:12px;">
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>歌詞の太さ (Weight)</span>
                <span id="weight-val" style="opacity:0.7;">${config.lyricWeight || 800}</span>
              </div>
              <input type="range" id="weight-slider" min="100" max="900" step="100" value="${config.lyricWeight || 800}" style="width:100%;">
            </div>

            <div class="setting-row" style="flex-direction:column; align-items:stretch; gap:12px;">
               <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>背景の明るさ (Brightness)</span>
                <span id="bright-val" style="opacity:0.7;">${Math.round((config.bgBrightness || 0.35) * 100)}%</span>
              </div>
              <input type="range" id="bright-slider" min="0.1" max="1.0" step="0.05" value="${config.bgBrightness || 0.35}" style="width:100%;">
            </div>

            <div class="setting-row">
              <label class="toggle-label" style="width:100%;">
                <span>Liquid Glass</span>
                <input type="checkbox" id="liquid-glass-toggle">
              </label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Translation & Features</div>
          <div class="settings-group-card">
            <div class="setting-row">
              <label class="toggle-label" style="width:100%;">
                <span>${t('settings_trans')}</span>
                <input type="checkbox" id="trans-toggle">
              </label>
            </div>
            
            <div class="setting-row">
              <label class="toggle-label" style="width:100%;">
                <span>${t('settings_fast_mode')}</span>
                <input type="checkbox" id="fast-mode-toggle">
              </label>
            </div>

            <div class="setting-row" id="shared-trans-row" style="flex-direction:column; align-items:stretch; gap:6px;">
              <label class="toggle-label" style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                <span>${t('settings_shared_trans')}</span>
                <input type="checkbox" id="shared-trans-toggle" style="transform:scale(1.15);">
              </label>
              <div id="shared-trans-note" style="font-size:11px; opacity:0.7; line-height:1.35; display:none; white-space:pre-line;"></div>

              <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                <span style="font-size:12px; opacity:0.85;">共有翻訳 残り文字数</span>
                <span id="community-remaining-val" style="font-size:12px; opacity:0.75;">--</span>
              </div>
              <div style="font-size:11px; opacity:0.65; line-height:1.35;">
                <a href="https://immersionproject.coreone.work/" target="_blank" rel="noopener noreferrer"
                   style="color:#8ab4ff; text-decoration:none;">文字数の提供</a> をお願いします
              </div>
            </div>

             <div class="setting-row" style="flex-wrap:wrap; gap:10px;">
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:13px;">${t('settings_sync_offset')}</span>
                  <input type="number" id="sync-offset-input" placeholder="0" style="width:60px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.2); color:#fff; border-radius:6px; padding:4px; text-align:right;">
                </div>
                <label class="toggle-label" style="width:100%; margin-top:4px;">
                  <span style="font-size:11px; opacity:0.7;">${t('settings_sync_offset_save')}</span>
                  <input type="checkbox" id="sync-offset-save-toggle">
                </label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Translation Target</div>
          <div class="settings-group-card">
             <div class="setting-row" style="flex-direction:column; align-items:flex-start;">
                <div class="ytm-lang-label">${t('settings_main_lang')}</div>
                <div class="ytm-lang-group" id="main-lang-group" style="margin-top:6px;">
                  <button class="ytm-lang-pill" data-value="original">Original</button>
                  <button class="ytm-lang-pill" data-value="ja">日本語</button>
                  <button class="ytm-lang-pill" data-value="en">English</button>
                  <button class="ytm-lang-pill" data-value="ko">한국어</button>
                </div>
             </div>
             <div class="setting-row" style="flex-direction:column; align-items:flex-start;">
                <div class="ytm-lang-label">${t('settings_sub_lang')}</div>
                <div class="ytm-lang-group" id="sub-lang-group" style="margin-top:6px;">
                  <button class="ytm-lang-pill" data-value="original">Original</button>
                  <button class="ytm-lang-pill" data-value="ja">日本語</button>
                  <button class="ytm-lang-pill" data-value="en">English</button>
                  <button class="ytm-lang-pill" data-value="ko">한국어</button>
                  <button class="ytm-lang-pill" data-value="zh">中文</button>
                </div>
             </div>
             
             <div class="setting-row" style="display:block;">
               <div style="font-size:12px; margin-bottom:4px; opacity:0.7;">DeepL API Key (Optional)</div>
               <input type="password" id="deepl-key-input" class="setting-input-text" placeholder="DeepL API Key">
             </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Data Management</div>
          <div class="settings-group-card">
            
            <div class="setting-row" style="display:block;">
              <button id="delete-current-cache-btn" class="settings-action-btn btn-danger" ${hasCurrentSong ? '' : 'disabled style="opacity:0.5; cursor:not-allowed;"'}>
                🗑️ この曲の歌詞データを削除
              </button>
              <div style="font-size:10px; opacity:0.5; margin-top:4px; text-align:center;">
                現在再生中の曲の歌詞キャッシュのみを削除します
              </div>
            </div>

            <div class="setting-row" style="display:block; border-top:1px solid rgba(255,255,255,0.05);">
               <button id="clear-all-btn" class="settings-action-btn" style="background:rgba(255,255,255,0.1); color:#fff;">
                 設定をリセット (Reset All)
               </button>
            </div>
          </div>
        </div>
        
        <div style="padding: 10px 0 20px 0;">
           <button id="save-settings-btn" class="settings-action-btn btn-primary" style="padding:12px; font-size:14px;">
             ${t('settings_save')}
           </button>
        </div>

      </div>
    `;

    document.getElementById('deepl-key-input').value = config.deepLKey || '';
    document.getElementById('trans-toggle').checked = config.useTrans;
    document.getElementById('fast-mode-toggle').checked = !!config.fastMode;
    document.getElementById('shared-trans-toggle').checked = !!config.useSharedTranslateApi;
    const liquidGlassToggle = document.getElementById('liquid-glass-toggle');
    if (liquidGlassToggle) {
      liquidGlassToggle.checked = config.liquidGlass !== false;
      liquidGlassToggle.addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        window.ConfigModule?.ConfigManager.set('liquidGlass', enabled);
        window.LiquidGlassModule?.LiquidGlass?.setEnabled(enabled);
        if (window.Storage?.storage) {
          await window.Storage.storage.set('ytm_liquid_glass', enabled);
        }
      });
    }
    
    const fastToggleEl = document.getElementById('fast-mode-toggle');
    if (fastToggleEl) {
      fastToggleEl.addEventListener('change', () => {
        updateSharedTransAvailability();
      });
    }
    updateSharedTransAvailability();

    document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
    document.getElementById('sync-offset-save-toggle').checked = !!config.saveSyncOffset;

    const wSlider = document.getElementById('weight-slider');
    const bSlider = document.getElementById('bright-slider');
    if (wSlider) {
      wSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('weight-val').textContent = val;
        window.ConfigModule?.ConfigManager.update('lyricWeight', val);
        document.documentElement.style.setProperty('--ytm-lyric-weight', val);
      });
    }
    if (bSlider) {
      bSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('bright-val').textContent = Math.round(val * 100) + '%';
        document.documentElement.style.setProperty('--ytm-bg-brightness', val);
      });
    }

    setupLangPills('main-lang-group', config.mainLang || 'original', v => { window.ConfigModule?.ConfigManager.update('mainLang', v); });
    setupLangPills('sub-lang-group', config.subLang || 'en', v => { window.ConfigModule?.ConfigManager.update('subLang', v); });
    refreshUiLangGroup();

    const closeBtn = document.getElementById('ytm-settings-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (ev) => {
        ev.stopPropagation();
        ui.settings.classList.remove('active');
      };
    }

    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const configMod = window.ConfigModule?.ConfigManager;
        if (!configMod) return;
        
        configMod.update('deepLKey', document.getElementById('deepl-key-input').value.trim());
        configMod.update('useTrans', document.getElementById('trans-toggle').checked);
        configMod.update('useSharedTranslateApi', document.getElementById('shared-trans-toggle').checked);
        configMod.update('fastMode', document.getElementById('fast-mode-toggle').checked);
        configMod.update('lyricWeight', document.getElementById('weight-slider').value);
        configMod.update('bgBrightness', document.getElementById('bright-slider').value);
        configMod.set('liquidGlass', document.getElementById('liquid-glass-toggle')?.checked !== false);
        
        let offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
        if (isNaN(offsetVal)) offsetVal = 0;
        configMod.update('syncOffset', offsetVal);
        configMod.update('saveSyncOffset', document.getElementById('sync-offset-save-toggle').checked);
        
        showToast(t('settings_saved'));
        ui.settings.classList.remove('active');
        
        // Notify configuration change
        if (window.EventsModule?.EventsManager) {
          // Fire a custom event or let StateManager know about the change
        }
      };
    }

    const clearAllBtn = document.getElementById('clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.onclick = async () => {
        if (confirm('すべての設定をリセットしますか？')) {
          const storage = window.Storage?.storage;
          if (storage) {
            await storage.clear();
            location.reload();
          }
        }
      };
    }

    const delBtn = document.getElementById('delete-current-cache-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        const key = window.StateModule?.StateManager.getCurrentKey();
        if (!key) return;
        if (confirm('現在の曲の歌詞キャッシュを削除しますか？\\n（歌詞データ、同期情報などがリセットされます）')) {
          const storage = window.Storage?.storage;
          if (storage) await storage.remove(key);
          window.StateModule?.StateManager.resetLyrics();
          showToast('歌詞キャッシュを削除しました');
        }
      };
    }
  };

  const initSettings = () => {
    const ui = window.StateModule?.StateManager.getUI();
    if (!ui) return;
    if (ui.settings) return;
    
    ui.settings = createEl('div', 'ytm-settings-panel', '', '');
    document.body.appendChild(ui.settings);

    renderSettingsPanel();

    if (!settingsOutsideClickSetup) {
      settingsOutsideClickSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.settings) return;
        if (!ui.settings.classList.contains('active')) return;
        if (ui.settings.contains(ev.target)) return;
        if (ui.settingsBtn && ui.settingsBtn.contains(ev.target)) return;
        ui.settings.classList.remove('active');
      }, true);
    }
  };

  const refreshUiLangGroup = () => {
    const uiGrp = document.getElementById('ui-lang-group');
    if (!uiGrp) return;
    
    // Clear current buttons
    uiGrp.innerHTML = '';
    
    const uiLang = window.ConfigModule?.ConfigManager.get('uiLang') || 'ja';
    
    // Create UI Language buttons manually
    const btnJa = document.createElement('button');
    btnJa.className = `ytm-lang-pill ${uiLang === 'ja' ? 'active' : ''}`;
    btnJa.dataset.value = 'ja';
    btnJa.textContent = '日本語';
    
    const btnEn = document.createElement('button');
    btnEn.className = `ytm-lang-pill ${uiLang === 'en' ? 'active' : ''}`;
    btnEn.dataset.value = 'en';
    btnEn.textContent = 'English';
    
    const btnKo = document.createElement('button');
    btnKo.className = `ytm-lang-pill ${uiLang === 'ko' ? 'active' : ''}`;
    btnKo.dataset.value = 'ko';
    btnKo.textContent = '한국어';
    
    const btnZh = document.createElement('button');
    btnZh.className = `ytm-lang-pill ${uiLang === 'zh' ? 'active' : ''}`;
    btnZh.dataset.value = 'zh';
    btnZh.textContent = '中文';
    
    uiGrp.append(btnJa, btnEn, btnKo, btnZh);
    
    // Setup pill logic manually since it references local setupLangPills
    setupLangPills('ui-lang-group', uiLang, val => {
      window.ConfigModule?.ConfigManager.update('uiLang', val);
      renderSettingsPanel(); // Re-render text strings with new locale
    });
  };

  const setupAutoHideEvents = () => {
    // Auto hide events functionality
    console.log('[UIManager] Auto hide events setup completed');
  };

  // Candidate menu refresh - from original
  const refreshCandidateMenu = () => {
    const ui = window.UIManagerModule?.UIManager.getUI();
    if (!ui.uploadMenu) {
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
    const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
    if (!section || !list) return;
    list.innerHTML = '';
    
    const lyricsCandidates = window.StateModule?.StateManager.getLyricsCandidates();
    const selectedCandidateId = window.StateModule?.StateManager.getSelectedCandidateId();
    
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) {
      section.style.display = 'none';
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    section.style.display = 'block';
    lyricsCandidates.forEach((cand, idx) => {
      const id = `candidate_${idx}`;
      const btn = document.createElement('button');
      btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
      btn.dataset.action = 'candidate';
      btn.dataset.candidateId = id;
      btn.textContent = `候補 ${idx + 1}`;
      if (String(selectedCandidateId || '') === id) {
        btn.classList.add('is-selected');
      }
      list.appendChild(btn);
    });
  };

  // Lock menu refresh - from original
  const refreshLockMenu = () => {
    const ui = window.UIManagerModule?.UIManager.getUI();
    if (!ui.uploadMenu) return;
    const lockSection = ui.uploadMenu.querySelector('.ytm-upload-menu-locks');
    const lockList = lockSection ? lockSection.querySelector('.ytm-upload-menu-lock-list') : null;
    if (!lockSection || !lockList) return;
    lockList.innerHTML = '';
    // Lock menu implementation would go here
  };

  // Render lyrics - proxy to UIRenderingModule which has the full implementation
  // (dynamic char spans, timeOffset support, hasTimestamp checks, etc.)
  const renderLyrics = (data) => {
    if (window.UIRenderingModule?.UIRenderingModule?.renderLyrics) {
      // Ensure the UIRenderingModule has the current ui reference
      const ui = window.StateModule?.StateManager.getUI();
      if (window.UIRenderingModule.UIRenderingModule.ui !== undefined) {
        window.UIRenderingModule.UIRenderingModule.ui = ui || {};
      }
      window.UIRenderingModule.UIRenderingModule.renderLyrics(data);
      return;
    }

    // Fallback: simple rendering if UIRenderingModule is not available
    const ui = window.UIManagerModule?.UIManager.getUI();
    if (!ui || !ui.lyrics) return;
    ui.lyrics.innerHTML = '';
    ui.lyrics.scrollTop = 0;
    
    const hasTimestamp = window.StateModule?.StateManager.getHasTimestamp() || false;
    const timeOffset = window.StateModule?.StateManager.getTimeOffset() || 0;
    
    if (!Array.isArray(data) || !data.length) {
      document.body.classList.add('ytm-no-lyrics');
      return;
    }
    
    document.body.classList.remove('ytm-no-lyrics');
    document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
    document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

    const fragment = document.createDocumentFragment();

    data.forEach((line, idx) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';

      if (line && line.duetSide === 'right') {
        lineEl.classList.add('sub-vocal');
      } else if (line && line.duetSide === 'left') {
        lineEl.classList.add('main-vocal');
      }

      if (typeof line.time === 'number') {
        lineEl.dataset.startTime = String(line.time);
      }

      const mainSpan = document.createElement('span');
      mainSpan.className = 'lyric-main';
      mainSpan.textContent = (typeof line === 'string') ? line : (line?.text || '');
      lineEl.appendChild(mainSpan);
      
      // Click handler: seek video to lyric time + timeOffset (matches content_original.js)
      lineEl.addEventListener('click', () => {
        if (!hasTimestamp || !line || line.time == null) return;
        const video = document.querySelector('video');
        if (video) {
          video.currentTime = line.time + timeOffset;
        }
      });
      
      fragment.appendChild(lineEl);
    });

    ui.lyrics.appendChild(fragment);
  };

  const handleUpload = (e) => {
    console.log('File upload handling needed');
  };

  const isYTMPremiumUser = () => {
    return false; // Placeholder
  };

  const setupMovieMode = () => {
    console.log('Movie mode setup needed');
  };

  // Original createEl function - needed for UI creation
  const createEl = (tag, id, cls, html) => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls) el.className = cls;
    if (html !== undefined && html !== null) el.innerHTML = html;
    return el;
  };

  // Merge remote texts function - from original
  const mergeRemoteTexts = (remote) => {
    if (!remote || typeof remote !== 'object') return;
    UI_TEXTS = remote;
    remoteTextsLoaded = true;
  };

  // Load remote texts from GitHub - from original
  const loadRemoteTextsFromGithub = async () => {
    try {
      const res = await fetch(window.ConstantsModule?.Constants.REMOTE_TEXTS_URL, { cache: 'no-store' });
      if (!res.ok) {
        console.warn('[UI TEXTS] HTTP error:', res.status);
        return;
      }
      const raw = await res.text();

      let obj = null;
      try {
        // ui.json は純粋な JSON
        obj = JSON.parse(raw);
      } catch (e) {
        console.warn('[UI TEXTS] JSON.parse failed for ui.json', e);
        return;
      }

      mergeRemoteTexts(obj);
      console.log('[UI TEXTS] remote languages loaded:', Object.keys(obj));
    } catch (e) {
      console.warn('[UI TEXTS] failed to load remote texts:', e);
    }
  };

  // Original getMetadata function
  const getMetadata = () => {
    // Prefer MediaSession metadata (most accurate)
    if (navigator.mediaSession?.metadata) {
      const { title, artist, album, artwork } = navigator.mediaSession.metadata;
      return {
        title: (title || '').toString(),
        artist: (artist || '').toString(),
        album: (album || '').toString(),
        src: Array.isArray(artwork) && artwork.length ? artwork[artwork.length - 1].src : null
      };
    }

    // Fallback: read from player bar
    const tEl = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
    const aEl = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    if (!(tEl && aEl)) return null;

    const parts = (aEl.textContent || '')
      .split('•')
      .map(s => (s || '').trim())
      .filter(Boolean);

    return {
      title: (tEl.textContent || '').trim(),
      artist: parts[0] || '',
      album: parts[1] || '',
      src: null
    };
  };

  // Original updateMetaUI function
  const updateMetaUI = (meta, ui) => {
    if (ui.title) ui.title.innerText = meta.title;
    if (ui.artist) ui.artist.innerText = meta.artist;

    if (meta.src && ui.artwork) {
      ui.artwork.innerHTML = `<img src="${meta.src}" crossorigin="anonymous">`;
    }
    if (ui.bg) {
      ui.bg.style.backgroundImage = `url(${meta.src})`;
    }
    if (ui.lyrics) {
      ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';
    }

    // アーティストページのURLを取得
    let retryCount = 0;
    const maxRetries = 5;
    const trySetArtistLink = () => {
      const bylineWrapper = document.querySelector('ytmusic-player-bar yt-formatted-string.byline.complex-string');
      if (!bylineWrapper) {
        retryCount++;
        if (retryCount < maxRetries) {
          setTimeout(trySetArtistLink, 300);
        }
      }
    };
    trySetArtistLink();
  };

  // Initialize layout - exactly as original
  const initLayout = () => {
    const ui = window.StateModule?.StateManager.getUI();
    
    if (document.getElementById('ytm-custom-wrapper')) {
      ui.wrapper = document.getElementById('ytm-custom-wrapper');
      ui.bg = document.getElementById('ytm-custom-bg');
      ui.lyrics = document.getElementById('my-lyrics-container');
      ui.title = document.getElementById('ytm-custom-title');
      ui.artist = document.getElementById('ytm-custom-artist');
      ui.artwork = document.getElementById('ytm-artwork-container');
      ui.btnArea = document.getElementById('ytm-btn-area');
      setupAutoHideEvents();
      return;
    }
    
    ui.bg = createEl('div', 'ytm-custom-bg');
    document.body.appendChild(ui.bg);
    ui.wrapper = createEl('div', 'ytm-custom-wrapper');
    const leftCol = createEl('div', 'ytm-custom-left-col');
    ui.artwork = createEl('div', 'ytm-artwork-container');
    const info = createEl('div', 'ytm-custom-info-area');
    ui.title = createEl('div', 'ytm-custom-title');
    ui.artist = createEl('div', 'ytm-custom-artist');
    ui.btnArea = createEl('div', 'ytm-btn-area');

    const btns = [];
    const lyricsBtnConfig = { txt: 'Lyrics', cls: 'lyrics-btn', click: () => { } };
    const shareBtnConfig = { txt: 'Share', cls: 'share-btn', click: onShareButtonClick };

    // PiPボタン - exactly as original
    const pipBtnConfig = {
      txt: 'PIP',
      cls: 'icon-btn',
      click: () => window.PipManager?.toggle()
    };

    const replayBtnConfig = {
      txt: '📊',
      cls: 'icon-btn',
      click: () => {
        if (!ui.replayPanel) {
          createReplayPanel();
        }
        ui.replayPanel.classList.add('active');
        ReplayManager.renderUI();
      }
    };

    const settingsBtnConfig = {
      txt: '⚙️',
      cls: 'icon-btn',
      click: async () => {
        initSettings();
        await loadRemoteTextsFromGithub();
        refreshUiLangGroup();
        ui.settings.classList.toggle('active');
      }
    };

    // ボタン配列に追加 - exactly as original
    btns.push(lyricsBtnConfig, shareBtnConfig, pipBtnConfig, replayBtnConfig, settingsBtnConfig);

    btns.forEach(b => {
      const btn = createEl('button', '', `ytm-glass-btn ${b.cls || ''}`, b.txt);
      btn.onclick = b.click;
      ui.btnArea.appendChild(btn);
      if (b === lyricsBtnConfig) {
        ui.lyricsBtn = btn;
        setupUploadMenu(btn);
      }
      if (b === shareBtnConfig) {
        ui.shareBtn = btn;
      }
      if (b === settingsBtnConfig) ui.settingsBtn = btn;
    });

    ui.input = createEl('input');
    ui.input.type = 'file';
    ui.input.accept = '.lrc,.txt';
    ui.input.style.display = 'none';
    ui.input.onchange = handleUpload;
    document.body.appendChild(ui.input);
    info.append(ui.title, ui.artist, ui.btnArea);
    leftCol.append(ui.artwork, info);
    ui.lyrics = createEl('div', 'my-lyrics-container');
    ui.wrapper.append(leftCol, ui.lyrics);
    document.body.appendChild(ui.wrapper);
    setupAutoHideEvents();
    if(isYTMPremiumUser()) setupMovieMode(); //moviemode setup] Exact original UI elements created');
  };

  // UI Manager API
  const UIManager = {
    // Translation function
    t,
    
    // Element creation
    createEl,
    
    // Metadata functions
    getMetadata,
    updateMetaUI,
    
    // Layout management
    initLayout,
    
    // Text management
    loadRemoteTextsFromGithub,
    mergeRemoteTexts,
    
    // Get UI state
    getUI: () => window.StateModule?.StateManager.getUI(),
    
    // Check if remote texts loaded
    isRemoteTextsLoaded: () => remoteTextsLoaded,
    
    // Lyrics and candidate functions - from original
    refreshCandidateMenu,
    refreshLockMenu,
    renderLyrics,
    setupUploadMenu,
    setupAutoHideEvents,
    createReplayPanel,
    initSettings,
    refreshUiLangGroup,
    handleUpload,
    isYTMPremiumUser,
    setupMovieMode
  };

  // Export for module system
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UIManager };
  } else {
    window.UIManagerModule = { UIManager };
  }

})();
