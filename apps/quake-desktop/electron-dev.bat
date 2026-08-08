@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "BAT_PATH=%~f0"
set "PID_FILE=%~dp0.electron-dev.pid"
set "PORT_FILE=%~dp0.electron-dev.ports"
set "ELECTRON_DEV_ROOT=%~dp0"
set "ELECTRON_DEV_BAT=%~f0"
set "ELECTRON_DEV_PORT_FILE=%~dp0.electron-dev.ports"

if /i "%~1"=="__run" goto run_dev

cd /d "%ROOT%" || (
  echo ERROR: Project directory could not be opened.
  exit /b 1
)

:menu
echo.
echo ========================================
echo Quake Code Electron Dev
echo ========================================
echo [1] Electron dev baslat
echo [2] Electron dev yeniden baslat
echo [0] Cikis
echo.
set "MENU_CHOICE="
set /p "MENU_CHOICE=Secim: "
if not defined MENU_CHOICE exit /b 0

if "%MENU_CHOICE%"=="1" (
  call :start_dev
  goto menu
)
if "%MENU_CHOICE%"=="2" (
  call :restart_dev
  goto menu
)
if "%MENU_CHOICE%"=="0" exit /b 0

echo Gecersiz secim. 1, 2 veya 0 girin.
goto menu

:start_dev
echo.
echo Electron dev baslatiliyor...
call :validate_config
if errorlevel 1 exit /b 1

call :read_pid
if defined DEV_PID (
  set "ELECTRON_DEV_CHECK_PID=!DEV_PID!"
  call :validate_managed_pid
  if not errorlevel 1 (
    echo Yonetilen Electron dev zaten calisiyor. PID: !DEV_PID!
    exit /b 0
  )
  echo Eski veya gecersiz PID kaydi temizleniyor: !DEV_PID!
  del /q "%PID_FILE%" >nul 2>&1
)

call :get_port_pid 5173
if defined PORT_PID (
  echo Port 5173 zaten kullaniliyor. PID: !PORT_PID!
  echo Ikinci bir Electron dev sureci baslatilmadi.
  exit /b 1
)

set "BLOCKED_PORT="
set "BLOCKED_PID="
for %%Q in (3737 9222 9223 9224 51999) do (
  if not defined BLOCKED_PORT (
    call :get_port_pid %%Q
    if defined PORT_PID (
      set "BLOCKED_PORT=%%Q"
      set "BLOCKED_PID=!PORT_PID!"
    )
  )
)
if defined BLOCKED_PORT (
  echo Port !BLOCKED_PORT! zaten kullaniliyor. PID: !BLOCKED_PID!
  echo Guvenli baslatma icin once ilgili sureci kapatin veya yeniden baslat secenegini kullanin.
  exit /b 1
)

call :launch_dev
if errorlevel 1 exit /b 1

call :wait_for_core 120
if errorlevel 1 (
  echo UYARI: PID !DEV_PID! baslatildi ancak 5173 ve 3737 zamaninda hazir olmadi.
  echo Ayrintilar ayri Electron dev CMD penceresindedir.
  exit /b 1
)

call :wait_for_electron 60
if errorlevel 1 (
  echo UYARI: Vite ve API hazir, ancak QuakeCode.exe --dev dogrulanamadi.
) else (
  echo QuakeCode.exe --dev dogrulandi.
)

call :capture_port_owners
echo Electron dev hazir. Kok CMD PID: !DEV_PID!
echo Vite: http://127.0.0.1:5173
echo API:  http://127.0.0.1:3737
exit /b 0

:restart_dev
echo.
echo Electron dev yeniden baslatiliyor...
call :validate_config
if errorlevel 1 exit /b 1

call :stop_managed
call :wait_for_ports_free 60
if errorlevel 1 (
  echo Yeniden baslatma iptal edildi. Projeye ait olmayan bir port sureci korunuyor olabilir.
  exit /b 1
)

call :start_dev
exit /b !errorlevel!

