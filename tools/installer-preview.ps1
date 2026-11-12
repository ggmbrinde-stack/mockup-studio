<#
  Mockup Studio - installer UI preview (DEMO ONLY).

  Shows exactly what install-online.ps1 looks like, with scripted steps and fake
  results. It downloads nothing, writes nothing, starts no process and touches no
  folder or registry key. The presentation functions below are a copy of the ones
  in install-online.ps1: if you change the look there, copy them here too.

  Usage (from the repo folder):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer-preview.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer-preview.ps1 -First
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer-preview.ps1 -Fail
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\installer-preview.ps1 -Quick

  -First   first install (nothing installed yet)
  -Fail    stop at step 6 and show the failure screen
  -Quick   skip the delays between steps
#>
[CmdletBinding()]
param(
  [switch]$First,
  [switch]$Fail,
  [switch]$Quick
)

$ErrorActionPreference = 'Stop'

$stepDelay = 450
if ($Quick) { $stepDelay = 0 }

# ---------------------------------------------------------------------- presentation
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
function Pause-Step { if ($stepDelay -gt 0) { Start-Sleep -Milliseconds $stepDelay } }

# ---------------------------------------------------------------------- fake run
$version = '2.3.6'
$currentVersion = '2.3.5'
if ($First) { $currentVersion = '' }

$exitCode = 0
try {
  Initialize-Ui
  Write-Host ''
  Write-Host '  MOCKUP STUDIO' -ForegroundColor Cyan -NoNewline
  Write-Host '   Vectorizer Bridge for Illustrator' -ForegroundColor DarkGray
  Write-Host ('  ' + ('-' * 62)) -ForegroundColor DarkGray

  $panelState = 'first install'
  if ($currentVersion) { $panelState = 'installed ' + $currentVersion }
  Write-Host ('  ' + 'Panel'.PadRight(13) + $panelState)
  Write-Host ('  ' + 'Illustrator'.PadRight(13) + 'Adobe Illustrator 2027 (31.0)  +2')
  Write-Host ('  ' + 'Node.js'.PadRight(13) + 'v26.13.0')
  Write-Host ('  ' + 'Your files'.PadRight(13) + 'C:\Users\you\Documents\VectorizerBridge') -ForegroundColor DarkGray
  Write-Host ('  ' + ''.PadRight(13) + 'never written, moved or deleted by setup') -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Nothing outside the panel folder, its rollback copies, the private Node.js copy' -ForegroundColor DarkGray
  Write-Host '  and HKCU\Software\Adobe\CSXS.9-16 is touched.' -ForegroundColor DarkGray
  Write-Host ''

  Start-Step 1 7 'Finding and downloading the release'
  Pause-Step
  Say ("release $version  (97.6 KB)")
  Pause-Step
  Step-Ok 'downloaded, SHA-256 matches (2bacc3df55c1...)'

  Start-Step 2 7 'Checking the package before installing'
  Pause-Step
  Step-Ok ("v$version - Illustrator 31.0 supported +2")

  Start-Step 3 7 'Preparing Node.js'
  Pause-Step
  Step-Ok 'using the Node.js already on this computer (v26.13.0)'

  Start-Step 4 7 'Stopping the background agent'
  Pause-Step
  if ($First) { Step-Skip 'nothing to stop' } else { Step-Ok 'agent is stopped' }

  Start-Step 5 7 'Backing up the current install'
  Pause-Step
  if ($First) { Step-Skip 'first install, nothing to back up' }
  else { Step-Ok ('saved to C:\Users\you\AppData\Local\VectorizerBridge\install-backups\' + $currentVersion + '-20261112-111601') }

  Start-Step 6 7 'Installing the panel'
  Pause-Step
  Say 'panel files copied'
  Pause-Step
  Say 'installing agent dependencies (npm install --omit=dev) ...'
  Pause-Step
  if ($Fail) {
    Say 'npm output (last 15 lines):' 'Yellow'
    Say '  npm error code EACCES' 'Yellow'
    Say '  npm error syscall mkdir' 'Yellow'
    Fail 'npm install failed (exit 1). The previous install was restored.'
  }
  Step-Ok ("version $version, all required files present")

  Start-Step 7 7 'Enabling the panel in Illustrator'
  Pause-Step
  Step-Ok 'unsigned CEP enabled for CSXS 9-16 (current user only)'

  # ---------------------------------------------------------------- done
  Clear-UiLine
  Write-Host ''
  $wasUpdate = [bool]($currentVersion -and $currentVersion -ne $version)
  $headline = 'installed ' + $version
  if ($wasUpdate) { $headline = 'updated ' + $currentVersion + ' -> ' + $version }
  $summary = '35 files - 23 agent packages - Node.js v26.13.0'
  Write-Host ('  ' + $headline.Substring(0, 1).ToUpper() + $headline.Substring(1)) -ForegroundColor Green -NoNewline
  Write-Host ('   ' + $summary) -ForegroundColor DarkGray
  Write-Host '  C:\Users\you\AppData\Roaming\Adobe\CEP\extensions\com.bestofgifts.vectorizerbridge' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Save your open documents first: restarting Illustrator closes every open file.' -ForegroundColor Yellow
  Write-Host '  Then restart Illustrator and open Window > Extensions > Vectorizer Bridge.' -ForegroundColor White
  Write-Host '  The panel runs a short first-time setup: language, sign in, defaults.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Undo: set VB_INSTALL_VERSION to an older release and re-run, or use uninstall.ps1.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  (Demo only: nothing was downloaded, installed or changed.)' -ForegroundColor DarkMagenta
  Write-Host ''
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
  Write-Host ''
  Write-Host '  Nothing in Documents\VectorizerBridge was changed.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  (Demo only: no rollback ran, nothing was changed.)' -ForegroundColor DarkMagenta
  Write-Host ''
  $exitCode = 1
}

exit $exitCode
