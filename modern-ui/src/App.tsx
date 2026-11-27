import { useEffect, useCallback } from "react";
import { Toaster } from "@/components/ui/toaster";
import { CoreProvider, useCore } from "@/context/core-context";
import { useHost } from "@/hooks/use-host";
import { useBatch } from "@/hooks/use-batch";
import { useVectorizer } from "@/hooks/use-vectorizer";
import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { VectorizeButton } from "@/components/VectorizeButton";
import { Actions } from "@/components/Actions";
import { SettingsAccordion } from "@/components/SettingsAccordion";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LogPanel } from "@/components/LogPanel";
import { UpdatesPanel } from "@/components/UpdatesPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
// Gemini Image Editor and Google Flow are disabled.
// Components preserved in source for future re-enablement:
//   modern-ui/src/components/AiImageSection.tsx
//   modern-ui/src/components/FlowSection.tsx
import { WhatsNewCard } from "@/components/WhatsNewCard";
import { SetupWizard } from "@/components/SetupWizard";

function PanelIntegrations() {
  const { actions } = useCore();
  const { evalJsx } = useHost(actions.t);

  const triggerVectorize = useCallback(() => {
    try { (window as any).VBPanel?.queue?.vectorize?.(); } catch { }
  }, []);

  useEffect(() => {
    const setup = () => {
      const VB = (window as any).VBPanel;
      if (!VB || !VB.bridge || !VB.queue || !VB.core) { setTimeout(setup, 300); return; }
      const cs = (VB.bridge.getCS && VB.bridge.getCS()) || null;
      if (!cs) { setTimeout(setup, 300); return; }
      try {
        if ((cs as any)._vbIntegrationsReady) return;
        (cs as any)._vbIntegrationsReady = true;
      } catch { }

      const defaultShortcut = { ctrl: true, shift: true, alt: false, key: 186, code: "Semicolon", label: "Ctrl+Shift+Ç" };
      const getShortcut = () => {
        try {
          const sc = VB.core.state && VB.core.state.settings && VB.core.state.settings.vectorizeShortcut;
          if (sc && typeof sc === "object") return sc;
        } catch { }
        return defaultShortcut;
      };

      const applyShortcutRegistration = (csAny: any) => {
        try {
          const sc = getShortcut();
          const obj: any = { keyCode: parseInt(sc.key, 10) || 186, ctrlKey: !!sc.ctrl, shiftKey: !!sc.shift };
          if (sc.alt) obj.altKey = true;
          const keys = JSON.stringify([obj]);
          if (csAny && csAny.registerKeyEventsInterest) csAny.registerKeyEventsInterest(keys);
        } catch { }
      };

      const matchesShortcut = (ev: KeyboardEvent): boolean => {
        const sc = getShortcut();
        const key = ev.keyCode || ev.which;
        const code = ev.code || "";
        const wantKey = parseInt(sc.key, 10) || 0;
        let keyMatch = (key === wantKey) || (sc.code && code && code === sc.code);
        if (!keyMatch && sc.label) {
          const parts = String(sc.label).split("+");
          const last = parts.length ? parts[parts.length - 1] : "";
          if (last && ev.key && (ev.key === last || ev.key.toUpperCase() === last.toUpperCase())) keyMatch = true;
        }
        return !!keyMatch && !!ev.ctrlKey === !!sc.ctrl && !!ev.shiftKey === !!sc.shift && !!ev.altKey === !!sc.alt && !ev.metaKey;
      };

      try {
        const menuXml = '<Menu><MenuItem Id="vbVectorize" Label="Vectorize selection" Enabled="true"/></Menu>';
        if (cs.setPanelFlyoutMenu) cs.setPanelFlyoutMenu(menuXml);
        if (cs.addEventListener) {
          cs.addEventListener("com.adobe.csxs.events.flyoutMenuClicked", (event: any) => {
            try {
              const id = event && event.data && (event.data.menuId || event.data.menuName);
              if (id === "vbVectorize") triggerVectorize();
            } catch { }
          });
        }
      } catch { }

      applyShortcutRegistration(cs);
      try {
        window.addEventListener("keydown", (ev) => {
          try {
            if ((window as any)._vbCapturingShortcut) return;
            const target = ev.target as HTMLElement | null;
            const tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            if (target && target.isContentEditable) return;
            if (matchesShortcut(ev)) {
              if (ev.preventDefault) ev.preventDefault();
              triggerVectorize();
            }
          } catch { }
        }, false);
      } catch { }

      try {
        if (cs.addEventListener) {
          cs.addEventListener("vb.selectionChanged", (event: any) => {
            let info: any = null;
            try { info = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { info = null; }
            try { VB.core.renderSelection(info); } catch { }
          });
        }
        evalJsx("VB.watch.start()", () => { });
        window.addEventListener("beforeunload", () => {
          try { evalJsx("VB.watch.stop()"); } catch { }
        }, false);
      } catch { }

      (window as any).VBPanel.integrations = (window as any).VBPanel.integrations || {};
      (window as any).VBPanel.integrations.refreshShortcut = () => { applyShortcutRegistration((VB.bridge.getCS && VB.bridge.getCS()) || cs); };
      try { VB.core.events.on("shortcut:changed", (window as any).VBPanel.integrations.refreshShortcut); } catch { }

      function syncSettingsFromHostWhenReady(attempt: number) {
        if (attempt > 40) return;
        const VB2 = (window as any).VBPanel;
        if (VB2 && VB2.core && VB2.bridge && VB2.bridge.hostOk) {
          try { VB2.core.syncSettingsFromHost(); } catch { }
          return;
        }
        setTimeout(() => syncSettingsFromHostWhenReady(attempt + 1), 150);
      }
      syncSettingsFromHostWhenReady(0);
    };
    setup();
  }, [evalJsx, triggerVectorize]);

  return null;
}

function Panel() {
  useBatch();
  useVectorizer();
  const { state, actions } = useCore();
  const mode = actions.layoutMode();

  return (
    <div className={"app mode-" + mode} data-mode={mode}>
      <UpdateBanner />
      <Header />
      <StatusBar />
      <VectorizeButton />
      <Actions />
      <div id="lastExport" className="hint"></div>
      <SettingsAccordion />
      <HistoryPanel />
      <LogPanel />
      <UpdatesPanel />
      <footer className="appFooter">
        <div className="version" id="versionText">{actions.t("appTitle") + (state._appVersion ? " v" + state._appVersion : "") + (typeof __VB_BUILD_ID__ !== "undefined" ? " build " + __VB_BUILD_ID__ : "")}</div>
        <div className="attribution" id="attribution">Made by Gonçalo Mendonça : )</div>
      </footer>
      <div className="miniCaption" id="miniCaption">Compact Window Mode</div>
      {state._errorText && (
        <div id="jsError" className="error-box" role="alert">
          <span className="errorText">{state._errorText}</span>
          <button
            id="jsErrorClose"
            className="btn small errorDismiss"
            type="button"
            aria-label={actions.t("updateBannerDismiss")}
            onClick={() => actions.setState({ _errorText: "" })}
          >
            &#x2715;
          </button>
        </div>
      )}
      <WhatsNewCard />
      <SetupWizard />
      <PanelIntegrations />
      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <CoreProvider>
      <Panel />
    </CoreProvider>
  );
}
