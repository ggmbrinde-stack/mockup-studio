import { useEffect, useMemo, useRef, useCallback } from "react";
import { useCore } from "../context/core-context";
import { useHost } from "../hooks/use-host";

export function useBatch() {
  const { actions } = useCore();
  const { hostOk, evalJsx, parseResult, friendlyError } = useHost(actions.t);
  /* Stable holder: .current always resolves to the newest state, so callbacks created in an
     earlier render never read a stale snapshot. */
  const live = useMemo(() => ({ get current() { return actions.live; } }), [actions]);
  const launchQueueRef = useRef<Array<Function>>([]);
  const launchingRef = useRef(false);
  const daemonTriesRef = useRef<Record<number, number>>({});
  const lastBatchStatusRef = useRef("");

  const batchLabel = useCallback((key: string, vars: any): string => {
    let s = actions.t(key);
    vars = vars || {};
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k]));
    }
    return s;
  }, [actions.t]);

  const batchStageLabel = useCallback((s: any): string => {
    const map: Record<string, string> = {
      starting: "statusAgentLaunch", launching: "statusAgentLaunch", loading: "statusAgentLoading",
      uploading: "statusUploading", vectorizing: "statusVectorizing", result: "statusResult",
      downloading: "statusDownloading", placing: "statusPlacing",
    };
    return actions.t(map[s && s.state] || "statusVectorizing");
  }, [actions.t]);

  const batchProgressStage = useCallback((b: any): string => {
    if (!b || !b.jobs) return "";
    let st = "";
    for (let i = 0; i < b.jobs.length; i++) {
      const j = b.jobs[i];
      if (j && (j.phase === "agent" || j.phase === "place") && j.stageLabel) { st = " · " + j.stageLabel; break; }
    }
    return st;
  }, []);

  const updateBatchStatus = useCallback((prefix?: string, batchOverride?: any) => {
    /* The batch is passed explicitly right after it is created: React commits the state a
       tick later, so live.current.batch still reads null at that moment. */
    const b = batchOverride || live.current.batch;
    if (!b) return;
    const key = "statusBatchProgress";
    const stage = batchProgressStage(b);
    let msg: string;
    if (actions.t(key)) {
      msg = batchLabel(key, { done: b.doneCount, n: b.total, active: b.active || 0, stage: stage });
    } else {
      msg = batchLabel("statusBatch", { i: Math.min((b.doneCount || 0) + 1, b.total), n: b.total, stage: stage ? stage.replace(/^ · /, "") : actions.t("statusVectorizing") });
    }
    /* Batch polling runs every 350–450 ms and several stages fire in the same tick, so the
       repeat is dropped here. A ref, not state, because two calls can land before React
       commits the first. Explicit statuses go through setStatus and are never hidden. */
    const text = (prefix ? (prefix + " ") : "") + msg;
    if (text === lastBatchStatusRef.current) return;
    lastBatchStatusRef.current = text;
    actions.setStatus(text);
    actions.setDetail(b.docName || "");
  }, [live.current.batch, actions, batchLabel, batchProgressStage]);

  const finishBatch = useCallback((detail?: string) => {
    const b = live.current.batch;
    if (!b || b.finished) return;
    /* scheduleBatch() and batchMaybeFinish() can both reach the last item before React
       commits batch: null. The flag keeps one completion, one history row, one event. */
    b.finished = true;
    const msg = b.cancelled ? batchLabel("statusBatchCancelled", { ok: b.ok, n: b.total }) : batchLabel("statusBatchDone", { ok: b.ok, n: b.total });
    actions.setStatus(msg);
    actions.setDetail(detail || ("ok " + b.ok + "/" + b.total + (b.failed ? (", failed " + b.failed) : "") + (b.skipped ? (", skipped " + b.skipped) : "")));
    actions.addHistory(b.cancelled ? "batchFailed" : "batchPlaced", b.docName || "", !b.cancelled && b.failed === 0, msg);
    actions.events.emit("batch:finished", { cancelled: !!b.cancelled, ok: b.ok, failed: b.failed, skipped: b.skipped, total: b.total, docName: b.docName || "" });
    try { evalJsx("VB.restoreBatchNotes()", () => { }); } catch { }
    actions.setState({ batch: null, busy: false, waiting: false, runStartedAt: 0, exportMs: 0 });
    actions.updateButtons();
  }, [live, actions, batchLabel, evalJsx]);

  /* scheduleBatch must be defined before batchFailJob/batchSkipJob/vectorize which
     reference it. It reads live.current for settings and batch, and calls
     startBatchJob/finishBatch/updateBatchStatus. Deps mirror those reads. */
  const scheduleBatch = useCallback((token: number, batchOverride?: any) => {
    const b = live.current.batch || batchOverride;
    if (!b || b.cancelled || token !== live.current.runToken) return;
    const wanted = Math.max(1, Math.min(4, parseInt(String(live.current.settings.batchWorkers), 10) || 1));
    const limit = live.current.settings.warmDaemon ? wanted : 1;
    if (!live.current.settings.warmDaemon && wanted > 1 && !b.warnedSequential) {
      b.warnedSequential = true;
      actions.log("Parallel workers need Warm Chrome; running the batch one item at a time.");
    }
    while ((b.active || 0) < limit && b.next < b.total) {
      const j = b.jobs[b.next++]; if (!j) continue;
      startBatchJob(j, token, b);
    }
    if ((b.active || 0) <= 0 && (b.doneCount || 0) >= b.total) finishBatch();
  }, [live, actions, startBatchJob, finishBatch, updateBatchStatus]);

  const batchMaybeFinish = useCallback(() => {
    const b = live.current.batch;
    if (!b || b.cancelled) return;
    if ((b.doneCount || 0) >= b.total && (b.active || 0) <= 0) finishBatch();
  }, [live.current.batch, finishBatch]);

  const batchFailJob = useCallback((j: any, reason: string, token: number) => {
    const b = live.current.batch;
    if (!b || !j || j.done) return;
    j.done = true; j.phase = "failed"; b.failed++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
    actions.addHistory("batchFailed", "#" + (j.index + 1), false, reason || "error");
    actions.log("Batch item " + (j.index + 1) + " failed: " + (reason || ""));
    if (!b.cancelled) { updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
    else batchMaybeFinish();
  }, [live.current.batch, actions, updateBatchStatus, scheduleBatch, batchMaybeFinish]);

  const batchSkipJob = useCallback((j: any, reason: string, token: number) => {
    const b = live.current.batch;
    if (!b || !j || j.done) return;
    j.done = true; j.phase = "skipped"; b.skipped++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
    actions.addHistory("batchSkipped", "#" + (j.index + 1), false, reason || "");
    if (!b.cancelled) { updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
    else batchMaybeFinish();
  }, [live.current.batch, actions, updateBatchStatus, scheduleBatch, batchMaybeFinish]);

  const batchJobStatusPath = useCallback((j: any): string => {
    const base = live.current.bridgeFolder || "";
    if (!base) return "";
    return base.replace(/[\\\/]+/g, "/") + "/agent-status-" + String(live.current.runToken || 0) + "-" + j.index + ".json";
  }, [live.current.bridgeFolder, live.current.runToken]);

  const runLaunchQueue = useCallback(() => {
    if (launchingRef.current) return;
    const task = launchQueueRef.current.shift();
    if (!task) return;
    launchingRef.current = true;
    task(() => {
      launchingRef.current = false;
      setTimeout(runLaunchQueue, 150);
    });
  }, []);

  const enqueueLaunch = useCallback((task: Function) => {
    launchQueueRef.current.push(task);
    runLaunchQueue();
  }, [runLaunchQueue]);

  const refreshDaemon = useCallback(() => {
    if (!hostOk) return;
    evalJsx("VB.daemonStatus()", (txt: string) => {
      const s = parseResult(txt);
      if (s && (s.port || s.state)) actions.setState({ daemon: s as any });
    });
  }, [hostOk, evalJsx, parseResult, actions, live]);

  const daemonTarget = useCallback((): any => {
    const d = live.current.daemon || {};
    const port = parseInt(String(d.port), 10);
    const key = d.token ? String(d.token) : "";
    if (!(port > 0) || !key) return null;
    return { port: port, token: key };
  }, [live.current.daemon]);

  const ensureAgentPaths = useCallback((cb: () => void) => {
    const p = live.current.agentPaths;
    if (p && p.run && p.profile && p.out) return cb();
    evalJsx("VB.toJSON(VB.agentPaths())", (txt: string) => {
      const r = parseResult(txt);
      if (r && r.run && r.profile && r.out) actions.setState({ agentPaths: r });
      cb();
    });
  }, [evalJsx, parseResult, actions, live.current.agentPaths, live]);

  const tryDaemonSubmit = useCallback((j: any, token: number): boolean => {
    if (!live.current.settings.warmDaemon) return false;
    const target = daemonTarget();
    const paths = live.current.agentPaths;
    if (!target || !paths || !paths.out || !paths.profile) return false;
    const tries = daemonTriesRef.current[j.index] || 0;
    if (tries > 30) {
      actions.log("Warm Chrome had no free slot for item " + (j.index + 1) + "; running it separately.");
      return false;
    }
    let xhr: any;
    try { xhr = new XMLHttpRequest(); } catch { return false; }
    const alive = () => token === live.current.runToken && !!live.current.batch && !live.current.batch.cancelled && !j.done;
    try {
      xhr.open("POST", "http://127.0.0.1:" + target.port + "/run", true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("X-VB-Token", target.token);
      xhr.timeout = 8000;
    } catch { return false; }
    xhr.onload = function () {
      if (!alive()) return;
      const code = xhr.status;
      if (code === 200 || code === 202) {
        actions.addHistory("batchSent", "#" + (j.index + 1), true, "warm Chrome");
        pollBatchJob(j, token);
        return;
      }
      if (code === 503 || code === 409) {
        j.stageLabel = actions.t("statusWaitingSlot");
        updateBatchStatus();
        setTimeout(() => { if (alive()) launchBatchAgent(j, token); }, 800);
        return;
      }
      if (code === 401) refreshDaemon();
      actions.log("Warm Chrome refused item " + (j.index + 1) + " (HTTP " + code + "); running it separately.");
      launchAgentProcess(j, token);
    };
    xhr.onerror = xhr.ontimeout = function () {
      if (!alive()) return;
      actions.log("Warm Chrome is not answering on port " + target.port + "; running item " + (j.index + 1) + " separately.");
      actions.setState({ daemon: { state: "unknown", busy: false } });
      launchAgentProcess(j, token);
    };
    try {
      xhr.send(JSON.stringify({
        png: j.pngPath, out: paths.out, profile: paths.profile, debug: paths.debug,
        work: paths.work, status: j.statusPath, timeout: 300000,
      }));
      daemonTriesRef.current[j.index] = tries + 1;
      j.phase = "agent";
      j.stageLabel = tries ? actions.t("statusWaitingSlot") : actions.t("statusUploading");
      j.agentStartedAt = j.agentStartedAt || Date.now();
      updateBatchStatus();
    } catch { return false; }
    return true;
  }, [live, actions, daemonTarget, updateBatchStatus, refreshDaemon, evalJsx]);

  const launchBatchAgent = useCallback((j: any, token: number) => {
    const b = live.current.batch;
    if (!b || b.cancelled || token !== live.current.runToken || j.done) return;
    if (tryDaemonSubmit(j, token)) return;
    launchAgentProcess(j, token);
  }, [live.current.batch, live.current.runToken, tryDaemonSubmit, launchAgentProcess]);

  function launchAgentProcess(j: any, token: number) {
    const b = live.current.batch;
    if (!b || b.cancelled || token !== live.current.runToken || j.done) return;
    j.agentStartedAt = Date.now();
    const spArg = j.statusPath ? (", " + JSON.stringify(j.statusPath)) : "";
    enqueueLaunch(() => {
      if (token !== live.current.runToken || !live.current.batch || live.current.batch.cancelled || j.done) { /* release */ return; }
      evalJsx(`VB.agentStart('run', ${JSON.stringify(j.pngPath)}${spArg})`, (started: any) => {
        if (token !== live.current.runToken || !live.current.batch || live.current.batch.cancelled) return;
        if (String(started) !== "started") {
          const s = String(started || "");
          if (j.busyRetries < 12 && /busy|previous run is still starting|profile/i.test(s)) {
            j.busyRetries++; j.stageLabel = actions.t("statusAgentLaunch");
            setTimeout(() => launchBatchAgent(j, token), 1200);
            return;
          }
          return batchFailJob(j, s || "agent start failed", token);
        }
        actions.addHistory("batchSent", "#" + (j.index + 1), true, "export " + actions.fmtElapsed(j.exportMs || 0));
        pollBatchJob(j, token);
      });
    });
  }

  function pollBatchJob(j: any, token: number) {
    const b = live.current.batch;
    if (!b || b.cancelled || token !== live.current.runToken || j.done) return;
    if (j.phase !== "agent") return;
    const spArg = j.statusPath ? ("(" + JSON.stringify(j.statusPath) + ")") : "()";
    evalJsx(`VB.agentStatus${spArg}`, (text: string) => {
      if (token !== live.current.runToken || !live.current.batch || live.current.batch.cancelled || j.done) return;
      let s: any = {};
      try { s = JSON.parse(String(text || "{}")); } catch { s = {}; }
      if (!s || !s.state) {
        const age0 = Date.now() - (j.agentStartedAt || Date.now());
        if (age0 > 60000 && !j.lastStatusAt) return batchFailJob(j, "no status", token);
        return setTimeout(() => pollBatchJob(j, token), 450);
      }
      j.lastStatusAt = Date.now();
      j.stageLabel = batchStageLabel(s);
      updateBatchStatus();
      const age = Date.now() - Number(s.time || 0);
      const noPid = !(s.pid || s.browserPid || s.viaDaemon || s.daemon);
      j._startRetries = j._startRetries || 0;
      if (s.state === "starting" && noPid && age > 25000 && j._startRetries < 2) {
        j._startRetries++;
        j.stageLabel = actions.t("statusAgentLaunch");
        actions.log("Batch item " + (j.index + 1) + ": relaunching (stale start, attempt " + j._startRetries + "/2)");
        return launchBatchAgent(j, token);
      }
      if (s.state === "starting" && noPid && age > 150000) return batchFailJob(j, "stuck: starting", token);
      if (s.state === "launching" && age > 180000) return batchFailJob(j, "stuck: launching", token);
      if (s.state === "starting" && !noPid && age > 150000) return batchFailJob(j, "stuck: starting", token);
      if (s.state === "loginRequired") return batchFailJob(j, "login required", token);
      if (s.state === "error") return batchFailJob(j, s.message || "agent error", token);
      if (s.state === "done") {
        if (s.svgPath) return placeBatchJob(j, s.svgPath, s, token);
        return batchFailJob(j, "no SVG", token);
      }
      setTimeout(() => pollBatchJob(j, token), 350);
    });
  }

  function placeBatchJob(j: any, svgPath: string, _statusObj: any, token: number) {
    const b = live.current.batch;
    if (!b || b.cancelled || token !== live.current.runToken || j.done) return;
    j.phase = "place"; j.stageLabel = actions.t("statusPlacing"); updateBatchStatus();
    const placeT0 = Date.now();
    const payload = {
      svgPath: svgPath,
      union: j.union,
      layerName: "Vectorizer",
      hideOriginal: !!live.current.settings.hideOriginal,
      docFullName: j.docFullName || b.docFullName,
      docName: j.docName || b.docName,
      batchIndex: j.index,
      batchJobId: j.jobId || b.jobId || "",
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    evalJsx(`VB.placeSVG(${JSON.stringify(encoded)})`, (result: string) => {
      if (token !== live.current.runToken || !live.current.batch || j.done) return;
      const r = parseResult(result);
      const totalMs = Date.now() - (j.startedAt || placeT0);
      if (r.ok) {
        j.done = true; j.phase = "done"; b.ok++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
        actions.addHistory("batchPlaced", "#" + (j.index + 1), true, (r.embedded ? "" : "(linked) ") + actions.fmtElapsed(totalMs));
      } else {
        j.done = true; j.phase = "failed"; b.failed++; b.doneCount++; b.active = Math.max(0, (b.active || 0) - 1);
        actions.addHistory("batchFailed", "#" + (j.index + 1), false, (r.error || "place failed") + " · " + actions.fmtElapsed(totalMs));
      }
      if (!b.cancelled) { actions.setState({ busy: (b.active > 0), waiting: (b.active > 0) }); actions.updateButtons(); updateBatchStatus(); scheduleBatch(token); batchMaybeFinish(); }
      else batchMaybeFinish();
    });
  }

  const waitForWarmDaemon = useCallback((workers: number, token: number, done: () => void, batchOverride?: any) => {
    const deadline = Date.now() + 20000;
    let started = false;
    actions.log("Waiting for warm Chrome (workers=" + workers + ") …");
    function poll() {
      if (token !== live.current.runToken || !(live.current.batch || batchOverride)) return;
      evalJsx("VB.daemonStatus()", (text: string) => {
        if (token !== live.current.runToken || !(live.current.batch || batchOverride)) return;
        const s = parseResult(text) || {};
        if (s && (s.port || s.state)) actions.setState({ daemon: s as any });
        const running = (s.state === "running" || s.state === "ready");
        const cur = parseInt(s.workers, 10);
        if (running && (!isFinite(cur) || cur >= workers)) return done();
        if (!started) {
          started = true;
          evalJsx(`VB.agentStart('daemon-start', '', ${JSON.stringify(String(workers))})`, (r: any) => {
            if (String(r) !== "started") actions.log("Warm Chrome start failed: " + r);
          });
        }
        if (Date.now() > deadline) {
          actions.log("Warm Chrome was not ready in 20s; continuing with per-item launches.");
          return done();
        }
        setTimeout(poll, 500);
      });
    }
    poll();
  }, [live.current.runToken, live.current.batch, evalJsx, parseResult, actions, live]);

  const vectorize = useCallback(() => {
    if (live.current.busy || live.current.waiting || live.current.login) return;
    if (!hostOk) { actions.showError(actions.t("errorHost")); return; }
    /* A new attempt hides the previous failure instead of leaving it on screen. */
    actions.setState({ _errorText: "" });
    lastBatchStatusRef.current = "";
    const token = (live.current.runToken || 0) + 1;
    actions.setState({ runToken: token, busy: true, batch: null });
    actions.updateButtons();
    actions.setStatus(actions.t("statusExporting"));
    actions.setDetail("");
    const size = parseInt(String(live.current.settings.pngLongSide), 10);
    const sizeFinite = isFinite(size) ? size : 1700;
    evalJsx(`VB.prepareBatch(${sizeFinite})`, (result: string) => {
      if (token !== live.current.runToken) return;
      const r = parseResult(result);
      if (!r.ok) {
        actions.setState({ busy: false });
        actions.updateButtons();
        actions.setStatus(actions.t("statusExportFailed") + " " + friendlyError(String(r.error || "")));
        actions.setDetail("");
        actions.addHistory("exportFailed", "", false, r.error || "");
        return;
      }
      const count = parseInt(String(r.count), 10) || 0;
      if (count <= 0) { actions.setState({ busy: false }); actions.updateButtons(); actions.setStatus(actions.t("batchNoItems")); return; }
      const jobs: any[] = [];
      for (let i = 0; i < count; i++) jobs.push({ index: i, phase: "pending", done: false, union: null, pngPath: "", statusPath: "", stageLabel: "", startedAt: 0, exportMs: 0, agentStartedAt: 0, lastStatusAt: 0, busyRetries: 0, _startRetries: 0, docFullName: "", docName: "", jobId: "" });
      const batch = {
        total: count, next: 0, ok: 0, failed: 0, skipped: 0, doneCount: 0, active: 0, cancelled: false,
        docFullName: r.docFullName || "", docName: r.docName || "", jobId: r.jobId || String(Date.now()), jobs: jobs,
      };
      actions.setState({ waiting: true, runStartedAt: Date.now(), batch });
      daemonTriesRef.current = {};
      const workers = Math.max(1, Math.min(4, parseInt(String(live.current.settings.batchWorkers), 10) || 1));
      actions.log("Batch start: " + count + " item(s), workers=" + workers);
      function beginParallelBatch() {
        if (token !== live.current.runToken) return;
        updateBatchStatus(undefined, batch);
        if (!live.current.settings.warmDaemon) return scheduleBatch(token, batch);
        ensureAgentPaths(() => {
          if (token !== live.current.runToken) return;
          waitForWarmDaemon(workers, token, () => scheduleBatch(token, batch), batch);
        });
      }
      if (!live.current.bridgeFolder && hostOk) {
        evalJsx("VB.getBridgeFolderPath()", (bp: string) => {
          actions.setState({ bridgeFolder: String(bp || "").replace(/^"|"$/g, "") });
          beginParallelBatch();
        });
      } else {
        beginParallelBatch();
      }
    });
  }, [live, actions, evalJsx, parseResult, friendlyError, updateBatchStatus, ensureAgentPaths, waitForWarmDaemon, hostOk]);

  function startBatchJob(j: any, token: number, batchOverride?: any) {
    const b = live.current.batch || batchOverride;
    if (!b || b.cancelled || token !== live.current.runToken || !j || j.done) return;
    j.phase = "exporting"; j.startedAt = Date.now(); b.active = (b.active || 0) + 1;
    j.stageLabel = actions.t("statusExporting"); updateBatchStatus();
    actions.setState({ busy: (b.active > 0), waiting: (b.active > 0) });
    actions.updateButtons();
    let size = parseInt(String(live.current.settings.pngLongSide), 10); if (!isFinite(size)) size = 1700;
    const exportT0 = Date.now();
    evalJsx(`VB.exportBatchItem(${j.index},${size},${JSON.stringify(b.jobId || "")})`, (result: string) => {
      if (token !== live.current.runToken || !live.current.batch || live.current.batch.cancelled) return;
      const r = parseResult(result);
      j.exportMs = Date.now() - exportT0;
      if (!r.ok) return batchFailJob(j, (r.error || "") + " - " + friendlyError(String(r.error || "")), token);
      if (r.pixelCapped) actions.log("Item #" + (j.index + 1) + ": PNG reduced to " + (r.megapixels || "?") + " MP to fit the site input limit.");
      j.union = r.union || null; j.pngPath = r.pngPath || "";
      j.docFullName = r.docFullName || b.docFullName || ""; j.docName = r.docName || b.docName || "";
      j.jobId = r.jobId || b.jobId || "";
      if (!j.union) return batchSkipJob(j, "emptyBounds", token);
      if (!j.pngPath) return batchFailJob(j, "export produced no PNG", token);
      j.phase = "agent"; j.stageLabel = actions.t("statusUploading"); j.statusPath = batchJobStatusPath(j); j.agentStartedAt = Date.now(); j.lastStatusAt = 0; j.busy = 0; j.busyRetries = 0; j._startRetries = 0;
      updateBatchStatus();
      launchBatchAgent(j, token);
    });
  }

  // Expose on window.VBPanel: the components trigger vectorize through it
  useEffect(() => {
    (window as any).VBPanel = (window as any).VBPanel || {};
    (window as any).VBPanel.queue = (window as any).VBPanel.queue || {};
    (window as any).VBPanel.queue.batchLabel = batchLabel;
    (window as any).VBPanel.queue.updateBatchStatus = updateBatchStatus;
    (window as any).VBPanel.queue.scheduleBatch = scheduleBatch;
    (window as any).VBPanel.queue.finishBatch = finishBatch;
    (window as any).VBPanel.queue.vectorize = vectorize;
  }, [batchLabel, updateBatchStatus, scheduleBatch, finishBatch, vectorize]);

  return { vectorize, updateBatchStatus, finishBatch, scheduleBatch, batchLabel };
}
