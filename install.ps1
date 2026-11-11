<#
.SYNOPSIS
  Installs/updates Vectorizer Bridge CEP extension for the current user.
.DESCRIPTION
  Copies extension source to %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge
  (mirroring), excluding development/runtime artifacts. Enables PlayerDebugMode for CSXS 11/12.
  Never touches %USERPROFILE%\Documents\VectorizerBridge\ (user runtime data).
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ExtensionId = 'com.bestofgifts.vectorizerbridge'
$Source = $PSScriptRoot
$Dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtensionId"

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
}

Write-Log "Vectorizer Bridge installer starting."
Write-Log "Source: $Source"
Write-Log "Destination: $Dest"

# Warn if Illustrator appears to be running (CEP/host cache safety)
try {
  $ai = Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue
  if ($ai) {
    $msg = "WARNING: Adobe Illustrator appears to be running (PID(s): $($ai.Id -join ', ')). Close Illustrator before installing to ensure cached host/panel files update correctly."
    if ($Force) { Write-Log "$msg Proceeding due to -Force." }
    else { Write-Log $msg }
  } else {
    Write-Log "Illustrator process not detected."
  }
} catch { Write-Log "Could not check Illustrator process: $($_.Exception.Message)" }

if (-not (Test-Path (Join-Path $Source 'CSXS\manifest.xml'))) {
  throw "Source manifest not found: $(Join-Path $Source 'CSXS\manifest.xml'). Run install.ps1 from the extension source folder."
}

# Create destination
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Log "Ensured destination folder exists."

# Mirror copy with excludes (never copy node_modules or runtime/user artifacts)
$excludeDirs = @(
  'agent\node_modules',
  'node_modules',
  '.git',
  'agent-downloads',
  'agent-debug',
  'vectorizer-profile'
)
$excludeFiles = @(
  'agent-status*.json',
  'agent-daemon.json',
  'agent-log.txt',
  'log.txt',
  '*.zip',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini'
)

$rcArgs = @(
  $Source,
  $Dest,
  '/MIR',      # mirror (copy new/changed, remove files not in source within copied scope)
  '/R:2', '/W:1',
  '/NFL', '/NDL', '/NP'
)
if ($excludeDirs.Count -gt 0) { $rcArgs += @('/XD') + $excludeDirs }
if ($excludeFiles.Count -gt 0) { $rcArgs += @('/XF') + $excludeFiles }

Write-Log "Copying files (robocopy) with excludes:"
Write-Log ("  Excluded dirs: " + ($excludeDirs -join ', '))
Write-Log ("  Excluded files: " + ($excludeFiles -join ', '))
Write-Log "  Note: runtime/user data in %USERPROFILE%\Documents\VectorizerBridge is never touched."

$robocopy = Get-Command robocopy -ErrorAction SilentlyContinue
if (-not $robocopy) { throw "robocopy not found. Cannot perform safe mirrored install." }

& robocopy @rcArgs | Out-Null
$rc = $LASTEXITCODE
# Robocopy exit codes: 0-7 are success/partial-success states for copy operations
if ($rc -ge 8) { throw "robocopy failed with exit code $rc." }
Write-Log "Copy completed (robocopy exit code $rc)."

# Agent dependencies are excluded from the copy, but the agent requires puppeteer-core.
# Install them in the destination so a clean install can run without manual steps.
$agentDir = Join-Path $Dest 'agent'
$agentModules = Join-Path $agentDir 'node_modules'
if (Test-Path $agentDir) {
  if (Test-Path $agentModules) {
    Write-Log "Agent dependencies already present."
  } else {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
      Write-Log "WARNING: npm not found. Run 'npm install' in $agentDir or the agent will not start."
    } else {
      try {
        Write-Log "Installing agent dependencies (npm install) in $agentDir ..."
        Push-Location $agentDir
        & npm install --omit=dev --no-audit --no-fund 2>&1 | ForEach-Object { Write-Log "  $_" }
        Pop-Location
        Write-Log "Agent dependencies installed."
      } catch {
        try { Pop-Location } catch { }
        Write-Log "WARNING: npm install failed: $($_.Exception.Message). Run 'npm install' in $agentDir manually."
      }
    }
  }
}

# Enable PlayerDebugMode for CSXS 11 and 12 (Illustrator 2025/2026 unsigned CEP)
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

# Post-install notes
Write-Log "Install/update complete."
Write-Log "Next steps:"
Write-Log "  1) If Illustrator was open, fully quit and reopen it (host scripts are cached)."
Write-Log "  2) Open Window > Extensions > Vectorizer Bridge."
Write-Log "  3) Panel shortcut Ctrl+Shift+Ç and flyout menu work only when the panel has focus."
Write-Log "  4) If agent dependencies are missing, run: npm install (in the installed agent folder) - node_modules are intentionally not copied."
Write-Log "Runtime/user data remains untouched: $env:USERPROFILE\Documents\VectorizerBridge"
