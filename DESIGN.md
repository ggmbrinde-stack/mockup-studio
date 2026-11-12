# Mockup Studio — UI/UX and Design Guide

Read this with `AGENTS.md`. It covers the CEP panel only (`index.html`, `css/style.css`, `js/**`,
`modules/**`); Illustrator host scripts and the Node agent are out of scope here.

## Design goal

A small, dense, quiet tool that gets an illustrator from "selection" to "editable SVG" with as little
UI as possible. Priorities, in order: clarity of the current state, speed to the primary action,
predictability, accessibility. No decorative animation, no redesign of unrelated screens, no new
dependencies for visual effect. The panel is docked, resized and frequently used at 240–460 px wide —
every decision must survive that.

## What exists today (verified at 2.3.3)

- **Runtime:** vanilla HTML/CSS/ES5-style JS inside the CEP Chromium (CEP 9+, Illustrator 2025/2026+,
  Windows). **No framework, no bundler, no build step, no CDN, no web fonts, no external assets.**
- **Files:** `index.html` (118 lines, single column, `<details>` sections), `css/style.css`
  (261 lines), `js/core/app.js` (state, i18n, status/log), `modules/vectorizer/vectorizer.js` (flow UI).
- **Layout:** `.app` is the only scrolling column (`overflow-y:auto`, `overscroll-behavior:contain`);
  `html, body` are `overflow:hidden`. The three content panels (History, Log, Updates) plus Settings are
  `<details>`; open panels absorb spare height with their own internal scroll
  (`min-height: clamp(64px, 11vh, 150px)`), closed ones collapse to a ~30 px summary.
- **Breakpoints:** single column below 360 px, two columns from 360 px, roomier from 560 px, two-column
  grid from 820 px, compact spacing at `max-height: 520px` / `720px`.
- **Fonts:** `"Segoe UI"` for UI text, `Consolas` for the log. Sizes via `--fs`
  (`clamp(12px, 2.9vw, 13px)`), hints 11.5 px, log 11 px.

## Design tokens (`css/style.css` `:root`)

Single source of truth for colour. Use the variables, never raw hex in new rules.

| Token | Value | Note in file |
|---|---|---|
| `--bg` | `#fafafa` | panel background |
| `--surface` | `#ffffff` | cards, buttons, inputs |
| `--fg` | `#262626` | primary text |
| `--muted` | `#5f5f5f` | 6.1:1 on `--bg` |
| `--muted-2` | `#6b6b6b` | 5.1:1 on `--bg` |
| `--border` | `#cfcfcf` | |
| `--border-soft` | `#e8e8e8` | |
| `--accent` | `#0b57d0` | 6.1:1 on `--bg`, 6.4:1 under white text |
| `--accent-hover` | `#0842a0` | |
| `--success` | `#1b5e20` | |
| `--danger` | `#c62828` | errors only — never for the title |
| `--focus` | `#0b57d0` | `:focus-visible` ring |
| `--radius`, `--pad`, `--pad-sm`, `--gap`, `--fs` | `clamp()`-based | density scales with panel size |

Rules that follow from this: red means failure only; success/error is never the only cue (history rows
carry `✓`/`✕`); minimum control height 26 px (24 px for `.btn.small`); every interactive element has a
visible `:focus-visible` ring; text wraps with `overflow-wrap: anywhere` (never `word-break: break-all`).

## Light/dark theme behaviour

- **Current state:** one light token set. There is **no** `data-theme` / dark token block in
  `css/style.css` today. Do not document or claim a dark mode that does not exist.
- **Intended direction** (researched in `UI_UX_RESEARCH_2026-11-11.md`, not implemented): derive
  light/dark from `new CSInterface().getHostEnvironment().appSkinInfo` — use it only as a *signal*
  (`panelBackgroundColor.color.red > 128`), never as paint, because CEP reports approximate colours.
  Listen for `CSInterface.THEME_COLOR_CHANGED_EVENT`. Default must remain the light palette so a
  failure is a no-op.
