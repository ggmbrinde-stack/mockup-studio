import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../context/core-context";

const SEEN_KEY = "ms.whatsNewSeen";

type Mode = "bullets" | "steps";

interface CardView {
  mode: Mode;
  step: number;
  entry: any;
}

function prefersReducedMotion(): boolean {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { return false; }
}

export function WhatsNewCard() {
  const { actions } = useCore();
  const [view, setView] = useState<CardView | null>(null);
  const viewRef = useRef<CardView | null>(null);
  const targetRef: { current: HTMLElement | null } = useRef(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  viewRef.current = view;

  const version = useCallback((): string => {
    try { return String((actions.extensionVersion && actions.extensionVersion()) || ""); } catch { return ""; }
  }, [actions.extensionVersion]);

  const announcement = useCallback((): any => {
    const all = (window as any).VBWHATSNEW || {};
    const v = version();
    return (v && all[v]) ? all[v] : null;
  }, [version]);

  const markSeen = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, version()); } catch { }
  }, [version]);

  const clearHighlight = useCallback(() => {
    if (targetRef.current) {
      try { targetRef.current.classList.remove("tourTarget"); } catch { }
    }
    targetRef.current = null;
  }, []);

  /* The card is fixed-positioned; keep it out of the target's way by placing it just
     below the target, flipping above when there is not enough room underneath. */
  const placeCard = useCallback((el: HTMLElement | null) => {
    const card = cardRef.current;
    if (!card) return;
    if (!el) { card.style.top = "auto"; card.style.bottom = "8px"; return; }
    const r = el.getBoundingClientRect();
    const gap = 10;
    const cardH = card.offsetHeight || 140;
    let top = r.bottom + gap;
    if (top + cardH > window.innerHeight - 8) top = Math.max(8, r.top - gap - cardH);
    card.style.top = top + "px";
    card.style.bottom = "auto";
  }, []);

  const highlight = useCallback((el: HTMLElement | null) => {
    clearHighlight();
    if (!el) { placeCard(null); return; }
    targetRef.current = el;
    try { el.classList.add("tourTarget"); } catch { }
    try { el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" }); }
    catch { try { el.scrollIntoView(); } catch { } }
    placeCard(el);
  }, [clearHighlight, placeCard]);

  const reveal = useCallback((el: HTMLElement) => {
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) (node as HTMLDetailsElement).open = true;
      node = node.parentElement as HTMLElement | null;
    }
  }, []);

  const hide = useCallback(() => {
    clearHighlight();
    setView(null);
  }, [clearHighlight]);

  const finish = useCallback(() => {
    markSeen();
    hide();
  }, [markSeen, hide]);

  const renderStep = useCallback((v: CardView) => {
    const list = (v.entry && v.entry.tour) || [];
    const current = list[v.step];
    if (!current) { finish(); return; }
    const el = document.getElementById(current.target) as HTMLElement | null;
    if (el) reveal(el);
    highlight(el);
  }, [finish, reveal, highlight]);

  const next = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    if (v.mode === "bullets") {
      if (v.entry && v.entry.tour && v.entry.tour.length) { const nv = { ...v, mode: "steps" as Mode, step: 0 }; setView(nv); renderStep(nv); return; }
      return finish();
    }
    const list = (v.entry && v.entry.tour) || [];
    if (v.step >= list.length - 1) return finish();
    const nv = { ...v, step: v.step + 1 };
    setView(nv);
    renderStep(nv);
  }, [finish, renderStep]);

  const back = useCallback(() => {
    const v = viewRef.current;
    if (!v || v.mode !== "steps") return;
    if (v.step === 0) { const nv = { ...v, mode: "bullets" as Mode, step: 0 }; setView(nv); highlight(null); return; }
    const nv = { ...v, step: v.step - 1 };
    setView(nv);
    renderStep(nv);
  }, [renderStep, highlight]);

  /* Opt-in entry point: the What's new button in the Updates panel starts the tour.
     Finishing setup no longer opens it (see SetupWizard). */
  const start = useCallback((): boolean => {
    const data = announcement();
    if (!data || !data.tour || !data.tour.length) return false;
    const v: CardView = { mode: "steps", step: 0, entry: data };
    setView(v);
    renderStep(v);
    return true;
  }, [announcement, renderStep]);

  /* The button lives in UpdatesPanel; a listener is enough, no DOM writes. */
  useEffect(() => {
    const btn = document.getElementById("whatsNewBtn") as HTMLButtonElement | null;
    if (!btn) return;
    const data = announcement();
    if (data && data.tour && data.tour.length) {
      const onClick = () => { start(); };
      btn.addEventListener("click", onClick);
      return () => btn.removeEventListener("click", onClick);
    }
    btn.style.display = "none";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement, start]);

  useEffect(() => {
    if (!view) clearHighlight();
  }, [view, clearHighlight]);

  if (!view) return null;
  const bullets = (view.entry && view.entry.bullets) || [];
  const tour = (view.entry && view.entry.tour) || [];
  const t = actions.t;

  let title = "";
  let stepText = "";
  let body: any = null;
  let skipText = "";
  let nextText = "";
  let showBack = false;

  if (view.mode === "bullets") {
    title = t("whatsNewTitle") + " " + version();
    body = <ul>{bullets.map((b: string, i: number) => <li key={i}>{t(b)}</li>)}</ul>;
    skipText = t("whatsNewLater");
    nextText = tour.length ? t("whatsNewShow") : t("whatsNewDone");
  } else {
    const current = tour[view.step];
    title = t(current.titleKey) || t("whatsNewTitle");
    stepText = (view.step + 1) + " / " + tour.length;
    body = t(current.bodyKey);
    skipText = t("whatsNewSkip");
    nextText = view.step >= tour.length - 1 ? t("whatsNewDone") : t("setupNext");
    showBack = view.step > 0;
  }

  return (
    <>
      {view.mode === "steps" && <div className="tourScrim" aria-hidden="true" />}
      <div id="tourCard" className="tourCard" role="dialog" aria-live="polite" ref={cardRef}>
        <div className="tourHead">
          <span className="tourTitle" id="tourTitle">{title}</span>
          <span className="tourStep" id="tourStep">{stepText}</span>
        </div>
        {view.mode === "steps" && (
          <div className="tourDots" aria-hidden="true">
            {tour.map((_: any, i: number) => (
              <span key={i} className={"tourDot" + (i === view.step ? " isCurrent" : i < view.step ? " isDone" : "")} />
            ))}
          </div>
        )}
        <div className="tourBody" id="tourBody">{body}</div>
        <div className="setupActions">
          <button type="button" className="btn small" id="tourBack" style={{ display: showBack ? "" : "none" }} onClick={back}>
            {t("setupBack") || "Back"}
          </button>
          <div className="spacer" />
          <button type="button" className="btn small" id="tourSkip" onClick={finish}>{skipText}</button>
          <button type="button" className="btn primary" id="tourNext" onClick={next}>{nextText}</button>
        </div>
      </div>
    </>
  );
}