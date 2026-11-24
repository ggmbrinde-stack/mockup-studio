import { useCore } from "../context/core-context";

export function UpdatesPanel() {
  const { state, actions } = useCore();
  const u = state.update;
  const v = () => (window as any).VBPanel?.vectorizer;
  const openReleaseNotes = () => {
    const repo = ((window as any).VBADMIN && (window as any).VBADMIN.updateRepo) || "ggmbrinde-stack/mockup-studio";
    const url = "https://github.com/" + repo + "/releases";
    try {
      const cep = (window as any).cep;
      if (cep && cep.util && cep.util.openURLInDefaultBrowser) { cep.util.openURLInDefaultBrowser(url); return; }
    } catch { }
    try { window.open(url, "_blank"); } catch { }
  };
  return (
    <details className="panel" id="updatesBox" open>
      <summary className="panelTitle">{actions.t("updatesTitle")}</summary>
      <div className="hint" id="updateVersionText">
        {u.current ? actions.t("updatesCurrent").replace("{version}", u.current) : ""}
      </div>
      <div className={u.notes ? "updateNotes show" : "updateNotes"} id="updateNotes">{u.notes}</div>
      <div className="actions">
        <button id="whatsNewBtn" className="btn small" type="button">{actions.t("whatsNewBtn")}</button>
        <button id="releaseNotesBtn" className="btn small" type="button" onClick={openReleaseNotes}>{actions.t("releaseNotes")}</button>
        <button id="checkUpdateBtn" className="btn small" onClick={() => v()?.startUpdate?.("check")}>{actions.t("checkUpdates")}</button>
        {u.available && (
          <button id="applyUpdateBtn" className="btn small" onClick={() => v()?.armOrApplyUpdate?.()}>
            {state.updateArmed ? actions.t("updateConfirm") : actions.t("updateNow")}
          </button>
        )}
        {u.hasBackups && (
          <button id="restoreUpdateBtn" className="btn small" onClick={() => v()?.startUpdate?.("restore")}>{actions.t("restorePrevious")}</button>
        )}
      </div>
      <div className="hint" id="updateStatusText">{u.statusText}</div>
      {u.needsRestart && <div className="updateWarn" id="updateRestartWarn">{actions.t("updateRestartWarn")}</div>}
    </details>
  );
}
