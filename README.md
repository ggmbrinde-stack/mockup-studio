# Mockup Studio — Adobe Illustrator panel (v2.3.0)

> **Development frozen for UI/UX work.** Behavior/flow/contracts are stable; UI/UX changes only. Keep source and `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\` in sync.

CEP panel for **Illustrator 2025/2026+ on Windows** (`com.bestofgifts.vectorizerbridge`). Exports the current selection to PNG, vectorizes via **vectorizer.ai** with a hidden Node/Puppeteer agent, and places editable SVG(s) on the `Vectorizer` layer fitted to the original bounds.

- **Per-item batch:** each selected object becomes its own SVG (bounded parallel queue, default 1 worker, up to 4). Whole-selection-as-one is deferred.
- **SVG history:** saved SVGs can be opened/revealed and placed into any open document (artboard-fit), independent of the export source document.
- **Warm Chrome daemon (optional):** keeps a headless browser/profile warm for faster runs.
- **Keyboard shortcut:** customizable shortcut for Vectorize selection (default `Ctrl+Shift+Ç`). Works only when the panel has focus. Set/Reset in Settings → “Vectorize shortcut”.

vectorizer.ai cannot be embedded (`X-Frame-Options`); the agent drives a hidden Chrome/Edge session on a persistent profile. No API key.

## Requirements
- Windows 10/11, Illustrator 2025 (29.x) or 2026 (30.x)+
- Node.js 18+ and Chrome or Edge
- vectorizer.ai account with downloads enabled (sign in once in-panel)
- `agent/node_modules` dependencies installed (`npm install` in `agent/` if missing; not shipped in source packages)

## Install
One line, PowerShell or cmd.exe, no git and no admin:

```
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((irm 'https://raw.githubusercontent.com/ggmbrinde-stack/mockup-studio/main/install-online.ps1') -join [Environment]::NewLine)"
```

(`-join` matters: piping `irm` straight into `iex` splits the script into lines and breaks its header comment on Windows PowerShell 5.1.)

It downloads the latest GitHub release, verifies its SHA-256 digest, validates the archive before touching anything, backs up the installed copy, stops the warm daemon, copies the files, installs missing agent dependencies, sets `PlayerDebugMode` for CSXS 9-16 and verifies the result. A failure after the copy restores the backup automatically.

- Writes only to `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge`, `%LOCALAPPDATA%\VectorizerBridge\install-backups` and `HKCU\Software\Adobe\CSXS.9-16`.
- Never touches `%USERPROFILE%\Documents\VectorizerBridge` (the folder is never deleted either).
- Aborts before changing anything if Node.js/npm is missing, or if the download, digest or archive check fails.
- Requires Node.js LTS on PATH (https://nodejs.org/en/download); Chrome or Edge for the agent.

Manual/offline alternative from a clone: `powershell -ExecutionPolicy Bypass -File .\install.ps1` (refuses to run while Illustrator is open unless you pass `-Force`).

3. Start Illustrator → **Window > Extensions > Vectorizer Bridge**.
4. **Sign in to vectorizer.ai** once (profile stored in `Documents\VectorizerBridge\vectorizer-profile`).

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
- `CHANGELOG.md` — release notes (current: 2.3.0)
- `PROJECT_STATE_2026-11-10.md` — current state snapshot
- `CHANGES_2026-11-06.md`, `PROJECT_STATE_2026-11-06.md` — prior baseline history
