/* globals chrome, browser */
(function () {
  const EXT =
    typeof globalThis.chrome !== 'undefined'
      ? globalThis.chrome
      : (typeof globalThis.browser !== 'undefined' ? globalThis.browser : null);

  // カスタムハンドル（丸ポチ）を作成してoverflow:hiddenから逃がす
  (function createCustomProgressHandle() {
    const waitForPlayerBar = () => {
      const playerBar = document.querySelector('ytmusic-player-bar');
      const progressBar = document.querySelector('tp-yt-paper-slider#progress-bar');
      if (!playerBar || !progressBar) {
        setTimeout(waitForPlayerBar, 500);
        return;
      }

      // カスタムハンドルを作成
      let customHandle = document.getElementById('ytm-custom-progress-handle');
      if (!customHandle) {
        customHandle = document.createElement('div');
        customHandle.id = 'ytm-custom-progress-handle';
        customHandle.style.cssText = `
          position: fixed;
          width: 12px;
          height: 12px;
          background: #ff0000;
          border-radius: 50%;
          pointer-events: none;
          z-index: 10000;
          opacity: 0;
          transform: translate(-50%, -50%);
          transition: opacity 0.1s ease-out;
        `;
        document.body.appendChild(customHandle);
      }

      // 元のハンドルを非表示にするCSS（Shadow DOM内部に適用）
      const style = document.createElement('style');
      style.id = 'ytm-hide-original-handle';
      style.textContent = `
        body.ytm-custom-layout ytmusic-player-bar tp-yt-paper-slider#progress-bar::part(knob),
        body.ytm-custom-layout ytmusic-player-bar tp-yt-paper-slider#progress-bar [class*="knob"],
        body.ytm-custom-layout ytmusic-player-bar #sliderKnobInner {
          opacity: 0 !important;
        }
      `;
      if (!document.getElementById('ytm-hide-original-handle')) {
        document.head.appendChild(style);
      }

      // 表示状態を管理
      let isHovering = false;      // カーソルがバー上にある
      let positionChanged = false; // 位置を変更した（ドラッグした）
      let isDragging = false;      // ドラッグ中かどうか

      // ホバー検出
      progressBar.addEventListener('mouseenter', () => {
        isHovering = true;
      });

      progressBar.addEventListener('mouseleave', () => {
        isHovering = false;
      });

      // ドラッグ（位置変更）検出
      progressBar.addEventListener('mousedown', () => {
        positionChanged = true;
        isDragging = true;
      });

      // マウスアップでドラッグ終了
      document.addEventListener('mouseup', () => {
        isDragging = false;
      });

      // バー以外をクリックしたら非表示（キャプチャフェーズで確実にキャッチ）
      document.addEventListener('click', (e) => {
        if (!progressBar.contains(e.target)) {
          positionChanged = false;
        }
      }, true);

      // ハンドルの表示・非表示を制御
      const shouldShowHandle = () => {
        // ホバー中、または位置変更後（バー外クリックまで）
        return isHovering || positionChanged;
      };

      // ハンドルの位置を更新
      const updateHandlePosition = () => {
        if (!document.body.classList.contains('ytm-custom-layout')) {
          customHandle.style.opacity = '0';
          requestAnimationFrame(updateHandlePosition);
          return;
        }

        // ネイティブのsliderKnobを取得
        const sliderKnob = progressBar.querySelector('#sliderKnob');
        if (!sliderKnob) {
          requestAnimationFrame(updateHandlePosition);
          return;
        }

        // 表示条件をチェック
        if (!shouldShowHandle()) {
          customHandle.style.opacity = '0';
          requestAnimationFrame(updateHandlePosition);
          return;
        }

        // sliderKnobのrectを取得（ドラッグ中もリアルタイムで更新される）
        const knobRect = sliderKnob.getBoundingClientRect();
        const barRect = progressBar.getBoundingClientRect();

        // knobの中心位置を計算（完全追従）
        const handleX = knobRect.left + knobRect.width / 2;
        const handleY = barRect.top + barRect.height / 2;

        // ハンドルを表示して位置を更新
        customHandle.style.opacity = '1';
        customHandle.style.left = handleX + 'px';
        customHandle.style.top = handleY + 'px';

        // ドラッグ中は大きく、そうでなければ通常サイズ
        if (isDragging) {
          customHandle.style.width = '16px';
          customHandle.style.height = '16px';
        } else {
          customHandle.style.width = '12px';
          customHandle.style.height = '12px';
        }

        requestAnimationFrame(updateHandlePosition);
      };

      requestAnimationFrame(updateHandlePosition);

    };

    // DOMが準備できたら開始
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', waitForPlayerBar);
    } else {
      waitForPlayerBar();
    }
  })();

  let config = {
    deepLKey: null,
    useTrans: true,
    mode: true,
    mainLang: 'original',
    subLang: 'en',
    uiLang: 'ja',
    syncOffset: 0,
    saveSyncOffset: false,
    useSharedTranslateApi: false
  };

  // フォールバック言語
  const LOCAL_FALLBACK_TEXTS = {
    ja: {
      unit_hour: "時間",
      unit_minute: "分",
      unit_second: "秒",
      replay_playTime: "総再生時間",
      replay_plays: "回再生",
      replay_topSong: "トップソング",
      replay_topArtist: "トップアーティスト",
      replay_obsession: "ヘビロテ中",
      replay_ranking: "再生数ランキング",
      replay_today: "今日",
      replay_week: "今週",
      replay_all: "全期間",
      replay_empty: "まだ再生データがありません...",
      replay_no_data_sub: "曲を聴くとここに表示されます",
      replay_reset_confirm: "本当に再生履歴を全て削除しますか？\nこの操作は取り消せません。",
      replay_vibe: "あなたの雰囲気",
      replay_lyrics_heard: "累計行数",
      settings_title: "設定",
      settings_ui_lang: "UI言語 / Language",
      settings_trans: "歌詞翻訳機能を使う",
      settings_shared_trans: "共有翻訳を使う（APIキー不要）",
      settings_main_lang: "メイン言語 (大きく表示)",
      settings_sub_lang: "サブ言語 (小さく表示)",
      settings_save: "保存",
      settings_reset: "リセット",
      settings_saved: "設定を保存しました",
      settings_sync_offset: "歌詞同期オフセット",
      settings_sync_offset_save: "曲が切り替わったときにオフセットをリセットしない",
      settings_fast_mode: "高速読み込みモード (既にデータベースにある曲のみ取得出来ます。自動登録は無効です。)"
    },
    en: {
      unit_hour: "hours",
      unit_minute: "minutes",
      unit_second: "seconds",
      replay_playTime: "Total play time",
      replay_plays: "Plays",
      replay_topSong: "Top song",
      replay_topArtist: "Top artist",
      replay_obsession: "On repeat",
      replay_ranking: "Play count ranking",
      replay_today: "Today",
      replay_week: "This week",
      replay_all: "All time",
      replay_empty: "No play data yet...",
      replay_no_data_sub: "Play some songs to see them here",
      replay_reset_confirm: "Are you sure you want to delete all play history?\nThis action can't be undone.",
      replay_vibe: "Your vibe",
      replay_lyrics_heard: "Total lines",
      settings_title: "Settings",
      settings_ui_lang: "UI Language / Language",
      settings_trans: "Enable lyrics translation",
      settings_shared_trans: "Use shared translation (no API key required)",
      settings_main_lang: "Main language (large)",
      settings_sub_lang: "Sub language (small)",
      settings_save: "Save",
      settings_reset: "Reset",
      settings_saved: "Settings saved",
      settings_sync_offset: "Lyrics sync offset",
      settings_sync_offset_save: "Don't reset offset when the song changes",
      settings_fast_mode: "Fast Load Mode (May reduce accuracy for covers)"
    },
    ko: {
      unit_hour: "시간",
      unit_minute: "분",
      unit_second: "초",
      replay_playTime: "총 재생 시간",
      replay_plays: "재생 횟수",
      replay_topSong: "톱 곡",
      replay_topArtist: "톱 아티스트",
      replay_obsession: "반복 재생 중",
      replay_ranking: "재생수 랭킹",
      replay_today: "오늘",
      replay_week: "이번 주",
      replay_all: "전체 기간",
      replay_empty: "아직 재생 데이터가 없습니다...",
      replay_no_data_sub: "곡을 들으면 여기에 표시됩니다",
      replay_reset_confirm: "정말로 재생 기록을 모두 삭제하시겠습니까?\n이 작업은 취소할 수 없습니다.",
      replay_vibe: "당신의 분위기",
      replay_lyrics_heard: "누적 행 수",
      settings_title: "설정",
      settings_ui_lang: "UI 언어 / Language",
      settings_trans: "가사 번역 기능 사용",
      settings_shared_trans: "공유 번역 사용 (API 키 불필요)",
      settings_main_lang: "메인 언어 (크게 표시)",
      settings_sub_lang: "서브 언어 (작게 표시)",
      settings_save: "저장",
      settings_reset: "초기화",
      settings_saved: "설정을 저장했습니다",
      settings_sync_offset: "가사 동기 오프셋",
      settings_sync_offset_save: "곡이 바뀌어도 오프셋을 초기화하지 않기",
      settings_fast_mode: "고속 로딩 모드"
    },
    zh: {
      unit_hour: "小时",
      unit_minute: "分钟",
      unit_second: "秒",
      replay_playTime: "总播放时长",
      replay_plays: "播放次数",
      replay_topSong: "热门歌曲",
      replay_topArtist: "热门艺人",
      replay_obsession: "循环播放中",
      replay_ranking: "播放次数排行",
      replay_today: "今天",
      replay_week: "本周",
      replay_all: "全部时间",
      replay_empty: "还没有播放数据...",
      replay_no_data_sub: "听歌后会在这里显示",
      replay_reset_confirm: "确定要删除所有播放记录吗？\n此操作无法撤销。",
      replay_vibe: "你的氛围",
      replay_lyrics_heard: "累计行数",
      settings_title: "设置",
      settings_ui_lang: "UI 语言 / Language",
      settings_trans: "启用歌词翻译",
      settings_shared_trans: "使用共享翻译（无需 API 密钥）",
      settings_main_lang: "主语言（大号显示）",
      settings_sub_lang: "副语言（小号显示）",
      settings_save: "保存",
      settings_reset: "重置",
      settings_saved: "已保存设置",
      settings_sync_offset: "歌词同步偏移",
      settings_sync_offset_save: "切歌时不重置偏移",
      settings_fast_mode: "快速加载模式"
    }
  }; 
  
  
  let UI_TEXTS = null;


  const t = (key) => {
    const lang = config.uiLang || 'ja';


    const remoteTable =
      (UI_TEXTS && UI_TEXTS[lang]) ||
      (UI_TEXTS && UI_TEXTS['ja']) ||
      null;

    const localLangTable = LOCAL_FALLBACK_TEXTS[lang] || {};
    const localJaTable = LOCAL_FALLBACK_TEXTS['ja'] || {};

    if (remoteTable && remoteTable[key]) return remoteTable[key];
    if (localLangTable && localLangTable[key]) return localLangTable[key];
    if (localJaTable && localJaTable[key]) return localJaTable[key];
    return key;
  };




  const REMOTE_TEXTS_URL =
    'https://raw.githubusercontent.com/naikaku1/YTM-Modern-UI/main/src/lang/ui.json';

  let remoteTextsLoaded = false;

  // 言語コード
  function getLangDisplayName(code) {
    if (UI_TEXTS && UI_TEXTS[code]) {
      const metaName = UI_TEXTS[code].lang_name || UI_TEXTS[code].__name;
      if (metaName) return metaName;
    }
    if (code === 'ja') return '日本語';
    if (code === 'en') return 'English';
    if (code === 'ko') return '한국어';
    return code;
  }

  function mergeRemoteTexts(remote) {
    if (!remote || typeof remote !== 'object') return;
    UI_TEXTS = remote;
    remoteTextsLoaded = true;
    refreshUiLangGroup();
  }



  let uiLangEtcClickSetup = false;

  function refreshUiLangGroup() {
    const group = document.getElementById('ui-lang-group');
    if (!group) return;

    const current = config.uiLang || 'ja';
    group.innerHTML = '';


    const langs = UI_TEXTS
      ? Object.keys(UI_TEXTS)
      : Object.keys(LOCAL_FALLBACK_TEXTS);

    if (!langs.length) return;

    const MAX_DIRECT = 3; 
    const directLangs = langs.slice(0, MAX_DIRECT);
    const hasMore = langs.length > MAX_DIRECT;


    directLangs.forEach((code) => {
      const btn = document.createElement('button');
      btn.className = 'ytm-lang-pill';
      btn.dataset.value = code;
      btn.textContent = getLangDisplayName(code);
      group.appendChild(btn);
    });


    if (hasMore) {
      const etcBtn = document.createElement('button');
      etcBtn.className = 'ytm-lang-pill ytm-lang-pill-etc';
      etcBtn.dataset.value = '__etc__';
      etcBtn.textContent = 'etc...';
      group.appendChild(etcBtn);


      let menu = document.getElementById('ui-lang-etc-menu');
      if (!menu) {
        menu = document.createElement('div');
        menu.id = 'ui-lang-etc-menu';
        menu.className = 'ytm-lang-etc-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '2147483647';
        menu.style.maxHeight = '260px';
        menu.style.overflowY = 'auto';
        menu.style.borderRadius = '8px';
        menu.style.padding = '6px';
        menu.style.background = 'rgba(0,0,0,0.9)';
        menu.style.border = '1px solid rgba(255,255,255,0.2)';
        menu.style.minWidth = '160px';
        menu.style.display = 'none';
        document.body.appendChild(menu);
      }


      menu.innerHTML = '';
      langs.forEach((code) => {
        const item = document.createElement('button');
        item.className = 'ytm-lang-etc-item';
        item.textContent = getLangDisplayName(code);
        item.dataset.code = code;
        item.style.display = 'block';
        item.style.width = '100%';
        item.style.textAlign = 'left';
        item.style.border = 'none';
        item.style.background = 'transparent';
        item.style.padding = '4px 6px';
        item.style.cursor = 'pointer';
        item.style.color = '#fff';
        item.style.fontSize = '12px';

        if (code === current) {
          item.style.fontWeight = '600';
          item.style.background = 'rgba(255,255,255,0.08)';
        }

        item.addEventListener('click', () => {
          config.uiLang = code;

          // if (storage && storage.set) {
          //   storage.set('ytm_ui_lang', code);
          // }
          renderSettingsPanel(); //設定パネルを即時変更
          menu.style.display = 'none';
          refreshUiLangGroup(); // 選択後にラベルやアクティブ状態を更新
        });

        menu.appendChild(item);
      });

      // etc ボタンでメニュー開閉
      etcBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const rect = etcBtn.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
      });

      // 現在の言語が directLangs にない場合は etc ボタンをハイライト
      if (!directLangs.includes(current)) {
        etcBtn.classList.add('active');
        etcBtn.textContent = getLangDisplayName(current);
      }

      // 外側クリックでメニューを閉じる（1回だけ設定）
      if (!uiLangEtcClickSetup) {
        uiLangEtcClickSetup = true;
        document.addEventListener('click', (ev) => {
          if (!menu) return;
          if (ev.target === menu || menu.contains(ev.target)) return;
          const btn = document.querySelector('.ytm-lang-pill-etc');
          if (btn && (ev.target === btn || btn.contains(ev.target))) return;
          menu.style.display = 'none';
        }, true);
      }
    }

    // ---- 直接ボタンの active 切り替え＆クリック処理 ----
    const activeForDirect = directLangs.includes(current) ? current : '';
    setupLangPills('ui-lang-group', activeForDirect, (v) => {
      if (!v || v === '__etc__') return; // etc はここでは何もしない
      config.uiLang = v;
      renderSettingsPanel(); //設定パネルを即時変更
    });
  }


  // GitHub から TEXTS を読む
  async function loadRemoteTextsFromGithub() {
    try {
      const res = await fetch(REMOTE_TEXTS_URL, { cache: 'no-store' });
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
  }

  const chrome = EXT;


  const NO_LYRICS_SENTINEL = '__NO_LYRICS__';

  // ===================== CloudSync: Daily Replay クラウド同期 =====================
  const CloudSync = (() => {
    if (!EXT || !EXT.runtime) {
      return {
        init() { },
      };
    }

    let statusEl = null;
    let tokenInputEl = null;
    let syncButtonEl = null;
    let panelRoot = null;

    function setStatus(text) {
      if (statusEl) {
        statusEl.textContent = text;
        statusEl.title = text;
      }
    }

    function createPanel() {
      const existing = document.getElementById('dr-cloud-sync-panel');
      if (existing) {
        panelRoot = existing;
        statusEl = document.querySelector('#dr-cloud-sync-panel-status');
        tokenInputEl = document.querySelector('#dr-cloud-sync-token-input');
        syncButtonEl = document.querySelector('#dr-cloud-sync-sync-btn');
        return;
      }

      const root = document.createElement('div');
      root.id = 'dr-cloud-sync-panel';
      panelRoot = root;
      root.style.position = 'fixed';
      root.style.zIndex = '2147483647';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.width = '280px';
      root.style.maxWidth = '90vw';
      root.style.borderRadius = '12px';
      root.style.background = 'rgba(10, 10, 15, 0.96)';
      root.style.border = '1px solid rgba(255, 255, 255, 0.12)';
      root.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.6)';
      root.style.color = '#f5f5ff';
      root.style.fontFamily =
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      root.style.fontSize = '12px';
      root.style.padding = '10px 12px';

      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.justifyContent = 'space-between';
      titleRow.style.marginBottom = '6px';

      const title = document.createElement('div');
      title.textContent = 'Daily Replay クラウド同期';
      title.style.fontSize = '13px';
      title.style.fontWeight = '600';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.border = 'none';
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#aaa';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '14px';
      closeBtn.style.lineHeight = '1';
      closeBtn.style.Padding = '0 4px';
      closeBtn.addEventListener('click', () => {
        root.style.display = 'none';
      });

      titleRow.appendChild(title);
      titleRow.appendChild(closeBtn);

      const desc = document.createElement('div');
      desc.textContent =
        '「復活の呪文」を使って履歴をサーバーと同期します。';
      desc.style.marginBottom = '6px';
      desc.style.color = '#b0b4d0';
      desc.style.lineHeight = '1.4';

      const tokenLabel = document.createElement('div');
      tokenLabel.textContent = '復活の呪文（ID）';
      tokenLabel.style.fontSize = '11px';
      tokenLabel.style.marginBottom = '2px';
      tokenLabel.style.color = '#d0d4ff';

      const tokenInput = document.createElement('input');
      tokenInput.id = 'dr-cloud-sync-token-input';
      tokenInput.type = 'text';
      tokenInput.placeholder = '例: dr_XXXXXXXXXXXXXXXX';
      tokenInput.style.width = '100%';
      tokenInput.style.boxSizing = 'border-box';
      tokenInput.style.borderRadius = '6px';
      tokenInput.style.border = '1px solid rgba(255,255,255,0.2)';
      tokenInput.style.background = 'rgba(5,5,10,0.9)';
      tokenInput.style.color = '#f5f5ff';
      tokenInput.style.padding = '4px 6px';
      tokenInput.style.fontSize = '12px';
      tokenInput.style.marginBottom = '4px';

      const tokenHelpRow = document.createElement('div');
      tokenHelpRow.style.display = 'flex';
      tokenHelpRow.style.justifyContent = 'space-between';
      tokenHelpRow.style.alignItems = 'center';
      tokenHelpRow.style.marginBottom = '6px';

      const tokenHelp = document.createElement('div');
      tokenHelp.textContent =
        '※ Discord ログイン後に表示される復活の呪文を入力。';
      tokenHelp.style.fontSize = '10px';
      tokenHelp.style.color = '#8f93b8';
      tokenHelp.style.marginRight = '4px';

      const loginLinkBtn = document.createElement('button');
      loginLinkBtn.textContent = 'ログインページ';
      loginLinkBtn.style.fontSize = '10px';
      loginLinkBtn.style.borderRadius = '999px';
      loginLinkBtn.style.border = 'none';
      loginLinkBtn.style.padding = '4px 8px';
      loginLinkBtn.style.cursor = 'pointer';
      loginLinkBtn.style.background = '#5865F2';
      loginLinkBtn.style.color = '#fff';
      loginLinkBtn.addEventListener('click', () => {
        openLoginPage();
      });

      tokenHelpRow.appendChild(tokenHelp);
      tokenHelpRow.appendChild(loginLinkBtn);

      const buttonRow = document.createElement('div');
      buttonRow.style.display = 'flex';
      buttonRow.style.gap = '6px';
      buttonRow.style.marginBottom = '4px';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '復活の呪文を保存';
      saveBtn.style.flex = '1';
      saveBtn.style.borderRadius = '999px';
      saveBtn.style.border = 'none';
      saveBtn.style.padding = '5px 8px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.background = '#4f8bff';
      saveBtn.style.color = '#fff';
      saveBtn.style.fontSize = '11px';
      saveBtn.style.fontWeight = '600';

      const syncBtn = document.createElement('button');
      syncBtn.id = 'dr-cloud-sync-sync-btn';
      syncBtn.textContent = '今すぐ同期';
      syncBtn.style.flex = '0 0 auto';
      syncBtn.style.borderRadius = '999px';
      syncBtn.style.border = 'none';
      syncBtn.style.padding = '5px 10px';
      syncBtn.style.cursor = 'pointer';
      syncBtn.style.background = '#1db954';
      syncBtn.style.color = '#fff';
      syncBtn.style.fontSize = '11px';
      syncBtn.style.fontWeight = '600';
      syncBtn.disabled = true;
      syncBtn.style.opacity = '0.5';

      saveBtn.addEventListener('click', () => {
        const token = tokenInput.value.trim();
        if (!token) {
          setStatus('復活の呪文を入力してください。');
          return;
        }
        saveRecoveryToken(token);
      });

      syncBtn.addEventListener('click', () => {
        syncBtn.disabled = true;
        syncBtn.style.opacity = '0.5';
        setStatus('同期中...');
        syncNow().finally(() => {
          syncBtn.disabled = false;
          syncBtn.style.opacity = '1';
        });
      });

      const status = document.createElement('div');
      status.id = 'dr-cloud-sync-panel-status';
      status.textContent = '状態: 復活の呪文が未設定です。';
      status.style.fontSize = '10px';
      status.style.color = '#b0b4d0';
      status.style.marginTop = '2px';
      status.style.whiteSpace = 'pre-wrap';

      root.appendChild(titleRow);
      root.appendChild(desc);
      root.appendChild(tokenLabel);
      root.appendChild(tokenInput);
      root.appendChild(tokenHelpRow);
      buttonRow.appendChild(saveBtn);
      buttonRow.appendChild(syncBtn);
      root.appendChild(buttonRow);
      root.appendChild(status);

      document.body.appendChild(root);

      statusEl = status;
      tokenInputEl = tokenInput;
      syncButtonEl = syncBtn;

      // ★ パネルを初めて出したときに状態を読み込む
      loadInitialState();
    }

    function saveRecoveryToken(token) {
      EXT.runtime.sendMessage(
        {
          type: 'SAVE_RECOVERY_TOKEN',
          token,
        },
        (resp) => {
          if (!resp || !resp.ok) {
            const errMsg = resp && resp.error ? resp.error : '保存に失敗しました。';
            setStatus('復活の呪文の保存に失敗: ' + errMsg);
            return;
          }
          setStatus('復活の呪文を保存しました。このIDに紐づいてクラウド同期されます。');
          if (syncButtonEl) {
            syncButtonEl.disabled = false;
            syncButtonEl.style.opacity = '1';
          }
        }
      );
    }

    function openLoginPage() {
      EXT.runtime.sendMessage({ type: 'OPEN_LOGIN_PAGE' }, (resp) => {
        if (!resp || !resp.ok) {
          const errMsg = resp && resp.error ? resp.error : 'ログインページを開けませんでした。';
          setStatus('ログインページの起動エラー: ' + errMsg);
          return;
        }
        setStatus(
          'ブラウザでログインページを開きました。ログイン後に復活の呪文をここに貼り付けてください。'
        );
      });
    }

    function getLocalHistory() {
      return new Promise((resolve) => {
        if (!EXT.storage || !EXT.storage.local) {
          resolve([]);
          return;
        }
        EXT.storage.local.get(ReplayManager.HISTORY_KEY, (items) => {
          const value = items && items[ReplayManager.HISTORY_KEY];
          if (Array.isArray(value)) {
            resolve(value);
          } else {
            resolve([]);
          }
        });
      });
    }

    function setLocalHistory(history) {
      return new Promise((resolve) => {
        if (!EXT.storage || !EXT.storage.local) {
          resolve();
          return;
        }
        EXT.storage.local.set({ [ReplayManager.HISTORY_KEY]: history }, () => resolve());
      });
    }

    async function syncNow() {
      try {
        const history = await getLocalHistory();
        const resp = await new Promise((resolve) => {
          EXT.runtime.sendMessage(
            {
              type: 'SYNC_HISTORY',
              history,
            },
            (response) => resolve(response)
          );
        });

        if (!resp || !resp.ok) {
          const errMsg = resp && resp.error ? resp.error : '同期エラー';
          setStatus('同期に失敗しました: ' + errMsg);
          return { ok: false, error: errMsg, raw: resp || null };
        }

        const mergedHistory = Array.isArray(resp.mergedHistory)
          ? resp.mergedHistory
          : Array.isArray(resp.history)
            ? resp.history
            : null;

        if (mergedHistory) {
          await setLocalHistory(mergedHistory);
        }

        const lastSyncAtMs = resp.lastSyncAt || Date.now();
        const lastSyncDate = new Date(lastSyncAtMs);
        const serverCount =
          mergedHistory && Array.isArray(mergedHistory)
            ? mergedHistory.length
            : resp.serverCount || '?';

        setStatus(
          `同期完了: ローカル ${history.length} 件 → サーバー ${serverCount} 件\n最終同期: ${lastSyncDate.toLocaleString()}`
        );

        return {
          ok: true,
          mergedHistory: mergedHistory || null,
          lastSyncAt: lastSyncAtMs,
          serverCount,
        };
      } catch (e) {
        console.error('[DailyReplay Cloud] sync error', e);
        const msg = e && e.message ? e.message : String(e);
        setStatus(
          '同期中にエラーが発生しました: ' + msg
        );
        return { ok: false, error: msg, raw: null };
      }
    }

    function loadInitialState() {
      EXT.runtime.sendMessage({ type: 'GET_CLOUD_STATE' }, (resp) => {
        if (!resp || !resp.ok || !resp.state) {
          setStatus(
            '状態の取得に失敗しました。復活の呪文を設定すると同期できます。'
          );
          return;
        }
        const state = resp.state;
        if (tokenInputEl && state.recoveryToken) {
          tokenInputEl.value = state.recoveryToken;
        }

        if (syncButtonEl) {
          const hasToken = !!state.recoveryToken;
          syncButtonEl.disabled = !hasToken;
          syncButtonEl.style.opacity = hasToken ? '1' : '0.5';
        }

        const lastSyncAt = state.lastSyncAt ? new Date(state.lastSyncAt) : null;
        const lastSyncText = lastSyncAt ? lastSyncAt.toLocaleString() : '未同期';

        setStatus(
          state.recoveryToken
            ? `状態: 復活の呪文が設定されています。\n最終同期: ${lastSyncText}`
            : '状態: 復活の呪文が未設定です。ログインして発行されたIDを入力してください。'
        );
      });
    }

    // ★ 起動時にパネルを出さず、バックグラウンドで静かに同期だけ行う
    function init() {
      if (window.__drCloudSyncInitialized) return;
      window.__drCloudSyncInitialized = true;

      const startAutoSync = () => {
        // 起動時自動同期（トークンが無いときはサーバー側で NO_TOKEN になり、トーストも出さない）
        syncNow()
          .then((result) => {
            if (!result || !result.ok) return;
            // 同期に成功したときだけ右上トースト
            if (typeof showToast === 'function') {
              showToast('Daily Replay のクラウド同期が完了しました');
            }
          })
          .catch((e) => {
            console.warn('[DailyReplay Cloud] auto sync failed', e);
          });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAutoSync);
      } else {
        startAutoSync();
      }
    }

    // Cloud ボタンから開くときだけパネルを生成・表示
    function openPanel() {
      createPanel();
      if (panelRoot) {
        panelRoot.style.display = 'block';
      }
    }

    return { init, openPanel, syncNow };
  })();

  // ===================== ここから既存 Immersion ロジック =====================

  let currentKey = null;
  let lyricsData = [];
  let hasTimestamp = false;
  let dynamicLines = null;
  // duet: raw sub vocal LRC (sub.txt) - only lines to show on the right
  let duetSubLyricsRaw = '';
  // duet: dynamic lines for sub.txt (1文字追尾用)
  let duetSubDynamicLines = null;
  // keep last raw lyrics text so we can re-render when sub lyrics arrive later
  let lastRawLyricsText = null;

  // dynamicLyrics helper: time->line map (rebuild when reference changes)
  let _dynMapSrc = null;
  let _dynMap = null;
  let _duetExcludedTimes = new Set();
  let lyricsCandidates = null;
  let selectedCandidateId = null;
  let lastActiveIndex = -1;
  let lastTimeForChars = -1;
  let lyricRafId = null;

  let timeOffset = 0;

  let isFirstSongDetected = true;

  let shareMode = false;
  let shareStartIndex = null;
  let shareEndIndex = null;
  let isFallbackLyrics = false;

  let lyricsRequests = null;
  let lyricsConfig = null;

  const ui = {
    bg: null,
    wrapper: null,
    title: null, artist: null, artwork: null,
    lyrics: null, input: null, settings: null,
    btnArea: null, uploadMenu: null, deleteDialog: null,
    replayPanel: null,
    queuePanel: null,
    settingsBtn: null,
    lyricsBtn: null,
    shareBtn: null
  };

  let hideTimer = null;
  let uploadMenuGlobalSetup = false;
  let deleteDialogGlobalSetup = false;
  let settingsOutsideClickSetup = false;
  let toastTimer = null;
  let moviemode = null;
  let movieObserver = null;

  const handleInteraction = () => {
    const targets = [];
    const title = ui.title;
    const artist = ui.artist;
    const playerBar = document.querySelector("ytmusic-player-bar");
    const switcher = document.querySelector("ytmusic-av-toggle");
    if (title) targets.push(title);
    if (artist) targets.push(artist);
    if (playerBar) targets.push(playerBar);
    if (switcher) targets.push(switcher);
    if (ui.btnArea) targets.push(ui.btnArea);
    targets.forEach(element => {
      element.classList.remove('inactive');
    });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const isSettingsActive = ui.settings?.classList.contains('active');
      const isReplayActive = ui.replayPanel?.classList.contains('active');
      const isQueueActive = ui.queuePanel?.matches(':hover');
      if (!isSettingsActive && !isReplayActive && !isQueueActive && !targets.some(target => target?.matches(':hover'))) {
        targets.forEach(element => {
          element.classList.add('inactive');
        });
      }
    }, 1500);
  };
  const storage = {
    _api: chrome?.storage?.local,
    get: (k) => new Promise(r => {
      if (!storage._api) return r(null);
      storage._api.get([k], res => {
        const val = res ? res[k] : undefined;
        r(val !== undefined ? val : null);
      });
    }),
 
    set: (k, v) => new Promise(resolve => {
      if (storage._api) {
        storage._api.set({ [k]: v }, resolve);
      } else {
        resolve();
      }
    }),

    remove: (k) => new Promise(resolve => {
      if (storage._api) {
        storage._api.remove(k, resolve);
      } else {
        resolve();
      }
    }),
    clear: () => confirm('全データを削除しますか？') && storage._api?.clear(() => location.reload())
  };
  const ReplayManager = {
    HISTORY_KEY: 'ytm_local_history',
    currentVideoId: null,
    hasRecordedCurrent: false,
    currentPlayTime: 0,
    lastSaveTime: 0,

    currentLyricLines: 0,
    recordedLyricLines: 0,

    formatDuration: function (seconds) {
      if (!seconds) return `0${t('unit_second')}`;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const uH = t('unit_hour');
      const uM = t('unit_minute');
      const uS = t('unit_second');
      const sp = config.uiLang === 'ja' ? '' : ' ';
      if (h > 0) return `${h}${uH}${sp}${m}${uM}${sp}${s}${uS}`;
      if (m > 0) return `${m}${uM}${sp}${s}${uS}`;
      return `${s}${uS}`;
    },

    incrementLyricCount: function () {
      this.currentLyricLines++;
    },

    exportHistory: async function () {
      const history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length === 0) {
        alert('保存する履歴データがありません。');
        return;
      }
      const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `ytm_history_${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    importHistory: function () {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) {
              if (confirm('履歴を復元しますか？\n[OK] 現在の履歴に結合 (マージ)\n[キャンセル] キャンセル')) {
                const current = await storage.get(this.HISTORY_KEY) || [];
                const existingIds = new Set(current.map(i => i.id + '_' + i.timestamp));
                const newData = data.filter(i => !existingIds.has(i.id + '_' + i.timestamp));
                const merged = current.concat(newData);
                merged.sort((a, b) => a.timestamp - b.timestamp);
                await storage.set(this.HISTORY_KEY, merged);
                alert('履歴を復元しました！');
                this.renderUI();
              }
            } else {
              alert('無効なファイル形式です。');
            }
          } catch (err) {
            console.error(err);
            alert('ファイルの読み込みに失敗しました。');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    },

    check: async function () {
      const video = document.querySelector('video');
      if (!video) return;
      const vid = getCurrentVideoId();
      if (!vid) return;

      if (vid !== this.currentVideoId) {
        this.currentVideoId = vid;
        this.hasRecordedCurrent = false;
        this.currentPlayTime = 0;
        this.lastSaveTime = 0;
        this.currentLyricLines = 0;
        this.recordedLyricLines = 0;
        return;
      }

      if (!video.paused) {
        this.currentPlayTime++;
        const isPlayed = this.currentPlayTime > 30 || (video.duration > 10 && this.currentPlayTime / video.duration > 0.4);

        if (isPlayed) {
          if (!this.hasRecordedCurrent) {
            await this.recordNewPlay();
            this.hasRecordedCurrent = true;
          } else if (this.currentPlayTime - this.lastSaveTime >= 5) {
            await this.updateDuration();
            this.lastSaveTime = this.currentPlayTime;
          }
        }
      }
    },

    recordNewPlay: async function () {
      const meta = getMetadata();
      if (!meta) return;

      this.recordedLyricLines = this.currentLyricLines;

      const record = {
        id: this.currentVideoId,
        title: meta.title,
        artist: meta.artist,
        src: meta.src,
        duration: this.currentPlayTime,
        lyricLines: this.currentLyricLines,
        timestamp: Date.now()
      };

      let history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length > 10000) history = history.slice(-10000);
      history.push(record);
      await storage.set(this.HISTORY_KEY, history);

      if (ui.replayPanel && ui.replayPanel.classList.contains('active')) {
        this.renderUI();
      }
    },

    updateDuration: async function () {
      let history = await storage.get(this.HISTORY_KEY) || [];
      if (history.length === 0) return;

      const lastIndex = history.length - 1;
      if (history[lastIndex].id === this.currentVideoId) {
        history[lastIndex].duration = this.currentPlayTime;
        history[lastIndex].lyricLines = this.currentLyricLines;

        await storage.set(this.HISTORY_KEY, history);
        if (ui.replayPanel && ui.replayPanel.classList.contains('active')) {
          this.renderUI();
        }
      }
    },

    getStats: async function (range = 'day') {
      const history = await storage.get(this.HISTORY_KEY) || [];
      const now = Date.now();
      let threshold = 0;
      if (range === 'day') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        threshold = today.getTime();
      } else if (range === 'week') {
        threshold = now - (7 * 24 * 60 * 60 * 1000);
      }

      const filtered = history.filter(h => h.timestamp >= threshold);

      const countMap = {};
      const artistMap = {};
      const uniqueArtists = new Set();
      let totalSeconds = 0;
      let totalLyrics = 0;
      const hourCounts = new Array(24).fill(0);

      filtered.forEach(h => {
        const key = h.title + '///' + h.artist;
        if (!countMap[key]) countMap[key] = { ...h, count: 0, totalDuration: 0 };

        countMap[key].count++;
        const duration = typeof h.duration === 'number' ? h.duration : 0;
        countMap[key].totalDuration += duration;

        if (!artistMap[h.artist]) {
          artistMap[h.artist] = { count: 0, src: h.src };
        } else {
          artistMap[h.artist].count++;
          if (h.src) artistMap[h.artist].src = h.src;
        }

        uniqueArtists.add(h.artist);
        totalSeconds += duration;

        if (h.lyricLines && typeof h.lyricLines === 'number') {
          totalLyrics += h.lyricLines;
        }

        const hour = new Date(h.timestamp).getHours();
        hourCounts[hour]++;
      });

      const topSongs = Object.values(countMap).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.totalDuration - a.totalDuration;
      });

      const topArtists = Object.keys(artistMap)
        .map(name => ({
          name,
          count: artistMap[name].count,
          src: artistMap[name].src
        }))
        .sort((a, b) => b.count - a.count);

      const mostPlayedArtist = topArtists[0] || null;
      const mostPlayedSong = topSongs[0] || null;

      const totalPlays = filtered.length;
      const maxHourVal = Math.max(...hourCounts);
      const peakHour = hourCounts.indexOf(maxHourVal);
      const totalHours = totalSeconds / 3600;
      const today = new Date(Date.now());
      const dayOfWeek = today.getDay();

      let vibeLabel = "分  中...";
      let topArtistShare = "0%";

      if (totalPlays > 0) {
        const topArtistRatio = mostPlayedArtist ? (mostPlayedArtist.count / totalPlays) : 0;
        const topSongRatio = mostPlayedSong ? (mostPlayedSong.count / totalPlays) : 0;
        const diversityRatio = uniqueArtists.size / totalPlays;

        topArtistShare = Math.round(topArtistRatio * 100) + "%";

        if (totalPlays < 5) {
          vibeLabel = "音楽探しの途中";
        }
        else if (topArtistRatio >= 0.6) {
          vibeLabel = `${mostPlayedArtist.name} 一筋`;
        }
        else if (topSongRatio >= 0.5) {
          vibeLabel = "一点集中リピート";
        }
        else if (diversityRatio >= 0.8) {
          vibeLabel = "幅広く開拓中";
        }
        else if (totalHours >= 4) {
          vibeLabel = "耐久リスニングマスター";
        }
        else if (dayOfWeek === 5) {
          vibeLabel = "💃 解放のフライデー";
        }
        else if (dayOfWeek === 6) {
          vibeLabel = "🥳 週末お祭りモード";
        }
        else if (dayOfWeek === 0) {
          vibeLabel = "🧘‍♂️ 明日への充電";
        }
        else {
          if (peakHour >= 4 && peakHour < 9) { vibeLabel = "早起きスタイル"; }
          else if (peakHour >= 9 && peakHour < 12) { vibeLabel = "午前中の集中"; }
          else if (peakHour >= 12 && peakHour < 17) { vibeLabel = "午後ワーク"; }
          else if (peakHour >= 17 && peakHour < 23) { vibeLabel = "夜型リスナー"; }
          else { vibeLabel = "深夜の没頭"; }
        }
      } else {
        vibeLabel = "No Data";
      }

      return {
        totalPlays,
        totalTime: this.formatDuration(totalSeconds),
        totalLyrics: totalLyrics.toLocaleString(),
        vibeLabel,
        topArtistShare,
        peakHour,
        topSongs: topSongs.slice(0, 50),
        topArtists: topArtists.slice(0, 10),
        mostPlayedSong,
        mostPlayedArtist
      };
    },

    renderUI: async function () {
      if (!ui.replayPanel) return;
      const container = ui.replayPanel.querySelector('.ytm-replay-content');

      const range = ui.replayPanel.dataset.range || 'day';
      const stats = await this.getStats(range);

      const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
      if (pills[0]) pills[0].textContent = t('replay_today');
      if (pills[1]) pills[1].textContent = t('replay_week');
      if (pills[2]) pills[2].textContent = t('replay_all');

      let footerArea = document.getElementById('replay-footer-area');

      const oldBtn1 = document.getElementById('replay-reset-action');
      const oldBtn2 = document.getElementById('replay-export-btn');
      const oldBtn3 = document.getElementById('replay-import-btn');
      if (oldBtn1 && !oldBtn1.closest('.replay-footer-area')) oldBtn1.remove();
      if (oldBtn2) oldBtn2.remove();
      if (oldBtn3) oldBtn3.remove();

      if (!footerArea) {
        footerArea = createEl('div', 'replay-footer-area', 'replay-footer-area');
        ui.replayPanel.appendChild(footerArea);
      }

      footerArea.innerHTML = `
        <button id="replay-import-btn" class="replay-footer-btn">📂 Restore</button>
        <button id="replay-export-btn" class="replay-footer-btn">💾 Backup</button>
        <button id="replay-cloudsync-btn" class="replay-footer-btn">☁ Cloud</button>
        <button id="replay-reset-action" class="replay-footer-btn" style="color:#ff6b6b; border-color:rgba(255,107,107,0.3);">🗑️ Reset</button>
      `;

      document.getElementById('replay-reset-action').onclick = async () => {
        if (confirm(t('replay_reset_confirm'))) {
          await storage.remove(ReplayManager.HISTORY_KEY);
          ReplayManager.renderUI();
        }
      };
      document.getElementById('replay-export-btn').onclick = () => this.exportHistory();
      document.getElementById('replay-import-btn').onclick = () => this.importHistory();

      const cloudBtn = document.getElementById('replay-cloudsync-btn');
      if (cloudBtn) {
        cloudBtn.onclick = () => {
          CloudSync.init();
          if (CloudSync.openPanel) {
            CloudSync.openPanel();
          }
        };
      }


      document.getElementById('replay-reset-action').onclick = async () => {
        if (confirm(t('replay_reset_confirm'))) {
          await storage.remove(ReplayManager.HISTORY_KEY);
          ReplayManager.renderUI();
        }
      };
      document.getElementById('replay-export-btn').onclick = () => this.exportHistory();
      document.getElementById('replay-import-btn').onclick = () => this.importHistory();

      if (stats.totalPlays === 0) {
        container.innerHTML = `<div class="replay-empty"><div style="font-size:40px; margin-bottom:10px;">🎧</div><div>${t('replay_empty')}</div><div style="font-size:12px; opacity:0.6; margin-top:5px;">${t('replay_no_data_sub')}</div></div>`;
        return;
      }

      const heroImage = stats.mostPlayedSong?.src || '';

      const artistBgStyle = `background: linear-gradient(135deg, rgba(50,100,255,0.1), rgba(255,255,255,0.03));`;

      let topArtistsSubHtml = '';
      if (stats.topArtists.length > 1) {
        topArtistsSubHtml = `<div style="margin-top:auto; padding-top:10px; border-top:1px solid rgba(255,255,255,0.1); font-size:12px; font-weight:600; color:rgba(255,255,255,0.9);">`;
        if (stats.topArtists[1]) topArtistsSubHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;"><span style="opacity:0.9;">#2 ${stats.topArtists[1].name}</span><span style="opacity:0.7;">${stats.topArtists[1].count}回</span></div>`;
        if (stats.topArtists[2]) topArtistsSubHtml += `<div style="display:flex; justify-content:space-between; align-items:center;"><span style="opacity:0.9;">#3 ${stats.topArtists[2].name}</span><span style="opacity:0.7;">${stats.topArtists[2].count}回</span></div>`;
        topArtistsSubHtml += `</div>`;
      }

      let html = `
        <div class="bento-grid">
          
          <div class="bento-item hero-stat-time">
            <div class="bento-label">${t('replay_playTime')}</div>
            <div class="bento-value-huge">${stats.totalTime}</div>
            <div class="bento-sub">${stats.totalPlays} ${t('replay_plays')}</div>
          </div>

          <div class="bento-item hero-song" style="background-image: url('${heroImage}');">
            <div class="bento-overlay">
              <div class="bento-label">${t('replay_topSong')}</div>
              <div class="bento-song-title">${stats.mostPlayedSong?.title}</div>
              <div class="bento-song-artist">${stats.mostPlayedSong?.artist}</div>
              <div class="bento-badge">${stats.mostPlayedSong?.count} ${t('replay_plays')}</div>
            </div>
          </div>

          <div class="bento-item hero-vibe">
            <div class="bento-label">${t('replay_vibe')}</div>
            <div class="bento-vibe-text" style="font-size:24px; font-weight:900; margin-top:10px; line-height:1.2; word-break:break-all;">${stats.vibeLabel}</div>
          </div>

          <div class="bento-item hero-lyrics">
            <div class="bento-label">${t('replay_lyrics_heard')}</div>
            <div class="bento-value-huge" style="font-size: 42px;">${stats.totalLyrics}</div>
            <div class="bento-sub">行</div>
          </div>

          <div class="bento-item hero-artist" style="${artistBgStyle} position:relative; overflow:hidden;">
            <div style="position:relative; z-index:2; height:100%; display:flex; flex-direction:column; color:#fff; padding-bottom:5px;">
              <div class="bento-label" style="color:rgba(255,255,255,0.7);">${t('replay_topArtist')}</div>
              
              <div class="bento-artist-name" style="font-size:28px; font-weight:900; margin: 5px 0 10px 0; color:#fff; line-height:1.1; flex-shrink: 0; min-height: 30px;">
                ${stats.mostPlayedArtist?.name || 'N/A'}
              </div>
              
              <div class="bento-badge" style="font-size:11px; padding:4px 10px; margin-bottom:10px; align-self:flex-start; background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.1);">
                総再生の ${stats.topArtistShare}
              </div>

              ${topArtistsSubHtml}
            </div>
          </div>

          <div class="bento-item ranking-list-container">
            <div class="bento-label">${t('replay_ranking')}</div>
            <div class="replay-list">`;

      stats.topSongs.forEach((song, idx) => {
        const timeStr = this.formatDuration(song.totalDuration);
        html += `
          <div class="replay-item">
            <div class="replay-rank">${idx + 1}</div>
            <div class="replay-img">${song.src ? `<img src="${song.src}" crossorigin="anonymous">` : ''}</div>
            <div class="replay-info">
              <div class="replay-title">${song.title}</div>
              <div class="replay-artist">${song.artist}</div>
            </div>
            <div class="replay-count">
              <div class="replay-count-val">${song.count}${config.uiLang === 'ja' ? '回' : ''}</div>
              <div class="replay-time-val">${timeStr}</div>
            </div>
          </div>`;
      });
      html += `</div></div></div>`;
      container.innerHTML = html;
    },

    init: function () {
      setInterval(() => this.check(), 1000);
    }
  };


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

      // ===== Pin to keep Up Next always visible =====
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
        body {
          margin: 0; overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
          background: #000; color: #fff;
          cursor: default;
        }
        @keyframes bgFloat {
          0% { transform: scale(1.4) rotate(0deg); }
          50% { transform: scale(1.6) rotate(8deg); }
          100% { transform: scale(1.4) rotate(0deg); }
        }
        #pip-bg-layer {
          position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
          z-index: -2;
          background-size: cover; background-position: center;
          filter: blur(60px) saturate(240%) brightness(0.7);
          animation: bgFloat 45s ease-in-out infinite;
          opacity: 1; transition: background-image 0.8s ease;
        }
        #pip-noise-layer {
          position: fixed; inset: 0; z-index: -1;
          opacity: 0.06; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
        }
        #pip-bg-overlay {
          position: fixed; inset: 0; z-index: -1;
          background: linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.5));
        }
        .lyric-line {
          color: rgba(255, 255, 255, 0.5) !important;
          font-size: 26px !important; font-weight: 700 !important;
          margin-bottom: 30px !important; line-height: 1.35 !important;
          transition: all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
          filter: blur(0.8px); transform: scale(0.96);
          text-align: center !important; width: 100%;
          cursor: pointer !important; 
          letter-spacing: -0.01em;
        }
        .lyric-line:hover {
          color: rgba(255, 255, 255, 0.8) !important; 
        }
        .lyric-line.active {
          color: #ffffff !important; filter: blur(0) !important;
          transform: scale(1.08) !important; 
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.5) !important;
          opacity: 1 !important;
        }
        
        .lyric-line.active .lyric-char {
            display: inline-block;
            transition: opacity 0.1s linear, transform 0.1s linear, text-shadow 0.1s linear;
        }
        .lyric-line.active .lyric-char.char-pending {
            opacity: 0.35 !important;
            text-shadow: none !important;
        }
        .lyric-line.active .lyric-char.char-active {
            opacity: 1 !important;
            color: #ffffff !important;
            transform: translateY(-2px);
            text-shadow: 0 0 15px rgba(255, 255, 255, 0.9) !important;
        }

        .lyric-translation { font-size: 0.65em; opacity: 0.7; font-weight: 600; margin-top: 6px; display: block; }
        #pip-lyrics-container::-webkit-scrollbar { display: none; }
        #pip-lyrics-container { -ms-overflow-style: none; scrollbar-width: none; }

        body.ytm-no-timestamp .lyric-line {
          color: #fff !important;
          filter: blur(0) !important;
          transform: scale(1) !important;
          opacity: 1 !important;
          cursor: default !important;
          margin-bottom: 20px !important;
          text-shadow: 0 0 10px rgba(0, 0, 0, 0.3) !important;
        }
    `;
      pipDoc.head.appendChild(forceStyle);
      pipDoc.body.className = 'ytm-pip-mode';

      if (document.body.classList.contains('ytm-no-timestamp')) {
        pipDoc.body.classList.add('ytm-no-timestamp');
      }

      const bgLayer = pipDoc.createElement('div'); bgLayer.id = 'pip-bg-layer';
      pipDoc.body.appendChild(bgLayer);
      const noiseLayer = pipDoc.createElement('div'); noiseLayer.id = 'pip-noise-layer';
      pipDoc.body.appendChild(noiseLayer);
      const bgOverlay = pipDoc.createElement('div'); bgOverlay.id = 'pip-bg-overlay';
      pipDoc.body.appendChild(bgOverlay);

      const container = pipDoc.createElement('div');
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.height = '100vh';
      container.style.width = '100vw';
      container.style.zIndex = '1';
      container.style.alignItems = 'center';
      pipDoc.body.appendChild(container);

      const artworkUrl = ui.artwork.querySelector('img')?.src || '';
      bgLayer.style.backgroundImage = `url(${artworkUrl})`;

      const header = pipDoc.createElement('div');
      header.style.width = '100%';
      header.style.padding = '30px 20px 20px 20px';
      header.style.textAlign = 'center';
      header.style.flexShrink = '0';
      header.style.display = 'flex';
      header.style.flexDirection = 'column';
      header.style.alignItems = 'center';
      header.style.boxSizing = 'border-box';
      header.innerHTML = `
        <div style="width:130px; height:130px; border-radius:16px; overflow:hidden; margin: 0 auto 20px auto; box-shadow: 0 16px 50px rgba(0,0,0,0.5); transition: transform 0.3s;">
            <img id="pip-img" src="${artworkUrl}" style="width:100%; height:100%; object-fit:cover;">
        </div>
        <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
            <div id="pip-title" style="
                font-size: 18px; font-weight: 800; color: #fff; 
                margin-bottom: 6px; line-height: 1.3; text-align: center; width: 100%;
                text-shadow: 0 2px 10px rgba(0,0,0,0.5);
                display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
            ">${ui.title.textContent}</div>
            <div id="pip-artist" style="
                font-size: 14px; color: rgba(255,255,255,0.85); text-align: center; width: 100%;
                text-shadow: 0 2px 10px rgba(0,0,0,0.5);
            ">${ui.artist.textContent}</div>
        </div>
      `;
      container.appendChild(header);

      this.pipLyricsContainer = pipDoc.createElement('div');
      this.pipLyricsContainer.id = 'pip-lyrics-container';
      this.pipLyricsContainer.style.height = '100%';
      this.pipLyricsContainer.style.overflowY = 'auto';
      this.pipLyricsContainer.style.padding = '10px 24px 40px 24px';
      this.pipLyricsContainer.style.flex = '1';
      this.pipLyricsContainer.style.width = '100%';
      this.pipLyricsContainer.style.boxSizing = 'border-box';
      this.pipLyricsContainer.style.maskImage = 'linear-gradient(to bottom, transparent 0%, black 10%, black 85%, transparent 100%)';
      this.pipLyricsContainer.style.textAlign = 'center';
      this.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      container.appendChild(this.pipLyricsContainer);

      this.pipLyricsContainer.addEventListener('click', (e) => {
        const target = e.target.closest('.lyric-line');
        if (!target) return;
        const timeStr = target.dataset.startTime;
        if (timeStr) {
          const time = parseFloat(timeStr);
          if (!isNaN(time)) {
            const v = document.querySelector('video');
            if (v) {
              v.currentTime = time + timeOffset;
            }
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
    },

    resetLyrics: function () {
      if (this.pipWindow && this.pipLyricsContainer) {
        this.pipLyricsContainer.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';
      }
    },

    updatePlayState: function (isPaused) {
    
    }
  };
  const resolveDeepLTargetLang = (lang) => {
    switch ((lang || '').toLowerCase()) {
      case 'en': case 'en-us': case 'en-gb': return 'EN';
      case 'ja': return 'JA';
      case 'ko': return 'KO';
      case 'fr': return 'FR';
      case 'de': return 'DE';
      case 'es': return 'ES';
      case 'zh': case 'zh-cn': case 'zh-tw': return 'ZH';
      default: return 'JA';
    }
  };

  const parseLRCInternal = (lrc) => {
    if (!lrc) return { lines: [], hasTs: false };
    const tagTest = /\[\d{2}:\d{2}\.\d{2,3}\]/;

    // タイムスタンプがない場合
    if (!tagTest.test(lrc)) {
      // 空行も保持して、翻訳時に行が詰まらないようにする
      const lines = lrc.split(/\r?\n/).map(line => {
        const text = (line ?? '').replace(/^\s+|\s+$/g, '');
        return { time: null, text };
      });
      return { lines, hasTs: false };
    }

    // タイムスタンプがある場合
    const tagExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    const result = [];
    let match;
    let lastTime = null;
    let lastIndex = 0;

    while ((match = tagExp.exec(lrc)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3];
      const frac = parseInt(fracStr, 10) / (fracStr.length === 2 ? 100 : 1000);
      const time = min * 60 + sec + frac;

      if (lastTime !== null) {
        const rawText = lrc.slice(lastIndex, match.index);
        const cleaned = rawText.replace(/\r?\n/g, ' ');
        const text = cleaned.trim();
        const hasLineBreak = /[\r\n]/.test(rawText);
        if (text || hasLineBreak) {
          result.push({ time: lastTime, text });
        }
      }
      lastTime = time;
      lastIndex = tagExp.lastIndex;
    }

    // 最後の行の処理
    if (lastTime !== null && lastIndex < lrc.length) {
      const rawText = lrc.slice(lastIndex);
      const cleaned = rawText.replace(/\r?\n/g, ' ');
      const text = cleaned.trim();
      // ★修正: 空行(明示的な改行のみ)も保持してタイムスタンプのズレを防ぐ
      const hasLineBreak = /[\r\n]/.test(rawText);
      if (text || hasLineBreak) {
        result.push({ time: lastTime, text });
      }
    }

    result.sort((a, b) => (a.time || 0) - (b.time || 0));
    return { lines: result, hasTs: true };
  };


  const parseBaseLRC = (lrc) => {
    const { lines, hasTs } = parseLRCInternal(lrc);
    hasTimestamp = hasTs;
    return lines;
  };

  // ===== duet helpers =====
  const timeKey = (t) => {
    if (typeof t !== 'number' || Number.isNaN(t)) return 'NaN';
    // milliseconds precision is enough for LRC tags
    return t.toFixed(3);
  };

  // Dynamic.lrc形式のパーサー（sub.txt用）
  const parseDynamicLrcForSub = (text) => {
    const out = [];
    if (!text) return out;

    const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const parseLrcTimeToMsSub = (ts) => {
      const s = String(ts || '').trim();
      const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
      if (!m) return null;
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      let frac = m[3] || '0';
      if (frac.length === 1) frac = frac + '00';
      else if (frac.length === 2) frac = frac + '0';
      const ms = parseInt(frac.slice(0, 3), 10);
      if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ms)) return null;
      return (mm * 60 + ss) * 1000 + ms;
    };

    // 1st pass: parse lines
    const parsed = [];
    for (const raw of rows) {
      const line = raw.trimEnd();
      if (!line) continue;

      const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) continue;

      parsed.push({
        lineMs: parseLrcTimeToMsSub(m[1]),
        rest: m[2] || '',
      });
    }

    const pushDistributed = (chars, chunk, startMs, endMs) => {
      if (!chunk) return;
      const arr = Array.from(chunk);
      const n = arr.length;
      if (!n) return;

      const s = (typeof startMs === 'number') ? startMs : null;
      const e = (typeof endMs === 'number') ? endMs : null;

      if (s == null) {
        for (const ch of arr) chars.push({ t: 0, c: ch });
        return;
      }

      if (e == null || e <= s) {
        for (const ch of arr) chars.push({ t: s, c: ch });
        return;
      }

      const dur = Math.max(1, e - s);
      const step = dur / n;

      for (let i = 0; i < n; i++) {
        const t = s + Math.floor(step * i);
        chars.push({ t, c: arr[i] });
      }
    };

    for (let li = 0; li < parsed.length; li++) {
      const { lineMs, rest } = parsed[li];
      const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
        ? parsed[li + 1].lineMs
        : null;

      const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
      const chars = [];

      let prevMs = null;
      let prevEnd = 0;

      while (true) {
        const mm = tagRe.exec(rest);
        if (!mm) break;

        const tagMs = parseLrcTimeToMsSub(mm[1]);

        if (prevMs == null && tagMs != null && mm.index > prevEnd) {
          const chunk0 = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk0, tagMs, tagMs);
        }

        if (prevMs != null) {
          const chunk = rest.slice(prevEnd, mm.index);
          pushDistributed(chars, chunk, prevMs, tagMs);
        }

        prevMs = tagMs;
        prevEnd = mm.index + mm[0].length;
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd);
        let endMs = nextLineMs;
        if (typeof endMs !== 'number') endMs = prevMs + 1500;
        if (endMs <= prevMs) endMs = prevMs + 200;
        pushDistributed(chars, chunk, prevMs, endMs);
      }

      const textLine = chars.map(c => c.c).join('');

      out.push({
        startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
        text: textLine,
        chars,
      });
    }

    return out;
  };

  // Dynamic.lrc形式かどうかを判定
  const isDynamicLrcFormat = (text) => {
    if (!text) return false;
    // <00:00.00>形式のタグが含まれていればDynamic.lrc形式
    return /<\d+:\d{2}(?:\.\d{1,3})?>/.test(text);
  };

  const parseSubLRC = (lrc) => {
    // Dynamic.lrc形式の場合は専用パーサーを使用
    if (isDynamicLrcFormat(lrc)) {
      const dynLines = parseDynamicLrcForSub(lrc);
      if (dynLines && dynLines.length) {
        // dynamicLinesからLRC形式のlinesに変換
        const lines = dynLines.map(dl => ({
          time: (typeof dl.startTimeMs === 'number') ? dl.startTimeMs / 1000 : null,
          text: dl.text || '',
        }));
        // サブ用のdynamicLinesを保存
        duetSubDynamicLines = dynLines;
        return { lines, hasTs: true, dynamicLines: dynLines };
      }
    }
    
    // 通常のLRC形式
    duetSubDynamicLines = null;
    const { lines, hasTs } = parseLRCInternal(lrc);
    return { lines: Array.isArray(lines) ? lines : [], hasTs: !!hasTs, dynamicLines: null };
  };

  const mergeDuetLines = (mainLines, subLines) => {
    // タイムスタンプの許容誤差 (秒)
    const TIME_TOLERANCE = 0.5;

    const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
    
    // サブ歌詞のタイムスタンプセットを作成（高速検索用）
    const subTimeSet = new Set();
    subLinesWithTime.forEach(sub => {
      // 許容誤差を考慮して、0.1秒刻みでキーを追加
      const baseMs = Math.round(sub.time * 10);
      for (let i = -5; i <= 5; i++) {
        subTimeSet.add(baseMs + i);
      }
    });

    // sub歌詞と時間が被るメイン歌詞を除外する
    // また、除外されたメイン歌詞のタイムスタンプを記録
    const excludedMainTimes = new Set();
    const filteredMain = (mainLines || []).filter(l => {
      if (typeof l?.time !== 'number') return true;
      // 時間が近似しているサブ歌詞があるかチェック
      const keyMs = Math.round(l.time * 10);
      const collision = subTimeSet.has(keyMs);
      if (collision) {
        excludedMainTimes.add(Math.round(l.time * 1000)); // ミリ秒精度で記録
      }
      return !collision;
    });
    
    // dynamicLinesからも除外されたメイン行に対応するものを除外
    // （グローバル変数dynamicLinesを直接変更せず、フィルタ用のセットを保存）
    _duetExcludedTimes = excludedMainTimes;

    const merged = [];
    filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
    (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

    merged.sort((a, b) => {
      const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
      const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;
      
      // 時間がほぼ同じ場合は、Left(メイン) -> Right(サブ) の順に並べる
      if (Math.abs(at - bt) < 0.05) {
        const ap = a.duetSide === 'right' ? 1 : 0;
        const bp = b.duetSide === 'right' ? 1 : 0;
        return ap - bp;
      }
      return at - bt;
    });

    return merged;
  };

  const getDynamicLineForTime = (sec) => {
    if (!dynamicLines || !Array.isArray(dynamicLines) || !dynamicLines.length) return null;
    
    // デュエットモードで除外されたタイムスタンプかチェック
    const isDuetMode = document.body.classList.contains('ytm-duet-mode');
    if (isDuetMode && _duetExcludedTimes && _duetExcludedTimes.size > 0) {
      const secMs = Math.round(sec * 1000);
      // 許容誤差50ms以内で除外されたタイムスタンプをチェック
      for (let offset = -50; offset <= 50; offset += 10) {
        if (_duetExcludedTimes.has(secMs + offset)) {
          return null; // このタイムスタンプはsub.txtで上書きされているので無視
        }
      }
    }

    // マップキャッシュの再構築（参照が変わった時のみ）
    if (_dynMapSrc !== dynamicLines) {
      _dynMapSrc = dynamicLines;
      _dynMap = new Map();

      dynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _dynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 完全一致トライ
    const exact = _dynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 近似値トライ (前後0.15秒)
    const TOLERANCE = 0.15;
    const found = dynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };

  // サブボーカル用のdynamicLine取得（sub.txtのDynamic.lrc対応）
  let _subDynMapSrc = null;
  let _subDynMap = null;
  
  const getSubDynamicLineForTime = (sec) => {
    if (!duetSubDynamicLines || !Array.isArray(duetSubDynamicLines) || !duetSubDynamicLines.length) return null;
    
    // マップキャッシュの再構築（参照が変わった時のみ）
    if (_subDynMapSrc !== duetSubDynamicLines) {
      _subDynMapSrc = duetSubDynamicLines;
      _subDynMap = new Map();

      duetSubDynamicLines.forEach(dl => {
        let ms = null;
        if (typeof dl?.startTimeMs === 'number') {
          ms = dl.startTimeMs;
        } else if (typeof dl?.startTimeMs === 'string') {
          const n = Number(dl.startTimeMs);
          if (!Number.isNaN(n)) ms = n;
        } else if (Array.isArray(dl?.chars) && dl.chars.length) {
          const ts = dl.chars.map(c => (typeof c?.t === 'number' ? c.t : null)).filter(v => v != null);
          if (ts.length) ms = Math.min(...ts);
        }

        if (typeof ms === 'number') {
          _subDynMap.set(timeKey(ms / 1000), dl);
        }
      });
    }

    // 1. 完全一致トライ
    const exact = _subDynMap?.get(timeKey(sec));
    if (exact) return exact;

    // 2. 近似値トライ (前後0.15秒)
    const TOLERANCE = 0.15;
    const found = duetSubDynamicLines.find(dl => {
       let startS = 0;
       if (typeof dl.startTimeMs === 'number') startS = dl.startTimeMs / 1000;
       else if (dl.time) startS = dl.time;
       return Math.abs(startS - sec) <= TOLERANCE;
    });

    return found || null;
  };
  function setupMovieMode() {
    const check = () => {
      const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");
      const target = document.querySelector("#ytm-custom-wrapper");
      const switcher = document.querySelector("ytmusic-av-toggle");
      const switcherTarget = document.querySelector("#ytm-custom-info-area");

      if (!video || !target || !switcher || !switcherTarget) {
        setTimeout(check, 100);
        return;
      }

      movieObserver = observerMovieModeSetup();
    };
    check();
  };
  function bringSwitcherOnly(){
    const switcher = document.querySelector("ytmusic-av-toggle");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    customSwitcherParent.appendChild(switcher);
  }
  function changeIModeUIWithMovieMode(mode) {
    if (!mode) {
      moviemode = null;
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      const switcher = document.querySelector("ytmusic-av-toggle");
      const video = document.querySelector("ytmusic-player#player");
      const originParent = document.querySelector("div#main-panel");
      const originSwitcherTarget = originParent.children[1];
      const originTarget = originParent.children[2];
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
      if (!originParent.contains(switcher)) {
        originSwitcherTarget.appendChild(switcher);
      }
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 300);
    }
    else {
      if (movieObserver) movieObserver.stop();
      movieObserver = null;
      movieObserver = observerMovieModeSetup();
    }
  }
  const observerMovieModeSetup = () => {
    const switcher = document.querySelector("ytmusic-av-toggle");
    if (!switcher) return null;

    if (movieObserver) {
      movieObserver.stop();
      movieObserver = null;
    }

    let changed;
    let classTargets = [];

    const handleMutation = () => {
      const mode = switcher.getAttribute("playback-mode");
      const newMoviemode = (mode === "OMV_PREFERRED") ? true : false;

      if (moviemode !== newMoviemode) {
        changed = true;
      } else {
        changed = false;
      }

      moviemode = newMoviemode;

      classTargets = [];
      const wrapper = document.querySelector("#ytm-custom-wrapper");
      if (wrapper instanceof Element) {
        classTargets.push(...wrapper.querySelectorAll("*"));
      }
      const pusher = (element) => {
        if (element instanceof Element) classTargets.push(element);
      };
      const playerBar = document.querySelector("ytmusic-player-bar");
      pusher(playerBar);
      pusher(switcher);
      const video = document.querySelector("ytmusic-player#player");
      pusher(video);
      const navBar = document.querySelector("ytmusic-nav-bar");
      pusher(navBar);

      classTargets.forEach(element => {
        if (moviemode) {
          element.classList.add("moviemode");
        } else {
          element.classList.remove("moviemode");
        }
      });

      changeUIWithMovieMode(changed);
    };

    const preferMode = switcher.getAttribute("playback-mode");

    handleMutation();
    bringSwitcherOnly();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "playback-mode") {
          handleMutation();
        }
      });
    });

    observer.observe(switcher, { attributes: true });

    movieObserver = {
      stop: () => {
        observer.disconnect();
        movieObserver = null;
      }
    };

    return movieObserver;
  };
  function changeUIWithMovieMode(changed) {
    if (!changed || changed === null) return;
    const originParent = document.querySelector("div#main-panel");
    const originTarget = originParent.children[2];
    const customParent = document.querySelector("#ytm-custom-wrapper");
    const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
    const switcher = document.querySelector("ytmusic-av-toggle");
    const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");

    if (moviemode) {
      customParent.prepend(video);
      customSwitcherParent.appendChild(switcher);
    }
    else {
      if (!originParent.contains(video)) {
        originParent.insertBefore(video, originTarget);
      }
    }
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 100);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
  function isYTMPremiumUser() {
    const switcher = document.querySelector("ytmusic-av-toggle");
    const requireSignIn = !!document.querySelector('ytmusic-guide-signin-promo-renderer');
    const primarySection = document.querySelector('#mini-guide ytmusic-guide-section-renderer[is-primary] div#items');
    const notPremium = primarySection ? primarySection.childNodes.length >= 4 : false;
    if(!requireSignIn && !notPremium){
      if(switcher) switcher.classList.remove('notpremium');
    }
    else {
      if(switcher) switcher.classList.add('notpremium');
    }
    return !requireSignIn || !notPremium;
  }
  const hoverTimeInfoSetup = () => {
    const timeToSeconds = (str) => {
      const [m, s] = str.split(":").map(Number);
      return m * 60 + s;
    };
    const removeHoverTimeInfo = () => {
      const info = document.querySelector('#hover-time-info');
      const interval = setInterval(() => {
        if (info) {
          info.remove();
          clearInterval(interval);
        }
      }, 1000);
    };
    const createHoverTimeInfo = () => {
      let info = document.querySelector('#hover-time-info-new');
      const parent = document.querySelector('ytmusic-player-bar');
      if (!info) {
        info = document.createElement('span');
        info.id = 'hover-time-info-new';
        info.style.display = 'none';
        info.textContent = '0:00';
        document.body.appendChild(info);
      }
    };
    const adjustHoverTimeInfoPosition = () => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const slider = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      ).parentElement.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');
      const refresh = () => {
        const onMove = (e) => {
          const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
          const infoLeft = e.clientX;
          const relativeMouseX = e.clientX - marginLeft;
          const timeinfo = document.querySelector('#left-controls > span');
          const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
          const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
          const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
          const hoverTimeString = `${String(Math.floor(hoverTimeSeconds / 60))}:${String(hoverTimeSeconds % 60).padStart(2, '0')}`;
          info.style.display = 'block';
          info.style.left = `${infoLeft}px`;
          info.textContent = hoverTimeString;
        };
        const hide = () => {
          info.style.display = 'none';
        };
        slider.addEventListener('mousemove', onMove);
        slider.addEventListener('mouseout', hide);
        progresshandle.addEventListener('mousemove', onMove);
        progresshandle.addEventListener('mouseout', hide);
      };
      const interval = setInterval(() => {
        if (slider && info && progresshandle) {
          refresh();
          clearInterval(interval);
        }
      }, 1000);
    };
    removeHoverTimeInfo();
    createHoverTimeInfo();
    adjustHoverTimeInfoPosition();
  };

  const parseLRCNoFlag = (lrc) => {
    return parseLRCInternal(lrc).lines;
  };

  const normalizeStr = (s) => (s || '').replace(/\s+/g, '').trim();

  const isMixedLang = (s) => {
    if (!s) return false;
    const hasLatin = /[A-Za-z]/.test(s);
    const hasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
    const hasHangul = /[\uAC00-\uD7AF]/.test(s);
    let kinds = 0;
    if (hasLatin) kinds++;
    if (hasCJK) kinds++;
    if (hasHangul) kinds++;
    return kinds >= 2;
  };

  const detectCharScript = (ch) => {
    if (!ch) return 'OTHER';
    if (/[A-Za-z]/.test(ch)) return 'LATIN';
    if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) return 'CJK';
    if (/[\uAC00-\uD7AF]/.test(ch)) return 'HANGUL';
    return 'OTHER';
  };

  const segmentByScript = (s) => {
    const result = [];
    if (!s) return result;
    let currentScript = null;
    let buf = '';
    for (const ch of s) {
      const script = detectCharScript(ch);
      if (currentScript === null) {
        currentScript = script;
        buf = ch;
      } else if (script === currentScript) {
        buf += ch;
      } else {
        result.push({ script: currentScript, text: buf });
        currentScript = script;
        buf = ch;
      }
    }
    if (buf) {
      result.push({ script: currentScript, text: buf });
    }
    return result;
  };

  const shouldTranslateSegment = (script, langCode) => {
    const lang = (langCode || '').toLowerCase();
    if (script === 'OTHER') return false;
    switch (lang) {
      case 'ja': return script === 'LATIN' || script === 'HANGUL';
      case 'en': return script === 'CJK' || script === 'HANGUL';
      case 'ko': return script === 'LATIN' || script === 'CJK';
      default: return script !== 'LATIN';
    }
  };

  const translateMixedSegments = async (lines, indexes, langCode, targetLang) => {
    try {
      const segmentsToTranslate = [];
      const perLineSegments = {};
      indexes.forEach(idx => {
        const line = lines[idx];
        const text = (line && line.text) || '';
        const segs = segmentByScript(text);
        const segMeta = [];
        segs.forEach(seg => {
          if (shouldTranslateSegment(seg.script, langCode)) {
            const translateIndex = segmentsToTranslate.length;
            segmentsToTranslate.push(seg.text);
            segMeta.push({ original: seg.text, translateIndex });
          } else {
            segMeta.push({ original: seg.text, translateIndex: null });
          }
        });
        perLineSegments[idx] = segMeta;
      });
      if (!segmentsToTranslate.length) return null;
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'TRANSLATE', payload: { text: segmentsToTranslate, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: (config.useSharedTranslateApi && !config.fastMode) } },
          resolve
        );
      });
      if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== segmentsToTranslate.length) {
        return null;
      }
      const segTranslations = res.translations.map(t => t.text || '');
      const result = {};
      Object.keys(perLineSegments).forEach(key => {
        const lineIdx = Number(key);
        const segMeta = perLineSegments[lineIdx];
        let rebuilt = '';
        segMeta.forEach(seg => {
          if (seg.translateIndex == null) {
            rebuilt += seg.original;
          } else {
            rebuilt += segTranslations[seg.translateIndex] ?? seg.original;
          }
        });
        result[lineIdx] = rebuilt;
      });
      return result;
    } catch (e) {
      console.error('DeepL mixed-line fallback failed', e);
      return null;
    }
  };

  const dedupePrimarySecondary = (lines) => {
    if (!Array.isArray(lines)) return lines;
    lines.forEach(l => {
      if (!l.translation) return;
      const src = normalizeStr(l.text);
      const trn = normalizeStr(l.translation);
      if (src === trn && !isMixedLang(l.text)) {
        delete l.translation;
      }
    });
    return lines;
  };

  const translateTo = async (lines, langCode) => {
    if ((!config.deepLKey && !(config.useSharedTranslateApi && !config.fastMode)) || !lines.length) return null;
    const targetLang = resolveDeepLTargetLang(langCode);
    try {
      const baseTexts = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '');
      // 空行は翻訳APIへ送らず、行数だけ保持してタイムスタンプのズレを防ぐ
      const mapIdx = [];
      const requestTexts = [];
      for (let i = 0; i < baseTexts.length; i++) {
        const t = baseTexts[i];
        if ((t || '').trim()) {
          mapIdx.push(i);
          requestTexts.push(t);
        }
      }

      let translated = new Array(lines.length).fill('');

      if (requestTexts.length) {
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage(
            { type: 'TRANSLATE', payload: { text: requestTexts, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: (config.useSharedTranslateApi && !config.fastMode) } },
            resolve
          );
        });

        if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== requestTexts.length) {
          return null;
        }

        for (let i = 0; i < mapIdx.length; i++) {
          const tr = res.translations[i];
          translated[mapIdx[i]] = (tr && tr.text) ? tr.text : '';
        }
      }
      const fallbackIndexes = [];
      for (let i = 0; i < lines.length; i++) {
        const src = baseTexts[i];
        const trn = translated[i];
        if (!src) continue;
        if (normalizeStr(src) === normalizeStr(trn) && isMixedLang(src)) {
          fallbackIndexes.push(i);
        }
      }
      if (fallbackIndexes.length) {
        const mixedFallback = await translateMixedSegments(lines, fallbackIndexes, langCode, targetLang);
        if (mixedFallback) {
          fallbackIndexes.forEach(i => {
            if (mixedFallback[i]) translated[i] = mixedFallback[i];
          });
        }
      }
      return translated;
    } catch (e) {
      console.error('DeepL failed', e);
    }
    return null;
  };


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
  // ===================== Discord Presence (Localhost) =====================
  const DISCORD_PRESENCE_THROTTLE_MS = 1200;
  let __lastPresence = { line1: '', line2: '', ts: 0 };

  const _normPresence = (s, maxLen = 128) => {
    const t = (s ?? '').toString().replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > maxLen ? (t.slice(0, maxLen - 1) + '…') : t;
  };

  const _buildPresenceLine1 = (meta) => {
    if (!meta) return '';
    const parts = [meta.artist, meta.album, meta.title]
      .map(v => (v ?? '').toString().trim())
      .filter(Boolean);
    return parts.join(' - ');
  };

//歌詞送信ロジック
  const sendDiscordPresence = (meta, lyricLine) => {
    try {
      if (!meta) return;
      const line1 = _normPresence(_buildPresenceLine1(meta), 128);
      const line2 = _normPresence(lyricLine || '', 128);
      const now = Date.now();

      // Don't spam: send only if content changed OR enough time passed
      if (line1 === __lastPresence.line1 && line2 === __lastPresence.line2 && (now - __lastPresence.ts) < DISCORD_PRESENCE_THROTTLE_MS) {
        return;
      }
      __lastPresence = { line1, line2, ts: now };

      chrome.runtime.sendMessage({
        type: 'DISCORD_PRESENCE_UPDATE',
        payload: {
          line1,
          line2,
          url: getCurrentVideoUrl(),
          meta: {
            title: meta.title || '',
            artist: meta.artist || '',
            album: meta.album || '',
            src: meta.src || null
          }
        }
      });
    } catch (e) {
      // ignore
    }
  };

  const clearDiscordPresence = () => {
    try {
      chrome.runtime.sendMessage({ type: 'DISCORD_PRESENCE_CLEAR' });
    } catch (e) { }
  };


  const getCurrentVideoUrl = () => {
    try {
      const url = new URL(location.href);
      const vid = url.searchParams.get('v');
      return vid ? `https://youtu.be/${vid}` : location.href;
    } catch (e) {
      console.warn('Failed to get current video url', e);
      return '';
    }
  };

  const getCurrentVideoId = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v');
    } catch (e) {
      return null;
    }
  };

  // === BG からの後追いメタ更新（遅い方待ちをやめた時用）===
  // GitHub で先に歌詞だけ返ってきた後に、LRCHub 側の candidates/config/requests が来たら UI を更新する
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'LYRICS_META_UPDATE') return;
      const p = msg.payload || {};
      const curVid = getCurrentVideoId();
      if (p.video_id && curVid && p.video_id !== curVid) return;

      if (Array.isArray(p.candidates)) lyricsCandidates = p.candidates;
      if (p.config !== undefined) lyricsConfig = p.config;
      if (Array.isArray(p.requests)) lyricsRequests = p.requests;

      // duet: sub lyrics can arrive later (GitHub)
      if (typeof p.subLyrics === 'string') {
        duetSubLyricsRaw = p.subLyrics;
        // re-render with same raw lyrics to avoid showing duplicate left+right lines
        if (lastRawLyricsText && typeof lastRawLyricsText === 'string') {
          applyLyricsText(lastRawLyricsText);
        }
      }

      // dynamic: char-timed lines can arrive later (GitHub) even if lyrics came from API
      if (Array.isArray(p.dynamicLines) && p.dynamicLines.length) {
        dynamicLines = p.dynamicLines;
        // re-render to attach per-char spans while keeping current lines/translations
        if (Array.isArray(lyricsData) && lyricsData.length) {
          renderLyrics(lyricsData);
        }
      }

      // candidates/config が更新されたらメニューを再描画
      refreshCandidateMenu();
      refreshLockMenu();
    } catch (e) {
      // ignore
    }
  });

  const createEl = (tag, id, cls, html) => {
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (cls) el.className = cls;
    if (html !== undefined && html !== null) el.innerHTML = html;
    return el;
  };

  const showToast = (text) => {
    if (!text) return;
    let el = document.getElementById('ytm-toast');
    if (!el) {
      el = createEl('div', 'ytm-toast', '', '');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('visible');
    }, 5000);
  };

  function setupAutoHideEvents() {
    if (document.body.dataset.autohideSetup) return;
    ['mousemove', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
    document.body.dataset.autohideSetup = 'true';
    handleInteraction();
  }
  

  // ===================== 歌詞＋翻訳適用 =====================

  async function applyTranslations(baseLines, youtubeUrl) {
    if (!config.useTrans || !Array.isArray(baseLines) || !baseLines.length) return baseLines;
    const mainLangStored = await storage.get('ytm_main_lang');
    const subLangStored = await storage.get('ytm_sub_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
    const mainLang = config.mainLang || 'original';
    const subLang = config.subLang || '';
    const langsToFetch = [];
    if (mainLang && mainLang !== 'original') langsToFetch.push(mainLang);
    if (subLang && subLang !== 'original' && subLang !== mainLang && subLang) langsToFetch.push(subLang);
    if (!langsToFetch.length) return baseLines;

    let lrcMap = {};
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'GET_TRANSLATION',
          payload: { youtube_url: youtubeUrl, langs: langsToFetch }
        }, resolve);
      });
      if (res?.success && res.lrcMap) lrcMap = res.lrcMap;
    } catch (e) {
      console.warn('GET_TRANSLATION failed', e);
    }

    const transLinesByLang = {};
    const needDeepL = [];

    langsToFetch.forEach(lang => {
      const lrc = (lrcMap && lrcMap[lang]) || '';
      if (lrc) {
        const parsed = parseLRCNoFlag(lrc);
        transLinesByLang[lang] = parsed;
      } else {
        needDeepL.push(lang);
      }
    });

    if (needDeepL.length &&  (config.deepLKey || (config.useSharedTranslateApi && !config.fastMode)) ) {
      for (const lang of needDeepL) {
        const translatedTexts = await translateTo(baseLines, lang);
        if (translatedTexts && translatedTexts.length === baseLines.length) {
          const lines = baseLines.map((l, i) => ({
            time: l.time,
            text: translatedTexts[i]
          }));
          transLinesByLang[lang] = lines;
          const plain = translatedTexts.join('\n');
          if (plain.trim()) {
            chrome.runtime.sendMessage({
              type: 'REGISTER_TRANSLATION',
              payload: { youtube_url: youtubeUrl, lang, lyrics: plain }
            }, (res) => {
              console.log('[CS] REGISTER_TRANSLATION', lang, res);
            });
          }
        }
      }
    }

    const alignedMap = buildAlignedTranslations(baseLines, transLinesByLang);
    const final = baseLines.map(l => ({ ...l }));
    const getLangTextAt = (langCode, index, baseText) => {
      if (!langCode || langCode === 'original') return baseText;
      const arr = alignedMap[langCode];
      if (!arr) return baseText;
      const v = arr[index];
      return (v === null || v === undefined) ? baseText : v;
    };

    for (let i = 0; i < final.length; i++) {
      const baseText = final[i].text;
      let primary = getLangTextAt(mainLang, i, baseText);
      let secondary = null;
      if (subLang && subLang !== mainLang) {
        secondary = getLangTextAt(subLang, i, baseText);
      } else if (!subLang && mainLang !== 'original') {
        if (normalizeStr(primary) !== normalizeStr(baseText)) {
          secondary = baseText;
        }
      }
      if (secondary && normalizeStr(primary) === normalizeStr(secondary)) {
        if (!isMixedLang(baseText)) secondary = null;
      }
      final[i].text = primary;
      if (secondary) final[i].translation = secondary;
      else delete final[i].translation;
    }
    dedupePrimarySecondary(final);
    return final;
  }

  const buildAlignedTranslations = (baseLines, transLinesByLang) => {
    const alignedMap = {};
    const TOL = 0.15;
    Object.keys(transLinesByLang).forEach(lang => {
      const arr = transLinesByLang[lang];
      const res = new Array(baseLines.length).fill(null);
      if (!Array.isArray(arr) || !arr.length) {
        alignedMap[lang] = res;
        return;
      }
      const hasAnyTime = arr.some(x => x && typeof x.time === 'number');
      if (!hasAnyTime) {
        // タイムスタンプ無しの翻訳は「空行を消費しない」方式で合わせる
        let k = 0;
        for (let i = 0; i < baseLines.length; i++) {
          const baseTextRaw = (baseLines[i]?.text ?? '');
          const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
          if (isEmptyBaseLine) { res[i] = ''; continue; }
          const cand = arr[k];
          if (cand && typeof cand.text === 'string') {
            const trimmed = cand.text.trim();
            res[i] = trimmed === '' ? '' : trimmed;
          } else {
            res[i] = '';
          }
          k++;
        }
        alignedMap[lang] = res;
        return;
      }
      let j = 0;
      for (let i = 0; i < baseLines.length; i++) {
        const baseLine = baseLines[i] || {};
        const tBase = baseLine.time;
        const baseTextRaw = (baseLine.text ?? '');
        const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
        if (isEmptyBaseLine) {
          res[i] = '';
          continue;
        }
        if (typeof tBase !== 'number') {
          const cand = arr[i];
          if (cand && typeof cand.text === 'string') {
            const raw = cand.text;
            const trimmed = raw.trim();
            res[i] = trimmed === '' ? '' : trimmed;
          }
          continue;
        }
        while (j < arr.length && typeof arr[j].time === 'number' && arr[j].time < tBase - TOL) {
          j++;
        }
        if (j < arr.length && typeof arr[j].time === 'number' && Math.abs(arr[j].time - tBase) <= TOL) {
          const raw = (arr[j].text ?? '');
          const trimmed = raw.trim();
          res[i] = trimmed === '' ? '' : trimmed;
          j++;
        }
      }
      alignedMap[lang] = res;
    });
    return alignedMap;
  };

  
  // ===================== Dynamic line post-processing =====================
  // Some providers return Dynamic lyrics in "word chunks" (e.g. each char item is a whole word).
  // We normalize them into true character-level timings by distributing each chunk's duration
  // across its characters (1 char at a time).
  function normalizeDynamicLinesToCharLevel(dynLines) {
    if (!Array.isArray(dynLines) || dynLines.length === 0) return dynLines;

    const toMs = (v) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const getLineStartMs = (line) => {
      if (!line) return null;
      return toMs(line.startTimeMs) ?? toMs(line.time) ?? null;
    };

    const getCharStartMs = (ch) => {
      if (!ch) return null;
      return toMs(ch.t) ?? toMs(ch.time) ?? toMs(ch.startTimeMs) ?? null;
    };

    const isWordChunk = (s) => {
      if (typeof s !== 'string') return false;
      // Use Array.from to be Unicode-safe (emoji etc.)
      return Array.from(s).length > 1;
    };

    const expandChunk = (chunkText, startMs, endMs) => {
      const arr = Array.from(String(chunkText ?? ''));
      const n = arr.length;
      if (!n) return [];
      const s = (typeof startMs === 'number' && Number.isFinite(startMs)) ? startMs : null;
      const e = (typeof endMs === 'number' && Number.isFinite(endMs)) ? endMs : null;

      // If we can't determine timing, emit all at 0 (will appear immediately when line becomes active)
      if (s == null) return arr.map(c => ({ t: 0, c }));

      if (e == null || e <= s) return arr.map(c => ({ t: s, c }));

      const dur = Math.max(1, e - s);
      const step = dur / n;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({ t: s + Math.floor(step * i), c: arr[i] });
      }
      return out;
    };

    for (let li = 0; li < dynLines.length; li++) {
      const line = dynLines[li];
      if (!line || !Array.isArray(line.chars) || line.chars.length === 0) continue;

      // detect if any "char" item is actually a multi-character chunk (word)
      const hasChunk = line.chars.some(ch => isWordChunk(ch?.c));
      if (!hasChunk) continue;

      const nextLineStartMs = (li + 1 < dynLines.length) ? getLineStartMs(dynLines[li + 1]) : null;
      const lineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;

      // Build expanded character list
      const expanded = [];
      for (let i = 0; i < line.chars.length; i++) {
        const seg = line.chars[i];
        const segText = (seg && typeof seg.c === 'string') ? seg.c : '';
        const segStart = getCharStartMs(seg) ?? lineStartMs;

        // End bound is next segment's start, else next line, else a small fallback window
        let segEnd = (i + 1 < line.chars.length) ? getCharStartMs(line.chars[i + 1]) : null;
        if (segEnd == null) segEnd = toMs(line.endTimeMs) ?? nextLineStartMs ?? (segStart + 1500);
        if (typeof segEnd === 'number' && segEnd <= segStart) segEnd = segStart + 200;

        // Even if segText is already single "character", keep it as-is
        const segArr = Array.from(String(segText));
        if (segArr.length <= 1) {
          if (segArr.length === 1) expanded.push({ t: segStart, c: segArr[0] });
          continue;
        }

        expanded.push(...expandChunk(segText, segStart, segEnd));
      }

      // Replace with normalized chars
      line.chars = expanded;
      // Update line text if missing or mismatched
      try {
        const rebuilt = expanded.map(x => x.c).join('');
        if (typeof line.text !== 'string' || line.text.length === 0) line.text = rebuilt;
      } catch (e) { }

      // Ensure startTimeMs exists
      if (typeof line.startTimeMs !== 'number' || !Number.isFinite(line.startTimeMs)) {
        const firstT = expanded.length ? expanded[0].t : lineStartMs;
        line.startTimeMs = firstT;
      }
    }

    return dynLines;
  }

