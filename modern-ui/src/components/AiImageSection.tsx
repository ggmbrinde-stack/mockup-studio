import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../context/core-context";
import { hostBridge, useHost } from "../hooks/use-host";

const GEMINI_URL = "https://gemini.google.com/app";
const LAYER_NAME = "Gemini Image";
const MAX_INLINE_PREVIEW = 8 * 1024 * 1024;

const TEMPLATES: Record<string, string> = {
  product: "aiImgTplProductText",
  background: "aiImgTplBackgroundText",
  photo: "aiImgTplPhotoText",
  general: "aiImgTplGeneralText",
};

const ERROR_KEYS: Record<string, string> = {
  unsupportedImage: "aiImgUnsupported",
  badResponse: "aiImgBadResponse",
  fileNotFound: "errorFileNotFound",
  fileUnreadable: "errorFileUnreadable",
  noDocument: "errorNoDocument",
  noSelection: "errorNoSelection",
  documentLocked: "errorDocumentLocked",
  layerLocked: "errorLayerLocked",
  placeFailed: "errorPlaceFailed",
  docChanged: "errorDocChanged",
};

function extKind(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  const ext = m ? m[1].toLowerCase() : "";
  if (ext === "png") return "png";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return "";
}

function mime(kind: string): string {
  if (kind === "jpeg") return "image/jpeg";
  if (kind === "webp") return "image/webp";
  return "image/png";
}

function fileUrl(path: string): string {
  let p = String(path || "").replace(/\\/g, "/");
  if (p.charAt(0) !== "/") p = "/" + p;
  return "file://" + encodeURI(p);
}

function previewSrc(path: string, kind: string, bytes: number): string {
  if (bytes && bytes > MAX_INLINE_PREVIEW) return fileUrl(path);
  try {
    const fsApi = (window as any).cep && (window as any).cep.fs;
    const enc = ((window as any).cep && (window as any).cep.encoding && (window as any).cep.encoding.Base64) || "Base64";
    if (fsApi && fsApi.readFile) {
      const r = fsApi.readFile(path, enc);
      if (r && r.err === 0 && r.data) return `data:${mime(kind)};base64,${r.data}`;
    }
  } catch { }
  return fileUrl(path);
}

function humanSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  return (Math.round((n / (1024 * 1024)) * 10) / 10) + " MB";
}

function hostString(res: any): string {
  let s = String(res == null ? "" : res);
  if (s.length > 1 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1);
  return s;
}

