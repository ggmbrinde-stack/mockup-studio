# Project Handoff — Mockup Studio

Updated: **2026-11-23**
Project: **Mockup Studio** — Adobe Illustrator CEP panel (`com.bestofgifts.vectorizerbridge`), v2.5.0
Last agent: Code (verification + doc refresh)
Repository/location: `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge`
Remote: `https://github.com/ggmbrinde-stack/mockup-studio.git`
Branch: `main` (in sync with `origin/main`)
HEAD: `396b380 feat: v2.4.0 what's-new card + v2.5.0 AI image editor (Gemini in Chrome)`

## Current task

v2.4.0 (What's-new card + feature tour) and v2.5.0 (AI image editor, Gemini in Chrome) are committed
and pushed (`396b380`). All verification harnesses pass (`node tools/verify-all.cjs` → 7/7). Docs
refreshed to 2.5.0. Next: real Illustrator test of the AI image flow and the What's-new tour.

## Decisions to preserve

- This repository is the single source of truth for code. The workspace shell `..\` (`design\`,
  `tools\`, legacy `HANDOFF.md`, release zips) is **outside Git** — see "Blockers".
- Behaviour stays frozen for the UI/UX phase: no unrequested behaviour changes; release/installer work
  needs explicit approval. `AGENTS.md` states this interpretation explicitly.
- The panel is vanilla HTML/CSS/JS inside CEP. No React, no JSX, no Tailwind, no build step — a pen.dev
  design that uses shadcn-style components must be translated to native code.
- `AGENTS.md` holds project rules; `DESIGN.md` holds visual standards and the Design ↔ Code Sync table;
  `SKILLS.md` holds the honest capability inventory; this file holds state.
- Notion is durable knowledge only. Notion MCP is configured for the unrelated parent Magento
  workspace, **not** for this one, so most agents cannot read Notion here.

## Completed and verified

v2.4.0 + v2.5.0 (committed `396b380`):
- What's-new card + feature tour (`js/whats-new.js`, `modules/tour/`, `tools/verify-tour.cjs`).
- AI image editor, Gemini in Chrome (`host/ai.jsx`, `modules/ai-image/`, `tools/verify-ai-image.cjs`).
  Uses the user's own Chrome + Google AI Plus; no API key, no billing. Nothing automated in the browser.
- `VB.exportSelection` takes an optional output path; `agent/daemon.js` wrapper calls `main()`;
  `server.js` exports `main` and self-runs only when it is the script.
- Verification: `node tools/verify-all.cjs` → 7/7 suites pass (panel wiring, agent helpers, export
  options, gemini in chrome, whats-new/tour, dead CSS, js syntax on 26 files).

Prior (2.3.x): modularization, floating window, warm daemon, batch/placement fixes, installer/uninstaller,
design tokens, fluid panel, first-run setup, parallel-batch fixes, oversized-artwork pixel budget.

## In progress / not verified

- **AI image flow not tested in a live Illustrator session** — host `ai.jsx` changes need a full
  Illustrator quit/reopen; the Gemini-in-Chrome round trip (Use selection → Open Gemini → download to
  `gemini/results` → auto-place on `Gemini Image` layer) has not been run end-to-end.
- **What's-new card + tour not visually confirmed** in the panel.
- **Installed CEP parity** for the new files (`host/ai.jsx`, `modules/ai-image/`, `js/whats-new.js`,
  `modules/tour/`, locales, `index.html`, `css`) not re-verified after the 2.5.0 commit.
- Nothing is implemented in pen.dev. No `.pen` frame has been reconciled with the 2.5.0 panel.
- `..\design\` and `..\tools\` remain untracked and undefended by `.gitignore`; a `git clean` in the
  parent workspace would delete the only design file and the only regression harness.

## Changed files

Committed `396b380` (v2.4.0 + v2.5.0):
- New: `host/ai.jsx`, `js/whats-new.js`, `modules/ai-image/ai-image.js`, `modules/tour/tour.js`,
  `tools/verify-ai-image.cjs`, `tools/verify-tour.cjs`, `GEMINI_UPSCALE_RESEARCH_2026-11-16.md`.
- Modified: `AGENTS.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `CSXS/manifest.xml`, `agent/daemon.js`,
  `agent/daemon/server.js`, `css/style.css`, `host/export.jsx`, `index.html`, `js/bridge/host.js`,
  `js/core/app.js`, `js/locales/en.js`, `js/locales/pt.js`, `js/panel.js`, `modules/setup/setup.js`,
  `tools/verify-all.cjs`.

Uncommitted (this session): `ARCHITECTURE.md` + `HANDOFF.md` refreshed to 2.5.0.

## Tests / checks

- QA level: **Extended** (v2.4.0 + v2.5.0 feature commit + doc refresh).
- Completion status: **Verified** for the offline harnesses; **Partially verified** for the AI image
  flow and tour (not run in a live Illustrator session).
- Passed: `node tools/verify-all.cjs` → **7/7 suites, exit 0** (panel wiring, agent helpers, export
  options, gemini in chrome, whats-new/tour, dead CSS, js syntax on 26 files).
- Not run: a real Illustrator session, the Gemini-in-Chrome round trip, the What's-new tour in the panel,
  a signed-in vectorizer.ai run, warm-daemon start, updater download.
- Visual/host-app check: **not run** — no UI was changed in the verification pass.

## Blockers

- **Untracked assets:** `..\design\VectorizerBridge-UI.pen` (547 KB), `..\design\NOTES-ui-redesign.md`,
  `..\tools\*.cjs`. Versioning them (or choosing an archive location) needs a user decision.
- **AI image flow untested in Illustrator:** host `ai.jsx` needs a full Illustrator quit/reopen; the
  Gemini-in-Chrome round trip has not been exercised end-to-end.
- **Installed CEP parity** for the 2.5.0 files not re-verified after the commit.
- **Doc drift elsewhere:** `ARCHITECTURE.md` (now 2.5.0), `PROJECT_STATE_2026-11-06.md`,
  `PROJECT_STATE_2026-11-10.md`, `ARCHITECTURE_PLAN.md`, `CHANGES_2026-11-06.md` still carry old versions.
- **Notion access is agent-dependent:** only the Freebuff chat can read the workspace pages.

## Next recommended environment

**Chat (code), then Illustrator.** The next piece of real value is testing the AI image flow and the
What's-new tour in a live Illustrator session, then confirming installed CEP parity.

## Next action

1. Full quit/reopen Illustrator (host `ai.jsx` cache reset), open panel → AI image editor.
2. Use selection → Open Gemini in Chrome → generate → download to `gemini/results` → confirm auto-place
   on `Gemini Image` layer. Test What's-new card + tour.
3. Verify installed CEP parity for the 2.5.0 files (`Get-FileHash` vs source).

## Resume protocol

Read `AGENTS.md`, then this file, then `DESIGN.md` if the work is visual. Verify the claims against
`git status`, `git log -1`, the installed CEP copy and `node ../tools/verify-host.cjs` before trusting
them. If a prior agent ended without writing a handoff, reconstruct state from files and Git — never
invent progress. Do not commit, push, publish or overwrite uncommitted work without approval.
