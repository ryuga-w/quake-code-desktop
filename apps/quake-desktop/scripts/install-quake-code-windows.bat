@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Quake Code - Tek Tik Kurulum
set "QUAKE_BOOTSTRAP_BAT=%~f0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$raw=[System.IO.File]::ReadAllText($env:QUAKE_BOOTSTRAP_BAT); $marker='# POWERSHELL_PAYLOAD'; $index=$raw.LastIndexOf($marker); if($index -lt 0){throw 'Kurulum betigi bozuk: PowerShell payload bulunamadi.'}; Invoke-Expression $raw.Substring($index)"
set "QUAKE_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%QUAKE_EXIT_CODE%"=="0" (
  echo Kurulum tamamlanamadi. Yukaridaki hata mesajini kontrol edin.
) else (
  echo Quake Code kurulumu ve GPT-5.6 SOL yapilandirmasi tamamlandi.
)
echo.
if not "%QUAKE_NO_PAUSE%"=="1" pause
exit /b %QUAKE_EXIT_CODE%

# POWERSHELL_PAYLOAD
$ErrorActionPreference = "Stop"

function Write-Step([int] $Number, [string] $Text) {
  Write-Host "[$Number/5] $Text" -ForegroundColor Cyan
}

function Read-SecretText([string] $Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

try {
  $sourceDirectory = Split-Path -Parent $env:QUAKE_BOOTSTRAP_BAT
  $installer = Get-ChildItem -LiteralPath $sourceDirectory -Filter "Quake-Code-Setup-*-x64.exe" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $installer) {
    throw "Installer bulunamadi. BAT ile Quake-Code-Setup-*-x64.exe ayni klasorde olmali."
  }

  $checksumPath = Join-Path $sourceDirectory "SHA256SUMS.txt"
  if (-not (Test-Path -LiteralPath $checksumPath)) {
    throw "SHA256SUMS.txt bulunamadi."
  }

  Write-Step 1 "Installer SHA-256 dogrulaniyor"
  $escapedInstallerName = [Regex]::Escape($installer.Name)
  $checksumLine = Get-Content -LiteralPath $checksumPath |
    Where-Object { $_ -match "(?i)^([0-9a-f]{64})\s+$escapedInstallerName$" } |
    Select-Object -First 1
  if (-not $checksumLine) {
    throw "Installer icin SHA-256 kaydi bulunamadi: $($installer.Name)"
  }
  $expectedHash = (($checksumLine -split "\s+")[0]).ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    throw "Installer SHA-256 uyusmuyor. Dosyayi calistirmayin."
  }
  Write-Host "      SHA-256 OK: $actualHash" -ForegroundColor Green

  Write-Step 2 "Calisan Quake Code Desktop kapatiliyor"
  if ($env:QUAKE_SKIP_INSTALL -ne "1") {
    Get-Process -Name "QuakeCode" -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  } else {
    Write-Host "      Test modu: calisan uygulamaya dokunulmadi" -ForegroundColor DarkGray
  }

  Write-Step 3 "Guncel Quake Code Desktop kuruluyor"
  if ($env:QUAKE_SKIP_INSTALL -ne "1") {
    $installerArguments = @("/S", "/currentuser")
    if (-not [string]::IsNullOrWhiteSpace($env:QUAKE_INSTALL_DIR)) {
      $installerArguments += "/D=$($env:QUAKE_INSTALL_DIR)"
    }
    $installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList $installerArguments -Wait -PassThru
    if ($installerProcess.ExitCode -ne 0) {
      throw "Installer hata koduyla kapandi: $($installerProcess.ExitCode)"
    }
  } else {
    Write-Host "      Test modu: installer calistirilmadi" -ForegroundColor DarkGray
  }

  Write-Step 4 "Desktop'a ait bagimsiz GPT-5.6 SOL motor ayari hazirlaniyor"
  $desktopConfigRoot = if ([string]::IsNullOrWhiteSpace($env:QUAKE_DESKTOP_CONFIG_ROOT)) {
    Join-Path $env:APPDATA "Quake Code"
  } else {
    $env:QUAKE_DESKTOP_CONFIG_ROOT
  }
  $agentDirectory = Join-Path $desktopConfigRoot "agent"
  $modelsPath = Join-Path $agentDirectory "models.json"
  New-Item -ItemType Directory -Path $agentDirectory -Force | Out-Null

  if (Test-Path -LiteralPath $modelsPath) {
    $backupPath = "$modelsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $modelsPath -Destination $backupPath -Force
    try {
      $modelConfig = Get-Content -LiteralPath $modelsPath -Raw | ConvertFrom-Json
    } catch {
      throw "Mevcut Desktop models.json gecersiz. Yedek: $backupPath"
    }
  } else {
    $modelConfig = [pscustomobject]@{ providers = [pscustomobject]@{} }
  }

  if (-not $modelConfig.PSObject.Properties["providers"]) {
    $modelConfig | Add-Member -MemberType NoteProperty -Name "providers" -Value ([pscustomobject]@{})
  }

  $providerName = "azure-mrquake-gpt56sol"
  $providerProperty = $modelConfig.providers.PSObject.Properties[$providerName]
  $existingApiKey = if ($providerProperty) { [string] $providerProperty.Value.apiKey } else { "" }
  $apiKey = $env:QUAKE_SOL_API_KEY
  if ([string]::IsNullOrWhiteSpace($apiKey)) { $apiKey = $existingApiKey }
  if ([string]::IsNullOrWhiteSpace($apiKey)) { $apiKey = $env:AZURE_OPENAI_API_KEY }
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    $apiKey = Read-SecretText "Azure GPT-5.6 SOL API anahtarini girin"
  }
  if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "Azure API anahtari bos birakilamaz."
  }

  $provider = [pscustomobject][ordered]@{
    baseUrl = "https://mrquake.openai.azure.com/openai/v1"
    api = "azure-openai-responses"
    apiKey = $apiKey
    models = @(
      [pscustomobject][ordered]@{
        id = "gpt-56-sol-deploy"
        name = "Azure GPT-5.6-Sol"
        reasoning = $true
        input = @("text", "image")
        contextWindow = 200000
        maxTokens = 16384
        cost = [pscustomobject][ordered]@{
          input = 0
          output = 0
          cacheRead = 0
          cacheWrite = 0
        }
      }
    )
  }
  $modelConfig.providers | Add-Member -MemberType NoteProperty -Name $providerName -Value $provider -Force

  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  $modelsJson = $modelConfig | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($modelsPath, "$modelsJson`n", $utf8WithoutBom)

  $runtimeManifest = [ordered]@{
    owner = "Quake Code Desktop"
    mode = "embedded"
    enginePackage = "@mrquake/quakecode-cli"
    engineVersion = "1.11.2"
    configDirectory = $agentDirectory
    configuredAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json
  [System.IO.File]::WriteAllText((Join-Path $agentDirectory "runtime-owner.json"), "$runtimeManifest`n", $utf8WithoutBom)
  $apiKey = $null

  Write-Step 5 "Kurulum dogrulaniyor ve Quake Code baslatiliyor"
  $quakeExecutable = $null
  if (-not [string]::IsNullOrWhiteSpace($env:QUAKE_INSTALL_DIR)) {
    $candidate = Join-Path $env:QUAKE_INSTALL_DIR "QuakeCode.exe"
    if (Test-Path -LiteralPath $candidate) { $quakeExecutable = Get-Item -LiteralPath $candidate }
  }
  if (-not $quakeExecutable) {
    $knownCandidates = @(
      (Join-Path $env:LOCALAPPDATA "Programs\Quake Code\QuakeCode.exe"),
      (Join-Path $env:LOCALAPPDATA "Programs\quake-desktop\QuakeCode.exe")
    )
    foreach ($candidate in $knownCandidates) {
      if (Test-Path -LiteralPath $candidate) {
        $quakeExecutable = Get-Item -LiteralPath $candidate
        break
      }
    }
  }
  if (-not $quakeExecutable) {
    $quakeExecutable = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs") -Filter "QuakeCode.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
  }
  if (-not $quakeExecutable) {
    throw "QuakeCode.exe kurulumdan sonra bulunamadi."
  }

  Write-Host "      Uygulama: $($quakeExecutable.FullName)" -ForegroundColor Green
  Write-Host "      Desktop ayari: $agentDirectory" -ForegroundColor Green
  Write-Host "      Gomulu motor: @mrquake/quakecode-cli 1.11.2" -ForegroundColor Green

  if ($env:QUAKE_SKIP_LAUNCH -ne "1") {
    $appProcess = Start-Process -FilePath $quakeExecutable.FullName -PassThru
    Start-Sleep -Seconds 3
    if ($appProcess.HasExited) {
      throw "Quake Code baslatildi ancak hemen kapandi (kod $($appProcess.ExitCode))."
    }
  }

  Write-Host "`nBASARILI: Eski/global CLI korunarak Desktop bagimsiz gomulu motorla kuruldu." -ForegroundColor Green
  exit 0
} catch {
  Write-Host "`nHATA: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
