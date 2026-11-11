# Installer & Uninstaller — Changes (2026-11-11)

Audit of `install.ps1` / `uninstall.ps1` found five real defects (a failed `npm install`
reported as success, no source == destination guard, a cosmetic `-Force`, 12 non-runtime files
copied into the extension, and an uninstaller that could not stop the daemon and only cleared
`PlayerDebugMode` for CSXS 11/12). All of them are fixed below.

Committed as `a6f5fe1` on `main` (11 files, +181 / -140) and pushed to
`https://github.com/ggmbrinde-stack/mockup-studio`.

## Summary

| Area | Before | After |
|---|---|---|
| Files copied into the extension | 43 (12 were docs/installers) | 31 (runtime only, stale copies pruned) |
| Running install.ps1 from the install folder | robocopy exit 16, vague error | refused with an explicit message |
| Illustrator open during install | warning only, install proceeded | aborts unless `-Force` is passed |
| npm install failure | logged "Agent dependencies installed." | exit code checked, last 20 log lines shown, install aborts |
| Missing `puppeteer-core` after npm | undetected, broken agent | abort with a delete/re-run instruction |
| Post-install check | none | installed manifest version + required files verified |
| Illustrator running during uninstall | ignored | warning, folder removed |
| Warm daemon during uninstall | left running from a deleted path | stopped via `agent/daemon/ctl.js stop` |
| `-RemoveDebugMode` | CSXS 11 and 12 only | CSXS 9–16 (matches the installer) |
| Deleted during uninstall | any path | only inside `%APPDATA%\Adobe\CEP\extensions` |
| Dead version plumbing | `getLocalVersion` → `VB.getExtensionVersion` → `state.appVersion` | removed (nothing displayed it) |

## `install.ps1`

- **Runtime-only file set.** Docs, `.gitignore`, `install.ps1` and `uninstall.ps1` are excluded
  from the mirror, and files copied by older versions are pruned from the destination. The
  installed extension no longer carries stale documentation and cannot be installed onto itself.
- **Source == destination guard.** Resolves both paths, compares them and throws before any
  copy. Previously the shipped installer could be launched from the installed folder, where
  robocopy exits 16 ("source and destination are the same").
- **`-Force` has behaviour.** With Illustrator running, the install aborts and tells you to use
  `-Force`; with `-Force` it logs that a restart is required. Previously `-Force` only changed
  the wording of a warning.
- **Node/npm preflight.** Prints `node --version` and `npm --version`, warns loudly when either
  is missing (the agent needs Node.js).
- **npm failure detection.** Runs `npm install --omit=dev` with the working directory set to the
  installed `agent` folder, captures output in a temp log, checks `$LASTEXITCODE`, prints the
  last 20 log lines and throws on failure; then asserts `agent/node_modules/puppeteer-core`
  exists before reporting success. The native call is wrapped in `Push-Location`/`Pop-Location`
  because PowerShell 5.1 turns native stderr into terminating errors under
  `ErrorActionPreference = 'Stop'`.
- **Verification.** Reads `ExtensionBundleVersion` from the installed `CSXS/manifest.xml`, checks
  `index.html`, `host/core.jsx`, `host/place.jsx`, `js/bridge/host.js` and `agent/run.js`, and
  logs `Verified install: version 2.3.0, 31 files copied, required files present.`
- **Docs fixed.** The header no longer claims "CSXS 11/12"; the shortcut note is ASCII-safe
  (`Ctrl+Shift+;` instead of a `Ç` that becomes `?` in redirected logs).

## `uninstall.ps1`

- **Daemon shutdown first.** Runs `node <dest>\agent\daemon\ctl.js stop --work <runtime>` with an
  800 ms settle, then warns if `agent-daemon.json` still exists. Deleting the folder underneath a
  live daemon used to leave an orphan process serving deleted files and locked `node_modules`.
- **Debug-mode parity.** `-RemoveDebugMode` clears CSXS 9–16, the same range the installer sets.
- **Tighter safety guard.** The target must resolve inside `%APPDATA%\Adobe\CEP\extensions` and
  must not be (or sit under) `%USERPROFILE%\Documents\VectorizerBridge`.
- Clearer failure text when a file is locked by Illustrator/Chrome.

## Removed dead code

The self-updater was deleted earlier; these were its last remnants:

- `js/bridge/host.js` — `getLocalVersion()`
- `host/core.jsx` — `VB.getExtensionVersion()`
- `modules/vectorizer/vectorizer.js` — the `bridge.getLocalVersion(...)` call at startup
- `js/core/app.js` — `state.appVersion` and `core.APP_VERSION_FALLBACK`
- `js/locales/en.js`, `js/locales/pt.js` — `checkUpdates`, `downloadUpdateBtn`

Nothing read `appVersion`, so the panel was paying for an `evalScript` round-trip at load and
discarding the result.

## Documentation

- `CHANGELOG.md` — installer/uninstaller/cleanup entries under 2.3.0.
- `INSTALL.md` — installation now goes through `install.ps1` (with `-Force` semantics and the
  source == destination refusal); `uninstall.ps1 -RemoveDebugMode` documented.
- `README.md` — step 2 points at `install.ps1` instead of manual registry edits.

## Verification (all run on this machine)

| Test | Command | Result |
|---|---|---|
| Parse both scripts | `Parser::ParseFile` | `parse ok` |
| Clean install | `install.ps1` | exit 0, `Verified install: version 2.3.0, 31 files copied` |
| Source == destination | `install.ps1` from the installed folder | exit 1, "Refusing to install: source and destination are the same folder" |
| Illustrator guard | synthetic process named `Illustrator` | without `-Force` exit 1 + message; with `-Force` exit 0 |
| Uninstall | `uninstall.ps1 -RemoveDebugMode` | daemon `{"ok":true,"state":"stopped"}`, folder removed, `PlayerDebugMode` absent (9/12/16) |
| Reinstall after uninstall | `install.ps1` | 4 s, 23 packages, `puppeteer-core` present, `PlayerDebugMode` = 1 on CSXS 9–16 |
| npm failure | fake `npm.cmd` exiting 1 | exit 1, "npm install failed with exit code 1", no deps left behind |
| Restore after failure test | `install.ps1` | exit 0, deps installed, install verified |
| Source ↔ installed parity | `cmp` on 6 changed runtime files | identical |
| Panel/host checks | `node --check`, `tools/verify-host.cjs` | clean; all 22 checks pass |

## Limitations

- The Illustrator-running guard was exercised with a synthetic process named `Illustrator`, not
  the real application.
- The panel itself was not launched; these changes are installer/uninstaller only.
- The uninstall/reinstall cycle was run with Illustrator closed.
