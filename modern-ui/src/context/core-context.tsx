import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { en } from "../locales/en";
import { pt } from "../locales/pt";
import { hostBridge, subscribeHost, getHostOk } from "../hooks/use-host";

export type Lang = "en" | "pt";

export interface VectorizeShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: number;
  code: string;
  label: string;
}

export interface VxSettings {
  preset: string;
  svgVersion: string;
  adobe: boolean;
  fixedSize: boolean;
  draw: string;
  stack: string;
  group: string;
  nativeShapes: boolean;
  gapFiller: boolean;
  curves: string;
  lineFit: string;
  strokeWidth: number;
  strokeFixed: boolean;
}

export interface PanelSettings {
  pngLongSide: number;
  hideOriginal: boolean;
  warmDaemon: boolean;
  batchWorkers: number;
  vectorizeShortcut: VectorizeShortcut;
  vx: VxSettings;
  settingsVersion?: number;
}

export interface UpdateState {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  staged: boolean;
  remoteVersion: string;
  stagedVersion: string;
  current: string;
  statusText: string;
  notes: string;
  needsRestart: boolean;
  hasBackups: boolean;
}

export interface CoreState {
  busy: boolean;
  waiting: boolean;
  login: boolean;
  loginKind: string;
  waitStartedAt: number;
  lastStatusAt: number;
  runStartedAt: number;
  exportMs: number;
  pngPath: string;
  union: any;
  docFullName: string;
  docName: string;
  lang: Lang;
  history: Array<{ time: string; action: string; file: string; ok: boolean; msg: string }>;
  daemon: { state: string; busy: boolean; ui?: string; port?: number; workers?: number; token?: string };
  update: UpdateState;
  updateArmed: boolean;
  runToken: number;
  bridgeFolder: string;
  batch: any;
  selection: any;
  shortcutStatusPath: string;
  settings: PanelSettings;
  agentPaths: any;
  /* Render-only values. Nothing outside React writes these elements any more. */
  _statusText: string;
  _statusKey: string;
  _statusTone: string;
  _detailText: string;
  _logLines: string[];
  _hostOk: boolean;
  _errorText: string;
  _svgFiles: any[];
  _updateDismissed: boolean;
  _appVersion: string;
}

export type StatePatch = Partial<CoreState>;

export interface CoreActions {
  t: (key: string) => string;
  fmtElapsed: (ms: number) => string;
  runElapsedMs: () => number;
  setStatus: (text: string) => void;
  setStatusKey: (key: string) => void;
  refreshStatusCopy: () => void;
  shortenForMini: (raw: string) => string;
  setDetail: (text: string) => void;
  setRunTimerDetail: (prefix?: string) => void;
  showError: (message: string) => void;
  appendLogUI: (text: string) => void;
  log: (message: string) => void;
  loadSettings: () => void;
  saveSettings: () => void;
  updateSettings: (patch: Partial<PanelSettings>) => void;
  updateVx: (patch: Partial<VxSettings>) => void;
  setLang: (lang: Lang) => void;
  toggleLanguage: () => void;
  renderSelection: (info: any) => void;
  selectionText: (info: any) => string;
  syncSettingsFromHost: (done?: (ok: boolean) => void) => void;
  pushSettingsToHost: () => void;
  pushExportOptionsToHost: () => void;
  updateButtons: () => void;
  addHistory: (action: string, file: string, ok: boolean, message: string) => void;
  extensionVersion: () => string;
  shortcutLabel: (sc: VectorizeShortcut) => string;
  events: { on: (event: string, fn: Function) => void; off: (event: string, fn: Function) => void; emit: (event: string, data: any) => void };
  isWindowMode: () => boolean;
  layoutMode: () => string;
  applyLayout: () => string;
  setWindowMode: (flag: boolean) => string;
  currentPollMs: () => number;
  schedulePoll: (ms: number) => void;
  normalizeVx: (raw: any) => VxSettings;
  VX_PRESETS: Record<string, any>;
  jsxString: (value: any) => string;
  /** Functional updater or a partial patch merged into the latest state. */
  setState: (updater: ((prev: CoreState) => CoreState) | StatePatch) => void;
  /** The newest state, safe to read inside async callbacks. */
  readonly live: CoreState;
}

