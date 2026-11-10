/* Vectorizer Bridge - launches the Node agent that drives vectorizer.ai.
   All shell work goes through a hidden VBScript because Illustrator's
   ExtendScript has no `system` object. v2: per-job status paths + unique
   launchers for bounded parallel batch (same profile; never concurrent Chrome). */

var VB = $.global.VB;

VB.agentPaths = function () {
  var ext = String(VB.extensionPath).replace(/\\/g, "/");
  var bridge = VB.getBridgeFolderPath();
  return {
    agent: ext + "/agent",
    run: ext + "/agent/run.js",
    login: ext + "/agent/login.js",
    profile: bridge + "/vectorizer-profile",
    out: bridge + "/agent-downloads",
    status: bridge + "/agent-status.json",
    debug: bridge + "/agent-debug",
    log: bridge + "/agent-log.txt",
    work: bridge
  };
};

VB.agentStatusPath = function () { return VB.agentPaths().status; };

VB.daemonStatus = function () {
  try {
    var p = VB.agentPaths();
    var text = VB.readTextFile(p.work + "/agent-daemon.json");
    if (!text) return VB.toJSON({ state: "stopped" });
    var s = null; try { s = VB.fromJSON(text); } catch (e0) { s = null; }
    if (!s || !s.port) return VB.toJSON({ state: "stopped" });
    var age = new Date().getTime() - Number(s.time || 0);
    if (!(age >= 0 && age < 30 * 60 * 1000)) return VB.toJSON({ state: "stale" });
    return VB.toJSON({ state: "running", port: s.port, pid: s.pid, browserPid: s.browserPid, workers: s.workers || 1 });
  } catch (e) { return VB.toJSON({ state: "stopped" }); }
};

VB.getNodeExe = function () {
  var candidates = [];
  try { candidates.push(String($.getenv("ProgramFiles")).replace(/\\/g, "/") + "/nodejs/node.exe"); } catch (e) { }
  try { candidates.push(String($.getenv("ProgramW6432")).replace(/\\/g, "/") + "/nodejs/node.exe"); } catch (e2) { }
  try { candidates.push(String($.getenv("LOCALAPPDATA")).replace(/\\/g, "/") + "/Programs/nodejs/node.exe"); } catch (e2b) { }
  try {
    var user = String($.getenv("USERPROFILE")).replace(/\\/g, "/");
    candidates.push(user + "/scoop/apps/nodejs-lts/current/node.exe");
    candidates.push(user + "/scoop/apps/nodejs/current/node.exe");
    candidates.push(user + "/AppData/Roaming/nvm/current/node.exe");
    candidates.push(user + "/AppData/Local/Volta/bin/node.exe");
  } catch (e2c) { }
  candidates.push("C:/Program Files/nodejs/node.exe");
  for (var i = 0; i < candidates.length; i++) {
    try { var f = new File(candidates[i]); if (f.exists) return f.fsName; } catch (e3) { }
  }
  return "node";
};