export function AiImageSection() {
  const { actions } = useCore();
  /* Subscribed, not read once: the section must enable itself when the host finishes loading. */
  const { hostOk } = useHost(actions.t);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<any>(null);
  const [sourceSrc, setSourceSrc] = useState("");
  const [result, setResult] = useState<any>(null);
  const [resultSrc, setResultSrc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState("");
  const [status, setStatus] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const [results, setResults] = useState<any[]>([]);
  const autoPickedRef = useRef(false);
  const watchTimerRef = useRef<any>(null);
  const watchRef = useRef({ watching: 0, seq: 0, path: "" });

  const evalJsx = hostBridge.evalJsx;

  const txt = useCallback((key: string, fallback: string): string => {
    try {
      const v = actions.t(key);
      if (v && v !== key) return v;
    } catch { }
    return fallback;
  }, [actions]);

  const setNote = useCallback((message: string, tone?: string) => {
    setStatus({ text: message || "", tone: tone || "" });
  }, []);

  const errorText = useCallback((r: any): string => {
    const code = String((r && r.error) || "");
    const key = ERROR_KEYS[code];
    const text = key ? txt(key, "") : "";
    if (text) return text;
    try {
      const f = hostBridge.friendlyError(code);
      if (f && f !== code) return f;
    } catch { }
    return code || txt("aiImgBadResponse", "Something went wrong.");
  }, [txt]);

  const hostJson = useCallback((res: any): any => {
    let parsed = null;
    try { parsed = JSON.parse(hostString(res) || ""); } catch { parsed = null; }
    if (!parsed) return { ok: false, error: "badResponse" };
    return parsed;
  }, []);

  const pngSize = useCallback((): number => {
    let size = 1700;
    try {
      const v = parseInt(String(actions.live.settings.pngLongSide), 10);
      if (isFinite(v)) size = v;
    } catch { }
    if (!size) size = 1700;
    return size;
  }, [actions]);

  const saveRequest = useCallback((src: any) => {
    if (!src || !hostBridge.hostOk) return;
    const payload = {
      id: src.id,
      app: "mockup-studio",
      doc: src.docName || "",
      source: src.path,
      width: src.width || 0,
      height: src.height || 0,
      prompt,
      template,
      createdAt: new Date().toISOString(),
    };
    evalJsx(`VB.saveGeminiRequest ? VB.saveGeminiRequest(${JSON.stringify(payload)}) : ""`, () => { });
  }, [prompt, template, evalJsx]);

  const refreshResults = useCallback(() => {
    if (!hostBridge.hostOk) { setResults([]); return; }
    evalJsx(`VB.listGeminiResults ? VB.listGeminiResults(8) : ""`, (res: any) => {
      const r = hostJson(res);
      setResults(r.ok && r.files ? r.files : []);
    });
  }, [evalJsx, hostJson]);

  const placeResultRef = useRef<() => void>(() => { });

  const stopWatch = useCallback(() => {
    watchRef.current.watching = 0;
    watchRef.current.seq++;
    if (watchTimerRef.current) { clearTimeout(watchTimerRef.current); watchTimerRef.current = null; }
  }, []);

  const applyResult = useCallback((info: any) => {
    if (!info || !info.path) return;
    setResult(info);
    setResultSrc(previewSrc(info.path, info.kind || extKind(info.name), info.bytes));
    setNote(txt("aiImgResultReady", "Result ready. Place it to add the image to the document."), "ok");
  }, [txt, setNote]);

  const placeResult = useCallback(() => {
    if (busy) return;
    if (!result) return setNote(txt("aiImgNeedResult", "Choose the downloaded image first."), "bad");
    stopWatch();
    if (!hostBridge.hostOk) return setNote(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    const auto = autoPickedRef.current;
    autoPickedRef.current = false;
    setBusy(true);
    setNote(txt("aiImgPlacing", "Placing the image…"));
    const args: any = {
      path: result.path,
      layerName: LAYER_NAME,
      union: source ? source.union : null,
    };
    if (auto && source) args.requireDoc = { fullName: source.docFullName || "", name: source.docName || "" };
    const encoded = encodeURIComponent(JSON.stringify(args));
    evalJsx(`VB.placeImageFile ? VB.placeImageFile(${JSON.stringify(encoded)}) : ""`, (res: any) => {
      setBusy(false);
      const r = hostJson(res);
      if (!r.ok) {
        if (auto && String(r.error) === "docChanged") {
          return setNote(txt("aiImgDocChangedAuto", "The image is ready, but the active document is not the one you exported from. Open that file and press “Place in Illustrator”."));
        }
        return setNote(errorText(r), "bad");
      }
      const msg = auto
        ? txt("aiImgAutoPlaced", "Found in the results folder and placed on the “Gemini Image” layer.")
        : txt("aiImgPlaced", "Placed on the “Gemini Image” layer.");
      setNote(r.embedded === false ? msg + " " + txt("aiImgLinked", "It is linked to the file, not embedded.") : msg, "ok");
    });
  }, [busy, result, stopWatch, setNote, txt, source, evalJsx, hostJson, errorText]);

  placeResultRef.current = placeResult;

  const pollWatch = useCallback((seq: number) => {
    watchTimerRef.current = null;
    const w = watchRef.current;
    if (!w.watching || seq !== w.seq || !hostBridge.hostOk) return stopWatch();
    const arm = w.watching;
    if (new Date().getTime() - arm > 15 * 60 * 1000) {
      setNote(txt("aiImgWatchTimeout", "Still no download. Save the image wherever you like and use “Choose result…”."));
      return stopWatch();
    }
    watchTimerRef.current = setTimeout(() => pollWatch(seq), 3000);
    evalJsx(`VB.newestGeminiResult ? VB.newestGeminiResult(${arm}) : ""`, (res: any) => {
      if (seq !== watchRef.current.seq) return;
      const r = hostJson(res);
      if (!r.ok || !r.file || !r.file.path || r.file.path === watchRef.current.path) return;
      watchRef.current.path = r.file.path;
      stopWatch();
      autoPickedRef.current = true;
      applyResult({ path: r.file.path, name: r.file.name, kind: extKind(r.file.name), bytes: r.file.bytes });
      placeResultRef.current();
    });
  }, [stopWatch, setNote, txt, evalJsx, hostJson, applyResult]);

  const startWatch = useCallback(() => {
    stopWatch();
    watchRef.current.path = "";
    watchRef.current.watching = new Date().getTime();
    pollWatch(watchRef.current.seq);
  }, [stopWatch, pollWatch]);

  const useSelection = useCallback(() => {
    if (busy) return;
    stopWatch();
    if (!hostBridge.hostOk) return setNote(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    setBusy(true);
    setNote(txt("aiImgPreparing", "Exporting the selection…"));
    evalJsx(`VB.prepareGeminiSource(${pngSize()})`, (res: any) => {
      setBusy(false);
      const r = hostJson(res);
      if (!r.ok) return setNote(errorText(r), "bad");
      setSource(r);
      setSourceSrc(previewSrc(r.path, "png", r.bytes));
      saveRequest(r);
      refreshResults();
      setNote(txt("aiImgSourceReady", "Source ready. Open Gemini, upload this file and paste the prompt."), "ok");
    });
  }, [busy, stopWatch, setNote, txt, evalJsx, pngSize, hostJson, errorText, saveRequest, refreshResults]);

  const legacyCopy = useCallback((text: string): boolean => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch { }
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.body.removeChild(ta);
      return !!ok;
    } catch { return false; }
  }, []);

  const copyText = useCallback((text: string, done: (ok: boolean) => void) => {
    const value = String(text || "");
    if (!value) return done(false);
    try {
      if ((navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        (navigator as any).clipboard.writeText(value).then(() => done(true), () => done(legacyCopy(value)));
        return;
      }
    } catch { }
    done(legacyCopy(value));
  }, [legacyCopy]);

  const openResultsFolder = useCallback(() => {
    if (!hostBridge.hostOk) return;
    evalJsx(`VB.openFolder ? VB.openFolder(VB.geminiPaths().results) : ""`);
  }, [evalJsx]);

  const openGemini = useCallback(() => {
    if (!source) return setNote(txt("aiImgSelectFirst", "Choose the artwork first."), "bad");
    if (!hostBridge.hostOk) return setNote(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    saveRequest(source);
    const requested = prompt;
    copyText(requested, (copied) => {
      evalJsx(`VB.openGeminiWindow ? VB.openGeminiWindow(${JSON.stringify(GEMINI_URL)}) : ""`, (res: any) => {
        const r = hostJson(res);
        if (!r.ok) return setNote(errorText(r), "bad");
        const parts: string[] = [txt("aiImgGeminiOpened", "Gemini is open in Chrome.")];
        if (requested) {
          parts.push(copied ? txt("aiImgPromptCopied", "The prompt is on your clipboard.") : txt("aiImgCopyFailed", "Copy the prompt with the button below."));
        }
        if (r.via !== "chrome") parts.push(txt("aiImgNoChrome", "Chrome was not found, so the link opened in the default browser."));
        if (source && source.resultsFolder) {
          let hint = txt("aiImgSaveInto", "Save the download into {path} — the panel picks it up from there.");
          if (hint.indexOf("{path}") >= 0) hint = hint.split("{path}").join(source.resultsFolder);
          parts.push(hint);
        } else {
          parts.push(txt("aiImgAwaiting", "Upload the source with “Show file”, generate, and save the image into the results folder."));
        }
        setNote(parts.join(" "), r.via === "chrome" ? "ok" : "");
        openResultsFolder();
        refreshResults();
        startWatch();
      });
    });
  }, [source, setNote, txt, saveRequest, prompt, copyText, evalJsx, hostJson, errorText, openResultsFolder, refreshResults, startWatch]);

  const copyPrompt = useCallback(() => {
    if (!prompt) return setNote(txt("aiImgNeedPrompt", "Write what you want first."), "bad");
    copyText(prompt, (ok) => {
      if (ok) setNote(txt("aiImgPromptCopied", "The prompt is on your clipboard."), "ok");
      else setNote(txt("aiImgCopyFailed", "Copy the prompt with the button below."), "bad");
    });
  }, [prompt, setNote, txt, copyText]);

  const showSource = useCallback(() => {
    if (!source || !hostBridge.hostOk) return;
    evalJsx(`VB.revealFile ? VB.revealFile(${JSON.stringify(source.path)}) : ""`);
  }, [source, evalJsx]);

  const pickResult = useCallback(() => {
    if (busy) return;
    stopWatch();
    if (!hostBridge.hostOk) return setNote(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    setBusy(true);
    evalJsx(`VB.pickImageFile ? VB.pickImageFile() : ""`, (res: any) => {
      setBusy(false);
      const r = hostJson(res);
      if (!r.ok) {
        if (String(r.error) === "cancelled") return setNote(txt("aiImgCancelled", "No file chosen."));
        return setNote(errorText(r), "bad");
      }
      applyResult(r);
    });
  }, [busy, stopWatch, setNote, txt, evalJsx, hostJson, errorText, applyResult]);

  /* Host readiness flips through the bridge store; react to it instead of polling. */
  useEffect(() => {
    if (hostOk) {
      setNote(txt("aiImgIdle", "Select artwork in Illustrator and press “Use selection”."));
      evalJsx(`VB.cleanGeminiWorkspace ? VB.cleanGeminiWorkspace(7) : ""`);
      refreshResults();
    } else {
      setNote(txt("aiImgConnecting", "Connecting to Illustrator…"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostOk]);

  useEffect(() => () => { if (watchTimerRef.current) clearTimeout(watchTimerRef.current); }, []);

  const t = actions.t;
  const needSource = !source;
  const needResult = !result;
  const lock = busy || !hostOk;

  return (
    <details className="settings" id="aiImageBox">
      <summary className="settingsSummary">
        <span>{t("aiImgTitle")}</span>
      </summary>
      <div className="settingsGrid">
        <div className="field full">
          <div className="hint">{t("aiImgHint")}</div>
        </div>
        <div className="field full">
          <div className="aiImgRow">
            <div className="aiImgThumb">
              {!sourceSrc ? (
                <span id="aiImgSourceEmpty" className="aiImgEmpty">{t("aiImgSource")}</span>
              ) : (
                <img id="aiImgSourcePreview" alt="" src={sourceSrc} />
              )}
            </div>
            <div className="aiImgInfo">
              <div id="aiImgSourceName" className="aiImgName">{source ? (source.name || "") : ""}</div>
              <div id="aiImgSourceMeta" className="svg-history-sub">
                {source ? [
                  source.width && source.height ? Math.round(source.width) + "×" + Math.round(source.height) + " pt" : "",
                  humanSize(source.bytes),
                  source.docName || "",
                ].filter(Boolean).join(" · ") : ""}
              </div>
              <div className="row">
                <button id="aiImgUseSelection" className="btn small" type="button" onClick={useSelection} disabled={lock}>{t("aiImgUseSelection")}</button>
                <button id="aiImgShowSource" className="btn small" type="button" onClick={showSource} disabled={lock || needSource}>{t("aiImgShowSource")}</button>
              </div>
            </div>
          </div>
        </div>
        <div className="field full">
          <label htmlFor="aiImgPrompt">{t("aiImgInstructions")}</label>
          <textarea
            id="aiImgPrompt"
            className="aiPrompt"
            rows={3}
            spellCheck={false}
            placeholder={t("aiImgPromptPlaceholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="field full">
          <label htmlFor="aiImgTemplate">{t("aiImgTemplate")}</label>
          <select
            id="aiImgTemplate"
            value={template}
            onChange={(e) => {
              const name = e.target.value;
              setTemplate(name);
              const text = txt(TEMPLATES[name], "");
              if (text) setPrompt((cur) => (cur ? cur + "\n" + text : text));
            }}
          >
            <option value="">{t("aiImgTplNone")}</option>
            <option value="product">{t("aiImgTplProduct")}</option>
            <option value="background">{t("aiImgTplBackground")}</option>
            <option value="photo">{t("aiImgTplPhoto")}</option>
            <option value="general">{t("aiImgTplGeneral")}</option>
          </select>
          <div className="hint">{t("aiImgTplHint")}</div>
        </div>
        <div className="field full">
          <div className="row">
            <button id="aiImgOpen" className="btn primary small" type="button" onClick={openGemini} disabled={lock || needSource}>{t("aiImgOpen")}</button>
            <button id="aiImgCopy" className="btn small" type="button" onClick={copyPrompt} disabled={lock || needSource}>{t("aiImgCopy")}</button>
            <button id="aiImgResultsFolder" className="btn small" type="button" onClick={openResultsFolder} disabled={!hostOk}>{t("aiImgResultsFolder")}</button>
          </div>
          <div id="aiImgStatus" className={"hint aiImgStatus" + (status.tone ? " " + status.tone : "")} role="status" aria-live="polite">{status.text}</div>
        </div>
        <div className="field full">
          <div className="aiImgRow">
            <div className="aiImgThumb">
              {!resultSrc ? (
                <span id="aiImgResultEmpty" className="aiImgEmpty">{t("aiImgResult")}</span>
              ) : (
                <img id="aiImgResultPreview" alt="" src={resultSrc} />
              )}
            </div>
            <div className="aiImgInfo">
              <div id="aiImgResultName" className="aiImgName">{result ? (result.name || "") : ""}</div>
              <div className="row">
                <button id="aiImgPick" className="btn small" type="button" onClick={pickResult} disabled={lock}>{t("aiImgPick")}</button>
                <button id="aiImgPlace" className="btn small" type="button" onClick={placeResult} disabled={lock || needResult}>{t("aiImgPlace")}</button>
              </div>
            </div>
          </div>
          <div className="panelSubTitle">{t("aiImgResultsTitle")}</div>
          <div id="aiImgResults" className="aiImgResults">
            {(!results || results.length === 0) && (
              <div className="hint">{t("aiImgNoResults")}</div>
            )}
            {(results || []).map((item, i) => (
              <div key={(item.path || "") + i} className="aiImgResultRow">
                <div className="aiImgResultMeta">
                  <div className="aiImgResultName">{item.name || ""}</div>
                  <div className="svg-history-sub">{humanSize(item.bytes)}</div>
                </div>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => applyResult({ path: item.path, name: item.name, kind: extKind(item.name), bytes: item.bytes })}
                >
                  {t("aiImgUse")}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
