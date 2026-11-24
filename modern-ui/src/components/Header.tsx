import { useCore } from "../context/core-context";

export function Header() {
  const { state, actions } = useCore();
  /* Mini state header: closing the floating window is closing its own window. A CEP panel
     does not own a browser window, so window.close() is usually a no-op; closeExtension()
     is the real way out of the modeless window. */
  const closeWindow = () => {
    try { window.close(); } catch { }
    setTimeout(() => {
      try {
        const cs = (window as any).VBPanel?.bridge?.getCS?.();
        if (cs && typeof cs.closeExtension === "function") { cs.closeExtension(); return; }
        const raw = (window as any).__adobe_cep__;
        if (raw && typeof raw.closeExtension === "function") raw.closeExtension();
      } catch { }
    }, 60);
  };
  return (
    <header className="toolbar">
      <div className="title" data-i18n="appTitle">{actions.t("appTitle")}</div>
      <span className="badge badge-modern" data-i18n="badgeModern">{actions.t("badgeModern")}</span>
      <div className="spacer" />
      <button id="langBtn" className="btn small" onClick={actions.toggleLanguage} data-i18n="langBtn">
        {state.lang.toUpperCase()}
      </button>
      <button id="miniClose" className="miniClose" type="button" aria-label="Close" title="Close" onClick={closeWindow}>
        ✕
      </button>
    </header>
  );
}
