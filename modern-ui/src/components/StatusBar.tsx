import { useCore } from "../context/core-context";

export function StatusBar() {
  const { state, actions } = useCore();
  const full = state._statusText || actions.t(state._statusKey || "statusReady");
  const text = actions.isWindowMode() ? actions.shortenForMini(full) : full;
  const info = state.selection;
  const hasSelection = !!(info && info.open && parseInt(info.sel, 10) > 0);
  return (
    <>
      <div className={"status" + (state._statusTone ? " tone-" + state._statusTone : "")} id="statusBar" role="status" aria-live="polite">
        {text}
      </div>
      <div id="statusDetail" className="statusDetail">{state._detailText}</div>
      <div id="selectionText" className={"selection" + (hasSelection ? " on" : "")}>{actions.selectionText(info)}</div>
    </>
  );
}
