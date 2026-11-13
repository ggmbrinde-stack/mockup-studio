<#
.SYNOPSIS
  Uninstalls the Mockup Studio CEP extension for the current user.
.DESCRIPTION
  Stops the warm agent daemon, then removes
  %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge.
  Never touches %USERPROFILE%\Documents\VectorizerBridge (user runtime data).
.PARAMETER RemoveDebugMode
  Also clear PlayerDebugMode for CSXS 9-16 (the versions install.ps1 sets).
#>
[CmdletBinding()]
param(
  [switch]$RemoveDebugMode
)

$ErrorActionPreference = 'Stop'
$ExtensionId = 'com.bestofgifts.vectorizerbridge'
$Dest = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtensionId")).TrimEnd('\')
$RuntimeData = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\VectorizerBridge')).TrimEnd('\')

function Write-Log($msg) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
}

Write-Log "Mockup Studio uninstaller starting."
Write-Log "Extension folder target: $Dest"
Write-Log "User runtime data will NOT be touched: $RuntimeData"

# Safety guard: only ever delete inside the CEP extensions folder, never runtime data.
$extRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions')).TrimEnd('\').ToLowerInvariant()
$destNorm = $Dest.ToLowerInvariant()
$runtimeNorm = $RuntimeData.ToLowerInvariant()
if (-not $destNorm.StartsWith($extRoot + '\') -or $destNorm -eq $runtimeNorm -or $destNorm.StartsWith($runtimeNorm + '\')) {
  throw "Safety check failed: '$Dest' is not a CEP extension folder. Aborting."
}

$aiPids = @()
try {
  $aiPids = @(Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
} catch {
  Write-Log "Could not check Illustrator process: $($_.Exception.Message)"
}
if ($aiPids.Count -gt 0) {
  Write-Log "WARNING: Adobe Illustrator is running (PID(s): $($aiPids -join ', ')). Close it before uninstalling."
} else {
  Write-Log "Illustrator process not detected."
}

# Stop the warm daemon first: it serves code from this folder and holds a Chrome profile,
# so deleting underneath it leaves an orphan process and locked files.
$ctl = Join-Path $Dest 'agent\daemon\ctl.js'
$node = Get-Command node -ErrorAction SilentlyContinue
$infoFile = Join-Path $RuntimeData 'agent-daemon.json'
if ((Test-Path $ctl) -and $node) {
  Write-Log "Stopping warm agent daemon (if running) ..."
  try {
    & node $ctl stop --work $RuntimeData 2>&1 | ForEach-Object { Write-Log "  $_" }
  } catch {
    Write-Log "WARNING: daemon stop failed: $($_.Exception.Message)"
  }
  Start-Sleep -Milliseconds 800
  if (Test-Path $infoFile) { Write-Log "WARNING: $infoFile still exists; the daemon may still be running." }
  else { Write-Log "Daemon stopped." }
} else {
  Write-Log "No daemon control script in the installed folder; nothing to stop."
}

if (Test-Path $Dest) {
  try {
    Remove-Item -LiteralPath $Dest -Recurse -Force
    Write-Log "Removed extension folder: $Dest"
  } catch {
    throw "Failed to remove '$Dest': $($_.Exception.Message). Close Illustrator and any agent Chrome windows, then retry."
  }
} else {
  Write-Log "Extension folder not found (already removed): $Dest"
}

$csxsVersions = @('9','10','11','12','13','14','15','16')
if ($RemoveDebugMode) {
  foreach ($ver in $csxsVersions) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
    try {
      if (Test-Path $keyPath) {
        Remove-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue
        Write-Log "Cleared PlayerDebugMode at $keyPath (if present)."
      } else {
        Write-Log "Registry key not found: $keyPath"
      }
    } catch {
      Write-Log "WARNING: Failed to update $keyPath : $($_.Exception.Message)"
    }
  }
} else {
  Write-Log "PlayerDebugMode left unchanged (pass -RemoveDebugMode to clear CSXS 9-16)."
}

Write-Log "Uninstall complete. User runtime data preserved: $RuntimeData"
