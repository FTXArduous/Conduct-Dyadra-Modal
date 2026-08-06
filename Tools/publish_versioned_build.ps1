param(
    [Parameter(Mandatory = $false)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$PublishRoot = ".\\artifacts\\publish",

    [Parameter(Mandatory = $false)]
    [string]$Prefix = "win-x64-nativebot-final",

    [Parameter(Mandatory = $false)]
    [string]$BaselineHierarchy = ".\\artifacts\\publish\\win-x64-updated",

    [Parameter(Mandatory = $false)]
    [string]$EngineBuildDir = ".\\NativeSamples\\D3D12_8x8_engine\\build\\Release",

    [Parameter(Mandatory = $false)]
    [string]$FallbackEngineSource = ".\\artifacts\\publish\\win-x64-nativebot-final59\\NativeSamples\\D3D12_8x8_engine\\build\\Release"
)

$ErrorActionPreference = "Stop"

function Get-NextVersion {
    param(
        [string]$Root,
        [string]$FolderPrefix
    )

    if (-not (Test-Path $Root)) {
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
    }

    $dirs = Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -like "$FolderPrefix*"
    }

    $majors = @()
    foreach ($dir in $dirs) {
        $suffix = $dir.Name.Substring($FolderPrefix.Length)
        if ($suffix -match "^(\d+)(\.\d+)?$") {
            $majors += [int]$matches[1]
        }
    }

    if ($majors.Count -eq 0) {
        return "60.1"
    }

    $maxMajor = ($majors | Measure-Object -Maximum).Maximum
    return "{0}.1" -f ($maxMajor + 1)
}

function Get-FileVersionString {
    param([string]$SemVer)

    $parts = $SemVer.Split('.')
    $major = [int]$parts[0]
    $minor = if ($parts.Count -ge 2) { [int]$parts[1] } else { 0 }
    return "{0}.{1}.0.0" -f $major, $minor
}

Set-Location (Resolve-Path ".")

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Get-NextVersion -Root $PublishRoot -FolderPrefix $Prefix
}

$versionTag = "final$Version"
$outputDir = Join-Path $PublishRoot ($Prefix + $Version)
$fileVersion = Get-FileVersionString -SemVer $Version

Write-Host "Publishing version: $Version"
Write-Host "Output folder: $outputDir"

$expectedEngineExe = Join-Path $EngineBuildDir "D3D12_8x8_engine.exe"
$expectedLauncherExe = Join-Path $EngineBuildDir "D3D12_8x8_launcher.exe"
if ((-not (Test-Path $expectedEngineExe)) -or (-not (Test-Path $expectedLauncherExe))) {
    if (Test-Path $FallbackEngineSource) {
        Write-Host "Primary engine build dir missing binaries, copying fallback payload from: $FallbackEngineSource"
        New-Item -ItemType Directory -Path $EngineBuildDir -Force | Out-Null
        Copy-Item -Path (Join-Path $FallbackEngineSource "D3D12_8x8_engine.exe") -Destination $expectedEngineExe -Force
        Copy-Item -Path (Join-Path $FallbackEngineSource "D3D12_8x8_launcher.exe") -Destination $expectedLauncherExe -Force
    }
}

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Preserve a rich explorer hierarchy by copying from a known full baseline when available.
if (Test-Path $BaselineHierarchy) {
    Write-Host "Copying baseline hierarchy from: $BaselineHierarchy"
    robocopy $BaselineHierarchy $outputDir /E /R:1 /W:1 /NFL /NDL /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to copy baseline hierarchy (robocopy code $LASTEXITCODE)."
    }
}

$publishCmd = @(
    "publish",
    ".\\2412Launch\\2412Launch.csproj",
    "-c", "Release",
    "-r", "win-x64",
    "/p:SelfContained=false",
    "/p:PublishSingleFile=false",
    "/p:Version=$Version",
    "/p:FileVersion=$fileVersion",
    "/p:AssemblyVersion=$fileVersion",
    "/p:InformationalVersion=$versionTag",
    "-o", $outputDir
)

Write-Host "Running dotnet $($publishCmd -join ' ')"
dotnet @publishCmd
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed."
}

$engineExe = $expectedEngineExe
$launcherExe = $expectedLauncherExe
if (-not (Test-Path $engineExe)) {
    throw "Engine executable not found: $engineExe"
}
if (-not (Test-Path $launcherExe)) {
    throw "Engine launcher executable not found: $launcherExe"
}

$engineDest = Join-Path $outputDir "NativeSamples\\D3D12_8x8_engine\\build\\Release"
New-Item -ItemType Directory -Path $engineDest -Force | Out-Null
Copy-Item -Path $engineExe -Destination (Join-Path $engineDest "D3D12_8x8_engine.exe") -Force
Copy-Item -Path $launcherExe -Destination (Join-Path $engineDest "D3D12_8x8_launcher.exe") -Force

Write-Host "Build ready: $outputDir"
Write-Host "EXE: $(Join-Path $outputDir 'Conduct Dyadra Modal.exe')"
