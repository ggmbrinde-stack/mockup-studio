import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../context/core-context";

const KEY = "vb_setup_done";
const TOTAL = 2;
type SignState = "idle" | "waiting" | "success" | "failed";

export function SetupWizard() {
  const { state, actions } = useCore();
  const [step, setStep] = useState(1); // 1 = welcome, 2 = sign in, 3 = finish
  const [open, setOpen] = useState(false);
  const [signState, setSignState] = useState<SignState>("idle");
  const [signText, setSignText] = useState("");

  const cardRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const signInitRef = useRef(false);
  const autoRef = useRef({ tried: false, busy: false, timer: null as any });

  const isDone = useCallback((): boolean => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return true; }
  }, []);

  const markDone = useCallback(() => {
    try { localStorage.setItem(KEY, "1"); } catch { }
  }, []);

  const adminCfg = useCallback((): any => (window as any).VBADMIN || {}, []);

  const clearTimer = useCallback(() => {
    if (autoRef.current.timer) { try { clearTimeout(autoRef.current.timer); } catch { } autoRef.current.timer = null; }
  }, []);

  const resetSign = useCallback(() => {
    clearTimer();
    autoRef.current.busy = false;
    setSignState("idle");
    setSignText("");
  }, [clearTimer]);

  const signSuccess = useCallback(() => {
    autoRef.current.busy = false;
    setSignText(actions.t("setupSignInSuccess") || "Signed in.");
    setSignState("success");
  }, [actions]);

  const signFail = useCallback((reason?: string) => {
    autoRef.current.busy = false;
    let text = actions.t("setupSignInFailed") || "Sign-in did not complete. Use Retry to try again.";
    if (reason) text = text + " (" + reason + ")";
    setSignText(text);
    setSignState("failed");
  }, [actions]);

  /* One poll loop for both paths: the agent status file reports loginWindow/loginClosed
     for a manual sign-in and the autologin run for the studio account. */
  const pollSignIn = useCallback((attempt: number) => {
    if (attempt > 160) { signFail("timeout"); return; }
    autoRef.current.timer = setTimeout(() => {
      const bridge = (window as any).VBPanel?.bridge;
      if (!bridge || !bridge.hostOk) { signFail("no host"); return; }
      bridge.evalJsx("VB.agentStatus('')", (txt: any) => {
        let st: any = null;
        try { st = JSON.parse(txt); } catch { st = null; }
        const stateStr = (st && st.state) ? String(st.state) : "";
        if (stateStr === "done" || stateStr === "loginClosed") { signSuccess(); return; }
        if (stateStr === "loginRequired" || stateStr === "error") {
          signFail(stateStr === "error" && st && st.message ? String(st.message) : "");
          return;
        }
        pollSignIn(attempt + 1);
      });
    }, 700);
  }, [signFail, signSuccess]);

  const beginAutoSignIn = useCallback(() => {
    if (autoRef.current.tried || autoRef.current.busy) return;
    if (!adminCfg().autoSignIn) return;
    const bridge = (window as any).VBPanel?.bridge;
    if (!bridge || !bridge.hostOk) return;
    autoRef.current.tried = true;
    autoRef.current.busy = true;
    setSignText(actions.t("setupAutoSignIn") || "Signing in with the studio account…");
    setSignState("waiting");
    bridge.evalJsx("VB.agentStart('autologin','')", (started: any) => {
      if (String(started || "").indexOf("started") !== 0) { signFail(String(started || "")); return; }
      pollSignIn(0);
    });
  }, [adminCfg, actions, signFail, pollSignIn]);

  const beginManualSignIn = useCallback(() => {
    const bridge = (window as any).VBPanel?.bridge;
    if (!bridge || !bridge.hostOk) { signFail("no host"); return; }
    autoRef.current.busy = true;
    setSignText(actions.t("setupSignInStatus") || "Opening the sign-in window…");
    setSignState("waiting");
    (window as any).VBPanel.vectorizer.signIn();
    pollSignIn(0);
  }, [actions, signFail, pollSignIn]);

  const cancelSignIn = useCallback(() => {
    clearTimer();
    autoRef.current.busy = false;
    try { (window as any).VBPanel?.vectorizer?.cancel?.(); } catch { }
    setSignState("idle");
    setSignText("");
  }, [clearTimer]);

  const retrySignIn = useCallback(() => {
    clearTimer();
    autoRef.current.tried = false;
    autoRef.current.busy = false;
    setSignState("idle");
    setSignText("");
    if (adminCfg().autoSignIn) beginAutoSignIn(); else beginManualSignIn();
  }, [clearTimer, adminCfg, beginAutoSignIn, beginManualSignIn]);

  /* Start the automatic sign-in once, the first time step 2 is shown. */
  useEffect(() => {
    if (!open || step !== 2 || signInitRef.current) return;
    signInitRef.current = true;
    if (adminCfg().autoSignIn) {
      const id = setTimeout(() => beginAutoSignIn(), 250);
      return () => clearTimeout(id);
    }
  }, [open, step, adminCfg, beginAutoSignIn]);

  const finish = useCallback(() => {
    markDone();
    clearTimer();
    setOpen(false);
    actions.log(actions.t("setupDoneLog") || "Setup finished.");
    actions.setStatusKey("statusReady");
  }, [markDone, clearTimer, actions]);

  /* Escape (and any other close without Finish) must NOT set vb_setup_done, so the
     intro returns on the next open. */
  const closeNoDone = useCallback(() => {
    clearTimer();
    setStep(1);
    setOpen(false);
  }, [clearTimer]);

  const vectorizeSomething = useCallback(() => {
    finish();
    setTimeout(() => {
      const btn = document.getElementById("vectorizeBtn") as HTMLButtonElement | null;
      if (btn) btn.focus();
    }, 0);
  }, [finish]);



  /* First run: open automatically unless already done, skipped by config, or compact window. */
  useEffect(() => {
    if (isDone()) return;
    if (actions.isWindowMode()) return;
    if (adminCfg().skipWizard) { markDone(); return; }
    const timer = setTimeout(() => { signInitRef.current = false; resetSign(); setOpen(true); }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Focus management: move into the dialog on open, trap Tab, return focus to the
     opener on close. Escape closes without marking done. */
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement;
    const focusables = (): HTMLElement[] => {
      const card = cardRef.current;
      if (!card) return [];
      return Array.from(card.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); closeNoDone(); return; }
      if (ev.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { ev.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      try { openerRef.current?.focus(); } catch { }
    };
  }, [open, closeNoDone]);

  /* Move focus to the visible step whenever the step changes (announces the new title). */
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>("#setupOverlay .setupStep:not([hidden])");
      if (el) el.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [step, open]);

  /* Clear any pending poll on unmount. */
  useEffect(() => () => clearTimer(), [clearTimer]);

  /* Reachable from Settings ("Run setup again"). */
  useEffect(() => {
    const g = window as any;
    g.VBPanel = g.VBPanel || {};
    g.VBPanel.setup = {
      open: () => {
        signInitRef.current = false;
        resetSign();
        setStep(1);
        setOpen(true);
      },
    };
    return () => { g.VBPanel.setup = null; };
  }, [resetSign]);

  if (!open) return null;
  const t = actions.t;

  const labelId = step === 1 ? "setupTitle1" : step === 2 ? "setupTitle2" : "setupTitleFinish";
  const stepLabel = (n: number) => (t("setupStepOf") || "Step {step} of {total}")
    .replace("{step}", String(n)).replace("{total}", String(TOTAL));
  const dots = (active: number) => (
    <div className="setupDots" aria-hidden="true">
      {[1, 2].map((n) => (
        <span key={n} className={"setupDot" + (n === active ? " isCurrent" : n < active ? " isDone" : "")} />
      ))}
    </div>
  );

  return (
    <div id="setupOverlay" className="setupOverlay">
      <div className="setupCard" role="dialog" aria-modal="true" aria-labelledby={labelId} ref={cardRef}>
        <div className="setupStep" data-setup-step="1" hidden={step !== 1} tabIndex={-1}>
          <div className="setupTitle" id="setupTitle1">{t("setupWelcomeTitle")}</div>
          <div className="setupProgress">
            <span className="setupStepText">{stepLabel(1)}</span>
            {dots(1)}
          </div>
          <div className="setupRow">
            <button type="button" className="btn small setupLang" onClick={() => actions.toggleLanguage()}>
              {state.lang === "en" ? "English" : "Português"}
            </button>
          </div>
        </div>

        <div className="setupStep" data-setup-step="2" hidden={step !== 2} tabIndex={-1}>
          <div className="setupTitle" id="setupTitle2">{t("setupSignInTitle")}</div>
          <div className="setupProgress">
            <span className="setupStepText">{stepLabel(2)}</span>
            {dots(2)}
          </div>
          <p className="setupText">{t("setupSignInText")}</p>
          <div className="setupSignIn">
            {signState === "idle" && (
              <button type="button" className="btn small primary" id="setupSignInBtn" onClick={beginManualSignIn}>{t("signInBtn")}</button>
            )}
            {signState === "waiting" && (
              <button type="button" className="btn small" id="setupCancelSignInBtn" onClick={cancelSignIn}>{t("cancel")}</button>
            )}
            {signState === "failed" && (
              <button type="button" className="btn small primary" id="setupRetrySignInBtn" onClick={retrySignIn}>{t("setupRetry")}</button>
            )}
          </div>
          <div className="hint setupSignStatus" id="setupSignInStatus" role="status" aria-live="polite">{signText}</div>
          <div className="hint">{t("setupOnlyOnce")}</div>
        </div>

        <div className="setupStep" data-setup-step="3" hidden={step !== 3} tabIndex={-1}>
          <div className="setupTitle" id="setupTitleFinish">{t("setupReadyTitle")}</div>
          <p className="setupText">{t("setupReadyText")}</p>
        </div>

        <div className="setupActions">
          {step < 3 && (
            <button type="button" className="btn small" id="setupBackBtn" disabled={step === 1} onClick={() => setStep(Math.max(1, step - 1))}>{t("setupBack")}</button>
          )}
          <div className="spacer" />
          {step === 1 && (
            <button type="button" className="btn primary" id="setupNextBtn" onClick={() => setStep(2)}>{t("setupGetStarted")}</button>
          )}
          {step === 2 && (
            <button type="button" className="btn primary" id="setupNextBtn" onClick={() => setStep(3)}>{t("setupContinue")}</button>
          )}
          {step === 3 && (
            <>
              <button type="button" className="btn primary" id="setupVectorizeBtn" onClick={vectorizeSomething}>{t("setupVectorizeSomething")}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}