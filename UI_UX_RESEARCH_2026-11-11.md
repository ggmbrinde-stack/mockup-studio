# UI/UX research — low-risk improvements for the Mockup Studio panel

Scope: the CEP panel (`index.html`, `css/style.css`, `js/core/app.js`, `modules/vectorizer/vectorizer.js`).
Goal: better usability **without** destabilising a panel that now works. Nothing here is implemented yet.

## 1. What the UI does well

- Clear primary action, and it is visibly disabled while a run is active.
- Status line plus a detail line, with elapsed-time feedback — good for a long-running operation.
- Real empty state for SVG history; failure colours exist for recent activity.
- Settings are grouped in a collapsible block; locale switch is discoverable.
- No external assets or CDNs — the panel works offline, which matters inside CEP.

## 2. Concrete issues found in the current code

| # | Finding | Where | Why it matters |
|---|---|---|---|
| 1 | `#888` version text (11 px) is **3.4:1** and `#aaa` attribution (10 px) is **2.2:1** on `#fafafa` | `css/style.css` `.version`, `.attribution` | Below WCAG AA 4.5:1; unreadable on dim displays |
| 2 | Status colour `#1a73e8` on `#fafafa` is **≈4.3:1** at 13 px semibold | `.status` | Just under AA; the most important text is the weakest-passing |
| 3 | Title is `#d00` (red) | `.title` | Red reads as "error"; the product name looks like a failure state |
| 4 | No `:focus`/`:focus-visible` styling anywhere | whole stylesheet | Keyboard users get the browser default (or nothing in CEP) |
| 5 | Hints are italic `#666` 11 px with `word-break: break-all` | `.hint` | Italic 11 px is hard to read; `break-all` splits words mid-word in narrow panels |
| 6 | Nested scrolling: `body {overflow-y:auto}` **and** `.panel {overflow-y:auto}` | `css/style.css` | Trackpad/wheel scrolling inside CEP feels stuck; the outer page also scrolls |
| 7 | Settings use a fixed 2-column grid | `.settingsGrid` | At a docked/narrow width the two columns squeeze inputs to unreadable widths |
| 8 | Summary has `list-style:none` and no replacement marker | `.settingsSummary` | No affordance that the section expands |
| 9 | `Recent activity` is hard-coded English | `index.html` | Breaks the PT locale; the harness already checks `data-i18n` keys |
| 10 | Dead markup: hidden second `<div class="panelTitle" data-i18n="history">` | `index.html` | Duplicate id-less title, confusing to maintain |
| 11 | Inline `style="display:flex;gap:6px…"` on the shortcut row | `index.html` | Inconsistent with the stylesheet; harder to theme |
| 12 | History entries communicate success/failure **by colour only** | `.history-item.ok/.bad` | Colour-blind users lose the distinction (WCAG 1.4.1) |
| 13 | "Open" in SVG history actually reveals the file in Explorer | `vectorizer.js` → `VB.revealFile` | Label promises an editor open, action reveals a folder |
| 14 | History refresh gives no feedback | `refreshSvgHistory()` | On a slow host the list just… doesn't change |
| 15 | No `aria-live` on status; no `aria-busy` while running | `index.html`, `app.js` | Screen readers never hear progress/failures |
| 16 | Update failures say "Update failed: No published update yet…" | `renderUpdate()` | A missing release is not a failure — it sounds broken |
| 17 | `.btn` ≈ 26 px tall, `.btn.small` ≈ 22 px | `css/style.css` | Below the comfortable 24 px target; dense rows feel cramped |
| 18 | The panel is hard-coded light while Illustrator can be dark | palette in `style.css` | Bright white panel next to dark Illustrator chrome; the biggest "unpolished" signal |

## 3. Recommended changes

### Tier 1 — CSS + copy only (no JS behaviour touched, lowest risk)

