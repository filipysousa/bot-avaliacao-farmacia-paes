@echo off
chcp 65001 >nul
title Bot de Avaliacao - Farmacia Paes (teste)
cd /d "%~dp0"
where node >nul 2>nul || set "PATH=%ProgramFiles%\nodejs;%PATH%"
node app.js
pause
