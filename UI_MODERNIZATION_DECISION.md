# UI Modernization Decision — Mockup Studio

**Date:** 2026-11-23
**Status:** **Implemented and shipped in 3.0.0 (2026-11-24)** — see the outcome note below. The decision
record and its constraints stay valid; the implementation details that changed are listed there.
**Scope:** Panel/UI layer only. Host (`host/*.jsx`) and agent (`agent/*`) stayed as-is; the manifest
changed only its `MainPath`.

## Outcome (2026-11-24) — shipped as 3.0.0

- **Built and released.** The panel is the React/Vite app in `modern-ui/`, built to repo-root `dist/`;
  `CSXS/manifest.xml` (both extensions) loads `./dist/index.html`. Delivered to existing installs
  through the self-updater; a 2.5.0 install was verified to update to 3.0.0 and restore back.
- **Deviations from the plan:**
  - React **19**, not 18.
  - No Bolt CEP tooling in the dependency tree — a plain Vite + TypeScript scaffold with a Bolt-style
    `cep.config.ts` kept for reference. Vite writes to `dist/` at the repository root, output is a
    single IIFE bundle loaded as `defer` (CEP cannot load ES modules).
  - The **manifest had to change**: `MainPath` is now `./dist/index.html`, so `dist/` must ship in the
    release archive and is checked by the updater and both installers.
  - i18n stayed a plain TS module pair (`modern-ui/src/locales/{en,pt}.ts`), not react-i18next.
  - Tailwind stayed pinned to **v3** as required.
- **Invariants that held:** `VB.*` host API and ES3 host untouched, per-item batch/`VB_BATCH`/doc guard,
  warm daemon, `ExtensionBundleId` and install path unchanged, shortcut and updater reimplemented with
  the same behaviour, offline operation (no CDNs).
- **Open decisions, resolved:** branch `feature/modern-ui` merged to `main` (not a separate repo);
  `:root` tokens carried over into the new CSS rather than Tailwind's shadcn palette; the offline
  harness (`tools/verify-host.cjs`) kept and still passing, not rewritten;
  `window.VBPanel.{core,bridge,queue,vectorizer}` kept as the contract surface.
- **Still open:** no live-Illustrator visual sign-off of the React panel yet, and the legacy native
  files (`index.html`, `js/`, `modules/`, `css/`) remain in the tree unloaded.

## Decision

Adopt **Bolt CEP + React + Tailwind v3 + shadcn/ui** for the panel layer.

| Layer | Choice | Notes |
|---|---|---|
| Boilerplate | Bolt CEP (Hyperbrew) | Vite + TypeScript + HMR, multi-panel, ZXP packaging, ExtendScript type safety |
| UI framework | React 18 | Required by shadcn/ui; largest ecosystem |
| Styling | Tailwind CSS **v3** (pinned) | v4 uses newer CSS (`@layer`, `@property`, `color-mix()`) that may break in CEP's Chromium 88. v3 generates plain CSS that works. |
| Components | shadcn/ui | Copy-paste, accessible, themeable via CSS variables |
| Build tool | Vite | Fast HMR, compiles to CEP-compatible output |
| ExtendScript | Keep existing `host/*.jsx` | ES3, unchanged; use Bolt's `evalTS()` for type-safe calls |

## Why

- **Modern, fluid UI** — Tailwind utilities + shadcn primitives give responsive layouts, consistent spacing, accessible components.
- **Fast iteration** — Vite HMR updates the panel live in Illustrator without manual reload.
- **Component reuse** — buttons, dialogs, selects, toasts, tabs, sheets — all accessible and themeable.
- **Type safety** — TypeScript end-to-end (panel + ExtendScript via `Types-for-Adobe`).
- **Future-proof** — when UXP arrives for Illustrator (expected ~2027), the React panel layer ports more easily; only the ExtendScript layer gets replaced by UXP API calls.

## Constraints & rules

