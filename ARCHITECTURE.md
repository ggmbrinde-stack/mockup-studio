# Mockup Studio architecture (v2.2.0 — frozen for UI/UX)

## Status
- **Development frozen for UI/UX work.** Behavior/flow is stable; prioritize UI/UX changes without altering host/agent contracts or batch/placement semantics. Keep source and installed CEP in sync.

## Runtime layers
- **Panel/UI (CEP HTML+JS)** — `index.html` loads in order:
  - `js/core/app.js`: core shell — state/settings, i18n, status/log/detail, timers/poll scheduler, history/UI helpers, **event bus** `core.events` (`on/off/emit`: `poll:tick`, `batch:finished`).
  - `js/bridge/host.js`: host bridge — `CSInterface`/`evalScript`, result parsing + friendly errors, host script loading, folder/history host actions.
  - `js/queue/batch.js`: bounded parallel batch queue/scheduler (prepare/export/agent/place per item, retry/stale-start handling, progress/finish) — emits `batch:finished`.
  - `modules/vectorizer/vectorizer.js`: vectorizer module — UI bind/init, vectorize/sign-in/cancel, single-run poll/place fallback, SVG history UI/place, warm daemon control; subscribes to `core.events`.
  - `js/panel.js`: bootstrap (`VBPanel.vectorizer.init`).
- **Host (Illustrator ExtendScript, cached; requires Illustrator restart/full reload on change)** — loaded via `$.evalFile`:
  - `host/json.jsx` (JSON polyfill), `host/core.jsx` (shared helpers: paths/log/bounds/doc checks, SVG listing/open/reveal), `host/batch.jsx` (prepareBatch/exportBatchItem/resolve), `host/export.jsx` (single `exportSelection`), `host/place.jsx` (`placeSVG`, `allowAnyDoc` history place), `host/agent.jsx` (agent/daemon launch/status/stop). `host/common.jsx`/`host/import.jsx` remain as compatibility copies.
- **Agent (Node, outside Illustrator)** — `agent/`:
  - Entrypoints/wrappers (stable): `run.js`, `login.js`, `lib.js`→`core/lib.js`, `job.js`→`vectorizer/job.js`, `daemon.js`→`daemon/server.js`, `daemon-ctl.js`→`daemon/ctl.js`.
  - Modules: `core/lib.js` (browser/profile/status helpers), `vectorizer/job.js` (Puppeteer vectorizer.ai flow, per-page CDP Fetch SVG capture), `daemon/server.js` + `daemon/ctl.js` (warm page pool/IPC).
- **Runtime data (user Documents, not in repo)** — `%USERPROFILE%\Documents\VectorizerBridge\`: `agent-downloads/`, `agent-status*.json`, `agent-daemon.json`, logs, `vectorizer-profile/`, debug.

## Interfaces & conventions
- Panel modules share `window.VBPanel.{core,bridge,queue,vectorizer}`; ExtendScript API under `VB.*`.
- Queue↔vectorizer decoupled via `core.events` (`poll:tick`, `batch:finished`); keep this boundary for UI/UX changes.
- Keep per-item export/place semantics and source-document guards for auto/batch placement; history/manual place may target any open document (`allowAnyDoc`) and fit to active artboard.
- Default `batchWorkers=1` (safer on Windows); warm daemon is single browser/profile with reusable pages (clamped 1–4).
- **Sync:** keep source and `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\` in sync on changes.

## Packaging / distribution (housekeeping)
- Do **not** package or distribute `agent/node_modules/` or runtime artifacts (`agent-downloads`, status/daemon/log/debug/profile files). Consumers run `npm install` in `agent/` as needed.
- `.gitignore` excludes `agent/node_modules/`, logs, and local/runtime artifacts.

## Further (deferred, post-freeze/UI)
- Split host/agent internals further only if needed; richer typed event/command interface; UI/UX redesign (current focus).
