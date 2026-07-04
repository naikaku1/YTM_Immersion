// ===================== Configuration Module =====================
// Handles all configuration management - extracted from original content.js

(function () {
  'use strict';

  // Configuration object - exactly as in original
  let config = {
    mode: true,  // Changed to match original default
    deepLKey: null,
    useTrans: true,
    useSharedTranslateApi: false,
    fastMode: false,
    mainLang: 'original',
    subLang: 'en',
    uiLang: 'ja',
    syncOffset: 0,
    saveSyncOffset: false,
    lyricWeight: 800,
    bgBrightness: 0.35,
    liquidGlass: true
  };

  // Configuration API
  const ConfigManager = {
    // Get configuration value
    get: (key) => {
      return config[key];
    },

    // Set configuration value
    set: (key, value) => {
      config[key] = value;
    },

    // Get all configuration
    getAll: () => {
      return { ...config };
    },

    // Update multiple configuration values
    update: (updates) => {
      Object.assign(config, updates);
    },

    // Load configuration from storage
    loadFromStorage: async () => {
      try {
        if (window.Storage && window.Storage.storage) {
          const deepLKey = await window.Storage.storage.get('ytm_deepl_key');
          if (deepLKey) config.deepLKey = deepLKey;
          
          const cachedTrans = await window.Storage.storage.get('ytm_trans_enabled');
          if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;
          
          const cachedSharedTrans = await window.Storage.storage.get('ytm_shared_trans_enabled');
          if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;
          
          const mainLangStored = await window.Storage.storage.get('ytm_main_lang');
          if (mainLangStored) config.mainLang = mainLangStored;
          
          const subLangStored = await window.Storage.storage.get('ytm_sub_lang');
          if (subLangStored) config.subLang = subLangStored;
          
          const uiLang = await window.Storage.storage.get('ytm_ui_lang');
          if (uiLang) config.uiLang = uiLang;

          const liquidGlass = await window.Storage.storage.get('ytm_liquid_glass');
          if (liquidGlass !== null && liquidGlass !== undefined) config.liquidGlass = !!liquidGlass;
        }
      } catch (storageError) {
        console.warn('[YTM Immersion] Storage access failed, using fallback:', storageError);
      }
    },

    // Save configuration to storage
    saveToStorage: async (key, value) => {
      try {
        if (window.Storage && window.Storage.storage) {
          await window.Storage.storage.set(key, value);
        }
      } catch (storageError) {
        console.warn('[YTM Immersion] Failed to save config:', storageError);
      }
    },

    // Apply visual settings
    applyVisualSettings: async () => {
      try {
        // 1. 歌詞の太さ
        const savedWeight = await window.Storage.storage.get('ytm_lyric_weight');
        if (savedWeight) {
          config.lyricWeight = savedWeight;
          document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
        }

        // 2. 背景の明るさ
        const savedBright = await window.Storage.storage.get('ytm_bg_brightness');
        if (savedBright) {
          config.bgBrightness = savedBright;
          document.documentElement.style.setProperty('--ytm-bg-brightness', savedBright);
        }

        const savedLiquidGlass = await window.Storage.storage.get('ytm_liquid_glass');
        if (savedLiquidGlass !== null && savedLiquidGlass !== undefined) {
          config.liquidGlass = !!savedLiquidGlass;
          window.LiquidGlassModule?.LiquidGlass?.setEnabled(!!savedLiquidGlass);
        }
      } catch (error) {
        console.warn('[YTM Immersion] Failed to apply visual settings:', error);
      }
    }
  };

  // Export for module system
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConfigManager };
  } else {
    window.ConfigModule = { ConfigManager };
  }

})();
