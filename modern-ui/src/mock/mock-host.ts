/* Browser-only stand-in for Illustrator's CEP host.
   The panel normally talks to CEP through window.CSInterface and the jsx files in host/.
   In a plain browser neither exists, so every call failed and the panel showed
   "Host scripts did not load". This module fabricates the small surface the panel uses,
   answers the same JSON the jsx scripts answer, and adds a switcher for every visible state.

   Development only: main.tsx calls it behind import.meta.env.DEV, and this module has no
   top-level side effects, so the production bundle drops it. */

type Core = any;

const EXT_PATH = "C:/mock/extension";
const DAEMON = { state: "running", busy: false, port: 9222, token: "mock-token", workers: 4 };
const BRIDGE_FOLDER = "C:/Users/user/Documents/VectorizerBridge";
const APP_VERSION = "3.0.0";

const now = (): number => Date.now();
const stamp = (): string => new Date().toLocaleTimeString();

/* --- fake agent progress ------------------------------------------------------------- */

const stageCounts = new Map<string, number>();
const AGENT_STAGES = ["uploading", "vectorizing", "vectorizing", "result", "downloading"];

let loginStartedAt = 0;
let loggedIn = false;
let updatePhase = "uptodate";
let batchCount = 3;
let failItem: number | null = null;

function agentStatusFor(key: string): any {
  const n = (stageCounts.get(key) || 0) + 1;
  stageCounts.set(key, n);
  if (n <= AGENT_STAGES.length) {
    return { state: AGENT_STAGES[n - 1], time: now(), pid: 4242, viaDaemon: true };
  }
  return {
    state: "done",
    time: now(),
    pid: 4242,
    viaDaemon: true,
    svgPath: BRIDGE_FOLDER + "/agent-downloads/vectorizer_export_mock-" + key.replace(/[^a-z0-9]/gi, "") + ".svg",
    elapsedMs: 2400,
  };
}

function updateStatus(): any {
  if (updatePhase === "checking") return { state: "checking", current: APP_VERSION };
  if (updatePhase === "available") {
    return {
      state: "available",
      current: APP_VERSION,
      latest: "3.0.1",
      notes: "Smaller window mode\nBatch cancel cleans up its notes\nFaster SVG history",
    };
  }
  return { state: "uptodate", current: APP_VERSION, latest: APP_VERSION };
}

/* --- the fake evalScript router ------------------------------------------------------ */

