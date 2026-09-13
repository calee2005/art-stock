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

# B-004: esp_cam_sensor 1.5.2 private SPI slave does not compile on IDF 6.0.3.
# Official fix is >=2.0.1; managed_components is gitignored so re-apply after download.
function Apply-EspCamSensorIdf6Patch {
    $camRoot = Join-Path $projectDir "managed_components\espressif__esp_cam_sensor"
    $header = Join-Path $camRoot "src\driver_spi\esp_cam_spi_slave.h"
    $cmake = Join-Path $camRoot "CMakeLists.txt"
    if (-not (Test-Path -LiteralPath $header)) {
        return
    }

    $headerText = Get-Content -LiteralPath $header -Raw
    if ($headerText -notmatch 'only for ESP-IDF versions < v6\.0\.0') {
        $headerText = $headerText.Replace(
            "#include `"driver/spi_slave.h`"`r`n",
            "#include `"driver/spi_slave.h`"`r`n#include `"esp_idf_version.h`"`r`n"
        )
        if ($headerText -notmatch 'esp_idf_version\.h') {
            $headerText = $headerText.Replace(
                "#include `"driver/spi_slave.h`"`n",
                "#include `"driver/spi_slave.h`"`n#include `"esp_idf_version.h`"`n"
            )
        }
        $oldGuard = @"
/**
 * @brief Enable Camera private SPI slave driver
 */
#if CONFIG_SPIRAM
#define ESP_CAM_SPI_DRIVER 1
#endif
"@
        $newGuard = @"
/**
 * @brief Enable Camera private SPI slave driver, only for ESP-IDF versions < v6.0.0
 */
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(6, 0, 0)
#if CONFIG_SPIRAM
#define ESP_CAM_SPI_DRIVER 1
#endif
#endif
"@
        if ($headerText.Contains($oldGuard)) {
            $headerText = $headerText.Replace($oldGuard, $newGuard)
            Set-Content -LiteralPath $header -Value $headerText -NoNewline
            Write-Host "[INFO] Patched esp_cam_sensor header for IDF 6 (B-004)"
        }
    }

    if (Test-Path -LiteralPath $cmake) {
        $cmakeText = Get-Content -LiteralPath $cmake -Raw
        $oldCmake = "if(CONFIG_SPIRAM)`r`n    list(APPEND srcs `"src/driver_spi/spi_slave.c`")`r`nendif()"
        $oldCmakeUnix = "if(CONFIG_SPIRAM)`n    list(APPEND srcs `"src/driver_spi/spi_slave.c`")`nendif()"
        $newCmake = "# IDF 6.0+ ships a public SPI slave driver; 1.5.2's private copy does not compile.`nif(CONFIG_SPIRAM AND IDF_VERSION_MAJOR LESS 6)`n    list(APPEND srcs `"src/driver_spi/spi_slave.c`")`nendif()"
        if ($cmakeText.Contains($oldCmake)) {
            $cmakeText = $cmakeText.Replace($oldCmake, $newCmake)
            Set-Content -LiteralPath $cmake -Value $cmakeText -NoNewline
            Write-Host "[INFO] Patched esp_cam_sensor CMakeLists for IDF 6 (B-004)"
        }
        elseif ($cmakeText.Contains($oldCmakeUnix)) {
            $cmakeText = $cmakeText.Replace($oldCmakeUnix, $newCmake)
            Set-Content -LiteralPath $cmake -Value $cmakeText -NoNewline
            Write-Host "[INFO] Patched esp_cam_sensor CMakeLists for IDF 6 (B-004)"
        }
    }
}

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

    Apply-EspCamSensorIdf6Patch
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