1. **Tailwind v3 only.** Do not upgrade to v4 while targeting CEP 11 (Chromium 88).
2. **Host/agent layers stay untouched.** `host/*.jsx` (ES3), `agent/*` (Node), `CSXS/manifest.xml` — no changes. Only `index.html`, `css/`, `js/`, `modules/` get replaced by the React/Vite build output.
3. **Keep the same ExtensionBundleId** (`com.bestofgifts.vectorizerbridge`) and panel entry point so the installed CEP path stays the same.
4. **Preserve all invariants** — per-item batch, `VB_BATCH` tagging, doc guard, `groupItems.createFromFile`, warm daemon, ES3 host, shortcut, updater. The React layer talks to the host through the same `VBPanel.bridge` / `CSInterface` calls.
5. **Verification harnesses need updating** — `tools/verify-host.cjs` etc. assume the current flat file structure (`index.html` + `js/*.js`). They must be adapted to the new `src/` + build output structure, or new harnesses written.
6. **No external services/CDNs** — the panel must work offline inside Illustrator.

## What changes vs. what stays

| Area | Before (v2.5.0 vanilla) | After (Bolt CEP + React) |
|---|---|---|
| Panel HTML | `index.html` (hand-written) | React components in `src/` |
| CSS | `css/style.css` (261 lines, `:root` tokens) | Tailwind config + shadcn CSS variables |
| Panel JS | `js/*.js` (vanilla ES5-style) | `.tsx` components + hooks |
| Build step | None | `npm install`, `npm run dev`, `npm run build` |
| HMR | Manual panel reload | Vite HMR (live in Illustrator) |
| ExtendScript | `host/*.jsx` (ES3) | **Unchanged** |
| Agent | `agent/*` (Node) | **Unchanged** |
| Manifest | `CSXS/manifest.xml` | **Unchanged** |
| Updater/shortcut | Panel JS + host | Reimplemented in React, same behavior |
| Verification | `tools/verify-*.cjs` | Needs adaptation for new structure |

## Migration plan (high level)

1. **Scaffold Bolt CEP** on a new branch `feature/modern-ui` (do not touch `main`).
2. **Port the vectorizer module first** — same behavior, React + shadcn components. This is the highest-risk module; prove it works before porting others.
3. **Verify** — host/agent harnesses still pass; vectorizer flow works in Illustrator.
4. **Port remaining modules** — updater, shortcut, what's-new, AI image — to React/shadcn.
5. **Update verification harnesses** for the new structure.
6. **Merge** to `main` only after full verification in real Illustrator.
7. **Keep the vanilla version** as a fallback branch until the React version is proven stable.

## Risks

| Risk | Mitigation |
|---|---|
| Tailwind v4 breaks in CEP Chromium 88 | Pin Tailwind v3 |
| shadcn/ui components use newer CSS | shadcn/ui works with Tailwind v3; test each component in CEP |
| Bundle size grows (~150–200 KB) | Acceptable for CEP (local load, no network) |
| Verification harnesses break | Adapt harnesses or write new ones for the React structure |
| Regression in vectorizer flow | Port vectorizer first, verify before moving on; keep vanilla branch as fallback |
| Build step adds complexity for contributors | Document `npm install` / `npm run dev` in README/INSTALL |

## Open decisions (to resolve before/during implementation)

1. **Branch strategy** — new branch `feature/modern-ui` off `main`, or a separate repo?
2. **Tailwind config** — start from shadcn/ui defaults, or port the existing `:root` tokens (`--bg`, `--surface`, `--fg`, `--accent`, etc.) into Tailwind theme?
3. **Verification** — rewrite `tools/verify-*.cjs` for the new structure, or create new harnesses?
4. **shadcn/ui component scope** — which components to adopt (button, dialog, select, tabs, toast, sheet, etc.)?
5. **i18n** — keep the current `js/locales/en.js` / `pt.js` approach, or use a React i18n library (react-i18next)?

## References

- Bolt CEP: https://github.com/hyperbrew/bolt-cep
- Bolt CEP blog: https://hyperbrew.co/blog/bolt-cep-build-extensions-faster
- shadcn/ui: https://ui.shadcn.com
- Tailwind v3 docs: https://v3.tailwindcss.com
- CEP Cookbook: https://github.com/Adobe-CEP/CEP-Resources
- UXP for CEP devs: https://developer.adobe.com/uxp/migration-center/