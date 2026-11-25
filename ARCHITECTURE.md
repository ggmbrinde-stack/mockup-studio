# Mockup Studio architecture (v3.0.1)

## Status
- **Panel UI is React (3.0.0+); host and agent layers are unchanged.** UI work does not alter `host/*.jsx` or `agent/*` contracts, batch/placement semantics or the runtime flow. Keep source and the installed CEP copy in sync on every change.
- Current release **3.0.1** adds a proactive update banner, two-step update confirmation, and opt-in What's New tour on top of the React panel shipped in 3.0.0.

## Runtime layers

### Panel (React/Vite, `modern-ui/`)
- `CSXS/manifest.xml` loads `./dist/index.html` for both extensions (the floating window appends `?view=window`, which selects the compact layout).
- `dist/index.html` is the built shell. It loads, in order: `dist/csinterface.js`, `../js/admin-config.js`, `../js/whats-new.js`, then the single IIFE bundle `dist/assets/index-<hash>.js`. Admin config and What's-new data stay outside the bundle so an installer can replace them without a rebuild.
- `modern-ui/src/` is the UI source:
  - `App.tsx` — panel composition (`Header`, `StatusBar`, `VectorizeButton`, `Actions`, `SettingsAccordion`, `AiImageSection`, `HistoryPanel`, `LogPanel`, `UpdatesPanel`, `WhatsNewCard`, `SetupWizard`, `UpdateBanner`) plus the CEP integrations block (flyout menu, shortcut registration, `VB.watch` start/stop, host settings sync).
  - `context/core-context.tsx` — state/settings, i18n, log/detail, poll scheduler; publishes `window.VBPanel.core` (including `core.events`) and exports the `useCore()` hook.
  - `hooks/use-host.ts` — the host bridge: one shared `CSInterface`, `evalScript` wrapper, result parsing and friendly errors, `loadHost()` (`$.evalFile` chain + `VB.ping`), folder actions; publishes `window.VBPanel.bridge`.
  - `hooks/use-batch.ts` — bounded parallel batch queue; publishes `window.VBPanel.queue`.
  - `hooks/use-vectorizer.ts` — vectorize/sign-in/cancel, polling, history place, warm-daemon control; publishes `window.VBPanel.vectorizer`.
  - `components/` — the UI sections and `ErrorBoundary`; `hooks/use-toast.ts` + `components/ui/*` (Radix/shadcn-style primitives); `locales/{en,pt}.ts`.
- These globals reproduce the pre-3.0.0 `window.VBPanel` surface, so host scripts, the shortcut path and the flyout menu keep working unchanged. Keep those names when refactoring.

### Build
- `cd modern-ui && npm install && npm run build` → `tsc -b && vite build && node scripts/strip-module.mjs`.
- Vite writes to **repo-root `dist/`** (`outDir: "../dist"`, `emptyOutDir: true`, `base: "./"`, single IIFE bundle). `modern-ui/public/` supplies `csinterface.js`, `favicon.svg`, `icons.svg`; `strip-module.mjs` removes `type="module"`/`crossorigin` from the emitted `index.html` so CEP can load the bundle as a classic deferred script.
- `dist/` is committed and is required by the release archive, the updater's staged validation and both installers.
- The legacy native panel (`index.html`, `js/`, `modules/`, `css/`) is still in the tree but is **not** `MainPath`, so CEP does not load it. Do not treat it as the live UI.

### Host (Illustrator ExtendScript, cached — Illustrator restart/full reload required on change)
- Loaded by `use-host.ts` via `$.evalFile` from `SystemPath.EXTENSION`: `host/json.jsx` (JSON polyfill), `host/core.jsx` (shared paths/log/bounds/doc checks, SVG list/open/reveal), `host/batch.jsx` (prepareBatch/exportBatchItem/resolve), `host/export.jsx` (`exportSelection`), `host/place.jsx` (`placeSVG`, `allowAnyDoc`), `host/ai.jsx` (Gemini in Chrome), `host/agent.jsx` (agent/daemon launch/status/stop), `host/watch.jsx` (selection watcher). API namespace: `VB.*`.
- `host/common.jsx` and `host/import.jsx` remain as compatibility copies for the offline harness.

### Agent (Node, outside Illustrator, `agent/`)
- Stable entrypoints/wrappers: `run.js`, `login.js`, `update.js`, `lib.js`→`core/lib.js`, `job.js`→`vectorizer/job.js`, `daemon.js`→`daemon/server.js`, `daemon-ctl.js`→`daemon/ctl.js`.
- Modules: `core/lib.js` (browser/profile/status helpers), `vectorizer/job.js` (Puppeteer vectorizer.ai flow, per-page CDP Fetch SVG capture), `daemon/server.js` + `daemon/ctl.js` (warm page pool/IPC), `update.js` (opt-in update check/apply/restore).

### Runtime data (user Documents, not in repo)
`%USERPROFILE%\Documents\VectorizerBridge\`: `agent-downloads/`, `agent-status*.json`, `agent-daemon.json`, logs, `vectorizer-profile/`, `debug/`, `backups/`.

## Interfaces & conventions
- Panel globals: `window.VBPanel.{core,bridge,queue,vectorizer}`; ExtendScript API under `VB.*`. Components read state through `useCore()` and act through `useHost()`/the hooks.
- Queue↔vectorizer stay decoupled via `core.events` (`poll:tick`, `batch:finished`).
- Keep per-item export/place semantics and the source-document guard for auto/batch placement; history/manual place may target any open document (`allowAnyDoc`) and fits the active artboard.
- Default `batchWorkers=1`; warm daemon is a single browser/profile with reusable pages (clamped 1–4).
- **Keyboard shortcut:** `state.settings.vectorizeShortcut` (default `Ctrl+Shift+Ç`), registered via `CSInterface.registerKeyEventsInterest` in `App.tsx`; panel focus required.
- **Sync:** after a build, copy the repo-root `dist/` (plus any touched `host/`, `agent/`, `js/` file) to `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\`, then verify parity rather than assuming it.

## Packaging / distribution
- A release archive must contain `CSXS/`, `dist/`, `index.html`, `css/`, `host/`, `js/`, `modules/`, `agent/`. `dist/index.html` is mandatory in staged validation (`agent/update.js`, `install.ps1`, `install-online.ps1`) — without it the installed panel cannot open.
- Do **not** package `agent/node_modules/` or runtime artifacts (`agent-downloads`, status/daemon/log/debug/profile files, backups).
- Updates are user-triggered only: HTTPS + host allowlist, SHA-256 digest required, staged validation, backup then apply, rollback on failure.

## Deferred
- Further splitting of host/agent internals; typed event/command interface; reconciling the legacy native panel and `..\design` frames with the React build.
