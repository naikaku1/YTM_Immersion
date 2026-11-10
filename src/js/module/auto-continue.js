// 「再生が一時停止されました。再開しますか?」を自動で「はい」にする(設定「一時停止の確認を自動で閉じる」、初期はオフ)。
//
// YouTube Music は、しばらく操作が無いと再生を止めて確認を出す
// (英語では "Are you still listening?")。放っておくと曲が止まったままになるので、
// 出てきた確認の「はい」を代わりに押す。
//
// 確認は ytmusic-popup-container の中に ytmusic-you-there-renderer として出る。
// YTM は画面の作りをたびたび変えるので、
//  - 確認そのものは要素名(ytmusic-you-there-renderer)で見つける。文言は言語で変わるので見ない
//  - 「はい」は、確認の中の決定ボタン → 青いボタン → 最初のボタン、の順に探す
// 見えていない確認(閉じた後に残っている要素)には触らない。
//
// 見張りは CHECK_INTERVAL_MS ごとに querySelector を 1 回するだけ。確認が無い間は何もしない。
// 押した後は COOLDOWN_MS の間、同じ確認を押し直さない(閉じるアニメーション中の二重押し防止)。
const AutoContinue = (() => {
  const STORAGE_KEY = 'ytm_auto_continue';
  const CHECK_INTERVAL_MS = 2000;
  const COOLDOWN_MS = 5000;
  const DIALOG_SELECTOR = 'ytmusic-you-there-renderer';
  const BUTTON_SELECTORS = [
    '#confirm-button button',
    '#confirm-button',
    '.style-blue-text button',
    'yt-button-renderer button',
    'button',
  ];

  let enabled = false;
  let timer = null;
  let lastClickAt = 0;

  // 確認が画面に出ているか。閉じた後も要素は残るので、外側のダイアログの状態を見る。
  const isVisible = (dialog) => {
    if (!dialog || !dialog.isConnected) return false;
    const holder = dialog.closest('tp-yt-paper-dialog, tp-yt-iron-dropdown') || dialog;
    if (holder.getAttribute('aria-hidden') === 'true') return false;
    if (holder.style && holder.style.display === 'none') return false;
    return true;
  };

  const findButton = (dialog) => {
    for (const selector of BUTTON_SELECTORS) {
      const el = dialog.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  // 1 回の見張り。押したら true。
  const tick = (now = Date.now()) => {
    if (!enabled) return false;
    if (now - lastClickAt < COOLDOWN_MS) return false;
    const dialog = document.querySelector(DIALOG_SELECTOR);
    if (!isVisible(dialog)) return false;
    const button = findButton(dialog);
    if (!button) return false;
    lastClickAt = now;
    button.click();
    return true;
  };

  const apply = () => {
    if (enabled && !timer) {
      timer = setInterval(() => { tick(); }, CHECK_INTERVAL_MS);
    } else if (!enabled && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    STORAGE_KEY,
    isEnabled: () => enabled,
    setEnabled: (on) => {
      enabled = !!on;
      apply();
    },
    // 保存値を読んで当てる
    load: async () => {
      try {
        const v = await storage.get(STORAGE_KEY);
        enabled = v === true;
      } catch (e) { enabled = false; }
      apply();
    },
    _tick: tick,
  };
})();
