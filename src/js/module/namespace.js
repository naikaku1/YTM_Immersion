
/* globals chrome, browser */

// ── デバッグログ ────────────────────────────────────────────
// 既定では何も出さない。曲を再生するたびに数十行流れると、利用者の
// コンソールが埋まり、本当のエラーが埋もれてしまうため。
// 調べたい時だけ、コンソールで次を実行してからページを再読み込みする:
//   localStorage.setItem('ytm_debug', '1')
// 元に戻すには localStorage.removeItem('ytm_debug')
// なお console.warn / console.error は常に出す(異常の通知は残す)。
const YTMLog = (() => {
  let enabled = false;
  try { enabled = localStorage.getItem('ytm_debug') === '1'; } catch (e) { /* 参照できなければ無効 */ }
  // background(Service Worker)には localStorage が無く、あちらは
  // chrome.storage.local の ytm_debug を見る。ここで写しておかないと、
  // 説明どおり localStorage を立てても background 側のログが一生出ない。
  // 反映は Service Worker の起動時なので、切り替えたら拡張を読み込み直す。
  try {
    const store = globalThis.chrome?.storage?.local;
    if (store) {
      store.get(['ytm_debug'], (res) => {
        const current = res && (res.ytm_debug === '1' || res.ytm_debug === true);
        if (current === enabled) return;
        if (enabled) store.set({ ytm_debug: '1' });
        else store.remove('ytm_debug');
      });
    }
  } catch (e) { /* 書けなければ content 側だけで有効 */ }
  const noop = () => { };
  return {
    enabled,
    log: enabled ? console.log.bind(console, '%c[YTM]', 'color:#8ab4f8') : noop,
    info: enabled ? console.info.bind(console, '%c[YTM]', 'color:#8ab4f8') : noop,
    debug: enabled ? console.debug.bind(console, '%c[YTM]', 'color:#8ab4f8') : noop,
  };
})();
// ── HTML エスケープ ────────────────────────────────────────
// 歌詞・曲名・アーティスト名・利用者が読み込んだ JSON は、そのまま
// innerHTML に入れてはいけない。歌詞に "<" があるだけでその行以降が
// 消えるし、任意のマークアップが入り込む。
// 各 module で別々に持っていたものをここに 1 つだけ置く。
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// ── セッション中のキャッシュを上限で抑える ──────────────────
// 上限に達したら全部消す、という抑え方だと、いま再生している曲のぶんまで
// 巻き添えで消える。直後に同じものを取り直すことになるので、古い順に
// 必要なぶんだけ落とす。isPinned に true を返したキーは残す。
const trimMapToLimit = (map, limit, isPinned) => {
  if (!(map instanceof Map) || !Number.isFinite(limit)) return 0;
  let removed = 0;
  for (const key of map.keys()) {
    if (map.size <= limit) break;
    if (typeof isPinned === 'function' && isPinned(key)) continue;
    map.delete(key);
    removed += 1;
  }
  return removed;
};

// ── 1 文字ぶんの妥当な長さ ──────────────────────────────────
// その行の文字が実際どれくらいの間隔で進んでいるかを見て決める。
// 行末の文字を「次の行まで」で引き伸ばさないための上限に使う。
// background 側(api.js の estimateCharDurationMs)と同じ規則。
// Service Worker と content script はスコープを共有できないので、
// 同じ値をここにも置く。片方を変えたら必ずもう片方も変えること。
const CHAR_DURATION_FALLBACK_MS = 300;
const CHAR_DURATION_MIN_MS = 120;
const CHAR_DURATION_MAX_MS = 900;

const estimateCharDurationMs = (chars) => {
  if (!Array.isArray(chars) || chars.length < 2) return CHAR_DURATION_FALLBACK_MS;
  const gaps = [];
  for (let i = 1; i < chars.length; i++) {
    const prev = chars[i - 1]?.t;
    const cur = chars[i]?.t;
    if (typeof prev === 'number' && typeof cur === 'number' && cur > prev) gaps.push(cur - prev);
  }
  if (!gaps.length) return CHAR_DURATION_FALLBACK_MS;
  gaps.sort((a, b) => a - b);
  // 中央値なので、行の中に伸ばした音が1つあっても引きずられない。
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.min(CHAR_DURATION_MAX_MS, Math.max(CHAR_DURATION_MIN_MS, median));
};

// ── byline(「アーティスト • アルバム • 年」)の切り分け ──────
// プレイヤーバーもキューも同じ形の文字列を出す。歌詞キャッシュのキーは
// 「曲名///アーティスト」なので、切り出し方が食い違うと同じ曲でも
// 別のキーになり、キューの先読みが本再生で一度も当たらなくなる。
const splitBylineParts = (text) => String(text || '')
  .split('•')
  .map(s => (s || '').trim())
  .filter(Boolean);

const parseBylineArtist = (text) => splitBylineParts(text)[0] || '';

