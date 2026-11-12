# Mockup Studio — AI Agent Context (v2.3.8)

> **Scope: UI/UX is the default focus, behaviour changes need explicit approval.**
> Do not change host/agent contracts, batch/placement semantics or the runtime flow unless the user
> asked for exactly that. Release, installer and updater work is allowed when explicitly requested.
> Keep source and the installed CEP copy in sync on every change.

This file is the shared entry point for every coding agent working here (Codex, Claude Code, OpenCode,
Cursor, Cline, and pen.dev's connected agents). Read it first, then the task-specific document:
`DESIGN.md` for interface work, `SKILLS.md` when choosing a specialist capability,
`HANDOFF.md` when resuming work somebody else started.

## Purpose

CEP panel for **Adobe Illustrator 2025/2026+ on Windows** (`com.bestofgifts.vectorizerbridge`,
menu entry "Vectorizer Bridge", bundle name "Mockup Studio"). Exports selection(s) to PNG, vectorizes
via **vectorizer.ai** using a headless Node/Puppeteer agent, downloads SVG, and places editable SVG on
the `Vectorizer` layer fitted to original bounds. Supports bounded parallel per-item batch (v2), SVG
history/re-place, optional warm Chrome daemon, a safe opt-in updater, and a customizable keyboard
shortcut for vectorize (default `Ctrl+Shift+Ç`, panel focus only).

Current release: **2.3.8** — `CSXS/manifest.xml` (two places, bundle and extension) and
`CHANGELOG.md` carry the version. Keep all three plus `README.md` in agreement when releasing.

## Paths

- **Source (this repository root):** `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge\`
- **Git remote:** `https://github.com/ggmbrinde-stack/mockup-studio.git`, branch `main`
- **Installed CEP (must stay in sync):** `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\`
- **Runtime/user data (never in repo/dist):** `%USERPROFILE%\Documents\VectorizerBridge\` —
  `agent-downloads\*.svg`, `agent-status*.json`, `agent-daemon.json`, `agent-log.txt`, `log.txt`,
  `agent-debug\`, `vectorizer-profile\`, `backups\`, temp launchers.
- **Workspace shell (outside this repository, unversioned):** `..\` holds `design\`, `tools\` and the
  legacy `HANDOFF.md`. Those files are **not tracked by Git** — see `HANDOFF.md` for the risk.

## Architecture (layers & boundaries)

- **Panel/UI (CEP, `index.html`)** — plain HTML/CSS/ES5-style JS in the CEP Chromium. **No framework,
  no bundler, no build step.** Script order in `index.html` is meaningful:
  `js/csinterface.js` → `js/locales/en.js` → `js/locales/pt.js` → `js/core/app.js` →
  `js/bridge/host.js` → `js/queue/batch.js` → `modules/vectorizer/vectorizer.js` → `js/panel.js`.
  - `js/core/app.js` (`VBPanel.core`): state/settings, i18n, status/log/detail/timers, poll scheduler,
    history/UI helpers, **event bus** `core.events` `{on,off,emit}` — `poll:tick`, `batch:finished`.
    Note: `core.on(el,ev,fn)` is DOM binding; the bus is `core.events`.
  - `js/bridge/host.js` (`VBPanel.bridge`): `CSInterface`/`evalScript`, result parsing, friendly errors,
    host script loading, folder/update actions.
  - `js/queue/batch.js` (`VBPanel.queue`): bounded parallel batch queue/scheduler (prepare/export/
    agent/place per item), serialized agent launches, warm-daemon sizing, retry/stale-start handling,
    progress/finish; emits `batch:finished`.
  - `modules/vectorizer/vectorizer.js` (`VBPanel.vectorizer`): UI bind/init, vectorize/sign-in/cancel,
    single-run poll/place fallback, SVG history UI/place, warm daemon control; subscribes to
    `core.events`.
  - `js/panel.js`: bootstrap (`VBPanel.vectorizer.init`); registers `CSInterface.registerKeyEventsInterest`
    for the configured vectorize shortcut and the panel flyout menu.
- **Host (ExtendScript, ES3, cached — Illustrator restart/full reload required on change)** loaded via
  `$.evalFile` in `js/bridge/host.js`:
  - `host/json.jsx` (JSON polyfill) → `host/core.jsx` (shared: paths/log/bounds/doc checks, SVG
    list/open/reveal) → `host/batch.jsx` (prepare/export/resolve per item) → `host/export.jsx` (single
    `exportSelection`) → `host/place.jsx` (`placeSVG`, `allowAnyDoc`) → `host/agent.jsx` (agent/daemon
    launch/status/stop). API namespace: `VB.*` on `$.global`. `host/common.jsx`/`host/import.jsx` are
    kept as compatibility copies — the harness still exercises them, so do not delete them casually.
- **Agent (Node, outside Illustrator, `agent/`)**: single dependency `puppeteer-core ^25.16.0`
  (`agent/package.json`).
  - Stable entrypoints/wrappers: `run.js`, `login.js`, `update.js`, `lib.js`→`core/lib.js`,
    `job.js`→`vectorizer/job.js`, `daemon.js`→`daemon/server.js`, `daemon-ctl.js`→`daemon/ctl.js`.
  - Modules: `core/lib.js` (browser/profile/status/launch helpers), `vectorizer/job.js` (Puppeteer
    vectorizer.ai flow, **per-page CDP Fetch** SVG capture → unique `vectorizer_export_*.svg`),
    `daemon/server.js` + `daemon/ctl.js` (warm browser, reusable page pool, local HTTP IPC),
    `update.js` (opt-in update check/apply/restore).

## Key contracts & invariants (do not break)

- **Per-item batch semantics:** each selected item exported/vectorized/placed as its own SVG; preserve
  `VB_BATCH=<jobId>:<index>` tagging/resolve and per-item hide-original. 1 selected = 1-item batch.
  "Whole selection as one image" is deferred.
- **Document safety:** auto/batch placement enforces source-document check (`docChanged` guard).
  **History/manual Place** passes `allowAnyDoc:true` (no doc identity), `hideOriginal:false`, and fits
  to the active artboard when union is missing — must work on any open document.
- **SVG import (AI 2026):** `vector-effect="non-scaling-stroke"` breaks `placedItems.add()+embed()`
  (error 129); `place.jsx` uses `groupItems.createFromFile(File|path)` primary, fallbacks as needed.
- **Agent/daemon:** warm daemon = single browser on `vectorizer-profile` (exclusive lock), independent
  reusable pages, workers clamped 1–4 (default 1). `/run` async-ack `202 {accepted,viaDaemon}` when a
  slot is free, `503` when saturated; `run.js` waits/polls per-job status file then falls back to
  one-shot only when the daemon is unreachable. Stop daemon-served runs via daemon stop or by removing
  `agent-daemon.json` (never `taskkill` the daemon PID blindly). Never delete `agent-daemon.json` on a
  single unanswered `/health` probe — the daemon writes it before Chrome serves.
- **Status/launch:** per-job status files `agent-status-<runToken>-<index>.json`; pre-launch `starting`;
  stale-launch takeover bounded; panel relaunches a stale no-pid `starting` once and enforces stuck
  bounds (`launching`/`starting`). Windows launcher via hidden VBS/cmd.
- **Keyboard shortcut:** `state.settings.vectorizeShortcut` (`{ctrl,shift,alt,key,code,label}`), default
  `Ctrl+Shift+Ç`, persisted in `localSettings`. Panel must have focus; a CEP limitation, not a global
  hotkey. Registered via `CSInterface.registerKeyEventsInterest`; emits `shortcut:changed`.
- **Parallel safety:** `Browser.setDownloadBehavior` is browser-global — **do not use it**;
  `vectorizer/job.js` captures via per-page CDP `Fetch` interception only. Prefer `batchWorkers=1-2`
  on Windows.
- **Installer/updater safety:** updates are user-triggered only, HTTPS with a host allowlist, SHA-256
  digest required, staged validation before the install is touched, backup + rollback, never applied
  at startup. Keep it that way. `ExtensionBundleVersion` must match `n[.n[.n[.n]]]` — a `-test`
  suffix makes CEP discard the whole manifest and the panel vanishes.
- **Panel ids and locale keys are a contract:** `tools/verify-host.cjs` asserts every `getElementById`
  used by `js/panel.js` exists in `index.html`, and that both `js/locales/en.js` and `pt.js` define
  every key. Current baseline: 35 element ids, 31 `data-i18n` keys, 109 keys per locale.

## ExtendScript constraints

ES3: no `JSON` (use `host/json.jsx`/`VB.toJSON`/`VB.fromJSON`), no `let/const`, no arrow functions,
no modern array/object helpers, no `trim()` assumptions. Always return safe JSON strings to the panel.
Panel-side JS is **not** ES3-limited (it runs in the CEP Chromium); do not confuse the two.

## Documentation set

| File | Read it when | Notes |
|---|---|---|
| `AGENTS.md` (this file) | Always, first | Canonical project rules |
| `DESIGN.md` | Any UI, CSS, copy or layout work; any pen.dev handoff | Tokens, CEP constraints, Design ↔ Code Sync table |
| `SKILLS.md` | Choosing a specialist skill/component source | Honest inventory: installed vs selected-but-absent |
| `HANDOFF.md` | Resuming work, or before pausing/substantial handoff | Factual checkpoint; verify it against Git |
| `CHANGELOG.md` | Cutting a release | Release notes per version |
| `ARCHITECTURE.md` | Deeper layer/interfaces reference | **Version header is stale (v2.2.0)** — trust this file |
| `UPDATE.md`, `INSTALL.md` | Installer/updater work | User-facing |
| `RELEASE_PROMPT.md` | **Never as a task** | Historical release runbook, explicitly stale |

Documentation is not the source of truth for code. `git status`, `git diff` and the files themselves win.

## Workflow (Fast / Full)

Two routes, chosen by risk and impact — **not** by line count.

| Intent | Route |
|---|---|
| Small isolated UI/copy/style fix | **Fast:** inspect the affected code → reuse or fix → focused verification → 2-line report |
| New feature, new screen, shared CSS/token change, installer/agent/host change | **Full:** understand intent → check existing code and component sources → implement → one focused polish pass (UI) → verify → report/handoff |
| Planning, review, comparison, research | **Planning only** — do not edit code |
| Resume after an agent switch | Read `AGENTS.md` → `HANDOFF.md` → verify actual Git state and files → continue |

Mandatory baseline on every task, Fast included: read the affected code and this file first; assess
blast radius (shared CSS, host/agent contracts, installer, updater are high impact even for tiny
diffs); preserve existing behaviour, accessibility, both locales and integrations; run the checks the
impact justifies; report exactly what was and was not verified. Never skip verification because a task
"looks small". Ordinary in-scope reversible changes need no approval; production data writes,
publishing, destructive edits, new frameworks/dependencies and paid services do.

## Quality assurance (Basic / Extended / Critical)

| Level | Typical work | Required verification |
|---|---|---|
| **1 — Basic** | Isolated panel CSS/copy/spacing edit | Inspect code + Git state; `node --check` on touched JS; `node ../tools/verify-host.cjs`; reload the panel |
| **2 — Extended** | Shared tokens/styles, new control, batch/queue or history UI, significant panel redesign | Level 1 + regression on affected states (idle/running/error/signed-out), keyboard/focus, both locales, panel widths 240/320/460 px, one bounded polish pass |
| **3 — Critical** | `host/*.jsx` changes, `agent/*` changes, installer/updater, placement or batch semantics | Level 2 + contract review, failure/recovery paths, host test in real Illustrator where available, an independent second-agent review for large changes |

Report completion honestly, using these words: **Verified** (required feasible checks passed),
**Partially verified** (implementation done, some checks could not run — name them), **Blocked/Failed**.
A browser preview is never proof that the CEP panel works in Illustrator; `host/*.jsx` changes need a
full Illustrator restart or full extension reload before they are verified.

## Development, verification and sync

Run commands from the repository root (`vector_illust/VectorizerBridge`).

```bash
node --check js/core/app.js          # any touched panel/agent JS
node ../tools/verify-host.cjs        # 22 offline checks: JSON layer, export/import,
                                     # core+batch host scripts, panel wiring. No Illustrator
                                     # and no user documents touched. All 22 pass at 2.3.3.
```

The harness lives in the workspace shell (`../tools/`), **outside this Git repository**, so a fresh
clone does not contain it. `..` is inside a parent project whose `package.json` declares
`"type": "module"`, so anything under it is treated as ESM — the harness must stay `.cjs`.
`.js` twins of the harness will fail with `require is not defined`; do not recreate them.

Sync to the installed panel after every change (mirror paths exactly):

```powershell
$src = "C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge"
$dst = "$env:APPDATA\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge"
Copy-Item "$src\js\*" "$dst\js\" -Recurse -Force      # panel JS
Copy-Item "$src\host\*.jsx" "$dst\host\" -Force       # host (needs Illustrator restart)
```

Then verify parity for the files you touched (`cmp -s` / `Get-FileHash`) rather than assuming.

Reload rules: **panel HTML/JS** reload on panel reopen; **`host/*.jsx`** require a full Illustrator
quit/reopen or a full extension reload (ExtendScript cache); **`agent/*`** require stopping/restarting
the warm daemon; **shortcut changes** take effect on panel reload.

Not runnable here without the live app: a real Illustrator session, a signed-in vectorizer.ai run, a
warm-daemon start, and the update download. Say so instead of implying they passed.

## Settings (shortcut)

`vectorizeShortcut`: object `{ctrl, shift, alt, key, code, label}`; default
`{ctrl: true, shift: true, alt: false, key: 'Ç', code: 'KeyC', label: 'Ctrl+Shift+Ç'}`. The user can
Set/Reset it in the Settings panel. Emits `shortcut:changed`; the panel re-registers key events interest.

## Packaging / distribution

- **Do not package/distribute:** `agent/node_modules/`, `agent-downloads/`, status/daemon/log/debug/
  profile/backup artifacts, temp zips/logs. `.gitignore` enforces this.
- Consumers run `npm install --omit=dev` in `agent/` when dependencies are missing; `install.ps1`
  does it for them.
- Manifest version: `CSXS/manifest.xml` (bundle + panel). Update `CHANGELOG.md` for releases.

## When to consult Notion and pen.dev

**Notion** is durable knowledge, not code. Consult it only for decisions, background and the approved
policy behind these files:

- Research & decisions: https://app.notion.com/p/414b6705ae1f81cb8188f72828318549
- Canonical Markdown templates v3.0: https://app.notion.com/p/415b6705ae1f81249d2ef071cb6022e7
- Implementation Hub (deferred backlog): https://app.notion.com/p/415b6705ae1f81ba88dbdfbfbe9ab7c3

A URL is not access. Notion MCP is currently configured only for the unrelated parent workspace
(`..\..\opencode.json`, which belongs to `BestOfGifts_Master`), so most agents here cannot read Notion — report that limitation and proceed from
this repository instead. Only the Freebuff chat session has verified Notion access. Never write to
Notion without being asked.

**pen.dev** is the canvas-first environment for deep visual design, editable layouts and design-to-code.
Consult it (or the `.pen` file) when the task is a redesign, a new screen, or a question about intended
visual behaviour that `DESIGN.md` does not answer. Design intent lives in
`..\design\VectorizerBridge-UI.pen`; `DESIGN.md` holds the Design ↔ Code Sync table that maps frames to
files. Rules: pen.dev works on the **same working tree** — never create a parallel copy of the panel;
do not treat a `.pen` frame as implemented code; do not migrate the panel to React/JSX/Tailwind because
a design uses shadcn-style components (translate to native HTML/CSS/JS). Update the sync table and
`HANDOFF.md` when a design→code or code→design handoff happens.

## Known risks / deferred

- `stuck: starting` under parallel load on Windows (launcher/spawn): mitigated by serialized agent
  launches, warm-daemon sizing, single stale relaunch. Use `workers=1` when diagnosing.
- "Whole selection as one image" batch mode deferred.
- The vectorizer.ai DOM-selector flow (`#FileInput-Field`, `.App-downloadLink`,
  `button.export_download_button`) is the most fragile part of the product; a site redesign breaks it.
- `VB._batch` job state is module-global in `host/batch.jsx`; overlapping batches remain a known risk.
- Untracked `..\design\` and `..\tools\` (see `HANDOFF.md`) — a `git clean` there would delete the only
  design file and the only regression harness.
- UI/UX redesign is the active focus; behaviour stays frozen for it.

## Open decisions (do not resolve unilaterally)

1. **Freeze scope.** Historical docs say "frozen for UI/UX only", but installer, updater and
   parallel-batch work shipped after that date with explicit approval. Current interpretation:
   *no unrequested behaviour changes*. Confirm if the intent is different.
2. **Versioning the `.pen` and harness.** They sit outside this repository. Committing them (large
   JSON design file + `.cjs` tools) or archiving them elsewhere needs a user decision.
3. **Document consolidation.** `ARCHITECTURE_PLAN.md`, `PROJECT_STATE_2026-11-06.md`,
   `PROJECT_STATE_2026-11-10.md` and `CHANGES_2026-11-06.md` overlap and carry stale versions.
   Archive rather than delete, once the user agrees.

## Quick file map

- Panel: `index.html`, `css/style.css` (261 lines, `:root` tokens), `js/{csinterface,panel}.js`,
  `js/core/app.js`, `js/bridge/host.js`, `js/queue/batch.js`, `modules/vectorizer/vectorizer.js`,
  `js/locales/{en,pt}.js`
- Host: `host/{json,core,batch,export,place,agent,common,import}.jsx`
- Agent: `agent/{run,login,update,lib,job,daemon,daemon-ctl}.js`,
  `agent/{core/lib.js,vectorizer/job.js,daemon/server.js,daemon/ctl.js}`, `agent/package.json`
- Install: `install.ps1`, `install-online.ps1`, `uninstall.ps1`
- Docs: `AGENTS.md`, `DESIGN.md`, `SKILLS.md`, `HANDOFF.md`, `README.md`, `ARCHITECTURE.md`,
  `CHANGELOG.md`, `INSTALL.md`, `UPDATE.md`
