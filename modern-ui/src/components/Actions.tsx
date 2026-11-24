import { useCore } from "../context/core-context";

export function Actions() {
  const { state, actions } = useCore();
  const v = () => (window as any).VBPanel?.vectorizer;
  const b = () => (window as any).VBPanel?.bridge;
  const disabled = !state._hostOk || state.busy || state.waiting || state.login;
  return (
    <div className="actions">
      <button id="signInBtn" className="btn small" onClick={() => v()?.signIn?.()} disabled={disabled}>{actions.t("signInBtn")}</button>
      <button id="openSvgsBtn" className="btn small" onClick={() => b()?.openSvgsFolder?.()} disabled={!state._hostOk}>{actions.t("openSvgsFolder")}</button>
      <button id="openLogBtn" className="btn small" onClick={() => b()?.openLogFolder?.()} disabled={!state._hostOk}>{actions.t("openLog")}</button>
      <button id="cancelBtn" className="btn small" onClick={() => v()?.cancel?.()} disabled={!(state.waiting || state.login || state.busy)}>{actions.t("cancel")}</button>
    </div>
  );
}
