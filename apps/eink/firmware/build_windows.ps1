param(
    [string]$IdfPath = $env:IDF_PATH,
    [switch]$FullClean,
    [switch]$Flash,
    [string]$Port
)

$ErrorActionPreference = "Stop"

# Machine convention: IDF source is C:\esp\v6.0.3\esp-idf (v6.0.3).
# This PC was installed with Espressif Installation Manager (EIM):
#   IDF_PATH        = C:\esp\v6.0.3\esp-idf
#   IDF_TOOLS_PATH  = C:\Espressif\tools
# Bare `. C:\esp\v6.0.3\esp-idf\export.ps1` looks for the classic
# %USERPROFILE%\.espressif python_env (v5.x) and fails. Prefer the EIM
# profile, then fall back to export.ps1 only if that layout exists.
$DefaultIdfPath = "C:\esp\v6.0.3\esp-idf"
$EimProfile = "C:\Espressif\tools\Microsoft.v6.0.3.PowerShell_profile.ps1"
$EimPython = "C:\Espressif\tools\python\v6.0.3\venv\Scripts\python.exe"

function Test-IdfTree {
    param([string]$Path)
    if (-not $Path) {
        return $false
    }
    return (Test-Path -LiteralPath (Join-Path $Path "tools\idf.py"))
}

if (-not (Test-IdfTree $IdfPath)) {
    $IdfPath = $DefaultIdfPath
}

if (-not (Test-IdfTree $IdfPath)) {
    throw "未找到 ESP-IDF: $IdfPath（可设置 IDF_PATH，默认 $DefaultIdfPath）"
}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$idfPy = Join-Path $IdfPath "tools\idf.py"

# Clear MSYSTEM so idf.py doesn't mistake this for a MinGW/MSys environment
# (Git Bash sets MSYSTEM=MINGW64 which gets inherited by child processes)
Remove-Item Env:MSYSTEM -ErrorAction SilentlyContinue

$idfPython = $null
if ((Test-Path -LiteralPath $EimProfile) -and (Test-Path -LiteralPath $EimPython)) {
    Write-Host "[INFO] Activating EIM v6.0.3 profile (IDF_PATH=$IdfPath)"
    . $EimProfile
    $idfPython = $EimPython
}
else {
    $exportPs1 = Join-Path $IdfPath "export.ps1"
    if (-not (Test-Path -LiteralPath $exportPs1)) {
        throw "未找到 EIM profile 或 $exportPs1"
    }
    Write-Host "[INFO] Activating $exportPs1"
    . $exportPs1
    $idfPython = (Get-Command python -ErrorAction Stop).Source
}

if (-not $env:IDF_PATH) {
    $env:IDF_PATH = $IdfPath
}

Write-Host "[INFO] IDF_PATH=$env:IDF_PATH"
Write-Host "[INFO] IDF_TOOLS_PATH=$env:IDF_TOOLS_PATH"

function Invoke-Idf {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$IdfArgs)
    Write-Host "[INFO] Running idf.py $($IdfArgs -join ' ')"
    & $idfPython $idfPy @IdfArgs
    if ($LASTEXITCODE -ne 0) {
        throw "idf.py $($IdfArgs -join ' ') 失败"
    }
}

Push-Location $projectDir
try {
    if ($FullClean) {
        Invoke-Idf fullclean
    }

    Invoke-Idf build

    if ($Flash) {
        $flashArgs = @()
        if ($Port) {
            $flashArgs += @("-p", $Port)
        }
        $flashArgs += "flash"
        Invoke-Idf @flashArgs
    }
}
finally {
    Pop-Location
}

Write-Host "[INFO] Done. Build output: $(Join-Path $projectDir 'build')"
