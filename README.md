# Mockup Studio — Adobe Illustrator panel (v3.0.2)

> **Development frozen for UI/UX work.** Behavior/flow/contracts are stable; UI/UX changes only. Keep source and `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\` in sync.

CEP panel for **Illustrator 2025/2026+ on Windows** (`com.bestofgifts.vectorizerbridge`). Exports the current selection to PNG, vectorizes via **vectorizer.ai** with a hidden Node/Puppeteer agent, and places editable SVG(s) on the `Vectorizer` layer fitted to the original bounds.

- **Per-item batch:** each selected object becomes its own SVG (bounded parallel queue, default 1 worker, up to 4). Whole-selection-as-one is deferred.
- **SVG history:** saved SVGs can be opened/revealed and placed into any open document (artboard-fit), independent of the export source document.
- **Warm Chrome daemon (optional):** keeps a headless browser/profile warm for faster runs.
- **Keyboard shortcut:** customizable shortcut for Vectorize selection (default `Ctrl+Shift+Ç`). Works only when the panel has focus. Set/Reset in Settings → “Vectorize shortcut”.

vectorizer.ai cannot be embedded (`X-Frame-Options`); the agent drives a hidden Chrome/Edge session on a persistent profile. No API key.

## Requirements
- Windows 10/11, Illustrator 2025 (29.x) or 2026 (30.x)+
- Node.js 22.12+ on PATH (the agent runs `npm install --omit=dev` on the first install)
- Chrome or Edge (Chrome for the optional Google Flow bridge)
- vectorizer.ai account with downloads enabled (sign in once in-panel)

## Install
One file, no git, no admin, nothing to download: **`Install-Mockup-Studio.cmd`** (repo root).

1. Double-click `Install-Mockup-Studio.cmd`. Its menu offers **Install or update**, **Clean install** (removes the old copy first), **Remove from this computer**, **Open my files** and **Quit**; the header shows the version already installed, if any.
2. Restart Illustrator → **Window > Extensions > Mockup Studio**.
3. Load the Chrome bridge once (optional, for Google Flow): `chrome://extensions` → Developer mode → Load unpacked → `%LOCALAPPDATA%\MockupStudio\flow-bridge`.
4. **Sign in to vectorizer.ai** once (profile stored in `Documents\VectorizerBridge\vectorizer-profile`).

The current build is embedded in the `.cmd`, inside a base64 zip. It unpacks to `%TEMP%`, mirrors the runtime files, installs missing agent dependencies, sets `PlayerDebugMode` for CSXS 9-16, verifies the result and deletes the temp copy.

- Writes only to `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge`, `HKCU\Software\Adobe\CSXS.9-16` and `%LOCALAPPDATA%\MockupStudio\flow-bridge`.
- Never touches `%USERPROFILE%\Documents\VectorizerBridge` (the folder is never deleted either).
- Refuses to run from inside the installed folder.
- Everything runs offline from the embedded payload; the menu's Remove action runs the same `uninstall.ps1` (user data in `Documents\VectorizerBridge` is kept).
- After changing the panel, rebuild it: `powershell -ExecutionPolicy Bypass -File tools\build-installer-cmd.ps1`.

**Apply changes:** panel JS/HTML on panel reload; **`host/*.jsx` requires full Illustrator quit/reopen or full extension reload** (ExtendScript cache); `agent/*` changes require stopping/restarting the warm daemon if running. Shortcut changes take effect on panel reload.

## Usage
1. Select artwork (one or many items) and click **Vectorize selection** (or use the configured keyboard shortcut, default `Ctrl+Shift+Ç`, panel must have focus).
2. Progress: exporting → uploading → vectorizing → downloading → placing. Cancel stops active runs/daemon-served work.
3. Results: editable SVG(s) on `Vectorizer` layer, selected/fitted; originals optionally hidden per setting (batch/auto). History → Place works in any open document.

**Settings:** PNG long side (preset/custom/original), hide original after placing, warm Chrome, parallel batch workers (1 safest), vectorize shortcut (default `Ctrl+Shift+Ç`, panel focus only).

## Runtime data (user Documents, not in repo/dist)
`%USERPROFILE%\Documents\VectorizerBridge\`: `agent-downloads\vectorizer_export_*.svg`, `agent-status*.json`, `agent-daemon.json`, `agent-log.txt`, `log.txt`, `agent-debug\`, `vectorizer-profile\`.

## Architecture (modular, v2.2.0)
- **Panel:** `js/core/app.js` (state/i18n/log/poll + `core.events`), `js/bridge/host.js` (CSInterface/evalScript/host load), `js/queue/batch.js` (bounded parallel batch; emits `batch:finished`), `modules/vectorizer/vectorizer.js` (flow/UI/daemon/history; listens to `core.events`), `js/panel.js` bootstrap.
- **Host (ES3, `VB.*`):** `host/{json,core,batch,export,place,agent}.jsx` (+compat `common.jsx`,`import.jsx`).
- **Agent (Node):** `agent/{run,login}.js`, wrappers `lib/job/daemon/daemon-ctl.js` → `agent/core/lib.js`, `agent/vectorizer/job.js` (per-page CDP Fetch capture), `agent/daemon/{server,ctl}.js` (warm page pool).

See `ARCHITECTURE.md` for details and `AGENTS.md` for AI-agent contracts/invariants.

## Packaging & housekeeping
- Do **not** package or distribute `agent/node_modules/` or runtime/user artifacts (downloads, status/daemon/log/debug/profile). `.gitignore` excludes them. Run `npm install` in `agent/` for a working agent environment.
- Keep source and installed CEP in sync. Bump `CSXS/manifest.xml` and `CHANGELOG.md` for releases.

## Troubleshooting (quick)
- **Host/JSON issues:** panel log should show `Host self-test ... "parsed":true`. If not, reinstall/sync and fully restart Illustrator (host cache).
- **Agent didn’t start:** verify Node/Chrome, check `Documents\VectorizerBridge\agent-log.txt` and status files.
- **Login required:** sign in via panel; profile is `vectorizer-profile` (daemon holds it exclusively while running).
- **Stuck/unstable batch:** use `workers=1`, cancel, restart warm daemon, fully reload extension; see logs in `Documents\VectorizerBridge`.
- **`docChanged` on auto/batch place:** switched source document — expected guard. History place is allowed on any open document.

## Docs
- `AGENTS.md` — AI agent context, contracts, invariants, freeze rules
- `ARCHITECTURE.md` — layers, modules, interfaces
- `CHANGELOG.md` — release notes (current: 3.0.2)
- `HANDOFF.md`, `ARCHITECTURE.md` — current state and layers (3.0.2)
- `docs/archive/` — superseded 2.2.0–2.3.x snapshots, the unimplemented multi-tool plan and the old
  2.3.1 release runbook; history only