- **Do not** use `prefers-color-scheme`: CEP does not track the OS theme; Illustrator's own UI
  brightness is the correct signal.
- The pen.dev design uses a different token vocabulary (`panel-bg`, `surface`, `border`,
  `text-primary`, with light *and* dark values). Treat those as design intent, not as shipped CSS.

## HTML/CSS/vanilla JavaScript requirements

1. **Vanilla only.** No React, no JSX, no Tailwind, no CSS framework, no bundler, no `npm` dependency in
   the panel. If a design or a component source is React-based, translate only the needed markup,
   styling and interaction into native code.
2. **Stable contract:** every existing element id stays. `js/panel.js` and the harness reference them.
   Locale keys stay symmetric: any new key goes into **both** `js/locales/en.js` and `pt.js`, and any
   `data-i18n` attribute needs a matching key, or the raw key shows in the UI.
3. **No inline styles** unless the value is genuinely dynamic; put it in `style.css`.
4. **Never introduce** continuous CSS animations (the CEP compositor is fragile), modal `alert()`/
   `confirm()` for routine messages, or any startup network call.
5. **Panel JS is not ES3.** The ES3 constraint applies to `host/*.jsx` only.
6. Keep assets local. The panel must work offline — no CDNs, no icon fonts, no remote images.

## Component reuse

Existing local patterns first, always:

1. **Reuse what the panel already has** — `.btn`, `.btn.primary`, `.btn.small`, `.status`,
   `.statusDetail`, `.hint`, `.list`, `.log`, `.history-item.ok/.bad`, `<details>/<summary>` sections.
   A new control should look like these unless there is a reason not to.
2. **Then shadcn/ui as a source of structure and behaviour** (states, focus handling, spacing rhythm),
   read as a reference — never pasted as code.
3. Then Kibo UI / Origin UI for functional components, then reviewed shadcn registries. Magic UI only
   for a justified, restrained effect.
4. Specialist component choice → Pick UI Library, explicitly, and only if it is actually installed
   (see `SKILLS.md` — it is not installed today).
5. Keep a native adaptation in the project, note its source and the compatibility limits, and **do not
   build a parallel component library** or a shared registry without repeated demonstrated need.

For a ~12-control docked panel, hand-written CSS on the existing tokens beats any library.

## Keyboard, focus, accessibility, localization

- Tab reaches every control; `:focus-visible` is visible on buttons, summaries, inputs and selects;
  Enter/Space activate; Escape leaves shortcut capture.
- The status line is `role="status" aria-live="polite"` — keep it. Use `role="alert"` only for hard
  errors, and set `aria-busy` while a run is active.
- Contrast: body text ≥ 4.5:1, target 5:1+ on `--bg`; check any new colour against `--bg` and
  `--surface` before shipping.
- Status must not rely on colour alone; pair with text or a glyph.
- Long lists scroll inside their own region (`overscroll-behavior: contain`), never push the footer away.
- **Bilingual by default:** every user-visible string goes through `t()` / `data-i18n`. Portuguese
  (`pt.js`) is clean UTF-8 — keep it that way; a mojibake regression has happened before.
- Copy says what happens: "Show in folder", not "Open", when the action reveals a file in Explorer.

## Visual polish and QA

- **Substantial UI work gets exactly one focused polish pass**, inside the requested scope: hierarchy,
  spacing, alignment, typography, token use, states (hover/active/disabled/loading/empty/error),
  keyboard and focus, both locales. Then stop. No endless iteration, no unrelated screens.
- Small fixes get a proportionate check instead of a critique.
- **Verification for UI work:** `node ../tools/verify-host.cjs` must stay green (it asserts ids, `t()`
  keys and `data-i18n` keys); `node --check` on touched JS; reload the panel; inspect at 240, 320 and
  460 px wide; check idle, running, error and signed-out states; Tab through the panel.
- **A browser preview is not proof.** This is a CEP panel inside Illustrator. Say "not verified in
  Illustrator" when you did not run it there. `host/*.jsx` changes need a full Illustrator restart.

## Design ↔ Code Sync

