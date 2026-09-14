@echo off
setlocal
rem dsh-ag installer - runs install.ps1 next to this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation did not finish. See the messages above.
  pause
  exit /b 1
)
echo.
pause
