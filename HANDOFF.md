# Project Handoff — Mockup Studio

Updated: **2026-11-24**
Project: **Mockup Studio** — Adobe Illustrator CEP panel (`com.bestofgifts.vectorizerbridge`), v3.0.0
Last agent: Code (3.0.0 release + updater verification)
Repository/location: `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge`
Remote: `https://github.com/ggmbrinde-stack/mockup-studio.git`
Branch: `main` (in sync with `origin/main`)
HEAD: `40f5185 chore(release): 3.0.0 for the React panel`

## Current task

**3.0.0 is shipped.** The panel UI is now the React/Vite app in `modern-ui/`, built to repo-root
`dist/`, and `CSXS/manifest.xml` loads `./dist/index.html`. The release is published on GitHub
(`3.0.0`, asset `mockup-studio-3.0.0.zip`, 294,055 bytes, digest `sha256:fde8e331…`) and an existing
2.5.0 install was proven to update from it and restore back.

## Decisions to preserve

- This repository is the single source of truth for code. The workspace shell `..\` (`design\`,
  `tools\`, legacy `HANDOFF.md`, release zips) is **outside Git** — see "Blockers".
- Behaviour stays frozen for the UI/UX phase: no unrequested behaviour changes; release/installer work
  needs explicit approval. `AGENTS.md` states this interpretation explicitly.
- The panel is React 19 + Vite + Tailwind with Radix/shadcn-style primitives in `modern-ui/`. Build
  output goes to repo-root `dist/` and is committed — `MainPath`, the updater and both installers all
  depend on `dist/index.html` existing.
- `window.VBPanel.{core,bridge,queue,vectorizer}` are re-implemented in TypeScript
  (`context/core-context.tsx`, `hooks/use-host.ts`, `hooks/use-batch.ts`, `hooks/use-vectorizer.ts`)
  and must keep those global names: host scripts, the flyout menu and shortcut registration use them.
- `AGENTS.md` holds project rules; `DESIGN.md` holds visual standards; `SKILLS.md` the capability
  inventory; `ARCHITECTURE.md` the layer reference; this file holds state.

## Completed and verified

3.0.0 (commits `ecb34f8` → `403bca3` → `40f5185`, pushed to `origin/main`):
- React panel replaces the native UI; legacy `index.html`/`js/`/`modules/` stay in the tree but are
  not loaded.
- Version 3.0.0 across `CSXS/manifest.xml` (bundle + both extensions), `CHANGELOG.md`, `README.md`,
  `AGENTS.md`, `UPDATE.md`, `modern-ui/package.json` + lock.
- Release plumbing: `dist/index.html` added to `REQUIRED_FILES` (`agent/update.js`), `install.ps1` and
  `install-online.ps1`; `install.ps1` no longer copies `native-panel-backup*`.
- Updater proven offline: 2.5.0 install → apply 3.0.0 → status `done`, backup `2.5.0-<stamp>`,
  real `dist/` in place → restore → 2.5.0 with the old `dist` byte-identical, status `restored`.
  Guards also pass: archive without `dist/index.html` is rejected before the install is touched; a
  restore with no backup reports `No previous version is backed up yet.`
- Updater proven from GitHub: sandbox 2.5.0 → `check` → `available 3.0.0` with release notes → `apply`
  (real download, digest verified) → 3.0.0 → `restore` → 2.5.0.
- Installed CEP copy synced: manifest 3.0.0, `dist` bundle `index-Bi7AhOc8.js`, `agent/update.js`
  with `dist/index.html`.

Prior (2.4.0–2.5.0, `396b380`): What's-new card + tour, AI image editor (Gemini in Chrome), warm
daemon, modularized host/agent. Prior (2.3.x): batch/placement fixes, installers, design tokens.

## In progress / not verified

- **Panel-side "Restore previous version" button not re-verified.** Illustrator was running but CEP
  debug ports 8088/8089/8090 were down, so `VB.updateBackups()` could not be evaluated. The restore
  path itself is verified through `agent/update.js --action restore`.
- **3.0.0 panel not visually reviewed** in a live Illustrator session (idle/running/error/signed-out,
  panel widths 240/320/460 px, floating `?view=window` layout). The bundle builds and was exercised
  through CDP for the custom-PNG-size fix, not as a full visual pass.
- **AI image flow** (Use selection → Gemini → auto-place) still has no end-to-end Illustrator run.
- **Doc drift fixed 2026-11-24:** the five superseded files (`PROJECT_STATE_2026-11-06.md`,
  `PROJECT_STATE_2026-11-10.md`, `ARCHITECTURE_PLAN.md`, `CHANGES_2026-11-06.md`, `RELEASE_PROMPT.md`)
  moved to `docs/archive/` with banners and an index; nothing in the working set describes the native
  panel any more.

## Changed files

Committed `40f5185` (3.0.0 bump): `CSXS/manifest.xml`, `CHANGELOG.md`, `README.md`, `AGENTS.md`,
`UPDATE.md`, `modern-ui/package.json`, `modern-ui/package-lock.json`.

Committed `403bca3` (release prep): `agent/update.js`, `install.ps1`, `install-online.ps1`,
`UPDATE.md`, `CHANGELOG.md`, `dist/` (built output).

Committed `ecb34f8` (React panel, 69 files): `modern-ui/` (new app), `dist/` build, manifest
`MainPath`, `host/watch.jsx`, `js/admin-config.js`, `js/whats-new.js`.

Uncommitted (this session): `ARCHITECTURE.md` + `HANDOFF.md` refreshed to 3.0.0. Untracked and
deliberately uncommitted: `native-panel-backup-20261123/`.

## Tests / checks

- QA level: **Critical** (manifest/build/installer/updater).
- Completion status: **Verified** for build, updater apply/restore (offline and from GitHub), staged
  validation guards and the installed-copy sync; **Partially verified** for the panel itself (no live
  Illustrator visual pass, in-panel restore button not evaluated).
- Passed: `npm --prefix modern-ui run build` (exit 0), `node ../tools/verify-host.cjs` (all checks),
  `node --check agent/update.js`, `npx oxlint` (31 warnings, 0 errors).
- Not run: live Illustrator panel review, AI image round trip, signed-in vectorizer.ai run, warm-daemon
  start, in-panel restore click.

## Blockers

- **Untracked assets:** `..\design\VectorizerBridge-UI.pen`, `..\design\NOTES-ui-redesign.md`,
  `..\tools\*.cjs`. Versioning them needs a user decision.
- **CEP debug port unavailable** while Illustrator runs, so panel state cannot be inspected from here;
  a full Illustrator restart is needed to load 3.0.0 anyway.
- **Notion access is agent-dependent:** only the Freebuff chat can read the workspace pages.

## Next recommended environment

**Illustrator**, after a full quit/reopen so CEP loads 3.0.0.

## Next action

1. Restart Illustrator, open the panel, confirm the React UI renders and the version footer reads 3.0.0.
2. Create one backup (apply an update, or copy a backup folder), then confirm **Restore previous
   version** appears in *Updates* and works from the panel.
3. Visual pass at 240/320/460 px and in the floating window; then the AI image round trip.

## Resume protocol

Read `AGENTS.md`, then this file, then `ARCHITECTURE.md` for layers. Verify the claims against
`git status`, `git log -1`, the installed CEP copy and a build/`node ../tools/verify-host.cjs` before
trusting them. If a prior agent ended without writing a handoff, reconstruct state from files and Git
— never invent progress. Do not commit, push, publish or overwrite uncommitted work without approval.
