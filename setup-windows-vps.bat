@echo off
TITLE NexaPay Windows RDP 24/7 Server Setup
color 0A

echo ========================================================
echo 🚀 NexaPay Executive Windows RDP Setup
echo ========================================================

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ⚠️ Node.js is not installed on this RDP.
    echo 📥 Please download and install Node.js from https://nodejs.org
    pause
    exit /b
)

:: 2. Install dependencies
echo 📦 Installing NPM packages...
call npm install --production

:: 3. Install PM2 for Windows
echo ⚙️ Installing PM2 Process Manager for 24/7 Windows Uptime...
call npm install -g pm2
call npm install -g pm2-windows-startup

:: 4. Setup PM2 Startup Service
echo 🛡️ Configuring Windows Auto-Startup on Reboot...
call pm2-startup install

:: 5. Start Server
echo 🚀 Launching NexaPay Server on Port 5000...
call pm2 stop nexapay >nul 2>nul
call pm2 start server.js --name nexapay
call pm2 save

echo ========================================================
echo ✅ NexaPay is running 24/7 on this Windows RDP!
echo 🌐 Local Server: http://localhost:5000
echo ========================================================
pause
