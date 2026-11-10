# Mockup Studio — AI Agent Context (v2.2.0)

> **Status: DEVELOPMENT FROZEN FOR UI/UX WORK (2026-11-10).**  
> Do not change behavior, host/agent contracts, batch/placement semantics, or runtime flow. UI/UX-only changes are in scope. Keep source and installed CEP in sync on every change.

## Purpose
CEP panel for **Adobe Illustrator 2025/2026+ on Windows** (`com.bestofgifts.vectorizerbridge`). Exports selection(s) to PNG, vectorizes via **vectorizer.ai** using a headless Node/Puppeteer agent, downloads SVG, and places editable SVG on the `Vectorizer` layer fitted to original bounds. Supports bounded parallel per-item batch (v2), SVG history/re-place, and optional warm Chrome daemon.

## Paths
- **Source:** `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge\`
- **Installed CEP (must stay in sync):** `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\`
- **Runtime/user data (never in repo/dist):** `%USERPROFILE%\Documents\VectorizerBridge\` — `agent-downloads\*.svg`, `agent-status*.json`, `agent-daemon.json`, `agent-log.txt`, `log.txt`, `agent-debug\`, `vectorizer-profile\`, temp launchers.

## Architecture (layers & boundaries)
- **Panel/UI (CEP, `index.html`)** — scripts in order:
  - `js/core/app.js` (`VBPanel.core`): state/settings, i18n, status/log/detail/timers, poll scheduler, history/UI helpers, **event bus** `core.events` `{on,off,emit}` — `poll:tick`, `batch:finished`. Note: `core.on(el,ev,fn)` is DOM binding; bus is `core.events`.
  - `js/bridge/host.js` (`VBPanel.bridge`): `CSInterface`/`evalScript`, result parsing, friendly errors, host script loading, folder actions.
  - `js/queue/batch.js` (`VBPanel.queue`): bounded parallel batch queue/scheduler (prepare/export/agent/place per item), retry/stale-start handling, progress/finish; emits `batch:finished`.
  - `modules/vectorizer/vectorizer.js` (`VBPanel.vectorizer`): UI bind/init, vectorize/sign-in/cancel, single-run poll/place fallback, SVG history UI/place, warm daemon control; subscribes to `core.events`.
  - `js/panel.js`: bootstrap (`VBPanel.vectorizer.init`).
- **Host (ExtendScript, ES3, cached — Illustrator restart/full reload required on change)** loaded via `$.evalFile` in `js/bridge/host.js`:
  - `host/json.jsx` (JSON polyfill) → `host/core.jsx` (shared: paths/log/bounds/doc checks, SVG list/open/reveal) → `host/batch.jsx` (prepare/export/resolve per item) → `host/export.jsx` (single `exportSelection`) → `host/place.jsx` (`placeSVG`, `allowAnyDoc`) → `host/agent.jsx` (agent/daemon launch/status/stop). API namespace: `VB.*` on `$.global`. `host/common.jsx`/`host/import.jsx` kept as compatibility copies.
- **Agent (Node, outside Illustrator, `agent/`)**:
  - Stable entrypoints/wrappers: `run.js`, `login.js`, `lib.js`→`core/lib.js`, `job.js`→`vectorizer/job.js`, `daemon.js`→`daemon/server.js`, `daemon-ctl.js`→`daemon/ctl.js`.
  - Modules: `core/lib.js` (browser/profile/status/launch helpers), `vectorizer/job.js` (Puppeteer vectorizer.ai flow, **per-page CDP Fetch** SVG capture → unique `vectorizer_export_*.svg`), `daemon/server.js` + `daemon/ctl.js` (warm browser, reusable page pool, local HTTP IPC).

## Key contracts & invariants (do not break)
- **Per-item batch semantics:** each selected item exported/vectorized/placed as its own SVG; preserve `VB_BATCH=<jobId>:<index>` tagging/resolve and per-item hide-original. 1 selected = 1-item batch. “Whole selection as one image” is deferred.
- **Document safety:** auto/batch placement enforces source-document check (`docChanged` guard). **History/manual Place** passes `allowAnyDoc:true` (no doc identity), `hideOriginal:false`, and fits to active artboard when union missing — must work on any open document.
- **SVG import (AI 2026):** `vector-effect="non-scaling-stroke"` breaks `placedItems.add()+embed()` (error 129); `place.jsx` uses `groupItems.createFromFile(File|path)` primary, fallbacks as needed.
- **Agent/daemon:** warm daemon = single browser on `vectorizer-profile` (exclusive lock), independent reusable pages, workers clamped 1–4 (default 1). `/run` async-ack `202 {accepted,viaDaemon}` when slot free, `503` when saturated; `run.js` waits/polls per-job status file then falls back to one-shot only when daemon unreachable. Stop daemon-served runs via daemon stop/remove `agent-daemon.json` (never taskkill daemon PID blindly).
- **Status/launch:** per-job status files `agent-status-<runToken>-<index>.json`; pre-launch `starting`; stale-launch takeover bounded; panel relaunches stale no-pid `starting` (limited retries) and enforces stuck bounds (`launching`/`starting`). Windows launcher via hidden VBS/cmd.
- **Parallel safety:** `Browser.setDownloadBehavior` is browser-global — **do not use it**; `vectorizer/job.js` captures via per-page CDP `Fetch` interception only. Prefer `batchWorkers=1-2` on Windows.

## ExtendScript constraints
ES3: no `JSON` (use `host/json.jsx`/`VB.toJSON`/`VB.fromJSON`), no `let/const`, no arrow functions, no modern array/object helpers, no `trim()` assumptions. Always return safe JSON strings to panel.

## Development & sync (frozen = UI/UX only)
- Edit source, then copy changed files to installed CEP. Panel JS/HTML reload on panel reopen; **`host/*.jsx` requires full Illustrator quit/reopen or full extension reload**. Agent/daemon code changes require stopping/restarting warm daemon.
- Quick deploy (example): copy relevant files from source to `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\` mirroring paths. Verify hashes match.
- Syntax-check: `node --check` for JS/agent modules. Host JSX is ExtendScript (not Node-checkable).

## Packaging / distribution
- **Do not package/distribute:** `agent/node_modules/`, `agent-downloads/`, status/daemon/log/debug/profile/runtime artifacts, temp zips/logs. `.gitignore` enforces. Consumers run `npm install` in `agent/` when needed.
- Manifest version: `CSXS/manifest.xml` (bundle + panel). Update `CHANGELOG.md` for releases.

## Known risks / deferred (post-freeze)
- Intermittent `stuck: starting` under parallel load on Windows (launcher/spawn); validate with `workers=1` default.
- “Whole selection as one image” batch mode deferred.
- Further host/agent internal splits and richer typed event/command interfaces if needed.
- UI/UX redesign (current focus) — must preserve contracts above.

## Quick file map
- Panel: `index.html`, `css/style.css`, `js/{core/app.js,bridge/host.js,queue/batch.js,panel.js}`, `modules/vectorizer/vectorizer.js`, `js/locales/{en,pt}.js`, `js/csinterface.js`
- Host: `host/{json,core,batch,export,place,agent,common,import}.jsx`
- Agent: `agent/{run,login,lib,job,daemon,daemon-ctl}.js`, `agent/{core/lib.js,vectorizer/job.js,daemon/server.js,daemon/ctl.js}`, `package.json`
- Meta: `CSXS/manifest.xml`, `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `AGENTS.md`, `PROJECT_STATE_2026-11-10.md`, `CHANGES_2026-11-06.md`, `.gitignore`
