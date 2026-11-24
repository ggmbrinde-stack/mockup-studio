import { useCore } from "../context/core-context";

export function UpdateBanner() {
  const { state, actions } = useCore();
  const u = state.update;
  if (state._updateDismissed) return null;
  let text = "";
  let showButton = false;
  if (u.downloading) { text = actions.t("updateDownloading"); showButton = true; }
  else if (u.staged) text = actions.t("updateDone").replace("{version}", u.stagedVersion || u.remoteVersion || "");
  else if (u.available) {
    text = actions.t("updateBannerText").replace("{version}", u.remoteVersion || "");
    showButton = true;
  } else return null;

  return (
    <div id="updateBanner" className="update-banner">
      <span id="updateBannerText" className="update-banner-text">{text}</span>
      {showButton && (
        <button
          id="updateBannerBtn"
          className="btn primary"
          type="button"
          disabled={u.downloading}
          onClick={() => (window as any).VBPanel?.vectorizer?.armOrApplyUpdate?.()}
        >
          {u.available && state.updateArmed ? actions.t("updateConfirm") : actions.t("updateBannerBtn")}
        </button>
      )}
      <button
        id="updateBannerClose"
        className="btn small"
        type="button"
        aria-label={actions.t("updateBannerDismiss")}
        onClick={() => {
          try { sessionStorage.setItem("vb_update_dismissed", "1"); } catch { }
          actions.setState({ _updateDismissed: true });
        }}
      >
        &#x2715;
      </button>
    </div>
  );
}
