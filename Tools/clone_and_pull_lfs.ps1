param(
    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "$env:USERPROFILE\\Downloads\\Conduct-Dyadra-Modal",

    [Parameter(Mandatory = $false)]
    [string]$RepoUrl = "https://github.com/FTXArduous/Conduct-Dyadra-Modal.git",

    [Parameter(Mandatory = $false)]
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

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

$exePath = Join-Path $InstallPath "artifacts\\publish\\win-x64-nativebot-final59\\Conduct Dyadra Modal.exe"
Write-Host ""
Write-Host "Repo ready at: $InstallPath"
Write-Host "EXE path: $exePath"
Write-Host "EXE exists: $(Test-Path $exePath)"