1. **Tokens first.** Replace the scattered hex values with CSS variables (`--bg`, `--fg`, `--muted`, `--border`, `--accent`, `--danger`, `--surface`) defined once on `:root`. Every later change then becomes one-line and reversible.
2. **Fix contrast.** `--muted: #5f5f5f` (≈5.7:1), accent `#0b57d0` (≈5.6:1), version `#5f5f5f`, attribution `#6b6b6b` at 11 px. Keep `#c62828` for errors (4.9:1) and add a darker green (`#1b5e20`, 7.4:1) for success.
3. **Stop using red for the title.** Neutral `--fg`; reserve red for failures. This alone makes the panel stop looking broken.
4. **Accessible focus.** `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` plus a visible `:hover`/`:active` for `.btn`; keep `disabled` at `opacity:.5` but ensure it is not the only cue.
5. **Typography/density.** 12 px labels, 11.5 px hints, `line-height:1.35`, no italics for hints, `overflow-wrap:anywhere` instead of `word-break:break-all`. Raise `.btn`/`.btn.small` to a 24 px min-height.
6. **One scroll container.** `html, body { overflow: hidden }`, `.app { height:100vh; overflow-y:auto }`, and let `.list`/`.log` keep their own scroll with `overscroll-behavior: contain`. This removes the "scroll gets stuck" feel.
7. **Responsive settings.** `@media (max-width: 340px) { .settingsGrid { grid-template-columns: 1fr } }`; make the primary button full width; let action rows wrap (already do).
8. **Details affordance.** Add a custom `▸`/`▾` marker via `::before` on `.settingsSummary`, rotate on `[open]`.
9. **Colour-independent status.** Prefix history rows with `✓`/`✕` (text, not colour only). Same for the update status line.
10. **Copy fixes.** "Open" → "Reveal in Explorer" (or open the file: `VB.openFile`); "Recent activity" → `data-i18n="recentActivity"`; localise the two new update strings already added.
11. **Dead markup.** Remove the hidden duplicate title and move inline styles into `style.css`.

Risk: none to the host bridge or queue; ids stay identical, so `tools/verify-host.cjs` keeps passing. Verify by resizing the panel to 240/320/460 px in Illustrator.

### Tier 2 — small, guarded JS (medium value, contained blast radius)

12. **Follow the Illustrator theme.** `new CSInterface().getHostEnvironment().appSkinInfo` gives `panelBackgroundColor`, and `CSInterface.THEME_COLOR_CHANGED_EVENT` fires when the user changes UI brightness. Do **not** paint with the host colour directly: CEP's values are known to be approximate (Adobe community reports identical "dark"/"darkest" values). Use it only as a light/dark signal (`red > 128`), then swap the token set:

    ```js
    function applyTheme(skin) {
      var light = !skin || skin.panelBackgroundColor.color.red > 128;
      document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    }
    try { applyTheme(new CSInterface().getHostEnvironment().appSkinInfo); } catch (e) { applyTheme(null); }
    ```

    Define `:root[data-theme="dark"]` tokens; default stays the current light palette, so a failure is a no-op. This is the highest-perceived-polish change and cannot break functionality.
13. **Honest status semantics.** Wrap the status/detail in `role="status" aria-live="polite"`, set `aria-busy` on the panel while a run is active, and use `role="alert"` only for hard errors.
14. **Batch progress.** `state.batch` already holds `doneCount`/`total`; render a thin `<progress>`-style bar under the status instead of only text. Purely additive.
15. **History feedback.** Disable the Refresh button for the ~200 ms host round-trip and show "Updated just now" in the hint; keeps expectations honest.
16. **Update states.** Add a neutral `norelease` state ("No update published yet") so the card stops saying "Update failed". This is the exact message users hit today.
17. **Error recovery.** When the status is an error, show an inline link/button "Open log folder" next to it (the host call already exists). Turns a dead end into a next step.

### Tier 3 — deliberately **not** recommended now

