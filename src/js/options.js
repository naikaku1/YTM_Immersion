// 追加の歌詞サーバーの許可ページ。
//
// 通信先を manifest の host_permissions に書くと、更新のたびに Chrome が
// 「権限が増えたので無効化しました」を出して、利用者が再承認するまで
// 拡張ごと止まる。判定はホスト集合の差分なので、既にいくつ持っていても
// 新しい1つで増加になる。だから optional_host_permissions に置き、
// ここで chrome.permissions.request() を使って許可を取る。
//
// このページが要る理由: permissions.request() はユーザー操作を起点に、
// かつ拡張のページからしか呼べない。設定 UI は content script として
// YouTube Music のページに差し込んでいるので、そこからは呼べない。
//
// 通信先の定義は extra-providers.js を単一の出どころにする。
// ここで書き写すと、許可したホストと実際に叩くホストが食い違って
// 「許可したのに動かない」になる。
import { PROVIDER_IDS, PROVIDER_ORIGINS } from './module/extra-providers.js';

// namespace.js の辞書は content script のスコープに置かれた素の const で、
// 拡張のページからは読めない。ここで要るのは数行なので持たせる。
const TEXT = {
  ja: {
    title: '追加の歌詞サーバー',
    lead: '単語ごとに光る歌詞(文字同期)を持っている取得元です。' +
      '使うものだけ選んでください。オフのままなら通信しません。',
    privacy: '<strong>送るもの:</strong> 曲名・アーティスト名・曲の長さ。' +
      'LiriQo にはこれに加えて YouTube の動画IDを送ります。' +
      'アカウント情報や再生履歴は送りません。許可はいつでもここで取り消せます。',
    granted: '許可済み',
    denied: '許可されませんでした。',
    removed: '許可を取り消しました。',
    sharedWith: '{name} が同じ接続先を使っているので、そちらを切るまでは無効にできません。',
    saved: '許可しました。次に再生する曲から使われます。',
    providers: {
      kugou: {
        name: 'KuGou',
        desc: '対応している曲がいちばん広く、応答も速い。日本語の曲も単語同期で返ってくる。',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: '有志が手で打った単語同期(CC0)。当たれば質はいちばん高い。収録は3千曲ほど。' +
          '曲を割り出すのに NetEase の検索を使う。',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: '単語同期(yrc)を持っている曲があり、無い曲も行同期で返る。' +
          'AMLL と同じ検索を使うので、AMLL を許可するとこちらも一緒に有効になる。',
      },
      liriqo: {
        name: 'LiriQo',
        desc: 'Apple Music などを束ねた API。1曲あたり数秒かかるので、' +
          '他が見つけられなかった時だけ使う。',
      },
    },
  },
  en: {
    title: 'Extra lyrics sources',
    lead: 'These sources can return word-by-word synced lyrics. ' +
      'Turn on only the ones you want; the rest are never contacted.',
    privacy: '<strong>What is sent:</strong> track title, artist and track length. ' +
      'LiriQo also receives the YouTube video ID. ' +
      'No account details or listening history are sent. You can revoke access here at any time.',
    granted: 'Allowed',
    denied: 'Permission was not granted.',
    removed: 'Access revoked.',
    sharedWith: '{name} uses the same connection, so this stays on until you turn that off.',
    saved: 'Allowed. It will be used from the next song.',
    providers: {
      kugou: {
        name: 'KuGou',
        desc: 'The widest coverage and the fastest to answer. Returns word sync for Japanese songs too.',
      },
      amll: {
        name: 'AMLL TTML Database',
        desc: 'Hand-timed word sync from volunteers (CC0). The best quality when it has the song. ' +
          'About 3,000 songs. Uses NetEase search to identify the track.',
      },
      netease: {
        name: 'NetEase Cloud Music',
        desc: 'Word sync (yrc) for some songs, line sync for the rest. ' +
          'It shares its search with AMLL, so allowing AMLL turns this on as well.',
      },
      liriqo: {
        name: 'LiriQo',
        desc: 'An API bundling Apple Music and others. Takes a few seconds per song, ' +
          'so it is only used when nothing else found the lyrics.',
      },
    },
  },
};

