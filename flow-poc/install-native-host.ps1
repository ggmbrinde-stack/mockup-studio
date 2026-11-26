# Mockup Studio Flow Bridge - Native Messaging Host Installer
# Run as Administrator

$ErrorActionPreference = "Stop"

$manifestName = "com.bestofgifts.mockupstudio.flow"
$manifestPath = "C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\agent\native-messaging-manifest.json"
$batPath = "C:\Users\user\Videos\BestOfGifts_Master\repos\mockup-studio\flow-poc\agent\flow-bridge.bat"
$regPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$manifestName"

Write-Host "Installing Native Messaging Host: $manifestName" -ForegroundColor Cyan

if (-not (Test-Path $batPath)) {
    Write-Error "Batch file not found: $batPath"
    exit 1
}

if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest not found: $manifestPath"
    exit 1
}

# Update manifest with correct batch path
$manifest = Get-Content $manifestPath -Raw
$manifest = $manifest -replace 'C:\\\\Users\\\\user\\\\Videos\\\\BestOfGifts_Master\\\\repos\\\\mockup-studio\\\\flow-poc\\\\agent\\\\flow-bridge\.bat', $batPath.replace('\', '\\')
$manifest | Set-Content $manifestPath -Encoding UTF8

# Create registry key
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "(Default)" -Value $manifestPath -Force

Write-Host "Native Messaging Host installed successfully." -ForegroundColor Green
Write-Host "Registry: $regPath" -ForegroundColor Gray
Write-Host "Manifest: $manifestPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Install Chrome extension from: flow-poc/extension" -ForegroundColor Gray
Write-Host "2. Run 'npm install' in flow-poc/agent" -ForegroundColor Gray
Write-Host "3. Run 'npm install' and 'npm run dev' in flow-poc/ui" -ForegroundColor Gray