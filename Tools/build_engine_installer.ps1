param(
    [string]$PublishDir = ".\\artifacts\\publish\\win-x64-nativebot-final59",
    [string]$EngineBuildDir = ".\\NativeSamples\\D3D12_8x8_engine\\build\\Release",
    [string]$InstallerScript = ".\\installer\\ConductDyadraModalEngine.iss",
    [string]$OutputDir = ".\\artifacts\\installer-output",
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"

function Resolve-IsccPath {
    $candidates = @(
        "${env:ProgramFiles(x86)}\\Inno Setup 6\\ISCC.exe",
        "${env:ProgramFiles}\\Inno Setup 6\\ISCC.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    throw "Inno Setup compiler (ISCC.exe) not found. Install Inno Setup 6 first."
}

Set-Location (Resolve-Path ".")

$publishDirAbs = Resolve-Path $PublishDir -ErrorAction SilentlyContinue
if (-not $publishDirAbs) {
    if ($SkipPublish) {
        throw "Publish directory not found: $PublishDir"
    }
}

if (-not $SkipPublish) {
    Write-Host "Publishing Conduct Dyadra Modal..."
    dotnet publish ".\\2412Launch\\2412Launch.csproj" -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true -o $PublishDir
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }
}

$publishDirAbs = (Resolve-Path $PublishDir).Path
$engineBuildAbs = (Resolve-Path $EngineBuildDir).Path
$installerScriptAbs = (Resolve-Path $InstallerScript).Path

$mainExe = Join-Path $publishDirAbs "Conduct Dyadra Modal.exe"
if (-not (Test-Path $mainExe)) {
    throw "Main executable not found: $mainExe"
}

$engineExe = Join-Path $engineBuildAbs "D3D12_8x8_engine.exe"
$launcherExe = Join-Path $engineBuildAbs "D3D12_8x8_launcher.exe"
if (-not (Test-Path $engineExe)) {
    throw "Engine executable not found: $engineExe"
}
if (-not (Test-Path $launcherExe)) {
    throw "Engine launcher executable not found: $launcherExe"
}

$stagingRoot = Join-Path (Split-Path $installerScriptAbs -Parent) "staging"
$stagingApp = Join-Path $stagingRoot "app"

if (Test-Path $stagingRoot) {
    Remove-Item -Recurse -Force $stagingRoot
}
New-Item -ItemType Directory -Force -Path $stagingApp | Out-Null

Write-Host "Staging publish files..."
Copy-Item -Path (Join-Path $publishDirAbs "*") -Destination $stagingApp -Recurse -Force

$engineDest = Join-Path $stagingApp "NativeSamples\\D3D12_8x8_engine\\build\\Release"
New-Item -ItemType Directory -Force -Path $engineDest | Out-Null
Copy-Item -Path $engineExe -Destination (Join-Path $engineDest "D3D12_8x8_engine.exe") -Force
Copy-Item -Path $launcherExe -Destination (Join-Path $engineDest "D3D12_8x8_launcher.exe") -Force

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$iscc = Resolve-IsccPath
Write-Host "Building installer with: $iscc"

& $iscc "/DSourceDir=$stagingApp" "/DOutputDir=$(Resolve-Path $OutputDir)" $installerScriptAbs
if ($LASTEXITCODE -ne 0) { throw "ISCC build failed." }

Write-Host "Installer created in: $(Resolve-Path $OutputDir)"
