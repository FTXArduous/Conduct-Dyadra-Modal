param(
	[string]$BuildDir = "..\build\Debug",
	[string]$OutDir = "..\build\installer"
)

Set-Location $PSScriptRoot
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$exeSrc = Join-Path -Path $BuildDir -ChildPath "D3D12_8x8_engine.exe"
if (-not (Test-Path $exeSrc)) { Write-Error "Build EXE not found at $exeSrc"; exit 1 }

$filesDir = Join-Path $PSScriptRoot "Files"
if (Test-Path $filesDir) { Remove-Item -Recurse -Force $filesDir }
New-Item -ItemType Directory -Path $filesDir | Out-Null
Copy-Item $exeSrc -Destination (Join-Path $filesDir "D3D12_8x8_engine.exe") -Force

$sedPath = Join-Path $PSScriptRoot "iexpress.sed"
$iexOut = Join-Path $OutDir "D3D12_8x8_engine_Installer.exe"

$iexpress = "$env:windir\System32\iexpress.exe"
if (Test-Path $iexpress) {
	Write-Host "Building IExpress self-extracting installer..."
	& $iexpress /N /Q /M $sedPath
	if (Test-Path $iexOut) { Write-Host "Created installer: $iexOut" } else { Write-Host "IExpress did not produce expected output; run iexpress.exe manually with $sedPath" }
} else {
	Write-Host "IExpress not found on this system. You can manually create an SFX or use the Inno Setup script instead." 
}
