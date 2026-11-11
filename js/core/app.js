(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core = VB.core || {};

  var POLL_MS_IDLE = 1200;
  var POLL_MS_ACTIVE = 400;
  var pollTimer = null;

  // Minimal event bus for queue <-> module decoupling
  var _listeners = {};
  function busOn(event, fn) { if (!event || !fn) return; (_listeners[event] = _listeners[event] || []).push(fn); }
  function busOff(event, fn) { var a = _listeners[event]; if (!a) return; for (var i = a.length - 1; i >= 0; i--) if (!fn || a[i] === fn) a.splice(i, 1); }
  function busEmit(event, data) { var a = _listeners[event] || []; for (var i = 0; i < a.length; i++) { try { a[i](data); } catch (e) { } } }

  function currentPollMs() {
    return (core.state && (core.state.waiting || core.state.login || core.state.busy)) ? POLL_MS_ACTIVE : POLL_MS_IDLE;
  }
  function schedulePoll(ms) {
    if (pollTimer) { try { clearTimeout(pollTimer); } catch (e) { } pollTimer = null; }
    pollTimer = setTimeout(function () {
      pollTimer = null;
      try { busEmit('poll:tick'); } catch (e) { }
      schedulePoll(currentPollMs());
    }, ms);
  }

  var state = {
    busy: false,
    waiting: false,
    login: false,
    loginKind: "",
    waitStartedAt: 0,
    lastStatusAt: 0,
    runStartedAt: 0,
    exportMs: 0,
    pngPath: "",
    union: null,
    docFullName: "",
    docName: "",
    lang: "en",
    history: [],
    daemon: { state: "unknown", busy: false },
    runToken: 0,
    bridgeFolder: "",
    batch: null,
    shortcutStatusPath: "",
    settings: {
      pngLongSide: 1700,
      hideOriginal: false,
      warmDaemon: false,
      batchWorkers: 1,
      vectorizeShortcut: { ctrl: true, shift: true, alt: false, key: 186, code: 'Semicolon', label: 'Ctrl+Shift+Ç' }
    }
  };

  function $(id) { return document.getElementById(id); }
  function on(el, event, fn) { if (el) el.addEventListener(event, fn, false); }
  function jsxString(value) { return JSON.stringify(String(value)); }
  function t(key) {
    var dict = (window.LOCALES && window.LOCALES[state.lang]) || (window.LOCALES && window.LOCALES.en) || {};
    return dict[key] !== undefined ? dict[key] : key;
  }
  function fmtElapsed(ms) {
    if (ms == null || ms < 0 || !isFinite(ms)) return "";
    if (ms < 1000) return ms + " ms";
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + " s";
    var m = Math.floor(s / 60);
    var rs = Math.round(s % 60);
    return m + "m " + rs + "s";
  }
  function runElapsedMs() { return state.runStartedAt ? (Date.now() - state.runStartedAt) : 0; }

  var lastStatusText = "";
  function setStatus(text) {
    var raw = String(text || "");
    if (raw === lastStatusText) return;
    lastStatusText = raw;
    var el = $("statusBar");
    if (el) el.textContent = raw;
    appendLogUI("[status] " + raw);
  }
  function setDetail(text) { var el = $("statusDetail"); if (el) el.textContent = text ? String(text) : ""; }
  function setRunTimerDetail(prefix) {
    var e = runElapsedMs();
    if (!e) return;
    var tstr = fmtElapsed(e);
    setDetail((prefix ? prefix + " · " : "") + "⏱ " + tstr);
  }
  function showError(message) {
    var box = $("jsError");
    if (box) { box.style.display = "block"; box.textContent = message; }
    appendLogUI("[error] " + String(message));
  }
  function appendLogUI(text) {
    var logEl = $("panelLog");
    if (!logEl) return;
    var line = document.createElement("div");
    line.className = "log-line";
    line.textContent = new Date().toLocaleTimeString() + " " + String(text);
    logEl.appendChild(line);
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function log(message) {
    var text = String(message);
    appendLogUI(text);
    if (VB.bridge && VB.bridge.logToHost) VB.bridge.logToHost(text);
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem("vb_settings");
      if (raw) {
        var s = JSON.parse(raw);
        if (s.pngLongSide !== undefined) state.settings.pngLongSide = isFinite(parseInt(s.pngLongSide, 10)) ? parseInt(s.pngLongSide, 10) : 1700;
        if (s.hideOriginal !== undefined) state.settings.hideOriginal = !!s.hideOriginal;
        if (s.warmDaemon !== undefined) state.settings.warmDaemon = !!s.warmDaemon;
        if (s.batchWorkers !== undefined) { var bw = parseInt(s.batchWorkers, 10); if (isFinite(bw) && bw >= 1) state.settings.batchWorkers = bw; }
        if (s.vectorizeShortcut && typeof s.vectorizeShortcut === 'object') {
          state.settings.vectorizeShortcut = {
            ctrl: s.vectorizeShortcut.ctrl !== false,
            shift: !!s.vectorizeShortcut.shift,
            alt: !!s.vectorizeShortcut.alt,
            key: parseInt(s.vectorizeShortcut.key, 10) || 186,
            code: s.vectorizeShortcut.code || 'Semicolon',
            label: s.vectorizeShortcut.label || 'Ctrl+Shift+Ç'
          };
        }
        var lang = localStorage.getItem("vb_lang");
        if (lang === "pt" || lang === "en") state.lang = lang;
      }
    } catch (e) { }
    if (state.settings.pngLongSide !== 0 && state.settings.pngLongSide < 100) state.settings.pngLongSide = 1700;
    if (state.settings.pngLongSide > 5000) state.settings.pngLongSide = 5000;
    if (!isFinite(state.settings.batchWorkers) || state.settings.batchWorkers < 1) state.settings.batchWorkers = 1;
    if (state.settings.batchWorkers > 4) state.settings.batchWorkers = 4;
    if (!state.settings.vectorizeShortcut) {
      state.settings.vectorizeShortcut = { ctrl: true, shift: true, alt: false, key: 186, code: 'Semicolon', label: 'Ctrl+Shift+Ç' };
    }
  }
  function saveSettings() {
    try {
      localStorage.setItem("vb_settings", JSON.stringify(state.settings));
      localStorage.setItem("vb_lang", state.lang);
    } catch (e) { }
  }
  function syncPngPresetUI() {
    var preset = $("settingsPngPreset");
    var png = $("settingsPngSize");
    if (!png) return;
    var raw = parseInt(state.settings.pngLongSide, 10);
    if (!isFinite(raw)) raw = 1700;
    if (raw < 0) raw = 1700;
    png.value = raw === 0 ? "" : raw;
    var matched = null;
    if (preset) {
      for (var i = 0; i < preset.options.length; i++) {
        if (preset.options[i].value !== "custom" && parseInt(preset.options[i].value, 10) === raw) { matched = preset.options[i].value; break; }
      }
      preset.value = matched || "custom";
    }
    png.style.display = (preset && preset.value === "custom") ? "" : "none";
  }
  function shortcutLabel(sc) {
    if (!sc) return 'Ctrl+Shift+Ç';
    if (sc.label) return sc.label;
    var parts = [];
    if (sc.ctrl) parts.push('Ctrl');
    if (sc.shift) parts.push('Shift');
    if (sc.alt) parts.push('Alt');
    var k = sc.code || '';
    if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
    else if (/^Digit[0-9]$/.test(k)) k = k.slice(5);
    else if (k === 'Semicolon') k = ';';
    else if (k === 'Comma') k = ',';
    else if (k === 'Period') k = '.';
    else if (k === 'Slash') k = '/';
    else if (k === 'BracketLeft') k = '[';
    else if (k === 'BracketRight') k = ']';
    else if (k === 'Backslash') k = '\\';
    else if (k === 'Quote') k = "'";
    else if (k === 'Minus') k = '-';
    else if (k === 'Equal') k = '=';
    else if (k === 'Backquote') k = '`';
    if (!k && sc.key) k = String.fromCharCode(sc.key);
    parts.push(k || '?');
    return parts.join('+');
  }

  function applySettingsToUI() {
    syncPngPresetUI();
    var hide = $("settingsHideOriginal");
    if (hide) hide.checked = !!state.settings.hideOriginal;
    var warm = $("settingsWarmDaemon");
    if (warm) warm.checked = !!state.settings.warmDaemon;
    var bw = $("settingsBatchWorkers");
    if (bw) bw.value = String(Math.max(1, Math.min(4, parseInt(state.settings.batchWorkers, 10) || 1)));
    var scInput = $("settingsVectorizeShortcut");
    if (scInput) scInput.value = shortcutLabel(state.settings.vectorizeShortcut);
  }
  function renderLocale() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      if (key) nodes[i].textContent = t(key);
    }
    var placeholders = document.querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < placeholders.length; j++) {
      placeholders[j].placeholder = t(placeholders[j].getAttribute("data-i18n-placeholder"));
    }
    var langBtn = $("langBtn");
    if (langBtn) langBtn.textContent = state.lang.toUpperCase();
    document.documentElement.lang = state.lang;
    renderHistory();
  }
  function toggleLanguage() { state.lang = state.lang === "en" ? "pt" : "en"; saveSettings(); renderLocale(); }

  function addHistory(action, file, ok, message) {
    state.history.unshift({ time: new Date().toLocaleTimeString(), action: action, file: file || "", ok: !!ok, msg: message || "" });
    if (state.history.length > 60) state.history.pop();
    renderHistory();
  }
  function renderHistory() {
    var el = $("historyList");
    if (!el) return;
    el.innerHTML = "";
    for (var i = 0; i < state.history.length && i < 8; i++) {
      var h = state.history[i];
      var d = document.createElement("div");
      d.className = "history-item " + (h.ok ? "ok" : "bad");
      d.textContent = (h.ok ? "\u2713 " : "\u2715 ") + h.time + " — " + t(h.action) + (h.file ? " (" + h.file + ")" : "") + (h.msg ? " — " + h.msg : "");
      el.appendChild(d);
    }
  }
  function updateButtons() {
    var hostOk = VB.bridge && VB.bridge.hostOk;
    var v = $("vectorizeBtn");
    if (v) v.disabled = !hostOk || state.busy || state.waiting || state.login;
    var s = $("signInBtn");
    if (s) s.disabled = !hostOk || state.busy || state.waiting || state.login;
    var c = $("cancelBtn");
    if (c) c.disabled = !(state.waiting || state.login || state.busy);
  }

  core.state = state;
  core.$ = $; core.on = on; core.jsxString = jsxString; core.t = t; core.fmtElapsed = fmtElapsed;
  core.runElapsedMs = runElapsedMs; core.setStatus = setStatus; core.setDetail = setDetail; core.setRunTimerDetail = setRunTimerDetail;
  core.showError = showError; core.appendLogUI = appendLogUI; core.log = log;
  core.loadSettings = loadSettings; core.saveSettings = saveSettings; core.syncPngPresetUI = syncPngPresetUI; core.applySettingsToUI = applySettingsToUI;
  core.renderLocale = renderLocale; core.toggleLanguage = toggleLanguage;
  core.addHistory = addHistory; core.renderHistory = renderHistory; core.updateButtons = updateButtons;
  core.schedulePoll = schedulePoll; core.currentPollMs = currentPollMs;
  core.events = { on: busOn, off: busOff, emit: busEmit };
  core.shortcutLabel = shortcutLabel;
})();
