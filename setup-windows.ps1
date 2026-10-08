# NexaPay Automated Windows RDP Setup Script
$ErrorActionPreference = "Continue"

Write-Host "====================================================" -ForegroundColor Green
Write-Host "Starting NexaPay Windows RDP 24/7 Server Setup..." -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green

# 1. Prepare App Directory
$appDir = "C:\NexaPay"
if (-not (Test-Path $appDir)) {
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
}
Set-Location $appDir

# 2. Download Latest Code from GitHub
Write-Host "Downloading NexaPay Codebase..." -ForegroundColor Cyan
$zipUrl = "https://github.com/codewithanibunny/kryptpay-upi-usdt/archive/refs/heads/master.zip"
$zipPath = "C:\NexaPay\nexapay.zip"
$extractPath = "C:\NexaPay\extracted"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }

Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
Copy-Item -Path "$extractPath\kryptpay-upi-usdt-master\*" -Destination $appDir -Recurse -Force

# 3. Check & Download Cloudflared Executable
$cloudflaredPath = "C:\NexaPay\cloudflared.exe"
if (-not (Test-Path $cloudflaredPath)) {
    Write-Host "📥 Downloading Cloudflare Tunnel Executable..." -ForegroundColor Yellow
    $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -Uri $cfUrl -OutFile $cloudflaredPath
}

# 4. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not detected. Downloading Node.js LTS Installer..." -ForegroundColor Yellow
    $msiUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
    $msiPath = "C:\NexaPay\node_install.msi"
    Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath
    Start-Process msiexec.exe -ArgumentList '/i', $msiPath, '/qn', '/norestart' -Wait
    $env:Path = $env:Path + ';C:\Program Files\nodejs\'
}

# 5. Install Node Packages
Write-Host "Installing NPM Dependencies..." -ForegroundColor Cyan
npm install --production

# 6. Start Server with PM2
Write-Host "Launching Server..." -ForegroundColor Green
npm install -g pm2
pm2 stop nexapay -s
pm2 start server.js --name nexapay
pm2 save

# 7. Start Cloudflare Tunnel Daemon
Write-Host "Connecting Cloudflare Tunnel to https://nexapay.work.gd..." -ForegroundColor Green
$tunnelToken = 'eyJhIjoiYmY0MGY4NjUyMTFkYjNiZWZjNTc5YWM5M2FhMjg2MGIiLCJ0IjoiNjFiZjNmNmItODMxMi00YWEwLTkzYzQtOWVlYjI3ZjJhM2U4IiwicyI6IllURmxOR0ZoTVRVdFpEUTBaaTAwTlRsakxXSmxOREV0TURSbE4yVTFORFF3WkRNNCJ9'
Start-Process -FilePath "C:\NexaPay\cloudflared.exe" -ArgumentList 'tunnel', 'run', '--token', $tunnelToken -NoNewWindow

Write-Host "====================================================" -ForegroundColor Green
Write-Host "🎉 SUCCESS! NexaPay Node.js & Cloudflare Tunnel are running 24/7!" -ForegroundColor Green
Write-Host "👉 Website URL: https://nexapay.work.gd" -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Green
