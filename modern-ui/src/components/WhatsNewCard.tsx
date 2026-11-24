import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../context/core-context";

const SEEN_KEY = "ms.whatsNewSeen";

type Mode = "bullets" | "steps";

interface CardView {
  mode: Mode;
  step: number;
  entry: any;
}

export function WhatsNewCard() {
  const { actions } = useCore();
  const [view, setView] = useState<CardView | null>(null);
  const viewRef = useRef<CardView | null>(null);
  const targetRef: { current: HTMLElement | null } = useRef(null);
  viewRef.current = view;

  const version = useCallback((): string => {
    try { return String((actions.extensionVersion && actions.extensionVersion()) || ""); } catch { return ""; }
  }, [actions.extensionVersion]);

  const announcement = useCallback((): any => {
    const all = (window as any).VBWHATSNEW || {};
    const v = version();
    return (v && all[v]) ? all[v] : null;
  }, [version]);

  const seen = useCallback((): string => {
    try { return localStorage.getItem(SEEN_KEY) || ""; } catch { return ""; }
  }, []);

  const markSeen = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, version()); } catch { }
  }, [version]);

  const setupOpen = useCallback((): boolean => {
    const el = document.getElementById("setupOverlay");
    return !!(el && !el.hidden && (el as HTMLElement).style.display !== "none");
  }, []);

  const clearHighlight = useCallback(() => {
    if (targetRef.current) {
      try { targetRef.current.classList.remove("tourTarget"); } catch { }
    }
    targetRef.current = null;
  }, []);

  const highlight = useCallback((el: HTMLElement | null) => {
    clearHighlight();
    if (!el) return;
    targetRef.current = el;
    try { el.classList.add("tourTarget"); } catch { }
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { try { el.scrollIntoView(); } catch { } }
  }, [clearHighlight]);

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

  const maybeShow = useCallback((): boolean => {
    if (setupOpen()) return false;
    const data = announcement();
    if (!data) { markSeen(); return false; }
    if (seen() === version()) return false;
    const v: CardView = { mode: "bullets", step: 0, entry: data };
    setView(v);
    highlight(null);
    return true;
  }, [setupOpen, announcement, markSeen, seen, version, highlight]);

  const start = useCallback((): boolean => {
    const data = announcement();
    if (!data || !data.tour || !data.tour.length) return false;
    const v: CardView = { mode: "steps", step: 0, entry: data };
    setView(v);
    renderStep(v);
    return true;
  }, [announcement, renderStep]);

  useEffect(() => {
    try { if (actions.isWindowMode && actions.isWindowMode()) return; } catch { }
    try { actions.events.on("setup:finished", maybeShow); } catch { }
    maybeShow();
    return () => {
      try { actions.events.off("setup:finished", maybeShow); } catch { }
    };
  }, [actions, maybeShow]);

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
    <div id="tourCard" className="tourCard" role="dialog" aria-live="polite">
      <div className="tourHead">
        <span className="tourTitle" id="tourTitle">{title}</span>
        <span className="tourStep" id="tourStep">{stepText}</span>
      </div>
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
  );
}
