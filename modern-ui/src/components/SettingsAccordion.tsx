import { useEffect, useRef, useState } from "react";
import { useCore, type VectorizeShortcut } from "../context/core-context";

const DEFAULT_SHORTCUT: VectorizeShortcut = { ctrl: true, shift: true, alt: false, key: 186, code: "Semicolon", label: "Ctrl+Shift+Ç" };

export function SettingsAccordion() {
  const { state, actions } = useCore();
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

  const s = state.settings;
  const vx = s.vx;
  const pngRaw = parseInt(String(s.pngLongSide), 10);
  const pngValue = isFinite(pngRaw) ? pngRaw : 1700;
  const pngIsPreset = pngValue === 1200 || pngValue === 1700 || pngValue === 2400 || pngValue === 0;
  /* "Custom" is a mode of its own, not just something derived from the saved number:
     picking it must reveal the size field even while the number still equals a preset. */
  const [customMode, setCustomMode] = useState(false);
  /* null = mirror the saved value; a string = what the user is typing right now. */
  const [pngDraft, setPngDraft] = useState<string | null>(null);
  const presetValue = (customMode || !pngIsPreset) ? "custom" : String(pngValue);

  /* The size is edited as text and committed on blur/Enter, so typing "1200" is not
     rejected digit by digit (the native panel committed on change for the same reason). */
  const commitPngSize = () => {
    const raw = parseInt(pngDraft === null ? String(pngValue) : pngDraft, 10);
    setPngDraft(null);
    if (!isFinite(raw)) return;
    const val = Math.max(100, Math.min(5000, raw));
    if (val === pngValue) return;
    setCustomMode(false);
    actions.updateSettings({ pngLongSide: val });
  };

  const presetKey = "vxPreset" + (vx.preset === "editing" ? "Editing" : vx.preset === "cutting" ? "Cutting" : vx.preset === "custom" ? "Custom" : "General");
  const sideText = pngValue === 0 ? (actions.t("settingsPillOriginal") || "Original") : pngValue + "px";
  const pillText = actions.t("settingsPillPng") + ": " + sideText + " • " + actions.t("settingsPillPreset") + ": " + actions.t(presetKey);

  /* Shortcut capture: a one-shot capture-phase listener, registered only while capturing. */
  useEffect(() => {
    if (!capturing) return;
    const handler = (ev: KeyboardEvent) => {
      const k = ev.keyCode || ev.which;
      if (k === 16 || k === 17 || k === 18 || k === 91 || k === 92) return;
      ev.preventDefault();
      ev.stopPropagation();
      setCapturing(false);
      if (ev.key === "Escape") return;
      const sc: VectorizeShortcut = {
        ctrl: !!ev.ctrlKey, shift: !!ev.shiftKey, alt: !!ev.altKey,
        key: k, code: ev.code || "",
        label: actions.shortcutLabel({ ctrl: !!ev.ctrlKey, shift: !!ev.shiftKey, alt: !!ev.altKey, key: k, code: ev.code || "", label: "" }),
      };
      actions.updateSettings({ vectorizeShortcut: sc });
      try { actions.events.emit("shortcut:changed", sc); } catch { }
      try { (window as any).VBPanel?.integrations?.refreshShortcut?.(); } catch { }
      actions.log("Vectorize shortcut set to " + sc.label);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [capturing, actions]);

  const startCapture = () => {
    if (capturing) { setCapturing(false); return; }
    capturingRef.current = true;
    setCapturing(true);
  };

  const resetShortcut = () => {
    if (capturing) setCapturing(false);
    actions.updateSettings({ vectorizeShortcut: { ...DEFAULT_SHORTCUT } });
    try { actions.events.emit("shortcut:changed", DEFAULT_SHORTCUT); } catch { }
    try { (window as any).VBPanel?.integrations?.refreshShortcut?.(); } catch { }
    actions.log("Shortcut reset to Ctrl+Shift+Ç");
  };

  const daemonToggle = (on: boolean) => {
    actions.updateSettings({ warmDaemon: on });
    const v = (window as any).VBPanel?.vectorizer;
    if (on) v?.ensureDaemonRunning?.(); else v?.stopWarmDaemon?.();
  };

  return (
    <details className="settings" id="settingsBox">
      <summary className="settingsSummary">
        <span>{actions.t("settings")}</span>
        <span id="settingsPill" className="settingsPill">{pillText}</span>
      </summary>
      <div className="settingsGrid">
        <div className="field">
          <label htmlFor="settingsPngPreset">{actions.t("pngLongSide")}</label>
          <select
            id="settingsPngPreset"
            value={presetValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "custom") { setCustomMode(true); setPngDraft(null); return; }
              setCustomMode(false);
              setPngDraft(null);
              actions.updateSettings({ pngLongSide: parseInt(val, 10) || 1700 });
            }}
          >
            <option value="1200">{actions.t("pngPresetFast")}</option>
            <option value="1700">{actions.t("pngPresetBalanced")}</option>
            <option value="2400">{actions.t("pngPresetQuality")}</option>
            <option value="0">{actions.t("pngPresetOriginal")}</option>
            <option value="custom">{actions.t("pngPresetCustom")}</option>
          </select>
          <input
            id="settingsPngSize"
            type="number"
            min={100}
            max={5000}
            value={pngDraft === null ? String(pngValue) : pngDraft}
            style={{ display: presetValue === "custom" ? "" : "none" }}
            onChange={(e) => setPngDraft(e.target.value)}
            onBlur={commitPngSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitPngSize(); }
            }}
          />
        </div>
        <div className="field full">
          <label className="checkbox">
            <input id="settingsHideOriginal" type="checkbox" checked={s.hideOriginal} onChange={(e) => actions.updateSettings({ hideOriginal: e.target.checked })} />
            <span>{actions.t("hideOriginal")}</span>
          </label>
        </div>
        <div className="field full">
          <label className="checkbox">
            <input id="settingsWarmDaemon" type="checkbox" checked={s.warmDaemon} onChange={(e) => daemonToggle(e.target.checked)} />
            <span>{actions.t("warmDaemon")}</span>
          </label>
          <WarmDaemonStatus />
        </div>
        <div className="field full">
          <label htmlFor="settingsBatchWorkers">{actions.t("batchWorkers")}</label>
          <select
            id="settingsBatchWorkers"
            value={String(Math.max(1, Math.min(4, s.batchWorkers || 1)))}
            onChange={(e) => {
              const bw = parseInt(e.target.value, 10);
              if (!isFinite(bw) || bw < 1 || bw > 4) return;
              actions.updateSettings({ batchWorkers: bw });
              actions.log("Batch workers: " + bw);
            }}
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
          <div className="hint">{actions.t("batchWorkersHint")}</div>
        </div>
        <div className="field full">
          <div className="vxTitle">{actions.t("vxTitle")}</div>
          <div className="hint">{actions.t("vxHint")}</div>
        </div>
        <div className="field">
          <label htmlFor="vxPreset">{actions.t("vxPreset")}</label>
          <select id="vxPreset" value={vx.preset} onChange={(e) => actions.updateVx({ preset: e.target.value })}>
            <option value="general">{actions.t("vxPresetGeneral")}</option>
            <option value="editing">{actions.t("vxPresetEditing")}</option>
            <option value="cutting">{actions.t("vxPresetCutting")}</option>
            <option value="custom">{actions.t("vxPresetCustom")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxSvgVersion">{actions.t("vxSvgVersion")}</label>
          <select id="vxSvgVersion" value={vx.svgVersion} onChange={(e) => actions.updateVx({ svgVersion: e.target.value, preset: "custom" })}>
            <option value="svg_1_1">SVG 1.1</option>
            <option value="svg_1_0">SVG 1.0</option>
            <option value="svg_tiny_1_2">SVG Tiny 1.2</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxGroup">{actions.t("vxGroup")}</label>
          <select id="vxGroup" value={vx.group} onChange={(e) => actions.updateVx({ group: e.target.value, preset: "custom" })}>
            <option value="none">{actions.t("vxGroupNone")}</option>
            <option value="color">{actions.t("vxGroupColor")}</option>
            <option value="parent">{actions.t("vxGroupParent")}</option>
            <option value="layer">{actions.t("vxGroupLayer")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxStack">{actions.t("vxStack")}</label>
          <select id="vxStack" value={vx.stack} onChange={(e) => actions.updateVx({ stack: e.target.value, preset: "custom" })}>
            <option value="cutouts">{actions.t("vxStackCutouts")}</option>
            <option value="stacked">{actions.t("vxStackStacked")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxDraw">{actions.t("vxDraw")}</label>
          <select id="vxDraw" value={vx.draw} onChange={(e) => actions.updateVx({ draw: e.target.value, preset: "custom" })}>
            <option value="fill_shapes">{actions.t("vxDrawFill")}</option>
            <option value="stroke_shapes">{actions.t("vxDrawStroke")}</option>
            <option value="stroke_edges">{actions.t("vxDrawEdges")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxCurves">{actions.t("vxCurves")}</label>
          <select id="vxCurves" value={vx.curves} onChange={(e) => actions.updateVx({ curves: e.target.value, preset: "custom" })}>
            <option value="all">{actions.t("vxCurvesAll")}</option>
            <option value="cubic">{actions.t("vxCurvesCubic")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxLineFit">{actions.t("vxLineFit")}</label>
          <select id="vxLineFit" value={vx.lineFit} onChange={(e) => actions.updateVx({ lineFit: e.target.value, preset: "custom" })}>
            <option value="fine">{actions.t("vxLineFine")}</option>
            <option value="medium">{actions.t("vxLineMedium")}</option>
            <option value="coarse">{actions.t("vxLineCoarse")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="vxStrokeWidth">{actions.t("vxStrokeWidth")}</label>
          <input
            id="vxStrokeWidth"
            type="number"
            min={0}
            max={5}
            step={0.5}
            value={String(vx.strokeWidth)}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isFinite(n)) return;
              actions.updateVx({ strokeWidth: Math.max(0, Math.min(5, n)), preset: "custom" });
            }}
          />
        </div>
        <div className="field full">
          <label className="checkbox">
            <input id="vxAdobe" type="checkbox" checked={vx.adobe} onChange={(e) => actions.updateVx({ adobe: e.target.checked, preset: "custom" })} />
            <span>{actions.t("vxAdobe")}</span>
          </label>
          <label className="checkbox">
            <input id="vxNativeShapes" type="checkbox" checked={vx.nativeShapes} onChange={(e) => actions.updateVx({ nativeShapes: e.target.checked, preset: "custom" })} />
            <span>{actions.t("vxNativeShapes")}</span>
          </label>
          <label className="checkbox">
            <input id="vxGapFiller" type="checkbox" checked={vx.gapFiller} onChange={(e) => actions.updateVx({ gapFiller: e.target.checked, preset: "custom" })} />
            <span>{actions.t("vxGapFiller")}</span>
          </label>
          <label className="checkbox">
            <input id="vxStrokeFixed" type="checkbox" checked={vx.strokeFixed} onChange={(e) => actions.updateVx({ strokeFixed: e.target.checked, preset: "custom" })} />
            <span>{actions.t("vxStrokeFixed")}</span>
          </label>
          <label className="checkbox">
            <input id="vxFixedSize" type="checkbox" checked={vx.fixedSize} onChange={(e) => actions.updateVx({ fixedSize: e.target.checked, preset: "custom" })} />
            <span>{actions.t("vxFixedSize")}</span>
          </label>
        </div>
        <div className="field full">
          <label htmlFor="settingsVectorizeShortcut">{actions.t("vectorizeShortcut")}</label>
          <div className="row">
            <input
              id="settingsVectorizeShortcut"
              type="text"
              readOnly
              value={capturing ? (actions.t("pressShortcut") || "Press keys…") : actions.shortcutLabel(s.vectorizeShortcut)}
            />
            <button id="setVectorizeShortcutBtn" className="btn small" type="button" onClick={startCapture}>
              {capturing ? (actions.t("cancel") || "Cancel") : (actions.t("setShortcut") || "Set")}
            </button>
            <button id="resetVectorizeShortcutBtn" className="btn small" type="button" onClick={resetShortcut}>
              {actions.t("resetShortcut") || "Reset"}
            </button>
          </div>
          <div className="hint">{actions.t("vectorizeShortcutHint")}</div>
        </div>
        <div className="field full">
          <button id="setupAgainBtn" type="button" className="btn small" onClick={() => (window as any).VBPanel?.setup?.open?.()}>
            {actions.t("setupRunAgain")}
          </button>
        </div>
      </div>
    </details>
  );
}

function WarmDaemonStatus() {
  const { state, actions } = useCore();
  const d = state.daemon;
  let text: string;
  if (d.ui === "starting") text = actions.t("warmDaemonStarting");
  else if (d.ui === "stopping") text = actions.t("warmDaemonStopping");
  else if (d.ui === "error") text = actions.t("warmDaemonError");
  else if (!state.settings.warmDaemon) text = actions.t("warmDaemonOff");
  else {
    const st = d && d.state ? d.state : "unknown";
    if (st === "running" || st === "ready") text = actions.t("warmDaemonOn");
    else if (st === "starting") text = actions.t("warmDaemonStarting");
    else if (st === "stopping") text = actions.t("warmDaemonStopping");
    else if (st === "stopped" || st === "stale" || st === "unknown") text = actions.t("warmDaemonOff");
    else text = actions.t("warmDaemonError");
  }
  return <div id="warmDaemonStatus" className="hint">{text}</div>;
}