VB.ensureFolder = function (path) {
  try { var f = new Folder(path); if (!f.exists) f.create(); return true; } catch (e) { return false; }
};
VB.quote = function (value) { return '"' + String(value).replace(/"/g, "") + '"'; };

VB._agentStatusDefault = function () {
  try { var p = VB.agentPaths(); return p.status; } catch (e) { return ""; }
};
VB._isSafeStatusPath = function (p, statusPath) {
  try {
    if (!statusPath) return true;
    var s = String(statusPath).replace(/\\/g, "/").toLowerCase();
    var w = String(p.work).replace(/\\/g, "/").toLowerCase();
    return s.indexOf(w) === 0 && s.indexOf("agent-status") >= 0 && /\.json$/i.test(s);
  } catch (e) { return false; }
};
VB._statusKey = function (statusPath) {
  try {
    var n = String(statusPath).replace(/^.*[\\\/]/, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    return n || "run";
  } catch (e) { return "run"; }
};

/* mode: "run" | "login" | "daemon-start" | "daemon-stop" | "daemon-status".
   For "run", extra may be a per-job status JSON path (bounded parallel batch).
   For "daemon-start", extra may be worker count ("1"-"4").
   Returns "started" or "error: ...". */
VB.agentStart = function (mode, pngPath, extra) {
  try {
    var p = VB.agentPaths();
    VB.ensureFolder(p.profile); VB.ensureFolder(p.out); VB.ensureFolder(p.debug); VB.ensureFolder(p.work);

    var node = VB.getNodeExe();
    var script = (mode === "login") ? p.login : p.run;
    var scriptFile = new File(script);
    if (!scriptFile.exists) return "error: agent script not found: " + script;

    var statusPath = p.status;
    var customStatus = false;
    if (mode === "run" && extra && String(extra).length > 5) {
      if (VB._isSafeStatusPath(p, extra)) { statusPath = String(extra).replace(/\\/g, "/"); customStatus = (statusPath.toLowerCase() !== String(p.status).replace(/\\/g, "/").toLowerCase()); }
    }

    if (mode === "run") {
      var statusFile = new File(statusPath);
      try {
        if (statusFile.exists) {
          try {
            var prevRaw = VB.readTextFile(statusPath);
            var prev = prevRaw ? VB.fromJSON(prevRaw) : null;
            var prevAge = prev ? (new Date().getTime() - Number(prev.time || 0)) : 9999999;
            var prevBusy = prev && prev.state && prev.state !== "done" && prev.state !== "error" && prev.state !== "loginClosed" && prev.state !== "cancelled";
            var prevHasPid = !!(prev && (parseInt(prev.pid, 10) > 0 || parseInt(prev.browserPid, 10) > 0 || prev.viaDaemon === true || prev.daemon === true));
            // Allow takeover of a stale pre-launch "starting" marker with no evidence of a live process.
            var staleLaunch = (prev && prev.state === "starting" && !prevHasPid && prevAge >= 12000);
            if (prevBusy && prevAge >= 0 && prevAge < 120000 && !staleLaunch) {
              VB.log("agentStart blocked: previous run still active (" + prev.state + ") status=" + statusPath);
              return "error: previous run is still starting or using this profile. Cancel it and wait a moment, then try again.";
            }
          } catch (ePrev) {}
        }
        statusFile.encoding = "UTF-8";
        if (statusFile.open("w")) { statusFile.write('{"time":' + (new Date().getTime()) + ',"state":"starting"}'); statusFile.close(); }
        else if (statusFile.exists) { statusFile.remove(); }
      } catch (eStatus) { try { if (statusFile.exists) statusFile.remove(); } catch (eStatus2) { } }
    } else if (mode !== "login" && mode.indexOf("daemon-") !== 0) {
      var statusFile0 = new File(p.status);
      try { if (statusFile0.exists) statusFile0.remove(); } catch (eS0) {}
    }

    if (mode === "login") {
      try {
        var di = VB.readTextFile(p.work + "/agent-daemon.json");
        if (di) {
          try { var df = new File(p.work + "/agent-daemon.json"); if (df.exists) df.remove(); } catch (eDr) {}
          try {
            var ds = VB.fromJSON(di); var dPids = [];
            if (ds && parseInt(ds.pid, 10) > 0) dPids.push(parseInt(ds.pid, 10));
            if (ds && parseInt(ds.browserPid, 10) > 0 && parseInt(ds.browserPid, 10) !== parseInt(ds.pid, 10)) dPids.push(parseInt(ds.browserPid, 10));
            if (dPids.length) {
              var dv = new File(p.work + "/agent-daemon-stop.vbs"); dv.encoding = "ASCII";
              if (dv.open("w")) { dv.writeln('Dim sh'); dv.writeln('Set sh = CreateObject("WScript.Shell")'); for (var di2 = 0; di2 < dPids.length; di2++) dv.writeln('sh.Run "taskkill /PID ' + dPids[di2] + ' /T /F", 0, False'); dv.close(); dv.execute(); }
            }
          } catch (eDs) {}
        }
      } catch (eDaemonStop) {}
    }

    var args = [];
    if (mode === "login") {
      args.push(VB.quote(script)); args.push("--profile " + VB.quote(p.profile)); args.push("--status " + VB.quote(p.status)); args.push("--window app");
    } else if (mode === "daemon-start" || mode === "daemon-stop" || mode === "daemon-status") {
      var ctl = p.agent + "/daemon-ctl.js"; var ctlFile = new File(ctl);
      if (!ctlFile.exists) return "error: daemon-ctl not found: " + ctl;
      args.push(VB.quote(ctl)); args.push(mode === "daemon-start" ? "start" : (mode === "daemon-stop" ? "stop" : "status"));
      args.push("--profile " + VB.quote(p.profile)); args.push("--work " + VB.quote(p.work));
      if (mode === "daemon-start" && extra) { var wn = parseInt(extra, 10); if (isFinite(wn) && wn > 0) args.push("--workers " + wn); }
    } else {
      args.push(VB.quote(script)); args.push("--png " + VB.quote(pngPath)); args.push("--out " + VB.quote(p.out));
      args.push("--profile " + VB.quote(p.profile)); args.push("--status " + VB.quote(statusPath));
      args.push("--debug " + VB.quote(p.debug)); args.push("--work " + VB.quote(p.work)); args.push("--timeout 300000");
    }

    var launchKey = (mode === "run" && customStatus) ? VB._statusKey(statusPath) : "run";
    var cmdPath = p.work + "/agent-" + launchKey + ".cmd";
    var vbsPath = p.work + "/agent-" + launchKey + ".vbs";
    var cmd = new File(cmdPath); cmd.encoding = "ASCII";
    if (!cmd.open("w")) return "error: cannot write " + cmdPath;
    cmd.writeln("@echo off"); cmd.writeln("cd /d " + VB.quote(p.agent));
    cmd.writeln(VB.quote(node) + " " + args.join(" ") + " >> " + VB.quote(p.log) + " 2>&1");
    cmd.close();
    var vbs = new File(vbsPath); vbs.encoding = "ASCII";
    if (!vbs.open("w")) return "error: cannot write " + vbsPath;
    // VBScript: double quotes inside a string literal are escaped by doubling them.
    // Use: cmd /c "<path>"  (avoid extra wrapping quotes that can break parsing).
    var runLine = 'cmd /c "' + String(cmdPath).replace(/\//g, "\\") + '"';
    vbs.writeln('Dim sh'); vbs.writeln('Set sh = CreateObject("WScript.Shell")');
    vbs.writeln('sh.Run "' + runLine.replace(/"/g, '""') + '", 0, False');
    vbs.close(); vbs.execute();
    if (mode === "run") { try { $.sleep(300); } catch (eSleep) {} }

    VB.log("agentStart " + mode + (customStatus ? (" job=" + launchKey) : "") + " (node=" + node + ")");
    return "started";
  } catch (e) { VB.log("agentStart error: " + e); return "error: " + e; }
};

VB.agentStatus = function (statusPath) {
  try {
    var p = VB.agentPaths();
    var sp = statusPath;
    if (!sp || !VB._isSafeStatusPath(p, sp)) sp = p.status;
    return VB.readTextFile(sp);
  } catch (e) { return ""; }
};

VB._agentStopPath = function (statusPath) {
  try {
    var p = VB.agentPaths();
    var sp = statusPath;
    if (!sp || !VB._isSafeStatusPath(p, sp)) sp = p.status;
    var text = VB.readTextFile(sp);
    if (!text) return "ok";
    var status = null; try { status = VB.fromJSON(text); } catch (e0) { status = null; }
    if (!status) return "ok";
    var finished = status.state === "done" || status.state === "error" || status.state === "loginClosed" || status.state === "cancelled";
    var age = new Date().getTime() - Number(status.time || 0);
    if (finished || !(age >= 0 && age < 30 * 60 * 1000)) return "ok";

    var pids = []; var agentPid = parseInt(status.pid, 10); var browserPid = parseInt(status.browserPid, 10);
    if (agentPid > 0) pids.push(agentPid);
    if (browserPid > 0 && browserPid !== agentPid) pids.push(browserPid);

    var daemonPid = 0;
    try { var di2 = VB.readTextFile(p.work + "/agent-daemon.json"); if (di2) { var ds2 = VB.fromJSON(di2); daemonPid = ds2 ? parseInt(ds2.pid, 10) : 0; } } catch (eDp) { daemonPid = 0; }
    if (pids.length > 0 && daemonPid > 0 && (agentPid === daemonPid || browserPid === daemonPid || status.daemon === true || status.viaDaemon === true)) {
      try { var df2 = new File(p.work + "/agent-daemon.json"); if (df2.exists) df2.remove(); } catch (eDr2) {}
      VB.agentStart("daemon-stop", "");
      try { var sfD = new File(sp); sfD.encoding = "UTF-8"; if (sfD.open("w")) { sfD.write('{"time":' + (new Date().getTime()) + ',"state":"cancelled","message":"Cancelled (warm daemon stopped)."}'); sfD.close(); } } catch (eCd) {}
      VB.log("agentStop: cancelled daemon-served run (daemon stopped)");
      return "ok";
    }
    var key = VB._statusKey(sp);
    if (pids.length > 0) {
      var vbsPath = p.work + "/agent-stop-" + key + ".vbs"; var vbs = new File(vbsPath); vbs.encoding = "ASCII";
      if (vbs.open("w")) {
        vbs.writeln('Dim sh'); vbs.writeln('Set sh = CreateObject("WScript.Shell")');
        for (var i = 0; i < pids.length; i++) vbs.writeln('sh.Run "taskkill /PID ' + pids[i] + ' /T /F", 0, False');
        vbs.close(); vbs.execute();
      }
      try { var sf = new File(sp); sf.encoding = "UTF-8"; if (sf.open("w")) { sf.write('{"time":' + (new Date().getTime()) + ',"state":"cancelled"}'); sf.close(); } } catch (eC) {}
      VB.log("agentStop: taskkill /PID " + pids.join(" /PID") + " key=" + key);
      return "ok";
    }
    if (status.state === "starting" || status.state === "launching") {
      var profileNeedle = String(p.profile).replace(/\\/g, "/").toLowerCase();
      var statusNeedle = String(sp).replace(/\\/g, "/").toLowerCase();
      var psPath = p.work + "/agent-stop-" + key + ".ps1"; var ps = new File(psPath); ps.encoding = "UTF-8";
      if (ps.open("w")) {
        ps.writeln("$profileNeedle = '" + profileNeedle.replace(/'/g, "''") + "'");
        ps.writeln("$statusNeedle = '" + statusNeedle.replace(/'/g, "''") + "'");
        ps.writeln("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $c = [string]$_.CommandLine; $cl = $c.ToLower(); ($cl -like '*agent*run.js*' -or $cl -like '*agent/run.js*') -and ($cl -like ('*' + $profileNeedle + '*') -or $cl -like ('*' + $statusNeedle + '*')) } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }");
        ps.close();
        var v2 = new File(p.work + "/agent-stop-" + key + ".vbs"); v2.encoding = "ASCII";
        if (v2.open("w")) { var psCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + String(psPath).replace(/\//g, "\\") + '""'; v2.writeln('Dim sh'); v2.writeln('Set sh = CreateObject("WScript.Shell")'); v2.writeln('sh.Run "' + psCmd.replace(/"/g, '""') + '", 0, False'); v2.close(); v2.execute(); }
        VB.log("agentStop: targeted kill for early starting state key=" + key);
      }
      try { var sf2 = new File(sp); sf2.encoding = "UTF-8"; if (sf2.open("w")) { sf2.write('{"time":' + (new Date().getTime()) + ',"state":"cancelled"}'); sf2.close(); } } catch (eC2) {}
    }
    return "ok";
  } catch (e) { VB.log("agentStop error: " + e); return "error: " + e; }
};

/* Stop a specific run (statusPath) or default run. Also kills daemon-served runs cleanly. */
VB.agentStop = function (statusPath) { return VB._agentStopPath(statusPath); };

/* Stop all active Vectorizer runs for this work dir (bounded parallel batch cancel). */
VB.agentStopAll = function () {
  try {
    var p = VB.agentPaths();
    var f = new Folder(p.work);
    if (f.exists) {
      var files = f.getFiles(function (x) { try { return /agent-status.*\.json$/i.test(x.name); } catch (e) { return false; } });
      for (var i = 0; i < files.length; i++) { try { VB._agentStopPath(files[i].fsName); } catch (e1) {} }
    } else { VB._agentStopPath(p.status); }
    // best-effort: also stop warm daemon only if caller explicitly wants full stop? keep it; daemon-stop is cheap if not running.
    return "ok";
  } catch (e) { VB.log("agentStopAll error: " + e); return VB._agentStopPath(""); }
};
