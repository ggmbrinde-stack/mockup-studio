<#
  Mockup Studio / Vectorizer Bridge - one-line online setup (no git, no admin).

  Run from PowerShell or cmd.exe:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((irm 'https://raw.githubusercontent.com/ggmbrinde-stack/mockup-studio/main/install-online.ps1') -join [Environment]::NewLine)"

  WHAT IT DOES
    - Downloads the latest published GitHub release .zip and verifies its SHA-256 digest.
    - Unpacks into a temp folder and validates it (manifest version + required files)
      BEFORE the installed extension is touched at all.
    - If Node.js is missing and the agent needs it, installs the official Node.js LTS
      Windows build into your own AppData (verified against nodejs.org's SHASUMS256.txt,
      no admin, no PATH change). The panel already looks for it there.
    - Stops the warm agent daemon, backs up the current install, copies the new files in,
      installs agent dependencies when they are missing, enables PlayerDebugMode for
      CSXS 9-16, then verifies the installed result.
    - Any failure after the copy step restores the backup automatically.

  SAFETY CONTRACT (nothing outside these paths is written or deleted)
    %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge   the extension itself
    %LOCALAPPDATA%\VectorizerBridge\install-backups\                  rollback copies (last 2)
    %LOCALAPPDATA%\Programs\nodejs\                                   private Node.js LTS, only
                                                                      when Node is missing
    HKCU\Software\Adobe\CSXS.9-16  ->  PlayerDebugMode = 1            (unsigned CEP only)

    - %USERPROFILE%\Documents\VectorizerBridge is never written, moved or deleted. The only
      thing done there is asking the agent's own control script to stop the warm daemon.
    - The extension folder is never deleted. Files are copied over it additively.
    - No admin/elevation, no PATH edits, no other registry keys, no scheduled tasks.
    - Nothing installed by setup is deleted; an existing newer Node.js is left alone.
    - It aborts BEFORE changing anything when the download or digest check fails, when the
      archive is invalid, when a private Node copy is too old for the agent, or when the
      target path is not the CEP extension folder.

  OPTIONAL OVERRIDES (testing)
    VB_REPO, VB_INSTALL_VERSION, VB_DRY_RUN=1, VB_SKIP_AGENT_DEPS=1,
    VB_NODE_DIR, VB_FORCE_NODE_SETUP=1
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
  $ForceNode = ($env:VB_FORCE_NODE_SETUP -eq '1')

  $Required = @('index.html', 'host\core.jsx', 'host\place.jsx', 'js\bridge\host.js', 'agent\run.js')
  $StaleRootFiles = @('*.md', '.gitignore', 'install.ps1', 'install-online.ps1', 'uninstall.ps1')

  # ------------------------------------------------------------------ presentation helpers
  # A compact console UI: a short banner, one line per finished step, and ONE live line at
  # the bottom (current step + progress bar) that is rewritten in place. No dependencies, no
  # ANSI: colours come from Write-Host, positioning from a carriage return. When the output
  # is redirected, the host is not the console (ISE/remote) or VB_NO_UI=1, it degrades to
  # plain appended lines, so logs and the dry-run tests stay readable.
  $script:UiPlain = $false
  $script:UiUnicode = $false
  $script:UiWidth = 78
  $script:UiStep = $null
  $script:UiDone = 0
  $script:UiTotal = 7

  function Initialize-Ui {
    $redirected = $false
    try { $redirected = [bool][Console]::IsOutputRedirected } catch { }
    $hostName = ''
    try { $hostName = [string]$Host.Name } catch { }
    $script:UiPlain = ($redirected -or $env:VB_NO_UI -eq '1' -or $hostName -ne 'ConsoleHost')
    try { $script:UiWidth = [int][Math]::Max(40, [Math]::Min(86, [Console]::BufferWidth - 1)) } catch { $script:UiWidth = 78 }
    if ($script:UiPlain) { $script:UiUnicode = $false; return }
    try {
      # Box-drawing and check glyphs need a UTF-8 console. Windows Terminal is safe; a
      # legacy CP850/437 console is not, so it keeps the ASCII fallback.
      $script:UiUnicode = (([int][Console]::OutputEncoding.CodePage) -eq 65001) -or [bool]$env:WT_SESSION -or [bool]$env:TERM_PROGRAM
    } catch { $script:UiUnicode = $false }
  }
  function Ui-Bar([int]$Done, [int]$Total) {
    $slots = 16
    if ($Total -le 0) { $Total = 1 }
    $filled = [int][Math]::Round($slots * ($Done / [double]$Total))
    if ($filled -gt $slots) { $filled = $slots }
    if ($filled -lt 0) { $filled = 0 }
    $on = '#'
    $off = '-'
    if ($script:UiUnicode) { $on = [string][char]0x2588; $off = [string][char]0x2591 }
    return ($on * $filled) + ($off * ($slots - $filled))
  }
  function Write-UiLine([string]$Text, [string]$Color = 'Gray') {
    if ($script:UiPlain) { return }
    if ($null -eq $Text) { $Text = '' }
    if ($Text.Length -gt $script:UiWidth) { $Text = $Text.Substring(0, $script:UiWidth) }
    else { $Text = $Text + (' ' * ($script:UiWidth - $Text.Length)) }
    Write-Host ("`r" + $Text) -NoNewline -ForegroundColor $Color
  }
  function Clear-UiLine {
    if ($script:UiPlain) { return }
    # Blank the row, then return to column 0: without the carriage return the next line
    # starts at the end of the padded row and loses its leading spaces.
    Write-UiLine '' 'Gray'
    Write-Host "`r" -NoNewline
  }
  function Render-UiStep {
    if ($script:UiPlain -or -not $script:UiStep) { return }
    $line = '  > ' + $script:UiStep.Number + '  ' + $script:UiStep.Title
    if ($script:UiStep.Detail) { $line = $line + '  -  ' + $script:UiStep.Detail }
    $line = $line + '   [' + (Ui-Bar $script:UiDone $script:UiTotal) + '] ' + $script:UiDone + '/' + $script:UiTotal
    Write-UiLine $line 'Cyan'
  }
  function Format-UiStep([string]$Mark, [int]$Number, [string]$Title, [string]$Detail) {
    # Give the title as much room as the window allows, but never let it crowd out the
    # detail: 34 columns of detail is what the longest results need.
    $titleWidth = [int][Math]::Max(18, [Math]::Min(40, $script:UiWidth - 36))
    $t = $Title
    if ($t.Length -gt $titleWidth) {
      $ellipsis = '.'
      if ($script:UiUnicode) { $ellipsis = [string][char]0x2026 }
      $t = $t.Substring(0, $titleWidth - 1) + $ellipsis
    }
    $line = '  ' + $Mark + ' ' + [string]$Number + '  ' + $t.PadRight($titleWidth + 2)
    if ($Detail) { $line = $line + ' ' + $Detail }
    return $line.TrimEnd()
  }
  function Complete-UiStep([string]$Kind, [string]$Detail, [string]$Color) {
    if (-not $script:UiStep) { Write-Host ('        ' + $Detail) -ForegroundColor $Color; return }
    $script:UiDone = [int][Math]::Max($script:UiDone, $script:UiStep.Number)
    $mark = '+'
    if ($Kind -eq 'skip') { $mark = '-' }
    elseif ($script:UiUnicode) { $mark = [string][char]0x2713 }
    if ($script:UiPlain) {
      Write-Host ('        ' + $Kind + '  ' + $Detail) -ForegroundColor $Color
    } else {
      Clear-UiLine
      Write-Host (Format-UiStep $mark $script:UiStep.Number $script:UiStep.Title $Detail) -ForegroundColor $Color
    }
    $script:UiStep = $null
  }
  function Fail([string]$Message) { throw $Message }
  function Head([string]$Title, [string]$Color = 'White') {
    Clear-UiLine
    Write-Host ''
    Write-Host ('  ' + $Title) -ForegroundColor $Color
  }
  function Say([string]$Message, [string]$Color = 'Gray') {
    if (-not $script:UiStep) { Write-Host ('  ' + $Message) -ForegroundColor $Color; return }
    $script:UiStep.Detail = [string]$Message
    if ($script:UiPlain) { Write-Host ('        ' + $Message) -ForegroundColor $Color; return }
    Render-UiStep
  }
  function Start-Step([int]$Number, [int]$Total, [string]$Title) {
    $script:UiTotal = $Total
    $script:UiStep = @{ Number = $Number; Title = $Title; Detail = '' }
    if ($script:UiPlain) { Write-Host ''; Write-Host ('  [' + $Number + '/' + $Total + '] ' + $Title) -ForegroundColor White; return }
    Render-UiStep
  }
  function Step-Ok([string]$Detail = 'done') { Complete-UiStep 'ok' $Detail 'Green' }
  function Step-Skip([string]$Detail) { Complete-UiStep 'skip' $Detail 'DarkGray' }

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
  # Get-Command npm can resolve to npm.ps1 (scoop, nvm, some Node installers). cmd.exe cannot
  # run a PowerShell script: it does nothing and still exits 0, which looked exactly like a
  # successful dependency install. Map that case to the sibling npm.cmd, or to the bare name so
  # cmd resolves the shim itself.
  function Get-RunnableNpm([string]$Source) {
    if (-not $Source) { return 'npm' }
    if ($Source.ToLowerInvariant().EndsWith('.ps1')) {
      $candidate = [IO.Path]::ChangeExtension($Source, '.cmd')
      if (Test-Path -LiteralPath $candidate) { return $candidate }
      return 'npm'
    }
    return $Source
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
  function Get-NodeVersion([string]$NodePath) {
    try {
      if (-not (Test-Path -LiteralPath $NodePath)) { return '' }
      $v = & $NodePath --version 2>$null
      if ("$v" -match '^v\d+\.\d+\.\d+') { return [string]$v }
    } catch { }
    return ''
  }
  function Test-NodeSupportsDeps([string]$Version) {
    if ("$Version" -notmatch '^v(\d+)\.(\d+)\.') { return $false }
    $major = [int]$Matches[1]; $minor = [int]$Matches[2]
    return (($major -gt 22) -or ($major -eq 22 -and $minor -ge 12))
  }

  # Which Illustrator will actually load this panel? CEP reports a host version
  # (Illustrator 2025 = 29.0, 2026 = 30.0), not the marketing year, so compare the
  # major version against the range the release's manifest lists.
  function Get-IllustratorInstalls {
    $found = @()
    $keys = @(
      'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($key in $keys) {
      $items = @()
      try { $items = @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue) } catch { $items = @() }
      foreach ($item in $items) {
        $name = ''
        try { $name = [string]$item.DisplayName } catch { }
        if ($name -notmatch '^Adobe Illustrator') { continue }
        $raw = ''
        try { $raw = [string]$item.DisplayVersion } catch { }
        $major = 0
        try { $major = [int](([string]$raw) -split '\.')[0] } catch { $major = 0 }
        if ($major -le 0) { continue }
        $found += [pscustomobject]@{ Name = $name; Version = $raw; Major = $major }
      }
    }
    # The registry misses installs that were side-loaded or whose uninstall entry was
    # removed; the program folder name carries the year (Illustrator 2025 = host 29).
    foreach ($base in @((Join-Path $env:ProgramFiles 'Adobe'), (Join-Path ${env:ProgramFiles(x86)} 'Adobe'))) {
      if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
      foreach ($dir in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
        if ($dir.Name -notmatch '^Adobe Illustrator (\d{4})$') { continue }
        $majorFromYear = [int]$Matches[1] - 1996
        if ($majorFromYear -le 0) { continue }
        $found += [pscustomobject]@{ Name = $dir.Name; Version = ([string]$Matches[1]); Major = $majorFromYear }
      }
    }
    # The same release is listed under the 64-bit and 32-bit keys; report it once.
    $seen = @{}
    $unique = @()
    foreach ($item in $found) {
      $key = [string]$item.Major
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = $true
      $unique += $item
    }
    return @($unique | Sort-Object Major -Descending)
  }
  function Get-ManifestHostRange([string]$ManifestPath) {
    try {
      $text = [IO.File]::ReadAllText($ManifestPath)
      $m = [regex]::Match($text, 'Name="ILST"\s+Version="\[([0-9.]+),\s*([0-9.]+)\]"')
      if ($m.Success) { return @([double]$m.Groups[1].Value, [double]$m.Groups[2].Value) }
    } catch { }
    return @(0, 999)
  }

  $tmp = $null
  $backup = $null
  $depsExisted = $false
  $nodeExe = $null
  $npmExe = $null
  $aiPids = @()

  try {
    # ---------------------------------------------------------------- welcome
    if (-not $env:APPDATA) { Fail 'APPDATA is not set; cannot locate the CEP extensions folder.' }
    $ExtensionsRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
    $Dest = Get-FullPath (Join-Path $ExtensionsRoot $ExtensionId)
    $Runtime = Get-FullPath (Join-Path $env:USERPROFILE 'Documents\VectorizerBridge')
    $BackupRoot = Get-FullPath (Join-Path $env:LOCALAPPDATA 'VectorizerBridge\install-backups')
    $NodeDir = Get-FullPath (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
    if ($env:VB_NODE_DIR) { $NodeDir = Get-FullPath $env:VB_NODE_DIR }

    if (-not (Test-PathInside (Get-FullPath $ExtensionsRoot) $Dest)) {
      Fail "Refusing to install: '$Dest' is not inside the CEP extensions folder."
    }
    if ((Test-PathInside $Runtime $Dest) -or $Dest -eq $Runtime) {
      Fail "Refusing to install: '$Dest' overlaps the user runtime data folder."
    }
    $manifestDest = Join-Path $Dest 'CSXS\manifest.xml'
    $currentVersion = ''
    if (Test-Path -LiteralPath $manifestDest) { $currentVersion = Get-ManifestVersion $manifestDest }

    Initialize-Ui
    Write-Host ''
    Write-Host '  MOCKUP STUDIO' -ForegroundColor Cyan -NoNewline
    Write-Host '   Vectorizer Bridge for Illustrator' -ForegroundColor DarkGray
    Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray

    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

    try { $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) } catch { }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
    if ($npmCmd) { $npmExe = Get-RunnableNpm $npmCmd.Source }
    $nodeLabel = 'not found'
    if ($nodeExe) { $nodeLabel = (& $nodeExe --version) }
    $nodeVersion = $nodeLabel

    $destAgent = Join-Path $Dest 'agent'
    $hasDeps = Test-Path -LiteralPath (Join-Path $destAgent 'node_modules\puppeteer-core')

    $panelState = 'first install'
    if ($currentVersion) { $panelState = 'installed ' + $currentVersion }
    $nodeState = 'not found - a private copy will be installed (no admin)'
    if ($nodeExe) { $nodeState = [string]$nodeLabel }
    if ($SkipDeps) { $nodeState = 'not needed (agent dependencies skipped)' }
    $aiFound = @(Get-IllustratorInstalls)
    $aiState = 'none detected'
    if ($aiFound.Count -gt 0) {
      $aiState = $aiFound[0].Name + ' (' + $aiFound[0].Version + ')'
      if ($aiFound.Count -gt 1) { $aiState = $aiState + '  +' + [string]($aiFound.Count - 1) }
    }
    if ($aiPids.Count -gt 0) { $aiState = $aiState + '  - running' }
    Write-Host ('  ' + 'Panel'.PadRight(13) + $panelState)
    Write-Host ('  ' + 'Illustrator'.PadRight(13) + $aiState)
    Write-Host ('  ' + 'Node.js'.PadRight(13) + $nodeState)
    Write-Host ('  ' + 'Your files'.PadRight(13) + $Runtime) -ForegroundColor DarkGray
    Write-Host ('  ' + ''.PadRight(13) + 'never written, moved or deleted by setup') -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Nothing outside the panel folder, its rollback copies, the private Node.js copy' -ForegroundColor DarkGray
    Write-Host '  and HKCU\Software\Adobe\CSXS.9-16 is touched.' -ForegroundColor DarkGray
    Write-Host ''

    # ---------------------------------------------------------------- step 1: release
    Start-Step 1 7 'Finding and downloading the release'
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
    Start-Step 2 7 'Checking the package before installing'
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

    # The release only loads in the Illustrator hosts its manifest lists. Name what was found
    # instead of installing into silence (an unsupported panel never appears in the menu).
    $hostRange = Get-ManifestHostRange (Join-Path $root 'CSXS\manifest.xml')
    $installs = @(Get-IllustratorInstalls)
    $supportedInstalls = @($installs | Where-Object { $_.Major -ge $hostRange[0] -and $_.Major -le $hostRange[1] })
    $unsupported = @($installs | Where-Object { $_.Major -lt $hostRange[0] -or $_.Major -gt $hostRange[1] })
    $aiNote = 'no Illustrator detected'
    if ($supportedInstalls.Count -gt 0) {
      $primary = $supportedInstalls[0]
      $aiNote = 'Illustrator ' + [string]$primary.Version + ' supported'
      if ($supportedInstalls.Count -gt 1) { $aiNote = $aiNote + ' +' + [string]($supportedInstalls.Count - 1) }
      if ($unsupported.Count -gt 0) { $aiNote = $aiNote + '; older versions ignored' }
    } elseif ($installs.Count -gt 0) {
      $list = ($installs | ForEach-Object { $_.Name + ' (' + $_.Version + ')' }) -join ', '
      $needYear = [int]$hostRange[0] + 1996
      Fail ("This release needs Illustrator " + [string]$needYear + " (" + [string]$hostRange[0] + ".0) or newer, but this computer has: " + $list + ".`n  Install Illustrator " + [string]$needYear + " or newer and run setup again. Nothing was changed.")
    } else {
      $aiNote = 'no Illustrator yet - the panel needs Illustrator ' + [string]([int]$hostRange[0] + 1996) + '+' 
    }
    Step-Ok ('v' + $stagedVersion + ' - ' + $aiNote)

    if ($DryRun) {
      Write-Host ''
      Write-Host '  Dry run: everything checks out, and nothing was written.' -ForegroundColor Green
      Write-Host ''
      return 0
    }

    # ---------------------------------------------------------------- step 3: node
    Start-Step 3 7 'Preparing Node.js'
    $privateNode = Join-Path $NodeDir 'node.exe'
    $privateNpm = Join-Path $NodeDir 'npm.cmd'
    if ($nodeExe -and -not $ForceNode) {
      Step-Ok ("using the Node.js already on this computer (" + $nodeLabel + ")")
    } elseif ($SkipDeps -and -not $ForceNode) {
      Step-Skip 'agent dependencies are being skipped'
    } else {
      $privateVersion = Get-NodeVersion $privateNode
      if ($privateVersion -and -not $ForceNode) {
        if (-not (Test-NodeSupportsDeps $privateVersion)) {
          Fail ("A Node.js $privateVersion copy sits in $NodeDir but the agent needs 22.12 or newer.`n" +
            "  Install Node.js 22 LTS from https://nodejs.org/en/download and run setup again.`n" +
            '  Nothing on this computer was changed.')
        }
        $nodeExe = $privateNode
        if (Test-Path -LiteralPath $privateNpm) { $npmExe = $privateNpm }
        $nodeVersion = $privateVersion
        Step-Ok ("using the private copy already in your AppData (" + $privateVersion + ")")
      } else {
        Say 'not found, downloading the official Node.js LTS build (about 30 MB) ...'
        $releases = $null
        try { $releases = (Get-HttpsText 'https://nodejs.org/dist/index.json') | ConvertFrom-Json }
        catch { Fail ("Could not reach nodejs.org ($($_.Exception.Message)). Install Node.js 22 LTS from https://nodejs.org/en/download and run setup again. Nothing was changed.") }
        $lts = @($releases | Where-Object { $_.lts }) | Select-Object -First 1
        if (-not $lts -or -not $lts.version) { Fail 'nodejs.org did not report a Node.js LTS release. Nothing was changed.' }
        $nodeVer = [string]$lts.version
        $nodeZipName = "node-$nodeVer-win-x64.zip"
        $sums = Get-HttpsText ("https://nodejs.org/dist/" + $nodeVer + "/SHASUMS256.txt")
        $sumLine = @(($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($nodeZipName) }) | Select-Object -First 1
        if (-not $sumLine -or $sumLine -notmatch '^([0-9a-fA-F]{64})') {
          Fail "nodejs.org published no SHA-256 for $nodeZipName. Refusing an unverified download. Nothing was changed."
        }
        $nodeSha = $Matches[1].ToLowerInvariant()
        $nodeZip = Join-Path $tmp $nodeZipName
        try { Save-HttpsFile ("https://nodejs.org/dist/" + $nodeVer + "/" + $nodeZipName) $nodeZip }
        catch { Fail ("The Node.js download failed ($($_.Exception.Message)). Install Node.js 22 LTS from https://nodejs.org/en/download and run setup again. Nothing was changed.") }
        $nodeActual = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($nodeActual -ne $nodeSha) {
          Fail 'The Node.js download failed its checksum check. Nothing was changed.'
        }
        $nodeStage = Join-Path $tmp 'node-stage'
        [IO.Directory]::CreateDirectory($nodeStage) | Out-Null
        [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $nodeStage)
        $nodeInner = @(Get-ChildItem -LiteralPath $nodeStage -Directory) | Select-Object -First 1
        if (-not $nodeInner -or -not (Test-Path -LiteralPath (Join-Path $nodeInner.FullName 'node.exe'))) {
          Fail 'The Node.js package did not contain node.exe. Nothing was changed.'
        }
        New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
        Invoke-Robocopy @($nodeInner.FullName, $NodeDir, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NP') 'Node.js copy'
        $nodeVersion = Get-NodeVersion $privateNode
        if (-not $nodeVersion) { Fail ("Node.js was copied to $NodeDir but it does not run. Nothing else was changed.") }
        $nodeExe = $privateNode
        if (Test-Path -LiteralPath $privateNpm) { $npmExe = $privateNpm }
        Step-Ok ("installed Node.js $nodeVersion privately in your AppData (no admin, no PATH change)")
      }
    }

    # ---------------------------------------------------------------- step 4: daemon
    Start-Step 4 7 'Stopping the background agent'
    $ctl = Join-Path $Dest 'agent\daemon\ctl.js'
    if (-not (Test-Path -LiteralPath $ctl) -or -not $nodeExe) {
      Step-Skip 'nothing to stop'
    } else {
      # The control script answers with JSON; that is noise in the status line, so only a
      # failure is surfaced.
      Say 'asking the agent to stop ...'
      try { $null = & $nodeExe $ctl stop --work $Runtime 2>&1 }
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
        try { $null = & $nodeExe $ctl stop --work $Runtime 2>&1 } catch { }
      }
      if (Test-Path -LiteralPath $daemonInfo) { Say 'warning: the agent still looks active; files may be in use' 'Yellow' }
      else { Step-Ok 'agent is stopped' }
    }

    # ---------------------------------------------------------------- step 5: backup
    Start-Step 5 7 'Backing up the current install'
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

    # ---------------------------------------------------------------- step 6: copy
    Start-Step 6 7 'Installing the panel'
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
          Fail 'npm was not found, so the agent dependencies cannot be installed.'
        } else {
          $npmLog = Join-Path $tmp 'npm.log'
          Say 'installing agent dependencies (npm install --omit=dev) ...'
          Push-Location $destAgent
          try { & cmd.exe /c "`"$npmExe`" install --omit=dev --no-audit --no-fund > `"$npmLog`" 2>&1"; $npmExit = $LASTEXITCODE }
          finally { Pop-Location }
          if ($npmExit -ne 0) {
            Say 'npm output (last 15 lines):' 'Yellow'
            Get-Content -LiteralPath $npmLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say ("  " + $_) }
            Fail "npm install failed (exit $npmExit). The previous install was restored."
          }
          if (-not (Test-Path -LiteralPath $puppeteer)) {
            Say 'npm output (last 15 lines):' 'Yellow'
            Get-Content -LiteralPath $npmLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say ("  " + $_) }
            Fail ('npm exited 0 but puppeteer-core is still missing (npm at ' + [string]$npmExe + '). The previous install was restored.')
          }
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

    # ---------------------------------------------------------------- step 7: enable + verify
    Start-Step 7 7 'Enabling the panel in Illustrator'
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
    Clear-UiLine
    Write-Host ''
    $wasUpdate = [bool]($currentVersion -and $currentVersion -ne $version)
    $headline = 'installed ' + $version
    if ($wasUpdate) { $headline = 'updated ' + $currentVersion + ' -> ' + $version }
    $summary = [string]$fileCount + ' files'
    if ($depCount -gt 0) { $summary = $summary + ' - ' + [string]$depCount + ' agent packages' }
    if ($nodeExe) { $summary = $summary + ' - Node.js ' + [string]$nodeVersion }
    Write-Host ('  ' + $headline.Substring(0, 1).ToUpper() + $headline.Substring(1)) -ForegroundColor Green -NoNewline
    Write-Host ('   ' + $summary) -ForegroundColor DarkGray
    Write-Host ('  ' + $Dest) -ForegroundColor DarkGray
    Write-Host ''
    if ($aiPids.Count -gt 0) {
      Write-Host '  Save your open documents first: restarting Illustrator closes every open file.' -ForegroundColor Yellow
      Write-Host '  Then restart Illustrator and open Window > Extensions > Vectorizer Bridge.' -ForegroundColor White
    } else {
      Write-Host '  Open Illustrator, then Window > Extensions > Vectorizer Bridge.' -ForegroundColor White
    }
    Write-Host '  The panel runs a short first-time setup: language, sign in, defaults.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Undo: set VB_INSTALL_VERSION to an older release and re-run, or use uninstall.ps1.' -ForegroundColor DarkGray
    Write-Host ''
    return 0
  } catch {
    Clear-UiLine
    Write-Host ''
    Write-Host '  Setup failed' -ForegroundColor Red
    Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray
    foreach ($line in ([string]$_.Exception.Message -split "`n")) { Write-Host ('  ' + $line.TrimEnd()) -ForegroundColor Red }
    if ($script:UiStep -and $script:UiStep.Detail) {
      Write-Host ''
      Write-Host ('  Last step: ' + $script:UiStep.Number + '  ' + $script:UiStep.Title) -ForegroundColor DarkGray
      Write-Host ('             ' + $script:UiStep.Detail) -ForegroundColor DarkGray
    }
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
