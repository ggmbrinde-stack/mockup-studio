# Mockup Studio — Architecture Plan (simple)

## Goal
One Illustrator CEP panel ("Mockup Studio") that holds multiple tools. Today it vectorizes. Later it will also do SKU lookup and Gemini image generation. Existing vectorizer behavior must not change.

## Layers (what lives where)

| Layer | What it does | Files |
|-------|--------------|-------|
| **Panel shell** | Tabs, header, status bar, log, settings page. Loads first, starts each module. | `js/shell/shell.js`, `js/shell/module-registry.js`, `index.html` |
| **Core** | Shared state/settings/i18n/log/event bus used by every module | `js/core/app.js` |
| **Bridge** | Talks to Illustrator (ExtendScript) via CSInterface | `js/bridge/host.js` |
| **Queue** | Bounded parallel batch scheduler (used by vectorizer; reusable) | `js/queue/batch.js` |
| **Module: vectorizer** | Existing vectorize flow (unchanged) | `modules/vectorizer/vectorizer.js` |
| **Module: sku-resolver** | SKU lookup (new, logic from another project) | `modules/sku-resolver/` |
| **Module: gemini-img** | Gemini image gen (new) | `modules/gemini-img/` |
| **Host** | ExtendScript ES3, `VB.*` API called by bridge | `host/*.jsx` |
| **Agent** | Node outside Illustrator (Puppeteer/Gemini) | `agent/` |

## How a module works
Each module registers itself:
```
VBPanel.modules.register({
  id: "vectorizer",
  label: "Vectorize",
  order: 10,
  init: function(container, api) { ... }
})
```
- `container` = the `<div>` where the module draws its UI
- `api` = `{ core, bridge, queue, events, t, $, log, settings, saveSettings }`

The shell shows one module at a time via tabs. Vectorizer is module #1.

## One settings page (your request)
All modules share ONE settings page (not one per module). It lives in the shell. Each module can add its own rows (e.g. Gemini API behavior, SKU defaults). Saved to `localStorage` as `vb_settings`.

## Host API (`VB.*`)
ExtendScript is ES3 (no `let/const/arrow functions`, no built-in JSON). Every host function returns a JSON string. New features add `host/<feature>.jsx` with `VB.<feature>*` functions.

## Agent
Node outside Illustrator. Only for features that need it (vectorizer = yes; Gemini = likely yes for API key safety; SKU resolver = depends). Agent code never packaged; user runs `npm install` in `agent/`.

## Rules we keep
- Vectorizer flow untouched (per-item batch, `VB_BATCH`, doc guard, warm daemon, ES3 host)
- Runtime data stays in `%USERPROFILE%\Documents\VectorizerBridge\`
- Source ↔ installed CEP synced on every change
- Manifest version bumped for releases

---

## Open questions (need your answers)

1. **Shell navigation**: tabs across the top, sidebar on the left, or something else? Which feels best for "designer de maquetes"?

2. **Module contract**: does `init(container, api)` cover everything a module needs, or should modules also get `activate()`/`destroy()` (when switching tabs)?

3. **One settings page**: all settings in one shell page. Should each module add its own rows there, or should modules have their own settings inside their tab?

4. **Host API**: for SKU resolver and Gemini, which functions should `VB.*` expose? (e.g. `VB.skuLookup(sku)`, `VB.geminiGenerate(prompt)`). Any others?

5. **Agent boundaries**: which features need Node/agent code? SKU resolver — does the "other project" code run in Node or can ExtendScript read it directly? Gemini — agent-side API call (key stays out of panel)?

6. **CEP identity**: rename to Mockup Studio with a NEW ExtensionBundleId (new CEP install path, users reinstall), or keep the old ID and just change the display title?

7. **Data flow**: confirm — panel → bridge → host → agent (shell launches node) for anything needing Gemini/vectorizer.ai. Panel → bridge → host only for Illustrator-native features. Correct?

Answer whatever you can. Nothing is coded yet.