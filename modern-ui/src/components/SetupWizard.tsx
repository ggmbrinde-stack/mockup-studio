import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../context/core-context";

const KEY = "vb_setup_done";
const TOTAL = 3;

export function SetupWizard() {
  const { state, actions } = useCore();
  const [step, setStep] = useState(1);
  const [open, setOpen] = useState(false);
  const [autoStatusText, setAutoStatusText] = useState("");
  const [autoFailed, setAutoFailed] = useState(false);
  const autoRef = useRef({ tried: false, busy: false, timer: null as any });

  const s = state.settings;
  const pngValue = parseInt(String(s.pngLongSide), 10) || 1700;
  const pngPreset = (pngValue === 1200 || pngValue === 1700 || pngValue === 2400 || pngValue === 0) ? String(pngValue) : "1700";

  const isDone = useCallback((): boolean => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
  }, []);

  const markDone = useCallback(() => {
    try { localStorage.setItem(KEY, "1"); } catch { }
  }, []);

  const adminCfg = useCallback((): any => (window as any).VBADMIN || {}, []);

  const autoFallback = useCallback((reason?: string) => {
    autoRef.current.busy = false;
    let text = actions.t("setupAutoFailed") || "Automatic sign-in did not work here. Use the button above to sign in once.";
    if (reason) text = text + " (" + reason + ")";
    setAutoStatusText(text);
    setAutoFailed(true);
  }, [actions]);

  const pollAutoSignIn = useCallback((attempt: number) => {
    if (attempt > 120) { autoFallback("timeout"); return; }
    autoRef.current.timer = setTimeout(() => {
      const bridge = (window as any).VBPanel?.bridge;
      if (!bridge || !bridge.hostOk) { autoFallback("no host"); return; }
      bridge.evalJsx("VB.agentStatus('')", (txt: any) => {
        let st: any = null;
        try { st = JSON.parse(txt); } catch { st = null; }
        const stateStr = (st && st.state) ? String(st.state) : "";
        if (stateStr === "done") {
          autoRef.current.busy = false;
          setAutoStatusText(actions.t("setupAutoOk") || "Signed in. Nothing else is needed.");
          setAutoFailed(false);
          return;
        }
        if (stateStr === "loginRequired" || stateStr === "error") {
          autoFallback(stateStr === "error" && st && st.message ? String(st.message) : "");
          return;
        }
        pollAutoSignIn(attempt + 1);
      });
    }, 700);
  }, [autoFallback, actions]);

  const startAutoSignIn = useCallback(() => {
    if (autoRef.current.tried || autoRef.current.busy) return;
    if (!adminCfg().autoSignIn) return;
    const bridge = (window as any).VBPanel?.bridge;
    if (!bridge || !bridge.hostOk) return;
    autoRef.current.tried = true;
    autoRef.current.busy = true;
    setAutoStatusText(actions.t("setupAutoSignIn") || "Signing in with the studio account…");
    setAutoFailed(false);
    bridge.evalJsx("VB.agentStart('autologin','')", (started: any) => {
      if (String(started || "").indexOf("started") !== 0) { autoFallback(String(started || "")); return; }
      pollAutoSignIn(0);
    });
  }, [adminCfg, autoFallback, pollAutoSignIn, actions]);

  useEffect(() => {
    if (step === 2) startAutoSignIn();
  }, [step, startAutoSignIn]);

  const startSignIn = useCallback(() => {
    const bridge = (window as any).VBPanel?.bridge;
    if (!bridge || !bridge.hostOk) { setAutoStatusText(actions.t("errorHost")); setAutoFailed(true); return; }
    (window as any).VBPanel.vectorizer.signIn();
    setAutoStatusText(actions.t("setupSignInStatus") || "");
  }, [actions]);

  const finish = useCallback(() => {
    markDone();
    setOpen(false);
    actions.log(actions.t("setupDoneLog") || "Setup finished.");
    actions.setStatusKey("statusReady");
    try { actions.events.emit("setup:finished", {}); } catch { }
  }, [markDone, actions]);

  const skip = useCallback(() => {
    markDone();
    setOpen(false);
    actions.log("Setup skipped.");
    try { actions.events.emit("setup:finished", {}); } catch { }
  }, [markDone, actions]);

  const setLang = useCallback((lang: string) => actions.setLang(lang as any), [actions]);

  /* First run: open automatically unless already done, skipped by config, or the compact window. */
  useEffect(() => {
    if (isDone()) return;
    if (actions.isWindowMode()) return;
    if (adminCfg().skipWizard) { markDone(); return; }
    const timer = setTimeout(() => setOpen(true), 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); skip(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, skip]);

  /* Reachable from Settings ("Run setup again"). */
  useEffect(() => {
    const g = window as any;
    g.VBPanel = g.VBPanel || {};
    g.VBPanel.setup = {
      open: () => { setOpen(true); setStep(1); setAutoStatusText(""); setAutoFailed(false); },
    };
    return () => { g.VBPanel.setup = null; };
  }, []);

  if (!open) return null;
  const t = actions.t;

  return (
    <div id="setupOverlay" className="setupOverlay">
      <div className="setupCard" role="dialog" aria-modal="true" aria-labelledby="setupTitle">
        <div className="setupStep" data-setup-step="1" hidden={step !== 1}>
          <div className="setupTitle" id="setupTitle">{t("setupWelcomeTitle")}</div>
          <p className="setupText">{t("setupWelcomeText")}</p>
          <div className="setupRow">
            <span className="setupLabel">{t("setupLanguage")}</span>
            <button type="button" className="btn small setupLang" data-setup-lang="en" aria-pressed={state.lang === "en"} onClick={() => setLang("en")}>English</button>
            <button type="button" className="btn small setupLang" data-setup-lang="pt" aria-pressed={state.lang === "pt"} onClick={() => setLang("pt")}>Português</button>
          </div>
          <ol className="setupList">
            <li>{t("setupStepVectorize")}</li>
            <li>{t("setupStepSignIn")}</li>
            <li>{t("setupStepBatch")}</li>
          </ol>
        </div>
        <div className="setupStep" data-setup-step="2" hidden={step !== 2}>
          <div className="setupTitle">{t("setupSignInTitle")}</div>
          <p className="setupText">{t("setupSignInText")}</p>
          <button type="button" className={"btn small" + (autoFailed ? " primary" : "")} id="setupSignInBtn" onClick={startSignIn}>
            {t("signInBtn")}
          </button>
          <div className="hint" id="setupSignInStatus">{autoStatusText}</div>
        </div>
        <div className="setupStep" data-setup-step="3" hidden={step !== 3}>
          <div className="setupTitle">{t("setupDefaultsTitle")}</div>
          <p className="setupText">{t("setupDefaultsText")}</p>
          <div className="field">
            <label htmlFor="setupPngPreset">{t("pngLongSide")}</label>
            <select
              id="setupPngPreset"
              value={pngPreset}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (isFinite(v)) actions.updateSettings({ pngLongSide: v });
              }}
            >
              <option value="1200">{t("pngPresetFast")}</option>
              <option value="1700">{t("pngPresetBalanced")}</option>
              <option value="2400">{t("pngPresetQuality")}</option>
              <option value="0">{t("pngPresetOriginal")}</option>
            </select>
          </div>
          <div className="field">
            <label className="checkbox">
              <input id="setupHideOriginal" type="checkbox" checked={s.hideOriginal} onChange={(e) => actions.updateSettings({ hideOriginal: e.target.checked })} />
              <span>{t("hideOriginal")}</span>
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                id="setupWarmDaemon"
                type="checkbox"
                checked={s.warmDaemon}
                onChange={(e) => {
                  actions.updateSettings({ warmDaemon: e.target.checked });
                  const v = (window as any).VBPanel?.vectorizer;
                  if (e.target.checked) v?.ensureDaemonRunning?.(); else v?.stopWarmDaemon?.();
                }}
              />
              <span>{t("warmDaemon")}</span>
            </label>
          </div>
        </div>
        <div className="setupActions">
          <button type="button" className="btn small" id="setupBackBtn" disabled={step === 1} onClick={() => setStep(Math.max(1, step - 1))}>{t("setupBack")}</button>
          <div className="spacer" />
          <button type="button" className="btn small" id="setupSkipBtn" onClick={skip}>{t("setupSkip")}</button>
          <button type="button" className="btn primary" id="setupNextBtn" onClick={() => (step >= TOTAL ? finish() : setStep(step + 1))}>
            {step === TOTAL ? (t("setupFinish") || "Finish") : t("setupNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
