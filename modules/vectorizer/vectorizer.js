(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var bridge = VB.bridge || (VB.bridge = {});
  var queue = VB.queue || (VB.queue = {});
  var vectorizer = VB.vectorizer = VB.vectorizer || {};

  var daemonPollTimer = null;

  function fmtFileTime(ms) {
    if (!ms) return '';
    try { var d = new Date(ms); return d.toLocaleString(); } catch (e) { return ''; }
  }
  function fmtFileSize(b) {
    b = parseInt(b, 10) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    return (b/(1024*1024)).toFixed(1) + ' MB';
  }

  function renderSvgHistory(files) {
    var el = core.$("svgHistoryList");
    if (!el) return;
    el.innerHTML = '';
    if (!files || !files.length) {
      var empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = core.t('svgHistoryEmpty') || 'No saved SVGs yet.';
      el.appendChild(empty);
      return;
    }
    for (var i = 0; i < files.length && i < 20; i++) (function (f) {
      var row = document.createElement('div');
      row.className = 'svg-history-item';
      var meta = document.createElement('div'); meta.className = 'svg-history-meta';
      var name = document.createElement('div'); name.className = 'svg-history-name'; name.textContent = f.name || '';
      var sub = document.createElement('div'); sub.className = 'svg-history-sub';
      sub.textContent = [fmtFileTime(f.modified), fmtFileSize(f.size)].filter(Boolean).join(' · ');
      meta.appendChild(name); meta.appendChild(sub);
      var actions = document.createElement('div'); actions.className = 'svg-history-actions';
      var openBtn = document.createElement('button'); openBtn.className = 'btn small'; openBtn.textContent = core.t('openSvg') || 'Open file'; openBtn.title = f.path || '';
      core.on(openBtn, 'click', function () { if (bridge.hostOk) bridge.evalJsx('VB.revealFile ? VB.revealFile(' + core.jsxString(f.path || '') + ') : VB.openFolder(' + core.jsxString(f.path || '') + ')'); });
      var placeBtn = document.createElement('button'); placeBtn.className = 'btn small'; placeBtn.textContent = core.t('placeSvg') || 'Place';
      core.on(placeBtn, 'click', function () {
        if (!bridge.hostOk) return;
        core.setStatus(core.t('statusPlacing'));
        var payload = { svgPath: f.path || '', layerName: 'Vectorizer', hideOriginal: false, allowAnyDoc: true };
        bridge.evalJsx('VB.placeSVG(' + core.jsxString(encodeURIComponent(JSON.stringify(payload))) + ')', function (res) {
          var r = bridge.parseResult(res);
          if (r.ok) { core.setStatus(core.t('statusPlaced')); core.addHistory('placed', f.name || '', true, 'from history'); try { refreshSvgHistory(); } catch (e) {} }
          else { core.setStatus(core.t('statusPlaceFailed') + ' ' + bridge.friendlyError(r.error)); }
        });
      });
      actions.appendChild(openBtn); actions.appendChild(placeBtn);
      row.appendChild(meta); row.appendChild(actions);
      el.appendChild(row);
    })(files[i]);
  }
  function refreshSvgHistory() {
    if (!bridge.hostOk) return;
    bridge.evalJsx('VB.listVectorizedSvgs(30)', function (text) {
      var r = bridge.parseResult(text);
      if (r && r.ok && r.files) renderSvgHistory(r.files);
      else renderSvgHistory([]);
    });
  }

  function signIn() {
    if (core.state.busy || core.state.waiting || core.state.login) return;
    if (!bridge.hostOk) { core.showError(core.t('errorHost')); return; }
    bridge.evalJsx("VB.agentStart('login', '')", function (started) {
      if (String(started) !== 'started') { core.setStatus(core.t('statusAgentError') + ' ' + String(started)); return; }
      core.state.login = true; core.state.loginKind = 'login'; core.state.waitStartedAt = Date.now(); core.state.lastStatusAt = 0; core.updateButtons();
      core.setStatus(core.t('statusSignInOpen')); core.setDetail(core.t('statusSignInHint'));
    });
  }

  function cancel() {
    var wasRunning = core.state.waiting || core.state.login || core.state.busy;
    var elapsed = core.runElapsedMs();
    core.state.runToken = (core.state.runToken || 0) + 1; // invalidate in-flight callbacks
    if (core.state.batch) core.state.batch.cancelled = true;
    var b = core.state.batch;
    core.state.busy = false;
    core.state.waiting = false;
    core.state.login = false;
    core.state.loginKind = '';
    core.state.waitStartedAt = 0;
    core.state.lastStatusAt = 0;
    core.state.runStartedAt = 0;
    core.state.pngPath = '';
    core.state.union = null;
    core.updateButtons();
    if (b) {
      core.setStatus(queue.batchLabel ? queue.batchLabel('statusBatchCancelled', { ok: b.ok || 0, n: b.total || 0 }) : core.t('statusCancelled'));
      core.setDetail(elapsed ? ('⏱ ' + core.fmtElapsed(elapsed)) : '');
      core.addHistory('batchFailed', b.docName || '', false, 'cancelled at ' + (b.doneCount || 0) + '/' + (b.total || 0));
      core.state.batch = null;
    } else {
      core.setStatus(core.t('statusCancelled'));
      core.setDetail(elapsed ? ('⏱ ' + core.fmtElapsed(elapsed) + ' · ' + core.t('statusCancelled')) : core.t('statusCancelled'));
    }
    if (wasRunning && bridge.hostOk) {
      bridge.evalJsx('VB.agentStopAll ? VB.agentStopAll() : VB.agentStop()');
      setTimeout(function () { if (bridge.hostOk) bridge.evalJsx('VB.agentStatus()'); }, 1200);
    }
  }

  function handleLoginState(s) {
    if (s.state === 'loginOpen' || s.state === 'loginWindow') {
      core.setStatus(core.t('statusSignInOpen'));
    } else if (s.state === 'loginClosed') {
      core.state.login = false; core.state.loginKind = ''; core.updateButtons();
      core.setStatus(core.t('statusSignInClosed')); core.setDetail('');
      core.addHistory('signedIn', '', true, '');
    } else if (s.state === 'error') {
      core.state.login = false; core.updateButtons();
      core.setStatus(core.t('statusAgentError') + ' ' + (s.message || ''));
    }
  }

  function placeSvg(svgPath) {
    var b = core.state.batch; // v2 path uses batch place; keep fallback safe
    if (b) return;
    var u = core.state.union;
    if (!u) { core.setStatus(core.t('statusAgentError') + ' ' + core.t('errorEmptyBounds')); var e0 = core.runElapsedMs(); core.state.runStartedAt = 0; core.setDetail(e0 ? '⏱ ' + core.fmtElapsed(e0) : ''); return; }
    core.setStatus(core.t('statusPlacing'));
    var placeT0 = Date.now();
    var payload = { svgPath: svgPath, union: u, layerName: 'Vectorizer', hideOriginal: !!core.state.settings.hideOriginal, docFullName: core.state.docFullName, docName: core.state.docName };
    var encoded = encodeURIComponent(JSON.stringify(payload));
    var fileName = String(svgPath).replace(/^.*[\/]/, '');
    bridge.evalJsx('VB.placeSVG(' + core.jsxString(encoded) + ')', function (result) {
      var r = bridge.parseResult(result); var placeMs = Date.now() - placeT0; var totalMs = core.runElapsedMs();
      core.state.runStartedAt = 0;
      var timing = '⏱ total ' + core.fmtElapsed(totalMs) + ' (export ' + core.fmtElapsed(core.state.exportMs) + ', place ' + core.fmtElapsed(placeMs) + ')';
      if (r.ok) {
        if (r.embedded) { core.setStatus(core.t('statusPlaced')); core.setDetail(timing); }
        else { core.setStatus(core.t('statusPlacingLinked')); core.setDetail(timing + (r.error ? ' · ' + r.error : '')); }
        core.addHistory('placed', fileName, true, (r.embedded ? '' : '(linked) ') + timing);
        try { refreshSvgHistory(); } catch (e) {}
        core.log('Placed: ' + svgPath + (r.embedded ? '' : ' (linked)') + ' — ' + timing);
      } else {
        core.setStatus(core.t('statusPlaceFailed') + ' ' + bridge.friendlyError(r.error));
        core.setDetail((r.error === 'docChanged' ? core.t('switchDoc') + ' ' + core.state.docName + ' · ' : '') + timing);
        core.addHistory('placeFailed', fileName, false, (r.error || '') + ' · ' + timing);
        core.log('Place failed: ' + (r.error || 'unknown') + ' — ' + timing);
      }
    });
  }

  function handleRunState(s) {
    if (core.state.runStartedAt) core.setRunTimerDetail('');
    switch (s.state) {
      case 'starting': case 'launching': case 'loading': case 'uploading':
      case 'vectorizing': case 'result': case 'downloading': {
        var map = { starting:'statusAgentLaunch', launching:'statusAgentLaunch', loading:'statusAgentLoading', uploading:'statusUploading', vectorizing:'statusVectorizing', result:'statusResult', downloading:'statusDownloading' };
        core.setStatus(core.t(map[s.state] || 'statusVectorizing'));
        break;
      }
      case 'loginRequired':
        core.state.waiting = false; core.updateButtons();
        core.setStatus(core.t('statusLoginRequired'));
        core.setDetail((s.message || core.t('statusSignInHint')) + (core.state.runStartedAt ? ' · ⏱ ' + core.fmtElapsed(core.runElapsedMs()) : ''));
        core.addHistory('loginRequired', '', false, core.fmtElapsed(core.runElapsedMs()));
        core.state.runStartedAt = 0;
        break;
      case 'error': {
        core.state.waiting = false; var elapsed = core.runElapsedMs(); core.state.runStartedAt = 0; core.updateButtons();
        core.setStatus(core.t('statusAgentError') + ' ' + (s.message || ''));
        var detail = s.message || '';
        if (elapsed) detail = (detail ? detail + ' · ' : '') + '⏱ ' + core.fmtElapsed(elapsed);
        core.setDetail(detail);
        core.addHistory('vectorizeFailed', '', false, (s.message || '') + (elapsed ? ' · ' + core.fmtElapsed(elapsed) : ''));
        break;
      }
      case 'done':
        core.state.waiting = false; core.updateButtons();
        if (s.svgPath) { if (s.elapsedMs) core.setRunTimerDetail('agent ' + core.fmtElapsed(Number(s.elapsedMs))); placeSvg(s.svgPath); }
        else { var e2 = core.runElapsedMs(); core.state.runStartedAt = 0; core.setStatus(core.t('statusAgentError') + ' (no SVG)'); core.setDetail(e2 ? '⏱ ' + core.fmtElapsed(e2) : ''); }
        break;
    }
  }

  function pollOnce() {
    if (!bridge.getCS() || !bridge.hostOk) return;
    // Parallel batch v2: jobs poll their own per-job status files.
    if (core.state.batch) return;
    if (!core.state.waiting && !core.state.login) return;
    bridge.evalJsx('VB.agentStatus()', function (text) {
      var s = {};
      try { s = JSON.parse(String(text || '{}')); } catch (e) { return; }
      if (!s || !s.state) {
        if (core.state.lastStatusAt === 0 && core.state.waitStartedAt && Date.now() - core.state.waitStartedAt > 60000) {
          core.state.waiting = false; core.state.login = false; core.state.waitStartedAt = 0; core.updateButtons();
          core.setStatus(core.t('statusAgentError') + ' ' + core.t('errorAgentStart'));
          core.addHistory(core.state.login ? 'signedIn' : 'vectorizeFailed', '', false, 'no status');
        }
        return;
      }
      core.state.lastStatusAt = Date.now();
      if (core.state.waiting && core.state.waitStartedAt && Date.now() - core.state.waitStartedAt > 90000 &&
          (s.state === 'starting' || s.state === 'launching') &&
          Number(s.time || 0) > 0 && (Date.now() - Number(s.time || 0)) > 90000) {
        core.state.waiting = false; core.state.waitStartedAt = 0; core.updateButtons();
        core.setStatus(core.t('statusAgentError') + ' ' + core.t('errorAgentStart'));
        core.addHistory('vectorizeFailed', '', false, 'stuck: ' + s.state);
        return;
      }
      if (core.state.login) handleLoginState(s);
      else if (core.state.waiting) handleRunState(s);
    });
  }

  function renderDaemonStatus() {
    var el = core.$("warmDaemonStatus");
    if (!el) return;
    if (!core.state.settings.warmDaemon) { el.textContent = core.t("warmDaemonOff"); return; }
    var s = core.state.daemon && core.state.daemon.state ? core.state.daemon.state : "unknown";
    if (s === "running" || s === "ready") el.textContent = core.t("warmDaemonOn");
    else if (s === "starting") el.textContent = core.t("warmDaemonStarting");
    else if (s === "stopping") el.textContent = core.t("warmDaemonStopping");
    else if (s === "stopped" || s === "stale" || s === "unknown") el.textContent = core.t("warmDaemonOff");
    else el.textContent = core.t("warmDaemonError");
  }
  function refreshDaemonStatus() {
    if (!bridge.hostOk) return;
    bridge.evalJsx("VB.daemonStatus()", function (text) {
      var r = bridge.parseResult(text);
      if (r && (r.state || r.ok === false)) core.state.daemon = r;
      renderDaemonStatus();
    });
  }
  function ensureDaemonRunning() {
    if (!bridge.hostOk || !core.state.settings.warmDaemon) return;
    renderDaemonStatus();
    var want = Math.max(1, Math.min(4, parseInt(core.state.settings.batchWorkers, 10) || 1));
    bridge.evalJsx("VB.daemonStatus()", function (text) {
      var r = bridge.parseResult(text);
      core.state.daemon = r || core.state.daemon;
      var running = !!(r && (r.state === "running" || r.state === "ready"));
      var cur = parseInt(r && r.workers, 10);
      if (running && (!isFinite(cur) || cur === want)) { renderDaemonStatus(); return; }
      var el = core.$("warmDaemonStatus"); if (el) el.textContent = core.t("warmDaemonStarting");
      function startDaemon() {
        bridge.evalJsx("VB.agentStart('daemon-start', '', " + core.jsxString(String(want)) + ")", function (started) {
          if (String(started) !== "started") {
            core.log("Warm daemon start failed: " + started);
            var e = core.$("warmDaemonStatus"); if (e) e.textContent = core.t("warmDaemonError");
          } else {
            core.log("Warm Chrome starting… (workers=" + want + ")");
            setTimeout(refreshDaemonStatus, 1500);
            setTimeout(refreshDaemonStatus, 5000);
            setTimeout(refreshDaemonStatus, 10000);
          }
        });
      }
      if (running && isFinite(cur) && cur !== want) {
        core.log("Restarting warm Chrome for workers " + cur + " -> " + want);
        bridge.evalJsx("VB.agentStart('daemon-stop','')", function () { core.state.daemon = { state: 'stopped' }; setTimeout(startDaemon, 900); });
      } else startDaemon();
    });
  }
  function stopWarmDaemon() {
    if (!bridge.hostOk) return;
    var el = core.$("warmDaemonStatus"); if (el) el.textContent = core.t("warmDaemonStopping");
    bridge.evalJsx("VB.agentStart('daemon-stop', '')", function () {
      core.state.daemon = { state: "stopped" };
      renderDaemonStatus();
      core.log("Warm Chrome stopped.");
    });
  }
  function scheduleDaemonPoll() {
    if (daemonPollTimer) try { clearTimeout(daemonPollTimer); } catch (e) {}
    daemonPollTimer = setTimeout(function () {
      if (core.state.settings.warmDaemon) refreshDaemonStatus();
      scheduleDaemonPoll();
    }, 15000);
  }

  function labelFromKeyEvent(ev) {
    var parts = [];
    if (ev.ctrlKey) parts.push('Ctrl');
    if (ev.shiftKey) parts.push('Shift');
    if (ev.altKey) parts.push('Alt');
    var k = ev.key || '';
    if (k === ' ' || ev.code === 'Space') k = 'Space';
    else if (k && k.length === 1) k = k.toUpperCase();
    else if (/^Key[A-Z]$/.test(ev.code)) k = ev.code.slice(3);
    else if (/^Digit[0-9]$/.test(ev.code)) k = ev.code.slice(5);
    else if (ev.code === 'Semicolon') k = ';';
    else if (ev.code === 'Comma') k = ',';
    else if (ev.code === 'Period') k = '.';
    else if (ev.code === 'Slash') k = '/';
    else if (ev.code === 'BracketLeft') k = '[';
    else if (ev.code === 'BracketRight') k = ']';
    else if (ev.code === 'Backslash') k = '\\';
    else if (ev.code === 'Quote') k = "'";
    else if (ev.code === 'Minus') k = '-';
    else if (ev.code === 'Equal') k = '=';
    else if (ev.code === 'Backquote') k = '`';
    if (!k && ev.keyCode) k = String.fromCharCode(ev.keyCode);
    parts.push(k || '?');
    return parts.join('+');
  }

  function bindUI() {
    core.on(core.$("vectorizeBtn"), "click", queue.vectorize);
    core.on(core.$("signInBtn"), "click", signIn);
    core.on(core.$("cancelBtn"), "click", cancel);
    core.on(core.$("openSvgsBtn"), "click", bridge.openSvgsFolder);
    core.on(core.$("refreshSvgsBtn"), "click", refreshSvgHistory);
    core.on(core.$("openLogBtn"), "click", bridge.openLogFolder);
    core.on(core.$("langBtn"), "click", core.toggleLanguage);

    var preset = core.$("settingsPngPreset");
    var png = core.$("settingsPngSize");
    core.on(preset, "change", function () {
      if (preset.value === "custom") { if (png) png.style.display = ""; return; }
      var value = parseInt(preset.value, 10);
      if (!isFinite(value)) value = 1700;
      core.state.settings.pngLongSide = value; // 0 = original size
      core.syncPngPresetUI();
      core.saveSettings();
    });
    core.on(png, "change", function () {
      var value = parseInt(png.value, 10);
      if (!isFinite(value) || value < 100) value = 1700;
      if (value > 5000) value = 5000;
      core.state.settings.pngLongSide = value;
      core.syncPngPresetUI();
      core.saveSettings();
    });
    var hide = core.$("settingsHideOriginal");
    core.on(hide, "change", function () { core.state.settings.hideOriginal = !!hide.checked; core.saveSettings(); });
    var bwSel = core.$("settingsBatchWorkers");
    core.on(bwSel, "change", function () {
      var bw = parseInt(bwSel.value, 10); if (!isFinite(bw) || bw < 1) bw = 1; if (bw > 4) bw = 4;
      core.state.settings.batchWorkers = bw; core.saveSettings();
      core.log("Batch workers: " + bw);
      if (core.state.settings.warmDaemon) ensureDaemonRunning();
    });
    var warm = core.$("settingsWarmDaemon");
    core.on(warm, "change", function () {
      core.state.settings.warmDaemon = !!warm.checked;
      core.saveSettings();
      if (core.state.settings.warmDaemon) ensureDaemonRunning();
      else stopWarmDaemon();
      renderDaemonStatus();
    });

    var scInput = core.$("settingsVectorizeShortcut");
    var scSet = core.$("setVectorizeShortcutBtn");
    var scReset = core.$("resetVectorizeShortcutBtn");
    var capturing = false;
    function stopCapture() {
      capturing = false; window._vbCapturingShortcut = false;
      if (scInput) scInput.value = (core.shortcutLabel ? core.shortcutLabel(core.state.settings.vectorizeShortcut) : (core.state.settings.vectorizeShortcut && core.state.settings.vectorizeShortcut.label) || 'Ctrl+Shift+Ç');
      if (scSet) scSet.textContent = core.t('setShortcut') || 'Set';
    }
    core.on(scSet, "click", function () {
      if (capturing) { stopCapture(); return; }
      capturing = true; window._vbCapturingShortcut = true;
      if (scInput) scInput.value = core.t('pressShortcut') || 'Press keys…';
      if (scSet) scSet.textContent = core.t('cancel') || 'Cancel';
      try { if (scInput) scInput.focus(); } catch (e) {}
    });
    core.on(scReset, "click", function () {
      core.state.settings.vectorizeShortcut = { ctrl: true, shift: true, alt: false, key: 186, code: 'Semicolon', label: 'Ctrl+Shift+Ç' };
      core.saveSettings();
      stopCapture();
      try { if (VB.core && VB.core.events) VB.core.events.emit('shortcut:changed', core.state.settings.vectorizeShortcut); } catch (e) {}
      try { if (VB.integrations && VB.integrations.refreshShortcut) VB.integrations.refreshShortcut(); } catch (e2) {}
      core.log('Shortcut reset to Ctrl+Shift+Ç');
    });
    window.addEventListener('keydown', function (ev) {
      if (!capturing) return;
      var k = ev.keyCode || ev.which;
      // ignore lone modifiers
      if (k === 16 || k === 17 || k === 18 || k === 91 || k === 92) return;
      if (ev.key === 'Escape') { if (ev.preventDefault) ev.preventDefault(); stopCapture(); return; }
      if (ev.preventDefault) ev.preventDefault();
      if (ev.stopPropagation) ev.stopPropagation();
      var sc = { ctrl: !!ev.ctrlKey, shift: !!ev.shiftKey, alt: !!ev.altKey, key: k, code: ev.code || '', label: labelFromKeyEvent(ev) };
      core.state.settings.vectorizeShortcut = sc;
      core.saveSettings();
      stopCapture();
      try { if (VB.core && VB.core.events) VB.core.events.emit('shortcut:changed', sc); } catch (e) {}
      try { if (VB.integrations && VB.integrations.refreshShortcut) VB.integrations.refreshShortcut(); } catch (e2) {}
      core.log('Vectorize shortcut set to ' + sc.label);
    }, true);
  }

  function renderUpdateUI() { if (core.renderUpdateUI) core.renderUpdateUI(); }
  function initUpdateUI() {
    var verEl = core.$("updateVersionText");
    if (verEl) verEl.textContent = (core.t('updateCurrentVersion') || 'Versão: {version}').replace('{version}', core.state.appVersion || '2.2.0');
    var checkBtn = core.$("checkUpdateBtn");
    var dlBtn = core.$("downloadUpdateBtn");
    core.on(checkBtn, "click", function () {
      if (core.checkForUpdate) core.checkForUpdate();
    });
    core.on(dlBtn, "click", function () {
      if (!core.state.update || core.state.update.downloading || core.state.update.staged) return;
      var ver = core.state.update.remoteVersion || '';
      core.state.update.downloading = true;
      if (core.setUpdateStatus) core.setUpdateStatus('updateDownloading', 'Baixando e preparando atualização...');
      renderUpdateUI();
      bridge.stageUpdate(ver, function (r) {
        core.state.update.downloading = false;
        if (r && r.ok) {
          core.state.update.staged = true;
          core.state.update.available = false;
          if (core.setUpdateStatus) core.setUpdateStatus('updateStaged', 'Atualização preparada ({version}). Feche o Illustrator para completar a atualização.', ver || r.version || '');
          core.log('Update staged ' + (ver || r.version || '') + '. Close Illustrator to complete.');
        } else {
          var msg = (core.t && core.t('updateStageFailed')) || 'Falha ao baixar/preparar atualização.';
          if (r && r.error) msg += ' (' + r.error + ')';
          var el = core.$('updateStatusText'); if (el) el.textContent = msg;
          core.log('Update stage failed: ' + (r && r.error ? r.error : 'unknown'));
        }
        renderUpdateUI();
      });
    });
    renderUpdateUI();
  }

  function applyPendingUpdateOnStart(callback) {
    if (!bridge.getPendingUpdate) { if (callback) callback(); return; }
    bridge.getPendingUpdate(function (info) {
      if (info && info.ok && info.pending) {
        var ver = info.version || '';
        core.log('Pending update found (' + ver + '), applying...');
        bridge.applyPendingUpdate(function (res) {
          if (res && res.ok && res.applied) {
            core.state.update.staged = false;
            core.state.update.available = false;
            if (ver) core.state.appVersion = ver;
            var el = core.$('updateStatusText');
            if (el) el.textContent = (core.t('updateApplied') || 'Atualizado para {version}.').replace('{version}', ver || core.state.appVersion);
            core.log('Update applied: ' + (ver || core.state.appVersion));
            renderUpdateUI();
          } else if (res && !res.ok) {
            core.log('Pending update apply failed: ' + (res.error || 'unknown'));
          }
          if (callback) callback();
        });
      } else {
        if (callback) callback();
      }
    });
  }

  function init() {
    core.loadSettings();
    // queue↔vectorizer interface/events
    core.events.on('poll:tick', pollOnce);
    core.events.on('batch:finished', function () { try { refreshSvgHistory(); } catch (e) {} });
    bindUI();
    initUpdateUI();
    core.renderLocale();
    core.applySettingsToUI();
    core.setStatus(core.t("statusReady"));
    try {
      bridge.setCS(new CSInterface());
    } catch (e) {
      core.showError("CSInterface failed: " + e);
      return;
    }
    core.setStatus(core.t("statusLoadingHost"));
    bridge.loadHost(function (result) {
      if (String(result) !== "ok") {
        bridge.hostOk = false;
        core.showError(core.t("errorHost") + " (" + result + ")");
        core.setStatus(core.t("statusHostError"));
        core.updateButtons();
        return;
      }
      bridge.hostOk = true;
      core.updateButtons();
      core.setStatus(core.t("statusReady"));
      core.setDetail("");
      // Apply pending update (staged on previous run) after host is ready
      applyPendingUpdateOnStart(function () {
        bridge.getLocalVersion(function (v) {
          if (v) core.state.appVersion = v;
          renderUpdateUI();
        });
        bridge.evalJsx("VB.getBridgeFolderPath()", function (bp) { core.state.bridgeFolder = String(bp || "").replace(/^"|"$/g, ""); });
        refreshDaemonStatus();
        refreshSvgHistory();
        if (core.state.settings.warmDaemon) ensureDaemonRunning();
        bridge.evalJsx("VB.selfTest()", function (selfTest) {
          var st = bridge.parseResult(selfTest);
          core.log("Host self-test: " + selfTest);
          if (!st.ok || !st.parsed) core.showError(core.t("errorJson") + " (" + selfTest + ")");
        });
        bridge.evalJsx("app.version", function (version) {
          var el = core.$("versionText");
          if (el && version) el.textContent = core.t("versionLabel") + " " + version;
        });
      });
    });
    core.schedulePoll(core.currentPollMs());
    scheduleDaemonPoll();
  }

  vectorizer.init = init; vectorizer.pollOnce = pollOnce; vectorizer.refreshSvgHistory = refreshSvgHistory;
  vectorizer.renderDaemonStatus = renderDaemonStatus; vectorizer.ensureDaemonRunning = ensureDaemonRunning; vectorizer.signIn = signIn; vectorizer.cancel = cancel;
})();
