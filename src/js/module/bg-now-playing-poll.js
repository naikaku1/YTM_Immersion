// Page timers are throttled when YouTube Music is hidden or Chrome is covered.
// Ask for fresh media-clock snapshots from the extension worker instead. The
// alarm restores this small active-playback loop after a worker restart.
export const NOW_PLAYING_WATCHDOG_ALARM = 'ytm-now-playing-watchdog';

const normalizeOwner = value => value && Number.isInteger(value.tabId) ? {
  tabId: value.tabId,
  documentId: typeof value.documentId === 'string' ? value.documentId : '',
  sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
  isPlaying: value.isPlaying === true,
} : null;

const sameTarget = (a, b) => a?.tabId === b?.tabId &&
  a?.documentId === b?.documentId && a?.sessionId === b?.sessionId;

export function createNowPlayingPoller({
  api,
  loadState,
  intervalMs = 1000,
  responseTimeoutMs = 5000,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
}) {
  let enabled = false;
  let owner = null;
  let timer = null;
  let request = null;
  let disposed = false;
  let stateEpoch = 0;
  let ownerRevision = 0;
  let discoveryEpoch = 0;
  let failures = 0;

  const readLastError = () => api.runtime?.lastError;
  const canPoll = () => !disposed && enabled && !!owner?.isPlaying && failures < 3;
  const cancelTimer = () => {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  };
  const cancelRequest = () => {
    if (request) clearTimeoutImpl(request.timeout);
    request = null;
  };
  const arm = () => {
    if (!canPoll() || timer !== null || request) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      pollOwner();
    }, intervalMs);
  };
  const reconcileLoop = () => {
    if (!canPoll()) { cancelTimer(); cancelRequest(); return; }
    arm();
  };

  const pollOwner = (allowPaused = false) => {
    if (disposed || !enabled || !owner || request || (!allowPaused && !owner.isPlaying)) return;
    cancelTimer();
    const target = owner;
    const current = { timeout: null };
    request = current;
    const finish = failed => {
      // A late callback from a removed/paused/previous document cannot unlock
      // or reschedule the request currently belonging to another document.
      if (request !== current) return;
      clearTimeoutImpl(current.timeout);
      request = null;
      failures = failed ? failures + 1 : 0;
      arm();
    };
    current.timeout = setTimeoutImpl(() => finish(true), responseTimeoutMs);
    const options = target.documentId
      ? { documentId: target.documentId, frameId: 0 }
      : { frameId: 0 };
    try {
      api.tabs.sendMessage(target.tabId, { type: 'NOW_PLAYING_POLL' }, options, response => {
        // Reading the error also prevents noisy unchecked runtime.lastError
        // messages when a tab navigates or a content script is being replaced.
        const error = readLastError();
        finish(!!error || response?.ok !== true);
      });
    } catch (_) { finish(true); }
  };

  const ensureAlarm = () => new Promise(resolve => {
    if (!api.alarms) { resolve(); return; }
    if (!enabled || disposed) {
      try { api.alarms.clear(NOW_PLAYING_WATCHDOG_ALARM, () => { readLastError(); resolve(); }); }
      catch (_) { resolve(); }
      return;
    }
    try {
      api.alarms.get(NOW_PLAYING_WATCHDOG_ALARM, alarm => {
        const error = readLastError();
        if (!error && !alarm && enabled && !disposed) {
          try {
            const created = api.alarms.create(NOW_PLAYING_WATCHDOG_ALARM, {
              delayInMinutes: 0.5,
              periodInMinutes: 0.5,
            });
            if (created?.catch) created.catch(() => {});
          } catch (_) { /* A running loop can still observe active playback. */ }
        }
        resolve();
      });
    } catch (_) { resolve(); }
  });

  const discover = () => {
    if (disposed || !enabled || owner) return;
    const epoch = ++discoveryEpoch;
    try {
      api.tabs.query({ url: 'https://music.youtube.com/*' }, tabs => {
        const error = readLastError();
        if (error || disposed || !enabled || owner || epoch !== discoveryEpoch) return;
        for (const tab of tabs || []) {
          if (!Number.isInteger(tab.id)) continue;
          try {
            api.tabs.sendMessage(tab.id, { type: 'NOW_PLAYING_POLL' }, { frameId: 0 }, () => { readLastError(); });
          } catch (_) { /* A closing tab will not provide a fresh observation. */ }
        }
      });
    } catch (_) { /* No page exists yet. The next alarm may discover one. */ }
  };

  const restore = async () => {
    if (disposed) return;
    const epoch = ++stateEpoch;
    const revision = ownerRevision;
    let state;
    try { state = await loadState(); }
    catch (_) { return; }
    if (disposed || epoch !== stateEpoch) return;
    enabled = state?.enabled === true;
    // An already-arrived playback update is newer than this storage read.
    if (revision === ownerRevision) owner = normalizeOwner(state?.owner);
    reconcileLoop();
    await ensureAlarm();
    if (disposed || epoch !== stateEpoch || !enabled) return;
    if (!owner) discover();
  };

  const alarmListener = alarm => {
    if (alarm?.name !== NOW_PLAYING_WATCHDOG_ALARM || disposed) return;
    void restore().then(() => {
      // A paused owner gets a single observation too, so a missed media play
      // event can restart fast polling. No cached data is posted to the server.
      if (!disposed && enabled && owner) pollOwner(true);
    });
  };
  api.alarms?.onAlarm?.addListener(alarmListener);

  return {
    restore,
    refreshSettings: restore,
    ownerChanged(value) {
      if (disposed) return;
      const next = normalizeOwner(value);
      ownerRevision += 1;
      discoveryEpoch += 1;
      const changedTarget = !sameTarget(owner, next);
      const changedPlayback = owner?.isPlaying !== next?.isPlaying;
      owner = next;
      // This hook is called only with freshly observed playback, so it can
      // restart a loop that backed off after a crashed or unreachable page.
      failures = 0;
      if (changedTarget || changedPlayback) { cancelTimer(); cancelRequest(); }
      reconcileLoop();
    },
    removeTab(tabId) {
      if (owner?.tabId !== tabId) return;
      ownerRevision += 1;
      owner = null;
      failures = 0;
      cancelTimer();
      cancelRequest();
    },
    async stop() {
      disposed = true;
      enabled = false;
      stateEpoch += 1;
      discoveryEpoch += 1;
      cancelTimer();
      cancelRequest();
      api.alarms?.onAlarm?.removeListener?.(alarmListener);
      await ensureAlarm();
    },
    getState() {
      return { enabled, owner: owner ? { ...owner } : null, polling: timer !== null || !!request, inFlight: !!request };
    },
  };
}