:stop_managed
call :read_pid
if defined DEV_PID (
  set "ELECTRON_DEV_CHECK_PID=!DEV_PID!"
  call :validate_managed_pid
  if not errorlevel 1 (
    echo Yonetilen surec agaci kapatiliyor. PID: !DEV_PID!
    "%SystemRoot%\System32\taskkill.exe" /PID !DEV_PID! /T /F >nul 2>&1
  ) else (
    echo PID !DEV_PID! artik bu BAT tarafindan yonetilen CMD sureci degil. Dokunulmadi.
  )
)

del /q "%PID_FILE%" >nul 2>&1

for %%Q in (5173 3737 9222 9223 9224 51999) do call :cleanup_project_port %%Q
exit /b 0

:cleanup_project_port
call :get_port_pid %~1
if not defined PORT_PID exit /b 0

set "ELECTRON_DEV_CHECK_PORT=%~1"
set "ELECTRON_DEV_CHECK_PID=!PORT_PID!"
call :get_owned_kill_pid
if not defined OWNED_KILL_PID (
  echo Port %~1 PID !PORT_PID! bu projeye ait olarak dogrulanamadi. Dokunulmadi.
  exit /b 0
)

echo Projeye ait port %~1 sureci temizleniyor. PID: !OWNED_KILL_PID!
"%SystemRoot%\System32\taskkill.exe" /PID !OWNED_KILL_PID! /T /F >nul 2>&1
exit /b 0

:launch_dev
set "DEV_PID="
for /f "delims=" %%P in ('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$quotedBat=[char]34+$env:ELECTRON_DEV_BAT+[char]34; $arguments=@('/d','/c','call',$quotedBat,'__run'); $process=Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -WorkingDirectory $env:ELECTRON_DEV_ROOT -WindowStyle Normal -PassThru; $process.Id"') do if not defined DEV_PID set "DEV_PID=%%P"

if not defined DEV_PID (
  echo ERROR: Ayri Electron dev CMD penceresi baslatilamadi.
  exit /b 1
)

