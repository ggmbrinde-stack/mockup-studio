import { useCore } from "../context/core-context";

function fmtTime(ms: number): string {
  if (!ms) return "";
  try { return new Date(ms).toLocaleString(); } catch { return ""; }
}

function fmtSize(b: number): string {
  const n = parseInt(String(b), 10) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

export function HistoryPanel() {
  const { state, actions } = useCore();
  const files = state._svgFiles;
  const v = () => (window as any).VBPanel?.vectorizer;
  return (
    <details className="panel" id="historyBox" open>
      <summary className="panelTitleRow">
        <span className="panelTitle">{actions.t("history")}</span>
        <button id="refreshSvgsBtn" className="btn small" onClick={() => v()?.refreshSvgHistory?.()}>{actions.t("refreshSvgs")}</button>
      </summary>
      <div className="hint">{actions.t("svgHistoryHint")}</div>
      <div id="svgHistoryList" className="list">
        {(!files || files.length === 0) && <div className="hint">{actions.t("svgHistoryEmpty")}</div>}
        {(files || []).slice(0, 20).map((f: any, i: number) => (
          <div key={(f.path || f.name || "") + i} className="svg-history-item">
            <div className="svg-history-meta">
              <div className="svg-history-name">{f.name || ""}</div>
              <div className="svg-history-sub">{[fmtTime(f.modified), fmtSize(f.size)].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="svg-history-actions">
              <button className="btn small" title={f.path || ""} onClick={() => v()?.revealFile?.(f.path || "")}>{actions.t("openSvgFolder")}</button>
              <button className="btn small" onClick={() => v()?.placeHistoryFile?.(f)}>{actions.t("placeSvg")}</button>
            </div>
          </div>
        ))}
      </div>
      <div className="panelSubTitle">{actions.t("recentActivity")}</div>
      <div id="historyList" className="list">
        {state.history.slice(0, 8).map((h, i) => (
          <div key={i} className={"history-item " + (h.ok ? "ok" : "bad")}>
            {(h.ok ? "\u2713 " : "\u2715 ") + [h.time, h.file, actions.t(h.action), h.msg].filter(Boolean).join(" — ")}
          </div>
        ))}
      </div>
    </details>
  );
}