Design intent lives in the pen.dev document **outside this repository**:

- `.pen` file: `..\design\VectorizerBridge-UI.pen`
  (absolute: `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\design\VectorizerBridge-UI.pen`)
- Pen document format `2.22`, 28 top-level frames, ~1 234 nodes, own `themes.mode = [light, dark]`,
  variables (`panel-bg`, `surface`, `surface-alt`, `border`, `border-strong`, `text-primary`, …),
  and one import: `pencil:shadcn.lib.pen`.
- Notes: `..\design\NOTES-ui-redesign.md` (rest-state redesign rationale, dated against **v2.2.0**).

**Status of the whole document: design only.** No frame has been implemented 1:1, and none should be
marked as implemented until a frame-by-frame comparison against the shipped panel has actually been
done. The `.pen` file was last modified **2026-11-11 09:53**, while the released code reached
**2.3.3 at 17:15** — the canvas predates 2.3.2 and 2.3.3, so it cannot describe the current panel.

| `.pen` frame (canvas area) | Related application files | Design status | Implementation status | Last verified alignment | Next action |
|---|---|---|---|---|---|
| `Design Brief` | — | Reference text | N/A | — | None (read-only brief) |
| `00 - Current UI (full length)` | `index.html`, `css/style.css` | Captured as-is | **Unknown** — captured before 2.3.1–2.3.3 UI work | Not verified | Re-capture from the 2.3.3 panel after opening the workspace |
| `Screen 01 - Ready` / `Label 01 - Ready` | `index.html`, `css/style.css`, `js/core/app.js` | Explored | **Unknown** — 2.3.1 tokens/contrast/density resemble it | Not verified | Compare frame to shipped idle state |
| `Screen 02 - Selection ready` | `js/core/app.js`, `host/core.jsx` | Explored (needs `VB.selectionSummary()`) | **Not implemented** — host query not approved/added | — | Decide whether the read-only host query is in scope |
| `Screen 03 - Signed out` | `modules/vectorizer/vectorizer.js`, `js/locales/*` | Explored | **Not implemented** as a dedicated state | Not verified | Confirm current sign-in path, then decide |
| `Screen 04 - Single run` | `js/core/app.js`, `modules/vectorizer/vectorizer.js` | Explored | **Partial** — status/detail + cancel exist, not the morphing CTA | Not verified | Diff frame vs. shipped running state |
| `Screen 05 - Batch in progress` | `js/queue/batch.js`, `js/core/app.js` | Explored | **Partial** — text progress `Batch i/n`, no progress bar | Not verified | Decide on `<progress>`-style bar (additive) |
| `Screen 06 - Result placed` | `modules/vectorizer/vectorizer.js`, `host/place.jsx` | Explored | **Unknown** | Not verified | Compare history/result rows |
| `Screen 07 - Error` | `js/core/app.js`, `js/locales/*` | Explored | **Partial** — error colours + detail line, no inline recovery link | Not verified | Decide on the "Open log folder" affordance |
| `Screen 08 - History and log` | `index.html`, `js/core/app.js` | Explored | **Shipped differently** — two separate `<details>` (tabs in the design) | Not verified | Decide: tabs vs. current sections |
| `Screen 09 - Settings` | `index.html`, `css/style.css` | Explored | **Shipped differently** — accordion + responsive grid, no summary pill | Not verified | Compare and record gaps |
| `Screen 10 - Component playground` | `css/style.css` | Reference | N/A | — | None |
| `New Layout - Working Canvas`, `Screen 01/02/03-NEW` | `index.html`, `css/style.css` | In progress / unshipped | **Not implemented** | — | Pick one frame as the next implementation candidate |

Maintaining this table:

- Update a row **only** from evidence you actually looked at (code + a rendered panel or a real
  Illustrator check). "Not verified" is a valid and preferred value.
- When a frame becomes code, record the commit/version that implemented it and the exact files.
- When code changes the layout, say whether the canvas is now stale.
- Every design→code or code→design handoff gets an entry in `HANDOFF.md` too.