interface CoreContextValue {
  state: CoreState;
  actions: CoreActions;
}

const CoreContext = createContext<CoreContextValue | null>(null);

export const LOCALES: Record<Lang, Record<string, string>> = { en, pt };

const STATUS_MINI_KEY: Record<string, string> = {
  statusReady: "statusReadyMini",
  statusLoadingHost: "statusLoadingHostMini",
  statusHostError: "statusHostErrorMini",
  statusExporting: "statusExportingMini",
  statusUploading: "statusUploadingMini",
  statusVectorizing: "statusVectorizingMini",
  statusResult: "statusResultMini",
  statusDownloading: "statusDownloadingMini",
  statusPlacing: "statusPlacingMini",
  statusPlaced: "statusPlacedMini",
  statusBatch: "statusBatchMini",
  statusBatchProgress: "statusBatchProgressMini",
  statusBatchDone: "statusBatchDoneMini",
  statusBatchCancelled: "statusBatchCancelledMini",
  batchNoItems: "batchNoItemsMini",
  statusPlacingLinked: "statusPlacingLinkedMini",
  statusPlaceFailed: "statusPlaceFailedMini",
  statusExportFailed: "statusExportFailedMini",
  statusAgentLaunch: "statusAgentLaunchMini",
  statusWaitingSlot: "statusWaitingSlotMini",
  statusAgentLoading: "statusAgentLoadingMini",
  statusAgentError: "statusAgentErrorMini",
  statusLoginRequired: "statusLoginRequiredMini",
  statusSignInOpen: "statusSignInOpenMini",
  statusSignInClosed: "statusSignInClosedMini",
  statusWindowClosed: "statusWindowClosedMini",
  statusCancelled: "statusCancelledMini",
};

const STATUS_TONE: Record<string, string> = {
  statusReady: "accent",
  statusVectorizing: "accent",
  statusPlaced: "success",
  statusLoginRequired: "warning",
  statusAgentError: "danger",
  statusHostError: "danger",
};

const POLL_MS_IDLE = 1200;
const POLL_MS_ACTIVE = 400;
const SETTINGS_VERSION = 2;
const LOG_LIMIT = 200;

const DEFAULT_SHORTCUT: VectorizeShortcut = { ctrl: true, shift: true, alt: false, key: 186, code: "Semicolon", label: "Ctrl+Shift+Ç" };

const VX_PRESETS: Record<string, Record<string, any>> = {
  general: { draw: "fill_shapes", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: true },
  editing: { draw: "fill_shapes", stack: "stacked", group: "color", nativeShapes: true, gapFiller: false },
  cutting: { draw: "stroke_edges", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: false },
};

const VX_DEFAULTS: VxSettings = {
  preset: "general", svgVersion: "svg_1_1", adobe: false, fixedSize: false,
  draw: "fill_shapes", stack: "cutouts", group: "none", nativeShapes: true, gapFiller: true,
  curves: "all", lineFit: "medium", strokeWidth: 1, strokeFixed: true,
};

const VX_ENUMS: Record<string, string[]> = {
  preset: ["general", "editing", "cutting", "custom"],
  svgVersion: ["svg_1_1", "svg_1_0", "svg_tiny_1_2"],
  draw: ["fill_shapes", "stroke_shapes", "stroke_edges"],
  stack: ["cutouts", "stacked"],
  group: ["none", "color", "parent", "layer"],
  curves: ["all", "cubic"],
  lineFit: ["fine", "medium", "coarse"],
};

