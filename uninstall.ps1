<#
.SYNOPSIS
  Uninstalls Vectorizer Bridge CEP extension for the current user.
.DESCRIPTION
  Removes %APPDATA%\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge.
  Optionally removes PlayerDebugMode values for CSXS 11/12.
  NEVER touches %USERPROFILE%\Documents\VectorizerBridge\ (user runtime data).
#>
[CmdletBinding()]
param(
  [switch]$RemoveDebugMode
)

$ErrorActionPreference = 'Stop'
$ExtensionId = 'com.bestofgifts.vectorizerbridge'
$Dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\$ExtensionId"
$RuntimeData = Join-Path $env:USERPROFILE 'Documents\VectorizerBridge'

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $line
}

Write-Log "Vectorizer Bridge uninstaller starting."
Write-Log "Extension folder target: $Dest"
Write-Log "User runtime data will NOT be touched: $RuntimeData"

# Warn if Illustrator appears to be running
try {
  $ai = Get-Process -Name 'Illustrator' -ErrorAction SilentlyContinue
  if ($ai) {
    Write-Log "WARNING: Adobe Illustrator appears to be running (PID(s): $($ai.Id -join ', ')). Close Illustrator before uninstalling."
  } else {
    Write-Log "Illustrator process not detected."
  }
} catch { Write-Log "Could not check Illustrator process: $($_.Exception.Message)" }

# Safety guard: never operate on Documents\VectorizerBridge
$destNorm = [IO.Path]::GetFullPath($Dest).TrimEnd('\').ToLowerInvariant()
$runtimeNorm = [IO.Path]::GetFullPath($RuntimeData).TrimEnd('\').ToLowerInvariant()
if ($destNorm -eq $runtimeNorm -or $destNorm.StartsWith($runtimeNorm + '\')) {
  throw "Safety check failed: destination resolves inside user runtime data path. Aborting."
}

if (Test-Path $Dest) {
  try {
    Remove-Item -LiteralPath $Dest -Recurse -Force
    Write-Log "Removed extension folder: $Dest"
  } catch {
    throw "Failed to remove extension folder '$Dest': $($_.Exception.Message)"
  }
} else {
  Write-Log "Extension folder not found (already removed): $Dest"
}

if ($RemoveDebugMode) {
  foreach ($ver in @('11','12')) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
    try {
      if (Test-Path $keyPath) {
        Remove-ItemProperty -Path $keyPath -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue
        Write-Log "Removed PlayerDebugMode from $keyPath (if present)."
      } else {
        Write-Log "Registry key not found: $keyPath"
      }
    } catch {
      Write-Log "WARNING: Failed to update $keyPath : $($_.Exception.Message)"
    }
  }
} else {
  Write-Log "PlayerDebugMode registry keys left unchanged (pass -RemoveDebugMode to remove)."
}

Write-Log "Uninstall complete. User runtime data preserved: $RuntimeData"
