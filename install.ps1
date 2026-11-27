<#
.SYNOPSIS
  Installs or updates the Mockup Studio CEP extension for the current user.
.DESCRIPTION
  Mirrors only the runtime extension files (index.html, CSXS, css, host, js, modules, agent)
  into %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge, installs agent
  dependencies when missing, enables PlayerDebugMode for CSXS 9-16 and verifies the result.
  Development files (docs, .gitignore, installers) are not copied and stale copies are pruned.
  Never touches %USERPROFILE%\Documents\VectorizerBridge (user runtime data).

  The agent needs Node.js. When the PC has none, setup downloads the official Node.js LTS
  Windows build, checks it against nodejs.org's SHASUMS256.txt and unpacks it into
  %LOCALAPPDATA%\Programs\nodejs - a folder the panel already searches - so no admin rights
  and no PATH change are needed. An existing Node.js is preferred and never touched.

  Uses a compact step UI: one line per finished step and a live progress row while a step
  runs. When the output is redirected (logs, CI, the .cmd piping) or VB_NO_UI=1 is set, it
  degrades to plain appended lines.
.PARAMETER Force
  Install even while Illustrator is running. Illustrator caches host scripts, so it must be
  restarted afterwards. Without -Force a running Illustrator aborts the install.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
.EXAMPLE
  .\install.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ExtensionId = 'com.bestofgifts.vectorizerbridge'
$Source = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$Dest = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtensionId")).TrimEnd('\')
$RuntimeDir = Join-Path $env:USERPROFILE 'Documents\VectorizerBridge'

# ------------------------------------------------------------------ console UI
# Same presentation as install-online.ps1: a live step line while work runs, then one compact
# line per finished step. No ANSI: colours come from Write-Host, positioning from a carriage
# return. uiPlain is forced when the output is redirected, the host is not ConsoleHost or
# VB_NO_UI=1, so logs and the automated tests stay readable.
$script:UiPlain = $false
$script:UiUnicode = $false
$script:UiWidth = 78
$script:UiStep = $null
$script:UiDone = 0
$script:UiTotal = 6

function Initialize-Ui {
  $redirected = $false
  try { $redirected = [bool][Console]::IsOutputRedirected } catch { }
  $hostName = ''
  try { $hostName = [string]$Host.Name } catch { }
  $script:UiPlain = ($redirected -or $env:VB_NO_UI -eq '1' -or $hostName -ne 'ConsoleHost')
  try { $script:UiWidth = [int][Math]::Max(40, [int][Math]::Min(86, [Console]::BufferWidth - 1)) } catch { $script:UiWidth = 78 }
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
  $titleWidth = [int][Math]::Max(18, [int][Math]::Min(40, $script:UiWidth - 36))
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
  elseif ($Kind -eq 'fail') { $mark = 'x' }
  elseif ($script:UiUnicode) { $mark = [string][char]0x2713 }
  if ($script:UiPlain) {
    Write-Host ('        ' + $Kind + '  ' + $Detail) -ForegroundColor $Color
  } else {
    Clear-UiLine
    Write-Host (Format-UiStep $mark $script:UiStep.Number $script:UiStep.Title $Detail) -ForegroundColor $Color
  }
  $script:UiStep = $null
}
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
function Step-Fail([string]$Detail) { Complete-UiStep 'fail' $Detail 'Red' }
function Note([string]$Message, [string]$Color = 'DarkGray') { Write-Host ('  ' + $Message) -ForegroundColor $Color }

# ------------------------------------------------------------------ https helpers
# Windows PowerShell 5.1 negotiates TLS 1.0 by default on older builds, which nodejs.org
# rejects; asking for TLS 1.2 explicitly keeps the Node.js bootstrap working there.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
function Get-HttpsText([string]$Url) {
  $headers = @{ 'User-Agent' = 'MockupStudio-Installer' }
  return (Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $headers -TimeoutSec 60).Content
}
function Save-HttpsFile([string]$Url, [string]$OutFile) {
  $headers = @{ 'User-Agent' = 'MockupStudio-Installer' }
  Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $headers -OutFile $OutFile -TimeoutSec 300
}

