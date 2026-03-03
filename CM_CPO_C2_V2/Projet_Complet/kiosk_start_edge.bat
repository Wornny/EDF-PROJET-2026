@echo off
setlocal

rem Script de lancement en mode kiosk.
rem Le mode kiosk sert a enlever la barre de recherche/onglets en haut.

set "URL=http://192.168.190.1:5000"

set "EDGE_EXE="
where msedge >nul 2>nul
if %errorlevel%==0 set "EDGE_EXE=msedge"

if not defined EDGE_EXE if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined EDGE_EXE if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if not defined EDGE_EXE (
  echo Edge introuvable. Installe Microsoft Edge ou adapte ce script.
  pause
  exit /b 1
)

start "" "%EDGE_EXE%" --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-features=msHubApps

endlocal
