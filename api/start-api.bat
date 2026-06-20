@echo off
REM ── Mahad API launcher (auto-restart supervisor) ──────────────────────────
REM Used by the "MahadApiServer" scheduled task to start the API at logon.
cd /d "%~dp0"
node supervisor.js >> "%~dp0server.log" 2>&1
