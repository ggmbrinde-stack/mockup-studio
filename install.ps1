<#
.SYNOPSIS
  Installs or updates the Vectorizer Bridge CEP extension for the current user.
.DESCRIPTION
  Mirrors only the runtime extension files (index.html, CSXS, css, host, js, modules, agent)
  into %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge, installs agent
  dependencies when missing, enables PlayerDebugMode for CSXS 9-16 and verifies the result.
  Development files (docs, .gitignore, installers) are not copied and stale copies are pruned.
  Never touches %USERPROFILE%\Documents\VectorizerBridge (user runtime data).
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

function Write-Log($msg) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

Write-Log "Vectorizer Bridge installer starting."
Write-Log "Source: $Source"
Write-Log "Destination: $Dest"

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
if ($aiSupported.Count -gt 0) {
  Write-Log ("Illustrator supported: " + ($aiSupported -join ', ') + " (this build targets ILST $hostMin+).")
} elseif ($aiVersions.Count -gt 0) {
  Write-Log ("WARNING: Illustrator found, but none is supported by this build (needs $hostMin+): " + ($aiVersions -join ', ') + ". The panel will not appear in those versions.")
} else {
  Write-Log "WARNING: no Illustrator installation detected. The panel only appears in Illustrator $hostMin+."
}

# Illustrator caches host scripts and panel files, so a live install is only allowed with -Force.
$aiPids = @()
try {
  $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
} catch {
  Write-Log "Could not check Illustrator process: $($_.Exception.Message)"
}
if ($aiPids.Count -gt 0) {
  $msg = "Adobe Illustrator is running (PID(s): $($aiPids -join ', ')). Close it before installing so cached host scripts reload."
  if (-not $Force) { throw "$msg Re-run with -Force to install anyway, then restart Illustrator." }
  Write-Log "$msg Proceeding because -Force was passed; save any unsaved documents, then restart Illustrator afterwards."
} else {
  Write-Log "Illustrator process not detected."
}

# The agent needs Node.js; report it here instead of failing silently at first vectorize.
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($node) { Write-Log ("Node.js: " + (& node --version)) } else { Write-Log "WARNING: node not found on PATH. The vectorizer agent requires Node.js." }
if ($npm) { Write-Log ("npm: " + (& npm --version)) } else { Write-Log "WARNING: npm not found on PATH. Agent dependencies must be installed manually." }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Log "Ensured destination folder exists."

$excludeDirs = @(
  'agent\node_modules',
  'node_modules',
  '.git',
  'agent-downloads',
  'agent-debug',
  'vectorizer-profile',
  'tools'
)
# Runtime/user artifacts and development-only files are never copied.
$excludeFiles = @(
  'agent-status*.json',
  'agent-daemon.json',
  'agent-log.txt',
  'log.txt',
  '*.zip',
  '*.md',
  '.gitignore',
  'install.ps1',
  'uninstall.ps1',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini'
)

$robocopy = Get-Command robocopy -ErrorAction SilentlyContinue
if (-not $robocopy) { throw "robocopy not found. Cannot perform safe mirrored install." }

$rcArgs = @($Source, $Dest, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NP', '/XD') + $excludeDirs + @('/XF') + $excludeFiles
Write-Log "Copying runtime files (robocopy mirror; docs, .gitignore and installers excluded)."
& robocopy @rcArgs | Out-Null
$rc = $LASTEXITCODE
# Robocopy exit codes 0-7 are success variants; 8+ is a real failure.
if ($rc -ge 8) { throw "robocopy failed with exit code $rc." }
Write-Log "Copy completed (robocopy exit code $rc)."

# Prune development files left behind by older installer versions, which mirrored everything.
$stale = @(Get-ChildItem -LiteralPath $Dest -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Extension -eq '.md' -or $_.Name -eq '.gitignore' -or $_.Name -eq 'install.ps1' -or $_.Name -eq 'uninstall.ps1'
})
foreach ($f in $stale) {
  try {
    Remove-Item -LiteralPath $f.FullName -Force
    Write-Log "Pruned stale file: $($f.Name)"
  } catch {
    Write-Log "WARNING: could not remove stale file $($f.FullName): $($_.Exception.Message)"
  }
}

