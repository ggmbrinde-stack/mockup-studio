# Vectorizer Bridge — Project State (2026-11-06)

## What this is
CEP panel for **Adobe Illustrator 2026 (v30.8.2, Windows)**, bundle `com.bestofgifts.vectorizerbridge`. It exports the current selection to PNG, sends it to **vectorizer.ai** via a headless Chrome Node/Puppeteer agent, downloads the SVG, and places an editable SVG on the `Vectorizer` layer (fitted to original bounds). Source: `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge\`. Installed: `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\`. Runtime data/logs: `C:\Users\user\Documents\VectorizerBridge\` (`log.txt`, `agent-status.json`, `agent-log.txt`, `agent-daemon.json`, `agent-debug\`, `agent-downloads\vectorizer_export_*.svg`).

## Key environment
- Windows, Node `v24.21.0` (Scoop path resolved by host), Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Signed-in vectorizer.ai profile: `C:\Users\user\Documents\VectorizerBridge\vectorizer-profile` (exclusive Chrome `--user-data-dir` lock).
- CEP/ExtendScript host scripts and panel JS/HTML are cached; **host changes require Illustrator restart (or full extension reload)** to be reliable.

## Current capabilities (working when host is current)
- SVG import fix: `groupItems.createFromFile(File)` primary, `fsName` fallback, then `placedItems.add()+embed()` fallback, else keep linked. Avoids Illustrator error 129 from `vector-effect="non-scaling-stroke"`.
- Robust bounds: `VB.itemBox` checks `visibleBounds → geometricBounds → controlBounds → left/top/width/height/position` and unions group/child bounds. Handles `PlacedItem`/`RasterItem`/groups better.
- Node/agent launch hardening (Scoop/per-user node paths, pre-launch `starting` status with PID, uncaught/unhandled handlers, Chrome launch timeout, panel stuck-start guards).
- Cancel/start hardening (v1): `runToken` invalidates in-flight panel callbacks; cancel can stop busy/waiting; targeted early kill when no PID; contended-run guard for recent active status; clearer cancel messaging.
- Warm Chrome daemon (optional): `agent/daemon.js` + `daemon-ctl.js`, local `127.0.0.1`, single job, ~10min idle exit, status in `agent-daemon.json`. UI toggle “Warm Chrome (faster runs)” (fixed `ext` undefined). Daemon holds profile lock; host stops it before sign-in/install.
- PNG presets incl. Original (1 px/pt). Unique SVG filenames to avoid Illustrator Links warnings. Harness `tools/verify-host.cjs` previously 18/18 on earlier baseline.

## v1 sequential per-item batch — **WORKING** (2026-11-06 12:20)
- Goal achieved (v1): select multiple objects (possibly same layer) → **each item exported/vectorized/placed as its own SVG** sequentially. Whole-selection-as-one deferred (see `BATCH_VECTORIZATION_NOTES.md`).
- Implemented: `VB.prepareBatch`/`VB.exportBatchItem` (host), panel queue with `Batch i/n` status, per-item history, cancel stops remaining, per-item hide-original. Markers/tags `VB_BATCH=<jobId>:<index>` for re-resolving items.
- Verified: **Batch complete 5/5 placed** (Test_File.ai) and 1/1 cases; 4× `PlacedItem` + 1× `RasterItem` (mixed/same-layer selection). Warm Chrome on.
- Fixes that unblocked it: robust `VB.itemBox` (visible/geometric/control bounds, position, group/child union); host cache diagnosis (full Illustrator restart required); `isValid` false-positive tolerance for `PlacedItem`/`RasterItem` in `prepareBatch` and `exportBatchItem`; tagged re-resolution fallback.
- Current diagnostics/log noise: `prepareBatch`/item trace and `emptyBounds` diagnostics are verbose in `log.txt` — candidate for cleanup/gating. Cancel+next-run and warm-daemon cancel should be revalidated under normal use.

## Why “normal” single/multi detection looked broken
1. Bounds were fine (confirmed by diagnostics). Failure was not bounds math.
2. Batch loop’s `isValid` guard rejected `PlacedItem`/`RasterItem` objects even though their properties/bounds were readable.
3. CEP/ExtendScript host caching masked fixes across reloads; some logs showed old code paths (`exportSelection start` without batch traces). **Full Illustrator restart required**.
4. Same layer is supported by selection model; issue was object validity/host state, not layer.

## Files changed recently (key)
- `host/common.jsx`: robust `VB.itemBox`.
- `host/export.jsx`: `prepareBatch`/`_findBatchItemByTag`/`exportBatchItem`, diagnostics, `isValid` tolerance (latest), `exportSelection` kept.
- `host/import.jsx`: hide current original item.
- `js/panel.js`: runToken cancel, sequential batch queue, warm toggle/status, agent status handling.
- `host/agent.jsx`: daemon control, stale-run guard, cancel/daemon-aware stop, Scoop node paths.
- `agent/run.js`, `agent/job.js`, `agent/daemon.js`, `agent/daemon-ctl.js`: warm daemon + resilient startup/stale-daemon fallback.
- `js/locales/en.js`, `pt.js`; `index.html` (warm toggle).

## Recommended next steps
1. **Cleanup/stabilization pass (recommended before parallel):** gate/remove verbose trace logs (`prepareBatch loop done`, per-item box/invalid traces, `emptyBounds` sel dump) behind a debug flag or remove; keep actionable warnings. Prune old safe ZIPs in `vector_illust\` if desired; add optional rotation/cleanup for `Documents\VectorizerBridge\agent-downloads` and log growth. Revalidate cancel mid-batch, cancel→next run, and warm-daemon on/off edge cases.
2. **UX/polish (optional):** button/label clarity (`Vectorize selection` → count-aware, e.g. “Vectorize 5 items” when known), clearer per-item success vs batch summary, history de-dup. Confirm “Original size”/presets and “Hide original per item” behavior.
3. **v2 bounded parallel (bigger, after cleanup):** start N=2, sequential fallback default. Requires per-job isolation (`png/svg/status/debug/run` paths, job ids), worker pool, and **separate Chrome profiles/work dirs per worker** or managed one-shot workers (current `vectorizer-profile` has exclusive lock; daemon is single-job/409). Add conservative rate-limit/backoff and per-item errors/cancel for in-flight workers. See `BATCH_VECTORIZATION_NOTES.md`.

## Notion
No Notion MCP/tool access is available in this environment, so I could not publish there. This file is the canonical context snapshot: `vector_illust\VectorizerBridge\PROJECT_STATE_2026-11-06.md`. Copy/paste into Notion as needed.
