# Task prompt: publish the first updatable release of Mockup Studio

You are working on **Mockup Studio**, an Adobe Illustrator CEP panel (`com.bestofgifts.vectorizerbridge`)
whose updates are delivered from GitHub Releases. The panel currently reports
*"No published update yet: this repository has no GitHub release."* — correct, because no release has
ever been published. Your job is to publish one that the panel's updater can actually see and install.

## 0. Blocking decision — read before doing anything

The repository `ggmbrinde-stack/mockup-studio` is **PRIVATE** (`gh repo view --json visibility`
returns `PRIVATE`). The panel's updater calls `https://api.github.com/repos/<repo>/releases/latest`
**without credentials**, which returns **404 for a private repository even after a release exists**.
Publishing a release into a private repo therefore cannot make the button work.

Do not work around this by embedding a GitHub token in the panel, in `agent/update.js`, or in any
file that ships to users — that would leak repo access to every install.

Pick one and state it in your report:

- **A (recommended):** make the repository public (`gh repo edit --visibility public --accept-visibility-change-consequences`),
  publish the release, and verify the unauthenticated API returns it. Release assets become public;
  the source history becomes public too.
- **B:** keep the repo private and host the release zip plus a small public `release.json`
  (version + sha256 + URL) somewhere public; the updater then needs a code change to read that
  manifest (`agent/update.js` currently hard-codes the GitHub API). Not in scope unless asked.
- **C:** stop and ask the user which they want.

If the user has already made the repository public, skip A and continue.

## Facts you can rely on

| Item | Value |
|---|---|
| Repo / branch | `ggmbrinde-stack/mockup-studio`, `main` |
| Local checkout | `C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge` |
| Installed extension | `%APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge` |
| Runtime/user data (never touch) | `%USERPROFILE%\Documents\VectorizerBridge` |
| Current version | `2.3.0` (manifest lines 2 and 4) |
| Current HEAD | `de2bc84` |
| Existing tags | `v2.2.0` only; **no releases** |
| `gh` CLI | v2.102.1, authenticated as `ggmbrinde-stack`, scopes include `repo` |

The updater's contract (do not violate it):

- Reads `GET /repos/<repo>/releases/latest`; **drafts and prereleases are ignored**.
- Tag must be a plain `x.y.z` (`v` prefix tolerated, e.g. `v2.3.1`).
- Requires an asset matching `*.zip` **with a `digest` field of `sha256:<64 hex>`**. Without a digest
  the updater refuses to install. GitHub computes digests for uploaded assets.
- The archive must contain `CSXS/manifest.xml` at its root (or exactly one level down), with
  `ExtensionBundleVersion` equal to the tag, plus `index.html`, `host/core.jsx`, `host/place.jsx`,
  `js/bridge/host.js`, `agent/run.js`.
- The panel compares against the installed `2.3.0`, so the release must be **`2.3.1` or higher**.

## 1. Preflight

```powershell
cd C:\Users\user\Videos\BestOfGifts_Master\vector_illust\VectorizerBridge
git status --porcelain          # expect clean; INSTALLER_CHANGES_2026-11-11.md may be untracked
git fetch origin; git status -sb
gh auth status
```

Stop if the tree has unrelated uncommitted edits, or if `git log origin/main..HEAD` is non-empty.

## 2. Bump the version to 2.3.1

Edit `CSXS/manifest.xml` so **both** places read `2.3.1`:

```xml
<ExtensionManifest ... ExtensionBundleVersion="2.3.1" ...>
  <Extension Id="com.bestofgifts.vectorizerbridge.panel" Version="2.3.1"/>
```

Assert it:

```powershell
Select-String -Path CSXS\manifest.xml -Pattern '2\.3\.1'
# must print exactly the two lines above (and nothing with 2.3.0)
```

## 3. Changelog

Add a `## 2.3.1 — <today>` section at the top of `CHANGELOG.md`, summarising what changed since
2.3.0 shipped, at minimum:

- installer: runtime-only copy, source==destination guard, real `-Force`, npm exit-code +
  `puppeteer-core` verification, stale-doc pruning
- uninstaller: stops the warm daemon, clears `PlayerDebugMode` for CSXS 9–16
- warm Chrome: `agent/daemon-ctl.js` now actually calls `main()`
- agent: `fetchTimer` declared outside the `try` (batch items no longer fail after download)
- new safe updater: explicit confirm, SHA-256 verification, staged validation, backup + rollback,
  "Restore previous version"

## 4. Commit and push

Follow the repo's message style (imperative, `feat:`/`fix:`). Include the untracked
`INSTALLER_CHANGES_2026-11-11.md` only if you intend it as documentation; otherwise leave it.

```powershell
git add CSXS/manifest.xml CHANGELOG.md
git commit -m "release: 2.3.1"
git push origin main
```

Never force-push or rewrite already-pushed history.

## 5. Build the archive (runtime files only)