async function applyLyricsText(rawLyrics) {
    const keyAtStart = currentKey;
    if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
      if (keyAtStart !== currentKey) return;
      lyricsData = [];
      hasTimestamp = false;
      renderLyrics([]);
      return;
    }
    lastRawLyricsText = rawLyrics;
    let parsed = parseBaseLRC(rawLyrics);
    const videoUrl = getCurrentVideoUrl();

    // duet: if sub.txt exists, hide (filter) the normal lines that match sub timestamps,
    // and render the sub lines on the right.
    let baseLines = parsed;
    let hasDuetSub = false;
    
    // デュエットモードのリセット（sub.txtがない場合は除外タイムスタンプもクリア）
    _duetExcludedTimes = new Set();
    
    if (typeof duetSubLyricsRaw === 'string' && duetSubLyricsRaw.trim()) {
      const subObj = parseSubLRC(duetSubLyricsRaw);
      const subLines = subObj.lines || [];
      hasDuetSub = !!subObj.hasTs && subLines.some(l => typeof l?.time === 'number');
      if (hasDuetSub) {
        // even if the main lyrics didn't have tags, duet sub implies timestamp mode
        hasTimestamp = true;
        baseLines = mergeDuetLines(parsed, subLines);
      }
    }
    document.body.classList.toggle('ytm-duet-mode', hasDuetSub);

    let finalLines = baseLines;
    if (config.useTrans) {
      const translated = await applyTranslations(baseLines, videoUrl);
      // applyTranslations rebuilds objects, so re-attach duetSide by index
      if (Array.isArray(translated) && Array.isArray(baseLines) && translated.length === baseLines.length) {
        finalLines = translated.map((l, i) => ({ ...l, duetSide: baseLines[i]?.duetSide }));
      } else {
        finalLines = translated;
      }
    }
    if (keyAtStart !== currentKey) return;

    // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
    try {
      if (Array.isArray(dynamicLines) && dynamicLines.length) {
        dynamicLines = normalizeDynamicLinesToCharLevel(dynamicLines);
      }
    } catch (e) { }

    lyricsData = finalLines;
    renderLyrics(finalLines);
  }

  // ===================== 歌詞候補・ロック関連 =====================

  async function selectCandidateById(candId) {
    if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return;
    const cand = lyricsCandidates.find((c, idx) => (c.id || String(idx)) === candId);
  if (!cand || typeof cand.lyrics !== 'string' || !cand.lyrics.trim()) return;
  selectedCandidateId = candId;
  dynamicLines = null;
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  if (currentKey) {
  storage.set(currentKey, {
        lyrics: cand.lyrics,
        dynamicLines: null,
        noLyrics: false,
        candidateId: cand.id || null
      });
    }
    await applyLyricsText(cand.lyrics);
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const candidate_id = cand.id || candId;
    try {
      chrome.runtime.sendMessage(
        { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, candidate_id } },
        (res) => console.log('[CS] SELECT_LYRICS_CANDIDATE result:', res)
      );
    } catch (e) {
      console.warn('[CS] SELECT_LYRICS_CANDIDATE failed to send', e);
    }
    const reloadKey = currentKey;
    setTimeout(() => {
      const metaNow = getMetadata();
      if (!metaNow) return;
      const keyNow = `${metaNow.title}///${metaNow.artist}`;
      if (keyNow !== reloadKey) return;
      storage.remove(reloadKey);
      loadLyrics(metaNow);
    }, 10000);
  }

  function refreshCandidateMenu() {
    if (!ui.uploadMenu) {
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
    const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
    if (!section || !list) return;
    list.innerHTML = '';
    if (!Array.isArray(lyricsCandidates) || lyricsCandidates.length <= 1) {
      section.style.display = 'none';
      if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      return;
    }
    section.style.display = 'block';
    lyricsCandidates.forEach((cand, idx) => {
      const id = cand.id || String(idx);
      const btn = document.createElement('button');
      btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
      btn.dataset.action = 'candidate';
      btn.dataset.candidateId = id;
      let labelText = '';
      if (cand.artist && cand.title) labelText = `${cand.artist} - ${cand.title}`;
      else if (cand.artist || cand.title) labelText = `${cand.artist || ''}${cand.artist && cand.title ? ' - ' : ''}${cand.title || ''}`;
      else if (cand.path) labelText = cand.path;
      else labelText = `候補${idx + 1}`;
      if (cand.source) labelText += ` [${cand.source}]`;
      if (cand.has_synced) labelText += ' ⏱';
      btn.textContent = labelText;
      list.appendChild(btn);
    });
    if (ui.lyricsBtn) {
      ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
      void ui.lyricsBtn.offsetWidth;
      ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
    }
  }

  function refreshLockMenu() {
    if (!ui.uploadMenu) return;
    const lockSection = ui.uploadMenu.querySelector('.ytm-upload-menu-locks');
    const lockList = lockSection ? lockSection.querySelector('.ytm-upload-menu-lock-list') : null;
    const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
    if (!lockSection || !lockList || !addSyncBtn) return;
    lockList.innerHTML = '';
    const mergedRequests = [];
    if (Array.isArray(lyricsRequests)) {
      lyricsRequests.forEach(r => { if (r) mergedRequests.push({ ...r }); });
    }
    const ensureRequest = (id, label, target) => {
      const idLower = String(id).toLowerCase();
      if (mergedRequests.some(r => String(r.request || r.id || '').toLowerCase() === idLower)) return;
      mergedRequests.push({ request: id, label, target });
    };
    ensureRequest('lock_current_sync', '同期歌詞を確定 (Lock sync)', 'sync');
    ensureRequest('lock_current_dynamic', '動く歌詞を確定 (Lock dynamic)', 'dynamic');
    const activeReqs = mergedRequests.filter(r => {
      if (!r) return false;
      if (r.has_lyrics) return true;
      if (r.target === 'sync' || r.target === 'dynamic') return true;
      const key = String(r.request || r.id || '').toLowerCase();
      if (!key) return false;
      return key.startsWith('lock_current_');
    });
    if (!activeReqs.length) {
      lockSection.style.display = 'none';
    } else {
      lockSection.style.display = 'block';
      const syncLocked = !!(lyricsConfig && lyricsConfig.SyncLocked);
      const dynamicLocked = !!(lyricsConfig && lyricsConfig.dynmicLock);
      activeReqs.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'ytm-upload-menu-item';
        btn.dataset.action = 'lock-request';
        btn.dataset.requestId = r.request || r.id || '';
        btn.textContent = r.label || r.request || r.id || '歌詞を確定';
        const key = String(r.request || r.id || '').toLowerCase();
        const isSync = r.target === 'sync' || key.includes('sync');
        const isDynamic = r.target === 'dynamic' || key.includes('dynamic');
        const locked = r.locked || (isSync && syncLocked) || (isDynamic && dynamicLocked);
        if (locked) {
          btn.classList.add('ytm-upload-menu-item-disabled');
          btn.title = 'すでに確定された歌詞です';
        }
        lockList.appendChild(btn);
      });
    }
    const syncLocked = !!(lyricsConfig && lyricsConfig.SyncLocked);
    const dynamicLocked = !!(lyricsConfig && lyricsConfig.dynmicLock);
    const shouldDisableAddSync = syncLocked && dynamicLocked;
    addSyncBtn.classList.toggle('ytm-upload-menu-item-disabled', shouldDisableAddSync);
    if (shouldDisableAddSync) {
      addSyncBtn.dataset.disabledMessage = 'すでに確定された歌詞です';
      addSyncBtn.title = 'すでに確定された歌詞です';
    } else {
      delete addSyncBtn.dataset.disabledMessage;
      addSyncBtn.title = '';
    }
  }


  function setupUploadMenu(uploadBtn) {
    if (!ui.btnArea || ui.uploadMenu) return;
    ui.btnArea.style.position = 'relative';
    const menu = createEl('div', 'ytm-upload-menu', 'ytm-upload-menu');
    menu.innerHTML = `
      <div class="ytm-upload-menu-title">Lyrics</div>
      <button class="ytm-upload-menu-item" data-action="local">
        <span class="ytm-upload-menu-item-icon">💾</span>
        <span>ローカル歌詞読み込み / ReadLyrics</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="add-sync">
        <span class="ytm-upload-menu-item-icon">✨</span>
        <span>歌詞同期を追加 / AddTiming</span>
      </button>
      <div class="ytm-upload-menu-locks" style="display:none;">
        <div class="ytm-upload-menu-subtitle">歌詞を確定 / Confirm</div>
        <div class="ytm-upload-menu-lock-list"></div>
      </div>
      <div class="ytm-upload-menu-separator"></div>
      <button class="ytm-upload-menu-item" data-action="fix">
        <span class="ytm-upload-menu-item-icon">✏️</span>
        <span>歌詞の間違いを修正 / FixLyrics</span>
      </button>
      <div class="ytm-upload-menu-candidates" style="display:none;">
        <div class="ytm-upload-menu-subtitle">別の歌詞を選択</div>
        <div class="ytm-upload-menu-candidate-list"></div>
      </div>
    `;
    ui.btnArea.appendChild(menu);
    ui.uploadMenu = menu;
    const toggleMenu = (show) => {
      if (!ui.uploadMenu) return;
      const cl = ui.uploadMenu.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else cl.remove('visible');
    };
    uploadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleMenu();
    });
    ui.uploadMenu.addEventListener('click', (ev) => {
      const target = ev.target.closest('.ytm-upload-menu-item');
      if (!target) return;
      if (target.classList.contains('ytm-upload-menu-item-disabled')) {
        const msg = target.dataset.disabledMessage || 'この操作は現在利用できません';
        showToast(msg);
        return;
      }
      const action = target.dataset.action;
      const candId = target.dataset.candidateId || null;
      const reqId = target.dataset.requestId || null;
      toggleMenu(false);
      if (action === 'local') {
        ui.input?.click();
      } else if (action === 'add-sync') {
        const videoUrl = getCurrentVideoUrl();
        const base = 'https://lrchub.coreone.work';
        const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
        window.open(lrchubUrl, '_blank');
      } else if (action === 'fix') {
        const vid = getCurrentVideoId();
        if (!vid) {
          alert('動画IDが取得できませんでした。YouTube Music の再生画面で実行してください。');
          return;
        }
        const githubUrl = `https://github.com/LRCHub/${vid}/edit/main/README.md`;
        window.open(githubUrl, '_blank');
      } else if (action === 'candidate' && candId) {
        selectCandidateById(candId);
      } else if (action === 'lock-request' && reqId) {
        sendLockRequest(reqId);
      }
    });
    if (!uploadMenuGlobalSetup) {
      uploadMenuGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.uploadMenu) return;
        if (!ui.uploadMenu.classList.contains('visible')) return;
        if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
        ui.uploadMenu.classList.remove('visible');
      }, true);
    }
    refreshCandidateMenu();
    refreshLockMenu();
  }

  function setupDeleteDialog(trashBtn) {
    if (!ui.btnArea || ui.deleteDialog) return;
    ui.btnArea.style.position = 'relative';
    const dialog = createEl('div', 'ytm-delete-dialog', 'ytm-confirm-dialog', `
      <div class="ytm-confirm-title">歌詞を削除</div>
      <div class="ytm-confirm-message">
        この曲の保存済み歌詞を削除しますか？<br>
        <span style="font-size:11px;opacity:0.7;">ローカルキャッシュのみ削除されます。</span>
      </div>
      <div class="ytm-confirm-buttons">
        <button class="ytm-confirm-btn cancel">キャンセル</button>
        <button class="ytm-confirm-btn danger">削除</button>
      </div>
    `);
    ui.btnArea.appendChild(dialog);
    ui.deleteDialog = dialog;
    const toggleDialog = (show) => {
      if (!ui.deleteDialog) return;
      const cl = ui.deleteDialog.classList;
      if (show === undefined) cl.toggle('visible');
      else if (show) cl.add('visible');
      else cl.remove('visible');
    };
    trashBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDialog();
    });
    const cancelBtn = dialog.querySelector('.ytm-confirm-btn.cancel');
    const dangerBtn = dialog.querySelector('.ytm-confirm-btn.danger');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleDialog(false);
      });
    }
    if (dangerBtn) {
      dangerBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (currentKey) {
          storage.remove(currentKey);
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
        }
        toggleDialog(false);
      });
    }
    if (!deleteDialogGlobalSetup) {
      deleteDialogGlobalSetup = true;
      document.addEventListener('click', (ev) => {
        if (!ui.deleteDialog) return;
        if (!ui.deleteDialog.classList.contains('visible')) return;
        if (ui.deleteDialog.contains(ev.target) || trashBtn.contains(ev.target)) return;
        ui.deleteDialog.classList.remove('visible');
      }, true);
    }
  }

  function setupLangPills(groupId, currentValue, onChange) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const pills = Array.from(group.querySelectorAll('.ytm-lang-pill'));
    const apply = () => {
      pills.forEach(p => {
        p.classList.toggle('active', p.dataset.value === currentValue);
      });
    };
    apply();
    pills.forEach(p => {
      p.onclick = (e) => {
        e.stopPropagation();
        currentValue = p.dataset.value;
        apply();
        onChange(currentValue);
      };
    });
  }

  async function initSettings() {
    if (ui.settings) return;
    ui.settings = createEl('div', 'ytm-settings-panel', '', ``);
    document.body.appendChild(ui.settings);

    await loadRemoteTextsFromGithub();
    if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
    const cachedTrans = await storage.get('ytm_trans_enabled');
    if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;
    // 高速モード設定の読み込み
    const cachedFast = await storage.get('ytm_fast_mode');
    if (cachedFast !== null && cachedFast !== undefined) config.fastMode = cachedFast;

    const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
    if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;

    const mainLangStored = await storage.get('ytm_main_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    const subLangStored = await storage.get('ytm_sub_lang');
    if (subLangStored !== null) config.subLang = subLangStored;
    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const offsetStored = await storage.get('ytm_sync_offset');
    if (offsetStored !== null) config.syncOffset = offsetStored;
    const saveOffsetStored = await storage.get('ytm_save_sync_offset');
    if (saveOffsetStored !== null) config.saveSyncOffset = saveOffsetStored;

    // ★スライダー初期値反映
    const weightStored = await storage.get('ytm_lyric_weight');
    if (weightStored) config.lyricWeight = weightStored;
    const brightStored = await storage.get('ytm_bg_brightness');
    if (brightStored) config.bgBrightness = brightStored;

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
  }


    // ===== 共有翻訳: 残り文字数表示 =====
  const COMMUNITY_REMAINING_TTL_MS = 60 * 1000; // 60s
  let communityRemainingCache = { ts: 0, data: null, error: null };
  let communityRemainingTimer = null;

  // Fast Mode のときに共有翻訳を強制OFFにするための一時退避
  let sharedTransBeforeFast = null;

  function ensureCommunityRemainingTimer() {
    if (communityRemainingTimer) return;
    communityRemainingTimer = setInterval(() => {
      try {
        // 設定パネルが開いているときだけ更新（無駄な通信を減らす）
        if (ui.settings && ui.settings.classList.contains('active')) {
          updateCommunityRemainingUI(false);
        }
      } catch (_) { }
    }, 60 * 1000);
  }

  async function getCommunityRemaining(force = false) {
    const now = Date.now();
    if (!force && communityRemainingCache.data && (now - communityRemainingCache.ts) < COMMUNITY_REMAINING_TTL_MS) {
      return communityRemainingCache.data;
    }

    if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
      throw new Error('extension runtime is not available');
    }

    const resp = await new Promise((resolve) => {
      try {
        EXT.runtime.sendMessage({ type: 'GET_COMMUNITY_REMAINING' }, (r) => resolve(r));
      } catch (e) {
        resolve(null);
      }
    });

    if (!resp || !resp.ok) {
      const msg = resp && resp.error ? resp.error : 'failed';
      communityRemainingCache = { ts: now, data: null, error: msg };
      throw new Error(msg);
    }

    const data = resp.data || resp.remaining || resp;
    communityRemainingCache = { ts: now, data, error: null };
    return data;
  }

  async function updateCommunityRemainingUI(force = false) {
    const valEl = document.getElementById('community-remaining-val');
        if (!valEl) return;

    // 初回だけ「取得中…」
    if (!valEl.textContent || valEl.textContent === '--') {
      valEl.textContent = '取得中…';
    }

    try {
      const data = await getCommunityRemaining(force);

      const remaining =
        (data && (data.total_remaining ?? data.totalRemaining ?? data.total_remaining_total ?? data.total ?? data.free_remaining_total)) ?? null;

      if (remaining != null && !Number.isNaN(Number(remaining))) {
        valEl.textContent = Number(remaining).toLocaleString();
      } else {
        valEl.textContent = '--';
      }

      // 生データは hover で見れるように
      try {
        valEl.title = JSON.stringify(data, null, 2);
      } catch (_) { }
    } catch (e) {
      valEl.textContent = '--';
      valEl.title = e && e.message ? e.message : String(e);
    }
  }

  function updateSharedTransAvailability() {
    const fastToggle = document.getElementById('fast-mode-toggle');
    const sharedToggle = document.getElementById('shared-trans-toggle');
    const row = document.getElementById('shared-trans-row');
    const note = document.getElementById('shared-trans-note');
    if (!fastToggle || !sharedToggle) return;

    const fastMode = !!fastToggle.checked;

    // note テキスト（翻訳キーが無い場合は日本語フォールバック）
    const disabledText = (typeof t === 'function' ? t('settings_shared_trans_disabled_fast') : '') ||
      "高速読み込みモードが有効な場合、API共有翻訳は使用できません。\\n高速読み込みモードでは翻訳結果の共有が行われないため、API使用量を節約する目的で無効化しています。ご了承ください。";

    if (fastMode) {
      if (sharedTransBeforeFast === null) sharedTransBeforeFast = !!sharedToggle.checked;

      sharedToggle.checked = false;
      sharedToggle.disabled = true;

      if (row) row.style.opacity = '0.55';
      if (note) {
        note.style.display = 'block';
        note.textContent = disabledText;
      }

      // 強制OFFを config / storage に反映
      config.useSharedTranslateApi = false;
      storage.set('ytm_shared_trans_enabled', false);
    } else {
      sharedToggle.disabled = false;
      if (row) row.style.opacity = '1';
      if (note) {
        note.style.display = 'none';
        note.textContent = '';
      }

      // 直前に Fast Mode で潰した分を復元（必要なら）
      if (sharedTransBeforeFast !== null) {
        sharedToggle.checked = !!sharedTransBeforeFast;
        config.useSharedTranslateApi = !!sharedTransBeforeFast;
        storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi);
        sharedTransBeforeFast = null;
      }
    }
  }

