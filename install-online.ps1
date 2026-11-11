<#
  Mockup Studio / Vectorizer Bridge - one-line online installer (no git, no admin).

  Run from PowerShell or cmd.exe:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ggmbrinde-stack/mockup-studio/main/install-online.ps1 | iex"

  WHAT IT DOES
    - Downloads the latest published GitHub release .zip and verifies its SHA-256 digest.
    - Unpacks into a temp folder and validates it (manifest version + required files)
      BEFORE the installed extension is touched at all.
    - Stops the warm agent daemon, backs up the current install, copies the new files in,
      installs agent dependencies when they are missing, enables PlayerDebugMode for
      CSXS 9-16, then verifies the installed result.
    - Any failure after the copy step restores the backup automatically.

  SAFETY CONTRACT (nothing outside these paths is written or deleted)
    %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge   the extension itself
    %LOCALAPPDATA%\VectorizerBridge\install-backups\                  rollback copies (last 2)
    HKCU\Software\Adobe\CSXS.9-16  ->  PlayerDebugMode = 1            (unsigned CEP only)

    - %USERPROFILE%\Documents\VectorizerBridge is never written, moved or deleted. The only
      thing done there is asking the agent's own control script to stop the warm daemon.
    - The extension folder is never deleted. Files are copied over it additively.
    - No admin/elevation, no PATH edits, no other registry keys, no scheduled tasks.
    - It aborts BEFORE changing anything when Node/npm is missing but agent deps are absent,
      when the download or digest check fails, when the archive is invalid, or when the
      target path is not the CEP extension folder.

  OPTIONAL OVERRIDES (testing)
    VB_REPO, VB_INSTALL_VERSION, VB_DRY_RUN=1, VB_SKIP_AGENT_DEPS=1
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RunAsFile = [bool]($MyInvocation.MyCommand.Path)

