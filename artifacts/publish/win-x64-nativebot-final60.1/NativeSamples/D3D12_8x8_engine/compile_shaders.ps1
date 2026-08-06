<#
Minimal script to compile DXR HLSL shaders into DXIL using dxc.
Requires DirectX Shader Compiler (dxc.exe) on PATH.

Place this script in the Shaders folder and run from PowerShell:
  ./compile_shaders.ps1

#>
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

$dxc = "dxc.exe"
if (-not (Get-Command $dxc -ErrorAction SilentlyContinue)) {
	Write-Host "dxc.exe not found. Writing placeholder .dxil files so the sample can run without DXC." -ForegroundColor Yellow
	# Create minimal placeholder files to avoid downstream missing-file errors. These are not valid DXIL but
	# allow the sample's pipeline creation to detect missing/invalid shaders and gracefully fallback.
	$placeholders = @("raygen.dxil","miss.dxil","closesthit.dxil")
	foreach ($p in $placeholders) {
		$outPath = Join-Path $scriptDir $p
		if (-not (Test-Path $outPath)) {
			Write-Host "Creating placeholder: $outPath"
			"DXIL_PLACEHOLDER" | Out-File -FilePath $outPath -Encoding ASCII
		}
	}
	Pop-Location
	return
}

$shaders = @(
	@{ src = "raygen.hlsl"; entry = "RayGen"; out = "raygen.dxil" },
	@{ src = "miss.hlsl"; entry = "Miss"; out = "miss.dxil" },
	@{ src = "closesthit.hlsl"; entry = "ClosestHit"; out = "closesthit.dxil" }
)

foreach ($s in $shaders) {
	$src = $s.src
	$entry = $s.entry
	$out = $s.out
	Write-Host "Compiling $src -> $out (entry: $entry)"
	# If the HLSL source is missing, write a placeholder .dxil so runtime can detect and fallback.
	if (-not (Test-Path $src)) {
		Write-Host "$src not found; creating placeholder $out" -ForegroundColor Yellow
		"DXIL_PLACEHOLDER" | Out-File -FilePath $out -Encoding ASCII
		continue
	}
	# Target lib_6_3 for DXR libraries. Adjust flags for your dxc version.
	& $dxc -T lib_6_3 -E $entry -Fo $out $src
	if ($LASTEXITCODE -ne 0) {
		Write-Host "dxc failed compiling $src" -ForegroundColor Red
		Pop-Location
		exit 1
	}
}

Write-Host "Shaders compiled." -ForegroundColor Green
Pop-Location
