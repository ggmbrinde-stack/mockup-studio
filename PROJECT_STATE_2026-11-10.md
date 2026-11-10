# Project State — Mockup Studio (2026-11-10)

## Summary
**v2.2.0 — stable, development frozen for UI/UX work.** CEP panel (`com.bestofgifts.vectorizerbridge`, Illustrator 2025/2026+, Windows) vectorizes selections via vectorizer.ai and places editable SVGs on `Vectorizer` layer. Bounded parallel per-item batch v2, SVG history (place to any open doc), warm daemon, and modularized panel/host/agent architecture are in place. Source and installed CEP are in sync.

## What works
- Per-item batch vectorization (prepare/tag/resolve by job+index), bounded parallel queue (default `batchWorkers=1`, up to 4), per-job status/poll/relaunch, cancel/stop (daemon-aware), and progress/finish reporting.
- SVG placement: `groupItems.createFromFile` primary (AI 2026-safe), fit to bounds/active artboard, hide-original per item (batch) or off for history; strict doc guard for auto/batch, `allowAnyDoc` for history/manual place.
- Warm Chrome daemon (single browser/profile, reusable pages, local IPC), slot wait/async-ack flow, one-shot fallback when daemon unavailable.
- Node/agent launch hardening, stale-start detection/takeover/relaunch, unique launchers, stuck bounds.
- SVG history UI: list/downloads, open/reveal, place into any open document.
- Modular codebase: panel `core/bridge/queue/vectorizer` + `core.events` interface; host `json/core/batch/export/place/agent`; agent `core/lib`, `vectorizer/job`, `daemon/server+ctl` with stable wrappers.

## Key decisions/invariants
- Each selected item = its own SVG (whole-selection-as-one deferred). Preserve per-item export/place semantics.
- `workers=1` default for Windows stability; `Browser.setDownloadBehavior` not used (per-page CDP Fetch capture instead).
- ExtendScript is ES3/cached; `VB.*` host API and panel module boundaries (`VBPanel.*`) are stable.
- Runtime artifacts live only in `%USERPROFILE%\Documents\VectorizerBridge\` and are excluded from source/dist.

## Freeze & focus
- **Frozen:** behavior, contracts, batch/placement/agent flow. **Active focus:** UI/UX redesign/polish only. Keep source ↔ installed CEP in sync.

## Validation status
- Modular refactor syntax-checked (panel/agent JS) and deployed to installed CEP (hash-synced). Prior functional verification reported: batch/history working, history place to other documents fixed, `workers=1` default and contention fixes applied.
- Recommended ongoing validation (UI/UX phase, non-behavioral): reload panel after UI edits; full Illustrator restart/reload when touching `host/*.jsx`; restart warm daemon when touching `agent/*`.

## Risks / watchlist
- Intermittent `stuck: starting` under parallel load (Windows hidden launcher) — default to 1 worker, relaunch/guards exist.
- Site selector/layout changes on vectorizer.ai can break agent flow (`agent/vectorizer/job.js`, `run.js`).
- CEP/ExtendScript caching can mask host changes until restart.

## Deferred (post UI/UX or post-freeze)
- “Whole selection as one image” batch mode.
- Further host/agent internal splits, richer typed command/event interfaces.
- UX enhancements: per-item progress/errors polish, history cleanup/limits, timeout guidance, versioned release packaging script.