echo(!DEV_PID!| "%SystemRoot%\System32\findstr.exe" /R /X "[0-9][0-9]*" >nul
if errorlevel 1 (
  echo ERROR: Baslatilan CMD icin gecerli PID alinamadi: !DEV_PID!
  set "DEV_PID="
  exit /b 1
)

> "%PID_FILE%.tmp" echo(!DEV_PID!
move /y "%PID_FILE%.tmp" "%PID_FILE%" >nul
exit /b 0

:validate_config
"%SystemRoot%\System32\findstr.exe" /L /C:"vite --config vite.config.ts --host 127.0.0.1 --port 5173 --strictPort" "%ROOT%package.json" >nul
if errorlevel 1 (
  echo ERROR: package.json desktop:dev Vite ayari eksik.
  echo Beklenen: --host 127.0.0.1 --port 5173 --strictPort
  exit /b 1
)
exit /b 0

:read_pid
set "DEV_PID="
if not exist "%PID_FILE%" exit /b 0
for /f "usebackq tokens=1" %%P in ("%PID_FILE%") do if not defined DEV_PID set "DEV_PID=%%P"
exit /b 0

:validate_managed_pid
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "[int]$pidValue=0; if(-not [int]::TryParse($env:ELECTRON_DEV_CHECK_PID,[ref]$pidValue)){exit 1}; $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue) -ErrorAction SilentlyContinue; if(-not $process){exit 1}; $command=[string]$process.CommandLine; $hasBat=$command.IndexOf($env:ELECTRON_DEV_BAT,[StringComparison]::OrdinalIgnoreCase)-ge 0; $hasMode=$command.IndexOf('__run',[StringComparison]::OrdinalIgnoreCase)-ge 0; if($process.Name -ieq 'cmd.exe' -and $hasBat -and $hasMode){exit 0}; exit 1" >nul 2>&1
exit /b !errorlevel!

:get_port_pid
set "PORT_PID="
for /f "tokens=5" %%P in ('%SystemRoot%\System32\netstat.exe -ano -p tcp ^| %SystemRoot%\System32\findstr.exe /R /C:":%~1 .*LISTENING"') do if not defined PORT_PID set "PORT_PID=%%P"
exit /b 0

:wait_for_core
set /a WAIT_COUNT=0
:wait_for_core_loop
call :get_port_pid 5173
set "WAIT_VITE_PID=!PORT_PID!"
call :get_port_pid 3737
set "WAIT_API_PID=!PORT_PID!"
if defined WAIT_VITE_PID if defined WAIT_API_PID exit /b 0

set "ELECTRON_DEV_CHECK_PID=!DEV_PID!"
call :validate_managed_pid
if errorlevel 1 exit /b 1

set /a WAIT_COUNT+=1
if !WAIT_COUNT! geq %~1 exit /b 1
call :sleep_one
goto wait_for_core_loop

:wait_for_electron
set /a ELECTRON_WAIT_COUNT=0
:wait_for_electron_loop
call :has_dev_electron
if not errorlevel 1 exit /b 0
set /a ELECTRON_WAIT_COUNT+=1
if !ELECTRON_WAIT_COUNT! geq %~1 exit /b 1
call :sleep_one
goto wait_for_electron_loop

:has_dev_electron
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:ELECTRON_DEV_ROOT.TrimEnd([char]92); $found=$false; foreach($process in Get-CimInstance Win32_Process){if($process.Name -ieq 'QuakeCode.exe'){ $command=[string]$process.CommandLine; if($command.IndexOf($root,[StringComparison]::OrdinalIgnoreCase)-ge 0 -and $command.IndexOf('--dev',[StringComparison]::OrdinalIgnoreCase)-ge 0){$found=$true; break}}}; if($found){exit 0}; exit 1" >nul 2>&1
exit /b !errorlevel!

:capture_port_owners
set "PORT_TMP=%PORT_FILE%.tmp"
type nul > "!PORT_TMP!"
for %%Q in (5173 3737 9222 9223 9224 51999) do (
  call :get_port_pid %%Q
  if defined PORT_PID (
    call :get_process_ticks !PORT_PID!
    if defined PROCESS_TICKS >> "!PORT_TMP!" echo %%Q^|!PORT_PID!^|!PROCESS_TICKS!
  )
)
move /y "!PORT_TMP!" "%PORT_FILE%" >nul
exit /b 0

:get_process_ticks
set "PROCESS_TICKS="
set "ELECTRON_DEV_CHECK_PID=%~1"
for /f "delims=" %%T in ('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "[int]$pidValue=0; if(-not [int]::TryParse($env:ELECTRON_DEV_CHECK_PID,[ref]$pidValue)){exit 1}; $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue) -ErrorAction SilentlyContinue; if($process){$process.CreationDate.ToUniversalTime().Ticks}"') do if not defined PROCESS_TICKS set "PROCESS_TICKS=%%T"
exit /b 0

:get_owned_kill_pid
set "OWNED_KILL_PID="
for /f "delims=" %%K in ('powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "[int]$pidValue=0; [int]$portValue=0; if(-not [int]::TryParse($env:ELECTRON_DEV_CHECK_PID,[ref]$pidValue)){exit 1}; if(-not [int]::TryParse($env:ELECTRON_DEV_CHECK_PORT,[ref]$portValue)){exit 1}; $all=Get-CimInstance Win32_Process; $byId=@{}; foreach($item in $all){$byId[[int]$item.ProcessId]=$item}; if(-not $byId.ContainsKey($pidValue)){exit 1}; $process=$byId[$pidValue]; $chain=New-Object System.Collections.ArrayList; $seen=New-Object 'System.Collections.Generic.HashSet[int]'; $current=$process; for($depth=0; $depth -lt 20 -and $current; $depth++){if(-not $seen.Add([int]$current.ProcessId)){break}; [void]$chain.Add($current); $parentId=[int]$current.ParentProcessId; if($parentId -le 0 -or -not $byId.ContainsKey($parentId)){break}; $current=$byId[$parentId]}; $chainText=''; foreach($node in $chain){$chainText += ([string]$node.CommandLine) + [Environment]::NewLine}; $root=$env:ELECTRON_DEV_ROOT.TrimEnd([char]92); $command=[string]$process.CommandLine; $projectPathSeen=$chainText.IndexOf($root,[StringComparison]::OrdinalIgnoreCase)-ge 0; $desktopSignature=($chainText -match 'QUAKE_BROWSER_BRIDGE_PORT=9223') -and ($chainText -match 'QUAKE_CDP_PORT=9222') -and ($chainText -match 'QUAKE_COMPUTER_USE_BRIDGE_PORT=9224') -and ($chainText -match 'vite --config vite\.config\.ts') -and ($chainText -match '--strictPort') -and ($chainText -match 'run-electron-dev\.mjs'); $recorded=$false; if(Test-Path -LiteralPath $env:ELECTRON_DEV_PORT_FILE){$ticks=$process.CreationDate.ToUniversalTime().Ticks; foreach($line in [IO.File]::ReadAllLines($env:ELECTRON_DEV_PORT_FILE)){ $parts=$line.Split([char]124); if($parts.Length -ge 3 -and $parts[0] -eq [string]$portValue -and $parts[1] -eq [string]$pidValue -and $parts[2] -eq [string]$ticks){$recorded=$true; break}}}; $portSignature=$false; if($portValue -eq 5173){$portSignature=($command -match '(?i)vite') -and ($command -match '--config\s+vite\.config\.ts') -and ($command -match '--host\s+127\.0\.0\.1') -and ($command -match '--port\s+5173') -and ($command -match '--strictPort')} elseif($portValue -eq 3737){$portSignature=($command -match '(?i)tsx') -and ($command -match 'src[\\/]server[\\/]index\.ts')} elseif($portValue -ge 9222 -and $portValue -le 9224){$portSignature=($process.Name -ieq 'QuakeCode.exe') -and ($command.IndexOf($root,[StringComparison]::OrdinalIgnoreCase)-ge 0) -and ($command.IndexOf('--dev',[StringComparison]::OrdinalIgnoreCase)-ge 0)} elseif($portValue -eq 51999){$portSignature=($projectPathSeen -or $desktopSignature -or $recorded)}; $trusted=$projectPathSeen -or $desktopSignature -or $recorded; if(-not ($portSignature -and $trusted)){exit 1}; $killPid=[int]$process.ProcessId; foreach($node in $chain){$nodeCommand=[string]$node.CommandLine; $managedBat=($node.Name -ieq 'cmd.exe') -and ($nodeCommand.IndexOf($env:ELECTRON_DEV_BAT,[StringComparison]::OrdinalIgnoreCase)-ge 0) -and ($nodeCommand.IndexOf('__run',[StringComparison]::OrdinalIgnoreCase)-ge 0); $legacyRoot=($node.Name -ieq 'cmd.exe') -and ($nodeCommand -match '(?i)npm(?:\.cmd)?\s+run\s+desktop:dev'); if($managedBat -or $legacyRoot){$killPid=[int]$node.ProcessId}}; $killPid"') do if not defined OWNED_KILL_PID set "OWNED_KILL_PID=%%K"
exit /b 0

:wait_for_ports_free
set /a FREE_WAIT_COUNT=0
:wait_for_ports_free_loop
set "BUSY_PORTS="
for %%Q in (5173 3737 9222 9223 9224 51999) do (
  call :get_port_pid %%Q
  if defined PORT_PID set "BUSY_PORTS=!BUSY_PORTS! %%Q(PID !PORT_PID!)"
)
if not defined BUSY_PORTS (
  del /q "%PORT_FILE%" >nul 2>&1
  exit /b 0
)
set /a FREE_WAIT_COUNT+=1
if !FREE_WAIT_COUNT! geq %~1 (
  echo Portlar bosalmadi:!BUSY_PORTS!
  exit /b 1
)
call :sleep_one
goto wait_for_ports_free_loop

:sleep_one
"%SystemRoot%\System32\ping.exe" 127.0.0.1 -n 2 >nul 2>&1
exit /b 0

:run_dev
cd /d "%ROOT%" || exit /b 1
title Quake Code Electron Dev - 5173
echo Quake Code Electron dev baslatiliyor...
echo Project: %ROOT%
echo Vite:    http://127.0.0.1:5173
echo.
call npm run desktop:dev
set "DEV_EXIT=!errorlevel!"
echo.
echo Electron dev sureci sona erdi. Exit code: !DEV_EXIT!
exit /b !DEV_EXIT!