// 表示に使うホスト名。許可ダイアログに出るものと揃える。
const hostLabel = (providerId) => PROVIDER_ORIGINS[providerId]
  .map(origin => origin.replace(/^https:\/\//, '').replace(/\/\*$/, ''))
  .join('  /  ');

const pickLang = async () => {
  try {
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['ytm_ui_lang'], res => {
        void chrome.runtime.lastError;
        resolve(res?.ytm_ui_lang || '');
      });
    });
    if (stored) return String(stored).startsWith('ja') ? 'ja' : 'en';
  } catch (e) { /* 読めなければ下のブラウザ設定で決める */ }
  const ui = (chrome.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase();
  return ui.startsWith('ja') ? 'ja' : 'en';
};

const contains = (origins) => new Promise(resolve => {
  chrome.permissions.contains({ origins }, granted => {
    void chrome.runtime.lastError;
    resolve(!!granted);
  });
});

const request = (origins) => new Promise(resolve => {
  chrome.permissions.request({ origins }, granted => {
    void chrome.runtime.lastError;
    resolve(!!granted);
  });
});

// 取り消しは、他の取得元がまだ使っているホストを巻き込まない。
// AMLL と NetEase はどちらも music.163.com を使うので、AMLL だけ切った時に
// NetEase まで動かなくなると分かりにくい。
//
// 逆に、AMLL が付いたままだと NetEase を切っても接続先は残る。
// 黙ってチェックが戻るだけだと理由が分からないので、誰が握っているかを返す。
const remove = async (providerId) => {
  const holders = new Map();
  for (const other of PROVIDER_IDS) {
    if (other === providerId) continue;
    if (!await contains(PROVIDER_ORIGINS[other])) continue;
    for (const origin of PROVIDER_ORIGINS[other]) {
      if (!holders.has(origin)) holders.set(origin, other);
    }
  }
  const origins = PROVIDER_ORIGINS[providerId].filter(origin => !holders.has(origin));
  const blockedBy = [...new Set(
    PROVIDER_ORIGINS[providerId].filter(origin => holders.has(origin)).map(origin => holders.get(origin)),
  )];
  if (!origins.length) return { removed: false, blockedBy };
  const removed = await new Promise(resolve => {
    chrome.permissions.remove({ origins }, ok => {
      void chrome.runtime.lastError;
      resolve(!!ok);
    });
  });
  return { removed, blockedBy };
};

const main = async () => {
  const lang = await pickLang();
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  document.title = `${t.title} — YTM-Immersion`;
  document.getElementById('title').textContent = t.title;
  document.getElementById('lead').textContent = t.lead;
  document.getElementById('note-privacy').innerHTML = t.privacy;

  const status = document.getElementById('status');
  const list = document.getElementById('providers');
  const boxes = new Map();

  // 並びは当たりやすい順。上から順に試したくなるように。
  const order = ['kugou', 'amll', 'netease', 'liriqo'];

  for (const id of order) {
    if (!PROVIDER_ORIGINS[id]) continue;
    const item = t.providers[id];

    const li = document.createElement('li');
    li.className = 'provider';

    const head = document.createElement('label');
    head.className = 'provider-head';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.provider = id;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    badge.textContent = t.granted;

    head.append(box, name, badge);

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = item.desc;

    const hosts = document.createElement('p');
    hosts.className = 'hosts';
    hosts.textContent = hostLabel(id);

    li.append(head, desc, hosts);
    list.append(li);
    boxes.set(id, { box, badge });

    box.addEventListener('change', async () => {
      box.disabled = true;
      if (box.checked) {
        const granted = await request(PROVIDER_ORIGINS[id]);
        box.checked = granted;
        status.textContent = granted ? t.saved : t.denied;
      } else {
        const { removed, blockedBy } = await remove(id);
        if (!removed && blockedBy.length) {
          const names = blockedBy.map(other => t.providers[other]?.name || other).join('・');
          status.textContent = t.sharedWith.replace('{name}', names);
        } else {
          status.textContent = t.removed;
        }
      }
      box.disabled = false;
      void refresh();
    });
  }

  const refresh = async () => {
    for (const [id, { box, badge }] of boxes) {
      const granted = await contains(PROVIDER_ORIGINS[id]);
      box.checked = granted;
      badge.hidden = !granted;
    }
  };

  // 別のタブや chrome://extensions から変えられることもある。
  chrome.permissions.onAdded.addListener(() => void refresh());
  chrome.permissions.onRemoved.addListener(() => void refresh());

  await refresh();
};

void main();