export function CoreProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<CoreState>({
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
    update: {
      available: false, checking: false, downloading: false, staged: false,
      remoteVersion: "", stagedVersion: "", current: "", statusText: "", notes: "", needsRestart: false, hasBackups: false,
    },
    updateArmed: false,
    runToken: 0,
    bridgeFolder: "",
    batch: null,
    selection: null,
    shortcutStatusPath: "",
    agentPaths: null,
    settings: {
      pngLongSide: 1700,
      hideOriginal: false,
      warmDaemon: true,
      batchWorkers: 2,
      vectorizeShortcut: { ...DEFAULT_SHORTCUT },
      vx: { ...VX_DEFAULTS },
    },
    _statusText: "",
    _statusKey: "statusReady",
    _statusTone: "accent",
    _detailText: "",
    _logLines: [],
    _hostOk: false,
    _errorText: "",
    _svgFiles: [],
    _updateDismissed: false,
    _appVersion: "",
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;

  const langRef = useRef(state.lang);
  langRef.current = state.lang;

  const listenersRef = useRef<Record<string, Array<Function>>>({});
  const miniRef = useRef<{ lang: Lang; table: Array<{ full: string; mini: string }> } | null>(null);
  const extensionVersionRef = useRef("");
  const pollTimerRef = useRef<any>(null);

  const setState = useCallback((updater: ((prev: CoreState) => CoreState) | StatePatch) => {
    setStateRaw(prev => (typeof updater === "function" ? updater(prev) : { ...prev, ...updater }));
  }, []);

  const t = useCallback((key: string): string => {
    const dict = (LOCALES[stateRef.current.lang] || LOCALES.en) || {};
    return dict[key] !== undefined ? dict[key] : key;
  }, []);

  const fmtElapsed = useCallback((ms: number): string => {
    if (ms == null || ms < 0 || !isFinite(ms)) return "";
    if (ms < 1000) return ms + " ms";
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + " s";
    const m = Math.floor(s / 60);
    const rs = Math.round(s % 60);
    return m + "m " + rs + "s";
  }, []);

  const runElapsedMs = useCallback((): number => {
    const started = stateRef.current.runStartedAt;
    return started ? Date.now() - started : 0;
  }, []);

  const buildStatusMiniText = (lang: Lang): Array<{ full: string; mini: string }> => {
    const arr: Array<{ full: string; mini: string }> = [];
    const dict = LOCALES[lang] || {};
    for (const k of Object.keys(STATUS_MINI_KEY)) {
      const full = dict[k];
      const mini = dict[STATUS_MINI_KEY[k]];
      if (typeof full === "string" && typeof mini === "string" && full) {
        arr.push({ full, mini });
      }
    }
    arr.sort((a, b) => b.full.length - a.full.length);
    return arr;
  };

  const shortenForMini = useCallback((raw: string): string => {
    const lang = stateRef.current.lang;
    if (!miniRef.current || miniRef.current.lang !== lang) {
      miniRef.current = { lang, table: buildStatusMiniText(lang) };
    }
    const table = miniRef.current.table;
    for (let i = 0; i < table.length; i++) {
      if (raw === table[i].full || raw.indexOf(table[i].full) === 0) return table[i].mini;
    }
    const bp = /^(\S+ \d+\/\d+)/.exec(raw);
    if (bp) return bp[1];
    return raw.length > 26 ? raw.slice(0, 25) + "\u2026" : raw;
  }, []);

  const statusTextFor = useCallback((key: string): string => {
    return t(key) || "";
  }, [t]);

  const paintStatus = useCallback((text: string, key: string, tone: string) => {
    setStateRaw(prev => (prev._statusText === text && prev._statusKey === key && prev._statusTone === tone)
      ? prev
      : { ...prev, _statusText: text, _statusKey: key, _statusTone: tone });
  }, []);

  const appendLogUI = useCallback((text: string) => {
    const line = new Date().toLocaleTimeString() + " " + String(text);
    setStateRaw(prev => {
      const lines = prev._logLines.concat(line);
      return { ...prev, _logLines: lines.length > LOG_LIMIT ? lines.slice(lines.length - LOG_LIMIT) : lines };
    });
  }, []);

  /* Every explicit status is an event and is always logged; the batch poller suppresses its
     own repeats before calling this (see updateBatchStatus). */
  const setStatus = useCallback((text: string) => {
    const raw = String(text || "");
    appendLogUI(`[status] ${raw}`);
    paintStatus(raw, "", "");
  }, [appendLogUI, paintStatus]);

  const setStatusKey = useCallback((key: string) => {
    const text = statusTextFor(key);
    const cur = stateRef.current;
    if (cur._statusText !== text || cur._statusKey !== key) appendLogUI(`[status] ${text}`);
    paintStatus(text, key || "", STATUS_TONE[key] || "");
  }, [statusTextFor, appendLogUI, paintStatus]);

  const refreshStatusCopy = useCallback(() => {
    const cur = stateRef.current;
    if (cur._statusKey) paintStatus(statusTextFor(cur._statusKey), cur._statusKey, STATUS_TONE[cur._statusKey] || "");
  }, [statusTextFor, paintStatus]);

  const setDetail = useCallback((text: string) => {
    const next = text ? String(text) : "";
    setStateRaw(prev => (prev._detailText === next ? prev : { ...prev, _detailText: next }));
  }, []);

  const setRunTimerDetail = useCallback((prefix?: string) => {
    const e = runElapsedMs();
    if (!e) return;
    setDetail((prefix ? prefix + " · " : "") + `⏱ ${fmtElapsed(e)}`);
  }, [runElapsedMs, fmtElapsed, setDetail]);

  const log = useCallback((message: string) => {
    const text = String(message);
    appendLogUI(text);
    hostBridge.logToHost(text);
  }, [appendLogUI]);

  const showError = useCallback((message: string) => {
    setStateRaw(prev => ({ ...prev, _errorText: String(message) }));
    appendLogUI(`[error] ${String(message)}`);
  }, [appendLogUI]);

  const jsxString = (value: any): string => JSON.stringify(String(value));

  const currentPollMs = useCallback((): number => {
    const s = stateRef.current;
    return (s.waiting || s.login || s.busy) ? POLL_MS_ACTIVE : POLL_MS_IDLE;
  }, []);

  const schedulePoll = useCallback((ms: number) => {
    if (pollTimerRef.current) { try { clearTimeout(pollTimerRef.current); } catch { } pollTimerRef.current = null; }
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      try { emit("poll:tick", undefined); } catch { }
      schedulePoll(currentPollMs());
    }, ms);
  }, [currentPollMs]);

  const on = useCallback((event: string, fn: Function) => {
    if (!event || !fn) return;
    (listenersRef.current[event] = listenersRef.current[event] || []).push(fn);
  }, []);

  const off = useCallback((event: string, fn: Function) => {
    const a = listenersRef.current[event];
    if (!a) return;
    for (let i = a.length - 1; i >= 0; i--) {
      if (!fn || a[i] === fn) a.splice(i, 1);
    }
  }, []);

  const emit = useCallback((event: string, data: any) => {
    const a = (listenersRef.current[event] || []).slice();
    for (let i = 0; i < a.length; i++) { try { a[i](data); } catch { } }
  }, []);

  const events = useMemo(() => ({ on, off, emit }), [on, off, emit]);

  const shortcutLabel = useCallback((sc: VectorizeShortcut): string => {
    if (!sc) return DEFAULT_SHORTCUT.label;
    if (sc.label) return sc.label;
    const parts: string[] = [];
    if (sc.ctrl) parts.push("Ctrl");
    if (sc.shift) parts.push("Shift");
    if (sc.alt) parts.push("Alt");
    let k = sc.code || "";
    if (/^Key[A-Z]$/.test(k)) k = k.slice(3);
    else if (/^Digit[0-9]$/.test(k)) k = k.slice(5);
    else if (k === "Semicolon") k = ";";
    else if (k === "Comma") k = ",";
    else if (k === "Period") k = ".";
    else if (k === "Slash") k = "/";
    else if (k === "BracketLeft") k = "[";
    else if (k === "BracketRight") k = "]";
    else if (k === "Backslash") k = "\\";
    else if (k === "Quote") k = "'";
    else if (k === "Minus") k = "-";
    else if (k === "Equal") k = "=";
    else if (k === "Backquote") k = "`";
    if (!k && sc.key) k = String.fromCharCode(sc.key);
    parts.push(k || "?");
    return parts.join("+");
  }, []);

  const vxEnum = (key: string, value: any, fallback: string): string =>
    (VX_ENUMS[key] || []).indexOf(String(value)) >= 0 ? String(value) : fallback;

  const normalizeVx = useCallback((raw: any): VxSettings => {
    const src = (raw && typeof raw === "object") ? raw : {};
    const o: VxSettings = { ...VX_DEFAULTS };
    o.preset = vxEnum("preset", src.preset, VX_DEFAULTS.preset);
    const presetDef = VX_PRESETS[o.preset];
    if (presetDef) {
      for (const p of Object.keys(presetDef)) {
        (o as any)[p] = presetDef[p];
      }
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
    const sw = parseFloat(src.strokeWidth);
    o.strokeWidth = isFinite(sw) ? Math.max(0, Math.min(5, sw)) : VX_DEFAULTS.strokeWidth;
    o.strokeFixed = src.strokeFixed === undefined ? VX_DEFAULTS.strokeFixed : !!src.strokeFixed;
    if (o.adobe) o.curves = "cubic";
    return o;
  }, []);

  const clampSettings = useCallback((settings: PanelSettings): PanelSettings => {
    let { pngLongSide, batchWorkers } = settings;
    if (pngLongSide !== 0 && pngLongSide < 100) pngLongSide = 1700;
    if (pngLongSide > 5000) pngLongSide = 5000;
    if (!isFinite(batchWorkers) || batchWorkers < 1) batchWorkers = 1;
    if (batchWorkers > 4) batchWorkers = 4;
    return { ...settings, pngLongSide, batchWorkers, vectorizeShortcut: settings.vectorizeShortcut || { ...DEFAULT_SHORTCUT } };
  }, []);

  /* Fields a stored or host copy of the settings may carry. Returns a patch, never the whole object,
     so a partial copy cannot blank the rest. */
  const storedSettingsPatch = useCallback((s: any): Partial<PanelSettings> => {
    if (!s || typeof s !== "object") return {};
    const next: Partial<PanelSettings> = {};
    if (s.pngLongSide !== undefined) {
      const v = parseInt(s.pngLongSide, 10);
      next.pngLongSide = isFinite(v) ? v : 1700;
    }
    if (s.hideOriginal !== undefined) next.hideOriginal = !!s.hideOriginal;
    if (s.warmDaemon !== undefined) next.warmDaemon = !!s.warmDaemon;
    if (s.batchWorkers !== undefined) {
      const bw = parseInt(s.batchWorkers, 10);
      if (isFinite(bw) && bw >= 1) next.batchWorkers = bw;
    }
    if (s.vx) next.vx = normalizeVx(s.vx);
    if (s.vectorizeShortcut && typeof s.vectorizeShortcut === "object") {
      next.vectorizeShortcut = {
        ctrl: s.vectorizeShortcut.ctrl !== false,
        shift: !!s.vectorizeShortcut.shift,
        alt: !!s.vectorizeShortcut.alt,
        key: parseInt(s.vectorizeShortcut.key, 10) || DEFAULT_SHORTCUT.key,
        code: s.vectorizeShortcut.code || DEFAULT_SHORTCUT.code,
        label: s.vectorizeShortcut.label || DEFAULT_SHORTCUT.label,
      };
    }
    if (s.settingsVersion !== undefined) next.settingsVersion = parseInt(s.settingsVersion, 10) || 1;
    return next;
  }, [normalizeVx]);

  /* v2.3.8 made warm Chrome and parallel pages the default; an older saved copy is re-seeded once. */
  const perfDefaultsPatch = useCallback((): Partial<PanelSettings> => {
    const admin = ((window as any).VBADMIN && (window as any).VBADMIN.defaults) || {};
    const bw = admin.batchWorkers !== undefined ? parseInt(admin.batchWorkers, 10) : 2;
    return {
      warmDaemon: admin.warmDaemon !== undefined ? !!admin.warmDaemon : true,
      batchWorkers: (isFinite(bw) && bw >= 1) ? bw : 2,
      settingsVersion: SETTINGS_VERSION,
    };
  }, []);

  const loadSettings = useCallback(() => {
    /* js/admin-config.js comes first, the user's own saved copy overrides it. */
    const admin = ((window as any).VBADMIN && (window as any).VBADMIN.defaults) || null;
    let patch: Partial<PanelSettings> = {};
    let lang: Lang | null = null;
    if (admin && typeof admin === "object") {
      const png = parseInt(admin.pngLongSide, 10);
      if (admin.pngLongSide !== undefined && isFinite(png)) patch.pngLongSide = png;
      if (admin.hideOriginal !== undefined) patch.hideOriginal = !!admin.hideOriginal;
      if (admin.warmDaemon !== undefined) patch.warmDaemon = !!admin.warmDaemon;
      const bw = parseInt(admin.batchWorkers, 10);
      if (admin.batchWorkers !== undefined && isFinite(bw) && bw >= 1) patch.batchWorkers = bw;
      if (admin.lang === "pt" || admin.lang === "en") lang = admin.lang;
    }
    try {
      const raw = localStorage.getItem("vb_settings");
      if (raw) {
        const s = JSON.parse(raw);
        patch = { ...patch, ...storedSettingsPatch(s) };
        if ((parseInt(s && s.settingsVersion, 10) || 1) < SETTINGS_VERSION) patch = { ...patch, ...perfDefaultsPatch() };
        const savedLang = localStorage.getItem("vb_lang");
        if (savedLang === "pt" || savedLang === "en") lang = savedLang;
      }
    } catch { }
    setStateRaw(prev => ({
      ...prev,
      settings: clampSettings({ ...prev.settings, ...patch }),
      lang: lang || prev.lang,
    }));
  }, [storedSettingsPatch, perfDefaultsPatch, clampSettings]);

  const pushSettingsToHost = useCallback((settings?: PanelSettings, lang?: Lang) => {
    try {
      const s = settings || stateRef.current.settings;
      const payload = JSON.stringify({ settings: { ...s, settingsVersion: SETTINGS_VERSION }, lang: lang || stateRef.current.lang });
      hostBridge.evalJsx(`VB.savePanelSettings(${jsxString(payload)})`, () => { });
    } catch { }
  }, []);

  const pushExportOptionsToHost = useCallback((vxIn?: VxSettings) => {
    try {
      const vx = normalizeVx(vxIn || stateRef.current.settings.vx);
      hostBridge.evalJsx(`VB.saveExportOptions(${jsxString(JSON.stringify(vx))})`, () => { });
    } catch { }
  }, [normalizeVx]);

  const persist = useCallback((settings: PanelSettings, lang: Lang) => {
    try {
      localStorage.setItem("vb_settings", JSON.stringify({ ...settings, settingsVersion: SETTINGS_VERSION }));
      localStorage.setItem("vb_lang", lang);
    } catch { }
    pushSettingsToHost(settings, lang);
    pushExportOptionsToHost(settings.vx);
  }, [pushSettingsToHost, pushExportOptionsToHost]);

  const saveSettings = useCallback(() => {
    const cur = stateRef.current;
    persist(cur.settings, cur.lang);
  }, [persist]);

  const updateSettings = useCallback((patch: Partial<PanelSettings>) => {
    const next = clampSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setStateRaw(prev => ({ ...prev, settings: next }));
    persist(next, langRef.current);
  }, [persist, clampSettings]);

  const updateVx = useCallback((patch: Partial<VxSettings>) => {
    const vx = normalizeVx({ ...settingsRef.current.vx, ...patch });
    const next = clampSettings({ ...settingsRef.current, vx });
    settingsRef.current = next;
    setStateRaw(prev => ({ ...prev, settings: next }));
    persist(next, langRef.current);
  }, [normalizeVx, persist, clampSettings]);

  const setLang = useCallback((lang: Lang) => {
    const cur = stateRef.current;
    if (lang !== "pt" && lang !== "en") return;
    if (cur.lang === lang) return;
    persist(cur.settings, lang);
    setStateRaw(prev => ({ ...prev, lang }));
  }, [persist]);

  const toggleLanguage = useCallback(() => {
    setLang(stateRef.current.lang === "en" ? "pt" : "en");
  }, [setLang]);

  const renderSelection = useCallback((info: any) => {
    setStateRaw(prev => ({ ...prev, selection: info || null }));
  }, []);

  const isWindowMode = useCallback((): boolean => {
    try { return String(window.location.search || "").indexOf("view=window") >= 0; } catch { return false; }
  }, []);

  const selectionText = useCallback((info: any): string => {
    if (!info) return "";
    const doc = (info && info.doc) ? String(info.doc) : "";
    let n = (info && info.sel !== undefined && info.sel !== null) ? parseInt(info.sel, 10) : 0;
    if (!isFinite(n) || n < 0) n = 0;
    const suffix = (doc && !isWindowMode()) ? ` — ${doc}` : "";
    if (!info || !info.open) return t("selectionNoDoc") || "No document open";
    if (n === 0) return (t("selectionNothing") || "Nothing selected") + suffix;
    return (t(n === 1 ? "selectionCount" : "selectionCountMany") || "{count} layers selected").replace("{count}", String(n)) + suffix;
  }, [t, isWindowMode]);

  const syncSettingsFromHost = useCallback((done?: (ok: boolean) => void) => {
    try {
      hostBridge.evalJsx("VB.loadPanelSettings()", (txt: any) => {
        let applied = false;
        try {
          const raw = String(txt || "");
          if (raw && raw.charAt(0) === "{") {
            const saved = JSON.parse(raw);
            const fileSettings = (saved && saved.settings) ? saved.settings : saved;
            const before = stateRef.current.settings;
            let patch = storedSettingsPatch(fileSettings);
            const reseeded = (parseInt(fileSettings && fileSettings.settingsVersion, 10) || 1) < SETTINGS_VERSION;
            if (reseeded) patch = { ...patch, ...perfDefaultsPatch() };
            const after = clampSettings({ ...before, ...patch });
            const lang = (saved && (saved.lang === "pt" || saved.lang === "en")) ? saved.lang : stateRef.current.lang;
            setStateRaw(prev => ({ ...prev, settings: { ...prev.settings, ...patch }, lang }));
            if (reseeded) pushSettingsToHost(after, lang);
            const vectorizer = (window as any).VBPanel && (window as any).VBPanel.vectorizer;
            if (before.warmDaemon !== after.warmDaemon || before.batchWorkers !== after.batchWorkers) {
              if (after.warmDaemon) { if (vectorizer) vectorizer.ensureDaemonRunning(); }
              else if (vectorizer) vectorizer.stopWarmDaemon();
            }
            applied = true;
          }
        } catch { }
        if (done) done(applied);
      });
    } catch { if (done) done(false); }
  }, [storedSettingsPatch, perfDefaultsPatch, clampSettings, pushSettingsToHost]);

  const addHistory = useCallback((action: string, file: string, ok: boolean, message: string) => {
    const item = { time: new Date().toLocaleTimeString(), action, file: file || "", ok: !!ok, msg: message || "" };
    setStateRaw(prev => ({ ...prev, history: [item, ...prev.history].slice(0, 60) }));
  }, []);

  const updateButtons = useCallback(() => {
    const hostOk = getHostOk();
    setStateRaw(prev => (prev._hostOk === hostOk ? prev : { ...prev, _hostOk: hostOk }));
  }, []);

  const layoutMode = useCallback((): string => (isWindowMode() ? "mini" : "full"), [isWindowMode]);

  const applyLayout = useCallback((): string => {
    const mode = isWindowMode() ? "mini" : "full";
    try {
      document.body.setAttribute("data-mode", mode);
      document.documentElement.setAttribute("data-mode", mode);
    } catch { }
    refreshStatusCopy();
    return mode;
  }, [isWindowMode, refreshStatusCopy]);

  const setWindowMode = useCallback((flag: boolean): string => {
    try {
      if (flag && document.body.className.indexOf("windowMode") < 0) document.body.className = (document.body.className ? document.body.className + " " : "") + "windowMode";
    } catch { }
    return applyLayout();
  }, [applyLayout]);

  const extensionVersion = useCallback((): string => extensionVersionRef.current, []);

  const readExtensionVersion = (): string => {
    try {
      const api = (window as any).__adobe_cep__;
      const fsApi = (window as any).cep && (window as any).cep.fs;
      if (!api || !fsApi || !fsApi.readFile) return "";
      const base = String(api.getSystemPath("extension") || "")
        .replace(/^file:\/\/\//, "").replace(/\\/g, "/");
      if (!base) return "";
      const res = fsApi.readFile(base + "/CSXS/manifest.xml");
      if (!res || res.err !== 0 || !res.data) return "";
      const m = /ExtensionBundleVersion="([0-9][0-9.]*)"/.exec(String(res.data));
      return m ? m[1] : "";
    } catch { return ""; }
  };

  /* Host readiness lives in the bridge store; mirror it into state so buttons re-render. */
  const hostOk = useSyncExternalStore(subscribeHost, getHostOk, getHostOk);
  useEffect(() => { updateButtons(); }, [hostOk, updateButtons]);
  const cancelable = !!(state.busy || state.waiting || state.login);
  useEffect(() => {
    try { document.body.classList.toggle("canCancel", cancelable); } catch { }
  }, [cancelable]);

  useEffect(() => {
    extensionVersionRef.current = readExtensionVersion();
    const version = extensionVersionRef.current;
    setStateRaw(prev => (prev._appVersion === version ? prev : { ...prev, _appVersion: version }));
    applyLayout();
    loadSettings();
    schedulePoll(currentPollMs());
    return () => {
      if (pollTimerRef.current) { try { clearTimeout(pollTimerRef.current); } catch { } pollTimerRef.current = null; }
    };
  }, [applyLayout, loadSettings, schedulePoll, currentPollMs]);

  useEffect(() => {
    try { document.documentElement.lang = state.lang; } catch { }
    refreshStatusCopy();
  }, [state.lang, refreshStatusCopy]);

  /* Legacy entry points for code that reaches the panel through window.VBPanel.core. */
  useEffect(() => {
    const g = window as any;
    g.VBPanel = g.VBPanel || {};
    g.VBPanel.core = {
      get state() { return stateRef.current; },
      events,
      renderSelection,
      syncSettingsFromHost,
      isWindowMode,
      setState,
      t,
    };
  }, [events, renderSelection, syncSettingsFromHost, isWindowMode, setState, t]);

  const actions = useMemo<CoreActions>(() => ({
    t, fmtElapsed, runElapsedMs, setStatus, setStatusKey, refreshStatusCopy, shortenForMini, setDetail,
    setRunTimerDetail, showError, appendLogUI, log, loadSettings, saveSettings, updateSettings, updateVx,
    setLang, toggleLanguage, renderSelection, selectionText,
    syncSettingsFromHost, pushSettingsToHost, pushExportOptionsToHost, updateButtons,
    addHistory, extensionVersion, shortcutLabel,
    events,
    isWindowMode, layoutMode, applyLayout, setWindowMode,
    currentPollMs, schedulePoll, normalizeVx, VX_PRESETS, jsxString, setState,
    get live() { return stateRef.current; },
  }), [
    t, fmtElapsed, runElapsedMs, setStatus, setStatusKey, refreshStatusCopy, shortenForMini, setDetail,
    setRunTimerDetail, showError, appendLogUI, log, loadSettings, saveSettings, updateSettings, updateVx,
    setLang, toggleLanguage, renderSelection, selectionText,
    syncSettingsFromHost, pushSettingsToHost, pushExportOptionsToHost, updateButtons,
    addHistory, extensionVersion, shortcutLabel, events,
    isWindowMode, layoutMode, applyLayout, setWindowMode,
    currentPollMs, schedulePoll, normalizeVx, setState,
  ]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return (
    <CoreContext.Provider value={value}>
      {children}
    </CoreContext.Provider>
  );
}

export const useCore = (): CoreContextValue => {
  const ctx = useContext(CoreContext);
  if (!ctx) throw new Error("useCore must be used within a CoreProvider");
  return ctx;
};
