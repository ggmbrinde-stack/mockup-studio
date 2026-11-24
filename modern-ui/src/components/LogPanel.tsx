import { useEffect, useRef } from "react";
import { useCore } from "../context/core-context";

export function LogPanel() {
  const { state, actions } = useCore();
  const boxRef = useRef<HTMLDivElement>(null);
  const count = state._logLines.length;

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <details className="panel" id="logBox" open>
      <summary className="panelTitle">{actions.t("log")}</summary>
      <div id="panelLog" className="log" ref={boxRef}>
        {state._logLines.map((line, i) => <div key={i} className="log-line">{line}</div>)}
      </div>
    </details>
  );
}
