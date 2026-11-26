import { useEffect, useMemo, useSyncExternalStore } from "react";

export interface HostBridge {
  readonly hostOk: boolean;
  setHostOk: (ok: boolean) => void;
  evalJsx: (script: string, callback?: (result: string) => void) => void;
  parseResult: (result: string) => { ok: boolean; error?: string; raw: string; [key: string]: any };
  friendlyError: (code: string) => string;
  loadHost: (callback: (result: string) => void) => void;
  openLogFolder: () => void;
  openSvgsFolder: () => void;
  getCS: () => any;
  setCS: (cs: any) => void;
  logToHost: (message: string) => void;
  subscribe: (listener: () => void) => () => void;
}

type Listener = () => void;

/* One CSInterface and one hostOk flag for the whole panel. The hooks used to each own a
   private copy, so the host loaded in one hook never counted as loaded in the others. */
const store: { cs: any; hostOk: boolean; listeners: Set<Listener> } = { cs: null, hostOk: false, listeners: new Set() };
let translate: (key: string) => string = (key) => key;

const friendlyErrorMap: Record<string, string> = {
  noDocument: "errorNoDocument",
  noSelection: "errorNoSelection",
  emptyBounds: "errorEmptyBounds",
  duplicateFailed: "errorDuplicateFailed",
  artboardFailed: "errorArtboardFailed",
  exportFailed: "errorExportFailed",
  documentLocked: "errorDocumentLocked",
  layerLocked: "errorLayerLocked",
  fileNotFound: "errorFileNotFound",
  fileUnreadable: "errorFileUnreadable",
  badSvgFile: "errorBadSvgFile",
  badBounds: "errorBadBounds",
  placeFailed: "errorPlaceFailed",
  docChanged: "errorDocChanged",
  batchChanged: "errorBatchChanged",
  batchItemInvalid: "errorBatchItemInvalid",
  svgImportFailed: "errorSvgImportFailed",
  noAgent: "errorNoAgent",
};

export const subscribeHost = (listener: Listener): (() => void) => {
  store.listeners.add(listener);
  return () => { store.listeners.delete(listener); };
};

export const getHostOk = (): boolean => store.hostOk;

export const setHostOk = (ok: boolean): void => {
  const next = !!ok;
  if (next === store.hostOk) return;
  store.hostOk = next;
  store.listeners.forEach((listener) => { try { listener(); } catch { } });
};

export const getCS = (): any => {
  if (store.cs === null || store.cs === undefined) {
    try {
      const CS = (window as any).CSInterface;
      store.cs = CS ? new CS() : null;
    } catch { store.cs = null; }
  }
  return store.cs;
};

export const setCS = (cs: any): void => { store.cs = cs; };

export const evalJsx = (script: string, callback?: (result: string) => void): void => {
  const cs = store.cs;
  if (!cs) {
    if (callback) callback("EvalScript error: CSInterface unavailable");
    return;
  }
  try {
    cs.evalScript(script, (result: string) => {
      if (callback) callback(result);
    });
  } catch (e) {
    if (callback) callback(`EvalScript error: ${e}`);
  }
};

export const parseResult = (result: string) => {
  const text = String(result || "");
  if (!text || text.indexOf("EvalScript error") === 0) {
    return { ok: false, error: "badResponse", raw: text };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "badResponse", raw: text };
  }
};

export const friendlyError = (code: string): string => {
  const key = friendlyErrorMap[String(code || "")];
  if (key) return translate(key);
  return String(code || "unknown error");
};

/* CEP's getSystemPath() takes the SystemPath enum straight through to the host:
   this csinterface.js ships string values (SystemPath.EXTENSION === "extension").
   Passing a number here resolves to a different folder, so every host script
   fails to load and VB.ping never gets defined. */
export const extensionSystemPath = (): any => {
  try {
    const sp = (window as any).SystemPath;
    if (sp && sp.EXTENSION) return sp.EXTENSION;
  } catch { }
  return "extension";
};

export const loadHost = (callback: (result: string) => void): void => {
  const cs = store.cs;
  let ext = "";
  try {
    ext = cs.getSystemPath(extensionSystemPath());
  } catch (e) {
    callback(`SystemPath.EXTENSION failed: ${e}`);
    return;
  }
  if (!ext) { callback("Extension path is empty"); return; }
  ext = String(ext).replace(/\\/g, "/");

  const files = [
    ext + "/host/json.jsx",
    ext + "/host/core.jsx",
    ext + "/host/batch.jsx",
    ext + "/host/export.jsx",
    ext + "/host/place.jsx",
    ext + "/host/import.jsx",
    ext + "/host/ai.jsx",
    ext + "/host/agent.jsx",
    ext + "/host/watch.jsx",
  ];

  let loader = "(function(){";
  loader += "$.global.VB=$.global.VB||{};$.global.VB._loadErrors=[];";
  loader += "function _ld(p){try{var f=new File(p);if(!f.exists){$.global.VB._loadErrors.push('missing:'+p);return;}$.evalFile(f);}catch(e){try{$.global.VB._loadErrors.push(String(p)+':'+String(e));}catch(e2){}}}";
  for (let i = 0; i < files.length; i++) {
    loader += `_ld(${JSON.stringify(files[i])});`;
  }
  loader += `$.global.VB.extensionPath=${JSON.stringify(ext)};`;
  loader += "try{return $.global.VB.ping();}catch(e){return 'error:ping:'+String(e);}";
  loader += "})()";

  evalJsx(loader, (result) => {
    const out = String(result || "");
    /* Quote the per-file load errors back into the panel, so a bad install or a
       missing script reads as a reason instead of a bare "did not load". */
    evalJsx("(function(){try{var e=$.global.VB&&$.global.VB._loadErrors;return (e&&e.length)?e.join(' | '):'';}catch(x){return '';}})()", (errs) => {
      const detail = String(errs || "");
      const known = detail && detail !== "EvalScript error";
      if (out === "ok") {
        if (known) console.log("Host load warnings: " + detail);
        callback(out);
        return;
      }
      callback(known ? out + " — " + detail : out);
    });
  });
};

export const openLogFolder = (): void => {
  if (!store.hostOk) return;
  evalJsx("VB.openFolder(VB.getBridgeFolderPath())");
};

export const openSvgsFolder = (): void => {
  if (!store.hostOk) return;
  evalJsx("VB.openFolder(VB.getBridgeFolderPath() + '/agent-downloads')");
};

export const logToHost = (message: string): void => {
  const cs = store.cs;
  if (!cs || !store.hostOk) return;
  try {
    cs.evalScript(`$.global.VB.log(${JSON.stringify(String(message))})`);
  } catch { }
};

export const hostBridge: HostBridge = {
  get hostOk(): boolean { return store.hostOk; },
  setHostOk,
  getCS,
  setCS,
  evalJsx,
  parseResult,
  friendlyError,
  loadHost,
  openLogFolder,
  openSvgsFolder,
  logToHost,
  subscribe: subscribeHost,
};

const g = window as any;
g.VBPanel = g.VBPanel || {};
g.VBPanel.bridge = hostBridge;

export function useHost(t: (key: string) => string): HostBridge {
  const hostOk = useSyncExternalStore(subscribeHost, getHostOk, getHostOk);
  useEffect(() => { translate = t; }, [t]);
  return useMemo(() => ({ ...hostBridge, hostOk }), [hostOk]);
}
