# Changelog — Mockup Studio

## 2.3.1 — 2026-11-11

### UI
- **Design tokens:** the panel palette now lives in one `:root` block instead of scattered hex values.
- **Contrast:** muted text, version and attribution raised to WCAG AA (6.1:1 / 5.1:1); accent darkened from `#1a73e8` (4.3:1) to `#0b57d0` (6.1:1); success and error colours strengthened.
- **Title:** now neutral instead of red — red is reserved for errors.
- **Keyboard:** visible `:focus-visible` rings on every button, summary, input and select, plus hover/active states.
- **Density:** 26 px / 24 px minimum button heights, upright 11.5 px hints, `overflow-wrap` instead of `word-break: break-all`.
- **Scrolling:** long SVG/activity lists cap at 260 px and the log at 200 px, so the footer no longer drifts a screen away.
- **Narrow panels:** the settings grid collapses to one column below 340 px and the primary button is full width.
- **Details affordance:** `▸`/`▾` marker on the Settings summary.
- **Accessibility:** status line is `role="status" aria-live="polite"`; history rows carry `✓`/`✕` so status is not colour-only.
- **Copy:** "Recent activity" is localised (`recentActivity`); the SVG history button says "Show in folder" instead of "Open", matching `VB.revealFile`.
- **Cleanup:** removed the hidden duplicate History title, moved inline styles (shortcut row, `#jsError`) into the stylesheet.

### Fixes carried since 2.3.0
- Installer: runtime-only copy, source==destination guard, real `-Force`, npm exit-code and `puppeteer-core` verification, stale-doc pruning.
- Uninstaller: stops the warm daemon before deleting, `-RemoveDebugMode` clears CSXS 9–16.
- Warm Chrome: `agent/daemon-ctl.js` now calls `main()` instead of silently doing nothing.
- Agent: `fetchTimer` declared outside the `try`, so batch items no longer fail after download.
- Updater: explicit confirm, SHA-256 verification, staged validation, backup and rollback, "Restore previous version".

## 2.3.0 — 2026-11-11

### Fixes
- **Manifest:** numeric `ExtensionBundleVersion` (2.3.0). CEP rejected `2.3.0-test` ("Wrong symbol '-' in version") and the panel never loaded.
- **Warm daemon:** `agent/daemon/ctl.js` required a nonexistent `./lib`; now `../core/lib`. Start/stop/status work again.
- **Agent:** an abandoned Fetch wait can no longer become an unhandled rejection; the daemon logs stray rejections instead of dying.
- **Daemon liveness:** `agent-daemon.json` is heartbeated every minute and the host treats 3 min of silence as stale (was 30).
- **Batch:** PNG files are per job+index (`vectorizer_export_batch_<jobId>_<index>.png`), so overlapping runs cannot overwrite an upload in flight.
- **Placement:** file-busy retry checks `File.open()`'s return value, and only a 256-char header is read instead of the whole SVG.
- **Original PNG preset:** `pngLongSide = 0` survives settings load and the batch path.
- **i18n:** added the missing `pngLongSide` key; rewrote `pt.js` as clean UTF-8 (it was double-encoded mojibake).
- **Cancelled batch:** emits `batch:finished`, so the SVG history refreshes after a cancel.
- **Removed:** the self-updater (it downloaded a third-party GitHub zip and robocopied it over the installed extension at startup), the dead `host/vectorize-shortcut.jsx` path and the unused `js/core/namespace.js`.
- **Installer:** mirrors only runtime files (`index.html`, `CSXS`, `css`, `host`, `js`, `modules`, `agent`), prunes docs/installers left in the extension by older versions, sets `PlayerDebugMode` for CSXS 9-16 and installs `npm install --omit=dev` when `agent/node_modules` is missing. It now refuses to run from inside the installed folder (source == destination), aborts when Illustrator is open unless `-Force` is passed, fails loudly on a non-zero npm exit or a missing `puppeteer-core`, and prints the verified manifest version and file count at the end.
- **Uninstaller:** stops the warm daemon before deleting the folder, and `-RemoveDebugMode` now clears CSXS 9-16 (it only handled 11/12 while the installer set more).
- **Cleanup:** removed the now-dead extension-version plumbing (`getLocalVersion`/`VB.getExtensionVersion`/`state.appVersion`) and the two orphaned update locale keys.
- **Tests:** `tools/verify-host.cjs` now covers the shipped modular host scripts (`core.jsx`, `batch.jsx`, `place.jsx`); removed the broken ESM `.js` duplicates.

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
