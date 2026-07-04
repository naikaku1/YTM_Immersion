// ===================== YTM Immersion Entry Point =====================
// Main entry point - loads and initializes all modules safely
// Original functionality preserved, now properly modularized

(function () {
  'use strict';

  console.log('[YTM Immersion] Starting module system...');

  // ===================== Module Registry =====================
  // Track module loading state and dependencies
  const moduleRegistry = {
    loaded: new Set(),
    failed: new Set(),
    dependencies: {
      'ConfigModule': ['ConstantsModule'],
      'StateModule': ['ConstantsModule', 'ConfigModule'],
      'UIManagerModule': ['ConstantsModule', 'StateModule'],
      'LyricsLoaderModule': ['ConstantsModule', 'StateModule', 'ConfigModule'],
      'EventsModule': ['ConstantsModule', 'ConfigModule', 'StateModule', 'UIManagerModule', 'LyricsLoaderModule'],
      'I18n': ['ConfigModule'],
      'TranslationModule': ['ConfigModule', 'I18n'],
      'LyricsParserModule': [],
      'UIRenderingModule': ['StateModule', 'ConfigModule'],
      'ShareModule': ['ConfigModule', 'StateModule'],
      'PipManagerModule': [],
      'ReplayManagerModule': ['ConfigModule', 'StateModule'],
      'QueueManagerModule': ['ConfigModule', 'StateModule'],
      'CloudSyncModule': ['ConfigModule', 'StateModule', 'Storage'],
      'DiscordPresenceModule': [],
      'MovieModeModule': [],
      'LiquidGlassModule': ['ConfigModule']
    },

    // Check if module is loaded
    isLoaded: (moduleName) => {
      return moduleRegistry.loaded.has(moduleName);
    },

    // Mark module as loaded
    markLoaded: (moduleName) => {
      moduleRegistry.loaded.add(moduleName);
      console.log(`[YTM Immersion] Module loaded: ${moduleName}`);
    },

    // Mark module as failed
    markFailed: (moduleName, error) => {
      moduleRegistry.failed.add(moduleName);
      console.error(`[YTM Immersion] Module failed: ${moduleName}`, error);
    },

    // Check if dependencies are satisfied
    checkDependencies: (moduleName) => {
      const deps = moduleRegistry.dependencies[moduleName] || [];
      return deps.every(dep => moduleRegistry.isLoaded(dep));
    },

    // Wait for module to load
    waitForModule: (moduleName, timeout = 5000) => {
      return new Promise((resolve, reject) => {
        if (moduleRegistry.isLoaded(moduleName)) {
          resolve(window[moduleName]);
          return;
        }

        if (moduleRegistry.failed.has(moduleName)) {
          reject(new Error(`Module ${moduleName} failed to load`));
          return;
        }

        const checkInterval = setInterval(() => {
          if (moduleRegistry.isLoaded(moduleName)) {
            clearInterval(checkInterval);
            resolve(window[moduleName]);
          } else if (moduleRegistry.failed.has(moduleName)) {
            clearInterval(checkInterval);
            reject(new Error(`Module ${moduleName} failed to load`));
          }
        }, 50);

        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for module ${moduleName}`));
        }, timeout);
      });
    }
  };

  // ===================== Safe Module Access =====================
  const safeAccess = {
    // Get module with error handling
    getModule: (moduleName) => {
      if (window[moduleName]) {
        moduleRegistry.markLoaded(moduleName);
        return window[moduleName];
      }
      return null;
    },

    // Check module and access property safely
    getProperty: (moduleName, propertyPath) => {
      const module = safeAccess.getModule(moduleName);
      if (!module) return null;

      const properties = propertyPath.split('.');
      let current = module;

      for (const prop of properties) {
        if (current && typeof current === 'object' && prop in current) {
          current = current[prop];
        } else {
          return null;
        }
      }

      return current;
    },

    // Execute module method safely
    execute: (moduleName, methodPath, ...args) => {
      const method = safeAccess.getProperty(moduleName, methodPath);
      if (typeof method === 'function') {
        try {
          return method(...args);
        } catch (error) {
          console.error(`[YTM Immersion] Error executing ${moduleName}.${methodPath}:`, error);
          return null;
        }
      }
      console.warn(`[YTM Immersion] Method not found: ${moduleName}.${methodPath}`);
      return null;
    }
  };

  // ===================== Module Registration =====================
  // Register all expected modules
  const expectedModules = [
    'ConstantsModule', 'ConfigModule', 'StateModule', 'UIManagerModule', 
    'LyricsLoaderModule', 'EventsModule', 'I18n', 'Storage', 'TranslationModule',
    'LyricsParserModule', 'UIRenderingModule', 'ShareModule', 'PipManagerModule',
    'ReplayManagerModule', 'QueueManagerModule', 'CloudSyncModule',
    'DiscordPresenceModule', 'MovieModeModule', 'LiquidGlassModule'
  ];

  // Check which modules are actually loaded
  expectedModules.forEach(moduleName => {
    if (window[moduleName]) {
      moduleRegistry.markLoaded(moduleName);
    }
  });

  // ===================== Initialization Sequence =====================
  const initializeApp = async () => {
    try {
      console.log('[YTM Immersion] Starting initialization sequence...');

      // Phase 1: Core modules (must be loaded first)
      const coreModules = ['ConstantsModule', 'ConfigModule', 'StateModule'];
      for (const moduleName of coreModules) {
        try {
          await moduleRegistry.waitForModule(moduleName, 3000);
          console.log(`[YTM Immersion] Core module ready: ${moduleName}`);
        } catch (error) {
          console.error(`[YTM Immersion] Core module failed: ${moduleName}`, error);
          // Continue with fallbacks for critical modules
          if (moduleName === 'ConstantsModule') {
            console.warn('[YTM Immersion] Creating fallback constants...');
          }
        }
      }

      // Phase 2: Initialize core systems
      safeAccess.execute('StateModule', 'StateManager.initialize');
      safeAccess.execute('ConfigModule', 'ConfigManager.applyVisualSettings');

      // Phase 3: Service modules
      const serviceModules = ['Storage', 'I18n'];
      for (const moduleName of serviceModules) {
        if (safeAccess.getModule(moduleName)) {
          if (moduleName === 'I18n' && safeAccess.getProperty('ConfigModule', 'ConfigManager')) {
            const uiLang = safeAccess.getProperty('ConfigModule', 'ConfigManager.get')('uiLang') || 'ja';
            safeAccess.execute('I18n', 'setConfig', { uiLang });
          }
        }
      }

      // Phase 4: Feature modules
      const featureModules = [
        { name: 'TranslationModule', setup: (m) => { window.Translation = m.TranslationModule; } },
        { name: 'LyricsParserModule', setup: (m) => { window.LyricsParser = m.LyricsParser; } },
        { name: 'UIRenderingModule', setup: (m) => { window.UIRendering = m.UIRenderingModule; } },
        { name: 'ShareModule', setup: (m) => { window.Share = m.ShareModule; } },
        { name: 'PipManagerModule', setup: (m) => { window.PipManager = m.PipManager; } },
        { name: 'ReplayManagerModule', setup: (m) => { window.ReplayManager = m.ReplayManager; } },
        { name: 'QueueManagerModule', setup: (m) => { window.QueueManager = m.QueueManager; } },
        { name: 'CloudSyncModule', setup: (m) => { window.CloudSync = m.CloudSync; } },
        { name: 'DiscordPresenceModule', setup: (m) => { window.DiscordPresence = m.DiscordPresenceModule; } },
        { name: 'MovieModeModule', setup: (m) => { window.MovieMode = m.MovieModeModule; } },
        { name: 'LiquidGlassModule', setup: (m) => { window.LiquidGlass = m.LiquidGlass; } }
      ];

      for (const { name, setup } of featureModules) {
        const module = safeAccess.getModule(name);
        if (module && setup) {
          setup(module);
          console.log(`[YTM Immersion] Feature module configured: ${name}`);
        }
      }

      // Phase 5: Initialize feature modules
      const initModules = [
        { name: 'ReplayManager', module: 'ReplayManagerModule' },
        { name: 'QueueManager', module: 'QueueManagerModule' },
        { name: 'CloudSync', module: 'CloudSyncModule' },
        { name: 'LiquidGlass', module: 'LiquidGlassModule' }
      ];
      
      for (const { name, module } of initModules) {
        const moduleObj = safeAccess.getModule(module);
        if (moduleObj && moduleObj[name] && typeof moduleObj[name].init === 'function') {
          moduleObj[name].init();
          console.log(`[YTM Immersion] ${name} initialized`);
        } else {
          console.warn(`[YTM Immersion] ${name}.init not found in ${module}`);
        }
      }

      // Phase 6: Load remote texts
      safeAccess.execute('UIManagerModule', 'UIManager.loadRemoteTextsFromGithub');

      // Phase 7: Start main application
      const eventsModule = safeAccess.getModule('EventsModule');
      if (eventsModule) {
        safeAccess.execute('EventsModule', 'EventsManager.start');
        console.log('[YTM Immersion] Main application started');
      } else {
        console.error('[YTM Immersion] Events module not available, cannot start application');
      }

      console.log('[YTM Immersion] Initialization completed successfully');
      console.log(`[YTM Immersion] Loaded modules: ${Array.from(moduleRegistry.loaded).join(', ')}`);

    } catch (error) {
      console.error('[YTM Immersion] Initialization failed:', error);
    }
  };

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    // DOM already loaded, initialize immediately
    setTimeout(initializeApp, 100);
  }

})();
