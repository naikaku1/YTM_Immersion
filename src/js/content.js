  Promise.resolve(runtimeSettingsReady).then(() => {
    setupObserver();
    startLyricRafLoop();
    hoverTimeInfoSetup();
  });
