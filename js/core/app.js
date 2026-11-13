(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core = VB.core || {};

  /* The manifest opens this same page twice: once as the docked panel (Full State) and
     once as a modeless window with ?view=window (Mini State). The flag is read before
     first paint and turned into a class on .app, so the compact copy never shows the
     sections that need a full-width dock. The body keeps its .windowMode class too,
     which hides those sections even if the script runs late. */
  var windowMode = false;
  try {
    windowMode = String(window.location.search || "").indexOf("view=window") >= 0;
    if (windowMode) document.body.className = (document.body.className ? document.body.className + " " : "") + "windowMode";
  } catch (eMode) { }

  /* One place decides the layout, so a state can also be switched at runtime.
     Everything else in the panel is layout-agnostic: the same ids and handlers are
     used by both states. */
  function applyLayout() {
    var mode = windowMode ? "mini" : "full";
    try {
      var app = document.querySelector(".app");
      if (app) {
        var cls = String(app.className || "").replace(/\bmode-(full|mini)\b/g, "").replace(/\s+/g, " ").replace(/^ | $/g, "");
        app.className = cls + " mode-" + mode;
        app.setAttribute("data-mode", mode);
      }
      document.body.setAttribute("data-mode", mode);
      document.documentElement.setAttribute("data-mode", mode);
    } catch (e) { }
    return mode;
  }
  applyLayout();

  core.isWindowMode = function () { return !!windowMode; };
  core.layoutMode = function () { return windowMode ? "mini" : "full"; };
  core.applyLayout = applyLayout;
  core.setWindowMode = function (flag) {
    windowMode = !!flag;
    try {
      document.body.className = String(document.body.className || "").replace(/\bwindowMode\b/g, "").replace(/\s+/g, " ").replace(/^ | $/g, "");
      if (windowMode) document.body.className = (document.body.className ? document.body.className + " " : "") + "windowMode";
    } catch (e) { }
    return applyLayout();
  };

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
    selection: null,
    shortcutStatusPath: "",
    settings: {
      pngLongSide: 1700,
      hideOriginal: false,
      warmDaemon: true,
      batchWorkers: 2,
      vectorizeShortcut: { ctrl: true, shift: true, alt: false, key: 186, code: 'Semicolon', label: 'Ctrl+Shift+Ç' },
      vx: {
        preset: "general", svgVersion: "svg_1_1", adobe: false, fixedSize: false,
        draw: "fill_shapes", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: true,
        curves: "all", lineFit: "medium", strokeWidth: 1, strokeFixed: true
      }
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

  /* js/admin-config.js lets an installer pre-set the panel. Its defaults are applied first
     and the user's own saved settings override them, so an untouched setting keeps following
     the admin's file across updates while anything the user changed stays theirs. */
  function applyAdminDefaults() {
    var admin = window.VBADMIN && window.VBADMIN.defaults;
    if (!admin || typeof admin !== "object") return;
    if (admin.pngLongSide !== undefined) {
      var png = parseInt(admin.pngLongSide, 10);
      if (isFinite(png)) state.settings.pngLongSide = png;
    }
    if (admin.hideOriginal !== undefined) state.settings.hideOriginal = !!admin.hideOriginal;
    if (admin.warmDaemon !== undefined) state.settings.warmDaemon = !!admin.warmDaemon;
    if (admin.batchWorkers !== undefined) {
      var bw = parseInt(admin.batchWorkers, 10);
      if (isFinite(bw) && bw >= 1) state.settings.batchWorkers = bw;
    }
    if (admin.lang === "pt" || admin.lang === "en") state.lang = admin.lang;
  }

  /* --- vectorizer.ai export settings --------------------------------------
     These are written to export-options.json, and the agent puts them into the
     site's own Download form before asking for the SVG. The preset names and
     their values are the site's (General purpose / Easy editing / Cutting). */
  var VX_PRESETS = {
    general: { draw: "fill_shapes", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: true },
    editing: { draw: "fill_shapes", stack: "stacked", group: "color", nativeShapes: true, gapFiller: false },
    cutting: { draw: "stroke_edges", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: false }
  };
  var VX_DEFAULTS = {
    preset: "general", svgVersion: "svg_1_1", adobe: false, fixedSize: false,
    draw: "fill_shapes", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: true,
    curves: "all", lineFit: "medium", strokeWidth: 1, strokeFixed: true
  };
  var VX_ENUMS = {
    preset: ["general", "editing", "cutting", "custom"],
    svgVersion: ["svg_1_1", "svg_1_0", "svg_tiny_1_2"],
    draw: ["fill_shapes", "stroke_shapes", "stroke_edges"],
    stack: ["cutouts", "stacked"],
    group: ["none", "color", "parent", "layer"],
    curves: ["all", "cubic"],
    lineFit: ["fine", "medium", "coarse"]
  };
  function vxEnum(key, value, fallback) {
    return VX_ENUMS[key].indexOf(String(value)) >= 0 ? String(value) : fallback;
  }
  function normalizeVx(raw) {
    var src = (raw && typeof raw === "object") ? raw : {};
    var o = {};
    for (var k in VX_DEFAULTS) { if (VX_DEFAULTS.hasOwnProperty(k)) o[k] = VX_DEFAULTS[k]; }
    o.preset = vxEnum("preset", src.preset, VX_DEFAULTS.preset);
    if (VX_PRESETS[o.preset]) {
      for (var p in VX_PRESETS[o.preset]) { if (VX_PRESETS[o.preset].hasOwnProperty(p)) o[p] = VX_PRESETS[o.preset][p]; }
    }
    if (src.draw !== undefined) o.draw = vxEnum("draw", src.draw, o.draw);
    if (src.stack !== undefined) o.stack = vxEnum("stack", src.stack, o.stack);
    if (src.group !== undefined) o.group = vxEnum("group", src.group, o.group);
    if (src.nativeShapes !== undefined) o.nativeShapes = !!src.nativeShapes;
    if (src.gapFiller !== undefined) o.gapFiller = !!src.gapFiller;
    o.svgVersion = vxEnum("svgVersion", src.svgVersion, VX_DEFAULTS.svgVersion);
    o.adobe = src.adobe === undefined ? VX_DEFAULTS.adobe : !!src.adobe;
    o.fixedSize = src.fixedSize === undefined ? VX_DEFAULTS.fixedSize : !!src.fixedSize;
    o.curves = vxEnum("curves", src.curves, VX_DEFAULTS.curves);
    o.lineFit = vxEnum("lineFit", src.lineFit, VX_DEFAULTS.lineFit);
    var sw = parseFloat(src.strokeWidth);
    o.strokeWidth = isFinite(sw) ? Math.max(0, Math.min(5, sw)) : VX_DEFAULTS.strokeWidth;
    o.strokeFixed = src.strokeFixed === undefined ? VX_DEFAULTS.strokeFixed : !!src.strokeFixed;
    /* Adobe compatibility emits only lines and cubic Béziers. */
    if (o.adobe) o.curves = "cubic";
    return o;
  }
  function setVxSelect(id, value) {
    var el = $(id);
    if (el) el.value = String(value);
  }
  function setVxCheck(id, value) {
    var el = $(id);
    if (el) el.checked = !!value;
  }

  /* Shared by the localStorage copy and the file the floating window reads. */
  function applyStoredSettings(s) {
    if (!s || typeof s !== "object") return;
    if (s.pngLongSide !== undefined) state.settings.pngLongSide = isFinite(parseInt(s.pngLongSide, 10)) ? parseInt(s.pngLongSide, 10) : 1700;
    if (s.hideOriginal !== undefined) state.settings.hideOriginal = !!s.hideOriginal;
    if (s.warmDaemon !== undefined) state.settings.warmDaemon = !!s.warmDaemon;
    if (s.batchWorkers !== undefined) { var bw = parseInt(s.batchWorkers, 10); if (isFinite(bw) && bw >= 1) state.settings.batchWorkers = bw; }
    if (s.vx) state.settings.vx = normalizeVx(s.vx);
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
  }

  /* v2.3.8 made warm Chrome and parallel pages the default. A settings copy saved
     by an older install would otherwise keep the old slow pair (cold Chrome, one
     item at a time) forever, so those two keys are re-seeded once. Anything the
     user changes afterwards is saved with the new version and never re-seeded. */
  var SETTINGS_VERSION = 2;
  function applyPerfDefaultsOnce(s) {
    var stored = parseInt(s && s.settingsVersion, 10) || 1;
    if (stored >= SETTINGS_VERSION) return;
    var admin = (window.VBADMIN && window.VBADMIN.defaults) || {};
    state.settings.warmDaemon = admin.warmDaemon !== undefined ? !!admin.warmDaemon : true;
    var bw = admin.batchWorkers !== undefined ? parseInt(admin.batchWorkers, 10) : 2;
    state.settings.batchWorkers = (isFinite(bw) && bw >= 1) ? bw : 2;
  }

  function loadSettings() {
    try {
      applyAdminDefaults();
      var raw = localStorage.getItem("vb_settings");
      if (raw) {
        var s = JSON.parse(raw);
        applyStoredSettings(s);
        applyPerfDefaultsOnce(s);
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
      state.settings.settingsVersion = SETTINGS_VERSION;
      localStorage.setItem("vb_settings", JSON.stringify(state.settings));
      localStorage.setItem("vb_lang", state.lang);
    } catch (e) { }
    pushSettingsToHost();
    pushExportOptionsToHost();
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
    var vx = normalizeVx(state.settings.vx);
    setVxSelect("vxPreset", vx.preset);
    setVxSelect("vxSvgVersion", vx.svgVersion);
    setVxSelect("vxGroup", vx.group);
    setVxSelect("vxStack", vx.stack);
    setVxSelect("vxDraw", vx.draw);
    setVxSelect("vxCurves", vx.curves);
    setVxSelect("vxLineFit", vx.lineFit);
    setVxCheck("vxAdobe", vx.adobe);
    setVxCheck("vxFixedSize", vx.fixedSize);
    setVxCheck("vxNativeShapes", vx.nativeShapes);
    setVxCheck("vxGapFiller", vx.gapFiller);
    setVxCheck("vxStrokeFixed", vx.strokeFixed);
    var swEl = $("vxStrokeWidth");
    if (swEl) swEl.value = String(vx.strokeWidth);
    /* Collapsed-settings summary, as in the V1 frame:
       "PNG long side: 1700px · Preset: General purpose". */
    var pill = $("settingsPill");
    if (pill) {
      var side = parseInt(state.settings.pngLongSide, 10);
      var sideText = (side === 0) ? t("pngPresetOriginal") : (side + "px");
      var presetKey = "vxPreset" + (vx.preset === "editing" ? "Editing" : vx.preset === "cutting" ? "Cutting" : vx.preset === "custom" ? "Custom" : "General");
      pill.textContent = t("settingsPillPng") + ": " + sideText + " · " + t("settingsPillPreset") + ": " + t(presetKey);
    }
  }

  /* Selection changes arrive from host/watch.jsx as CSXS events, so this only renders -
     nothing here asks Illustrator for state. */
  function renderSelection(info) {
    state.selection = info || null;
    var el = $("selectionText");
    if (!el) return;
    var doc = (info && info.doc) ? String(info.doc) : "";
    var n = (info && info.sel !== undefined && info.sel !== null) ? parseInt(info.sel, 10) : 0;
    if (!isFinite(n) || n < 0) n = 0;
    var text = "";
    if (!info || !info.open) text = t("selectionNoDoc") || "No document open";
    else if (n === 0) text = (t("selectionNothing") || "Nothing selected") + (doc ? " — " + doc : "");
    else text = (t("selectionCount") || "{count} selected").replace("{count}", String(n)) + (doc ? " — " + doc : "");
    el.textContent = text;
    el.className = "selection" + ((info && info.open && n > 0) ? " on" : "");
  }

  /* The panel and the floating window are two CEP extensions, and CEP scopes localStorage
     per extension, so their settings meet in Documents\VectorizerBridge\panel-settings.json
     through these host calls. */
  function pushSettingsToHost() {
    if (!VB.bridge || !VB.bridge.hostOk || !VB.bridge.evalJsx) return;
    try {
      var payload = JSON.stringify({ settings: state.settings, lang: state.lang });
      VB.bridge.evalJsx("VB.savePanelSettings(" + jsxString(payload) + ")", function () { });
    } catch (e) { }
  }

  /* The agent reads this file before each download, so the settings never have to
     be quoted through a command line. Both windows write the same choices. */
  function pushExportOptionsToHost() {
    if (!VB.bridge || !VB.bridge.hostOk || !VB.bridge.evalJsx) return;
    try {
      var vx = normalizeVx(state.settings.vx);
      state.settings.vx = vx;
      VB.bridge.evalJsx("VB.saveExportOptions(" + jsxString(JSON.stringify(vx)) + ")", function () { });
    } catch (e) { }
  }

  function syncSettingsFromHost(done) {
    if (!VB.bridge || !VB.bridge.hostOk || !VB.bridge.evalJsx) { if (done) done(false); return; }
    VB.bridge.evalJsx("VB.loadPanelSettings()", function (txt) {
      var applied = false;
      var wasWarm = !!state.settings.warmDaemon;
      var wasWorkers = state.settings.batchWorkers;
      try {
        var raw = String(txt || "");
        if (raw && raw.charAt(0) === "{") {
          var saved = JSON.parse(raw);
          var fileSettings = (saved && saved.settings) ? saved.settings : saved;
          applyStoredSettings(fileSettings);
          /* The file is the copy both windows agree on, so the one-time re-seed of the
             speed defaults has to reach it too. Without this an older panel-settings.json
             keeps warm Chrome and parallel workers off forever, no matter what the
             defaults or localStorage say. */
          var fileVersion = parseInt(fileSettings && fileSettings.settingsVersion, 10) || 1;
          if (fileVersion < SETTINGS_VERSION) {
            applyPerfDefaultsOnce({ settingsVersion: 0 });
            state.settings.settingsVersion = SETTINGS_VERSION;
            pushSettingsToHost();
          }
          if (saved && (saved.lang === "pt" || saved.lang === "en")) state.lang = saved.lang;
          applySettingsToUI();
          renderLocale();
          applied = true;
        }
      } catch (e) { }
      /* Settings can arrive after the panel already started a daemon from its own
         defaults; follow whatever they say now instead of leaving the two apart. */
      if (wasWarm !== !!state.settings.warmDaemon || wasWorkers !== state.settings.batchWorkers) {
        try {
          if (state.settings.warmDaemon) { if (VB.vectorizer && VB.vectorizer.ensureDaemonRunning) VB.vectorizer.ensureDaemonRunning(); }
          else if (VB.vectorizer && VB.vectorizer.stopWarmDaemon) VB.vectorizer.stopWarmDaemon();
        } catch (e2) { }
      }
      if (done) done(applied);
    });
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
  core.renderSelection = renderSelection; core.syncSettingsFromHost = syncSettingsFromHost;
  core.pushSettingsToHost = pushSettingsToHost;
  core.pushExportOptionsToHost = pushExportOptionsToHost;
  core.normalizeVx = normalizeVx;
  core.VX_PRESETS = VX_PRESETS;
  core.addHistory = addHistory; core.renderHistory = renderHistory; core.updateButtons = updateButtons;
  core.schedulePoll = schedulePoll; core.currentPollMs = currentPollMs;
  core.events = { on: busOn, off: busOff, emit: busEmit };
  core.shortcutLabel = shortcutLabel;
})();
