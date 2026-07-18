[CmdletBinding()]
param(
    [string]$ApiKey,
    [string]$CodexHome = (Join-Path $HOME ".codex"),
    [ValidateSet("User", "Process", "None")]
    [string]$EnvScope = "User",
    [string]$Model = "gpt-5.4",
    [string]$ModelProvider = "azure",
    [string]$ProviderName = "Azure OpenAI (gpt-5.4 eastus)",
    [string]$BaseUrl = "https://mrquakex3-2118-resource.cognitiveservices.azure.com/openai",
    [string]$EnvKeyName = "AZURE_GPT54_API_KEY",
    [string]$ApiVersion = "2025-04-01-preview",
    [switch]$NoBackup
)

$ErrorActionPreference = "Stop"

function ConvertTo-PlainText {
    param([Security.SecureString]$SecureString)

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        if ($ptr -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
    }
}

function Remove-Section {
    param(
        [string]$Text,
        [string]$SectionName
    )

    $pattern = "(?ms)^\[$([regex]::Escape($SectionName))\][ \t]*\r?\n.*?(?=^\[|\z)"
    return [regex]::Replace($Text, $pattern, "")
}

function Remove-RootKey {
    param(
        [string]$Text,
        [string]$Key
    )

    $pattern = "(?m)^$([regex]::Escape($Key))[ \t]*=.*(?:\r?\n)?"
    return [regex]::Replace($Text, $pattern, "")
}

function Get-ResolvedApiKey {
    param(
        [string]$ExplicitApiKey,
        [string]$VariableName,
        [string]$TargetScope
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitApiKey)) {
        return $ExplicitApiKey
    }

    $existingProcess = [Environment]::GetEnvironmentVariable($VariableName, "Process")
    if (-not [string]::IsNullOrWhiteSpace($existingProcess)) {
        return $existingProcess
    }

    $existingUser = [Environment]::GetEnvironmentVariable($VariableName, "User")
    if (-not [string]::IsNullOrWhiteSpace($existingUser)) {
        return $existingUser
    }

    if ($TargetScope -eq "None") {
        return $null
    }

    Write-Host ""
    $secureApiKey = Read-Host -Prompt "Azure API key ($VariableName)" -AsSecureString
    return ConvertTo-PlainText -SecureString $secureApiKey
}

$resolvedApiKey = Get-ResolvedApiKey -ExplicitApiKey $ApiKey -VariableName $EnvKeyName -TargetScope $EnvScope

if ($EnvScope -ne "None") {
    if ([string]::IsNullOrWhiteSpace($resolvedApiKey)) {
        throw "Azure API key is empty. Provide -ApiKey or enter it when prompted."
    }

    [Environment]::SetEnvironmentVariable($EnvKeyName, $resolvedApiKey, $EnvScope)
    if ($EnvScope -eq "User") {
        [Environment]::SetEnvironmentVariable($EnvKeyName, $resolvedApiKey, "Process")
    }
}

if (-not (Test-Path -LiteralPath $CodexHome)) {
    New-Item -ItemType Directory -Path $CodexHome | Out-Null
}

$configPath = Join-Path $CodexHome "config.toml"
$configText = ""

if (Test-Path -LiteralPath $configPath) {
    if (-not $NoBackup) {
        $backupPath = "$configPath.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
    }
    $configText = Get-Content -LiteralPath $configPath -Raw
}

$configText = Remove-RootKey -Text $configText -Key "model"
$configText = Remove-RootKey -Text $configText -Key "model_provider"
$configText = Remove-Section -Text $configText -SectionName "model_providers.$ModelProvider"

$rootBlock = @"
model = "$Model"
model_provider = "$ModelProvider"
"@

$providerBlock = @"
[model_providers.$ModelProvider]
name = "$ProviderName"
base_url = "$BaseUrl"
env_key = "$EnvKeyName"
query_params = { api-version = "$ApiVersion" }
wire_api = "responses"
"@

$configText = $configText.Trim()
if ([string]::IsNullOrWhiteSpace($configText)) {
    $configText = $rootBlock.Trim() + "`r`n`r`n" + $providerBlock.Trim() + "`r`n"
} else {
    $configText = $rootBlock.Trim() + "`r`n`r`n" + $configText + "`r`n`r`n" + $providerBlock.Trim() + "`r`n"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $configText, $utf8NoBom)

$messages = @()
$messages += "Config updated: $configPath"

if ($EnvScope -eq "None") {
    $messages += "User env skipped: $EnvKeyName"
} else {
    $stored = [Environment]::GetEnvironmentVariable($EnvKeyName, $EnvScope)
    if ([string]::IsNullOrWhiteSpace($stored)) {
        throw "Environment variable verification failed for $EnvKeyName."
    }
    $messages += "Environment variable updated: $EnvKeyName ($EnvScope scope)"
}

$messages += "Model set: $Model via $ModelProvider"
$messages += "Restart Codex Desktop after running this script."

Write-Host ""
foreach ($message in $messages) {
    Write-Host "- $message"
}