Initialize-Ui
Head 'Mockup Studio - installing for the current user'
Note "source: $Source"
Note "target: $Dest"
Write-Host ''

try {
  # ---------------------------------------------------------------- 1. Illustrator
  Start-Step 1 6 'Checking Illustrator'

  # Guard: install.ps1 used to be shipped inside the extension, so it could be run from the
  # installed folder. Mirroring a folder onto itself makes robocopy exit 16 with a vague error.
  if ($Source -eq $Dest) {
    throw "Refusing to install: source and destination are the same folder ($Dest). Run install.ps1 from the repository or unzipped source, not from the installed extension."
  }
  if (-not (Test-Path (Join-Path $Source 'CSXS\manifest.xml'))) {
    throw "Source manifest not found: $(Join-Path $Source 'CSXS\manifest.xml'). Run install.ps1 from the extension source folder."
  }

  # The manifest lists the Illustrator hosts this build loads in (2025 = ILST 29.0). Report
  # the installed Illustrator versions so an unsupported one is explained before, not after.
  $manifestText = Get-Content -LiteralPath (Join-Path $Source 'CSXS\manifest.xml') -Raw
  $hostMin = 0; $hostMax = 999
  $rangeMatch = [regex]::Match($manifestText, 'Name="ILST"\s+Version="\[([0-9.]+),\s*([0-9.]+)\]"')
  if ($rangeMatch.Success) {
    $hostMin = [double]$rangeMatch.Groups[1].Value
    $hostMax = [double]$rangeMatch.Groups[2].Value
  }
  $aiVersions = @()
  $aiSupported = @()
  foreach ($key in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    try {
      $items = @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue)
    } catch { $items = @() }
    foreach ($item in $items) {
      $name = ''
      try { $name = [string]$item.DisplayName } catch { }
      if ($name -notmatch '^Adobe Illustrator') { continue }
      $raw = ''
      try { $raw = [string]$item.DisplayVersion } catch { }
      $major = 0
      try { $major = [int](([string]$raw) -split '\.')[0] } catch { $major = 0 }
      if ($major -le 0) { continue }
      $label = $name + ' (' + $raw + ')'
      if ($aiVersions -notcontains $label) { $aiVersions += $label }
      if ($major -ge $hostMin -and $major -le $hostMax) { if ($aiSupported -notcontains $label) { $aiSupported += $label } }
    }
  }
  # Side-loaded installs and removed uninstall entries only show up as program folders;
  # the folder name carries the year (Illustrator 2025 = host 29).
  foreach ($base in @((Join-Path $env:ProgramFiles 'Adobe'), (Join-Path ${env:ProgramFiles(x86)} 'Adobe'))) {
    if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
    foreach ($dir in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
      if ($dir.Name -notmatch '^Adobe Illustrator (\d{4})$') { continue }
      $majorFromYear = [int]$Matches[1] - 1996
      if ($majorFromYear -le 0) { continue }
      $label = $dir.Name + ' (' + [string]$majorFromYear + '.x)'
      if ($aiVersions -notcontains $label) { $aiVersions += $label }
      if ($majorFromYear -ge $hostMin -and $majorFromYear -le $hostMax) { if ($aiSupported -notcontains $label) { $aiSupported += $label } }
    }
  }

  $aiYears = @()
  foreach ($label in $aiSupported) {
    if ($label -match '(\d{4})') { if ($aiYears -notcontains $Matches[1]) { $aiYears += $Matches[1] } }
  }
  $aiYears = @($aiYears | Sort-Object)
  if ($aiSupported.Count -gt 0) {
    Step-Ok ('Illustrator ' + ($aiYears -join '/') + ' supported')
  } elseif ($aiVersions.Count -gt 0) {
    Step-Skip 'no supported Illustrator'
  } else {
    Step-Skip 'no Illustrator installation found'
  }
  if ($aiSupported.Count -eq 0 -and $aiVersions.Count -gt 0) {
    Note ("WARNING: Illustrator found, but none is supported by this build (needs ILST $hostMin+): " + ($aiVersions -join ', ') + ". The panel will not appear in those versions.") 'Yellow'
  } elseif ($aiSupported.Count -eq 0) {
    Note "WARNING: no Illustrator installation detected. The panel only appears in Illustrator $hostMin+." 'Yellow'
  }

  # Illustrator caches host scripts and panel files, so a live install is only allowed with -Force.
  $aiPids = @()
  try {
    $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  } catch {
    Note "Could not check the Illustrator process: $($_.Exception.Message)" 'Yellow'
  }
  if ($aiPids.Count -gt 0) {
    $msg = "Adobe Illustrator is running (PID(s): $($aiPids -join ', ')). Close it before installing so cached host scripts reload."
    if (-not $Force) { throw "$msg Re-run with -Force to install anyway, then restart Illustrator." }
    Note "$msg Proceeding because -Force was passed; save any unsaved documents, then restart Illustrator afterwards." 'Yellow'
  }

  # ---------------------------------------------------------------- 2. Node.js
  Start-Step 2 6 'Preparing Node.js'
  # The agent is a Node.js program and its dependencies are installed with npm, so a PC
  # without them cannot work at all. Instead of refusing and sending the user to nodejs.org,
  # setup makes Node.js available itself before anything is copied: an existing install is
  # preferred and never touched, a private copy left by an earlier setup is reused, and only
  # when both are missing does it fetch the official LTS build into the user's AppData.
  $nodeExe = $null
  $npmExe = $null
  $nodeFrom = ''
  $privateNodeDir = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
  $privateNode = Join-Path $privateNodeDir 'node.exe'
  $privateNpm = Join-Path $privateNodeDir 'npm.cmd'

  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) { $nodeExe = [string]$nodeCmd.Source }
  # Node ships npm as three files in one folder: npm, npm.cmd and npm.ps1. PowerShell resolves
  # the bare name to npm.ps1, and cmd.exe cannot run a .ps1: Windows hands it to the .ps1 file
  # association, which opens Notepad instead of running npm. Only cmd/exe launchers are used.
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCmd) { $npmCmd = Get-Command npm.exe -ErrorAction SilentlyContinue }
  if ($npmCmd) { $npmExe = [string]$npmCmd.Source }
  if ($nodeExe -and -not $npmExe) {
    $nodeFolder = Split-Path -Parent $nodeExe
    foreach ($candidate in @('npm.cmd', 'npm.exe')) {
      $npmSibling = Join-Path $nodeFolder $candidate
      if (Test-Path -LiteralPath $npmSibling) { $npmExe = $npmSibling; break }
    }
  }
  if ($nodeExe -and $npmExe) {
    $nodeFrom = 'PATH'
  } else {
    # An earlier online setup may already have put a private copy in AppData.
    if (-not $nodeExe -and (Test-Path -LiteralPath $privateNode)) {
      $nodeExe = $privateNode
      $nodeFrom = 'private'
    }
    if (-not $npmExe -and (Test-Path -LiteralPath $privateNpm)) { $npmExe = $privateNpm }
  }

  if ($nodeExe -and $npmExe) {
    Say 'using the Node.js already on this computer'
  } else {
    # Ask for the current LTS, verify the published SHA-256, then unpack into AppData.
    Say 'not found, downloading the official Node.js LTS build (about 30 MB)'
    $zip = $null
    $stage = $null
    try {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $arch = 'x64'
      try { if ([string]$env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' } } catch { }
      $releases = (Get-HttpsText 'https://nodejs.org/dist/index.json') | ConvertFrom-Json
      $lts = @($releases | Where-Object { $_.lts }) | Select-Object -First 1
      if (-not $lts -or -not $lts.version) { throw 'nodejs.org did not report a Node.js LTS release.' }
      $nodeVer = [string]$lts.version
      $zipName = "node-$nodeVer-win-$arch.zip"
      $sums = Get-HttpsText ("https://nodejs.org/dist/$nodeVer/SHASUMS256.txt")
      $sumLine = @(($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($zipName) }) | Select-Object -First 1
      if (-not $sumLine -or $sumLine -notmatch '^([0-9a-fA-F]{64})') {
        throw "nodejs.org published no SHA-256 for $zipName, so the download was not trusted."
      }
      $expectedSha = $Matches[1].ToLowerInvariant()
      $zip = Join-Path $env:TEMP $zipName
      Say ("downloading Node.js $nodeVer")
      Save-HttpsFile ("https://nodejs.org/dist/$nodeVer/$zipName") $zip
      $actualSha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualSha -ne $expectedSha) { throw 'The Node.js download did not match its published SHA-256.' }
      $stage = Join-Path $env:TEMP ("vb-node-" + [guid]::NewGuid().ToString('N'))
      [IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
      $inner = @(Get-ChildItem -LiteralPath $stage -Directory) | Select-Object -First 1
      if (-not $inner -or -not (Test-Path -LiteralPath (Join-Path $inner.FullName 'node.exe'))) {
        throw 'The Node.js package did not contain node.exe.'
      }
      Say 'unpacking it into your AppData (no admin, no PATH change)'
      New-Item -ItemType Directory -Force -Path $privateNodeDir | Out-Null
      & robocopy $inner.FullName $privateNodeDir /E /R:1 /W:1 /NFL /NDL /NP | Out-Null
      $rc = $LASTEXITCODE
      if ($rc -ge 8) { throw "Copying Node.js into $privateNodeDir failed (robocopy exit code $rc)." }
      if (-not (Test-Path -LiteralPath $privateNode)) { throw "Node.js was copied to $privateNodeDir but node.exe is missing." }
      $nodeExe = $privateNode
      $nodeFrom = 'private'
      if (Test-Path -LiteralPath $privateNpm) { $npmExe = $privateNpm } else { $npmExe = $null }
    } catch {
      throw @"
Node.js is required, and setup could not install it automatically: $($_.Exception.Message)
Connect this PC to the internet and run the installer again, or install Node.js LTS from
https://nodejs.org (choose the "Current user" option, no admin needed) and re-run it.
Nothing was copied into the extension folder.
"@
    } finally {
      if ($zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
      if ($stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }

  $nodeLabel = ''
  $npmLabel = ''
  if ($nodeExe) { try { $nodeLabel = [string](& $nodeExe --version) } catch { $nodeLabel = '' } }
  if ($npmExe) { try { $npmLabel = [string](& cmd.exe /c ('"' + $npmExe + '" --version')) } catch { $npmLabel = '' } }
  if (-not $nodeExe -or -not $nodeLabel) {
    throw "Node.js could not be started from '$nodeExe'. Nothing was copied into the extension folder."
  }
  if (-not $npmExe) {
    throw @"
Node.js $nodeLabel is available, but npm was not found next to it, so the agent dependencies
the extension cannot be installed and nothing was copied.
Reinstall Node.js LTS from https://nodejs.org so that npm comes with it, then run the
installer again.
"@
  }
  if ($nodeFrom -eq 'private') {
    Step-Ok ("Node.js $nodeLabel (private copy), npm $npmLabel")
  } else {
    Step-Ok ("Node.js $nodeLabel, npm $npmLabel")
  }

  # ---------------------------------------------------------------- 3. Copy the panel
  Start-Step 3 6 'Copying the panel'
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null

  $excludeDirs = @(
    'agent\node_modules',
    'node_modules',
    '.git',
    '.opencode',
    'agent-downloads',
    'agent-debug',
    'vectorizer-profile',
    'tools',
    'docs',
    'modern-ui',
    'flow-poc',
    'simulator',
    'native-panel-backup*'
  )
  # Runtime/user artifacts and development-only files are never copied.
  $excludeFiles = @(
    'agent-status*.json',
    'agent-daemon.json',
    'agent-log.txt',
    'log.txt',
    '*.zip',
    '*.cmd',
    '*.md',
    '.gitignore',
    'install.ps1',
    'install-online.ps1',
    'uninstall.ps1',
    'setup.ps1',
    'setup-menu.ps1',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini'
  )

  $robocopy = Get-Command robocopy -ErrorAction SilentlyContinue
  if (-not $robocopy) { throw "robocopy not found. Cannot perform safe mirrored install." }

  Say 'mirroring runtime files (docs and installers excluded)'
  $rcArgs = @($Source, $Dest, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NP', '/XD') + $excludeDirs + @('/XF') + $excludeFiles
  & robocopy @rcArgs | Out-Null
  $rc = $LASTEXITCODE
  # Robocopy exit codes 0-7 are success variants; 8+ is a real failure.
  if ($rc -ge 8) { throw "robocopy failed with exit code $rc." }

  # Prune development files left behind by older installer versions, which mirrored everything.
  $pruned = 0
  $stale = @(Get-ChildItem -LiteralPath $Dest -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Extension -eq '.md' -or $_.Extension -eq '.cmd' -or $_.Name -eq '.gitignore' -or $_.Name -eq 'install.ps1' -or $_.Name -eq 'install-online.ps1' -or $_.Name -eq 'uninstall.ps1' -or $_.Name -eq 'setup.ps1' -or $_.Name -eq 'setup-menu.ps1'
  })
  foreach ($f in $stale) {
    try {
      Remove-Item -LiteralPath $f.FullName -Force
      $pruned++
    } catch {
      Note "WARNING: could not remove stale file $($f.FullName): $($_.Exception.Message)" 'Yellow'
    }
  }
  $copied = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike '*\node_modules\*' }).Count
  $copyDetail = [string]$copied + ' files present'
  if ($pruned -gt 0) { $copyDetail = $copyDetail + ', ' + $pruned + ' stale removed' }
  Step-Ok $copyDetail

  # ---------------------------------------------------------------- 4. Agent dependencies
  Start-Step 4 6 'Installing agent dependencies'
  # Agent dependencies are excluded from the copy but required at runtime.
  $agentDir = Join-Path $Dest 'agent'
  $agentModules = Join-Path $agentDir 'node_modules'
  $puppeteer = Join-Path $agentModules 'puppeteer-core'
  $npmLog = $null
  if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
    Step-Skip 'agent\package.json missing'
    Note 'WARNING: agent\package.json missing in the destination; the vectorizer agent will not start.' 'Yellow'
  } elseif (Test-Path $puppeteer) {
    Step-Skip 'already present'
  } elseif (-not $npmExe) {
    throw 'npm was not found, so the agent dependencies cannot be installed. Reinstall Node.js LTS from https://nodejs.org (npm comes with it), then run the installer again.'
  } else {
    $npmLog = Join-Path $env:TEMP ("vb-npm-" + [guid]::NewGuid().ToString('N') + ".log")
    # A private Node.js copy is not on PATH; adding its folder for this process only lets
    # npm.cmd (and anything it spawns) find node.exe without editing the user's PATH.
    if ($nodeFrom -eq 'private') { $env:PATH = (Split-Path -Parent $npmExe) + ';' + $env:PATH }
    Say 'running npm install --omit=dev'
    # cmd /c keeps npm output in a file: PowerShell 5.1 turns native stderr into terminating
    # errors under ErrorActionPreference=Stop, and $LASTEXITCODE is what actually matters here.
    Push-Location $agentDir
    try {
      & cmd.exe /c ('"' + $npmExe + '" install --omit=dev --no-audit --no-fund > "' + $npmLog + '" 2>&1')
      $npmExit = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    if ($npmExit -ne 0) {
      Clear-UiLine
      Write-Host '  npm output (last 20 lines):' -ForegroundColor DarkGray
      Get-Content -LiteralPath $npmLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
      throw "npm install failed with exit code $npmExit. Fix the cause and re-run install.ps1, or run 'npm install --omit=dev' in $agentDir."
    }
    if (-not (Test-Path $puppeteer)) {
      throw "npm install exited 0 but $puppeteer is missing. Delete $agentModules and re-run install.ps1."
    }
    Step-Ok 'puppeteer-core installed'
  }
  if ($npmLog) { Remove-Item -LiteralPath $npmLog -Force -ErrorAction SilentlyContinue }

  # ---------------------------------------------------------------- 5. CEP debug mode
  Start-Step 5 6 'Enabling the panel in Illustrator'
  # Enable PlayerDebugMode for the CEP runtime versions used by Illustrator 2022-2027.
  $csxsVersions = @('9','10','11','12','13','14','15','16')
  $regFailed = 0
  foreach ($ver in $csxsVersions) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
    try {
      if (-not (Test-Path $keyPath)) { New-Item -Path $keyPath -Force | Out-Null }
      New-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -PropertyType String -Value '1' -Force | Out-Null
    } catch {
      $regFailed++
      Note "WARNING: Failed to set PlayerDebugMode for CSXS.$ver : $($_.Exception.Message)" 'Yellow'
    }
  }
  if ($regFailed -eq 0) {
    Step-Ok 'unsigned CEP enabled for CSXS 9-16'
  } elseif ($regFailed -lt $csxsVersions.Count) {
    Step-Skip ('enabled, ' + $regFailed + ' of ' + $csxsVersions.Count + ' keys failed')
  } else {
    Step-Fail 'could not write the registry keys'
  }

  # ---------------------------------------------------------------- 6. Verify
  Start-Step 6 6 'Verifying the install'
  $destManifest = Join-Path $Dest 'CSXS\manifest.xml'
  if (-not (Test-Path $destManifest)) { throw "Install verification failed: $destManifest is missing." }
  $manifestText = Get-Content -LiteralPath $destManifest -Raw
  $versionMatch = [regex]::Match($manifestText, 'ExtensionBundleVersion="([^"]+)"')
  $installedVersion = 'unknown'
  if ($versionMatch.Success) { $installedVersion = $versionMatch.Groups[1].Value }
  $required = @('index.html', 'dist\index.html', 'host\core.jsx', 'host\place.jsx', 'js\bridge\host.js', 'agent\run.js')
  $missing = @($required | Where-Object { -not (Test-Path (Join-Path $Dest $_)) })
  if ($missing.Count -gt 0) { throw ("Install verification failed; missing: " + ($missing -join ', ')) }
  $fileCount = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike '*\node_modules\*' }).Count
  Step-Ok ("version $installedVersion, $fileCount files, all required present")

  # ---------------------------------------------------------------- summary
  Clear-UiLine
  Write-Host ''
  Write-Host ('  Installed Mockup Studio ' + $installedVersion) -ForegroundColor Green -NoNewline
  Write-Host ('   ' + [string]$fileCount + ' files') -ForegroundColor DarkGray
  Write-Host ('  ' + $Dest) -ForegroundColor DarkGray
  Write-Host ''
  if ($aiPids.Count -gt 0) {
    Write-Host '  Save your open documents first: restarting Illustrator closes every open file.' -ForegroundColor Yellow
    Write-Host '  Then restart Illustrator and open Window > Extensions > Mockup Studio.' -ForegroundColor White
  } else {
    Write-Host '  Open Illustrator, then Window > Extensions > Mockup Studio.' -ForegroundColor White
  }
  Write-Host '  The panel shortcut Ctrl+Shift+; (semicolon) works while the panel has focus.' -ForegroundColor DarkGray
  Write-Host ('  Agent dependencies: ' + $agentModules) -ForegroundColor DarkGray
  Write-Host ('  User data untouched: ' + $RuntimeDir) -ForegroundColor DarkGray
  Write-Host ''
} catch {
  Clear-UiLine
  Write-Host ''
  Write-Host '  Install failed' -ForegroundColor Red
  Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray
  foreach ($line in ([string]$_.Exception.Message -split "`n")) {
    Write-Host ('  ' + $line.TrimEnd()) -ForegroundColor Red
  }
  if ($script:UiStep) {
    Write-Host ''
    Write-Host ('  Last step: ' + $script:UiStep.Number + '  ' + $script:UiStep.Title) -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '  Nothing in Documents\VectorizerBridge was changed.' -ForegroundColor DarkGray
  Write-Host ''
  exit 1
}
