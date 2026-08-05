param(
	[string]$BuildDir = "..\build\Debug",
	[string]$OutDir = "..\build\installer"
)

Set-Location $PSScriptRoot
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
# Resolve OutDir to an absolute path
$OutDir = (Resolve-Path -Path $OutDir).ProviderPath

$defaultDebugBuildDir = "..\build\Debug"
if (-not (Test-Path $BuildDir) -and (Test-Path $defaultDebugBuildDir)) {
	$BuildDir = $defaultDebugBuildDir
}

$exe = Join-Path -Path $BuildDir -ChildPath "D3D12_8x8_engine.exe"
if (-not (Test-Path $exe)) { Write-Error "Build EXE not found at $exe"; exit 1 }

$zip = Join-Path -Path $OutDir -ChildPath "D3D12_8x8_engine_Portable.zip"
if (Test-Path $zip) { Remove-Item $zip }

Write-Host "Packaging $exe -> $zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[string]$zipSourceDir = (Split-Path $exe -Parent)
# Resolve zip source dir to absolute path
$zipSourceDir = (Resolve-Path -Path $zipSourceDir).ProviderPath

  # Attempt to include Release CRTs if present by copying them into the zip source directory first (non-destructive)
 $releaseCrtDir = "..\build\Release"
 $crtChecksumFile = Join-Path $zipSourceDir "crt_checksums.txt"
 if (Test-Path $crtChecksumFile) { Remove-Item $crtChecksumFile -Force }
 if (Test-Path $releaseCrtDir) {
	 $releaseCrtList = @('vcruntime140.dll','ucrtbase.dll')
	 foreach ($dll in $releaseCrtList) {
		 $src = Join-Path $releaseCrtDir $dll
		 if (Test-Path $src) {
			 Copy-Item -Path $src -Destination $zipSourceDir -Force
			 try {
				 $h = Get-FileHash -Algorithm SHA256 -Path (Join-Path $zipSourceDir $dll)
				 $line = "{0}  {1}" -f $h.Hash, $dll
				 Add-Content -Path $crtChecksumFile -Value $line
			 } catch {
				 Write-Host "Warning: failed to hash $dll : $_"
			 }
		 }
	 }
 }

[IO.Compression.ZipFile]::CreateFromDirectory($zipSourceDir, $zip)
if (Test-Path $zip) { Write-Host "Created portable zip: $zip" } else { Write-Error "Failed to create portable zip: $zip" }

 # If we created crt_checksums.txt in the build output dir, copy it to the installer folder so Inno Setup can include it
 $localChecksum = Join-Path $zipSourceDir "crt_checksums.txt"
 if (Test-Path $localChecksum) {
	 Copy-Item -Path $localChecksum -Destination (Join-Path $PSScriptRoot "crt_checksums.txt") -Force
 }

# If Inno Setup is installed, run it to build the installer
$inno = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
$iss = Join-Path $PSScriptRoot "setup.iss"
if ((Test-Path $inno) -and (Test-Path $iss)) {
	Write-Host "Found Inno Setup -> building installer"
	& $inno $iss
	Write-Host "Installer build attempted. Check $OutDir for outputs."
} else {
	# Try IExpress fallback if available
	$iexpress = "$env:windir\System32\iexpress.exe"
	$sed = Join-Path $PSScriptRoot "iexpress.sed"
	if ((Test-Path $iexpress) -and (Test-Path $sed)) {
		Write-Host "Inno Setup not found. Found IExpress -> building self-extracting installer"
		# Prepare a temp build folder including EXE and debug CRTs so ShouldRunDXSetup logic can inspect them
		$tmpBuildDir = Join-Path $OutDir "iexpress_tmp_build"
		if (Test-Path $tmpBuildDir) { Remove-Item -Recurse -Force $tmpBuildDir }
		New-Item -ItemType Directory -Path $tmpBuildDir | Out-Null
		Copy-Item -Path (Join-Path $BuildDir "*") -Destination $tmpBuildDir -Recurse -Force
		$debugCrtPatterns = @("vcruntime*d.dll", "msvcp*d.dll", "concrt*d.dll", "ucrtbased.dll")
		foreach ($pattern in $debugCrtPatterns) {
			Get-ChildItem -Path (Join-Path $BuildDir $pattern) -ErrorAction SilentlyContinue | ForEach-Object {
				Copy-Item -Path $_.FullName -Destination $tmpBuildDir -Force
			}
		}
			# copy checksum file if present
			$localChecksum = Join-Path $zipSourceDir "crt_checksums.txt"
			if (Test-Path $localChecksum) { Copy-Item -Path $localChecksum -Destination $tmpBuildDir -Force }
		# Call the dedicated IExpress build script which prepares Files folder and runs iexpress
		& (Join-Path $PSScriptRoot "build_iexpress.ps1") -BuildDir $tmpBuildDir -OutDir $OutDir
		if (Test-Path $tmpBuildDir) { Remove-Item -Recurse -Force $tmpBuildDir }
		$iexOut = Join-Path $OutDir "D3D12_8x8_engine_Installer.exe"
		if (Test-Path $iexOut) { Write-Host "Created IExpress installer: $iexOut" } else { Write-Host "IExpress did not produce expected output; run build_iexpress.ps1 or iexpress.exe manually with $sed" }
	} else {
		Write-Host "Inno Setup not found. IExpress not available. Open $iss in Inno Setup and build the installer manually."
	}
}

exit 0
