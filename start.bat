@echo off
title Dota Caster Kit
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
start "" http://127.0.0.1:58900/
node app\server.js
pause