The archive root must be the extension root — no wrapper folder, no `node_modules`, no `*.md`,
no `*.zip`, no `.git`.

```powershell
$stage = Join-Path $env:TEMP "mockup-studio-2.3.1"
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item CSXS,css,host,js,modules,agent,index.html -Destination $stage -Recurse
Remove-Item -LiteralPath (Join-Path $stage 'agent\node_modules') -Recurse -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath .\mockup-studio-2.3.1.zip -Force
```

Verify before publishing:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path .\mockup-studio-2.3.1.zip))
$zip.Entries.Count
($zip.Entries | Where-Object { $_.FullName -eq 'CSXS/manifest.xml' }).Count   # must be 1
($zip.Entries | Where-Object { $_.FullName -like '*node_modules*' }).Count    # must be 0
($zip.Entries | Where-Object { $_.FullName -like '*.md' }).Count              # must be 0
$zip.Dispose()
```

Then unzip to a temp folder and confirm `ExtensionBundleVersion="2.3.1"` and that
`agent/update.js`, `host/core.jsx`, `js/bridge/host.js`, `index.html` are present.

Do **not** commit the zip to the repository.

## 6. Create the release (published, not draft)

```powershell
$hash = (Get-FileHash .\mockup-studio-2.3.1.zip -Algorithm SHA256).Hash.ToLower()
gh release create 2.3.1 .\mockup-studio-2.3.1.zip `
  --title "Mockup Studio 2.3.1" `
  --notes-file RELEASE_NOTES.md   # or --notes "..." / --generate-notes
```

- Tag **must** be `2.3.1` (or `v2.3.1`), not `release-2.3.1`.
- Do not pass `--draft` or `--prerelease`; the updater ignores both.
- Record `$hash` — it must match what GitHub reports in the next step.

## 7. Verify the published release the way the panel will see it

```powershell
gh release view 2.3.1 --json tagName,isDraft,isPrerelease,assets
```

Check: `isDraft=false`, `isPrerelease=false`, one `.zip` asset whose `digest` is
`sha256:<64 hex>` and equals `$hash`.

Then the decisive test — **unauthenticated** access, exactly what the panel does:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://api.github.com/repos/ggmbrinde-stack/mockup-studio/releases/latest
```

- `200` → the panel can see it (repository is public).
- `404` → the repository is still private; the updater will keep failing. Return to step 0 and say so.

If the asset has no `digest` field, wait a few seconds and re-query; if it is still absent, delete and
re-upload the asset (the updater will refuse a digest-less release by design).

## 8. End-to-end check of the updater

Runner-side (no credentials needed if step 7 returned 200):

```powershell
node .\agent\update.js --action check `
  --install "$env:APPDATA\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge" `
  --work "$env:USERPROFILE\Documents\VectorizerBridge" `
  --status "$env:USERPROFILE\Documents\VectorizerBridge\agent-update.json"
Get-Content "$env:USERPROFILE\Documents\VectorizerBridge\agent-update.json"
```

Expected: `{"state":"available","current":"2.3.0","latest":"2.3.1"}`.

Optional but recommended — prove the risky half without touching the user's install:

```powershell
$tmp = Join-Path $env:TEMP "update-selftest"
Copy-Item "$env:APPDATA\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge" $tmp -Recurse
node .\agent\update.js --action apply --install $tmp --work (Join-Path $env:TEMP 'update-work') --status (Join-Path $env:TEMP 'update-work\s.json')
Get-Content (Join-Path $env:TEMP 'update-work\s.json')      # expect state "done", version "2.3.1"
node .\agent\update.js --action restore --install $tmp --work (Join-Path $env:TEMP 'update-work') --status (Join-Path $env:TEMP 'update-work\s.json')
```

Expected after restore: `state: "restored"`, manifest back to `2.3.0`.

Finally, in Illustrator: restart it, open the panel, press **Check for updates** — it should say
*"Version 2.3.1 is available."* Do not press **Update now** on the user's install unless they asked;
a release that only checks is a complete deliverable.

## 9. Clean up and report

- Remove `mockup-studio-2.3.1.zip`, the staging folder and temp self-test folders.
- Leave the repository tree clean and `main` pushed.

Report, in this order: repository visibility decision; version and tag published; asset name, size,
SHA-256 and the digest GitHub reported (must match); unauthenticated HTTP status of
`/releases/latest`; the updater check output; the self-test apply/restore result; anything you could
not verify and why.

## Hard constraints

- Never put credentials, tokens or `.env` contents in the panel, the update script, the archive or
  the release notes.
- Never include `node_modules`, docs, logs, `.zip` files or `.git` in the release archive.
- Never publish a version that is not plain `x.y.z`, and never reuse an existing tag.
- Never force-push, rewrite pushed history, or delete releases you did not create.
- Never modify `%USERPROFILE%\Documents\VectorizerBridge` (user settings, SVGs, Chrome profile).
- If a step's verification fails, stop and report — do not paper over it by loosening a check.
