@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%setup-codex-azure-gpt54.ps1"

if not exist "%PS_SCRIPT%" (
  echo Script bulunamadi: "%PS_SCRIPT%"
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Kurulum basarisiz oldu. Cikis kodu: %EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo.
echo Kurulum tamamlandi. Codex Desktop'u yeniden ac.
pause
exit /b 0
