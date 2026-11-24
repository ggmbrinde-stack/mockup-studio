import { useCore } from "../context/core-context";

export function VectorizeButton() {
  const { state, actions } = useCore();
  return (
    <>
      <button
        id="vectorizeBtn"
        className="btn primary"
        onClick={() => (window as any).VBPanel?.queue?.vectorize?.()}
        disabled={!state._hostOk || state.busy || state.waiting || state.login}
      >
        {actions.t("vectorizeBtn")}
      </button>
      <div className="hint">{actions.t("vectorizeHint")}</div>
    </>
  );
}
