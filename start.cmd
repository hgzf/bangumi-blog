@echo off
setlocal
cd /d "%~dp0"

if exist "node_modules\electron\dist\electron.exe" (
  "node_modules\electron\dist\electron.exe" .
  exit /b %errorlevel%
)

if not exist "node_modules\.bin\electron.cmd" (
  echo Dependencies are missing. Restore the node_modules directory first.
  pause
  exit /b 1
)

call "node_modules\.bin\electron.cmd" .
exit /b %errorlevel%
