<#
.SYNOPSIS
  Rebuilds the single-file installer (Install-Mockup-Studio.cmd).
.DESCRIPTION
  Packs the runtime extension files, install.ps1, uninstall.ps1, setup-menu.ps1 and the Chrome
  bridge files into a zip,
  base64-encodes it, and appends it to tools\installer-header.txt. The result is one
  double-clickable .cmd that installs with no repository and no download.

  Run this again after changing dist\, host\, js\, agent\, CSXS\ or install.ps1.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\build-installer-cmd.ps1
#>
[CmdletBinding()]
param(
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
$Repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if (-not $OutFile) { $OutFile = Join-Path $Repo 'Install-Mockup-Studio.cmd' }
$HeaderFile = Join-Path $PSScriptRoot 'installer-header.txt'
$Marker = '-----BEGIN-PAYLOAD-----'

if (-not (Test-Path -LiteralPath $HeaderFile)) { throw "Header not found: $HeaderFile" }
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'install.ps1'))) { throw "install.ps1 not found in $Repo" }

$stage = Join-Path $env:TEMP ('ms-stage-' + [guid]::NewGuid().ToString('N'))
$zip = "$stage.zip"

try {
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  # Same selection install.ps1 would mirror from the repo, minus development folders.
  $rcArgs = @(
    $Repo, $stage, '/E', '/NFL', '/NDL', '/NP', '/R:1', '/W:1',
    '/XD', '.git', '.opencode', 'node_modules', 'agent-downloads', 'agent-debug', 'vectorizer-profile',
    'tools', 'docs', 'modern-ui', 'flow-poc', 'simulator', 'native-panel-backup*',
    '/XF', '*.zip', '*.md', '.gitignore', 'uninstall.ps1', 'agent-log.txt', 'log.txt',
    '*.log', 'agent-status*.json', 'agent-daemon.json', 'Thumbs.db', 'desktop.ini', '.DS_Store',
    '*.cmd', 'install-online.ps1'
  )
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

  # The installers, the menu and the Chrome bridge ship inside the payload. setup-menu.ps1
  # lives in tools\ (excluded from the copy above), so it is staged explicitly.
  Copy-Item -LiteralPath (Join-Path $Repo 'install.ps1') -Destination (Join-Path $stage 'install.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $Repo 'uninstall.ps1') -Destination (Join-Path $stage 'uninstall.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-menu.ps1') -Destination (Join-Path $stage 'setup-menu.ps1') -Force
  $bridgeSource = Join-Path $Repo 'flow-poc\extension'
  if (Test-Path -LiteralPath $bridgeSource) {
    $bridgeDest = Join-Path $stage 'bridge'
    New-Item -ItemType Directory -Force -Path $bridgeDest | Out-Null
    Copy-Item -Path (Join-Path $bridgeSource '*') -Destination $bridgeDest -Force
  } else {
    Write-Warning "flow-poc\extension not found; the Chrome bridge will not be bundled."
  }

  # Fail here instead of shipping a payload the installer would reject.
  $required = @('index.html', 'CSXS\manifest.xml', 'dist\index.html', 'host\core.jsx',
    'host\place.jsx', 'js\bridge\host.js', 'agent\run.js', 'install.ps1', 'uninstall.ps1',
    'setup-menu.ps1')
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $stage $_)) })
  if ($missing.Count -gt 0) { throw ("Payload incomplete, missing: " + ($missing -join ', ')) }

  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

  $header = [IO.File]::ReadAllText($HeaderFile)
  if ($header.Contains($Marker)) { throw "Header must not contain the payload marker ($Marker)." }

  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $b64.Length; $i += 76) {
    [void]$sb.AppendLine($b64.Substring($i, [Math]::Min(76, $b64.Length - $i)))
  }

  $content = $header.TrimEnd("`r", "`n") + "`r`n" + $Marker + "`r`n" + $sb.ToString()
  [IO.File]::WriteAllText($OutFile, $content, (New-Object System.Text.ASCIIEncoding))

  $out = Get-Item -LiteralPath $OutFile
  $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File)
  Write-Host ("Built {0}" -f $out.FullName) -ForegroundColor Green
  Write-Host ("  payload : {0:N0} KB zip -> {1:N0} KB base64" -f ((Get-Item $zip).Length / 1KB), ($out.Length / 1KB))
  Write-Host ("  contents: {0} files" -f $files.Count)
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
}
