(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var bridge = VB.bridge || (VB.bridge = {});
  var queue = VB.queue = VB.queue || {};

  function batchLabel(key, vars) {
    var s = core.t(key);
    vars = vars || {};
    for (var k in vars) if (vars.hasOwnProperty(k)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    return s;
  }
  function batchStageLabel(s) {
    var map = {
      starting: 'statusAgentLaunch', launching: 'statusAgentLaunch', loading: 'statusAgentLoading',
      uploading: 'statusUploading', vectorizing: 'statusVectorizing', result: 'statusResult',
      downloading: 'statusDownloading', placing: 'statusPlacing'
    };
    return core.t(map[s && s.state] || 'statusVectorizing');
  }
  function batchProgressStage(b) {
    if (!b || !b.jobs) return '';
    var st = '';
    for (var i = 0; i < b.jobs.length; i++) {
      var j = b.jobs[i];
      if (j && (j.phase === 'agent' || j.phase === 'place') && j.stageLabel) { st = ' · ' + j.stageLabel; break; }
    }
    return st;
  }
  function updateBatchStatus(prefix) {
    var b = core.state.batch;
    if (!b) return;
    var key = 'statusBatchProgress';
    var dict = (window.LOCALES && window.LOCALES[core.state.lang]) || (window.LOCALES && window.LOCALES.en) || {};
    var stage = batchProgressStage(b);
    var msg;
    if (dict[key]) msg = batchLabel(key, { done: b.doneCount, n: b.total, active: b.active || 0, stage: stage });
    else msg = batchLabel('statusBatch', { i: Math.min((b.doneCount || 0) + 1, b.total), n: b.total, stage: stage ? stage.replace(/^ · /, '') : core.t('statusVectorizing') });
    core.setStatus((prefix ? (prefix + ' ') : '') + msg);
    core.setDetail(b.docName || '');
  }
  function finishBatch(detail) {
    var b = core.state.batch;
    if (!b) return;
    var msg = b.cancelled ? batchLabel('statusBatchCancelled', { ok: b.ok, n: b.total }) : batchLabel('statusBatchDone', { ok: b.ok, n: b.total });
    core.setStatus(msg);
    core.setDetail(detail || ('ok ' + b.ok + '/' + b.total + (b.failed ? (', failed ' + b.failed) : '') + (b.skipped ? (', skipped ' + b.skipped) : '')));
    core.addHistory(b.cancelled ? 'batchFailed' : 'batchPlaced', b.docName || '', !b.cancelled && b.failed === 0, msg);
    core.events.emit('batch:finished', { cancelled: !!b.cancelled, ok: b.ok, failed: b.failed, skipped: b.skipped, total: b.total, docName: b.docName || '' });
    core.state.batch = null;
    core.state.busy = false; core.state.waiting = false; core.state.runStartedAt = 0; core.state.exportMs = 0;
    core.updateButtons();
  }
  function batchMaybeFinish() {
    var b = core.state.batch; if (!b || b.cancelled) return;
    if ((b.doneCount || 0) >= b.total && (b.active || 0) <= 0) finishBatch();
  }
  function batchFailJob(j, reason, token) {
    var b = core.state.batch; if (!b || !j || j.done) return;
    j.done = true; j.phase = 'failed'; b.failed++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
    core.addHistory('batchFailed', '#' + (j.index + 1), false, reason || 'error');
    core.log('Batch item ' + (j.index + 1) + ' failed: ' + (reason || ''));
    if (!b.cancelled) { updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
    else batchMaybeFinish();
  }
  function batchSkipJob(j, reason, token) {
    var b = core.state.batch; if (!b || !j || j.done) return;
    j.done = true; j.phase = 'skipped'; b.skipped++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
    core.addHistory('batchSkipped', '#' + (j.index + 1), false, reason || '');
    if (!b.cancelled) { updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
    else batchMaybeFinish();
  }
  function batchJobStatusPath(j) {
    var base = core.state.bridgeFolder || '';
    if (!base) return '';
    return base.replace(/[\\\/]+/g, '/') + '/agent-status-' + String(core.state.runToken || 0) + '-' + j.index + '.json';
  }
  function scheduleBatch(token) {
    var b = core.state.batch;
    if (!b || b.cancelled || token !== core.state.runToken) return;
    var wanted = Math.max(1, Math.min(4, parseInt(core.state.settings.batchWorkers, 10) || 1));
    // Each one-shot job launches its own Chrome on the same profile, so two at once
    // is a guaranteed "profiles cannot be used at the same time" failure. Warm Chrome
    // is the only mode where parallel items share one browser.
    var limit = core.state.settings.warmDaemon ? wanted : 1;
    if (!core.state.settings.warmDaemon && wanted > 1 && !b.warnedSequential) {
      b.warnedSequential = true;
      core.log('Parallel workers need Warm Chrome; running the batch one item at a time.');
    }
    while ((b.active || 0) < limit && b.next < b.total) {
      var j = b.jobs[b.next++]; if (!j) continue;
      startBatchJob(j, token);
    }
    if ((b.active || 0) <= 0 && (b.doneCount || 0) >= b.total) finishBatch();
  }
  function startBatchJob(j, token) {
    var b = core.state.batch; if (!b || b.cancelled || token !== core.state.runToken || !j || j.done) return;
    j.phase = 'exporting'; j.startedAt = Date.now(); b.active = (b.active || 0) + 1;
    j.stageLabel = core.t('statusExporting'); updateBatchStatus();
    core.state.busy = (b.active > 0); core.state.waiting = (b.active > 0); core.updateButtons();
    var size = parseInt(core.state.settings.pngLongSide, 10); if (!isFinite(size)) size = 1700;
    var exportT0 = Date.now();
    bridge.evalJsx('VB.exportBatchItem(' + j.index + ',' + size + ')', function (result) {
      if (token !== core.state.runToken || !core.state.batch || core.state.batch.cancelled) return;
      var r = bridge.parseResult(result);
      j.exportMs = Date.now() - exportT0;
      if (!r.ok) return batchFailJob(j, (r.error || '') + ' - ' + bridge.friendlyError(r.error), token);
      if (r.pixelCapped) core.log('Item #' + (j.index + 1) + ': PNG reduced to ' + (r.megapixels || '?') + ' MP to fit the site input limit.');
      j.union = r.union || null; j.pngPath = r.pngPath || '';
      j.docFullName = r.docFullName || b.docFullName || ''; j.docName = r.docName || b.docName || '';
      j.jobId = r.jobId || b.jobId || '';
      if (!j.union) return batchSkipJob(j, 'emptyBounds', token);
      if (!j.pngPath) return batchFailJob(j, 'export produced no PNG', token);
      j.phase = 'agent'; j.stageLabel = core.t('statusUploading'); j.statusPath = batchJobStatusPath(j); j.agentStartedAt = Date.now(); j.lastStatusAt = 0; j.busy = 0; j.busyRetries = 0; j._startRetries = 0;
      updateBatchStatus();
      launchBatchAgent(j, token);
    });
  }
  /* Spawning several hidden VBS -> cmd -> node launchers at the same instant is what
     starved the launcher on Windows: the host's "starting" marker sat there with no
     pid, the panel relaunched it, and the duplicate node processes fought over the
     Chrome profile. Launch one agent at a time, a beat apart. */
  var launchQueue = [];
  var launching = false;
  function runLaunchQueue() {
    if (launching) return;
    var task = launchQueue.shift();
    if (!task) return;
    launching = true;
    task(function release() {
      launching = false;
      setTimeout(runLaunchQueue, 150);
    });
  }
  function enqueueLaunch(task) { launchQueue.push(task); runLaunchQueue(); }

  /* Warm Chrome takes jobs over localhost HTTP: no wscript, no cmd, no second node
     process per item. Spawning that chain was where items silently stayed at
     "starting" - the launch produced nothing and could not say why. The VBS
     launcher remains only for a batch without a warm browser. */
  var daemonTries = {};

  function refreshDaemon() {
    if (!bridge.hostOk) return;
    bridge.evalJsx('VB.daemonStatus()', function (txt) {
      var s = bridge.parseResult(txt);
      if (s && (s.port || s.state)) core.state.daemon = s;
    });
  }

  function daemonTarget() {
    var d = core.state.daemon || {};
    var port = parseInt(d.port, 10);
    var key = d.token ? String(d.token) : '';
    if (!(port > 0) || !key) return null;
    return { port: port, token: key };
  }

  /* out/profile/work are what the daemon needs for a job body. */
  function ensureAgentPaths(cb) {
    var p = core.state.agentPaths;
    if (p && p.run && p.profile && p.out) return cb();
    bridge.evalJsx('VB.toJSON(VB.agentPaths())', function (txt) {
      var r = bridge.parseResult(txt);
      if (r && r.run && r.profile && r.out) core.state.agentPaths = r;
      cb();
    });
  }

  function tryDaemonSubmit(j, token) {
    if (!core.state.settings.warmDaemon) return false;
    var target = daemonTarget();
    var paths = core.state.agentPaths;
    if (!target || !paths || !paths.out || !paths.profile) return false;
    var tries = daemonTries[j.index] || 0;
    if (tries > 30) {
      core.log('Warm Chrome had no free slot for item ' + (j.index + 1) + '; running it separately.');
      return false;
    }
    var xhr;
    try { xhr = new XMLHttpRequest(); } catch (e0) { return false; }
    daemonTries[j.index] = tries + 1;
    j.phase = 'agent';
    j.stageLabel = tries ? core.t('statusWaitingSlot') : core.t('statusUploading');
    j.agentStartedAt = j.agentStartedAt || Date.now();
    updateBatchStatus();
    try {
      xhr.open('POST', 'http://127.0.0.1:' + target.port + '/run', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-VB-Token', target.token);
      xhr.timeout = 8000;
    } catch (e1) { return false; }

    function alive() {
      return token === core.state.runToken && !!core.state.batch && !core.state.batch.cancelled && !j.done;
    }
    xhr.onload = function () {
      if (!alive()) return;
      var code = xhr.status;
      if (code === 200 || code === 202) {
        core.addHistory('batchSent', '#' + (j.index + 1), true, 'warm Chrome');
        pollBatchJob(j, token);
        return;
      }
      // Every worker busy is not a failure: wait for a slot to free up.
      if (code === 503 || code === 409) {
        j.stageLabel = core.t('statusWaitingSlot');
        updateBatchStatus();
        setTimeout(function () { if (alive()) launchBatchAgent(j, token); }, 800);
        return;
      }
      if (code === 401) refreshDaemon();
      core.log('Warm Chrome refused item ' + (j.index + 1) + ' (HTTP ' + code + '); running it separately.');
      launchAgentProcess(j, token);
    };
    xhr.onerror = xhr.ontimeout = function () {
      if (!alive()) return;
      core.log('Warm Chrome is not answering on port ' + target.port + '; running item ' + (j.index + 1) + ' separately.');
      core.state.daemon = {};
      launchAgentProcess(j, token);
    };
    try {
      xhr.send(JSON.stringify({
        png: j.pngPath, out: paths.out, profile: paths.profile, debug: paths.debug,
        work: paths.work, status: j.statusPath, timeout: 300000
      }));
    } catch (e2) { return false; }
    return true;
  }

  function launchBatchAgent(j, token) {
    var b = core.state.batch; if (!b || b.cancelled || token !== core.state.runToken || j.done) return;
    if (tryDaemonSubmit(j, token)) return;
    launchAgentProcess(j, token);
  }

  function launchAgentProcess(j, token) {
    var b = core.state.batch; if (!b || b.cancelled || token !== core.state.runToken || j.done) return;
    j.agentStartedAt = Date.now();
    var spArg = j.statusPath ? (', ' + core.jsxString(j.statusPath)) : '';
    enqueueLaunch(function (release) {
      if (token !== core.state.runToken || !core.state.batch || core.state.batch.cancelled || j.done) { release(); return; }
      bridge.evalJsx('VB.agentStart(\'run\', ' + core.jsxString(j.pngPath) + spArg + ')', function (started) {
        release();
        if (token !== core.state.runToken || !core.state.batch || core.state.batch.cancelled) return;
        if (String(started) !== 'started') {
          var s = String(started || '');
          if (j.busyRetries < 12 && /busy|previous run is still starting|profile/i.test(s)) {
            j.busyRetries++; j.stageLabel = core.t('statusAgentLaunch');
            setTimeout(function () { launchBatchAgent(j, token); }, 1200);
            return;
          }
          return batchFailJob(j, s || 'agent start failed', token);
        }
        core.addHistory('batchSent', '#' + (j.index + 1), true, 'export ' + core.fmtElapsed(j.exportMs || 0));
        pollBatchJob(j, token);
      });
    });
  }
  function pollBatchJob(j, token) {
    var b = core.state.batch; if (!b || b.cancelled || token !== core.state.runToken || j.done) return;
    if (j.phase !== 'agent') return;
    var spArg = j.statusPath ? ('(' + core.jsxString(j.statusPath) + ')') : '()';
    bridge.evalJsx('VB.agentStatus' + spArg, function (text) {
      if (token !== core.state.runToken || !core.state.batch || core.state.batch.cancelled || j.done) return;
      var s = {};
      try { s = JSON.parse(String(text || '{}')); } catch (e) { s = {}; }
      if (!s || !s.state) {
        var age0 = Date.now() - (j.agentStartedAt || Date.now());
        if (age0 > 60000 && !j.lastStatusAt) return batchFailJob(j, 'no status', token);
        return setTimeout(function () { pollBatchJob(j, token); }, 450);
      }
      j.lastStatusAt = Date.now();
      j.stageLabel = batchStageLabel(s);
      updateBatchStatus();
      var age = Date.now() - Number(s.time || 0);
      var noPid = !(s.pid || s.browserPid || s.viaDaemon || s.daemon);
      j._startRetries = j._startRetries || 0;
      // One relaunch is enough: a real launcher answers within a few seconds, and a
      // second node process for the same job only adds profile contention.
      if (s.state === 'starting' && noPid && age > 25000 && j._startRetries < 2) {
        j._startRetries++;
        j.stageLabel = core.t('statusAgentLaunch');
        core.log('Batch item ' + (j.index + 1) + ': relaunching (stale start, attempt ' + j._startRetries + '/2)');
        return launchBatchAgent(j, token);
      }
      if (s.state === 'starting' && noPid && age > 150000) return batchFailJob(j, 'stuck: starting', token);
      if (s.state === 'launching' && age > 180000) return batchFailJob(j, 'stuck: launching', token);
      if (s.state === 'starting' && !noPid && age > 150000) return batchFailJob(j, 'stuck: starting', token);
      if (s.state === 'loginRequired') return batchFailJob(j, 'login required', token);
      if (s.state === 'error') return batchFailJob(j, s.message || 'agent error', token);
      if (s.state === 'done') {
        if (s.svgPath) return placeBatchJob(j, s.svgPath, s, token);
        return batchFailJob(j, 'no SVG', token);
      }
      setTimeout(function () { pollBatchJob(j, token); }, 350);
    });
  }
  function placeBatchJob(j, svgPath, statusObj, token) {
    var b = core.state.batch; if (!b || b.cancelled || token !== core.state.runToken || j.done) return;
    j.phase = 'place'; j.stageLabel = core.t('statusPlacing'); updateBatchStatus();
    var placeT0 = Date.now();
    var payload = {
      svgPath: svgPath,
      union: j.union,
      layerName: 'Vectorizer',
      hideOriginal: !!core.state.settings.hideOriginal,
      docFullName: j.docFullName || b.docFullName,
      docName: j.docName || b.docName,
      batchIndex: j.index,
      batchJobId: j.jobId || b.jobId || ''
    };
    var encoded = encodeURIComponent(JSON.stringify(payload));
    bridge.evalJsx('VB.placeSVG(' + core.jsxString(encoded) + ')', function (result) {
      if (token !== core.state.runToken || !core.state.batch || j.done) return;
      var r = bridge.parseResult(result);
      var totalMs = Date.now() - (j.startedAt || placeT0);
      if (r.ok) {
        j.done = true; j.phase = 'done'; b.ok++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
        core.addHistory('batchPlaced', '#' + (j.index + 1), true, (r.embedded ? '' : '(linked) ') + core.fmtElapsed(totalMs));
      } else {
        j.done = true; j.phase = 'failed'; b.failed++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
        core.addHistory('batchFailed', '#' + (j.index + 1), false, (r.error || 'place failed') + ' · ' + core.fmtElapsed(totalMs));
      }
      if (!b.cancelled) { core.state.busy = (b.active > 0); core.state.waiting = (b.active > 0); core.updateButtons(); updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
      else batchMaybeFinish();
    });
  }

  /* Wait until the warm Chrome daemon is actually serving before the batch starts,
     so the items share it instead of each launching a browser on the same profile.
     This also restarts a daemon that idled out, which otherwise turned every item
     of the batch back into a cold launch. Falls through after 20s so a missing
     browser still produces per-item errors rather than a hung batch. */
  function waitForWarmDaemon(workers, token, done) {
    var deadline = Date.now() + 20000;
    var started = false;
    core.log('Waiting for warm Chrome (workers=' + workers + ') …');
    function poll() {
      if (token !== core.state.runToken || !core.state.batch) return;
      bridge.evalJsx('VB.daemonStatus()', function (text) {
        if (token !== core.state.runToken || !core.state.batch) return;
        var s = bridge.parseResult(text) || {};
        if (s && (s.port || s.state)) core.state.daemon = s;
        var running = (s.state === 'running' || s.state === 'ready');
        var cur = parseInt(s.workers, 10);
        if (running && (!isFinite(cur) || cur >= workers)) return done();
        if (!started) {
          started = true;
          bridge.evalJsx("VB.agentStart('daemon-start', '', " + core.jsxString(String(workers)) + ")", function (r) {
            if (String(r) !== 'started') core.log('Warm Chrome start failed: ' + r);
          });
        }
        if (Date.now() > deadline) {
          core.log('Warm Chrome was not ready in 20s; continuing with per-item launches.');
          return done();
        }
        setTimeout(poll, 500);
      });
    }
    poll();
  }

  function vectorize() {
    if (core.state.busy || core.state.waiting || core.state.login) return;
    if (!bridge.hostOk) { core.showError(core.t('errorHost')); return; }
    core.state.runToken = (core.state.runToken || 0) + 1;
    var token = core.state.runToken;
    core.state.busy = true;
    core.state.batch = null;
    core.updateButtons();
    core.setStatus(core.t('statusExporting'));
    core.setDetail('');
    var size = parseInt(core.state.settings.pngLongSide, 10); if (!isFinite(size)) size = 1700;
    bridge.evalJsx('VB.prepareBatch(' + size + ')', function (result) {
      if (token !== core.state.runToken) return;
      var r = bridge.parseResult(result);
      if (!r.ok) {
        core.state.busy = false; core.updateButtons();
        core.setStatus(core.t('statusExportFailed') + ' ' + bridge.friendlyError(r.error));
        core.setDetail('');
        core.addHistory('exportFailed', '', false, r.error || '');
        return;
      }
      var count = parseInt(r.count, 10) || 0;
      if (count <= 0) { core.state.busy = false; core.updateButtons(); core.setStatus(core.t('batchNoItems')); return; }
      var jobs = [];
      for (var i = 0; i < count; i++) jobs.push({ index: i, phase: 'pending', done: false, union: null, pngPath: '', statusPath: '', stageLabel: '', startedAt: 0, exportMs: 0, agentStartedAt: 0, lastStatusAt: 0, busyRetries: 0, _startRetries: 0, docFullName: '', docName: '', jobId: '' });
      core.state.batch = {
        total: count, next: 0, ok: 0, failed: 0, skipped: 0, doneCount: 0, active: 0, cancelled: false,
        docFullName: r.docFullName || '', docName: r.docName || '', jobId: r.jobId || String(Date.now()), jobs: jobs
      };
      core.state.waiting = true; core.state.runStartedAt = Date.now();
      daemonTries = {}; // per batch: a spent retry budget must not follow the next run
      var workers = Math.max(1, Math.min(4, parseInt(core.state.settings.batchWorkers, 10) || 1));
      core.log('Batch start: ' + count + ' item(s), workers=' + workers);
      function beginParallelBatch() {
        if (token !== core.state.runToken || !core.state.batch) return;
        updateBatchStatus();
        // Warm Chrome is worth having even for a single worker: without it every
        // item pays a cold Chrome launch and a cold page. Only skip when it is off.
        if (!core.state.settings.warmDaemon) return scheduleBatch(token);
        ensureAgentPaths(function () {
          if (token !== core.state.runToken || !core.state.batch) return;
          waitForWarmDaemon(workers, token, function () { scheduleBatch(token); });
        });
      }
      if (!core.state.bridgeFolder && bridge.hostOk) {
        bridge.evalJsx("VB.getBridgeFolderPath()", function (bp) {
          core.state.bridgeFolder = String(bp || "").replace(/^"|"$/g, "");
          beginParallelBatch();
        });
      } else {
        beginParallelBatch();
      }
    });
  }

  queue.batchLabel = batchLabel; queue.updateBatchStatus = updateBatchStatus; queue.scheduleBatch = scheduleBatch;
  queue.finishBatch = finishBatch; queue.vectorize = vectorize;
})();
