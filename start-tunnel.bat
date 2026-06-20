@echo off
title Mahad SSH Tunnel
color 0A
:loop
echo.
echo [%time%] Starting SSH tunnel...
cd /d "%~dp0api"
node tunnel.js
echo.
echo [%time%] Tunnel stopped. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
