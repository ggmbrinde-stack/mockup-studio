# Mockup Studio Flow Bridge - Update Native Messaging Manifest with Extension ID
# Run after installing the Chrome extension

param(
    [Parameter(Mandatory=$true)]
    [string]$ExtensionId
)

$ErrorActionPreference = "Stop"

$manifestPath = "C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\agent\native-messaging-manifest.json"

Write-Host "Updating native messaging manifest with Extension ID: $ExtensionId" -ForegroundColor Cyan

if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest not found: $manifestPath"
    exit 1
}

$manifest = Get-Content $manifestPath -Raw
$manifest = $manifest -replace '__EXTENSION_ID__', $ExtensionId
$manifest | Set-Content $manifestPath -Encoding UTF8

Write-Host "Manifest updated successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Verifying registry..." -ForegroundColor Cyan
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bestofgifts.mockupstudio.flow"
$regValue = Get-ItemProperty -Path $regPath -Name "(Default)" -ErrorAction SilentlyContinue
if ($regValue) {
    Write-Host "Registry points to: $($regValue.'(Default)')" -ForegroundColor Gray
} else {
    Write-Warning "Registry entry not found. Run install-native-host.ps1 first."
}

Write-Host ""
Write-Host "Restart Chrome for changes to take effect." -ForegroundColor Yellow