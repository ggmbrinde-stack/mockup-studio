import { useEffect, useMemo, useRef, useCallback } from "react";
import { useCore } from "../context/core-context";
import { hostBridge, setHostOk, getCS, useHost } from "../hooks/use-host";

/* The host scripts are loaded once per panel, whatever React does with its effects. */
let booted = false;

export function useVectorizer() {
  const { actions } = useCore();
  const { evalJsx, parseResult, friendlyError } = useHost(actions.t);
  /* Stable holder: .current always resolves to the newest state, so callbacks created in an
     earlier render never read a stale snapshot. */
  const live = useMemo(() => ({ get current() { return actions.live; } }), [actions]);
  const daemonPollTimerRef = useRef<any>(null);
  const updatePollTimerRef = useRef<any>(null);
  const updateConfirmArmedRef = useRef(false);
  const updateConfirmTimerRef = useRef<any>(null);

  const setSvgHistory = useCallback((files: any[]) => {
    actions.setState({ _svgFiles: files || [] });
  }, [actions]);

  const refreshSvgHistory = useCallback(() => {
    if (!hostBridge.hostOk) return;
    evalJsx("VB.listVectorizedSvgs(30)", (text: string) => {
      const r = parseResult(text);
      setSvgHistory(r && r.ok && r.files ? r.files : []);
    });
  }, [evalJsx, parseResult, setSvgHistory]);

  const revealFile = useCallback((path: string) => {
    if (!hostBridge.hostOk) return;
    evalJsx(`VB.revealFile ? VB.revealFile(${JSON.stringify(path || "")}) : VB.openFolder(${JSON.stringify(path || "")})`);
  }, [evalJsx]);

  /* Manual Place from the history: any open document, original stays visible. */
  const placeHistoryFile = useCallback((f: any) => {
    if (!hostBridge.hostOk) return;
    actions.setStatus(actions.t("statusPlacing"));
    const payload = { svgPath: f.path || "", layerName: "Vectorizer", hideOriginal: false, allowAnyDoc: true };
    evalJsx(`VB.placeSVG(${JSON.stringify(encodeURIComponent(JSON.stringify(payload)))})`, (res: string) => {
      const r = parseResult(res);
      if (r.ok) { actions.setStatusKey("statusPlaced"); actions.addHistory("placed", f.name || "", true, "from history"); refreshSvgHistory(); }
      else { actions.setStatus(actions.t("statusPlaceFailed") + " " + friendlyError(String(r.error || ""))); }
    });
  }, [actions, evalJsx, parseResult, friendlyError, refreshSvgHistory]);

  const signIn = useCallback(() => {
    if (live.current.busy || live.current.waiting || live.current.login) return;
    if (!hostBridge.hostOk) { actions.showError(actions.t("errorHost")); return; }
    actions.setState({ _errorText: "" });
    evalJsx("VB.agentStart('login', '')", (started: any) => {
      if (String(started) !== "started") { actions.setStatus(actions.t("statusAgentError") + " " + String(started)); return; }
      actions.setState({ login: true, loginKind: "login", waitStartedAt: Date.now(), lastStatusAt: 0 });
      actions.setStatus(actions.t("statusSignInOpen"));
      actions.setDetail(actions.t("statusSignInHint"));
    });
  }, [live, actions, evalJsx]);

  const cancel = useCallback(() => {
    const wasRunning = live.current.waiting || live.current.login || live.current.busy;
    const elapsed = actions.runElapsedMs();
    const b = live.current.batch;
    actions.setState({ runToken: (live.current.runToken || 0) + 1 });
    if (b) b.cancelled = true;
    actions.setState({ busy: false, waiting: false, login: false, loginKind: "", waitStartedAt: 0, lastStatusAt: 0, runStartedAt: 0, pngPath: "", union: null });
    if (b) {
      actions.setStatus(actions.t("statusBatchCancelled").replace("{ok}", String(b.ok || 0)).replace("{n}", String(b.total || 0)));
      actions.setDetail(elapsed ? ("⏱ " + actions.fmtElapsed(elapsed)) : "");
      actions.addHistory("batchFailed", b.docName || "", false, "cancelled at " + (b.doneCount || 0) + "/" + (b.total || 0));
      actions.setState({ batch: null });
      /* finishBatch does this too; a cancelled batch must not leave its VB_BATCH
         notes/tags on the document until the next run happens to clear them. */
      try { evalJsx("VB.restoreBatchNotes()", () => { }); } catch { }
      actions.events.emit("batch:finished", { cancelled: true, ok: b.ok || 0, failed: b.failed || 0, skipped: b.skipped || 0, total: b.total || 0, docName: b.docName || "" });
    } else {
      actions.setStatus(actions.t("statusCancelled"));
      actions.setDetail(elapsed ? ("⏱ " + actions.fmtElapsed(elapsed) + " · " + actions.t("statusCancelled")) : actions.t("statusCancelled"));
    }
    if (wasRunning) {
      evalJsx("VB.agentStopAll ? VB.agentStopAll() : VB.agentStop()");
      setTimeout(() => { if (hostBridge.hostOk) evalJsx("VB.agentStatus()"); }, 1200);
    }
  }, [live, actions, evalJsx]);

  const handleLoginState = useCallback((s: any) => {
    if (s.state === "loginOpen" || s.state === "loginWindow") {
      actions.setStatus(actions.t("statusSignInOpen"));
    } else if (s.state === "loginClosed") {
      actions.setState({ login: false, loginKind: "" });
      actions.setStatus(actions.t("statusSignInClosed"));
      actions.setDetail("");
      actions.addHistory("signedIn", "", true, "");
    } else if (s.state === "error") {
      actions.setState({ login: false });
      actions.setStatus(actions.t("statusAgentError") + " " + (s.message || ""));
    }
  }, [actions]);

  const placeSvg = useCallback((svgPath: string) => {
    const u = live.current.union;
    if (live.current.batch) return;
    if (!u) {
      actions.setStatus(actions.t("statusAgentError") + " " + actions.t("errorEmptyBounds"));
      const e0 = actions.runElapsedMs();
      actions.setState({ runStartedAt: 0 });
      actions.setDetail(e0 ? "⏱ " + actions.fmtElapsed(e0) : "");
      return;
    }
    actions.setStatus(actions.t("statusPlacing"));
    const placeT0 = Date.now();
    const payload = { svgPath: svgPath, union: u, layerName: "Vectorizer", hideOriginal: !!live.current.settings.hideOriginal, docFullName: live.current.docFullName, docName: live.current.docName };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const fileName = String(svgPath).replace(/^.*[\/]/, "");
    evalJsx(`VB.placeSVG(${JSON.stringify(encoded)})`, (result: string) => {
      const r = parseResult(result);
      const placeMs = Date.now() - placeT0;
      const totalMs = actions.runElapsedMs();
      const exportMs = live.current.exportMs;
      const docName = live.current.docName;
      actions.setState({ runStartedAt: 0 });
      const timing = "⏱ total " + actions.fmtElapsed(totalMs) + " (export " + actions.fmtElapsed(exportMs) + ", place " + actions.fmtElapsed(placeMs) + ")";
      if (r.ok) {
        if (r.embedded) { actions.setStatusKey("statusPlaced"); actions.setDetail(timing); }
        else { actions.setStatus(actions.t("statusPlacingLinked")); actions.setDetail(timing + (r.error ? " · " + r.error : "")); }
        actions.addHistory("placed", fileName, true, (r.embedded ? "" : "(linked) ") + timing);
        refreshSvgHistory();
        actions.log("Placed: " + svgPath + (r.embedded ? "" : " (linked)") + " — " + timing);
      } else {
        actions.setStatus(actions.t("statusPlaceFailed") + " " + friendlyError(String(r.error || "")));
        actions.setDetail((r.error === "docChanged" ? actions.t("switchDoc") + " " + docName + " · " : "") + timing);
        actions.addHistory("placeFailed", fileName, false, (r.error || "") + " · " + timing);
        actions.log("Place failed: " + (r.error || "unknown") + " — " + timing);
      }
    });
  }, [live, actions, evalJsx, parseResult, refreshSvgHistory, friendlyError]);

  const handleRunState = useCallback((s: any) => {
    if (live.current.runStartedAt) actions.setRunTimerDetail("");
    switch (s.state) {
      case "starting": case "launching": case "loading": case "uploading":
      case "vectorizing": case "result": case "downloading": {
        const map: Record<string, string> = { starting: "statusAgentLaunch", launching: "statusAgentLaunch", loading: "statusAgentLoading", uploading: "statusUploading", vectorizing: "statusVectorizing", result: "statusResult", downloading: "statusDownloading" };
        const stKey = map[s.state] || "statusVectorizing";
        if (stKey === "statusVectorizing") actions.setStatusKey(stKey); else actions.setStatus(actions.t(stKey));
        break;
      }
      case "loginRequired":
        actions.setState({ waiting: false, shortcutStatusPath: "" });
        actions.setStatusKey("statusLoginRequired");
        actions.setDetail((s.message || actions.t("statusSignInHint")) + (live.current.runStartedAt ? " · ⏱ " + actions.fmtElapsed(actions.runElapsedMs()) : ""));
        actions.addHistory("loginRequired", "", false, actions.fmtElapsed(actions.runElapsedMs()));
        actions.setState({ runStartedAt: 0 });
        break;
      case "error": {
        actions.setState({ waiting: false, shortcutStatusPath: "" });
        const elapsed = actions.runElapsedMs();
        actions.setState({ runStartedAt: 0 });
        actions.setStatus(actions.t("statusAgentError") + " " + (s.message || ""));
        let detail = s.message || "";
        if (elapsed) detail = (detail ? detail + " · " : "") + "⏱ " + actions.fmtElapsed(elapsed);
        actions.setDetail(detail);
        actions.addHistory("vectorizeFailed", "", false, (s.message || "") + (elapsed ? " · " + actions.fmtElapsed(elapsed) : ""));
        break;
      }
      case "done":
        actions.setState({ waiting: false, shortcutStatusPath: "" });
        if (s.svgPath) { if (s.elapsedMs) actions.setRunTimerDetail("agent " + actions.fmtElapsed(Number(s.elapsedMs))); placeSvg(s.svgPath); }
        else { const e2 = actions.runElapsedMs(); actions.setState({ runStartedAt: 0 }); actions.setStatus(actions.t("statusAgentError") + " (no SVG)"); actions.setDetail(e2 ? "⏱ " + actions.fmtElapsed(e2) : ""); }
        break;
    }
  }, [live, actions, placeSvg]);

  const pollOnce = useCallback(() => {
    if (!hostBridge.hostOk) return;
    if (live.current.batch) return;
    if (!live.current.waiting && !live.current.login) return;
    const spArg = live.current.shortcutStatusPath ? ("(" + JSON.stringify(live.current.shortcutStatusPath) + ")") : "()";
    evalJsx(`VB.agentStatus${spArg}`, (text: string) => {
      let s: any = {};
      try { s = JSON.parse(String(text || "{}")); } catch { return; }
      if (!s || !s.state) {
        if (live.current.lastStatusAt === 0 && live.current.waitStartedAt && Date.now() - live.current.waitStartedAt > 60000) {
          const wasLogin = live.current.login;
          actions.setState({ waiting: false, login: false, waitStartedAt: 0, shortcutStatusPath: "" });
          actions.setStatus(actions.t("statusAgentError") + " " + actions.t("errorAgentStart"));
          if (wasLogin) actions.addHistory("signedIn", "", true, "window closed");
          else actions.addHistory("vectorizeFailed", "", false, "no status");
        }
        return;
      }
      actions.setState({ lastStatusAt: Date.now() });
      if (live.current.waiting && live.current.waitStartedAt && Date.now() - live.current.waitStartedAt > 90000 &&
        (s.state === "starting" || s.state === "launching") &&
        Number(s.time || 0) > 0 && (Date.now() - Number(s.time || 0)) > 90000) {
        actions.setState({ waiting: false, waitStartedAt: 0, shortcutStatusPath: "" });
        actions.setStatus(actions.t("statusAgentError") + " " + actions.t("errorAgentStart"));
        actions.addHistory("vectorizeFailed", "", false, "stuck: " + s.state);
        return;
      }
      if (live.current.login) handleLoginState(s);
      else if (live.current.waiting) handleRunState(s);
    });
  }, [live, actions, evalJsx, handleLoginState, handleRunState]);

  const refreshDaemonStatus = useCallback(() => {
    if (!hostBridge.hostOk) return;
    evalJsx("VB.daemonStatus()", (text: string) => {
      const r = parseResult(text);
      if (r && (r.state || r.ok === false)) actions.setState({ daemon: { ...live.current.daemon, ...(r as any), ui: "" } });
    });
  }, [actions, evalJsx, parseResult]);

  const ensureDaemonRunning = useCallback(() => {
    if (!hostBridge.hostOk || !live.current.settings.warmDaemon) return;
    const want = Math.max(1, Math.min(4, parseInt(String(live.current.settings.batchWorkers), 10) || 1));
    evalJsx("VB.daemonStatus()", (text: string) => {
      const r = parseResult(text);
      const running = !!(r && (r.state === "running" || r.state === "ready"));
      const cur = parseInt(r && r.workers, 10);
      if (running && (!isFinite(cur) || cur === want)) { actions.setState({ daemon: { ...live.current.daemon, ...(r as any), ui: "" } }); return; }
      actions.setState({ daemon: { ...(r || live.current.daemon), ui: "starting" } as any });
      function startDaemon() {
        evalJsx(`VB.agentStart('daemon-start', '', ${JSON.stringify(String(want))})`, (started: any) => {
          if (String(started) !== "started") {
            actions.log("Warm daemon start failed: " + started);
            actions.setState(prev => ({ ...prev, daemon: { ...prev.daemon, ui: "error" } }));
          } else {
            actions.log("Warm Chrome starting… (workers=" + want + ")");
            setTimeout(refreshDaemonStatus, 1500);
            setTimeout(refreshDaemonStatus, 5000);
            setTimeout(refreshDaemonStatus, 10000);
          }
        });
      }
      if (running && isFinite(cur) && cur !== want) {
        actions.log("Restarting warm Chrome for workers " + cur + " -> " + want);
        evalJsx("VB.agentStart('daemon-stop','')", () => {
          actions.setState({ daemon: { state: "stopped", busy: false, ui: "" } });
          setTimeout(startDaemon, 900);
        });
      } else startDaemon();
    });
  }, [live, actions, evalJsx, parseResult, refreshDaemonStatus]);

  const stopWarmDaemon = useCallback(() => {
    if (!hostBridge.hostOk) return;
    actions.setState(prev => ({ ...prev, daemon: { ...prev.daemon, ui: "stopping" } }));
    evalJsx("VB.agentStart('daemon-stop', '')", () => {
      actions.setState({ daemon: { state: "stopped", busy: false, ui: "" } });
      actions.log("Warm Chrome stopped.");
    });
  }, [actions, evalJsx]);

  // --- Updater UI ---
  // Every change is user-triggered; "apply" still needs a second click within 8 s.

  const updateText = useCallback((key: string, value?: string): string => {
    let s = actions.t(key) || "";
    return value ? s.replace("{version}", value) : s;
  }, [actions]);

  const renderUpdate = useCallback((r: any) => {
    if (!r || !r.state) return;
    const u = live.current.update;
    const st = String(r.state);
    const staged = st === "done";
    let statusText = "";
    switch (st) {
      case "checking": statusText = updateText("updateChecking"); break;
      case "available": statusText = updateText("updateAvailable", r.latest); break;
      case "uptodate": statusText = updateText("updateUpToDate", r.latest || r.current); break;
      case "downloading": statusText = updateText("updateDownloading"); break;
      case "installing": statusText = updateText(r.restoring ? "updateRestoring" : "updateInstalling"); break;
      case "done": statusText = updateText("updateDone", r.version); break;
      case "restored": statusText = updateText("updateRestored", r.version); break;
      case "error": statusText = updateText("updateFailed") + " " + (r.message || ""); break;
    }
    let notes = "";
    if (st === "available" || st === "uptodate") {
      const raw = r && r.notes ? String(r.notes).replace(/\r\n/g, "\n").trim() : "";
      const version = String((r && (r.version || r.latest || r.current)) || "").replace(/^v/i, "");
      notes = raw ? (version ? "v" + version + " — " : "") + raw.replace(/[\r\n]+/g, " \u2022 ") : "";
    }
    actions.setState({
      updateArmed: st === "available" ? u && live.current.updateArmed : false,
      update: {
        ...u,
        available: st === "available",
        checking: st === "checking",
        downloading: st === "downloading" || st === "installing",
        staged,
        remoteVersion: r.latest || r.version || (staged ? u.remoteVersion : "") || "",
        stagedVersion: staged ? String(r.version || "") : u.stagedVersion,
        current: r.current || u.current,
        statusText,
        notes,
        needsRestart: staged || st === "restored",
      },
    });
  }, [live, actions, updateText]);

  const refreshUpdateInfo = useCallback(() => {
    if (!hostBridge.hostOk) return;
    evalJsx("VB.updateStatus()", (txt: string) => {
      const r = parseResult(txt);
      if (r && r.state) renderUpdate(r);
      evalJsx("VB.updateBackups()", (txt2: string) => {
        const b = parseResult(txt2);
        actions.setState(prev => {
          const has = !!(b && b.backups && b.backups.length);
          return prev.update.hasBackups === has ? prev : { ...prev, update: { ...prev.update, hasBackups: has } };
        });
      });
    });
  }, [actions, evalJsx, parseResult, renderUpdate]);

  const pollUpdate = useCallback((attempt: number) => {
    if (attempt > 180) return;
    if (updatePollTimerRef.current) try { clearTimeout(updatePollTimerRef.current); } catch { }
    updatePollTimerRef.current = setTimeout(() => {
      evalJsx("VB.updateStatus()", (txt: string) => {
        const r = parseResult(txt);
        if (r && r.state) {
          renderUpdate(r);
          if (r.state === "checking" || r.state === "downloading" || r.state === "installing") { pollUpdate(attempt + 1); return; }
        }
        refreshUpdateInfo();
      });
    }, 1000);
  }, [evalJsx, parseResult, renderUpdate, refreshUpdateInfo]);

  const startUpdate = useCallback((action: string) => {
    if (!hostBridge.hostOk) { actions.showError(actions.t("errorHost")); return; }
    evalJsx(`VB.startUpdate('${action}')`, (res: any) => {
      const out = String(res || "");
      if (out !== "started") { renderUpdate({ state: "error", message: out.replace(/^error:\s*/, "") }); return; }
      renderUpdate({ state: action === "check" ? "checking" : "installing", restoring: action === "restore" });
      pollUpdate(0);
    });
  }, [actions, evalJsx, renderUpdate, pollUpdate]);

  const armOrApplyUpdate = useCallback(() => {
    if (updateConfirmArmedRef.current) {
      updateConfirmArmedRef.current = false;
      if (updateConfirmTimerRef.current) try { clearTimeout(updateConfirmTimerRef.current); } catch { }
      updateConfirmTimerRef.current = null;
      actions.setState({ updateArmed: false });
      startUpdate("apply");
      return;
    }
    updateConfirmArmedRef.current = true;
    actions.setState({ updateArmed: true });
    updateConfirmTimerRef.current = setTimeout(() => {
      updateConfirmArmedRef.current = false;
      updateConfirmTimerRef.current = null;
      actions.setState({ updateArmed: false });
    }, 8000);
  }, [actions, startUpdate]);

  const autoCheckUpdates = useCallback(() => {
    if (!hostBridge.hostOk) return;
    try { if (sessionStorage.getItem("vb_update_dismissed") === "1") return; } catch { }
    startUpdate("check");
  }, [startUpdate]);

  const init = useCallback(() => {
    if (booted) return;
    booted = true;
    if (!getCS()) {
      actions.showError("CSInterface failed: CSInterface is not available");
      actions.setStatusKey("statusHostError");
      return;
    }
    actions.setStatus(actions.t("statusLoadingHost"));
    hostBridge.loadHost((result: string) => {
      if (String(result) !== "ok") {
        setHostOk(false);
        actions.showError(actions.t("errorHost") + " (" + result + ")");
        actions.setStatusKey("statusHostError");
        return;
      }
      setHostOk(true);
      actions.setStatusKey("statusReady");
      actions.setDetail("");
      evalJsx("VB.getBridgeFolderPath()", (bp: string) => {
        actions.setState({ bridgeFolder: String(bp || "").replace(/^"|"$/g, "") });
      });
      refreshDaemonStatus();
      refreshSvgHistory();
      refreshUpdateInfo();
      setTimeout(() => { try { autoCheckUpdates(); } catch { } }, 1500);
      if (live.current.settings.warmDaemon) ensureDaemonRunning();
      evalJsx("VB.selfTest()", (selfTest: string) => {
        const st = parseResult(selfTest);
        actions.log("Host self-test: " + selfTest);
        if (!st.ok || !st.parsed) actions.showError(actions.t("errorJson") + " (" + selfTest + ")");
      });
    });
  }, [live, actions, evalJsx, parseResult, refreshDaemonStatus, refreshSvgHistory, refreshUpdateInfo, autoCheckUpdates, ensureDaemonRunning]);

  useEffect(() => {
    init();
    const onPoll = () => pollOnce();
    const onBatchFinished = () => { try { refreshSvgHistory(); } catch { } };
    actions.events.on("poll:tick", onPoll);
    actions.events.on("batch:finished", onBatchFinished);
    if (daemonPollTimerRef.current) try { clearTimeout(daemonPollTimerRef.current); } catch { }
    function scheduleDaemonPoll() {
      daemonPollTimerRef.current = setTimeout(() => {
        if (live.current.settings.warmDaemon) refreshDaemonStatus();
        scheduleDaemonPoll();
      }, 15000);
    }
    scheduleDaemonPoll();
    return () => {
      actions.events.off("poll:tick", onPoll);
      actions.events.off("batch:finished", onBatchFinished);
      if (daemonPollTimerRef.current) try { clearTimeout(daemonPollTimerRef.current); } catch { }
      if (updatePollTimerRef.current) try { clearTimeout(updatePollTimerRef.current); } catch { }
      if (updateConfirmTimerRef.current) try { clearTimeout(updateConfirmTimerRef.current); } catch { }
    };
  }, [init, pollOnce, refreshSvgHistory, refreshDaemonStatus, actions.events, live.current.settings.warmDaemon]);

  // Expose on window.VBPanel: the components reach the vectorizer through it.
  useEffect(() => {
    const g = window as any;
    g.VBPanel = g.VBPanel || {};
    g.VBPanel.vectorizer = {
      signIn, cancel, ensureDaemonRunning, stopWarmDaemon, refreshSvgHistory, revealFile, placeHistoryFile,
      armOrApplyUpdate, startUpdate,
    };
  }, [signIn, cancel, ensureDaemonRunning, stopWarmDaemon, refreshSvgHistory, revealFile, placeHistoryFile, armOrApplyUpdate, startUpdate]);

  return { signIn, cancel, ensureDaemonRunning, stopWarmDaemon, refreshSvgHistory };
}
