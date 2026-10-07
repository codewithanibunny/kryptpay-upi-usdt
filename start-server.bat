@echo off
title NexaPay Executive Server Launcher
echo ====================================================
echo 👑 Starting NexaPay Server 24/7 Background Service...
echo ====================================================

cd /d "%~dp0"
node server.js

pause
