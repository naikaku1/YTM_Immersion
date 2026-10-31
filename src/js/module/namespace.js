
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
      let _handleTimer = null;
      // 直前に書き込んだスタイル値。値が変わっていないフレームでスタイルを
      // 書き直すと無駄なスタイル再計算が毎フレーム走るため、差分がある時だけ書く。
      // （このループは一度シークすると「バー外をクリックするまで」回り続けるので、
      //   アイドル時のコストをゼロに近づけておく必要がある）
      let _lastHandleStyle = '';
      const updateHandlePosition = () => {
        _handleRafId = null;
        _handleTimer = null;
        // バーが自動で隠れる・動くと、カーソルは動いていないので mouseleave が
        // 来ない。乗ったままと見なして毎フレーム回り続けていた(実機の計測)
        if (isHovering && !progressBar.matches(':hover')) isHovering = false;

        if (!document.body.classList.contains('ytm-custom-layout')) {
          if (_lastHandleStyle !== 'hidden') {
            customHandle.style.opacity = '0';
            _lastHandleStyle = 'hidden';
          }
          return;
        }

        // 表示条件をチェック。バーごと隠している間(動画モードで操作が無い時・
        // 自動で隠す設定)は出さない。乗ったままの判定でも、見えない丸を追っていた
        if (!shouldShowHandle() || barHiddenNow()) {
          if (_lastHandleStyle !== 'hidden') {
            customHandle.style.opacity = '0';
            _lastHandleStyle = 'hidden';
          }
          // バーが戻った時にまた出せるよう、隠れている間はクラスだけ見て待つ
          if (shouldShowHandle()) scheduleHandle();
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
        // 縦は線そのもの(#progressContainer)の中央に置く。シークバーの箱
        // (32px)の中央は線の中央と同じとは限らず、乗せて線が 2px → 4px に
        // 太る時は下へだけ太るので、丸が線より 1px 上に出ていた
        const lineRect = progressBar.querySelector('#progressContainer')?.getBoundingClientRect();
        const yRect = lineRect && lineRect.height > 0 ? lineRect : barRect;

        // knobの中心位置を計算（完全追従）
        const handleX = knobRect.left + knobRect.width / 2;
        const handleY = yRect.top + yRect.height / 2;
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

        // 表示中のみ次をスケジュールする。毎フレーム追うのは掴んでいる間だけ。
        // 乗っているだけ・シークした後(バーの外をクリックするまで出し続ける)は、
        // 再生に合わせて少しずつ進むだけなので 1 秒 4 回で足りる。
        // 以前はずっと毎フレームで、そのたびに位置を読むので、歌詞の塗りで
        // 汚れたスタイルとレイアウトを毎フレームその場で確定させていた
        // (カーソルをバーに置いたままの動画モードで、1 コアの 1 割。実測)
        if (shouldShowHandle()) scheduleHandle();
      };
      const scheduleHandle = () => {
        if (_handleRafId || _handleTimer) return;
        if (isDragging) _handleRafId = requestAnimationFrame(updateHandlePosition);
        else _handleTimer = setTimeout(updateHandlePosition, HANDLE_IDLE_MS);
      };
      const barHiddenNow = () => {
        const bar = progressBar.closest('ytmusic-player-bar');
        if (bar && bar.classList.contains('inactive') && bar.classList.contains('moviemode')) return true;
        const body = document.body.classList;
        return body.contains('ytm-bar-autohide') && !body.contains('ytm-bar-peek');
      };
      const HANDLE_IDLE_MS = 250;

      // 必要な時だけRAFループを開始するヘルパー
      const startHandleLoop = () => {
        if (_handleTimer) {
          clearTimeout(_handleTimer);
          _handleTimer = null;
        }
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

  // 表示言語の既定はブラウザの言語(設定ページ options.js と同じ決め方)。
  // 以前は日本語に固定で、英語の Chrome でも初めは日本語で出ていた。
  const DEFAULT_UI_LANG = (() => {
    let code = '';
    try { code = globalThis.chrome?.i18n?.getUILanguage?.() || ''; } catch (e) { /* 下で navigator を見る */ }
    code = String(code || navigator.language || '').toLowerCase();
    if (code.startsWith('ja')) return 'ja';
    if (code.startsWith('ko')) return 'ko';
    if (code.startsWith('zh')) return 'zh';
    return 'en';
  })();

  let config = {
    deepLKey: null,
    // 翻訳は既定オフ。使いたい人が設定パネルから明示的に有効化する。
    useTrans: false,
    mode: true,
    mainLang: 'original',
    // 'auto' は表示言語へ訳す(lyrics-ui.js の resolveTranslationLang)
    subLang: 'auto',
    uiLang: DEFAULT_UI_LANG,
    syncOffset: 0,
    saveSyncOffset: false,
    // 共有翻訳(LRCHub に登録された訳)があればそれを先に使う。無い曲は機械翻訳。
    useSharedTranslateApi: true,
    leftAlignInfo: false,
    // 再生済み歌詞の旧設定との互換用。fadePastLyrics の逆を保つ。
    keepPastLyrics: true,
    lyricStagger: true,
    fadePastLyrics: false,
    // 曲が変わったときに YTM の「動画」を「曲」に切り替えるか。
    // 既定 ON = 従来どおり。OFF にすると動画モードのまま聴ける。
    preferSongMode: true,
    // 小さい曲・動画の音量を上げて揃えるか(volume-leveler.js)。曲版と MV で音量が違うのを直す
    levelVolume: true,
    // 動画モードで、歌詞を映像の右下に重ねて出すか(YT-Immersion の MV モードと同じ置き方)
    movieLyrics: true,
    // 動画モードで、MV の歌以外の場面(対応表に無い所)を飛ばすか。ログイン中だけ働く
    movieSkipScenes: false,
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
    // 本人専用の LRCHub 中継へ再生情報を送り、Discord に表示する。
    discordEnabled: false,
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
      btn_video_quality: "画質",
      quality_auto: "自動",
      btn_group_app: "統計と設定",
      lyrics_source_prefix: "歌詞ソース",
      lyrics_source_hint: "歌詞の取得元を切り替える / ズレを直す",
      lyrics_quality_none: "時刻なし",
      lyrics_quality_line: "行同期",
      lyrics_quality_word: "単語同期",
      lyrics_quality_caption: "字幕同期",
      lyric_card_title: "歌詞カード",
      lyric_card_selected: "{n} 行",
      lyric_card_hint: "行を押して範囲を変更（最大 4 行）",
      lyric_card_make: "カードを作る",
      lyric_card_cancel: "やめる",
      lyric_card_unavailable: "この曲には選べる歌詞がありません",
      lyric_card_failed: "カードを作れませんでした",
      lyric_card_post_x: "X に投稿",
      lyric_card_post_credit: "{artist}「{title}」",
      lyric_card_post_credit_title: "「{title}」",
      lyric_card_post_listen_at: "{song}を、この歌詞から YouTube Music で聴く",
      lyric_card_post_listen: "{song}を YouTube Music で聴く",
      lyric_card_copy_link: "リンクをコピー",
      lyric_card_link_copied: "コピーしました",
      lyric_card_x_hint: "画像をコピーしました。開いた投稿画面で貼り付けてください",
      lyric_card_x_hint_save: "画像をコピーできませんでした。保存して投稿画面で添付してください",
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
      settings_target_lang: "訳す先",
      settings_lang_auto: "自動",
      settings_trans_advanced: "詳細設定",
      settings_shared_trans_desc: "LRCHub に登録された訳がある曲は、それを先に使います。",
      settings_deepl_desc: "入れると、共有翻訳が無い曲を Chrome の翻訳の代わりに DeepL で訳します。",
      settings_trans_desc_builtin: "共有翻訳が無い曲は Chrome の翻訳で訳します（歌詞は外へ送りません）。",
      settings_trans_desc_deepl: "共有翻訳が無い曲は DeepL で訳します。",
      settings_trans_desc_none: "このブラウザでは共有翻訳がある曲だけを訳します。DeepL の API キーを入れると他の曲も訳せます。",
      trans_dl_prompt: "この曲を訳すには Chrome の翻訳データ(100〜200MB ほど)が要ります",
      trans_dl_button: "ダウンロード",
      trans_dl_progress: "翻訳データをダウンロード中… {p}%",
      trans_dl_failed: "翻訳データをダウンロードできませんでした",
      lyrics_trans_shared: "共有翻訳",
      lyrics_trans_deepl: "DeepL 翻訳",
      lyrics_trans_builtin: "Chrome 翻訳",
      settings_save: "保存",
      settings_reset: "リセット",
      menu_lyrics_title: "歌詞",
      menu_read_local: "手元の歌詞ファイルを読み込む",
      menu_add_sync: "歌詞に時刻を付ける",
      menu_other_sources: "他の取得元から探す",
      menu_timing: "ズレを直す",
      menu_offset_earlier: "歌詞を早める",
      menu_offset_later: "歌詞を遅らせる",
      menu_offset_reset: "0 に戻す",
      menu_pick_other: "別の歌詞を選ぶ",
      replay_restore: "復元",
      replay_backup: "バックアップ",
      replay_cloud: "クラウド",
      settings_sync_offset: "歌詞同期オフセット",
      settings_sync_offset_save: "曲が切り替わったときにオフセットをリセットしない",
      settings_left_align: "タイトルとアーティスト名を左揃えにする",
      settings_bar_autohide: "操作バーを自動で隠す",
      settings_bar_autohide_desc: "マウスを画面の下に近づけた時だけ出します。",
      settings_apple_bg: "Apple Music風の動的背景を使用する",
      settings_animated_captions: "アニメーション字幕を使う",
      settings_singer_colors: "歌手ごとの色を歌詞に反映する",
      settings_low_cpu_mode: "軽量モード（背景アニメーションを止める）",
      settings_sec_display: "表示とレイアウト",
      settings_sec_bg: "背景エフェクト & パフォーマンス",
      settings_sec_lyrics: "歌詞スタイル & アニメーション",
      settings_source_auto_title: "歌詞ソース",
      settings_source_auto_desc: "選んだ取得元に無い曲は、自動で他から探します。",
      settings_source_ytm: "YouTube Music 優先",
      settings_source_lrchub: "LRC Hub 優先",
      settings_source_wordsync: "単語同期 優先",
      settings_sec_source_priority: "優先のしかた",
      settings_sec_source_list: "使う取得元",
      settings_extra_providers: "取得元ごとのオン・オフ",
      settings_extra_providers_desc: "オフにした取得元には通信しません。「追加の取得元」はオンにする時に Chrome の許可を求めます。",
      settings_extra_providers_open: "別のタブで開く",
      settings_extra_providers_reload: "拡張機能が更新されました。このページを再読み込みすると設定できます。",
      settings_apple_sync: "Apple Music 風の文字同期",
      settings_korean_ruby: "韓国語の読みを表示",
      settings_korean_ruby_desc: "韓国語の歌詞の上に読みを小さく振ります。",
      settings_keep_past_lyrics: "再生済みの歌詞を残す",
      settings_lyric_stagger: "歌詞を順番に弾ませてスクロールする",
      settings_lyric_stagger_desc: "行ごとに少し遅れて動きます。",
      settings_fade_past_lyrics: "歌い終わった歌詞を消す",
      settings_fade_past_lyrics_desc: "歌い終わった行を約1秒で消します。",
      settings_prefer_song_mode: "曲が変わったら「曲」モードに切り替える",
      settings_level_volume: "小さい曲・動画の音量を上げて揃える",
      settings_movie_lyrics: "動画モードで歌詞を映像に重ねる",
      settings_movie_lyrics_desc: "映像を全画面に出し、歌詞を右下に重ねます。",
      settings_movie_skip_scenes: "MV の歌以外の場面を飛ばす",
      settings_movie_skip_scenes_desc: "イントロのドラマなど、曲が流れていない場面を飛ばします（ログイン中のみ）。",
      settings_close: "閉じる",
      settings_tab_visuals: "表示",
      settings_tab_bg: "背景",
      settings_tab_lyrics: "歌詞",
      settings_tab_video: "動画と PiP",
      settings_sec_timing: "タイミング",
      settings_sec_reading: "読み",
      settings_sec_movie: "動画モード",
      settings_search_placeholder: "設定を検索",
      settings_search_empty: "見つかりませんでした",
      settings_tab_sources: "歌詞ソース",
      settings_tab_translation: "翻訳",
      settings_tab_integrations: "連携",
      settings_sec_discord: "Discord",
      settings_discord_enabled: "Discord に曲情報を表示する",
      settings_discord_desc: "曲名・アーティスト・再生状況・現在の歌詞を LRCHub 経由で Discord に表示します。",
      settings_discord_account: "LRCHub のアカウント",
      settings_discord_account_desc: "クラウド同期と同じ「復活の呪文」を使います。未設定の場合はこちらから入力してください。",
      settings_discord_token: "復活の呪文を設定",
      settings_discord_auth_title: "Discord の追加認可",
      settings_discord_auth_desc: "初回はマイページの「Discordに連携する」から追加認可が必要です。",
      settings_discord_auth_link: "こちらから追加の権限を許可してください",
      settings_discord_activity_note: "Discord 側のアクティビティ共有も有効にしてください。",
      settings_discord_mypage: "マイページを開く",
      settings_discord_connection: "接続テスト",
      settings_discord_check: "テストする",
      settings_discord_test_desc: "できていない設定と、次に必要な操作を確認します。",
      settings_discord_setup_title: "使い方・リンク",
      settings_discord_setup_desc: "初回に必要な準備です。設定済みの項目は飛ばせます。",
      settings_discord_setup_account: "LRCHub に登録・ログイン",
      settings_discord_setup_account_desc: "未登録の場合は、マイページからアカウントを作成します。",
      settings_discord_setup_account_link: "登録・ログイン",
      settings_discord_setup_authorize: "Discord の追加権限を許可",
      settings_discord_setup_authorize_desc: "マイページの「Discordに連携する」から認可します。",
      settings_discord_setup_authorize_link: "追加権限を許可",
      settings_discord_setup_token: "復活の呪文を保存",
      settings_discord_setup_token_desc: "LRCHub に表示される呪文を入力します。クラウド同期で保存済みなら不要です。",
      settings_discord_setup_play: "曲を再生して接続テスト",
      settings_discord_setup_play_desc: "上のトグルを有効にして曲を再生し、接続テストで準備が整っているか確認します。",
      settings_discord_test_title: "Discord 接続テスト",
      settings_discord_test_off_help: "上のトグルを有効にしてから、もう一度テストしてください。",
      settings_discord_test_token_help: "未登録の場合は LRCHub に登録し、マイページにある「復活の呪文」をこの拡張機能に設定してください。",
      settings_discord_test_invalid_token: "復活の呪文を確認できませんでした。",
      settings_discord_test_invalid_help: "LRCHub のマイページから復活の呪文をコピーし直し、設定してください。登録状況はこの結果だけでは判断できません。",
      settings_discord_test_access_denied: "LRCHub に接続を拒否されました。",
      settings_discord_test_access_help: "マイページで復活の呪文と Discord の連携を確認し、もう一度テストしてください。",
      settings_discord_test_network_help: "通信できませんでした。インターネット接続を確認し、時間をおいて再テストしてください。",
      settings_discord_test_server: "LRCHub 側の中継が利用できません。",
      settings_discord_test_server_help: "サーバー側の準備または稼働に問題があります。こちらの設定を変えず、時間をおいて再テストしてください。",
      settings_discord_test_auth_help: "マイページの「Discordに連携する」から追加の権限を許可してください。完了したら再テストできます。",
      settings_discord_test_reflection_help: "Discord への送信で問題が発生しています。マイページの連携を確認し、時間をおいて再テストしてください。",
      settings_discord_test_stale: "再生情報の更新が途切れています。",
      settings_discord_test_stale_help: "曲を再生して数秒待ち、再テストしてください。改善しない場合は拡張機能と YouTube Music を再読み込みしてください。",
      settings_discord_test_play_help: "YouTube Music で曲を再生し、数秒待ってからテストしてください。",
      settings_discord_test_not_received: "再生中ですが、最新の再生情報が届いていません。",
      settings_discord_test_paused: "再生が一時停止しています。",
      settings_discord_test_paused_help: "再生を再開すると曲情報が更新されます。再開してからもう一度テストしてください。",
      settings_discord_test_updated_help: "Discord への更新を確認しました。表示されない場合は Discord 側のアクティビティ共有を確認してください。",
      settings_discord_test_received_help: "LRCHub への送信はできています。Discord への反映には数秒かかるため、少し待って再テストしてください。",
      settings_discord_test_manual_note: "Discord 側のアクティビティ共有は、このテストでは確認できません。Discord の設定でも有効にしてください。",
      settings_discord_test_feature: "機能の有効化",
      settings_discord_test_token: "復活の呪文",
      settings_discord_test_server_label: "LRCHub への接続",
      settings_discord_test_authorization: "Discord の追加認可",
      settings_discord_test_playback: "再生情報の受信",
      settings_discord_test_reflection: "Discord への送信",
      settings_discord_test_ok: "確認済み",
      settings_discord_test_unknown: "未確認",
      settings_discord_test_pending: "確認待ち",
      settings_discord_test_token_stored: "設定済み・認証は未確認",
      settings_discord_test_enable: "有効にする",
      settings_discord_test_retry: "もう一度テスト",
      settings_discord_test_play: "曲を再生してから再テスト",
      settings_discord_test_ad: "広告の再生中です。",
      settings_discord_test_ad_help: "曲の再生が始まってから、もう一度テストしてください。",
      settings_discord_status_unchecked: "接続テストはまだ実行していません。",
      settings_discord_status_checking: "接続をテストしています…",
      settings_discord_status_off: "Discord 連携はオフです。",
      settings_discord_status_token: "復活の呪文を設定してください。",
      settings_discord_status_auth: "復活の呪文を確認し、マイページから Discord の追加認可を行ってください。",
      settings_discord_status_failed: "接続状態を取得できませんでした。時間をおいて再確認してください。",
      settings_discord_status_waiting: "再生情報を待っています。曲を再生してから再確認してください。",
      settings_discord_status_received: "サーバーで再生情報を受信済みです。Discord への反映を待っています。",
      settings_discord_status_updated: "Discord への反映を確認しました。",
      settings_discord_status_reflection_error: "Discord への反映に失敗しました。マイページの連携とアクティビティ共有を確認してください。",
      settings_tab_data: "データとリセット",
      settings_ui_scale: "UIサイズ",
      settings_bg_brightness: "背景の明るさ",
      settings_lyric_weight: "歌詞の太さ",
      settings_meaning_always: "歌詞の解説がある時は常に表示する",
      settings_sec_pip: "PiP（小窓）",
      settings_pip_auto_open: "タブを離れた時に PiP を開く",
      settings_pip_auto_open_desc: "再生中に別のタブへ移ると開き、戻ると閉じます。",
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
      btn_video_quality: "Quality",
      quality_auto: "Auto",
      btn_group_app: "Stats and settings",
      lyrics_source_prefix: "Lyrics source",
      lyrics_source_hint: "Switch the lyrics source / fix the timing",
      lyrics_quality_none: "Unsynced",
      lyrics_quality_line: "Line sync",
      lyrics_quality_word: "Word sync",
      lyrics_quality_caption: "Caption sync",
      lyric_card_title: "Lyric card",
      lyric_card_selected: "{n} lines",
      lyric_card_hint: "Click lines to change the range (max 4)",
      lyric_card_make: "Make card",
      lyric_card_cancel: "Cancel",
      lyric_card_unavailable: "No lyrics to pick for this song",
      lyric_card_failed: "Couldn't make the card",
      lyric_card_post_x: "Post on X",
      lyric_card_post_credit: "\"{title}\" by {artist}",
      lyric_card_post_credit_title: "\"{title}\"",
      lyric_card_post_listen_at: "Listen to {song} from this line on YouTube Music",
      lyric_card_post_listen: "Listen to {song} on YouTube Music",
      lyric_card_copy_link: "Copy link",
      lyric_card_link_copied: "Copied",
      lyric_card_x_hint: "Image copied. Paste it into the post that just opened",
      lyric_card_x_hint_save: "Couldn't copy the image. Save it and attach it to the post",
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
      settings_target_lang: "Translate into",
      settings_lang_auto: "Auto",
      settings_trans_advanced: "Advanced",
      settings_shared_trans_desc: "Songs with a translation on LRCHub use that one first.",
      settings_deepl_desc: "With a key, songs without a shared translation are translated by DeepL instead of Chrome.",
      settings_trans_desc_builtin: "Songs without a shared translation are translated by Chrome on this computer (lyrics are not sent anywhere).",
      settings_trans_desc_deepl: "Songs without a shared translation are translated by DeepL.",
      settings_trans_desc_none: "This browser only shows shared translations. Add a DeepL API key to translate other songs.",
      trans_dl_prompt: "Translating this song needs Chrome's translation data (about 100–200 MB)",
      trans_dl_button: "Download",
      trans_dl_progress: "Downloading translation data… {p}%",
      trans_dl_failed: "Could not download the translation data",
      lyrics_trans_shared: "Shared translation",
      lyrics_trans_deepl: "DeepL translation",
      lyrics_trans_builtin: "Chrome translation",
      settings_save: "Save",
      settings_reset: "Reset",
      menu_lyrics_title: "Lyrics",
      menu_read_local: "Load a lyrics file",
      menu_add_sync: "Add timing to lyrics",
      menu_other_sources: "Search other sources",
      menu_timing: "Adjust timing",
      menu_offset_earlier: "Show lyrics earlier",
      menu_offset_later: "Show lyrics later",
      menu_offset_reset: "Reset to 0",
      menu_pick_other: "Choose other lyrics",
      replay_restore: "Restore",
      replay_backup: "Backup",
      replay_cloud: "Cloud",
      settings_sync_offset: "Lyrics sync offset",
      settings_sync_offset_save: "Don't reset offset when the song changes",
      settings_left_align: "Left align title and artist name",
      settings_bar_autohide: "Auto-hide the player bar",
      settings_bar_autohide_desc: "Shows the bar only when the mouse is near the bottom of the screen.",
      settings_apple_bg: "Use Apple Music style dynamic background",
      settings_animated_captions: "Enable animated captions",
      settings_singer_colors: "Apply singer colors to lyrics",
      settings_low_cpu_mode: "Lightweight Mode (stops background animation)",
      settings_sec_display: "Display & Layout",
      settings_sec_bg: "Background & Performance",
      settings_sec_lyrics: "Lyrics & Animations",
      settings_source_auto_title: "Lyrics source",
      settings_source_auto_desc: "If the chosen source lacks a song, the others are tried automatically.",
      settings_source_ytm: "Prefer YouTube Music",
      settings_source_lrchub: "Prefer LRC Hub",
      settings_source_wordsync: "Prefer word sync",
      settings_sec_source_priority: "Priority",
      settings_sec_source_list: "Sources to use",
      settings_extra_providers: "Turn each source on or off",
      settings_extra_providers_desc: "Sources you turn off are never contacted. Extra sources ask for Chrome permission when turned on.",
      settings_extra_providers_open: "Open in a new tab",
      settings_extra_providers_reload: "The extension was updated. Reload this page to change these settings.",
      settings_apple_sync: "Apple Music style word sync",
      settings_korean_ruby: "Show Korean pronunciation",
      settings_korean_ruby_desc: "Shows a small romanized reading above Korean lyrics.",
      settings_keep_past_lyrics: "Keep already-played lyrics visible",
      settings_lyric_stagger: "Stagger lyric lines with a spring motion",
      settings_lyric_stagger_desc: "Each line follows with a slight delay.",
      settings_fade_past_lyrics: "Fade out completed lyrics",
      settings_fade_past_lyrics_desc: "Completed lines fade out after about 1 second.",
      settings_prefer_song_mode: "Switch to Song mode when the track changes",
      settings_level_volume: "Raise quiet songs and videos to an even volume",
      settings_movie_lyrics: "Show lyrics over the video in Video mode",
      settings_movie_lyrics_desc: "Shows the video full screen with the lyrics over its lower right.",
      settings_movie_skip_scenes: "Skip non-music scenes in music videos",
      settings_movie_skip_scenes_desc: "Skips scenes where the song isn't playing, such as drama intros (signed-in only).",
      settings_close: "Close",
      settings_tab_visuals: "Visuals",
      settings_tab_bg: "Background",
      settings_tab_lyrics: "Lyrics",
      settings_tab_video: "Video & PiP",
      settings_sec_timing: "Timing",
      settings_sec_reading: "Pronunciation",
      settings_sec_movie: "Video mode",
      settings_search_placeholder: "Search settings",
      settings_search_empty: "No matches",
      settings_tab_sources: "Lyrics source",
      settings_tab_translation: "Translation",
      settings_tab_integrations: "Integrations",
      settings_sec_discord: "Discord",
      settings_discord_enabled: "Show song information on Discord",
      settings_discord_desc: "Share the song, artist, playback state and current lyric with Discord through LRCHub.",
      settings_discord_account: "LRCHub account",
      settings_discord_account_desc: "Uses the same recovery token as cloud sync. Set it here if you have not done so.",
      settings_discord_token: "Set recovery token",
      settings_discord_auth_title: "Additional Discord authorization",
      settings_discord_auth_desc: "First, select “Connect to Discord” on My Page to grant additional permissions.",
      settings_discord_auth_link: "Grant additional permissions here",
      settings_discord_activity_note: "Also enable activity sharing in Discord.",
      settings_discord_mypage: "Open My Page",
      settings_discord_connection: "Connection test",
      settings_discord_check: "Run test",
      settings_discord_test_desc: "Find missing setup and see what to do next.",
      settings_discord_setup_title: "How to connect & links",
      settings_discord_setup_desc: "Complete this setup once. Skip anything you have already done.",
      settings_discord_setup_account: "Sign up or sign in to LRCHub",
      settings_discord_setup_account_desc: "If you do not have an account, create one from My Page.",
      settings_discord_setup_account_link: "Sign up / sign in",
      settings_discord_setup_authorize: "Grant additional Discord permissions",
      settings_discord_setup_authorize_desc: "Select “Connect to Discord” on My Page to authorize it.",
      settings_discord_setup_authorize_link: "Grant permissions",
      settings_discord_setup_token: "Save your recovery token",
      settings_discord_setup_token_desc: "Enter the token shown on LRCHub. Skip this if you already saved it for cloud sync.",
      settings_discord_setup_play: "Play a song and run the connection test",
      settings_discord_setup_play_desc: "Turn on the toggle above and play a song, then run the test to check that setup is complete.",
      settings_discord_test_title: "Discord connection test",
      settings_discord_test_off_help: "Turn on the toggle above, then run the test again.",
      settings_discord_test_token_help: "If you do not have an LRCHub account, sign up, then save the recovery token from My Page in this extension.",
      settings_discord_test_invalid_token: "The recovery token could not be verified.",
      settings_discord_test_invalid_help: "Copy the recovery token from LRCHub My Page again and save it. This result alone cannot tell whether you have registered.",
      settings_discord_test_access_denied: "LRCHub refused the connection.",
      settings_discord_test_access_help: "Check the recovery token and Discord connection on My Page, then run the test again.",
      settings_discord_test_network_help: "The server could not be reached. Check your internet connection and try the test again later.",
      settings_discord_test_server: "The LRCHub relay is unavailable.",
      settings_discord_test_server_help: "There is a server setup or availability issue. Keep your settings as they are and try the test again later.",
      settings_discord_test_auth_help: "Select “Connect to Discord” on My Page and grant the additional permissions. Run the test again afterward.",
      settings_discord_test_reflection_help: "There is a problem sending the update to Discord. Check the connection on My Page and try the test again later.",
      settings_discord_test_stale: "Playback updates have stopped arriving.",
      settings_discord_test_stale_help: "Play a song, wait a few seconds and run the test again. If it still fails, reload the extension and YouTube Music.",
      settings_discord_test_play_help: "Play a song on YouTube Music, wait a few seconds and run the test.",
      settings_discord_test_not_received: "A song is playing, but the latest playback information has not arrived.",
      settings_discord_test_paused: "Playback is paused.",
      settings_discord_test_paused_help: "Song information will update when playback resumes. Resume playback, then run the test again.",
      settings_discord_test_updated_help: "The Discord update was confirmed. If it is not visible, check activity sharing in Discord.",
      settings_discord_test_received_help: "Playback information reached LRCHub. Discord may take a few seconds to update; wait briefly and run the test again.",
      settings_discord_test_manual_note: "This test cannot check Discord's activity-sharing setting. Enable it in Discord too.",
      settings_discord_test_feature: "Feature enabled",
      settings_discord_test_token: "Recovery token",
      settings_discord_test_server_label: "Connection to LRCHub",
      settings_discord_test_authorization: "Additional Discord authorization",
      settings_discord_test_playback: "Playback information received",
      settings_discord_test_reflection: "Delivery to Discord",
      settings_discord_test_ok: "Confirmed",
      settings_discord_test_unknown: "Not verified",
      settings_discord_test_pending: "Waiting for confirmation",
      settings_discord_test_token_stored: "Saved; authentication not verified",
      settings_discord_test_enable: "Enable",
      settings_discord_test_retry: "Run test again",
      settings_discord_test_play: "Play a song, then test again",
      settings_discord_test_ad: "An advertisement is playing.",
      settings_discord_test_ad_help: "Run the test again after the song starts playing.",
      settings_discord_status_unchecked: "The connection test has not been run yet.",
      settings_discord_status_checking: "Testing connection…",
      settings_discord_status_off: "Discord integration is off.",
      settings_discord_status_token: "Set your recovery token first.",
      settings_discord_status_auth: "Check your recovery token and grant additional Discord permissions on My Page.",
      settings_discord_status_failed: "Could not check the connection. Please try again later.",
      settings_discord_status_waiting: "Waiting for playback information. Play a song and check again.",
      settings_discord_status_received: "The server received playback information. Waiting for Discord to update.",
      settings_discord_status_updated: "The Discord update was confirmed.",
      settings_discord_status_reflection_error: "Discord could not be updated. Check the connection on My Page and enable activity sharing.",
      settings_tab_data: "Data & reset",
      settings_ui_scale: "UI size",
      settings_bg_brightness: "Background brightness",
      settings_lyric_weight: "Lyrics weight",
      settings_meaning_always: "Always show lyric notes when available",
      settings_sec_pip: "Picture-in-Picture",
      settings_pip_auto_open: "Open PiP when leaving the tab",
      settings_pip_auto_open_desc: "Opens when you switch tabs during playback and closes when you return.",
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
      btn_video_quality: "화질",
      quality_auto: "자동",
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
      lyric_card_post_x: "X에 게시",
      lyric_card_post_credit: "{artist}의 「{title}」",
      lyric_card_post_credit_title: "「{title}」",
      lyric_card_post_listen_at: "이 가사부터 YouTube Music에서 {song} 듣기",
      lyric_card_post_listen: "YouTube Music에서 {song} 듣기",
      lyric_card_copy_link: "링크 복사",
      lyric_card_link_copied: "복사했습니다",
      lyric_card_x_hint: "이미지를 복사했습니다. 열린 게시 화면에 붙여 넣으세요",
      lyric_card_x_hint_save: "이미지를 복사하지 못했습니다. 저장한 뒤 게시 화면에 첨부하세요",
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
      settings_target_lang: "번역할 언어",
      settings_lang_auto: "자동",
      settings_trans_advanced: "고급 설정",
      settings_shared_trans_desc: "LRCHub에 등록된 번역이 있는 곡은 그 번역을 먼저 사용합니다.",
      settings_deepl_desc: "키를 입력하면 공유 번역이 없는 곡을 Chrome 번역 대신 DeepL로 번역합니다.",
      settings_trans_desc_builtin: "공유 번역이 없는 곡은 Chrome 번역으로 번역합니다(가사는 외부로 보내지 않습니다).",
      settings_trans_desc_deepl: "공유 번역이 없는 곡은 DeepL로 번역합니다.",
      settings_trans_desc_none: "이 브라우저에서는 공유 번역이 있는 곡만 번역합니다. DeepL API 키를 입력하면 다른 곡도 번역할 수 있습니다.",
      trans_dl_prompt: "이 곡을 번역하려면 Chrome 번역 데이터(약 100~200MB)가 필요합니다",
      trans_dl_button: "내려받기",
      trans_dl_progress: "번역 데이터 내려받는 중… {p}%",
      trans_dl_failed: "번역 데이터를 내려받지 못했습니다",
      lyrics_trans_shared: "공유 번역",
      lyrics_trans_deepl: "DeepL 번역",
      lyrics_trans_builtin: "Chrome 번역",
      settings_save: "저장",
      settings_reset: "초기화",
      menu_lyrics_title: "가사",
      menu_read_local: "가사 파일 불러오기",
      menu_add_sync: "가사에 타이밍 넣기",
      menu_other_sources: "다른 출처에서 찾기",
      menu_timing: "싱크 조정",
      menu_offset_earlier: "가사를 빠르게",
      menu_offset_later: "가사를 늦게",
      menu_offset_reset: "0으로 되돌리기",
      menu_pick_other: "다른 가사 선택",
      replay_restore: "복원",
      replay_backup: "백업",
      replay_cloud: "클라우드",
      settings_sync_offset: "가사 동기 오프셋",
      settings_sync_offset_save: "곡이 바뀌어도 오프셋을 초기화하지 않기",
      settings_singer_colors: "가수별 색상을 가사에 적용",
      settings_low_cpu_mode: "경량 모드 (배경 애니메이션 정지)",
      settings_sec_display: "표시 및 레이아웃",
      settings_sec_bg: "배경 그래픽 및 성능",
      settings_sec_lyrics: "가사 스타일 및 애니메이션",
      settings_animated_captions: "애니메이션 자막 사용",
      settings_apple_bg: "Apple Music 스타일 동적 배경 사용",
      settings_left_align: "제목과 아티스트 이름을 왼쪽 정렬",
      settings_bar_autohide: "재생 바 자동 숨기기",
      settings_bar_autohide_desc: "마우스를 화면 아래쪽에 가져갈 때만 표시합니다.",
      settings_source_auto_title: "가사 소스",
      settings_source_auto_desc: "선택한 소스에 없는 곡은 다른 소스에서 자동으로 찾습니다.",
      settings_source_ytm: "YouTube Music 우선",
      settings_source_lrchub: "LRC Hub 우선",
      settings_source_wordsync: "단어 동기화 우선",
      settings_sec_source_priority: "우선 순위",
      settings_sec_source_list: "사용할 소스",
      settings_extra_providers: "소스별 켜기/끄기",
      settings_extra_providers_desc: "꺼 둔 소스에는 연결하지 않습니다. '추가 소스'는 켤 때 Chrome 권한을 요청합니다.",
      settings_extra_providers_open: "새 탭에서 열기",
      settings_extra_providers_reload: "확장 프로그램이 업데이트되었습니다. 이 페이지를 새로고침하면 설정할 수 있습니다.",
      settings_apple_sync: "Apple Music 스타일 글자 동기화",
      settings_korean_ruby: "한국어 발음 표시",
      settings_korean_ruby_desc: "한국어 가사 위에 로마자 발음을 작게 표시합니다.",
      settings_keep_past_lyrics: "재생된 가사를 남겨두기",
      settings_lyric_stagger: "가사를 순서대로 탄력 있게 스크롤",
      settings_lyric_stagger_desc: "각 행이 조금씩 늦게 움직입니다.",
      settings_fade_past_lyrics: "재생이 끝난 가사 숨기기",
      settings_fade_past_lyrics_desc: "끝난 행을 약 1초 뒤에 숨깁니다.",
      settings_prefer_song_mode: "곡이 바뀌면 '노래' 모드로 전환",
      settings_level_volume: "작은 곡·동영상의 음량을 올려 맞추기",
      settings_movie_lyrics: "동영상 모드에서 영상 위에 가사 표시",
      settings_movie_lyrics_desc: "영상을 전체 화면으로 보여 주고 가사를 오른쪽 아래에 겹쳐 표시합니다.",
      settings_movie_skip_scenes: "뮤직비디오의 노래가 아닌 장면 건너뛰기",
      settings_movie_skip_scenes_desc: "인트로 드라마 등 노래가 나오지 않는 장면을 건너뜁니다(로그인 시에만).",
      settings_close: "닫기",
      settings_tab_visuals: "표시",
      settings_tab_bg: "배경",
      settings_tab_lyrics: "가사",
      settings_tab_video: "동영상 및 PiP",
      settings_sec_timing: "타이밍",
      settings_sec_reading: "발음",
      settings_sec_movie: "동영상 모드",
      settings_search_placeholder: "설정 검색",
      settings_search_empty: "찾을 수 없습니다",
      settings_tab_sources: "가사 소스",
      settings_tab_translation: "번역",
      settings_tab_integrations: "연동",
      settings_sec_discord: "Discord",
      settings_discord_enabled: "Discord에 곡 정보 표시",
      settings_discord_desc: "LRCHub를 통해 곡명, 아티스트, 재생 상태와 현재 가사를 Discord에 표시합니다.",
      settings_discord_account: "LRCHub 계정",
      settings_discord_account_desc: "클라우드 동기화와 같은 복구 토큰을 사용합니다. 아직 설정하지 않았다면 여기에서 입력하세요.",
      settings_discord_token: "복구 토큰 설정",
      settings_discord_auth_title: "Discord 추가 권한",
      settings_discord_auth_desc: "처음에는 마이페이지의 ‘Discord에 연결’에서 추가 권한을 허용해야 합니다.",
      settings_discord_auth_link: "여기에서 추가 권한을 허용하세요",
      settings_discord_activity_note: "Discord의 활동 공유도 활성화하세요.",
      settings_discord_mypage: "마이페이지 열기",
      settings_discord_connection: "연결 테스트",
      settings_discord_check: "테스트하기",
      settings_discord_test_desc: "완료하지 않은 설정과 다음에 필요한 작업을 확인합니다.",
      settings_discord_setup_title: "연결 방법 및 링크",
      settings_discord_setup_desc: "처음에 한 번 필요한 준비입니다. 이미 설정한 항목은 건너뛰세요.",
      settings_discord_setup_account: "LRCHub 가입 및 로그인",
      settings_discord_setup_account_desc: "계정이 없다면 마이페이지에서 계정을 만드세요.",
      settings_discord_setup_account_link: "가입 / 로그인",
      settings_discord_setup_authorize: "Discord 추가 권한 허용",
      settings_discord_setup_authorize_desc: "마이페이지의 ‘Discord에 연결’에서 권한을 허용하세요.",
      settings_discord_setup_authorize_link: "추가 권한 허용",
      settings_discord_setup_token: "복구 토큰 저장",
      settings_discord_setup_token_desc: "LRCHub에 표시되는 토큰을 입력하세요. 클라우드 동기화용으로 저장했다면 생략해도 됩니다.",
      settings_discord_setup_play: "곡을 재생하고 연결 테스트",
      settings_discord_setup_play_desc: "위 토글을 켜고 곡을 재생한 다음 테스트로 설정이 완료되었는지 확인하세요.",
      settings_discord_test_title: "Discord 연결 테스트",
      settings_discord_test_off_help: "위 토글을 켠 다음 다시 테스트하세요.",
      settings_discord_test_token_help: "LRCHub 계정이 없다면 가입한 후 마이페이지의 복구 토큰을 이 확장 프로그램에 저장하세요.",
      settings_discord_test_invalid_token: "복구 토큰을 확인하지 못했습니다.",
      settings_discord_test_invalid_help: "LRCHub 마이페이지에서 복구 토큰을 다시 복사하여 저장하세요. 이 결과만으로 가입 여부를 판단할 수는 없습니다.",
      settings_discord_test_access_denied: "LRCHub에서 연결을 거부했습니다.",
      settings_discord_test_access_help: "마이페이지에서 복구 토큰과 Discord 연동을 확인한 후 다시 테스트하세요.",
      settings_discord_test_network_help: "서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 테스트하세요.",
      settings_discord_test_server: "LRCHub 중계 서버를 사용할 수 없습니다.",
      settings_discord_test_server_help: "서버 설정 또는 운영에 문제가 있습니다. 현재 설정을 변경하지 말고 잠시 후 다시 테스트하세요.",
      settings_discord_test_auth_help: "마이페이지의 ‘Discord에 연결’에서 추가 권한을 허용한 후 다시 테스트하세요.",
      settings_discord_test_reflection_help: "Discord로 업데이트를 전송하는 데 문제가 있습니다. 마이페이지의 연동을 확인하고 잠시 후 다시 테스트하세요.",
      settings_discord_test_stale: "재생 정보 업데이트가 끊겼습니다.",
      settings_discord_test_stale_help: "곡을 재생하고 몇 초 후 다시 테스트하세요. 해결되지 않으면 확장 프로그램과 YouTube Music을 다시 로드하세요.",
      settings_discord_test_play_help: "YouTube Music에서 곡을 재생하고 몇 초 후 테스트하세요.",
      settings_discord_test_not_received: "재생 중이지만 최신 재생 정보를 받지 못했습니다.",
      settings_discord_test_paused: "재생이 일시 정지되었습니다.",
      settings_discord_test_paused_help: "재생을 다시 시작하면 곡 정보가 업데이트됩니다. 재생을 재개한 후 다시 테스트하세요.",
      settings_discord_test_updated_help: "Discord 업데이트를 확인했습니다. 표시되지 않으면 Discord의 활동 공유 설정을 확인하세요.",
      settings_discord_test_received_help: "LRCHub로 재생 정보를 전송했습니다. Discord 업데이트에는 몇 초가 걸릴 수 있으니 잠시 후 다시 테스트하세요.",
      settings_discord_test_manual_note: "이 테스트에서는 Discord의 활동 공유 설정을 확인할 수 없습니다. Discord 설정에서도 활성화하세요.",
      settings_discord_test_feature: "기능 활성화",
      settings_discord_test_token: "복구 토큰",
      settings_discord_test_server_label: "LRCHub 연결",
      settings_discord_test_authorization: "Discord 추가 권한",
      settings_discord_test_playback: "재생 정보 수신",
      settings_discord_test_reflection: "Discord로 전송",
      settings_discord_test_ok: "확인됨",
      settings_discord_test_unknown: "확인되지 않음",
      settings_discord_test_pending: "확인 대기 중",
      settings_discord_test_token_stored: "저장됨 · 인증은 확인되지 않음",
      settings_discord_test_enable: "활성화",
      settings_discord_test_retry: "다시 테스트",
      settings_discord_test_play: "곡을 재생한 후 다시 테스트",
      settings_discord_test_ad: "광고 재생 중입니다.",
      settings_discord_test_ad_help: "곡 재생이 시작된 후 다시 테스트하세요.",
      settings_discord_status_unchecked: "연결 테스트를 아직 실행하지 않았습니다.",
      settings_discord_status_checking: "연결 테스트 중…",
      settings_discord_status_off: "Discord 연동이 꺼져 있습니다.",
      settings_discord_status_token: "복구 토큰을 먼저 설정하세요.",
      settings_discord_status_auth: "복구 토큰을 확인하고 마이페이지에서 Discord 추가 권한을 허용하세요.",
      settings_discord_status_failed: "연결 상태를 확인하지 못했습니다. 나중에 다시 시도하세요.",
      settings_discord_status_waiting: "재생 정보를 기다리고 있습니다. 곡을 재생한 후 다시 확인하세요.",
      settings_discord_status_received: "서버가 재생 정보를 수신했습니다. Discord 업데이트를 기다리고 있습니다.",
      settings_discord_status_updated: "Discord 업데이트를 확인했습니다.",
      settings_discord_status_reflection_error: "Discord 업데이트에 실패했습니다. 마이페이지의 연동과 활동 공유 설정을 확인하세요.",
      settings_tab_data: "데이터 및 초기화",
      settings_ui_scale: "UI 크기",
      settings_bg_brightness: "배경 밝기",
      settings_lyric_weight: "가사 굵기",
      settings_meaning_always: "가사 해설이 있으면 항상 표시",
      settings_sec_pip: "PiP(작은 창)",
      settings_pip_auto_open: "탭을 벗어나면 PiP 열기",
      settings_pip_auto_open_desc: "재생 중 다른 탭으로 이동하면 열리고 돌아오면 닫힙니다.",
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
      btn_video_quality: "画质",
      quality_auto: "自动",
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
      lyric_card_post_x: "发布到 X",
      lyric_card_post_credit: "{artist}的「{title}」",
      lyric_card_post_credit_title: "「{title}」",
      lyric_card_post_listen_at: "在 YouTube Music 上从这句歌词开始听{song}",
      lyric_card_post_listen: "在 YouTube Music 上收听{song}",
      lyric_card_copy_link: "复制链接",
      lyric_card_link_copied: "已复制",
      lyric_card_x_hint: "已复制图片。请在打开的发布页面中粘贴",
      lyric_card_x_hint_save: "无法复制图片。请保存后在发布页面中添加",
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
      settings_target_lang: "翻译成",
      settings_lang_auto: "自动",
      settings_trans_advanced: "高级设置",
      settings_shared_trans_desc: "LRCHub 上有译文的歌曲会优先使用该译文。",
      settings_deepl_desc: "填写后,没有共享译文的歌曲将改用 DeepL 而不是 Chrome 翻译。",
      settings_trans_desc_builtin: "没有共享译文的歌曲用 Chrome 翻译在本机翻译(歌词不会外发)。",
      settings_trans_desc_deepl: "没有共享译文的歌曲将用 DeepL 翻译。",
      settings_trans_desc_none: "此浏览器只显示共享译文。填写 DeepL API 密钥即可翻译其他歌曲。",
      trans_dl_prompt: "翻译这首歌需要 Chrome 的翻译数据(约 100–200MB)",
      trans_dl_button: "下载",
      trans_dl_progress: "正在下载翻译数据… {p}%",
      trans_dl_failed: "无法下载翻译数据",
      lyrics_trans_shared: "共享翻译",
      lyrics_trans_deepl: "DeepL 翻译",
      lyrics_trans_builtin: "Chrome 翻译",
      settings_save: "保存",
      settings_reset: "重置",
      menu_lyrics_title: "歌词",
      menu_read_local: "读取本地歌词文件",
      menu_add_sync: "为歌词添加时间",
      menu_other_sources: "从其他来源查找",
      menu_timing: "调整时间",
      menu_offset_earlier: "歌词提前",
      menu_offset_later: "歌词延后",
      menu_offset_reset: "重置为 0",
      menu_pick_other: "选择其他歌词",
      replay_restore: "恢复",
      replay_backup: "备份",
      replay_cloud: "云同步",
      settings_sync_offset: "歌词同步偏移",
      settings_sync_offset_save: "切歌时不重置偏移",
      settings_singer_colors: "将歌手颜色应用到歌词",
      settings_low_cpu_mode: "轻量模式 (停止背景动画)",
      settings_sec_display: "显示与布局",
      settings_sec_bg: "背景效果与性能",
      settings_sec_lyrics: "歌词样式与动画",
      settings_animated_captions: "使用动画字幕",
      settings_apple_bg: "使用 Apple Music 风格动态背景",
      settings_left_align: "标题与艺人名称左对齐",
      settings_bar_autohide: "自动隐藏播放栏",
      settings_bar_autohide_desc: "仅在鼠标靠近屏幕底部时显示。",
      settings_source_auto_title: "歌词来源",
      settings_source_auto_desc: "所选来源没有的歌曲会自动从其他来源查找。",
      settings_source_ytm: "优先 YouTube Music",
      settings_source_lrchub: "优先 LRC Hub",
      settings_source_wordsync: "优先逐字同步",
      settings_sec_source_priority: "优先方式",
      settings_sec_source_list: "使用的来源",
      settings_extra_providers: "逐个开关来源",
      settings_extra_providers_desc: "关闭的来源不会被连接。「额外来源」在打开时会请求 Chrome 权限。",
      settings_extra_providers_open: "在新标签页中打开",
      settings_extra_providers_reload: "扩展程序已更新。重新加载此页面后即可设置。",
      settings_apple_sync: "Apple Music 风格逐字同步",
      settings_korean_ruby: "显示韩语读音",
      settings_korean_ruby_desc: "在韩语歌词上方显示小号罗马字读音。",
      settings_keep_past_lyrics: "保留已播放的歌词",
      settings_lyric_stagger: "让歌词逐行弹性滚动",
      settings_lyric_stagger_desc: "每行稍有延迟地移动。",
      settings_fade_past_lyrics: "淡出已唱完的歌词",
      settings_fade_past_lyrics_desc: "已唱完的行约1秒后淡出。",
      settings_prefer_song_mode: "切换歌曲时自动切到「歌曲」模式",
      settings_level_volume: "调高音量较小的歌曲和视频，使音量一致",
      settings_movie_lyrics: "视频模式下在画面上显示歌词",
      settings_movie_lyrics_desc: "全屏显示视频，并在右下方叠加歌词。",
      settings_movie_skip_scenes: "跳过 MV 中非歌曲的场景",
      settings_movie_skip_scenes_desc: "跳过开头剧情等没有歌曲的场景(仅限登录时)。",
      settings_close: "关闭",
      settings_tab_visuals: "显示",
      settings_tab_bg: "背景",
      settings_tab_lyrics: "歌词",
      settings_tab_video: "视频与画中画",
      settings_sec_timing: "时间",
      settings_sec_reading: "读音",
      settings_sec_movie: "视频模式",
      settings_search_placeholder: "搜索设置",
      settings_search_empty: "没有找到",
      settings_tab_sources: "歌词来源",
      settings_tab_translation: "翻译",
      settings_tab_integrations: "关联",
      settings_sec_discord: "Discord",
      settings_discord_enabled: "在 Discord 显示歌曲信息",
      settings_discord_desc: "通过 LRCHub 在 Discord 显示歌曲、歌手、播放状态及当前歌词。",
      settings_discord_account: "LRCHub 账号",
      settings_discord_account_desc: "使用与云同步相同的恢复令牌。如果尚未设置，请在此输入。",
      settings_discord_token: "设置恢复令牌",
      settings_discord_auth_title: "Discord 额外授权",
      settings_discord_auth_desc: "首次使用时，请在个人主页选择“关联 Discord”并授予额外权限。",
      settings_discord_auth_link: "请在此授予额外权限",
      settings_discord_activity_note: "同时请开启 Discord 的活动分享。",
      settings_discord_mypage: "打开个人主页",
      settings_discord_connection: "连接测试",
      settings_discord_check: "开始测试",
      settings_discord_test_desc: "检查尚未完成的设置，并说明下一步操作。",
      settings_discord_setup_title: "使用方法与链接",
      settings_discord_setup_desc: "首次使用时需要完成以下准备，已设置的项目可以跳过。",
      settings_discord_setup_account: "注册并登录 LRCHub",
      settings_discord_setup_account_desc: "如果尚未注册，请从个人主页创建账号。",
      settings_discord_setup_account_link: "注册 / 登录",
      settings_discord_setup_authorize: "授予 Discord 额外权限",
      settings_discord_setup_authorize_desc: "在个人主页选择“关联 Discord”完成授权。",
      settings_discord_setup_authorize_link: "授予额外权限",
      settings_discord_setup_token: "保存恢复令牌",
      settings_discord_setup_token_desc: "输入 LRCHub 显示的令牌。如果已为云同步保存，则无需重复设置。",
      settings_discord_setup_play: "播放歌曲并测试连接",
      settings_discord_setup_play_desc: "开启上方开关并播放歌曲，然后通过连接测试确认设置是否完成。",
      settings_discord_test_title: "Discord 连接测试",
      settings_discord_test_off_help: "请开启上方开关，然后再次测试。",
      settings_discord_test_token_help: "如果尚未注册 LRCHub，请先注册，再将个人主页中的恢复令牌保存到此扩展程序。",
      settings_discord_test_invalid_token: "无法验证恢复令牌。",
      settings_discord_test_invalid_help: "请从 LRCHub 个人主页重新复制恢复令牌并保存。仅凭此结果无法判断是否已经注册。",
      settings_discord_test_access_denied: "LRCHub 拒绝了连接。",
      settings_discord_test_access_help: "请在个人主页检查恢复令牌和 Discord 关联，然后再次测试。",
      settings_discord_test_network_help: "无法连接服务器。请检查网络连接，稍后再次测试。",
      settings_discord_test_server: "LRCHub 中继服务不可用。",
      settings_discord_test_server_help: "服务器的配置或运行存在问题。请保持当前设置，稍后再次测试。",
      settings_discord_test_auth_help: "请在个人主页选择“关联 Discord”并授予额外权限，完成后再次测试。",
      settings_discord_test_reflection_help: "向 Discord 发送更新时出现问题。请检查个人主页中的关联，稍后再次测试。",
      settings_discord_test_stale: "播放信息更新已中断。",
      settings_discord_test_stale_help: "请播放歌曲，等待几秒后再次测试。如果仍未改善，请重新加载扩展程序和 YouTube Music。",
      settings_discord_test_play_help: "请在 YouTube Music 播放歌曲，等待几秒后测试。",
      settings_discord_test_not_received: "歌曲正在播放，但尚未收到最新播放信息。",
      settings_discord_test_paused: "播放已暂停。",
      settings_discord_test_paused_help: "恢复播放后会更新歌曲信息。请恢复播放，然后再次测试。",
      settings_discord_test_updated_help: "已确认 Discord 更新。如果仍未显示，请检查 Discord 的活动分享设置。",
      settings_discord_test_received_help: "播放信息已发送到 LRCHub。Discord 更新需要几秒，请稍等后再次测试。",
      settings_discord_test_manual_note: "此测试无法检查 Discord 的活动分享设置。请同时在 Discord 设置中开启。",
      settings_discord_test_feature: "启用功能",
      settings_discord_test_token: "恢复令牌",
      settings_discord_test_server_label: "LRCHub 连接",
      settings_discord_test_authorization: "Discord 额外授权",
      settings_discord_test_playback: "接收播放信息",
      settings_discord_test_reflection: "发送至 Discord",
      settings_discord_test_ok: "已确认",
      settings_discord_test_unknown: "未确认",
      settings_discord_test_pending: "等待确认",
      settings_discord_test_token_stored: "已保存，尚未验证认证",
      settings_discord_test_enable: "启用",
      settings_discord_test_retry: "再次测试",
      settings_discord_test_play: "播放歌曲后再次测试",
      settings_discord_test_ad: "正在播放广告。",
      settings_discord_test_ad_help: "请在歌曲开始播放后再次测试。",
      settings_discord_status_unchecked: "尚未执行连接测试。",
      settings_discord_status_checking: "正在测试连接…",
      settings_discord_status_off: "Discord 关联已关闭。",
      settings_discord_status_token: "请先设置恢复令牌。",
      settings_discord_status_auth: "请检查恢复令牌，并在个人主页授予 Discord 额外权限。",
      settings_discord_status_failed: "无法检查连接状态，请稍后重试。",
      settings_discord_status_waiting: "正在等待播放信息，请播放歌曲后再次检查。",
      settings_discord_status_received: "服务器已收到播放信息，正在等待 Discord 更新。",
      settings_discord_status_updated: "已确认 Discord 更新。",
      settings_discord_status_reflection_error: "Discord 更新失败，请检查个人主页中的关联及活动分享设置。",
      settings_tab_data: "数据与重置",
      settings_ui_scale: "界面大小",
      settings_bg_brightness: "背景亮度",
      settings_lyric_weight: "歌词粗细",
      settings_meaning_always: "有歌词解说时始终显示",
      settings_sec_pip: "画中画（小窗）",
      settings_pip_auto_open: "离开标签页时打开画中画",
      settings_pip_auto_open_desc: "播放时切换标签页即打开，返回后关闭。",
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
