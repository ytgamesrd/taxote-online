@echo off
title TAXOTE - Servidor local
set "TAXOTE_NODE=C:\Users\YTgamesRD\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%TAXOTE_NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo No se encontro Node.js en esta computadora.
    echo Instala Node.js o abre el proyecto desde Codex para ejecutar TAXOTE.
    pause
    exit /b 1
  )
  set "TAXOTE_NODE=node"
)

cd /d "%~dp0"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4173/api/maps-status' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto abrir_taxote

start "TAXOTE - Servidor" "%TAXOTE_NODE%" --no-warnings server.js
timeout /t 1 /nobreak >nul

:abrir_taxote
start "" "http://127.0.0.1:4173"
