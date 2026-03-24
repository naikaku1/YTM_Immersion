/* globals chrome, browser */
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

  window.chrome = window.chrome || EXT;


  const NO_LYRICS_SENTINEL = '__NO_LYRICS__';

  // ===================== CloudSync: Daily Replay クラウド同期 =====================