# Agent dependencies are excluded from the copy but required at runtime.
$agentDir = Join-Path $Dest 'agent'
$agentModules = Join-Path $agentDir 'node_modules'
$puppeteer = Join-Path $agentModules 'puppeteer-core'
if (-not (Test-Path (Join-Path $agentDir 'package.json'))) {
  Write-Log "WARNING: agent\package.json missing in the destination; skipping dependency install."
} elseif (Test-Path $puppeteer) {
  Write-Log "Agent dependencies already present."
} elseif (-not $npm) {
  Write-Log "WARNING: npm not found. Run 'npm install --omit=dev' in $agentDir or the agent will not start."
} else {
  $npmLog = Join-Path $env:TEMP ("vb-npm-" + [guid]::NewGuid().ToString('N') + ".log")
  Write-Log "Installing agent dependencies (npm install --omit=dev) in $agentDir ..."
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
    Write-Log "npm output (last 20 lines):"
    Get-Content -LiteralPath $npmLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log "  $_" }
    throw "npm install failed with exit code $npmExit. Fix the cause and re-run install.ps1, or run 'npm install --omit=dev' in $agentDir."
  }
  if (-not (Test-Path $puppeteer)) {
    throw "npm install exited 0 but $puppeteer is missing. Delete $agentModules and re-run install.ps1."
  }
  Remove-Item -LiteralPath $npmLog -Force -ErrorAction SilentlyContinue
  Write-Log "Agent dependencies installed (puppeteer-core present)."
}

# Enable PlayerDebugMode for the CEP runtime versions used by Illustrator 2022-2027.
$csxsVersions = @('9','10','11','12','13','14','15','16')
foreach ($ver in $csxsVersions) {
  $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
  try {
    if (-not (Test-Path $keyPath)) { New-Item -Path $keyPath -Force | Out-Null; Write-Log "Created registry key: $keyPath" }
    New-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -PropertyType String -Value '1' -Force | Out-Null
    Write-Log "Set PlayerDebugMode=1 at $keyPath"
  } catch {
    Write-Log "WARNING: Failed to set PlayerDebugMode for CSXS.$ver : $($_.Exception.Message)"
  }
}

# Verify what actually landed instead of trusting the copy.
$destManifest = Join-Path $Dest 'CSXS\manifest.xml'
if (-not (Test-Path $destManifest)) { throw "Install verification failed: $destManifest is missing." }
$manifestText = Get-Content -LiteralPath $destManifest -Raw
$versionMatch = [regex]::Match($manifestText, 'ExtensionBundleVersion="([^"]+)"')
$installedVersion = 'unknown'
if ($versionMatch.Success) { $installedVersion = $versionMatch.Groups[1].Value }
$required = @('index.html', 'host\core.jsx', 'host\place.jsx', 'js\bridge\host.js', 'agent\run.js')
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $Dest $_)) })
if ($missing.Count -gt 0) { throw ("Install verification failed; missing: " + ($missing -join ', ')) }
$fileCount = @(Get-ChildItem -LiteralPath $Dest -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\node_modules\*' }).Count
Write-Log "Verified install: version $installedVersion, $fileCount files copied, required files present."

Write-Log "Install/update complete."
Write-Log "Next steps:"
if ($aiPids.Count -gt 0) { Write-Log "  1) Save your open documents, then fully quit and reopen Illustrator (-Force was used; host scripts are cached)." }
else { Write-Log "  1) Open Illustrator (restart it if it was already running)." }
Write-Log "  2) Open Window > Extensions > Vectorizer Bridge."
Write-Log "  3) Panel shortcut Ctrl+Shift+; (semicolon) and the flyout menu only work when the panel has focus."
Write-Log "  4) Agent dependencies live in $agentDir\node_modules and are preserved between installs."
Write-Log "Runtime/user data remains untouched: $RuntimeDir"
