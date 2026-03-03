@echo off
setlocal

rem Script de lancement en mode kiosk.
rem Le mode kiosk sert a enlever la barre de recherche/onglets en haut.

set "URL=http://192.168.190.1:5000"
set "KIOSK_PROFILE=%TEMP%\chrome-kiosk-profile"

set "CHROME_EXE="
where chrome >nul 2>nul
if %errorlevel%==0 set "CHROME_EXE=chrome"

if not defined CHROME_EXE if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if not defined CHROME_EXE (
  echo Chrome introuvable. Installe Google Chrome ou adapte ce script.
  pause
  exit /b 1
)

rem Evite que Chrome reutilise une fenetre normale deja ouverte
taskkill /F /IM chrome.exe >nul 2>nul
timeout /t 1 /nobreak >nul

start "" "%CHROME_EXE%" --kiosk --new-window "%URL%" --user-data-dir="%KIOSK_PROFILE%" --no-first-run --no-default-browser-check --disable-session-crashed-bubble

endlocal