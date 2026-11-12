/* Vectorizer Bridge — panel bootstrap (modularized)
   Core shell: js/core/app.js
   Host bridge: js/bridge/host.js
   Queue/scheduler: js/queue/batch.js
   Vectorizer module: modules/vectorizer/vectorizer.js
*/
(function () {
  "use strict";

  function triggerVectorize() {
    try {
      var VB = window.VBPanel;
      if (VB && VB.queue && typeof VB.queue.vectorize === "function") VB.queue.vectorize();
    } catch (e) { }
  }

  function defaultShortcut() {
    return { ctrl: true, shift: true, alt: false, key: 186, code: 'Semicolon', label: 'Ctrl+Shift+Ç' };
  }
  function getShortcut() {
    try {
      var VB = window.VBPanel;
      var sc = VB && VB.core && VB.core.state && VB.core.state.settings && VB.core.state.settings.vectorizeShortcut;
      if (sc && typeof sc === 'object') return sc;
    } catch (e) { }
    return defaultShortcut();
  }

  function applyShortcutRegistration(cs) {
    try {
      var sc = getShortcut();
      var obj = { keyCode: parseInt(sc.key, 10) || 186, ctrlKey: !!sc.ctrl, shiftKey: !!sc.shift };
      if (sc.alt) obj.altKey = true;
      var keys = '[' + JSON.stringify(obj) + ']';
      if (cs && cs.registerKeyEventsInterest) cs.registerKeyEventsInterest(keys);
    } catch (e) { }
  }

  function matchesShortcut(ev) {
    var sc = getShortcut();
    var key = ev.keyCode || ev.which;
    var code = ev.code || '';
    var wantKey = parseInt(sc.key, 10) || 0;
    var keyMatch = (key === wantKey) || (sc.code && code && code === sc.code);
    // Fallback: compare printed key label character for layout-specific keys like Ç
    if (!keyMatch && sc.label) {
      var parts = String(sc.label).split('+');
      var last = parts.length ? parts[parts.length - 1] : '';
      if (last && ev.key && (ev.key === last || ev.key.toUpperCase() === last.toUpperCase())) keyMatch = true;
    }
    return !!keyMatch && !!ev.ctrlKey === !!sc.ctrl && !!ev.shiftKey === !!sc.shift && !!ev.altKey === !!sc.alt && !ev.metaKey;
  }

  function setupPanelIntegrations() {
    var VB = window.VBPanel;
    if (!VB || !VB.bridge || !VB.queue) {
      setTimeout(setupPanelIntegrations, 300);
      return;
    }
    var cs = (VB.bridge.getCS && VB.bridge.getCS()) || null;
    if (!cs) {
      setTimeout(setupPanelIntegrations, 300);
      return;
    }
    try {
      if (cs._vbIntegrationsReady) return;
      cs._vbIntegrationsReady = true;
    } catch (eFlag) { }

    // Panel flyout menu (visible only while panel is open)
    try {
      var menuXml = '<Menu><MenuItem Id="vbVectorize" Label="Vectorize selection" Enabled="true"/></Menu>';
      if (cs.setPanelFlyoutMenu) cs.setPanelFlyoutMenu(menuXml);
      if (cs.addEventListener) {
        cs.addEventListener("com.adobe.csxs.events.flyoutMenuClicked", function (event) {
          try {
            var id = event && event.data && (event.data.menuId || event.data.menuName);
            if (id === "vbVectorize") triggerVectorize();
          } catch (e) { }
        });
      }
    } catch (eMenu) { }

    // Keyboard shortcut (customizable, works only when this panel has focus)
    applyShortcutRegistration(cs);
    try {
      window.addEventListener("keydown", function (ev) {
        try {
          if (window._vbCapturingShortcut) return;
          if (matchesShortcut(ev)) {
            if (ev.preventDefault) ev.preventDefault();
            triggerVectorize();
          }
        } catch (e) { }
      }, false);
    } catch (eKey) { }

    // Selection changes are pushed from host/watch.jsx (CSXSEvent), so the UI follows the
    // canvas instead of asking Illustrator on a timer. Stopped when this panel unloads so a
    // closed panel leaves no scheduled task behind.
    try {
      if (cs.addEventListener) {
        cs.addEventListener("vb.selectionChanged", function (event) {
          var info = null;
          try { info = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch (e) { info = null; }
          if (window.VBPanel && VBPanel.core && VBPanel.core.renderSelection) VBPanel.core.renderSelection(info);
        });
      }
      cs.evalScript("VB.watch.start()", function () { });
      window.addEventListener("beforeunload", function () {
        try { cs.evalScript("VB.watch.stop()"); } catch (e) { }
      }, false);
    } catch (eWatch) { }

    // Settings live in Documents\VectorizerBridge\panel-settings.json so the panel and the
    // floating window (separate CEP extensions, separate localStorage) agree.
    syncSettingsFromHostWhenReady(0);

    VB.integrations = VB.integrations || {};
    VB.integrations.refreshShortcut = function () { applyShortcutRegistration((VB.bridge.getCS && VB.bridge.getCS()) || cs); };
    try { if (VB.core && VB.core.events && VB.core.events.on) VB.core.events.on('shortcut:changed', VB.integrations.refreshShortcut); } catch (eEv) { }
  }

  function syncSettingsFromHostWhenReady(attempt) {
    if (attempt > 40) return;
    var VB = window.VBPanel;
    if (VB && VB.core && VB.bridge && VB.bridge.hostOk) {
      try { VB.core.syncSettingsFromHost(); } catch (e) { }
      return;
    }
    setTimeout(function () { syncSettingsFromHostWhenReady(attempt + 1); }, 150);
  }

  function boot() {
    if (window.VBPanel && VBPanel.vectorizer && typeof VBPanel.vectorizer.init === "function") {
      VBPanel.vectorizer.init();
    }
    setupPanelIntegrations();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, false);
  } else {
    boot();
  }
})();