function renderSettingsPanel() {
    if (!ui.settings) return;

    // 現在の曲IDがあるか確認（キャッシュ削除ボタンの制御用）
    const hasCurrentSong = !!currentKey;

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

    // 値の反映
    document.getElementById('deepl-key-input').value = config.deepLKey || '';
    document.getElementById('trans-toggle').checked = config.useTrans;
    document.getElementById('fast-mode-toggle').checked = !!config.fastMode;
    document.getElementById('shared-trans-toggle').checked = !!config.useSharedTranslateApi;
    // Fast Mode のときは共有翻訳を強制OFF（トグルは表示したまま無効化）
    const fastToggleEl = document.getElementById('fast-mode-toggle');
    if (fastToggleEl) {
      fastToggleEl.addEventListener('change', () => {
        updateSharedTransAvailability();
      });
    }
    updateSharedTransAvailability();

    // 共有翻訳の残り文字数（保存済み値を表示）
    updateCommunityRemainingUI(true);
    ensureCommunityRemainingTimer();
    document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
    document.getElementById('sync-offset-save-toggle').checked = config.saveSyncOffset;

    // スライダーイベント設定
    const wSlider = document.getElementById('weight-slider');
    const bSlider = document.getElementById('bright-slider');
    if (wSlider) {
      wSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.getElementById('weight-val').textContent = val;
        config.lyricWeight = val;
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

    // 言語ピル設定
    setupLangPills('main-lang-group', config.mainLang, v => { config.mainLang = v; });
    setupLangPills('sub-lang-group', config.subLang, v => { config.subLang = v; });
    refreshUiLangGroup();

    // 閉じるボタン
    const closeBtn = document.getElementById('ytm-settings-close-btn');
    if (closeBtn) {
      closeBtn.onclick = (ev) => {
        ev.stopPropagation();
        ui.settings.classList.remove('active');
      };
    }

    // 保存ボタンの処理
    document.getElementById('save-settings-btn').onclick = async () => {
      const savedMainLang = await storage.get('ytm_main_lang');
      const savedSubLang = await storage.get('ytm_sub_lang');
      const savedUseTrans = await storage.get('ytm_trans_enabled');
      const savedSharedTrans = await storage.get('ytm_shared_trans_enabled');
      const savedUiLang = await storage.get('ytm_ui_lang');

      const prevMainLang = savedMainLang || 'original';
      const prevSubLang = savedSubLang !== null ? savedSubLang : 'en';
      const prevUseTrans = savedUseTrans !== null ? savedUseTrans : true;
      const prevUseSharedTrans = savedSharedTrans !== null ? savedSharedTrans : false;
      const prevUiLang = savedUiLang || (config.uiLang || 'ja');

      // 画面から値を取得
      config.deepLKey = document.getElementById('deepl-key-input').value.trim();
      config.useTrans = document.getElementById('trans-toggle').checked;
      config.useSharedTranslateApi = document.getElementById('shared-trans-toggle').checked;
      config.fastMode = document.getElementById('fast-mode-toggle').checked;
      config.lyricWeight = document.getElementById('weight-slider').value;
      config.bgBrightness = document.getElementById('bright-slider').value;
      
      const offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
      config.syncOffset = isNaN(offsetVal) ? 0 : offsetVal;
      config.saveSyncOffset = document.getElementById('sync-offset-save-toggle').checked;

      // ストレージに保存
      storage.set('ytm_deepl_key', config.deepLKey);
      storage.set('ytm_trans_enabled', config.useTrans);
      storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi);
      storage.set('ytm_fast_mode', config.fastMode);
      storage.set('ytm_main_lang', config.mainLang);
      storage.set('ytm_sub_lang', config.subLang);
      storage.set('ytm_ui_lang', config.uiLang);
      storage.set('ytm_lyric_weight', config.lyricWeight);
      storage.set('ytm_bg_brightness', config.bgBrightness);
      storage.set('ytm_sync_offset', config.syncOffset);
      storage.set('ytm_save_sync_offset', config.saveSyncOffset);

      const needReload = (
        prevMainLang !== config.mainLang ||
        prevSubLang !== config.subLang ||
        prevUseTrans !== config.useTrans ||
        prevUseSharedTrans !== config.useSharedTranslateApi ||
        prevUiLang !== config.uiLang
      );

      if (needReload) {
        alert(t('settings_saved'));
        location.reload();
      } else {
        showToast(t('settings_saved'));
        ui.settings.classList.remove('active');
      }
    };

    // リセットボタン
    document.getElementById('clear-all-btn').onclick = storage.clear;

    // キャッシュ削除ボタンの処理
    const delBtn = document.getElementById('delete-current-cache-btn');
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!currentKey) return;
        if (confirm('現在の曲の歌詞キャッシュを削除しますか？\n（歌詞データ、同期情報などがリセットされます）')) {
          await storage.remove(currentKey);
          
          lyricsData = [];
          dynamicLines = null;
          duetSubDynamicLines = null;
          _duetExcludedTimes = new Set();
          lyricsCandidates = null;
          selectedCandidateId = null;
          lyricsRequests = null;
          lyricsConfig = null;
          
          renderLyrics([]);
          refreshCandidateMenu();
          refreshLockMenu();
          
          showToast('歌詞キャッシュを削除しました');
        }
      };
    }
  }

  function createReplayPanel() {
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

    const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
    pills.forEach(p => {
      p.onclick = (e) => {
        pills.forEach(x => x.classList.remove('active'));
        e.target.classList.add('active');
        ui.replayPanel.dataset.range = e.target.dataset.range;
        ReplayManager.renderUI();
      };
    });

    document.getElementById('replay-reset-action').onclick = async () => {
      if (confirm(t('replay_reset_confirm'))) {
        await storage.remove(ReplayManager.HISTORY_KEY);
        ReplayManager.renderUI();
      }
    };
  }

  function initLayout() {
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

    //  PiPボタン
    const pipBtnConfig = {
      txt: 'PIP',
      cls: 'icon-btn',
      click: () => PipManager.toggle()
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

    // ボタン配列に追加
    btns.push(lyricsBtnConfig, shareBtnConfig, pipBtnConfig, replayBtnConfig,  settingsBtnConfig);

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
    if(isYTMPremiumUser()) setupMovieMode(); //moviemode setup
  }

  async function loadLyrics(meta) {
    if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
    const cachedTrans = await storage.get('ytm_trans_enabled');
    if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

    const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
    if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;
    const mainLangStored = await storage.get('ytm_main_lang');
    const subLangStored = await storage.get('ytm_sub_lang');
    if (mainLangStored) config.mainLang = mainLangStored;
    if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
    const uiLangStored = await storage.get('ytm_ui_lang');
    if (uiLangStored) config.uiLang = uiLangStored;

    const thisKey = `${meta.title}///${meta.artist}`;
    if (thisKey !== currentKey) return;
    let cached = await storage.get(thisKey);
    isFallbackLyrics = false;
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    duetSubLyricsRaw = '';
    lyricsCandidates = null;
    selectedCandidateId = null;
    lyricsRequests = null;
    lyricsConfig = null;
    let data = null;
    let noLyricsCached = false;
    if (cached !== null && cached !== undefined) {
      if (cached === NO_LYRICS_SENTINEL) {
        noLyricsCached = true;
      } else if (typeof cached === 'string') {
        data = cached;
      } else if (typeof cached === 'object') {
        if (typeof cached.lyrics === 'string') data = cached.lyrics;
        if (Array.isArray(cached.dynamicLines)) dynamicLines = cached.dynamicLines;
        if (typeof cached.subLyrics === 'string') duetSubLyricsRaw = cached.subLyrics;
        if (cached.noLyrics) noLyricsCached = true;
        if (cached.githubFallback) isFallbackLyrics = true;
        if (Array.isArray(cached.candidates)) lyricsCandidates = cached.candidates;
        if (Array.isArray(cached.requests)) lyricsRequests = cached.requests;
        if (cached.config) lyricsConfig = cached.config;
      }
    }
    refreshCandidateMenu();
    refreshLockMenu();
    if (!data && noLyricsCached) {
      if (thisKey !== currentKey) return;
      renderLyrics([]);
      return;
    }
    if (!data && !noLyricsCached) {
      let gotLyrics = false;

      if (config.fastMode) {
        console.log('🚀 Fast Mode: Fetching from GitHub for', meta.title);

        const video_id_fast = getCurrentVideoId();
        if (video_id_fast) {
          const GH_BASE = `https://raw.githubusercontent.com/LRCHub/${video_id_fast}/main`;


                  const __cacheBusterFast = (1000 + Math.floor(Math.random() * 9000));


// --- GitHub raw のブラウザキャッシュ対策: 毎回URLを変えて最新を取りに行く ---
const withRandomCacheBusterFast = (url) => {
  const v = String(__cacheBusterFast);
  try {
    const u = new URL(url);
    u.searchParams.set('v', v);
    return u.toString();
  } catch (e) {
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + 'v=' + v;
  }
};

          const safeFetchText = async (url) => {
            try {
              const r = await fetch(withRandomCacheBusterFast(url), { cache: 'no-store' });
              if (!r.ok) return '';
              return (await r.text()) || '';
            } catch (e) {
              return '';
            }
          };

          // duet: try to fetch sub.txt (optional)
          const subTextFast = await safeFetchText(`${GH_BASE}/sub.txt`);
          if (subTextFast && subTextFast.trim()) duetSubLyricsRaw = subTextFast;

          const safeFetchJson = async (url) => {
            try {
              const r = await fetch(withRandomCacheBusterFast(url), { cache: 'no-store' });
              if (!r.ok) return null;
              return await r.json();
            } catch (e) {
              return null;
            }
          };

          const extractLyricsFromReadme = (text) => {
            if (!text) return '';
            // README に ``` が入っている場合は、最初のコードブロックだけを優先
            const m = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
            let body = m ? m[1] : text;

            return body
              .split('\n')
              .filter(line => !line.trim().startsWith('#'))
              .filter(line => !line.trim().startsWith('>'))
              .filter(line => !line.trim().startsWith('```'))
              .filter(line => !line.includes('歌詞登録ステータス'))
              .join('\n')
              .trim();
          };

          const normalizeDynamicLines = (json) => {
            if (!json) return null;
            if (Array.isArray(json.lines)) return json.lines;
            if (json.dynamic_lyrics && Array.isArray(json.dynamic_lyrics.lines)) return json.dynamic_lyrics.lines;
            if (json.response && json.response.dynamic_lyrics && Array.isArray(json.response.dynamic_lyrics.lines)) return json.response.dynamic_lyrics.lines;
            return null;
          };

          const formatLrcTimeLocal = (sec) => {
            sec = Math.max(0, Number(sec) || 0);
            const m = Math.floor(sec / 60);
            const s = sec - (m * 60);
            const ss = Math.floor(s);
            const xx = Math.floor((s - ss) * 100);
            return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xx).padStart(2, '0')}`;
          };

          const buildLrcFromDynamic = (lines) => {
            if (!Array.isArray(lines) || !lines.length) return '';
            const out = [];
            for (const line of lines) {
              let ms = null;

              if (typeof line.startTimeMs === 'number') {
                ms = line.startTimeMs;
              } else if (typeof line.startTimeMs === 'string') {
                const n = Number(line.startTimeMs);
                if (!Number.isNaN(n)) ms = n;
              } else if (Array.isArray(line.chars) && line.chars.length) {
                const ts = line.chars
                  .map(c => (typeof c.t === 'number' ? c.t : null))
                  .filter(v => v != null);
                if (ts.length) ms = Math.min(...ts);
              }

              if (ms == null) continue;

              let textLine = '';
              if (typeof line.text === 'string' && line.text.length) {
                textLine = line.text;
              } else if (Array.isArray(line.chars)) {
                textLine = line.chars.map(c => c.c || c.text || c.caption || '').join('');
              }

              // Keep original spaces (do not auto-trim)
              textLine = String(textLine ?? '');
              const tag = `[${formatLrcTimeLocal(ms / 1000)}]`;
              out.push(textLine ? `${tag} ${textLine}` : tag);
            }
            return out.join('\n').trimEnd();
          };

          try {
            // 1) Dynamic.lrc を最優先（1文字タイムタグ）
            const parseLrcTimeToMsLocal = (ts) => {
              const s = String(ts || '').trim();
              const mm = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
              if (!mm) return null;
              const m = parseInt(mm[1], 10);
              const sec = parseInt(mm[2], 10);
              let frac = mm[3] || '0';
              if (frac.length === 1) frac = frac + '00';
              else if (frac.length === 2) frac = frac + '0';
              const ms = parseInt(frac.slice(0, 3), 10);
              if (!Number.isFinite(m) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
              return (m * 60 + sec) * 1000 + ms;
            };

            const parseDynamicLrcLocal = (text) => {
              const out = [];
              if (!text) return out;

              const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

              // 1st pass: parse lines so we can use the next line timestamp as an end bound
              const parsed = [];
              for (const raw of rows) {
                const line = raw.trimEnd();
                if (!line) continue;

                const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
                if (!m) continue;

                parsed.push({
                  lineMs: parseLrcTimeToMsLocal(m[1]),
                  rest: m[2] || '',
                });
              }

              const pushDistributed = (chars, chunk, startMs, endMs) => {
                if (!chunk) return;
                const arr = Array.from(chunk);
                const n = arr.length;
                if (!n) return;

                const s = (typeof startMs === 'number') ? startMs : null;
                const e = (typeof endMs === 'number') ? endMs : null;

                if (s == null) {
                  for (const ch of arr) chars.push({ t: 0, c: ch });
                  return;
                }

                // no duration: show immediately at s
                if (e == null || e <= s) {
                  for (const ch of arr) chars.push({ t: s, c: ch });
                  return;
                }

                const dur = Math.max(1, e - s);
                const step = dur / n;

                for (let i = 0; i < n; i++) {
                  const t = s + Math.floor(step * i);
                  chars.push({ t, c: arr[i] });
                }
              };

              for (let li = 0; li < parsed.length; li++) {
                const { lineMs, rest } = parsed[li];
                const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
                  ? parsed[li + 1].lineMs
                  : null;

                const chars = [];
                const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;

                let prevMs = null;
                let prevEnd = 0;

                while (true) {
                  const mm = tagRe.exec(rest);
                  if (!mm) break;

                  const tagMs = parseLrcTimeToMsLocal(mm[1]);

                  // chunk before the 1st tag (often a leading space)
                  if (prevMs == null && tagMs != null && mm.index > prevEnd) {
                    const chunk0 = rest.slice(prevEnd, mm.index);
                    pushDistributed(chars, chunk0, tagMs, tagMs);
                  }

                  if (prevMs != null) {
                    const chunk = rest.slice(prevEnd, mm.index);
                    pushDistributed(chars, chunk, prevMs, tagMs);
                  }

                  prevMs = tagMs;
                  prevEnd = mm.index + mm[0].length;
                }

                if (prevMs != null) {
                  const chunk = rest.slice(prevEnd);

                  // For the tail, spread chars until the next line begins (or a fallback window)
                  let endMs = nextLineMs;
                  if (typeof endMs !== 'number') endMs = prevMs + 1500;
                  if (endMs <= prevMs) endMs = prevMs + 200;

                  pushDistributed(chars, chunk, prevMs, endMs);
                }

                const textLine = chars.map(c => c.c).join('');

                out.push({
                  startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
                  text: textLine,
                  chars,
                });
              }

              return out;
            };

            const dynText = await safeFetchText(`${GH_BASE}/Dynamic.lrc`);
            const dynLines = parseDynamicLrcLocal(dynText);

            if (dynLines && dynLines.length) {
              const built = buildLrcFromDynamic(dynLines);
              if (built) {
                dynamicLines = dynLines;
                await applyLyricsText(built);

                if (thisKey === currentKey) {
                  storage.set(thisKey, {
                    lyrics: built,
                    dynamicLines: dynLines,
                    noLyrics: false,
                    githubFallback: true,
                    subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : '')
                  });
                }
                return;
              }
            }

            // 2) README
            // (タイムスタンプ or プレーン) を取得
            const readme = await safeFetchText(`${GH_BASE}/README.md`);
            const lyricsText = extractLyricsFromReadme(readme);

            if (lyricsText) {
              await applyLyricsText(lyricsText);

              if (thisKey === currentKey) {
                storage.set(thisKey, {
                  lyrics: lyricsText,
                  dynamicLines: null,
                  noLyrics: false,
                  githubFallback: true,
                  subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : '')
                });
              }
              return;
            }
          } catch (e) {
            console.error('Fast mode GitHub error:', e);
          }
        }
      }

      try {
        const track = meta.title.replace(/\s*[\(-\[].*?[\)-]].*/, '');
        const artist = meta.artist;
        const youtube_url = getCurrentVideoUrl();
        const video_id = getCurrentVideoId();
        const res = await new Promise(resolve => {
          chrome.runtime.sendMessage(
            { type: 'GET_LYRICS', payload: { track, artist, youtube_url, video_id } },
            resolve
          );
        });
        console.log('[CS] GET_LYRICS response:', res);
        lyricsRequests = Array.isArray(res?.requests) ? res.requests : null;
        lyricsConfig = res?.config || null;
        lyricsCandidates = Array.isArray(res?.candidates) ? res.candidates : null;
        refreshCandidateMenu();
        refreshLockMenu();
        isFallbackLyrics = !!res?.githubFallback;
        if (typeof res?.subLyrics === 'string' && res.subLyrics.trim()) duetSubLyricsRaw = res.subLyrics;

        if (res?.success && typeof res.lyrics === 'string' && res.lyrics.trim()) {
          data = res.lyrics;
          gotLyrics = true;
          if (Array.isArray(res.dynamicLines) && res.dynamicLines.length) dynamicLines = res.dynamicLines;
          if (thisKey === currentKey) {
            storage.set(thisKey, {
              lyrics: data,
              dynamicLines: dynamicLines || null,
              noLyrics: false,
              githubFallback: isFallbackLyrics,
              subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : ''),
              candidates: lyricsCandidates || null,
              requests: lyricsRequests || null,
              config: lyricsConfig || null
            });
          }
        } else {
          //console.warn('Lyrics API returned no lyrics or success=false');
        }
      } catch (e) {
        console.error('GET_LYRICS failed', e);
      }
      if (!gotLyrics && thisKey === currentKey) {
        storage.set(thisKey, NO_LYRICS_SENTINEL);
        noLyricsCached = true;
      }
    }
    if (thisKey !== currentKey) return;
    if (!data) {
      renderLyrics([]);
      refreshCandidateMenu();
      refreshLockMenu();
      return;
    }
    await applyLyricsText(data);
  }



function renderLyrics(data) {
    if (!ui.lyrics) return;
    ui.lyrics.innerHTML = '';
    ui.lyrics.scrollTop = 0;
    const hasData = Array.isArray(data) && data.length > 0;
    document.body.classList.toggle('ytm-no-lyrics', !hasData);
    document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
    document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

    const fragment = document.createDocumentFragment();

    data.forEach((line, index) => {
      const row = createEl('div', '', 'lyric-line');

      if (line && line.duetSide === 'right') {
        row.classList.add('sub-vocal');
      } else if (line && line.duetSide === 'left') {
        row.classList.add('main-vocal');
      }

      if (typeof line.time === 'number') {
        row.dataset.startTime = String(line.time);
      }

      const mainSpan = createEl('span', '', 'lyric-main');

      // dynamic lyrics highlighting
      let dyn = null;
      
      // サブボーカル(right)にはduetSubDynamicLinesを使用、メインにはdynamicLinesを使用
      if (line && line.duetSide === 'right') {
        // サブボーカル用のdynamic lines
        if (duetSubDynamicLines && Array.isArray(duetSubDynamicLines) && duetSubDynamicLines.length) {
          if (typeof line.time === 'number') {
             dyn = getSubDynamicLineForTime(line.time);
          }
        }
      } else {
        // メインボーカル用のdynamic lines
        if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
          if (typeof line.time === 'number') {
             // 時間で検索
             dyn = getDynamicLineForTime(line.time);
          } else {
             // デュエットモード以外のみインデックスフォールバックを使用
             const isDuetMode = document.body.classList.contains('ytm-duet-mode');
             if (!isDuetMode) {
                dyn = dynamicLines[index];
             }
          }
        }
      }
      
      if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
        dyn.chars.forEach((ch, ci) => {
          const chSpan = createEl('span', '', 'lyric-char');
          // Preserve spaces
          const cc = (ch.c === '\t') ? ' ' : ch.c;
          chSpan.textContent = (cc === ' ') ? '\u00A0' : cc;
          chSpan.dataset.charIndex = String(ci);
          if (typeof ch.t === 'number') {
            chSpan.dataset.time = String(ch.t / 1000);
          }
          chSpan.classList.add('char-pending');
          mainSpan.appendChild(chSpan);
        });
      } else {
        mainSpan.textContent = line ? line.text : '';
      }
      row.appendChild(mainSpan);
      
      if (line && line.translation) {
        const subSpan = createEl('span', '', 'lyric-translation', line.translation);
        row.appendChild(subSpan);
        row.classList.add('has-translation');
      }

      row.onclick = () => {
        if (shareMode) {
          handleShareLineClick(index);
          return;
        }
        if (!hasTimestamp || !line || line.time == null) return;
        const v = document.querySelector('video');
        if (v) v.currentTime = line.time + timeOffset;
      };
      fragment.appendChild(row);
    });

    ui.lyrics.appendChild(fragment);

    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
      if (PipManager.pipWindow.document) {
        PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      }
    }

    updateShareSelectionHighlight();
  }

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !currentKey) return;
    const r = new FileReader();
    r.onload = (ev) => {
      storage.set(currentKey, ev.target.result);
      currentKey = null;
    };
    r.readAsText(file);
    e.target.value = '';
  };


  function startLyricRafLoop() {
    if (lyricRafId) cancelAnimationFrame(lyricRafId);

    const loop = () => {
      const v = document.querySelector('video');

      if (v) {

        if (PipManager.pipWindow) {
          PipManager.updatePlayState(v.paused);
        }

        if (v.readyState > 0 && !v.paused && !v.ended) {
          let t = v.currentTime;
          const duration = v.duration || 1;

          if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
          t = Math.max(0, t - timeOffset);
          t = Math.min(Math.max(0, t + (config.syncOffset / 1000)), v.duration);
          if (lyricsData.length && hasTimestamp) {
            updateLyricHighlight(t);
          }


          if (PipManager.pipWindow && PipManager.progressRing) {
            const radius = 32;
            const circumference = radius * 2 * Math.PI;
            const progress = t / duration;
            const offset = circumference - (progress * circumference);
            PipManager.progressRing.style.strokeDashoffset = offset;
          }
        }
      }

      if (PipManager.pipWindow) {
        lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
      } else {
        lyricRafId = requestAnimationFrame(loop);
      }
    };

    lyricRafId = requestAnimationFrame(loop);
  }

  function updateLyricHighlight(currentTime) {
    if (!lyricsData.length) return;
    if (!hasTimestamp) return;

    const t = currentTime;

    let idx = -1;
    const startSearch = Math.max(0, lastActiveIndex);

    for (let i = startSearch; i < lyricsData.length; i++) {
      if (lyricsData[i].time > t) {
        idx = i - 1;
        break;
      }
      if (i === lyricsData.length - 1) idx = i;
    }
    // Discord presence: reflect the lyric at the current playback position (seek-safe)
    try {
      const metaNow = getMetadata();
      let lyricText = '';
      if (idx >= 0 && idx < lyricsData.length) {
        lyricText = (lyricsData[idx]?.text || '').trim();
      }
      // Fallback to DOM text (in case rendered text differs)
      if (!lyricText && ui.lyrics) {
        const rowsMain = ui.lyrics.querySelectorAll('.lyric-line');
        if (rowsMain && rowsMain.length && idx >= 0 && idx < rowsMain.length) {
          const row = rowsMain[idx];
          const mainEl = row.querySelector('.lyric-main') || row;
          lyricText = (mainEl && mainEl.textContent ? mainEl.textContent : '').trim();
        }
      }
      sendDiscordPresence(metaNow, lyricText);
    } catch (e) { }


    const targets = [];
    if (ui.lyrics) targets.push(ui.lyrics);
    if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
      targets.push(PipManager.pipLyricsContainer);
    }

    // When the next line comes within 1 second, also highlight the previous line together
    const prevIdx = (idx > 0 && idx < lyricsData.length &&
      typeof lyricsData[idx]?.time === 'number' &&
      typeof lyricsData[idx - 1]?.time === 'number' &&
      (lyricsData[idx].time - lyricsData[idx - 1].time) <= 1.0
    ) ? (idx - 1) : -1;

    targets.forEach(container => {
      const rows = container.querySelectorAll('.lyric-line');
      if (rows.length === 0) return;

      rows.forEach((r, i) => {
        const isActive = (i === idx) || (i === prevIdx);
        const isPrimary = (i === idx);

        if (isActive) {
          if (!r.classList.contains('active')) {
            r.classList.add('active');

            // Only the primary line should scroll / count replay
            if (isPrimary) {
              r.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // ★★★★★★★★★★★★★★★★★★★★★★★★★★★
              if (container === ui.lyrics) {
                ReplayManager.incrementLyricCount();
              }
            }
          }

          if (r.classList.contains('has-translation')) {
            r.classList.add('show-translation');
          }

          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              const tt = parseFloat(sp.dataset.time || '0');
              if (Number.isFinite(tt) && tt <= t) {
                sp.classList.add('char-active');
                sp.classList.remove('char-pending');
              } else {
                sp.classList.remove('char-active');
                sp.classList.add('char-pending');
              }
            });
          }
        } else {
          r.classList.remove('active');
          r.classList.remove('show-translation');

          const charSpans = r.querySelectorAll('.lyric-char');
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              sp.classList.remove('char-active');
              sp.classList.add('char-pending');
            });
          }
        }
      });
    });

    lastActiveIndex = idx;
  }

  // ===================== Share 機能 =====================

  function onShareButtonClick() {
    if (!lyricsData.length) {
      showToast('共有できる歌詞がありません');
      return;
    }
    shareMode = !shareMode;
    shareStartIndex = null;
    shareEndIndex = null;
    if (shareMode) {
      document.body.classList.add('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.add('share-active');
      showToast('共有したい歌詞の開始行と終了行をクリックしてください');
    } else {
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
    }
    updateShareSelectionHighlight();
  }

  function handleShareLineClick(index) {
    if (!shareMode) return;
    if (!lyricsData.length) return;
    if (shareStartIndex == null) {
      shareStartIndex = index;
      shareEndIndex = null;
      updateShareSelectionHighlight();
      return;
    }
    if (shareEndIndex == null) {
      shareEndIndex = index;
      updateShareSelectionHighlight();
      finalizeShareSelection();
      return;
    }
    shareStartIndex = index;
    shareEndIndex = null;
    updateShareSelectionHighlight();
  }

  function updateShareSelectionHighlight() {
    if (!ui.lyrics) return;
    const rows = ui.lyrics.querySelectorAll('.lyric-line');
    rows.forEach(r => {
      r.classList.remove('share-select');
      r.classList.remove('share-select-range');
      r.classList.remove('share-select-start');
      r.classList.remove('share-select-end');
    });
    if (!shareMode || shareStartIndex == null || !lyricsData.length) return;
    const max = lyricsData.length ? lyricsData.length - 1 : 0;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    for (let i = s; i <= e && i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      row.classList.add('share-select-range');
      if (i === s) row.classList.add('share-select-start');
      if (i === e) row.classList.add('share-select-end');
    }
  }

  function getShareSelectionInfo() {
    if (!lyricsData.length || shareStartIndex == null) return null;
    const max = lyricsData.length - 1;
    let s, e;
    if (shareEndIndex == null) {
      const idx = Math.max(0, Math.min(shareStartIndex, max));
      s = idx;
      e = idx;
    } else {
      const minIdx = Math.min(shareStartIndex, shareEndIndex);
      const maxIdx = Math.max(shareStartIndex, shareEndIndex);
      s = Math.max(0, Math.min(minIdx, max));
      e = Math.max(0, Math.min(maxIdx, max));
    }
    const parts = [];
    for (let i = s; i <= e; i++) {
      if (!lyricsData[i]) continue;
      let t = (lyricsData[i].text || '').trim();
      if (!t && lyricsData[i].translation) {
        t = String(lyricsData[i].translation).trim();
      }
      if (t) parts.push(t);
    }
    const phrase = parts.join('\n');
    let timeMs = 0;
    if (hasTimestamp && lyricsData[s] && typeof lyricsData[s].time === 'number') {
      timeMs = Math.round(lyricsData[s].time * 1000);
    } else {
      const v = document.querySelector('video');
      if (v && typeof v.currentTime === 'number') {
        timeMs = Math.round(v.currentTime * 1000);
      }
    }
    return { phrase, timeMs };
  }

  function normalizeToHttps(url) {
    if (!url) return url;
    try {
      const u = new URL(url, 'https://lrchub.coreone.work');
      u.protocol = 'https:';
      return u.toString();
    } catch (e) {
      if (url.startsWith('http://')) {
        return 'https://' + url.slice(7);
      }
      return url;
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve();
    }
  }

  async function finalizeShareSelection() {
    const info = getShareSelectionInfo();
    if (!info || !info.phrase) {
      showToast('選択された歌詞が空です');
      return;
    }
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const lang = (config.mainLang && config.mainLang !== 'original') ? config.mainLang : 'ja';
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SHARE_REGISTER', payload: { youtube_url, video_id, phrase: info.phrase, lang, time_ms: info.timeMs } },
          resolve
        );
      });
      if (!res || !res.success) {
        console.error('Share register failed:', res && res.error);
        showToast('共有に失敗しました');
        return;
      }
      let shareUrl = (res.data && res.data.share_url) || '';
      shareUrl = normalizeToHttps(shareUrl);
      if (!shareUrl && video_id) {
        const sec = Math.round((info.timeMs || 0) / 1000);
        shareUrl = `https://lrchub.coreone.work/s/${video_id}/${sec}`;
      }
      if (shareUrl) {
        await copyToClipboard(shareUrl);
        showToast('共有リンクをコピーしました');
      } else {
        showToast('共有リンクの取得に失敗しました');
      }
    } catch (e) {
      console.error('Share register error', e);
      showToast('共有に失敗しました');
    } finally {
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      updateShareSelectionHighlight();
    }
  }

  async function sendLockRequest(requestId) {
    const youtube_url = getCurrentVideoUrl();
    const video_id = getCurrentVideoId();
    const reqInfo = Array.isArray(lyricsRequests)
      ? lyricsRequests.find(r => r.id === requestId || r.request === requestId || (r.aliases || []).includes(requestId))
      : null;
    try {
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'SELECT_LYRICS_CANDIDATE', payload: { youtube_url, video_id, request: requestId } },
          resolve
        );
      });
      if (res?.success) {
        showToast('歌詞を確定しました');
        if (reqInfo) {
          reqInfo.locked = true;
          reqInfo.available = false;
          if (!lyricsConfig) lyricsConfig = {};
          if (reqInfo.target === 'sync') lyricsConfig.SyncLocked = true;
          else if (reqInfo.target === 'dynamic') lyricsConfig.dynmicLock = true;
        }
        refreshLockMenu();
      } else {
        const msg = res?.error || (res?.raw && (res.raw.message || res.raw.code)) || '歌詞の確定に失敗しました';
        showToast(msg);
      }
    } catch (e) {
      console.error('lock request error', e);
      showToast('歌詞の確定に失敗しました');
    }
  }



  function setupPlayerBarBlankClickGuard() {
    const bar = document.querySelector('ytmusic-player-bar');
    if (!bar || bar.dataset.ytmBlankClickGuard === '1') return;
    bar.dataset.ytmBlankClickGuard = '1';

    // 余白クリックがプレイヤーの開閉に繋がるのを防ぐ（ボタン/スライダー等は通常通り動かす）
    bar.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;

      // インタラクティブ要素は通す（閉じるボタンの逆三角もここに含まれる想定）
      if (
        t.closest('button, a, input, textarea, select, tp-yt-paper-icon-button, tp-yt-paper-button, tp-yt-paper-slider, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer')
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  const tick = async () => {
  if (document.querySelector('.ad-interrupting') || document.querySelector('.ad-showing')) return;

    let toggleBtn = document.getElementById('my-mode-toggle');


    if (!toggleBtn) {
      const rc = document.querySelector('.right-controls-buttons');
      if (rc) {
        toggleBtn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');


        if (config.mode) toggleBtn.classList.add('active');

        toggleBtn.onclick = () => {
          config.mode = !config.mode;
          document.body.classList.toggle('ytm-custom-layout', config.mode);
          if(isYTMPremiumUser()) changeIModeUIWithMovieMode(config.mode);

          toggleBtn.classList.toggle('active', config.mode);
        };
        rc.prepend(toggleBtn);
      }
    } else {

      const isActive = toggleBtn.classList.contains('active');
      if (config.mode && !isActive) toggleBtn.classList.add('active');
      else if (!config.mode && isActive) toggleBtn.classList.remove('active');
    }


    const layout = document.querySelector('ytmusic-app-layout');
    const isPlayerOpen = layout?.hasAttribute('player-page-open');
    if (!config.mode || !isPlayerOpen) {
      document.body.classList.remove('ytm-custom-layout');
      // Discord presence: clear when not in player-page
      clearDiscordPresence();
      return;
    }
    document.body.classList.add('ytm-custom-layout');
    initLayout();


    setupPlayerBarBlankClickGuard();
    (function patchSliders() {
      const sliders = document.querySelectorAll('ytmusic-player-bar .middle-controls tp-yt-paper-slider');
      sliders.forEach(s => {
        try {
          s.style.boxSizing = 'border-box';
          s.style.paddingLeft = '20px';
          s.style.paddingRight = '20px';
          s.style.minWidth = '0';
          s.style.cursor = 'pointer';
        } catch (e) { }
      });
    })();

    const meta = getMetadata();
    if (!meta) return;
    const key = `${meta.title}///${meta.artist}`;

    if (currentKey !== key) {
      // クラウド同期
      if (currentKey !== null && CloudSync && typeof CloudSync.syncNow === 'function') {
        CloudSync.syncNow();
      }

      const v = document.querySelector('video');
      const currentTime = v ? v.currentTime : 0;
      const duration = v ? v.duration : 0;


      if (currentTime < 5 || (duration > 0 && Math.abs(duration - currentTime) < 5)) {
        timeOffset = 0;
      } else {
        timeOffset = currentTime;
      }

      if (!config.saveSyncOffset) {
        if (isFirstSongDetected) {
          isFirstSongDetected = false;
        } else {
          const offsetInput = document.getElementById('sync-offset-input');
          if (offsetInput) {
            offsetInput.value = 0;
          }
          config.syncOffset = 0;
          storage.set('ytm_sync_offset', 0);
        }
      } else {
        isFirstSongDetected = false;
      }


      currentKey = key;
      lyricsData = [];
      dynamicLines = null;
      duetSubDynamicLines = null;
      _duetExcludedTimes = new Set();
      lyricsCandidates = null;
      selectedCandidateId = null;
      lyricsRequests = null;
      lyricsConfig = null;
      shareMode = false;
      shareStartIndex = null;
      shareEndIndex = null;
      document.body.classList.remove('ytm-share-select-mode');
      if (ui.shareBtn) ui.shareBtn.classList.remove('share-active');
      lastActiveIndex = -1;
      lastTimeForChars = -1;

      if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
        QueueManager.onSongChanged();
      }

      updateMetaUI(meta);

      // PIPウィンドウのメタデータ(タイトル・アーティスト・画像)を更新
      if (PipManager) {
        PipManager.updateMeta(meta.title, meta.artist);
      }

      // Discord presence: set line1 immediately (lyrics line2 will update during playback)
      sendDiscordPresence(meta, '');
      refreshCandidateMenu();
      refreshLockMenu();
      if (ui.lyrics) ui.lyrics.scrollTop = 0;
      loadLyrics(meta);
    }
  };

function updateMetaUI(meta) {
  ui.title.innerText = meta.title;
  ui.artist.innerText = meta.artist;

  if (meta.src) {
    ui.artwork.innerHTML = `<img src="${meta.src}" crossorigin="anonymous">`;
    ui.bg.style.backgroundImage = `url(${meta.src})`;
  }
  ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';

  // アーティストページのURLを取得
  let retryCount = 0;
  const maxRetries = 5;
  const trySetArtistLink = () => {
    const bylineWrapper = document.querySelector('ytmusic-player-bar yt-formatted-string.byline.complex-string');
    const artistLinkEl = bylineWrapper ? bylineWrapper.querySelector('a.yt-simple-endpoint') : null;

    if (artistLinkEl && artistLinkEl.href) {
      const channelUrl = artistLinkEl.href;
        ui.artist.innerHTML = `<a href="${channelUrl}" 
          style="color:inherit; text-decoration:none;"
          target="_blank">
          ${meta.artist}
        </a>`;
      return;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      setTimeout(trySetArtistLink, 300);
    } else { // URL失敗時
      ui.artist.innerText = meta.artist;
    }
  };

  trySetArtistLink();
}
  
  
  

  (async function applySavedVisualSettings() {
    // 1. 歌詞の太さ
    const savedWeight = await storage.get('ytm_lyric_weight');
    if (savedWeight) {
      config.lyricWeight = savedWeight;
      document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
    }

    // 2. 背景の明るさ
    const savedBright = await storage.get('ytm_bg_brightness');
    if (savedBright) {
      config.bgBrightness = savedBright;
      document.documentElement.style.setProperty('--ytm-bg-brightness', savedBright);
    }
  })();
  
  
  // ===================== 初期化 =====================

  ReplayManager.init();
  QueueManager.init();
  CloudSync.init();

  loadRemoteTextsFromGithub();

  console.log('YTM Immersion loaded.');


  const setupObserver = () => {

    const targetNode = document.querySelector('ytmusic-player-bar');


    if (!targetNode) {
      setTimeout(setupObserver, 500);
      return;
    }


    const observer = new MutationObserver(() => {

      tick();
    });


    observer.observe(targetNode, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('YTM Immersion: Zero-delay observer started.');

    tick();
  };


  setupObserver();



  startLyricRafLoop();
  hoverTimeInfoSetup();
})();
