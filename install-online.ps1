<#
  Mockup Studio / Vectorizer Bridge - one-line online setup (no git, no admin).

  Run from PowerShell or cmd.exe:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((irm 'https://raw.githubusercontent.com/ggmbrinde-stack/mockup-studio/main/install-online.ps1') -join [Environment]::NewLine)"

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

  # ------------------------------------------------------------------ presentation helpers
  function Fail([string]$Message) { throw $Message }
  function Rule([string]$Color = 'DarkGray') { Write-Host ('  ' + ('-' * 66)) -ForegroundColor $Color }
  function Head([string]$Title, [string]$Color = 'White') {
    Write-Host ''
    Write-Host ('  ' + $Title) -ForegroundColor $Color
  }
  function Say([string]$Message, [string]$Color = 'Gray') {
    Write-Host ('        ' + $Message) -ForegroundColor $Color
  }
  function Start-Step([int]$Number, [int]$Total, [string]$Title) {
    Write-Host ''
    Write-Host ('  [{0}/{1}] {2}' -f $Number, $Total, $Title) -ForegroundColor White
  }
  function Step-Ok([string]$Detail = 'done') {
    Write-Host ('        ok    ' + $Detail) -ForegroundColor Green
  }
  function Step-Skip([string]$Detail) {
    Write-Host ('        skip  ' + $Detail) -ForegroundColor DarkGray
  }

  # ------------------------------------------------------------------ core helpers
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
    # ---------------------------------------------------------------- welcome
    if (-not $env:APPDATA) { Fail 'APPDATA is not set; cannot locate the CEP extensions folder.' }
    $ExtensionsRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
    $Dest = Get-FullPath (Join-Path $ExtensionsRoot $ExtensionId)
    $Runtime = Get-FullPath (Join-Path $env:USERPROFILE 'Documents\VectorizerBridge')
    $BackupRoot = Get-FullPath (Join-Path $env:LOCALAPPDATA 'VectorizerBridge\install-backups')

    if (-not (Test-PathInside (Get-FullPath $ExtensionsRoot) $Dest)) {
      Fail "Refusing to install: '$Dest' is not inside the CEP extensions folder."
    }
    if ((Test-PathInside $Runtime $Dest) -or $Dest -eq $Runtime) {
      Fail "Refusing to install: '$Dest' overlaps the user runtime data folder."
    }
    $manifestDest = Join-Path $Dest 'CSXS\manifest.xml'
    $currentVersion = ''
    if (Test-Path -LiteralPath $manifestDest) { $currentVersion = Get-ManifestVersion $manifestDest }

    Write-Host ''
    Write-Host '  ==================================================================' -ForegroundColor Cyan
    Write-Host '        M O C K U P   S T U D I O' -ForegroundColor Cyan
    Write-Host '        Vectorizer Bridge  -  setup for Adobe Illustrator' -ForegroundColor Cyan
    Write-Host '  ==================================================================' -ForegroundColor Cyan
    Write-Host ''

    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

    try { $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) } catch { }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
    $npmExe = $null
    if ($npmCmd) { $npmExe = $npmCmd.Source }
    $nodeLabel = 'not found'
    if ($nodeExe) { $nodeLabel = (& $nodeExe --version) }

    Head 'This is what setup found' 'White'
    if ($currentVersion) { Say ("Panel installed   : " + $currentVersion) } else { Say 'Panel installed   : none (first install)' }
    Say ("Node.js           : " + $nodeLabel)
    if ($aiPids.Count -gt 0) { Say ("Illustrator       : running (PID " + ($aiPids -join ', ') + ")") } else { Say 'Illustrator       : not running' }
    Say ("Panel folder      : " + $Dest)
    Say ("Your own files    : " + $Runtime)
    Say '                    never written, moved or deleted by setup' 'DarkGray'

    $destAgent = Join-Path $Dest 'agent'
    $hasDeps = Test-Path -LiteralPath (Join-Path $destAgent 'node_modules\puppeteer-core')
    if (-not $hasDeps -and -not $SkipDeps -and -not $npmExe) {
      Fail ("Node.js/npm is required to install the agent dependencies and was not found.`n" +
        '  Install the Node.js LTS build from https://nodejs.org/en/download and run setup again.' +
        "`n  Nothing on this computer was changed.")
    }

    Head 'What setup will do' 'White'
    Say '1. Download the newest release from GitHub and verify its SHA-256'
    Say '2. Unpack it in a temp folder and check it before touching your install'
    Say '3. Stop the background agent if it is running'
    Say '4. Back up the version you have now (so a failure can be undone)'
    Say '5. Copy the panel in and install agent dependencies if missing'
    Say '6. Enable unsigned CEP and verify the result'
    Write-Host ''
    Write-Host '  Nothing outside the panel folder, its rollback copies and HKCU\Software\Adobe\CSXS.9-16 is touched.' -ForegroundColor DarkGray
    Write-Host ''

    # ---------------------------------------------------------------- step 1: release
    Start-Step 1 6 'Finding and downloading the release'
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    if ($Pinned) { $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Pinned" }
    $release = $null
    try {
      $release = (Get-HttpsText $apiUrl) | ConvertFrom-Json
    } catch {
      $detail = $_.Exception.Message
      if ($detail -match '404') { Fail "No published release found for '$Repo'. Nothing was changed." }
      if ($detail -match '403') { Fail 'GitHub rate limit reached while looking up the release. Wait a few minutes and run setup again. Nothing was changed.' }
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
    Say ("release $version  (" + [math]::Round($asset.size / 1024, 1) + " KB)")

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('vb-install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zipPath = Join-Path $tmp $asset.name
    try { Save-HttpsFile ([string]$asset.browser_download_url) $zipPath }
    catch { Fail "Download failed ($($_.Exception.Message)). Nothing was changed." }

    $actualSha = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $expectedSha) {
      Fail ("Checksum mismatch: expected $($expectedSha.Substring(0, 12))..., got $($actualSha.Substring(0, 12))... " +
        'The download was corrupted or tampered with. Nothing was changed.')
    }
    Step-Ok "downloaded, SHA-256 matches ($($expectedSha.Substring(0, 12))...)"

    # ---------------------------------------------------------------- step 2: validate
    Start-Step 2 6 'Checking the package before installing'
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
    Step-Ok "package is version $stagedVersion and contains every required file"

    if ($DryRun) {
      Write-Host ''
      Write-Host '  Dry run: everything checks out, and nothing was written.' -ForegroundColor Green
      Write-Host ''
      return 0
    }

    # ---------------------------------------------------------------- step 3: daemon
    Start-Step 3 6 'Stopping the background agent'
    $ctl = Join-Path $Dest 'agent\daemon\ctl.js'
    if (-not (Test-Path -LiteralPath $ctl) -or -not $nodeExe) {
      Step-Skip 'nothing to stop'
    } else {
      try { & $nodeExe $ctl stop --work $Runtime 2>&1 | ForEach-Object { Say $_ } }
      catch { Say ("warning: daemon stop failed: " + $_.Exception.Message) 'Yellow' }
      # Chrome needs a moment to flush its profile; ask a second time if it lingers.
      $daemonInfo = Join-Path $Runtime 'agent-daemon.json'
      for ($round = 0; $round -lt 2; $round++) {
        for ($i = 0; $i -lt 30; $i++) {
          if (-not (Test-Path -LiteralPath $daemonInfo)) { break }
          Start-Sleep -Milliseconds 500
        }
        if (-not (Test-Path -LiteralPath $daemonInfo)) { break }
        if ($round -eq 0) { Say 'still reporting, asking again ...' 'Yellow' }
        try { & $nodeExe $ctl stop --work $Runtime 2>&1 | ForEach-Object { Say $_ } } catch { }
      }
      if (Test-Path -LiteralPath $daemonInfo) { Say 'warning: the agent still looks active; files may be in use' 'Yellow' }
      else { Step-Ok 'agent is stopped' }
    }

    # ---------------------------------------------------------------- step 4: backup
    Start-Step 4 6 'Backing up the current install'
    $depsExisted = Test-Path -LiteralPath (Join-Path $destAgent 'node_modules')
    if (Test-Path -LiteralPath $Dest) {
      $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
      $label = 'unknown'
      if ($currentVersion) { $label = $currentVersion }
      $backup = Join-Path $BackupRoot "$label-$stamp"
      New-Item -ItemType Directory -Force -Path $backup | Out-Null
      Invoke-Robocopy @($Dest, $backup, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
        '/XD', 'agent\node_modules', 'node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile',
        '/XF', 'agent-status*.json', 'agent-daemon.json', 'agent-log.txt', 'log.txt', '*.zip') 'Backup'
      # A backup without a manifest cannot be used for rollback, so treat it as fatal.
      if (-not (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
        Fail 'Backup could not be verified (no CSXS/manifest.xml). Install manually instead. Nothing was changed.'
      }
      Step-Ok ("saved to " + $backup)
    } else {
      Step-Skip 'first install, nothing to back up'
    }

    # ---------------------------------------------------------------- step 5: copy
    Start-Step 5 6 'Installing the panel'
    try {
      New-Item -ItemType Directory -Force -Path $Dest | Out-Null
      Invoke-Robocopy @($root, $Dest, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NP',
        '/XD', 'agent\node_modules', 'node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile',
        '/XF', 'agent-status*.json', 'agent-daemon.json', 'agent-log.txt', 'log.txt', '*.zip',
        '*.md', '.gitignore', 'install.ps1', 'install-online.ps1', 'uninstall.ps1', '.DS_Store', 'Thumbs.db', 'desktop.ini') 'Copy'

      # Prune development leftovers that older installers used to mirror.
      foreach ($pattern in $StaleRootFiles) {
        Get-ChildItem -LiteralPath $Dest -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
          try { Remove-Item -LiteralPath $_.FullName -Force } catch { }
        }
      }
      Say 'panel files copied'

      $puppeteer = Join-Path $destAgent 'node_modules\puppeteer-core'
      if (-not (Test-Path -LiteralPath $puppeteer)) {
        if ($SkipDeps) {
          Say 'warning: agent dependencies skipped (VB_SKIP_AGENT_DEPS=1)' 'Yellow'
        } elseif (-not $npmExe) {
          Fail 'npm disappeared during setup; agent dependencies are missing.'
        } else {
          $npmLog = Join-Path $tmp 'npm.log'
          Say 'installing agent dependencies (npm install --omit=dev) ...'
          Push-Location $destAgent
          try { & cmd.exe /c "npm install --omit=dev --no-audit --no-fund > `"$npmLog`" 2>&1"; $npmExit = $LASTEXITCODE }
          finally { Pop-Location }
          if ($npmExit -ne 0) {
            Say 'npm output (last 15 lines):' 'Yellow'
            Get-Content -LiteralPath $npmLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say ("  " + $_) }
            Fail "npm install failed (exit $npmExit). The previous install was restored."
          }
          if (-not (Test-Path -LiteralPath $puppeteer)) { Fail 'npm reported success but puppeteer-core is missing. The previous install was restored.' }
          Say 'agent dependencies installed'
        }
      } else {
        Say 'agent dependencies already present (kept)'
      }

      # -------------------------------------------------------------- verify before claiming success
      $installedVersion = Get-ManifestVersion $manifestDest
      if ($installedVersion -ne $version) {
        Fail "Verification failed: installed manifest reports '$installedVersion', expected '$version'."
      }
      $missingNow = @($Required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Dest $_)) })
      if ($missingNow.Count -gt 0) { Fail ('Verification failed; missing: ' + ($missingNow -join ', ')) }
      if (-not $SkipDeps -and -not (Test-Path -LiteralPath $puppeteer)) { Fail 'Verification failed: agent dependencies are missing.' }
      Step-Ok "version $installedVersion, all required files present"
    } catch {
      $problem = $_.Exception.Message
      if ($backup -and (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
        Say 'rolling back to the previous install ...' 'Yellow'
        try {
          Invoke-Robocopy @($backup, $Dest, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NP') 'Rollback'
          Say ("restored. The copy is kept at " + $backup) 'Yellow'
        } catch {
          Say ("warning: rollback failed ($($_.Exception.Message)). Backup kept at " + $backup) 'Red'
        }
      }
      if (-not $depsExisted -and (Test-Path -LiteralPath (Join-Path $destAgent 'node_modules'))) {
        try { Remove-Item -LiteralPath (Join-Path $destAgent 'node_modules') -Recurse -Force } catch { }
      }
      throw $problem
    }

    # ---------------------------------------------------------------- step 6: enable + verify
    Start-Step 6 6 'Enabling the panel in Illustrator'
    foreach ($ver in 9..16) {
      $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
      try {
        if (-not (Test-Path $keyPath)) { New-Item -Path $keyPath -Force | Out-Null }
        New-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -PropertyType String -Value '1' -Force | Out-Null
      } catch {
        Say ("warning: could not set PlayerDebugMode for CSXS.$ver : " + $_.Exception.Message) 'Yellow'
      }
    }
    Step-Ok 'unsigned CEP enabled for CSXS 9-16 (current user only)'

    # Keep the two newest rollback copies so repeated runs cannot pile up.
    try {
      $old = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 2)
      foreach ($dir in $old) { Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    } catch { }

    $fileCount = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notlike '*\node_modules\*' }).Count
    $depCount = @(Get-ChildItem -LiteralPath (Join-Path $destAgent 'node_modules') -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike '.*' }).Count

    # ---------------------------------------------------------------- done
    Write-Host ''
    Write-Host '  ==================================================================' -ForegroundColor Green
    $wasUpdate = [bool]($currentVersion -and $currentVersion -ne $version)
    if ($wasUpdate) { Write-Host ('        SETUP COMPLETE   ' + $currentVersion + '  ->  ' + $version) -ForegroundColor Green }
    else { Write-Host ('        SETUP COMPLETE   version ' + $version) -ForegroundColor Green }
    Write-Host '  ==================================================================' -ForegroundColor Green
    Write-Host ''
    Say ("Panel folder  : " + $Dest)
    Say ("Files         : " + $fileCount)
    Say ("Agent         : " + $depCount + " packages")
    Say ("Your own files: " + $Runtime + "  (untouched)")
    Write-Host ''
    Head 'Open the panel' 'White'
    if ($aiPids.Count -gt 0) {
      Say '1. Fully QUIT Illustrator (it caches panel scripts), then open it again.'
      Say '2. Window > Extensions > Vectorizer Bridge.'
    } else {
      Say '1. Open Adobe Illustrator.'
      Say '2. Window > Extensions > Vectorizer Bridge.'
    }
    Say '3. Sign in to vectorizer.ai once, on first use.' 'DarkGray'
    Write-Host ''
    Write-Host '  Undo: re-run this setup with an older VB_INSTALL_VERSION, or use install.ps1 / uninstall.ps1 from the repo.' -ForegroundColor DarkGray
    Write-Host ''
    return 0
  } catch {
    Write-Host ''
    Write-Host '  ==================================================================' -ForegroundColor Red
    Write-Host '        SETUP FAILED' -ForegroundColor Red
    Write-Host '  ==================================================================' -ForegroundColor Red
    Write-Host ''
    foreach ($line in ([string]$_.Exception.Message -split "`n")) { Write-Host ('  ' + $line) -ForegroundColor Red }
    if ($backup -and (Test-Path -LiteralPath (Join-Path $backup 'CSXS\manifest.xml'))) {
      Write-Host ''
      Write-Host ('  A rollback copy is kept at ' + $backup) -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '  Nothing in Documents\VectorizerBridge was changed.' -ForegroundColor DarkGray
    Write-Host ''
    return 1
  } finally {
    if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

if ($RunAsFile) { exit $exitCode }
