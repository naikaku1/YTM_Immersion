// background.js を import 行抜きで vm に読ませる模擬環境の共通部分。
// 取得元(API / Extra / Sources)や chrome.runtime.onMessage の受け口は
// テストごとに違うので各自で渡し、ここでは「歌詞の取得とは関係ないが、
// 読み込んだ瞬間に呼ばれるもの」だけを埋める。
// 背景にモジュールが増えて import が増えたら、偽物はここに足す。
import fs from 'node:fs'
import vm from 'node:vm'

export const backgroundSource = fs.readFileSync(
  new URL('../src/js/background.js', import.meta.url),
  'utf8',
).replace(/^import .*?;\r?$/gm, '')

const noopListener = () => ({ addListener() {} })

// Discord 連携(bg-now-playing.js / bg-now-playing-poll.js)の偽物。
// 背景は読み込み時に restore() を呼び、onChanged / onRemoved から残りを呼ぶ。
// 何も送らず、何も覚えない。
function createNowPlayingRelay() {
  return {
    update: async () => ({ ok: true }),
    clear: async () => ({ ok: true }),
    status: async () => ({ ok: true }),
    disable: async () => undefined,
    removeTab: async () => undefined,
    credentialsChanged: async () => undefined,
  }
}

function createNowPlayingPoller() {
  return {
    restore: async () => undefined,
    refreshSettings: async () => undefined,
    ownerChanged() {},
    removeTab() {},
    status: () => ({ enabled: false, owner: null, polling: false, inFlight: false }),
  }
}

// テストの chrome に、背景が読み込み時に登録する受け口が無ければ足す。
function withBackgroundEvents(chrome = {}) {
  const runtime = { lastError: null, onInstalled: noopListener(), ...chrome.runtime }
  const storage = { local: { get() {}, set() {} }, onChanged: noopListener(), ...chrome.storage }
  const tabs = { onRemoved: noopListener(), ...chrome.tabs }
  return { ...chrome, runtime, storage, tabs }
}

export function runBackground(context) {
  vm.runInNewContext(backgroundSource, {
    createNowPlayingRelay,
    createNowPlayingPoller,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch,
    self: { addEventListener() {} },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    ...context,
    chrome: withBackgroundEvents(context.chrome),
  }, { filename: 'src/js/background.js' })
}