$exitCode = & {
  $ExtensionId = 'com.bestofgifts.vectorizerbridge'
  $Repo = 'ggmbrinde-stack/mockup-studio'
  if ($env:VB_REPO) { $Repo = $env:VB_REPO }
  $Pinned = ''
  if ($env:VB_INSTALL_VERSION) { $Pinned = $env:VB_INSTALL_VERSION.Trim() }
  $DryRun = ($env:VB_DRY_RUN -eq '1')
  $SkipDeps = ($env:VB_SKIP_AGENT_DEPS -eq '1')

  $Required = @('index.html', 'host\core.jsx', 'host\place.jsx', 'js\bridge\host.js', 'agent\run.js')
  $StaleRootFiles = @('*.md', '.gitignore', 'install.ps1', 'install-online.ps1', 'uninstall.ps1')

  function Log([string]$Message, [string]$Color = 'Gray') {
    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message) -ForegroundColor $Color
  }
  function Fail([string]$Message) { throw $Message }

  function Get-FullPath([string]$Path) { return [IO.Path]::GetFullPath($Path).TrimEnd('\') }
  function Test-PathInside([string]$Parent, [string]$Child) {
    $p = (Get-FullPath $Parent).ToLowerInvariant()
    $c = (Get-FullPath $Child).ToLowerInvariant()
    return ($c -eq $p) -or $c.StartsWith($p + '\')
  }
  function Get-ManifestVersion([string]$ManifestPath) {
    try {
      $text = [IO.File]::ReadAllText($ManifestPath)
      $m = [regex]::Match($text, 'ExtensionBundleVersion="([^"]+)"')
      if ($m.Success) { return [string]$m.Groups[1].Value }
    } catch { }
    return ''
  }
  function Get-HttpsText([string]$Url) {
    $headers = @{ 'User-Agent' = 'MockupStudio-Installer'; 'Accept' = 'application/vnd.github+json' }
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $headers -TimeoutSec 60).Content
  }
  function Save-HttpsFile([string]$Url, [string]$OutFile) {
    $headers = @{ 'User-Agent' = 'MockupStudio-Installer'; 'Accept' = 'application/vnd.github+json' }
    Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $headers -OutFile $OutFile -TimeoutSec 300
  }
  function Invoke-Robocopy([string[]]$Arguments, [string]$What) {
    & robocopy @Arguments | Out-Null
    $rc = $LASTEXITCODE
    # Robocopy exit codes 0-7 mean success of some kind; 8 and above are real failures.
    if ($rc -ge 8) { Fail "$What failed (robocopy exit code $rc)." }
  }

  $tmp = $null
  $backup = $null
  $depsExisted = $false
  $nodeExe = $null
  $aiPids = @()

  try {
    # -------------------------------------------------------------- environment + guards
    if (-not $env:APPDATA) { Fail 'APPDATA is not set; cannot locate the CEP extensions folder.' }
    $ExtensionsRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
    $Dest = Get-FullPath (Join-Path $ExtensionsRoot $ExtensionId)
    $Runtime = Get-FullPath (Join-Path $env:USERPROFILE 'Documents\VectorizerBridge')
    $BackupRoot = Get-FullPath (Join-Path $env:LOCALAPPDATA 'VectorizerBridge\install-backups')

    # The only folder this script is allowed to write into besides its own backups.
    if (-not (Test-PathInside (Get-FullPath $ExtensionsRoot) $Dest)) {
      Fail "Refusing to install: '$Dest' is not inside the CEP extensions folder."
    }
    if ((Test-PathInside $Runtime $Dest) -or $Dest -eq $Runtime) {
      Fail "Refusing to install: '$Dest' overlaps the user runtime data folder."
    }
    $manifestDest = Join-Path $Dest 'CSXS\manifest.xml'
    $currentVersion = ''
    if (Test-Path -LiteralPath $manifestDest) { $currentVersion = Get-ManifestVersion $manifestDest }

    Log 'Mockup Studio installer' 'Cyan'
    Log "Extension folder: $Dest"
    if ($currentVersion) { Log "Currently installed: $currentVersion" } else { Log 'No existing install found (fresh install).' }
    Log "User data stays untouched: $Runtime"

    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

    try { $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) } catch { }
    if ($aiPids.Count -gt 0) {
      Log "NOTE: Illustrator is running (PID(s): $($aiPids -join ', ')). Files will be updated, but CEP caches host scripts: fully quit and reopen Illustrator afterwards." 'Yellow'
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
    $npmExe = $null
    if ($npmCmd) { $npmExe = $npmCmd.Source }
    if ($nodeExe) { Log ("Node.js: " + (& $nodeExe --version)) } else { Log 'WARNING: Node.js not found on PATH. The vectorizer agent needs it.' 'Yellow' }

    $destAgent = Join-Path $Dest 'agent'
    $hasDeps = Test-Path -LiteralPath (Join-Path $destAgent 'node_modules\puppeteer-core')
    if (-not $hasDeps -and -not $SkipDeps -and -not $npmExe) {
      Fail ("Node.js/npm is required to install the agent dependencies and was not found.`n" +
        'Install the Node.js LTS build from https://nodejs.org/en/download , then run the command again.' +
        "`nNothing on this computer was changed.")
    }

    # -------------------------------------------------------------- resolve the release
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    if ($Pinned) { $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Pinned" }
    Log "Looking up the release in $Repo ..."
    $release = $null
    try {
      $release = (Get-HttpsText $apiUrl) | ConvertFrom-Json
    } catch {
      $detail = $_.Exception.Message
      if ($detail -match '404') { Fail "No published release found for '$Repo'. Nothing was changed." }
      if ($detail -match '403') { Fail 'GitHub rate limit reached while looking up the release. Wait a few minutes and run the command again. Nothing was changed.' }
      Fail "Could not reach GitHub ($detail). Check the internet connection and try again. Nothing was changed."
    }
    if (-not $release -or -not $release.tag_name) { Fail 'GitHub returned an unexpected release description. Nothing was changed.' }
    $version = ([string]$release.tag_name).TrimStart('v', 'V')
    if ($version -notmatch '^\d+\.\d+\.\d+$') { Fail "The latest release tag '$version' is not a plain x.y.z version. Nothing was changed." }
    $asset = @($release.assets | Where-Object { $_.name -match '\.zip$' }) | Select-Object -First 1
    if (-not $asset) { Fail "Release $version has no .zip asset. Nothing was changed." }
    if (-not $asset.digest -or $asset.digest -notmatch '^sha256:([0-9a-fA-F]{64})$') {
      Fail "Release $version publishes no SHA-256 digest, so the download cannot be verified. Refusing to install unverified code. Nothing was changed."
    }
    $expectedSha = $Matches[1].ToLowerInvariant()

    Log "Release: $version ($($asset.name), $([math]::Round($asset.size / 1024, 1)) KB)"
    if ($currentVersion -eq $version) { Log 'Same version is already installed - this run will verify and repair it.' }
    elseif ($currentVersion) { Log "Updating $currentVersion -> $version" }
    else { Log "Installing $version" }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('vb-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zipPath = Join-Path $tmp $asset.name

    # -------------------------------------------------------------- download + verify
    Log 'Downloading ...'
    try { Save-HttpsFile ([string]$asset.browser_download_url) $zipPath }
    catch { Fail "Download failed ($($_.Exception.Message)). Nothing was changed." }

    $actualSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $expectedSha) {
      Fail ("Checksum mismatch: expected $($expectedSha.Substring(0, 12))..., got $($actualSha.Substring(0, 12))... " +
        'The download was corrupted or tampered with. Nothing was changed.')
    }
    Log 'Checksum verified (SHA-256).'

    # -------------------------------------------------------------- stage + validate
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stage = Join-Path $tmp 'staged'
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
      foreach ($entry in $archive.Entries) {
        $name = [string]$entry.FullName
        if ($name -match '(^|[\\/])\.\.([\\/]|$)' -or $name.StartsWith('/') -or $name.StartsWith('\') -or $name -match '^[A-Za-z]:') {
          Fail "The archive contains an unsafe path ('$name'). Nothing was changed."
        }
      }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $stage)

    $root = $stage
    if (-not (Test-Path -LiteralPath (Join-Path $root 'CSXS\manifest.xml'))) {
      $subDirs = @(Get-ChildItem -LiteralPath $stage -Directory)
      if ($subDirs.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $subDirs[0].FullName 'CSXS\manifest.xml'))) {
        $root = $subDirs[0].FullName
      } else {
        Fail 'The archive has no CSXS/manifest.xml at its root. Nothing was changed.'
      }
    }
    $stagedVersion = Get-ManifestVersion (Join-Path $root 'CSXS\manifest.xml')
    if ($stagedVersion -ne $version) {
      Fail "The archive reports version '$stagedVersion' but the release is '$version'. Nothing was changed."
    }
    $missing = @($Required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
    if ($missing.Count -gt 0) { Fail ('The archive is missing: ' + ($missing -join ', ') + '. Nothing was changed.') }
    Log "Archive validated: version $stagedVersion, all required files present."

    if ($DryRun) {
      Log 'DRY RUN: validation finished; no files were written. Nothing was changed.' 'Green'
      return 0
    }

    # -------------------------------------------------------------- stop the warm daemon
    $ctl = Join-Path $Dest 'agent\daemon\ctl.js'
    if ((Test-Path -LiteralPath $ctl) -and $nodeExe) {
      Log 'Stopping the warm agent daemon (if running) ...'
      try { & $nodeExe $ctl stop --work $Runtime 2>&1 | ForEach-Object { Log "  $_" } }
      catch { Log "WARNING: daemon stop failed: $($_.Exception.Message)" 'Yellow' }
      # Chrome needs a moment to flush its profile before the folder can be replaced.
      # Wait for the daemon's own info file to disappear, then ask a second time if needed.
      $daemonInfo = Join-Path $Runtime 'agent-daemon.json'
      for ($round = 0; $round -lt 2; $round++) {
        for ($i = 0; $i -lt 30; $i++) {
          if (-not (Test-Path -LiteralPath $daemonInfo)) { break }
          Start-Sleep -Milliseconds 500
        }
        if (-not (Test-Path -LiteralPath $daemonInfo)) { break }
        if ($round -eq 0) { Log 'Daemon still reporting; asking it to stop again ...' 'Yellow' }
        try { & $nodeExe $ctl stop --work $Runtime 2>&1 | ForEach-Object { Log "  $_" } } catch { }
      }
      if (Test-Path -LiteralPath $daemonInfo) { Log 'WARNING: the warm daemon still looks active; files may be in use. Continue and verify afterwards.' 'Yellow' }
    }

    # -------------------------------------------------------------- backup, then copy
    $depsExisted = Test-Path -LiteralPath (Join-Path $destAgent 'node_modules')
    if (Test-Path -LiteralPath $Dest) {
      $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
      $label = 'unknown'
      if ($currentVersion) { $label = $currentVersion }
      $backup = Join-Path $BackupRoot "$label-$stamp"
      New-Item -ItemType Directory -Force -Path $backup | Out-Null
      Log "Backing up the current install ..."
      Invoke-Robocopy @($Dest, $backup, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
        '/XD', 'agent\node_modules', 'node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile',
        '/XF', 'agent-status*.json', 'agent-daemon.json', 'agent-log.txt', 'log.txt', '*.zip') 'Backup'
      # A backup without a manifest cannot be used for rollback, so treat it as fatal.
      if (-not (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
        Fail 'Backup could not be verified (no CSXS/manifest.xml). Install manually instead. Nothing was changed.'
      }
    }

    try {
      Log 'Copying new files ...'
      New-Item -ItemType Directory -Force -Path $Dest | Out-Null
      Invoke-Robocopy @($root, $Dest, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NP',
        '/XD', 'agent\node_modules', 'node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile',
        '/XF', 'agent-status*.json', 'agent-daemon.json', 'agent-log.txt', 'log.txt', '*.zip',
        '*.md', '.gitignore', 'install.ps1', 'install-online.ps1', 'uninstall.ps1', '.DS_Store', 'Thumbs.db', 'desktop.ini') 'Copy'

      # Prune development leftovers that older installers used to mirror.
      foreach ($pattern in $StaleRootFiles) {
        Get-ChildItem -LiteralPath $Dest -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
          try { Remove-Item -LiteralPath $_.FullName -Force; Log "  pruned stale file: $($_.Name)" } catch { }
        }
      }

      # ------------------------------------------------------------ agent dependencies
      $puppeteer = Join-Path $destAgent 'node_modules\puppeteer-core'
      if (-not (Test-Path -LiteralPath $puppeteer)) {
        if ($SkipDeps) {
          Log 'WARNING: agent dependencies skipped (VB_SKIP_AGENT_DEPS=1). Vectorizing cannot run until npm install is done.' 'Yellow'
        } elseif (-not $npmExe) {
          Fail 'npm disappeared during the install; agent dependencies are missing.'
        } else {
          $npmLog = Join-Path $tmp 'npm.log'
          Log 'Installing agent dependencies (npm install --omit=dev) ...'
          Push-Location $destAgent
          try { & cmd.exe /c "npm install --omit=dev --no-audit --no-fund > `"$npmLog`" 2>&1"; $npmExit = $LASTEXITCODE }
          finally { Pop-Location }
          if ($npmExit -ne 0) {
            Log 'npm output (last 15 lines):' 'Yellow'
            Get-Content -LiteralPath $npmLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Log "  $_" }
            Fail "npm install failed (exit $npmExit). The previous install was restored."
          }
          if (-not (Test-Path -LiteralPath $puppeteer)) { Fail 'npm reported success but puppeteer-core is missing. The previous install was restored.' }
          Log 'Agent dependencies installed.'
        }
      } else {
        Log 'Agent dependencies already present (kept).'
      }

      # ------------------------------------------------------------ verify the result
      $installedVersion = Get-ManifestVersion $manifestDest
      if ($installedVersion -ne $version) {
        Fail "Verification failed: installed manifest reports '$installedVersion', expected '$version'."
      }
      $missingNow = @($Required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Dest $_)) })
      if ($missingNow.Count -gt 0) { Fail ('Verification failed; missing: ' + ($missingNow -join ', ')) }
      if (-not $SkipDeps -and -not (Test-Path -LiteralPath $puppeteer)) { Fail 'Verification failed: agent dependencies are missing.' }
    } catch {
      $problem = $_.Exception.Message
      if ($backup -and (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
        Log "Rolling back to the previous install ..." 'Yellow'
        try {
          Invoke-Robocopy @($backup, $Dest, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NP') 'Rollback'
          Log "Rollback finished; the previous install is in place. Copy kept at $backup" 'Yellow'
        } catch {
          Log "WARNING: rollback failed ($($_.Exception.Message)). Backup kept at $backup" 'Red'
        }
      }
      if (-not $depsExisted -and (Test-Path -LiteralPath (Join-Path $destAgent 'node_modules'))) {
        try { Remove-Item -LiteralPath (Join-Path $destAgent 'node_modules') -Recurse -Force } catch { }
      }
      throw $problem
    }

    # -------------------------------------------------------------- enable unsigned CEP
    foreach ($ver in 9..16) {
      $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
      try {
        if (-not (Test-Path $keyPath)) { New-Item -Path $keyPath -Force | Out-Null }
        New-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -PropertyType String -Value '1' -Force | Out-Null
      } catch {
        Log "WARNING: could not set PlayerDebugMode for CSXS.$ver : $($_.Exception.Message)" 'Yellow'
      }
    }
    Log 'PlayerDebugMode=1 set for CSXS 9-16 (current user only).'

    # -------------------------------------------------------------- prune old backups
    try {
      $old = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 2)
      foreach ($dir in $old) { Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    } catch { }

    $fileCount = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notlike '*\node_modules\*' }).Count
    Log "Installed and verified: version $installedVersion, $fileCount files, agent dependencies present." 'Green'
    Write-Host ''
    Write-Host ('  Installed: ' + $installedVersion) -ForegroundColor Green
    Write-Host ('  Folder:    ' + $Dest)
    if ($aiPids.Count -gt 0) { Write-Host '  Next: fully quit and reopen Illustrator (host scripts are cached).' }
    else { Write-Host '  Next: open Illustrator -> Window > Extensions > Vectorizer Bridge.' }
    Write-Host ('  User data: ' + $Runtime + '  (untouched)')
    Write-Host '  Written: the extension folder, HKCU CSXS.9-16 PlayerDebugMode, and the rollback copy.'
    Write-Host ''
    return 0
  } catch {
    Write-Host ''
    Write-Host ('INSTALL FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    if ($backup -and (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
      Write-Host ('A rollback copy is kept at ' + $backup) -ForegroundColor Yellow
    }
    return 1
  } finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

if ($RunAsFile) { exit $exitCode }
