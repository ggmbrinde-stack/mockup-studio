# Project Handoff — Mockup Studio

Updated: **2026-11-12**
Project: **Mockup Studio** — Adobe Illustrator CEP panel (`com.bestofgifts.vectorizerbridge`), v2.3.3
Last agent: Freebuff chat (Phase 1 read-only audit, then Phase 2 shared-foundation documentation)
Repository/location: `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge`
Remote: `https://github.com/ggmbrinde-stack/mockup-studio.git`
Branch: `main` (0 ahead / 0 behind `origin/main`)
Git status: clean at audited HEAD, then **three new docs and two doc edits, all uncommitted** (see below)
HEAD: `75eccda release: 2.3.3` (2026-11-11 17:15 UTC)

## Current task

Establish one shared documentation and instruction foundation that works for both chat coding agents
and pen.dev. Phase 2 created `DESIGN.md`, `SKILLS.md` and this handoff, and reconciled `AGENTS.md`.
**No application code, runtime configuration or design file was changed.**

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

Phase 1 (audit, read-only):

- Confirmed the real repository and its clean state; confirmed `vector_illust/` is untracked inside the
  unrelated parent repo `BestOfGifts_Master` and not ignored there.
- Confirmed source ↔ installed CEP parity: 12 sampled files byte-identical, manifest `2.3.3` in both.
- Inventoried agent instructions, MCP servers, skills and the pen.dev installation.
- Read the three Notion reference pages (research/decisions, canonical templates v3.0, implementation hub).

Phase 2 (documentation only):

- `AGENTS.md` rewritten from v2.2.0 to the actual 2.3.3 state, preserving every CEP/ExtendScript/
  daemon/batch/installer invariant, and extended with Fast/Full workflow, Basic/Extended/Critical QA,
  verified commands, and a Notion/pen.dev access section.
- `DESIGN.md` created from the approved template, grounded in the real tokens, breakpoints, ids and
  accessibility rules, and ending in the Design ↔ Code Sync table (all frames marked unverified).
- `SKILLS.md` created: nine entries split into not-installed / not-applicable, with Pen, Codex, Cursor,
  Notion and GitHub capabilities recorded honestly.
- `HANDOFF.md` (this file) created at the repository root.
- `RELEASE_PROMPT.md` given a visible stale banner; its content is unchanged.
- `../HANDOFF.md` (workspace shell) deliberately **not** touched.

## In progress / not verified

- Nothing is implemented in pen.dev. No `.pen` frame has been reconciled with the 2.3.3 panel.
- The `.pen` file predates the shipped UI (canvas 2026-11-11 09:53 vs release 17:15), so the design and
  the code have already diverged.
- `..\design\` and `..\tools\` remain untracked and undefended by `.gitignore`; a `git clean` in the
  parent workspace would delete the only design file and the only regression harness.

## Changed files

Uncommitted, documentation only:

| File | Change |
|---|---|
| `AGENTS.md` | Modified — version, freeze policy, workflow, QA levels, commands, doc references, open decisions |
| `DESIGN.md` | **New** — visual standards + Design ↔ Code Sync |
| `SKILLS.md` | **New** — approved tool belt + real availability |
| `HANDOFF.md` | **New** — this checkpoint |
| `RELEASE_PROMPT.md` | Modified — stale-warning banner only |

No file in `js/`, `modules/`, `host/`, `agent/`, `css/`, `CSXS/` or any `.ps1` installer was touched.

## Tests / checks

- QA level: **Basic** (documentation only; no runtime surface changed).
- Completion status: **Verified** for what was claimed; design/runtime alignment is **not verified**.
- Passed: `node ../tools/verify-host.cjs` → **22/22 checks, exit 0** (JSON layer, export/import against
  the fake Illustrator DOM, `host/core.jsx` + `host/batch.jsx` prepare/export/`docChanged`/resolve,
  panel ids, `t()` keys, `data-i18n` keys).
- Passed: path/link existence checks for every file referenced by the new docs; version strings in
  `AGENTS.md`/`HANDOFF.md` match `CSXS/manifest.xml` (`2.3.3`); `git status` in the parent Magento repo
  still shows only the pre-existing `?? vector_illust/`.
- Not run: any Illustrator host session, any signed-in vectorizer.ai run, warm-daemon start, updater
  download, MCP handshake, or pen.dev interaction.
- Visual/host-app check: **not run** — no UI was changed.
- No commit, push, release or configuration change was made.

## Blockers

- **Untracked assets:** `..\design\VectorizerBridge-UI.pen` (547 KB), `..\design\NOTES-ui-redesign.md`,
  `..\tools\*.cjs`. Versioning them (or choosing an archive location) needs a user decision — committing
  a 547 KB design file is a policy choice, not an obvious one.
- **Untrusted `.pen` ↔ code mapping:** nothing links frames to files yet except the new sync table,
  and every row is "not verified".
- **Notion access is agent-dependent:** only this Freebuff chat can read the workspace pages.
- **Doc drift elsewhere:** `ARCHITECTURE.md`, `README.md`, `PROJECT_STATE_2026-11-06.md`,
  `PROJECT_STATE_2026-11-10.md`, `ARCHITECTURE_PLAN.md`, `CHANGES_2026-11-06.md` still carry v2.2.0/2.3.0
  versions and overlapping content. Consolidation was deliberately not performed in Phase 2.

## Next recommended environment

**pen.dev first, then Chat.** The next piece of real value is reconciling the canvas with the shipped
panel; that is canvas work. Implementation of anything resulting from it belongs back in a chat agent.

## Next action

1. Open `C:\Users\user\Videos\BestOfGifts_Master\vector_illust` (not just the `.pen` file) as a pen.dev
   workspace, re-capture or relabel the frames against the running 2.3.3 panel, and fill in the
   Design ↔ Code Sync table in `DESIGN.md` with what you actually see.

## Resume protocol

Read `AGENTS.md`, then this file, then `DESIGN.md` if the work is visual. Verify the claims against
`git status`, `git log -1`, the installed CEP copy and `node ../tools/verify-host.cjs` before trusting
them. If a prior agent ended without writing a handoff, reconstruct state from files and Git — never
invent progress. Do not commit, push, publish or overwrite uncommitted work without approval.
