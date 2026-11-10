# Changelog — Mockup Studio

## 2.2.0 — 2026-11-10 (development freeze for UI/UX)
### Modularization
- **Panel (CEP):** split monolithic `js/panel.js` into `js/core/app.js` (state/settings/i18n/logging/poll scheduler + event bus), `js/bridge/host.js` (CSInterface/evalScript, host load/parse/errors), `js/queue/batch.js` (bounded parallel batch scheduler), `modules/vectorizer/vectorizer.js` (vectorizer flow, sign-in/cancel, SVG history, warm daemon, UI/init). `js/panel.js` is now bootstrap. Added `core.events` (`poll:tick`, `batch:finished`) as queue↔module interface.
- **Host (ExtendScript):** split by responsibility — `host/core.jsx` (shared helpers/bounds/paths/history listing), `host/batch.jsx` (batch prepare/export/resolve), `host/export.jsx` (single-selection export), `host/place.jsx` (SVG place/import), `host/agent.jsx` (agent/daemon launch/status/stop). `host/json.jsx` retained; `host/common.jsx`/`host/import.jsx` kept as compatibility copies (panel now loads modular set).
- **Agent (Node):** split into `agent/core/lib.js`, `agent/vectorizer/job.js`, `agent/daemon/server.js`, `agent/daemon/ctl.js` with backward-compatible entrypoint wrappers (`agent/lib.js`, `agent/job.js`, `agent/daemon.js`, `agent/daemon-ctl.js`) so `run.js`/`login.js`/host launch paths remain unchanged.

### Stability (carried into this release)
- History → Place works on any open document (`allowAnyDoc`, artboard fit; batch/auto placement keeps strict doc check).
- Safer defaults: `batchWorkers` default 1; warm daemon/workers clamped; reduced `stuck: starting` (launcher handshake delay) and removed browser-global `Browser.setDownloadBehavior` contention in parallel jobs.

### Housekeeping
- Version bumped to 2.2.0 (`CSXS/manifest.xml`).
- Added `.gitignore` to exclude `agent/node_modules/`, runtime artifacts, logs, and local temp files from source distribution.
- Development **frozen for UI/UX work**: avoid behavior/flow changes; keep source and installed CEP in sync when UI changes are made.

## 2026-11-06
- See `CHANGES_2026-11-06.md` and `PROJECT_STATE_2026-11-06.md` for v1/v2.1 baseline, batch v1, SVG import fix, daemon, and hardening history.
