# Updating Mockup Studio

The panel can update itself, but only when you ask it to and only after it has verified what it
downloaded. There is no background check and nothing is applied at startup.

## For users: how to update

1. **Check.** Open the panel and press **Check for updates** in the *Updates* section.
   - It shows your installed version and talks to GitHub over HTTPS.
   - If you are current: *"You are on the latest version (x.y.z)."*
   - If there is a newer release: *"Version x.y.z is available."* and an **Update now** button appears.
2. **Confirm.** Press **Update now** once and the button changes to **Confirm update?** — press it
   again within 8 seconds. The double click is deliberate: an update replaces the running panel.
3. **Wait.** The status line walks through *Downloading…* → *Installing…* (a few seconds). The file
   swap happens in a separate process after the updater exits, so Illustrator is never written to
   while the panel is executing from that folder.
4. **Restart Illustrator.** The status ends with *"Updated to x.y.z. Restart Illustrator to finish."*
   CEP caches the panel per process, so a restart is what makes the new version load.

Your settings, history, SVGs and the agent's `node_modules` are preserved.

## What happens under the hood

| Step | What runs | Safety |
|---|---|---|
| Check | `agent/update.js --action check` | `GET https://api.github.com/repos/<repo>/releases/latest`, HTTPS only |
| Version compare | `x.y.z` parsed numerically | Non-numeric tags are refused |
| Download | the release's `.zip` asset | HTTPS + host allowlist, 80 MB cap, 30 s timeout, max 4 redirects |
| Verify | SHA-256 of the downloaded archive | Must match the asset's published digest, otherwise nothing is unpacked |
| Stage | extracted into a temp folder | Must contain `CSXS/manifest.xml` with exactly the release version, plus `index.html`, `host/core.jsx`, `host/place.jsx`, `js/bridge/host.js`, `agent/run.js` |
| Backup | `Documents/VectorizerBridge/backups/<oldVersion>-<timestamp>` | Excludes `node_modules` and runtime artifacts |
| Apply | PowerShell applier, after the updater exits | robocopy mirror into the install, then re-reads the manifest to confirm the version |
| Failure | rollback | The backup is copied back and the status says `rolledBack` |

The live install is only touched after the archive is verified and staged; nothing is applied at
startup; no release without a digest can be installed.

## For maintainers: publishing a release

1. Bump `CSXS/manifest.xml` → both `ExtensionBundleVersion` values (e.g. `2.3.1`). Keep it plain
   `x.y.z` — CEP rejects anything else, and the updater refuses non-numeric tags.
2. Update `CHANGELOG.md` and, if the install layout changed, `install.ps1`.
3. Build the zip from the repository contents, with the archive root containing `CSXS/`, `index.html`,
   `host/`, `js/`, `modules/`, `agent/` (no `node_modules`, no `*.md`):
   ```powershell
   Compress-Archive -Path CSXS,css,host,js,modules,agent,index.html -DestinationPath mockup-studio.zip -Force
   ```
4. Create a GitHub release whose **tag** is the version (`2.3.1`, with or without a `v` prefix),
   attach `mockup-studio.zip`, and confirm the asset shows a SHA-256 digest (GitHub computes it for
   uploaded assets; the updater requires it).
5. Test from a clean machine first: check → update → restart → vectorize, then
   **Restore previous version** to prove the rollback path.

## Rollback

Press **Restore previous version** in the *Updates* section (shown whenever a backup exists), or run:

```powershell
node "%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge\agent\update.js" `
  --action restore `
  --work "$env:USERPROFILE\Documents\VectorizerBridge" `
  --install "$env:APPDATA\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge" `
  --status "$env:USERPROFILE\Documents\VectorizerBridge\agent-update.json"
```

Then restart Illustrator. Backups live in `Documents\VectorizerBridge\backups\` — you can copy one
back by hand if the panel itself is unusable.

## If the updater cannot run

Manual update is always available and never loses your data:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

`install.ps1` refuses to run while Illustrator is open unless you pass `-Force`, copies only runtime
files, installs agent dependencies if missing, and verifies the installed manifest version.

## Limitations

- The updater needs Node.js (already required by the agent) and outbound HTTPS to GitHub.
- A release must publish a `.zip` asset **with a SHA-256 digest**; unsigned releases are refused.
- Illustrator must be restarted after any update — CEP caches the panel.
- Restore uses the newest backup only; older backups are kept on disk for manual recovery.
