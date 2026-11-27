<#
  Mockup Studio - setup menu.
  Started by Install-Mockup-Studio.cmd after it unpacks the embedded payload.
  Installs/updates the panel, removes it, or opens the user's files.

  Everything runs offline from the payload sitting next to this file: no downloads, no
  repository. Plain (numbered) mode is used automatically when the output is redirected,
  when the host is not ConsoleHost, or when VB_NO_UI=1 is set.
#>
[CmdletBinding()]
param([switch]$Plain)

$ErrorActionPreference = 'Stop'

$script:ExtId = 'com.bestofgifts.vectorizerbridge'
$script:ExtDir = Join-Path $env:APPDATA ('Adobe\CEP\extensions\' + $script:ExtId)
$script:RuntimeData = Join-Path $env:USERPROFILE 'Documents\VectorizerBridge'
$script:BridgeDir = Join-Path $env:LOCALAPPDATA 'MockupStudio\flow-bridge'
$script:Items = @('Install or update', 'Clean install', 'Remove from this computer', 'Open my files', 'Quit')
$script:Sel = 0
$script:Unicode = $false
$script:Ansi = $false
$script:PlainMode = [bool]$Plain
$script:C = @{ accent = ''; text = ''; dim = ''; ok = ''; warn = ''; bold = ''; reset = '' }
$script:G = @{ node = '*'; dl = '/'; dr = '\'; arrow = '>'; dot = '-' }

# --------------------------------------------------------------------------- setup

function Initialize-SetupUi {
  if ($env:VB_NO_UI -eq '1') { $script:PlainMode = $true }
  try {
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { $script:PlainMode = $true }
  } catch { $script:PlainMode = $true }
  try { if ($Host.Name -ne 'ConsoleHost') { $script:PlainMode = $true } } catch { $script:PlainMode = $true }
  if ($env:NO_COLOR) { $script:PlainMode = $true }

  if (-not $script:PlainMode) {
    try {
      if (-not ('Vb.Console' -as [type])) {
        Add-Type -Namespace Vb -Name Console -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern System.IntPtr GetStdHandle(int nStdHandle);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(System.IntPtr hConsoleHandle, out uint lpMode);
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(System.IntPtr hConsoleHandle, uint dwMode);
'@
      }
      $handle = [Vb.Console]::GetStdHandle(-11)
      $mode = 0
      if ([Vb.Console]::GetConsoleMode($handle, [ref]$mode)) {
        if ([Vb.Console]::SetConsoleMode($handle, $mode -bor 0x0004)) { $script:Ansi = $true }
      }
    } catch { $script:Ansi = $false }
  }

  # The logo glyphs and the arrows are outside the OEM code page (850/437), so a stock
  # console wrote every one of them as '?'. Switching the console to UTF-8 is what fixes it:
  # the glyphs stay only when that switch actually took effect, otherwise the ASCII
  # fallbacks already in $script:G are used.
  if (-not $script:PlainMode) {
    try {
      [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
      $script:Unicode = ([int][Console]::OutputEncoding.CodePage -eq 65001)
    } catch { $script:Unicode = $false }
  }

  if ($script:Unicode) {
    $script:G = @{
      node  = [string][char]0x25CF
      dl    = [string][char]0x2571
      dr    = [string][char]0x2572
      arrow = [string][char]0x203A
      dot   = [string][char]0x00B7
    }
  }

  if ($script:PlainMode -or -not $script:Ansi) { return }

  $e = [char]27
  $script:C = @{
    accent = "$e[38;2;217;119;87m"
    text   = "$e[38;2;229;229;229m"
    dim    = "$e[38;2;140;140;140m"
    ok     = "$e[38;2;124;203;138m"
    warn   = "$e[38;2;230;192;123m"
    bold   = "$e[1m"
    reset  = "$e[0m"
  }
}

# --------------------------------------------------------------------------- data

function Get-InstalledVersion {
  $manifest = Join-Path $script:ExtDir 'CSXS\manifest.xml'
  if (-not (Test-Path -LiteralPath $manifest)) { return $null }
  try {
    $text = [IO.File]::ReadAllText($manifest)
    $m = [regex]::Match($text, 'ExtensionBundleVersion\s*=\s*"([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
  } catch { }
  return 'unknown'
}

function Get-Status {
  $ai = @()
  try { $ai = @(Get-Process -Name Illustrator -ErrorAction SilentlyContinue) } catch { }
  return @{
    Version = (Get-InstalledVersion)
    Illustrator = ($ai.Count -gt 0)
    User = $(if ($env:USERNAME) { [string]$env:USERNAME } else { 'there' })
  }
}

# --------------------------------------------------------------------------- render

function Out-Line([string]$Text) {
  [Console]::Write($Text + "`n")
}

function Render-Header($St) {
  $version = ''
  $state = 'Ready to install.'
  $stateColor = 'dim'
  if ($St.Version) {
    $version = ' ' + $script:G.dot + ' v' + $St.Version
    $state = 'Installed and ready.'
    $stateColor = 'ok'
  }

  $m1 = '  ' + $script:G.node + '  '
  $m2 = ' ' + $script:G.dl + ' ' + $script:G.dr + ' '
  $m3 = $script:G.node + '   ' + $script:G.node

  Out-Line ''
  Out-Line ('  ' + $script:C.accent + $m1 + $script:C.reset + '   ' + $script:C.bold + $script:C.accent + 'MOCKUP STUDIO' + $script:C.reset + $script:C.dim + $version + $script:C.reset)
  Out-Line ('  ' + $script:C.accent + $m2 + $script:C.reset + '   ' + $script:C[$stateColor] + $state + $script:C.reset)
  Out-Line ('  ' + $script:C.accent + $m3 + $script:C.reset)
  Out-Line ''
  Out-Line ('  ' + $script:C.text + 'This installs or updates the panel inside Illustrator.' + $script:C.reset)
  Out-Line ('  ' + $script:C.dim + 'It takes about a minute.' + $script:C.reset)

  if ($St.Illustrator) {
    Out-Line ''
    Out-Line ('  ' + $script:C.warn + 'Illustrator is open. Close it first, then come back.' + $script:C.reset)
  }

  Out-Line ''
}

function Render-Menu {
  for ($i = 0; $i -lt $script:Items.Count; $i++) {
    $selected = ($i -eq $script:Sel)
    if ($selected) {
      Out-Line ('  ' + $script:C.accent + $script:G.arrow + ' ' + $script:C.bold + $script:Items[$i] + $script:C.reset)
    } else {
      Out-Line ('    ' + $script:C.text + $script:Items[$i] + $script:C.reset)
    }
  }
}

function Render-Footer {
  Out-Line ''
  $up = 'Up'
  $down = 'Down'
  if ($script:Unicode) {
    $up = [string][char]0x2191
    $down = [string][char]0x2193
  }
  Out-Line ('  ' + $script:C.dim + $up + ' ' + $down + '  choose     Enter  run' + $script:C.reset)
  Out-Line ''
}

function Show-PlainScreen($St) {
  Out-Line ''
  Out-Line '  MOCKUP STUDIO'
  if ($St.Version) { Out-Line ('  Installed v' + $St.Version) } else { Out-Line '  Ready to install' }
  Out-Line ''
  Out-Line '  This installs or updates the panel inside Illustrator.'
  if ($St.Illustrator) { Out-Line '  Illustrator is open. Close it first, then come back.' }
  Out-Line ''
  for ($i = 0; $i -lt $script:Items.Count; $i++) {
    Out-Line ('  ' + ($i + 1) + '  ' + $script:Items[$i])
  }
  Out-Line ''
}

# --------------------------------------------------------------------------- actions

function Wait-Return {
  Out-Line ''
  if ($script:PlainMode) {
    [void](Read-Host '  Press Enter to return')
    return
  }
  Out-Line ('  ' + $script:C.dim + 'Press any key to return to the menu.' + $script:C.reset)
  [void][Console]::ReadKey($true)
}

function Confirm-Action([string]$Question) {
  if ($script:PlainMode) {
    Out-Line ('  ' + $Question + ' (y/N) ')
    $a = Read-Host
    return (([string]$a).Trim().ToLowerInvariant() -eq 'y')
  }
  Out-Line ''
  [Console]::Write('  ' + $script:C.warn + $Question + '  (y/N) ' + $script:C.reset)
  $k = [Console]::ReadKey($true)
  Out-Line ([string]$k.KeyChar)
  return (([string]$k.KeyChar).ToLowerInvariant() -eq 'y')
}

function Write-ActionHeader([string]$Title) {
  Out-Line ''
  Out-Line ('  ' + $script:C.bold + $script:C.accent + $Title + $script:C.reset)
  Out-Line ('  ' + $script:C.dim + ('-' * 40) + $script:C.reset)
  Out-Line ''
}

function Invoke-LocalScript([string]$Name, [string[]]$ExtraArgs = @()) {
  $file = Join-Path $PSScriptRoot $Name
  if (-not (Test-Path -LiteralPath $file)) {
    Out-Line ''
    Out-Line ('  ' + $script:C.warn + 'Missing ' + $Name + ' in the installer payload.' + $script:C.reset)
    return $false
  }
  Out-Line ('  ' + $script:C.dim + 'Running ' + $Name + ' ...' + $script:C.reset)
  Out-Line ''
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file @ExtraArgs
  return ($LASTEXITCODE -eq 0)
}

# The vectorizer agent is a Node.js program and install.ps1 installs its npm dependencies.
# install.ps1 now fetches the official Node.js LTS into %LOCALAPPDATA%\Programs\nodejs when
# the PC has none, so a missing Node is no longer a reason to refuse - it is only worth
# announcing, because that download needs an internet connection.
function Get-NodeProblem {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) { return '' }
    return 'Node.js is on PATH, but npm was not found next to it.'
  }
  if (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')) { return '' }
  return 'Node.js was not found on this PC.'
}

function Show-NodeWillInstall([string]$Problem, [switch]$CleanInstall) {
  Out-Line ('  ' + $script:C.warn + $Problem + $script:C.reset)
  Out-Line ('  ' + $script:C.text + 'Setup will download the official Node.js LTS build (about 30 MB, checksum-' + $script:C.reset)
  Out-Line ('  ' + $script:C.text + 'verified) into your own AppData folder. No admin rights, no PATH change.' + $script:C.reset)
  Out-Line ('  ' + $script:C.dim + 'The agent needs it to run; an existing Node.js is used instead and never touched.' + $script:C.reset)
  Out-Line ('  ' + $script:C.dim + 'This download needs an internet connection.' + $script:C.reset)
  if ($CleanInstall) {
    Out-Line ('  ' + $script:C.dim + 'If it fails, the panel stays removed: get online and pick option 1 to put it back.' + $script:C.reset)
  }
  Out-Line ''
}

function Open-DataFolder {
  $target = $script:RuntimeData
  if (-not (Test-Path -LiteralPath $target)) {
    $target = Join-Path $env:USERPROFILE 'Documents'
  }
  try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"') } catch { }
}

function Open-ChromeBridge {
  if (Test-Path -LiteralPath $script:BridgeDir) {
    try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $script:BridgeDir + '"') } catch { }
  }
  $chrome = @(
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  try {
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions' }
    else { Start-Process 'chrome://extensions' }
  } catch { }
}

function Get-IllustratorArgs([string]$Question) {
  # install.ps1 refuses to run while Illustrator is open unless -Force is passed; ask here
  # instead of failing after the copy has started.
  $result = @{ Ok = $true; Extra = @() }
  $ai = @(Get-Process -Name Illustrator -ErrorAction SilentlyContinue)
  if ($ai.Count -gt 0) {
    if (-not (Confirm-Action $Question)) { $result.Ok = $false; return $result }
    $result.Extra = @('-Force')
  }
  return $result
}

function Invoke-Action([int]$Index) {
  if ($Index -eq 3) { Open-DataFolder; return }
  if ($Index -eq 4) { return }
  if (-not $script:PlainMode) { Clear-Host }

  if ($Index -eq 0) {
    $firstInstall = -not (Get-InstalledVersion)
    Write-ActionHeader 'Install or update'
    $nodeProblem = Get-NodeProblem
    if ($nodeProblem) { Show-NodeWillInstall $nodeProblem }
    $ask = Get-IllustratorArgs 'Illustrator is open. Install anyway? You must restart it afterwards.'
    if (-not $ask.Ok) {
      Out-Line ('  ' + $script:C.dim + 'Cancelled. Close Illustrator and try again.' + $script:C.reset)
      Start-Sleep -Milliseconds 600
      return
    }
    $ok = Invoke-LocalScript 'install.ps1' $ask.Extra
    if ($ok) {
      Out-Line ''
      Out-Line ('  ' + $script:C.ok + 'Done. Restart Illustrator, then: Window > Extensions > Mockup Studio.' + $script:C.reset)
      if ($firstInstall) {
        Out-Line ('  ' + $script:C.dim + 'Opening the Chrome bridge folder and chrome://extensions for the one-time load.' + $script:C.reset)
        Open-ChromeBridge
      }
    } else {
      Out-Line ''
      Out-Line ('  ' + $script:C.warn + 'The installer reported a problem. See the messages above.' + $script:C.reset)
      Out-Line ('  ' + $script:C.dim + 'Nothing in Documents\VectorizerBridge was changed.' + $script:C.reset)
    }
    Wait-Return
    return
  }

  if ($Index -eq 1) {
    Write-ActionHeader 'Clean install'
    Out-Line ('  ' + $script:C.text + 'Removes the installed panel, then installs a fresh copy.' + $script:C.reset)
    Out-Line ('  ' + $script:C.dim + 'Your files in Documents\VectorizerBridge are kept.' + $script:C.reset)
    Out-Line ''
    if (-not (Confirm-Action 'Remove the panel and install a clean copy?')) {
      Out-Line ('  ' + $script:C.dim + 'Cancelled. Nothing was changed.' + $script:C.reset)
      Start-Sleep -Milliseconds 500
      return
    }
    # Say it before removing anything, so the download is not a surprise after the panel is gone.
    $nodeProblem = Get-NodeProblem
    if ($nodeProblem) { Show-NodeWillInstall $nodeProblem -CleanInstall }
    # Ask about Illustrator before removing anything, so a cancel leaves the old copy intact.
    $ask = Get-IllustratorArgs 'Illustrator is open. Continue anyway? You must restart it afterwards.'
    if (-not $ask.Ok) {
      Out-Line ('  ' + $script:C.dim + 'Cancelled. Nothing was changed. Close Illustrator and try again.' + $script:C.reset)
      Start-Sleep -Milliseconds 600
      return
    }
    $removed = $true
    if (Get-InstalledVersion) {
      $removed = Invoke-LocalScript 'uninstall.ps1'
    } else {
      Out-Line ('  ' + $script:C.dim + 'No installed panel found; installing from scratch.' + $script:C.reset)
      Out-Line ''
    }
    if (-not $removed) {
      Out-Line ''
      Out-Line ('  ' + $script:C.warn + 'The old copy could not be removed, so nothing was installed.' + $script:C.reset)
      Out-Line ('  ' + $script:C.dim + 'Close Illustrator and any agent Chrome windows, then try again.' + $script:C.reset)
      Wait-Return
      return
    }
    Write-ActionHeader 'Clean install - putting the panel back'
    $ok = Invoke-LocalScript 'install.ps1' $ask.Extra
    if ($ok) {
      Out-Line ''
      Out-Line ('  ' + $script:C.ok + 'Clean install done. Restart Illustrator, then: Window > Extensions > Mockup Studio.' + $script:C.reset)
    } else {
      Out-Line ''
      Out-Line ('  ' + $script:C.warn + 'The installer reported a problem. See the messages above.' + $script:C.reset)
      Out-Line ('  ' + $script:C.dim + 'Nothing in Documents\VectorizerBridge was changed.' + $script:C.reset)
    }
    Wait-Return
    return
  }

  Write-ActionHeader 'Remove from this computer'
  $version = Get-InstalledVersion
  if (-not $version) {
    Out-Line ('  ' + $script:C.warn + 'The panel is not installed. Nothing to remove.' + $script:C.reset)
    Wait-Return
    return
  }
  if (-not (Confirm-Action 'Remove Mockup Studio?')) {
    Out-Line ('  ' + $script:C.dim + 'Cancelled. Nothing was changed.' + $script:C.reset)
    Start-Sleep -Milliseconds 500
    return
  }
  $ok = Invoke-LocalScript 'uninstall.ps1'
  Out-Line ''
  if ($ok) {
    Out-Line ('  ' + $script:C.ok + 'Removed. Your files in Documents\VectorizerBridge were kept.' + $script:C.reset)
    if (Test-Path -LiteralPath $script:BridgeDir) {
      Out-Line ('  ' + $script:C.dim + 'The Chrome bridge folder was kept (Chrome still loads it): ' + $script:BridgeDir + $script:C.reset)
    }
  } else {
    Out-Line ('  ' + $script:C.warn + 'The uninstaller reported a problem. See the messages above.' + $script:C.reset)
  }
  Wait-Return
}

# --------------------------------------------------------------------------- main

Initialize-SetupUi

while ($true) {
  $status = Get-Status
  if (-not $script:PlainMode) { Clear-Host }
  if ($script:PlainMode) {
    Show-PlainScreen $status
  } else {
    Render-Header $status
  }

  $choice = -1

  if ($script:PlainMode) {
    $answer = Read-Host '  Choose 1-4 (q to quit)'
    if ($null -eq $answer) { break }
    $answer = ([string]$answer).Trim()
    if ($answer -eq 'q' -or $answer -eq 'Q') { break }
    $n = 0
    if (-not [int]::TryParse($answer, [ref]$n)) { continue }
    if ($n -lt 1 -or $n -gt $script:Items.Count) { continue }
    $choice = $n - 1
  } else {
    $menuTop = [Console]::CursorTop
    for ($i = 0; $i -lt $script:Items.Count; $i++) { Out-Line '' }
    Render-Footer
    while ($true) {
      try { [Console]::SetCursorPosition(0, $menuTop) } catch { }
      Render-Menu
      $key = [Console]::ReadKey($true)
      if ($key.Key -eq 'UpArrow') {
        $script:Sel = ($script:Sel + $script:Items.Count - 1) % $script:Items.Count
        continue
      }
      if ($key.Key -eq 'DownArrow') {
        $script:Sel = ($script:Sel + 1) % $script:Items.Count
        continue
      }
      if ($key.Key -eq 'Escape') { return }
      if ($key.Key -eq 'Enter') { $choice = $script:Sel; break }
      $n = 0
      if ([int]::TryParse([string]$key.KeyChar, [ref]$n) -and $n -ge 1 -and $n -le $script:Items.Count) {
        $script:Sel = $n - 1
        $choice = $script:Sel
        break
      }
    }
  }

  if ($choice -eq 4) { return }
  Invoke-Action $choice
}