// ── 歌詞検索に投げる曲名の正規化 ────────────────────────────
// YTM の曲名には "(feat. X)" "[MV]" " - Remix" のような付属物が付く。
// そのまま LRCHub / LrcLib / LyricsPlus に投げると検索が当たらない。
//
// 以前は /\s*[\(-\[].*?[\)-]].*/ を使っていたが、末尾の [\)-]] が
// 「) または - の直後にリテラルの ]」を要求するため、普通の曲名には
// 一度も当たっていなかった(= 正規化が効いていなかった)。
//
// 全角の（）【】も落とす。日本語の曲名で普通に使われるため。
// 全部削って空になる曲名("(Interlude)" など)は、元の曲名をそのまま返す。
//
// ライブ映像や MV は「アーティスト – 曲名 (Live …)」の形が多い。ハイフン
// 以降を落とすと曲名の方が消え、アーティスト名だけで検索することになる。
// 実機: 「星野源 – Family Song (Live at Saitama Super Arena 2017)」が
// 「星野源」になり、LRCHub の検索で星野源さんが参加した別の曲
// (Superorganism「Into The Sun」)の歌詞が出ていた。
// ハイフンの前がアーティスト名(artist)と同じなら、後ろを曲名とみなす。
const normalizeSearchTrackTitle = (s, artist = '') => {
  const raw = String(s || '').trim();
  const nameKey = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[\s・.,、'’"“”]/g, '');
  const artistKey = nameKey(artist);
  const parts = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const headKey = parts ? nameKey(parts[1]) : '';
  const headIsArtist = !!(artistKey && headKey.length >= 2 &&
    (headKey === artistKey || artistKey.includes(headKey) || headKey.includes(artistKey)));
  const title = headIsArtist ? parts[2] : raw;
  const stripped = title
    .replace(/\s*[\(\[（【][^\)\]）】]*[\)\]）】]\s*/g, ' ')
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || raw;
};

  const EXT =
    typeof globalThis.chrome !== 'undefined'
      ? globalThis.chrome
      : (typeof globalThis.browser !== 'undefined' ? globalThis.browser : null);

  // カスタムハンドル（丸ポチ）を作成してoverflow:hiddenから逃がす
  (function createCustomProgressHandle() {
    const waitForPlayerBar = () => {
      const playerBar = document.querySelector('ytmusic-player-bar');
      const progressBar = document.querySelector('tp-yt-paper-slider#progress-bar');
      // 新しいバー(ytmusic-miniplayer)のシークバーは普通の input で、切れる丸ポチが無い。
      // 旧バーは現れないので、待ち続けずにやめる。
      if (!playerBar && document.querySelector('ytmusic-miniplayer')) return;
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
        startHandleLoop();
      });

      progressBar.addEventListener('mouseleave', () => {
        isHovering = false;
      });

      // ドラッグ（位置変更）検出
      progressBar.addEventListener('mousedown', () => {
        positionChanged = true;
        isDragging = true;
        startHandleLoop();
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
      let _handleRafId = null;
      // 直前に書き込んだスタイル値。値が変わっていないフレームでスタイルを
      // 書き直すと無駄なスタイル再計算が毎フレーム走るため、差分がある時だけ書く。
      // （このループは一度シークすると「バー外をクリックするまで」回り続けるので、
      //   アイドル時のコストをゼロに近づけておく必要がある）
      let _lastHandleStyle = '';
      const updateHandlePosition = () => {
        _handleRafId = null;

        if (!document.body.classList.contains('ytm-custom-layout')) {
          if (_lastHandleStyle !== 'hidden') {
            customHandle.style.opacity = '0';
            _lastHandleStyle = 'hidden';
          }
          return;
        }

        // 表示条件をチェック
        if (!shouldShowHandle()) {
          if (_lastHandleStyle !== 'hidden') {
            customHandle.style.opacity = '0';
            _lastHandleStyle = 'hidden';
          }
          return;
        }

        // ネイティブのsliderKnobを取得
        const sliderKnob = progressBar.querySelector('#sliderKnob');
        if (!sliderKnob) {
          return;
        }

        // sliderKnobのrectを取得（ドラッグ中もリアルタイムで更新される）
        const knobRect = sliderKnob.getBoundingClientRect();
        const barRect = progressBar.getBoundingClientRect();

        // knobの中心位置を計算（完全追従）
        const handleX = knobRect.left + knobRect.width / 2;
        const handleY = barRect.top + barRect.height / 2;
        const size = isDragging ? '16px' : '12px';

        const nextStyle = `${handleX}|${handleY}|${size}`;
        if (nextStyle !== _lastHandleStyle) {
          _lastHandleStyle = nextStyle;
          // ハンドルを表示して位置を更新
          customHandle.style.opacity = '1';
          customHandle.style.left = handleX + 'px';
          customHandle.style.top = handleY + 'px';
          // ドラッグ中は大きく、そうでなければ通常サイズ
          customHandle.style.width = size;
          customHandle.style.height = size;
        }

        // 表示中のみ次フレームをスケジュール
        if (shouldShowHandle()) {
          _handleRafId = requestAnimationFrame(updateHandlePosition);
        }
      };

      // 必要な時だけRAFループを開始するヘルパー
      const startHandleLoop = () => {
        if (!_handleRafId) {
          _handleRafId = requestAnimationFrame(updateHandlePosition);
        }
      };

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
    // 翻訳は既定オフ。使いたい人が設定パネルから明示的に有効化する。
    useTrans: false,
    mode: true,
    mainLang: 'original',
    subLang: 'en',
    uiLang: 'ja',
    syncOffset: 0,
    saveSyncOffset: false,
    useSharedTranslateApi: false,
    leftAlignInfo: false,
    // 再生済み歌詞の旧設定との互換用。fadePastLyrics の逆を保つ。
    keepPastLyrics: true,
    lyricStagger: true,
    fadePastLyrics: false,
    // 曲が変わったときに YTM の「動画」を「曲」に切り替えるか。
    // 既定 ON = 従来どおり。OFF にすると動画モードのまま聴ける。
    preferSongMode: true,
    appleBg: true,
    useAnimatedCaptions: false,
    // Apple Music 風の文字同期(グラデーションで塗る + 光が尾を引く)。
    // 既定 ON。従来の二値表示に戻したい人は設定から切る。
    appleSyncStyle: true,
    useSingerColors: true,
    useLrcLibFallback: true,
    lyricSourceMode: 'standard',
    // 設定の「歌詞ソース」タブでオフにした標準の取得元(lyric-sources.js)
    disabledLyricSources: [],
    alwaysShowMeaning: false,
    lowCpuMode: false,
    // タブを離れた時に PiP を自動で開く(Chrome の自動 PiP。pip-manager.js)
    pipAutoOpen: false,
    // UIサイズ (1 = 100%)。CSS 変数 --ytm-ui-scale に反映される。
    uiScale: 1
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
      replay_lyrics_heard: "累計行数",
      replay_unit_lines: "行",
      replay_unit_count: "回",
      ad_notice_title: "広告",
      btn_lyrics_menu: "歌詞のメニュー",
      btn_pip: "小窓に歌詞を出す (PiP)",
      btn_replay: "Daily Replay",
      btn_switch_version: "別のバージョンを探す",
      btn_lyric_card: "歌詞カード",
      btn_group_app: "統計と設定",
      lyrics_source_prefix: "歌詞ソース",
      lyrics_source_hint: "歌詞の取得元を切り替える / ズレを直す",
      lyrics_quality_none: "時刻なし",
      lyrics_quality_line: "行同期",
      lyrics_quality_word: "単語同期",
      lyrics_quality_caption: "字幕同期",
      lyric_card_title: "歌詞カード",
      lyric_card_selected: "{n} 行",
      lyric_card_hint: "行を押して範囲を変えられます（最大 4 行）",
      lyric_card_make: "カードを作る",
      lyric_card_cancel: "やめる",
      lyric_card_unavailable: "この曲には選べる歌詞がありません",
      lyric_card_failed: "カードを作れませんでした",
      ad_notice_sub: "終わると曲に戻ります",
      replay_share: "シェア",
      replay_unit_songs: "曲",
      replay_share_image: "画像にする",
      replay_share_title: "共有画像",
      replay_share_save: "保存",
      replay_share_copy: "コピー",
      replay_share_copied: "コピーしました",
      replay_share_copy_failed: "コピーできません",
      replay_share_close: "閉じる",
      replay_share_building: "作成中...",
      replay_share_failed: "画像を作れませんでした",
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
      settings_left_align: "タイトルとアーティスト名を左揃えにする",
      settings_apple_bg: "Apple Music風の動的背景を使用する",
      settings_animated_captions: "アニメーション字幕を使う",
      settings_singer_colors: "歌手ごとの色を歌詞に反映する",
      settings_low_cpu_mode: "軽量モード (背景アニメーション停止 / 高パフォーマンス)",
      settings_sec_display: "表示とレイアウト",
      settings_sec_bg: "背景エフェクト & パフォーマンス",
      settings_sec_lyrics: "歌詞スタイル & アニメーション",
      settings_source_auto_title: "歌詞ソース",
      settings_source_auto_desc: "優先する取得元を選びます。選んだ側に無かった曲は、自動で他の取得元に切り替わります。「単語同期 優先」はサーバーを問わず単語ごとに光る歌詞を採るので、翻訳や解説が乗っていた歌詞から差し替わることがあります。",
      settings_source_ytm: "YouTube Music 優先",
      settings_source_lrchub: "LRC Hub 優先",
      settings_source_wordsync: "単語同期 優先",
      settings_sec_source_priority: "優先のしかた",
      settings_sec_source_list: "使う取得元",
      settings_extra_providers: "取得元ごとのオン・オフ",
      settings_extra_providers_desc: "使わない取得元はオフにできます（オフにした取得元には通信しません）。「追加の取得元」はオンにする時に Chrome の許可を求めます。切り替えはその場で保存され、設定を閉じると今の曲にも反映されます。",
      settings_extra_providers_open: "別のタブで開く",
      settings_extra_providers_reload: "拡張機能が更新されました。このページを再読み込みすると設定できます。",
      settings_apple_sync: "Apple Music 風の文字同期",
      settings_korean_ruby: "韓国語の読みを表示",
      settings_korean_ruby_desc: "韓国語の歌詞の上に読みを小さく振ります。日本語表示ではカタカナ、それ以外ではローマ字です。",
      settings_keep_past_lyrics: "再生済みの歌詞を残す",
      settings_lyric_stagger: "歌詞を順番に弾ませてスクロールする",
      settings_lyric_stagger_desc: "行ごとに少し遅れて、ぷるんと動きます。軽量モードでは無効になります。",
      settings_fade_past_lyrics: "歌い終わった歌詞を消す",
      settings_fade_past_lyrics_desc: "歌い終わった行を約1秒でフェードアウトします。スクロール中は再表示し、追従に戻ると再び消えます。",
      settings_prefer_song_mode: "曲が変わったら「曲」モードに切り替える",
      settings_close: "閉じる",
      settings_tab_visuals: "表示",
      settings_tab_sources: "歌詞ソース",
      settings_tab_translation: "翻訳",
      settings_tab_data: "データとリセット",
      settings_ui_scale: "UIサイズ",
      settings_bg_brightness: "背景の明るさ",
      settings_lyric_weight: "歌詞の太さ",
      settings_meaning_always: "歌詞の解説がある時は常に表示する",
      settings_sec_pip: "PiP（小窓）",
      settings_pip_auto_open: "タブを離れた時に PiP を開く",
      settings_pip_auto_open_desc: "再生中に別のタブへ移ると開き、戻ると閉じます。初めての時は Chrome が許可を求めます(Chrome 134 以降)。",
      settings_sec_translation: "歌詞の翻訳",
      settings_lang_original: "原文",
      settings_optional: "任意",
      settings_deepl_placeholder: "API キーを貼り付け",
      settings_sec_data: "歌詞データ",
      settings_delete_current: "この曲の歌詞データを削除",
      settings_delete_current_desc: "再生中の曲の歌詞キャッシュだけを削除します",
      settings_delete: "削除",
      settings_delete_current_confirm: "この曲の歌詞キャッシュを削除しますか？\n（歌詞データ、同期情報などがリセットされます）",
      settings_deleted_current: "歌詞キャッシュを削除しました",
      settings_delete_all: "すべての歌詞データを削除",
      settings_delete_all_desc: "保存されているすべての歌詞データを削除します（設定と再生履歴は残ります）",
      settings_delete_all_btn: "全削除",
      settings_delete_all_confirm: "保存されているすべての歌詞データを削除しますか？\n（設定や再生履歴は保持されます）",
      settings_deleted_all: "すべての歌詞キャッシュを削除しました",
      settings_sec_reset: "リセット",
      settings_reset_all: "設定をリセット",
      settings_reset_all_desc: "拡張機能のすべての設定を初期状態に戻します（再生履歴と保存済みの歌詞は残ります）",
      settings_reset_confirm: "設定を初期状態に戻しますか？\n（再生履歴と保存済みの歌詞は残ります）",
      // 自前のプレイヤーバー(player-bar.js)
      fb_prev: "前へ",
      fb_play: "再生",
      fb_pause: "一時停止",
      fb_next: "次へ",
      fb_mute: "ミュート",
      fb_unmute: "ミュート解除",
      fb_volume: "音量",
      fb_shuffle: "シャッフル",
      fb_minimize: "プレイヤーを閉じる",
      fb_open_player: "プレイヤーを開く",
      fb_seek: "再生位置",
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
      replay_lyrics_heard: "Total lines",
      replay_unit_lines: "lines",
      replay_unit_count: "",
      ad_notice_title: "Ad",
      btn_lyrics_menu: "Lyrics menu",
      btn_pip: "Lyrics in a mini window (PiP)",
      btn_replay: "Daily Replay",
      btn_switch_version: "Find other versions",
      btn_lyric_card: "Lyric card",
      btn_group_app: "Stats and settings",
      lyrics_source_prefix: "Lyrics source",
      lyrics_source_hint: "Switch the lyrics source / fix the timing",
      lyrics_quality_none: "Unsynced",
      lyrics_quality_line: "Line sync",
      lyrics_quality_word: "Word sync",
      lyrics_quality_caption: "Caption sync",
      lyric_card_title: "Lyric card",
      lyric_card_selected: "{n} lines",
      lyric_card_hint: "Click lines to change the range (up to 4)",
      lyric_card_make: "Make card",
      lyric_card_cancel: "Cancel",
      lyric_card_unavailable: "No lyrics to pick for this song",
      lyric_card_failed: "Couldn't make the card",
      ad_notice_sub: "Your music continues after this",
      replay_share: "Share",
      replay_unit_songs: " songs",
      replay_share_image: "Save as image",
      replay_share_title: "Share image",
      replay_share_save: "Save",
      replay_share_copy: "Copy",
      replay_share_copied: "Copied",
      replay_share_copy_failed: "Couldn't copy",
      replay_share_close: "Close",
      replay_share_building: "Building...",
      replay_share_failed: "Couldn't build the image",
      settings_title: "Settings",
      settings_ui_lang: "Language",
      settings_trans: "Enable lyrics translation",
      settings_shared_trans: "Use shared translation (no API key required)",
      settings_main_lang: "Main language (large)",
      settings_sub_lang: "Sub language (small)",
      settings_save: "Save",
      settings_reset: "Reset",
      settings_saved: "Settings saved",
      settings_sync_offset: "Lyrics sync offset",
      settings_sync_offset_save: "Don't reset offset when the song changes",
      settings_left_align: "Left align title and artist name",
      settings_apple_bg: "Use Apple Music style dynamic background",
      settings_animated_captions: "Enable animated captions",
      settings_singer_colors: "Apply singer colors to lyrics",
      settings_low_cpu_mode: "Lightweight Mode (Stop background animation / High performance)",
      settings_sec_display: "Display & Layout",
      settings_sec_bg: "Background & Performance",
      settings_sec_lyrics: "Lyrics & Animations",
      settings_source_auto_title: "Lyrics source",
      settings_source_auto_desc: "Choose which source to try first. A song the chosen source lacks falls back to the remaining sources automatically. \"Prefer word sync\" takes word-by-word lyrics from any server, so it may replace lyrics that carried translations or annotations.",
      settings_source_ytm: "Prefer YouTube Music",
      settings_source_lrchub: "Prefer LRC Hub",
      settings_source_wordsync: "Prefer word sync",
      settings_sec_source_priority: "Priority",
      settings_sec_source_list: "Sources to use",
      settings_extra_providers: "Turn each source on or off",
      settings_extra_providers_desc: "Turn off any source you do not want; it will never be contacted. Extra sources ask for Chrome permission when you turn them on. Changes are saved right away and apply to the current song when you close Settings.",
      settings_extra_providers_open: "Open in a new tab",
      settings_extra_providers_reload: "The extension was updated. Reload this page to change these settings.",
      settings_apple_sync: "Apple Music style word sync",
      settings_korean_ruby: "Show Korean pronunciation",
      settings_korean_ruby_desc: "Shows a small romanized reading above Korean lyrics (katakana when the UI is in Japanese).",
      settings_keep_past_lyrics: "Keep already-played lyrics visible",
      settings_lyric_stagger: "Stagger lyric lines with a spring motion",
      settings_lyric_stagger_desc: "Each line follows with a slight delay and bounce. Disabled in Lightweight Mode.",
      settings_fade_past_lyrics: "Fade out completed lyrics",
      settings_fade_past_lyrics_desc: "Completed lines fade out in about 1 second. Scrolling reveals them until automatic following resumes.",
      settings_prefer_song_mode: "Switch to Song mode when the track changes",
      settings_close: "Close",
      settings_tab_visuals: "Visuals",
      settings_tab_sources: "Lyrics source",
      settings_tab_translation: "Translation",
      settings_tab_data: "Data & reset",
      settings_ui_scale: "UI size",
      settings_bg_brightness: "Background brightness",
      settings_lyric_weight: "Lyrics weight",
      settings_meaning_always: "Always show lyric notes when available",
      settings_sec_pip: "Picture-in-Picture",
      settings_pip_auto_open: "Open PiP when leaving the tab",
      settings_pip_auto_open_desc: "Opens when you switch to another tab during playback and closes when you come back. Chrome asks for permission the first time (Chrome 134 or later).",
      settings_sec_translation: "Lyrics translation",
      settings_lang_original: "Original",
      settings_optional: "Optional",
      settings_deepl_placeholder: "Paste your API key here",
      settings_sec_data: "Lyrics data",
      settings_delete_current: "Delete lyrics data for this song",
      settings_delete_current_desc: "Deletes only the cached lyrics of the song that is playing",
      settings_delete: "Delete",
      settings_delete_current_confirm: "Delete the cached lyrics for this song?\n(Lyrics data and timing adjustments will be reset.)",
      settings_deleted_current: "Deleted the cached lyrics",
      settings_delete_all: "Delete all lyrics data",
      settings_delete_all_desc: "Deletes all saved lyrics data (settings and play history are kept)",
      settings_delete_all_btn: "Delete all",
      settings_delete_all_confirm: "Delete all saved lyrics data?\n(Settings and play history are kept.)",
      settings_deleted_all: "Deleted all cached lyrics",
      settings_sec_reset: "Reset",
      settings_reset_all: "Reset all settings",
      settings_reset_all_desc: "Restores every extension setting to its default (play history and saved lyrics are kept)",
      settings_reset_confirm: "Reset all settings to their defaults?\n(Play history and saved lyrics are kept.)",
      // 自前のプレイヤーバー(player-bar.js)
      fb_prev: "Previous",
      fb_play: "Play",
      fb_pause: "Pause",
      fb_next: "Next",
      fb_mute: "Mute",
      fb_unmute: "Unmute",
      fb_volume: "Volume",
      fb_shuffle: "Shuffle",
      fb_minimize: "Close player",
      fb_open_player: "Open player",
      fb_seek: "Seek",
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
      replay_lyrics_heard: "누적 행 수",
      replay_unit_lines: "줄",
      replay_unit_count: "회",
      ad_notice_title: "광고",
      btn_lyrics_menu: "가사 메뉴",
      btn_pip: "작은 창에 가사 표시 (PiP)",
      btn_replay: "Daily Replay",
      btn_switch_version: "다른 버전 찾기",
      btn_lyric_card: "가사 카드",
      btn_group_app: "통계 및 설정",
      lyrics_source_prefix: "가사 소스",
      lyrics_source_hint: "가사 소스 전환 / 싱크 조정",
      lyrics_quality_none: "싱크 없음",
      lyrics_quality_line: "줄 싱크",
      lyrics_quality_word: "단어 싱크",
      lyrics_quality_caption: "자막 싱크",
      lyric_card_title: "가사 카드",
      lyric_card_selected: "{n}줄",
      lyric_card_hint: "줄을 눌러 범위를 바꿀 수 있습니다 (최대 4줄)",
      lyric_card_make: "카드 만들기",
      lyric_card_cancel: "취소",
      lyric_card_unavailable: "이 곡에는 고를 가사가 없습니다",
      lyric_card_failed: "카드를 만들 수 없습니다",
      ad_notice_sub: "광고가 끝나면 곡으로 돌아갑니다",
      replay_share: "점유율",
      replay_unit_songs: "곡",
      replay_share_image: "이미지로 저장",
      replay_share_title: "공유 이미지",
      replay_share_save: "저장",
      replay_share_copy: "복사",
      replay_share_copied: "복사했습니다",
      replay_share_copy_failed: "복사할 수 없습니다",
      replay_share_close: "닫기",
      replay_share_building: "만드는 중...",
      replay_share_failed: "이미지를 만들지 못했습니다",
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
      settings_singer_colors: "가수별 색상을 가사에 적용",
      settings_low_cpu_mode: "경량 모드 (배경 애니메이션 정지 / 고성능)",
      settings_sec_display: "표시 및 레이아웃",
      settings_sec_bg: "배경 그래픽 및 성능",
      settings_sec_lyrics: "가사 스타일 및 애니메이션",
      settings_animated_captions: "애니메이션 자막 사용",
      settings_apple_bg: "Apple Music 스타일 동적 배경 사용",
      settings_left_align: "제목과 아티스트 이름을 왼쪽 정렬",
      settings_source_auto_title: "가사 소스",
      settings_source_auto_desc: "먼저 사용할 소스를 선택합니다. 선택한 쪽에 가사가 없으면 나머지 소스로 자동 전환됩니다. '단어 동기화 우선'은 서버를 가리지 않고 단어 단위 가사를 고르므로, 번역이나 해설이 있던 가사에서 교체될 수 있습니다.",
      settings_source_ytm: "YouTube Music 우선",
      settings_source_lrchub: "LRC Hub 우선",
      settings_source_wordsync: "단어 동기화 우선",
      settings_sec_source_priority: "우선 순위",
      settings_sec_source_list: "사용할 소스",
      settings_extra_providers: "소스별 켜기/끄기",
      settings_extra_providers_desc: "사용하지 않을 소스는 끌 수 있습니다(꺼 둔 소스에는 연결하지 않습니다). '추가 소스'는 켤 때 Chrome 권한을 요청합니다. 변경은 바로 저장되며, 설정을 닫으면 지금 곡에도 적용됩니다.",
      settings_extra_providers_open: "새 탭에서 열기",
      settings_extra_providers_reload: "확장 프로그램이 업데이트되었습니다. 이 페이지를 새로고침하면 설정할 수 있습니다.",
      settings_apple_sync: "Apple Music 스타일 글자 동기화",
      settings_korean_ruby: "한국어 발음 표시",
      settings_korean_ruby_desc: "한국어 가사 위에 로마자 발음을 작게 표시합니다 (일본어 화면에서는 가타카나).",
      settings_keep_past_lyrics: "재생된 가사를 남겨두기",
      settings_lyric_stagger: "가사를 순서대로 탄력 있게 스크롤",
      settings_lyric_stagger_desc: "각 행이 조금씩 늦게 통통 튀며 움직입니다. 경량 모드에서는 비활성화됩니다.",
      settings_fade_past_lyrics: "재생이 끝난 가사 숨기기",
      settings_fade_past_lyrics_desc: "재생이 끝난 행을 약 1초 동안 서서히 숨깁니다. 스크롤 중에는 다시 표시하고 자동 따라가기가 재개되면 숨깁니다.",
      settings_prefer_song_mode: "곡이 바뀌면 '노래' 모드로 전환",
      settings_close: "닫기",
      settings_tab_visuals: "표시",
      settings_tab_sources: "가사 소스",
      settings_tab_translation: "번역",
      settings_tab_data: "데이터 및 초기화",
      settings_ui_scale: "UI 크기",
      settings_bg_brightness: "배경 밝기",
      settings_lyric_weight: "가사 굵기",
      settings_meaning_always: "가사 해설이 있으면 항상 표시",
      settings_sec_pip: "PiP(작은 창)",
      settings_pip_auto_open: "탭을 벗어나면 PiP 열기",
      settings_pip_auto_open_desc: "재생 중 다른 탭으로 이동하면 열리고, 돌아오면 닫힙니다. 처음에는 Chrome이 권한을 요청합니다(Chrome 134 이상).",
      settings_sec_translation: "가사 번역",
      settings_lang_original: "원문",
      settings_optional: "선택",
      settings_deepl_placeholder: "API 키를 붙여 넣으세요",
      settings_sec_data: "가사 데이터",
      settings_delete_current: "이 곡의 가사 데이터 삭제",
      settings_delete_current_desc: "재생 중인 곡의 가사 캐시만 삭제합니다",
      settings_delete: "삭제",
      settings_delete_current_confirm: "이 곡의 가사 캐시를 삭제할까요?\n(가사 데이터와 동기화 정보가 초기화됩니다)",
      settings_deleted_current: "가사 캐시를 삭제했습니다",
      settings_delete_all: "모든 가사 데이터 삭제",
      settings_delete_all_desc: "저장된 모든 가사 데이터를 삭제합니다(설정과 재생 기록은 유지됩니다)",
      settings_delete_all_btn: "모두 삭제",
      settings_delete_all_confirm: "저장된 모든 가사 데이터를 삭제할까요?\n(설정과 재생 기록은 유지됩니다)",
      settings_deleted_all: "모든 가사 캐시를 삭제했습니다",
      settings_sec_reset: "초기화",
      settings_reset_all: "설정 초기화",
      settings_reset_all_desc: "확장 프로그램의 모든 설정을 처음 상태로 되돌립니다(재생 기록과 저장된 가사는 유지됩니다)",
      settings_reset_confirm: "설정을 처음 상태로 되돌릴까요?\n(재생 기록과 저장된 가사는 유지됩니다)",
      // 自前のプレイヤーバー(player-bar.js)
      fb_prev: "이전",
      fb_play: "재생",
      fb_pause: "일시중지",
      fb_next: "다음",
      fb_mute: "음소거",
      fb_unmute: "음소거 해제",
      fb_volume: "볼륨",
      fb_shuffle: "셔플",
      fb_minimize: "플레이어 닫기",
      fb_open_player: "플레이어 열기",
      fb_seek: "재생 위치",
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
      replay_lyrics_heard: "累计行数",
      replay_unit_lines: "行",
      replay_unit_count: "次",
      ad_notice_title: "广告",
      btn_lyrics_menu: "歌词菜单",
      btn_pip: "在小窗口显示歌词 (PiP)",
      btn_replay: "Daily Replay",
      btn_switch_version: "查找其他版本",
      btn_lyric_card: "歌词卡片",
      btn_group_app: "统计和设置",
      lyrics_source_prefix: "歌词来源",
      lyrics_source_hint: "切换歌词来源 / 调整同步",
      lyrics_quality_none: "无时间轴",
      lyrics_quality_line: "逐行同步",
      lyrics_quality_word: "逐字同步",
      lyrics_quality_caption: "字幕同步",
      lyric_card_title: "歌词卡片",
      lyric_card_selected: "{n} 行",
      lyric_card_hint: "点击歌词行可更改范围（最多 4 行）",
      lyric_card_make: "生成卡片",
      lyric_card_cancel: "取消",
      lyric_card_unavailable: "这首歌没有可选的歌词",
      lyric_card_failed: "无法生成卡片",
      ad_notice_sub: "广告结束后继续播放",
      replay_share: "占比",
      replay_unit_songs: "首",
      replay_share_image: "生成图片",
      replay_share_title: "分享图片",
      replay_share_save: "保存",
      replay_share_copy: "复制",
      replay_share_copied: "已复制",
      replay_share_copy_failed: "无法复制",
      replay_share_close: "关闭",
      replay_share_building: "生成中...",
      replay_share_failed: "无法生成图片",
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
      settings_singer_colors: "将歌手颜色应用到歌词",
      settings_low_cpu_mode: "轻量模式 (停止背景动画 / 高性能)",
      settings_sec_display: "显示与布局",
      settings_sec_bg: "背景效果与性能",
      settings_sec_lyrics: "歌词样式与动画",
      settings_animated_captions: "使用动画字幕",
      settings_apple_bg: "使用 Apple Music 风格动态背景",
      settings_left_align: "标题与艺人名称左对齐",
      settings_source_auto_title: "歌词来源",
      settings_source_auto_desc: "选择优先使用的来源。所选来源没有该歌曲时，会自动切换到其余来源。「优先逐字同步」不限服务器，只要有逐字歌词就采用，因此可能会替换掉带有翻译或解说的歌词。",
      settings_source_ytm: "优先 YouTube Music",
      settings_source_lrchub: "优先 LRC Hub",
      settings_source_wordsync: "优先逐字同步",
      settings_sec_source_priority: "优先方式",
      settings_sec_source_list: "使用的来源",
      settings_extra_providers: "逐个开关来源",
      settings_extra_providers_desc: "不需要的来源可以关闭（关闭的来源不会被连接）。「额外来源」在打开时会请求 Chrome 权限。切换后立即保存，关闭设置后也会应用到当前歌曲。",
      settings_extra_providers_open: "在新标签页中打开",
      settings_extra_providers_reload: "扩展程序已更新。重新加载此页面后即可设置。",
      settings_apple_sync: "Apple Music 风格逐字同步",
      settings_korean_ruby: "显示韩语读音",
      settings_korean_ruby_desc: "在韩语歌词上方显示小号罗马字读音(日语界面下为片假名)。",
      settings_keep_past_lyrics: "保留已播放的歌词",
      settings_lyric_stagger: "让歌词逐行弹性滚动",
      settings_lyric_stagger_desc: "每行稍有延迟地弹动。轻量模式下禁用此效果。",
      settings_fade_past_lyrics: "淡出已唱完的歌词",
      settings_fade_past_lyrics_desc: "已唱完的行会在约1秒内淡出。滚动时重新显示，恢复自动跟随后再次淡出。",
      settings_prefer_song_mode: "切换歌曲时自动切到「歌曲」模式",
      settings_close: "关闭",
      settings_tab_visuals: "显示",
      settings_tab_sources: "歌词来源",
      settings_tab_translation: "翻译",
      settings_tab_data: "数据与重置",
      settings_ui_scale: "界面大小",
      settings_bg_brightness: "背景亮度",
      settings_lyric_weight: "歌词粗细",
      settings_meaning_always: "有歌词解说时始终显示",
      settings_sec_pip: "画中画（小窗）",
      settings_pip_auto_open: "离开标签页时打开画中画",
      settings_pip_auto_open_desc: "播放时切换到其他标签页会打开，返回后关闭。首次使用时 Chrome 会请求权限（需要 Chrome 134 或更高版本）。",
      settings_sec_translation: "歌词翻译",
      settings_lang_original: "原文",
      settings_optional: "可选",
      settings_deepl_placeholder: "在此粘贴 API 密钥",
      settings_sec_data: "歌词数据",
      settings_delete_current: "删除这首歌的歌词数据",
      settings_delete_current_desc: "只删除正在播放的歌曲的歌词缓存",
      settings_delete: "删除",
      settings_delete_current_confirm: "要删除这首歌的歌词缓存吗？\n（歌词数据和同步信息将被重置）",
      settings_deleted_current: "已删除歌词缓存",
      settings_delete_all: "删除所有歌词数据",
      settings_delete_all_desc: "删除所有已保存的歌词数据（保留设置和播放记录）",
      settings_delete_all_btn: "全部删除",
      settings_delete_all_confirm: "要删除所有已保存的歌词数据吗？\n（保留设置和播放记录）",
      settings_deleted_all: "已删除所有歌词缓存",
      settings_sec_reset: "重置",
      settings_reset_all: "重置所有设置",
      settings_reset_all_desc: "将扩展的所有设置恢复为初始状态（保留播放记录和已保存的歌词）",
      settings_reset_confirm: "要将设置恢复为初始状态吗？\n（保留播放记录和已保存的歌词）",
      // 自前のプレイヤーバー(player-bar.js)
      fb_prev: "上一首",
      fb_play: "播放",
      fb_pause: "暂停",
      fb_next: "下一首",
      fb_mute: "静音",
      fb_unmute: "取消静音",
      fb_volume: "音量",
      fb_shuffle: "随机播放",
      fb_minimize: "关闭播放器",
      fb_open_player: "打开播放器",
      fb_seek: "播放进度",
    }
  }; 
  
  
  const t = (key) => {
    const lang = config.uiLang || 'ja';

    const localLangTable = LOCAL_FALLBACK_TEXTS[lang] || {};
    const localJaTable = LOCAL_FALLBACK_TEXTS['ja'] || {};

    // 空文字は「その言語では何も付けない」という指定(英語の回数の単位など)。
    // 真偽で見ると空文字が日本語へ落ち、英語表示に「12回」と出ていた。
    const has = (table) => Object.prototype.hasOwnProperty.call(table, key) && typeof table[key] === 'string';
    if (has(localLangTable)) return localLangTable[key];
    if (has(localJaTable)) return localJaTable[key];
    return key;
  };




  // 言語コード
  function getLangDisplayName(code) {
    if (code === 'ja') return '日本語';
    if (code === 'en') return 'English';
    if (code === 'ko') return '한국어';
    if (code === 'zh') return 'Chinese';
    return code;
  }



  let uiLangEtcClickSetup = false;

  function refreshUiLangGroup() {
    const group = document.getElementById('ui-lang-group');
    if (!group) return;

    const current = config.uiLang || 'ja';
    group.innerHTML = '';


    const langs = Object.keys(LOCAL_FALLBACK_TEXTS);

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

  window.chrome = window.chrome || EXT;


  const NO_LYRICS_SENTINEL = '__NO_LYRICS__';

  // ===================== CloudSync: Daily Replay クラウド同期 =====================
