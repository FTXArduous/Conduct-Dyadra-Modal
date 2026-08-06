param(
    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "$env:USERPROFILE\\Downloads\\Conduct-Dyadra-Modal",

    [Parameter(Mandatory = $false)]
    [string]$RepoUrl = "https://github.com/FTXArduous/Conduct-Dyadra-Modal.git",

    [Parameter(Mandatory = $false)]
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Get-LatestBuildFolderName {
    param(
        [string]$RepoRoot,
        [string]$FolderPrefix = "win-x64-nativebot-final"
    )

    $publishRoot = Join-Path $RepoRoot "artifacts\\publish"
    if (-not (Test-Path $publishRoot)) {
        return $null
    }

    $dirs = Get-ChildItem -Path $publishRoot -Directory -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -like "$FolderPrefix*"
    }

    $ranked = foreach ($dir in $dirs) {
        $suffix = $dir.Name.Substring($FolderPrefix.Length)
        if ($suffix -match "^(\d+)(?:\.(\d+))?$") {
            [PSCustomObject]@{
                Name = $dir.Name
                Major = [int]$matches[1]
                Minor = if ($matches[2]) { [int]$matches[2] } else { 0 }
            }
        }
    }

    if (-not $ranked) {
        return $null
    }

    return ($ranked | Sort-Object Major, Minor | Select-Object -Last 1).Name
}

Write-Host "Target path: $InstallPath"
Write-Host "Repo URL: $RepoUrl"
Write-Host "Branch: $Branch"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is not installed or not on PATH. Install Git for Windows first."
}

git lfs install

if (Test-Path $InstallPath) {
    if (-not (Test-Path (Join-Path $InstallPath ".git"))) {
        throw "Install path exists but is not a git repo: $InstallPath"
    }

    Set-Location $InstallPath
    git fetch origin
    git checkout $Branch
    git pull origin $Branch
    git lfs pull
} else {
    $parent = Split-Path -Path $InstallPath -Parent
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    git clone --branch $Branch --single-branch $RepoUrl $InstallPath
    Set-Location $InstallPath
    git lfs pull
}

$latestFolder = Get-LatestBuildFolderName -RepoRoot $InstallPath
$exePath = if ($latestFolder) {
    Join-Path $InstallPath ("artifacts\\publish\\{0}\\Conduct Dyadra Modal.exe" -f $latestFolder)
} else {
    Join-Path $InstallPath "artifacts\\publish\\win-x64-nativebot-final59\\Conduct Dyadra Modal.exe"
}
Write-Host ""
Write-Host "Repo ready at: $InstallPath"
if ($latestFolder) {
    Write-Host "Latest build folder: $latestFolder"
}
Write-Host "EXE path: $exePath"
Write-Host "EXE exists: $(Test-Path $exePath)"