- **Spectrum Web Components / React**: bundles, a build step, and Chromium-99-era CEP compatibility risk, for a panel with ~12 controls. The CSS above gets most of the visual benefit at zero runtime cost.
- **Tabs / multi-screen navigation**: would reshuffle ids the test harness depends on, for a panel that fits one scroll.
- **Custom icon set / icon-only toolbar**: text buttons are clearer at this size and need no assets.
- **`prefers-color-scheme`**: CEP does not track the OS theme; Illustrator's own setting is the correct signal.
- **Any auto-update or automatic network call at startup**: already removed for security; don't reintroduce through "smart" UI.

## 4. Guardrails (how to avoid creating new problems)

- Keep every existing element id — the harness asserts `every id used by panel.js exists in index.html` and that both locales define every key.
- No new dependencies, fonts, or CDNs; the panel must work offline.
- No continuous CSS animations (CEP keeps a compositor busy and panel rendering has known glitches).
- No modal `alert()`/`confirm()` for routine messages; keep feedback in-panel.
- Change one tier at a time, then run `node ../tools/verify-host.cjs` plus a resize/theme pass.
- Never touch `agent/`, `host/`, or the queue for a UI change.

## 5. Verification checklist for each change

1. `node --check` on any touched JS; `node ../tools/verify-host.cjs` green.
2. Panel at 240 px, 320 px (default-ish), and 460 px wide: no clipped text, no horizontal scrollbar, settings still usable.
3. Illustrator UI brightness set to the lightest and darkest presets: text remains ≥4.5:1 (spot-check with a contrast tool), no invisible borders.
4. Keyboard only: Tab reaches every control, focus is visible, Enter/Space activate, Escape leaves shortcut capture.
5. Run one vectorize + one batch: status is announced (aria-live), Cancel stays reachable, history updates.
6. Idle CPU: no animation, no polling change.

## 6. Suggested order

| Step | Items | Effort | Risk |
|---|---|---|---|
| 1 | Tokens + contrast + focus + red title (1,2,3,4) | ~1 h | none |
| 2 | Density, scroll container, responsive grid, details marker (5,6,7,8) | ~1 h | none |
| 3 | Copy, dead markup, history prefixes, localisation (9,10,11,13) | ~40 min | none |
| 4 | Theme switch + aria-live + batch bar + update `norelease` (12,13,14,16) | ~2 h | low |
| 5 | History feedback + error recovery link (15,17) | ~40 min | low |

## 7. Sources

- Adobe, *Design best practices* (responsive layout, loading indicators, theming, accessibility): https://developer.adobe.com/express/add-ons/docs/guides/build/design/best-practices
- Adobe, *User interface guidelines* (avoid interrupting dialogs, in-panel messaging): https://developer.adobe.com/express/add-ons/docs/guides/build/distribute/guidelines/general/user-interface
- Adobe CEP, *AppSkinInfo* class reference (`panelBackgroundColor`, `baseFontSize`): https://jakkrobbit.github.io/CEP-8-Docs/AppSkinInfo.html
- Adobe CEP resources, theme-change event and `appSkinInfo` usage: https://context7.com/adobe-cep/samples/llms.txt
- Adobe community, *appSkinInfo gives inaccurate results* (why not to trust exact host colours): https://community.adobe.com/questions-540/panel-background-color-for-cep-panels-hostenvironment-appskininfo-gives-inaccurate-results-106342
- Adobe CEP cookbook, panel `Geometry` / min-max sizing and docked-panel behaviour: https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_6.x/CEP_6.1_HTML_Extension_Cookbook.pdf
- Adobe community, min/max sizes are not honoured once a panel is docked: https://community.adobe.com/questions-729/how-to-set-the-minimum-width-height-of-a-cep-extension-1391289
- Davide Barranca, *HTML Panels Tips #6* (theme integration pattern): https://www.davidebarranca.com/2014/02/html-panels-tips-6-integrating-topcoat-css
- Note on CEP→UXP direction (why to avoid over-investing in CEP-only UI tech): https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-for-you/uxp-for-cep-devs
