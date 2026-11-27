<#
.SYNOPSIS
  Installs or updates the Mockup Studio CEP extension for the current user.
.DESCRIPTION
  Mirrors only the runtime extension files (index.html, CSXS, css, host, js, modules, agent)
  into %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge, installs agent
  dependencies when missing, enables PlayerDebugMode for CSXS 9-16 and verifies the result.
  Development files (docs, .gitignore, installers) are not copied and stale copies are pruned.
  Never touches %USERPROFILE%\Documents\VectorizerBridge (user runtime data).

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
  Start-Step 2 6 'Checking Node.js'
  # The agent needs Node.js; report it here instead of failing silently at first vectorize.
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  $nodeLabel = ''
  $npmLabel = ''
  if ($node) { try { $nodeLabel = [string](& node --version) } catch { $nodeLabel = '' } }
  if ($npm) { try { $npmLabel = [string](& npm --version) } catch { $npmLabel = '' } }
  if ($node -and $npm) {
    Step-Ok ("Node.js $nodeLabel, npm $npmLabel")
  } elseif ($node) {
    Step-Skip 'npm missing'
    Note "WARNING: npm not found on PATH. Agent dependencies must be installed manually." 'Yellow'
  } else {
    Step-Skip 'Node.js not found'
    Note 'WARNING: node not found on PATH. The vectorizer agent requires Node.js.' 'Yellow'
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
  } elseif (-not $npm) {
    Step-Skip 'npm not found'
    Note "WARNING: run 'npm install --omit=dev' in $agentDir or the agent will not start." 'Yellow'
  } else {
    $npmLog = Join-Path $env:TEMP ("vb-npm-" + [guid]::NewGuid().ToString('N') + ".log")
    Say 'running npm install --omit=dev'
    # cmd /c keeps npm output in a file: PowerShell 5.1 turns native stderr into terminating
    # errors under ErrorActionPreference=Stop, and $LASTEXITCODE is what actually matters here.
    Push-Location $agentDir
    try {
      & cmd.exe /c "npm install --omit=dev --no-audit --no-fund > `"$npmLog`" 2>&1"
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