function answer(script: string): string {
  const s = String(script || "");

  if (s.indexOf("_loadErrors") >= 0 || s.indexOf("VB.ping()") >= 0) return "ok";
  if (s.indexOf("VB.selfTest()") >= 0) return '{"ok":true,"selftest":"json","parsed":true,"size":100}';
  if (s.indexOf("VB.getBridgeFolderPath()") >= 0) return BRIDGE_FOLDER;
  if (s.indexOf("VB.listVectorizedSvgs") >= 0) {
    return JSON.stringify({
      ok: true,
      files: [
        {
          name: "vectorizer_export_2026-11-24T16-55-58-719Z.svg",
          path: BRIDGE_FOLDER + "/agent-downloads/vectorizer_export_2026-11-24T16-55-58-719Z.svg",
          modified: now() - 1000 * 60 * 4,
          size: 7782,
        },
      ],
    });
  }
  if (s.indexOf("VB.daemonStatus()") >= 0) return JSON.stringify(DAEMON);
  if (s.indexOf("VB.agentPaths()") >= 0) {
    return JSON.stringify({
      run: BRIDGE_FOLDER + "/agent-run",
      profile: BRIDGE_FOLDER + "/agent-profile",
      out: BRIDGE_FOLDER + "/agent-downloads",
      debug: BRIDGE_FOLDER + "/agent-debug",
      work: BRIDGE_FOLDER + "/agent-work",
    });
  }
  if (s.indexOf("VB.updateStatus()") >= 0) return JSON.stringify(updateStatus());
  if (s.indexOf("VB.updateBackups()") >= 0) return '{"ok":true,"backups":[]}';
  if (s.indexOf("VB.startUpdate(") >= 0) {
    updatePhase = "checking";
    setTimeout(() => { updatePhase = "uptodate"; }, 1200);
    return "started";
  }
  if (s.indexOf("VB.agentStart(") >= 0) {
    if (s.indexOf("'login'") >= 0) { loginStartedAt = now(); loggedIn = false; }
    return "started";
  }
  if (s.indexOf("VB.agentStatus") >= 0) {
    if (loginStartedAt) {
      if (!loggedIn && now() - loginStartedAt > 2200) {
        loggedIn = true;
        return '{"state":"loginClosed","time":' + now() + "}";
      }
      return '{"state":"loginWindow","time":' + now() + "}";
    }
    const m = /\((["'])(.*?)\1\)/.exec(s);
    return JSON.stringify(agentStatusFor(m ? m[2] : "single"));
  }
  if (s.indexOf("VB.prepareBatch(") >= 0) {
    return JSON.stringify({ ok: true, count: batchCount, docName: "Mockup.ai", docFullName: "/mock/Mockup.ai", jobId: "mock-job" });
  }
  if (s.indexOf("VB.exportBatchItem(") >= 0) {
    const m = /VB\.exportBatchItem\((\d+)/.exec(s);
    const index = m ? parseInt(m[1], 10) : 0;
    if (failItem === index) return '{"ok":false,"error":"emptyBounds"}';
    return JSON.stringify({
      ok: true,
      union: { left: 0, top: 0, width: 1200, height: 800 },
      pngPath: BRIDGE_FOLDER + "/agent-downloads/mock-item-" + index + ".png",
      docName: "Mockup.ai",
      docFullName: "/mock/Mockup.ai",
      jobId: "mock-job",
    });
  }
  if (s.indexOf("VB.placeSVG(") >= 0) return '{"ok":true,"embedded":true}';
  if (s.indexOf("VB.loadPanelSettings()") >= 0) return "";
  return "ok";
}

/* The panel submits batch items to warm Chrome with XMLHttpRequest. A daemon that never
   answers would push every item onto the per-item launch queue instead, so this shim
   accepts the POST and then reports 202, exactly like the warm daemon does. */
function installMockXhr(): void {
  const g = window as any;
  if (g.__vbMockXhr) return;
  const Real = g.XMLHttpRequest;
  if (!Real) return;
  const isDaemon = (url: string): boolean => /^https?:\/\/127\.0\.0\.1:9222\//.test(url);
  function MockXhr(this: any) {
    const x: any = { timeout: 0, status: 0, readyState: 0, _mock: "", _real: null };
    const real = (): any => (x._real || (x._real = new Real()));
    x.open = (method: string, url: string, async?: boolean): void => {
      if (isDaemon(String(url))) { x._mock = String(url); return; }
      real().open(method, url, async !== false);
    };
    x.setRequestHeader = (k: string, v: string): void => { if (!x._mock) real().setRequestHeader(k, v); };
    x.send = (body?: any): void => {
      if (x._mock) {
        setTimeout(() => { x.status = 202; x.readyState = 4; if (x.onload) x.onload(); }, 120);
        return;
      }
      const r = real();
      r.onload = () => { x.status = r.status; if (x.onload) x.onload(); };
      r.onerror = () => { if (x.onerror) x.onerror(); };
      r.ontimeout = () => { if (x.ontimeout) x.ontimeout(); };
      r.timeout = x.timeout;
      r.send(body);
    };
    x.abort = (): void => { if (x._mock) { x.status = 0; } else if (x._real) x._real.abort(); };
    return x;
  }
  g.XMLHttpRequest = MockXhr;
  g.__vbMockXhr = true;
}

function makeCSInterface(): any {
  return class MockCSInterface {
    evalScript(script: string, callback?: (result: string) => void): void {
      const result = answer(script);
      setTimeout(() => { if (callback) callback(result); }, s_delay(script));
    }
    getSystemPath(): string { return EXT_PATH; }
    getHostEnvironment(): string { return JSON.stringify({ appName: "ILST", appVersion: "29.0" }); }
    closeExtension(): void { }
    setPanelFlyoutMenu(): void { }
    registerKeyEventsInterest(): void { }
    addEventListener(): void { }
    removeEventListener(): void { }
    openURLInDefaultBrowser(): void { }
  };
}

/* The batch poller runs every 350 ms; a slightly slower reply keeps the mock readable. */
function s_delay(script: string): number {
  return /prepareBatch|exportBatchItem|selfTest/.test(String(script)) ? 90 : 20;
}

/* --- state presets ------------------------------------------------------------------- */

interface Preset {
  id: string;
  label: string;
  group: string;
}

const PRESETS: Preset[] = [
  { id: "ready", label: "Ready to vectorize", group: "Idle" },
  { id: "noSelection", label: "Nothing selected", group: "Idle" },
  { id: "noDoc", label: "No document open", group: "Idle" },
  { id: "loadingHost", label: "Loading host scripts", group: "Idle" },
  { id: "exporting", label: "Exporting selection", group: "Running" },
  { id: "uploading", label: "Uploading", group: "Running" },
  { id: "vectorizing", label: "Vectorizing", group: "Running" },
  { id: "result", label: "Result ready", group: "Running" },
  { id: "downloading", label: "Downloading the SVG", group: "Running" },
  { id: "placing", label: "Placing", group: "Running" },
  { id: "placed", label: "Placed", group: "Running" },
  { id: "batchRunning", label: "Batch 1/3 running", group: "Batch" },
  { id: "batchDone", label: "Batch complete 3/3", group: "Batch" },
  { id: "batchPartial", label: "Batch 2/3, one failed", group: "Batch" },
  { id: "batchCancelled", label: "Batch cancelled", group: "Batch" },
  { id: "loginRequired", label: "Sign in required", group: "Account" },
  { id: "signInOpen", label: "Sign-in window open", group: "Account" },
  { id: "signedIn", label: "Signed in", group: "Account" },
  { id: "error", label: "Vectorize error", group: "Errors" },
  { id: "hostError", label: "Host scripts missing", group: "Errors" },
  { id: "updateAvailable", label: "Update available", group: "Updates" },
  { id: "setupWizard", label: "Setup wizard", group: "Overlays" },
];

const BASE_LOG = [
  "[status] Loading Illustrator host scripts…",
  'Host self-test: {"ok":true,"selftest":"json","parsed":true,"size":100}',
  "Warm Chrome starting… (workers=4)",
];

function logs(extra: string[]): string[] {
  const base = BASE_LOG.map((l) => stamp() + " " + l);
  const lines = base.concat(extra.map((l) => stamp() + " " + l));
  return lines;
}

function svgFiles(): any[] {
  return [
    {
      name: "vectorizer_export_2026-11-24T16-55-58-719Z.svg",
      path: BRIDGE_FOLDER + "/agent-downloads/vectorizer_export_2026-11-24T16-55-58-719Z.svg",
      modified: now() - 1000 * 60 * 4,
      size: 7782,
    },
  ];
}

function statusOf(t: (k: string) => string, key: string, vars?: Record<string, string>): string {
  let s = t(key) || "";
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

function presetPatch(id: string, core: Core): any {
  const t = core.t;
  const sel = (n: number, doc: string) => ({ open: true, sel: n, doc });
  const quiet = { busy: false, waiting: false, login: false, _errorText: "" };
  const running = { busy: true, waiting: true, runStartedAt: now() - 4000 };

  switch (id) {
    case "noSelection":
      return { ...quiet, selection: sel(0, "logo-mark.ai"), _statusKey: "statusReady", _statusText: statusOf(t, "statusReady"), _statusTone: "accent" };
    case "noDoc":
      return { ...quiet, selection: { open: false }, _statusKey: "statusReady", _statusText: statusOf(t, "statusReady"), _statusTone: "accent", _detailText: "" };
    case "loadingHost":
      return { ...quiet, _statusKey: "statusLoadingHost", _statusText: statusOf(t, "statusLoadingHost"), _statusTone: "", _detailText: "" };
    case "exporting":
      return { ...running, busy: true, waiting: false, _statusKey: "statusExporting", _statusText: statusOf(t, "statusExporting"), _statusTone: "", _detailText: "⏱ 1.2 s" };
    case "uploading":
      return { ...running, _statusKey: "statusUploading", _statusText: statusOf(t, "statusUploading"), _statusTone: "", _detailText: "logo-mark.ai" };
    case "vectorizing":
      return { ...running, _statusKey: "statusVectorizing", _statusText: statusOf(t, "statusVectorizing"), _statusTone: "accent", _detailText: "logo-mark.ai · ⏱ 6.4 s" };
    case "result":
      return { ...running, _statusKey: "statusResult", _statusText: statusOf(t, "statusResult"), _statusTone: "", _detailText: "logo-mark.ai" };
    case "downloading":
      return { ...running, _statusKey: "statusDownloading", _statusText: statusOf(t, "statusDownloading"), _statusTone: "", _detailText: "logo-mark.ai · ⏱ 9.1 s" };
    case "placing":
      return { ...running, _statusKey: "statusPlacing", _statusText: statusOf(t, "statusPlacing"), _statusTone: "", _detailText: "logo-mark.ai" };
    case "placed":
      return {
        ...quiet,
        _statusKey: "statusPlaced",
        _statusText: statusOf(t, "statusPlaced"),
        _statusTone: "success",
        _detailText: "⏱ total 9.8 s (export 1.1 s, place 0.6 s)",
        _svgFiles: svgFiles(),
        history: [{ time: new Date().toLocaleTimeString(), action: "placed", file: "vectorizer_export_mock.svg", ok: true, msg: "⏱ total 9.8 s" }],
        _logLines: logs(["[status] " + statusOf(t, "statusPlaced"), "Placed: vectorizer_export_mock.svg — ⏱ total 9.8 s"]),
      };
    case "batchRunning":
      return {
        ...running,
        _statusKey: "statusBatchProgress",
        _statusText: statusOf(t, "statusBatchProgress", { done: "1", n: "3", active: "1", stage: " · " + statusOf(t, "statusVectorizing") }),
        _statusTone: "",
        _detailText: "Mockup.ai",
        batch: {
          total: 3, next: 2, ok: 1, failed: 0, skipped: 0, doneCount: 1, active: 1, cancelled: false,
          docName: "Mockup.ai", docFullName: "/mock/Mockup.ai", jobId: "mock-job",
          jobs: [
            { index: 0, phase: "done", done: true, stageLabel: statusOf(t, "statusPlacing") },
            { index: 1, phase: "agent", done: false, stageLabel: statusOf(t, "statusVectorizing") },
            { index: 2, phase: "pending", done: false, stageLabel: "" },
          ],
        },
        _logLines: logs(["Batch start: 3 item(s), workers=4", "[status] " + statusOf(t, "statusBatchProgress", { done: "1", n: "3", active: "1", stage: " · " + statusOf(t, "statusVectorizing") })]),
      };
    case "batchDone":
      return {
        ...quiet,
        _statusKey: "statusBatchDone",
        _statusText: statusOf(t, "statusBatchDone", { ok: "3", n: "3" }),
        _statusTone: "",
        _detailText: "ok 3/3",
        selection: sel(3, "Mockup.ai"),
        _svgFiles: svgFiles(),
        history: [{ time: new Date().toLocaleTimeString(), action: "batchPlaced", file: "Mockup.ai", ok: true, msg: statusOf(t, "statusBatchDone", { ok: "3", n: "3" }) }],
        _logLines: logs([
          "Batch start: 3 item(s), workers=4",
          "[status] " + statusOf(t, "statusBatchProgress", { done: "1", n: "3", active: "2", stage: "" }),
          "[status] " + statusOf(t, "statusBatchProgress", { done: "2", n: "3", active: "1", stage: "" }),
          "[status] " + statusOf(t, "statusBatchDone", { ok: "3", n: "3" }),
        ]),
      };
    case "batchPartial":
      return {
        ...quiet,
        _statusKey: "statusBatchDone",
        _statusText: statusOf(t, "statusBatchDone", { ok: "2", n: "3" }),
        _statusTone: "",
        _detailText: "ok 2/3, failed 1",
        _svgFiles: svgFiles(),
        history: [
          { time: new Date().toLocaleTimeString(), action: "batchFailed", file: "#2", ok: false, msg: "emptyBounds" },
          { time: new Date().toLocaleTimeString(), action: "batchPlaced", file: "Mockup.ai", ok: true, msg: statusOf(t, "statusBatchDone", { ok: "2", n: "3" }) },
        ],
        _logLines: logs(["Batch item 2 failed: emptyBounds", "[status] " + statusOf(t, "statusBatchDone", { ok: "2", n: "3" })]),
      };
    case "batchCancelled":
      return {
        ...quiet,
        _statusKey: "statusBatchCancelled",
        _statusText: statusOf(t, "statusBatchCancelled", { ok: "1", n: "3" }),
        _statusTone: "",
        _detailText: "⏱ 7.2 s",
        history: [{ time: new Date().toLocaleTimeString(), action: "batchFailed", file: "Mockup.ai", ok: false, msg: "cancelled at 1/3" }],
        _logLines: logs(["[status] " + statusOf(t, "statusBatchCancelled", { ok: "1", n: "3" })]),
      };
    case "loginRequired":
      return {
        ...quiet,
        _statusKey: "statusLoginRequired",
        _statusText: statusOf(t, "statusLoginRequired"),
        _statusTone: "warning",
        _detailText: statusOf(t, "statusSignInHint"),
        history: [{ time: new Date().toLocaleTimeString(), action: "loginRequired", ok: false, file: "", msg: "" }],
        _logLines: logs(["[status] " + statusOf(t, "statusLoginRequired")]),
      };
    case "signInOpen":
      return {
        ...quiet,
        login: true,
        loginKind: "login",
        waitStartedAt: now() - 5000,
        _statusKey: "statusSignInOpen",
        _statusText: statusOf(t, "statusSignInOpen"),
        _statusTone: "",
        _detailText: statusOf(t, "statusSignInHint"),
      };
    case "signedIn":
      return {
        ...quiet,
        _statusKey: "statusReady",
        _statusText: statusOf(t, "statusReady"),
        _statusTone: "accent",
        _detailText: "",
        history: [{ time: new Date().toLocaleTimeString(), action: "signedIn", file: "", ok: true, msg: "" }],
        _logLines: logs(["[status] " + statusOf(t, "statusSignInClosed")]),
      };
    case "error":
      return {
        ...quiet,
        _statusKey: "statusAgentError",
        _statusText: statusOf(t, "statusAgentError"),
        _statusTone: "danger",
        _detailText: "vectorizer.ai closed the tab before finishing · ⏱ 18.4 s",
        _errorText: "vectorizer.ai closed the tab before finishing. Try again; the selection is still on the document.",
        history: [{ time: new Date().toLocaleTimeString(), action: "vectorizeFailed", file: "", ok: false, msg: "agent error · ⏱ 18.4 s" }],
        _logLines: logs(["[error] vectorizer.ai closed the tab before finishing."]),
      };
    case "hostError":
      return {
        ...quiet,
        _statusKey: "statusHostError",
        _statusText: statusOf(t, "errorHost"),
        _statusTone: "danger",
        _detailText: "",
        _errorText: statusOf(t, "errorHost") + ' (SystemPath.EXTENSION failed: TypeError: Cannot read properties of undefined (reading \'getSystemPath\'))',
        _logLines: logs(["[error] " + statusOf(t, "errorHost")]),
      };
    case "updateAvailable":
      return {
        ...quiet,
        _statusKey: "statusReady",
        _statusText: statusOf(t, "statusReady"),
        _statusTone: "accent",
        _detailText: "",
        update: {
          available: true, checking: false, downloading: false, staged: false,
          remoteVersion: "3.0.1", stagedVersion: "", current: APP_VERSION,
          statusText: statusOf(t, "updateAvailable", { version: "3.0.1" }),
          notes: "v3.0.1 — Smaller compact window • Batch cancel cleans up its notes • Faster SVG history",
          needsRestart: false, hasBackups: true,
        },
      };
    case "setupWizard":
      return { ...quiet, _statusKey: "statusReady", _statusText: statusOf(t, "statusReady"), _statusTone: "accent", _detailText: "" };
    case "ready":
    default:
      return {
        ...quiet,
        selection: sel(2, "logo-mark.ai"),
        _statusKey: "statusReady",
        _statusText: statusOf(t, "statusReady"),
        _statusTone: "accent",
        _detailText: "",
        _svgFiles: [],
        history: [],
        _logLines: logs(["[status] " + statusOf(t, "statusReady")]),
        daemon: { ...DAEMON },
      };
  }
}

const IDLE_UPDATE = () => ({
  available: false, checking: false, downloading: false, staged: false,
  remoteVersion: "", stagedVersion: "", current: APP_VERSION, statusText: "", notes: "",
  needsRestart: false, hasBackups: false,
});

function applyPreset(id: string): void {
  const core = (window as any).VBPanel && (window as any).VBPanel.core;
  if (!core) return;
  const bridge = (window as any).VBPanel.bridge;
  try { if (bridge) bridge.setHostOk(true); } catch { }
  const patch = presetPatch(id, core);
  /* An update card from a previous state would otherwise stay on screen. */
  if (id !== "updateAvailable") patch.update = IDLE_UPDATE();
  try { core.setState({ _hostOk: true, batch: null, ...patch }); } catch { }
  if (id === "setupWizard") {
    try { localStorage.removeItem("vb_setup_done"); (window as any).VBPanel.setup?.open?.(); } catch { }
  }
  if (id === "hostError") { try { bridge?.setHostOk?.(false); core.setState({ _hostOk: false }); } catch { } }
}

/* --- the switcher -------------------------------------------------------------------- */

let bar: HTMLElement | null = null;

function mountBar(): void {
  if (bar || !document.body) return;
  const wrap = document.createElement("div");
  wrap.id = "vbMockBar";
  wrap.setAttribute("data-vb-mock", "1");
  wrap.style.cssText = [
    "position:fixed",
    "right:10px",
    "bottom:10px",
    "z-index:2147483000",
    "font:11px/1.3 'Segoe UI',system-ui,sans-serif",
    "color:#111",
    "display:flex",
    "flex-direction:column",
    "align-items:flex-end",
    "gap:6px",
  ].join(";");

  const open = document.createElement("div");
  open.style.cssText = [
    "display:none",
    "background:#fff",
    "border:1px solid #c9d3dd",
    "border-radius:8px",
    "box-shadow:0 8px 24px rgba(0,0,0,.18)",
    "padding:8px",
    "width:236px",
  ].join(";");

  const head = document.createElement("div");
  head.textContent = "Mock states (browser only)";
  head.style.cssText = "font-weight:600;margin-bottom:6px;color:#334";
  open.appendChild(head);

  const select = document.createElement("select");
  select.id = "vbMockState";
  select.style.cssText = "width:100%;font:11px 'Segoe UI',sans-serif;padding:3px";
  const groups: Record<string, HTMLOptGroupElement> = {};
  for (const p of PRESETS) {
    let g = groups[p.group];
    if (!g) {
      g = document.createElement("optgroup");
      g.label = p.group;
      groups[p.group] = g;
      select.appendChild(g);
    }
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    g.appendChild(o);
  }
  select.addEventListener("change", () => {
    applyPreset(select.value);
    try {
      const url = new URL(location.href);
      url.searchParams.set("state", select.value);
      history.replaceState(null, "", url.toString());
    } catch { }
  });
  open.appendChild(select);

  const features = document.createElement("div");
  features.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:6px";
  const mkBtn = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = label;
    b.style.cssText = [
      "font:11px 'Segoe UI',sans-serif",
      "padding:3px 7px",
      "border-radius:6px",
      "border:1px solid #c9d3dd",
      "background:#f6f8fa",
      "color:#111",
      "cursor:pointer",
    ].join(";");
    b.addEventListener("click", fn);
    features.appendChild(b);
  };
  mkBtn("Welcome", () => {
    try { localStorage.removeItem("vb_setup_done"); } catch { }
    try { (window as any).VBPanel?.setup?.open?.(); } catch { }
  });
  mkBtn("Tour", () => {
    const btn = document.getElementById("whatsNewBtn") as HTMLButtonElement | null;
    if (btn) btn.click();
  });
  mkBtn("Reset flags", () => {
    try {
      localStorage.removeItem("vb_setup_done");
      localStorage.removeItem("ms.whatsNewSeen");
      sessionStorage.removeItem("vb_update_dismissed");
    } catch { }
  });
  open.appendChild(features);

  const hint = document.createElement("div");
  hint.textContent = "No Illustrator: host replies are simulated. Buttons still run the real flows.";
  hint.style.cssText = "color:#667;margin-top:6px;font-size:10px";
  open.appendChild(hint);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "MOCK";
  toggle.title = "Panel states without Illustrator";
  toggle.style.cssText = [
    "font:600 10px 'Segoe UI',sans-serif",
    "letter-spacing:.08em",
    "padding:4px 8px",
    "border-radius:999px",
    "border:1px solid #0066cc",
    "background:#0066cc",
    "color:#fff",
    "cursor:pointer",
    "box-shadow:0 2px 8px rgba(0,0,0,.2)",
  ].join(";");
  toggle.addEventListener("click", () => {
    open.style.display = open.style.display === "none" ? "block" : "none";
  });

  wrap.appendChild(open);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);
  bar = wrap;
}

function boot(): void {
  const wait = setInterval(() => {
    const g = (window as any).VBPanel;
    if (!g || !g.core || !g.bridge) return;
    clearInterval(wait);
    mountBar();
    const select = document.getElementById("vbMockState") as HTMLSelectElement | null;
    let wanted = "";
    try { wanted = new URLSearchParams(location.search).get("state") || ""; } catch { }
    const id = PRESETS.some((p) => p.id === wanted) ? wanted : "ready";
    /* Let the panel finish its own boot (host load, settings sync) before overriding. */
    const apply = () => {
      applyPreset(id);
      if (select) select.value = id;
    };
    apply();
    setTimeout(apply, 700);
  }, 60);
}

export function installMockHost(): boolean {
  if (typeof window === "undefined") return false;
  const g = window as any;
  /* A real CEP host exposes evalScript on __adobe_cep__. In a browser the page still loads
     public/csinterface.js, so the class is present but the host behind it is not. */
  if (g.__adobe_cep__ && typeof g.__adobe_cep__.evalScript === "function") return false;
  try {
    if (new URLSearchParams(location.search).get("mock") === "0") return false;
  } catch { }

  g.SystemPath = { EXTENSION: "extension", USER_DATA: "userData", MY_DOCUMENTS: "myDocuments" };
  g.CSInterface = makeCSInterface();
  g.__adobe_cep__ = {
    getSystemPath: () => EXT_PATH,
    getHostEnvironment: () => JSON.stringify({ appName: "ILST", appVersion: "29.0" }),
    closeExtension: () => { },
  };
  g.cep = {
    fs: {
      readFile: () => ({
        err: 0,
        data: '<?xml version="1.0"?><ExtensionManifest ExtensionBundleVersion="' + APP_VERSION + '"></ExtensionManifest>',
      }),
    },
    util: { openURLInDefaultBrowser: () => { } },
  };
  g.VBADMIN = g.VBADMIN || {
    defaults: { pngLongSide: 1700, hideOriginal: false, warmDaemon: true, batchWorkers: 4 },
    updateRepo: "ggmbrinde-stack/mockup-studio",
  };
  /* The wizard and the updater would otherwise pop over every screenshot. */
  try {
    localStorage.setItem("vb_setup_done", "1");
    sessionStorage.setItem("vb_update_dismissed", "1");
  } catch { }

  installMockXhr();
  boot();
  return true;
}

export const MOCK_PRESETS = PRESETS;
export const MOCK_API = {
  applyPreset,
  setBatchCount: (n: number) => { batchCount = n; },
  failBatchItem: (i: number | null) => { failItem = i; },
  setUpdatePhase: (p: string) => { updatePhase = p; },
};
