; Inno Setup script for D3D12_8x8_engine
; To build the installer, install Inno Setup (https://jrsoftware.org/isinfo.php)

#define MyAppName "Conduct Dyadra Modal - D3D12_8x8_engine"
#define MyAppVersion "1.0.0"
#define MyExeName "D3D12_8x8_engine.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={pf}\Conduct Dyadra Modal\D3D12_8x8_engine
DefaultGroupName=Conduct Dyadra Modal
OutputDir=..\build\installer
OutputBaseFilename=D3D12_8x8_engine_Setup
Compression=lzma2/ultra
SolidCompression=yes

[Tasks]
Name: "private_directx"; Description: "Copy DirectX redist into application folder (no system installer, no registry changes)"; GroupDescription: "DirectX options:"; Flags: checked
Name: "force_directx"; Description: "Run DirectX installer to update system DirectX (may modify registry)"; Flags: unchecked
Name: "remove_private_on_uninstall"; Description: "Remove private DirectX folder on uninstall"; Flags: checked

[Files]
; Include the built exe and any supporting files from the build folder
Source: "{#MyExeName}"; DestDir: "{app}"; Flags: ignoreversion
; Optionally include Visual C++ Redistributables (place installers next to this script)
; Example names: vcredist_x86.exe, vcredist_x64.exe
Source: "vcredist_x86.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall; Check: not IsWin64
Source: "vcredist_x64.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall; Check: IsWin64
; DirectX redistributables (place DirectX installers or redist folder here)
Source: "dxwebsetup.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall skipifsourcedoesntexist
Source: "DirectXRedist\DXSETUP.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall skipifsourcedoesntexist
Source: "DirectXRedist\*"; DestDir: "{app}\DirectXRedist"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist; Tasks: private_directx; AfterInstall: PreparePrivateDirectX
; Include Release CRT DLLs from the build output and place them into the private folder when private_directx is selected
; Prefer shipping release CRTs (vcruntime140.dll, ucrtbase.dll). Do not ship debug CRTs in production.
Source: "..\build\Release\vcruntime140.dll"; DestDir: "{app}\directx_dev12.4"; Flags: ignoreversion skipifsourcedoesntexist; Tasks: private_directx
Source: "..\build\Release\ucrtbase.dll"; DestDir: "{app}\directx_dev12.4"; Flags: ignoreversion skipifsourcedoesntexist; Tasks: private_directx
; Include checksum file if present so installer can carry it into the private folder
Source: "crt_checksums.txt"; DestDir: "{app}\directx_dev12.4"; Flags: ignoreversion skipifsourcedoesntexist; Tasks: private_directx
; If you have DLLs or other runtime files add them here, for example:
; Source: "d3d12.dll"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Conduct Dyadra Modal - D3D12_8x8_engine"; Filename: "{app}\{#MyExeName}"
Name: "{commondesktop}\Conduct Dyadra Modal - D3D12_8x8_engine"; Filename: "{app}\{#MyExeName}"; Tasks: desktopicon

[Run]
; Install VC++ runtime for x86 on 32-bit OS
Filename: "{tmp}\vcredist_x86.exe"; Parameters: "/install /quiet /norestart"; Flags: runhidden waituntilterminated; Check: not IsWin64; StatusMsg: "Installing VC++ runtime (x86)..."; BeforeInstall: InstallDisableFile
; Install VC++ runtime for x64 on 64-bit OS
Filename: "{tmp}\vcredist_x64.exe"; Parameters: "/install /quiet /norestart"; Flags: runhidden waituntilterminated; Check: IsWin64; StatusMsg: "Installing VC++ runtime (x64)..."; BeforeInstall: InstallDisableFile
; Install DirectX redistributable if full redist (DXSETUP.exe) present
Filename: "{tmp}\DXSETUP.exe"; Parameters: "/silent"; Flags: runhidden waituntilterminated; Check: ShouldRunDXSetup(); StatusMsg: "Installing DirectX runtime..."; BeforeInstall: InstallDisableFile
; Or run web installer if present and full redist is not available
Filename: "{tmp}\dxwebsetup.exe"; Parameters: "/Q"; Flags: runhidden waituntilterminated; Check: ShouldRunDXWebSetup(); StatusMsg: "Installing DirectX web installer..."; BeforeInstall: InstallDisableFile
; Launch the app after install
Filename: "{app}\{#MyExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

; Run registry helper to write HKCU DirectX marker so app can detect private DirectX path
Filename: "{app}\Tools\register_private_dx.exe"; Parameters: "\"{app}\\directx_dev12.4\" 4.09.00.0904"; Flags: runhidden waituntilterminated; Check: IsTaskSelected('private_directx'); StatusMsg: "Registering private DirectX marker (HKCU)..."; BeforeInstall: InstallDisableFile
; Optionally run the combined helper or GUI if user accepted automation
Filename: "{app}\Tools\run_private_installer_gui.exe"; Parameters: ""; Flags: nowait postinstall; Check: IsTaskSelected('private_directx') and FileExistsInSource('run_private_installer_gui.exe') and ShouldRunAutomation(); Description: "Open Private Installer GUI";
Filename: "{app}\Tools\run_private_install.exe"; Parameters: "\"{app}\""; Flags: nowait postinstall; Check: IsTaskSelected('private_directx') and FileExistsInSource('run_private_install.exe') and not FileExistsInSource('run_private_installer_gui.exe') and ShouldRunAutomation(); Description: "Run private DirectX installer helper";

; Removal controlled by task 'remove_private_on_uninstall' and marker file

[Code]
function InstallDisableFile(): Boolean;
begin
  { dummy hook, returns True to allow run }
  Result := True;
end;

function ShouldRunAutomation(): Boolean;
begin
  Result := True; { fallback if InitializeWizard did not run }
end;

var
  AutoPage: TInputOptionWizardPage;

procedure InitializeWizard();
begin
  { Create a wizard page to ask whether to run automated private-directx setup after install }
  AutoPage := CreateInputOptionPage(wpSelectDir, 'Automation', 'Automated post-install actions',
	'Would you like the installer to automatically run the private DirectX setup and launch the application after installation?', False, False);
  AutoPage.Add('Run automated private DirectX setup and launch the application after install');
  AutoPage.Values[0] := True; { default to enabled for one-click flow }
end;

function ShouldRunAutomation(): Boolean;
begin
  Result := Assigned(AutoPage) and AutoPage.Values[0];
end;

function FileExistsInTemp(FileName: string): Boolean;
begin
  Result := FileExists(ExpandConstant('{tmp}\' + FileName));
end;

function ShouldRunDXSetup(): Boolean;
begin
  Result := IsTaskSelected('force_directx') and FileExistsInTemp('DXSETUP.exe');
end;

function ShouldRunDXWebSetup(): Boolean;
begin
  Result := IsTaskSelected('force_directx') and
	FileExistsInTemp('dxwebsetup.exe') and
	(not FileExistsInTemp('DXSETUP.exe')) and
	(not IsDirectXInstalled());
end;

function CompareVersionString(const A, B: string): Integer;
var
  i: Integer;
  aParts, bParts: TArrayOfString;
  aNum, bNum: Integer;
begin
  aParts := A.Split('.');
  bParts := B.Split('.');
  for i := 0 to Max(GetArrayLength(aParts), GetArrayLength(bParts)) - 1 do
  begin
	if i < GetArrayLength(aParts) then aNum := StrToIntDef(aParts[i], 0) else aNum := 0;
	if i < GetArrayLength(bParts) then bNum := StrToIntDef(bParts[i], 0) else bNum := 0;
	if aNum < bNum then begin Result := -1; Exit; end;
	if aNum > bNum then begin Result := 1; Exit; end;
  end;
  Result := 0;
end;

function IsDirectXInstalled(): Boolean;
var
  ver: string;
begin
  if RegQueryStringValue(HKLM, 'SOFTWARE\\Microsoft\\DirectX', 'Version', ver) then
  begin
	{ if installed version is greater-or-equal to threshold, consider DirectX present }
	Result := CompareVersionString(ver, '4.09.00.0904') >= 0;
  end
  else Result := False;
end;

procedure MoveDirContents(const srcDir, dstDir: string);
var
  FindRec: TFindRec;
  srcPath, dstPath: string;
begin
  if not FindFirst(srcDir + '\*', faAnyFile, FindRec) then Exit;
  try
	repeat
	  if (FindRec.Name = '.') or (FindRec.Name = '..') then Continue;
	  srcPath := srcDir + '\' + FindRec.Name;
	  dstPath := dstDir + '\' + FindRec.Name;
	  if (FindRec.Attributes and faDirectory) <> 0 then
	  begin
		if not DirExists(dstPath) then ForceDirectories(dstPath);
		MoveDirContents(srcPath, dstPath);
		if DirExists(srcPath) then RemoveDir(srcPath);
	  end
	  else
	  begin
		{ Try to rename (fast) else copy then delete }
		if not RenameFile(srcPath, dstPath) then
		begin
		  if FileCopy(srcPath, dstPath) then DeleteFile(srcPath);
		end;
	  end;
	until not FindNext(FindRec);
  finally
	FindClose(FindRec);
  end;
end;

procedure PreparePrivateDirectX(Param: string);
var
  srcDir, dstDir: string;
begin
  { Recursively move copied DirectX redist files into a private folder name to avoid touching system state }
  srcDir := ExpandConstant('{app}\DirectXRedist');
  dstDir := ExpandConstant('{app}\directx_dev12.4');
  Log('PreparePrivateDirectX: src=' + srcDir + ' dst=' + dstDir);
  if not DirExists(srcDir) then
  begin
	Log('PreparePrivateDirectX: source directory not found, nothing to do');
	Exit;
  end;
  if DirExists(dstDir) then
  begin
	Log('PreparePrivateDirectX: destination already exists, skipping');
	Exit; { already prepared }
  end;

  if not ForceDirectories(dstDir) then
  begin
	Log('PreparePrivateDirectX: failed to create destination directory');
	Exit;
  end;

  MoveDirContents(srcDir, dstDir);

  { try to remove the now-empty source dir }
  if DirExists(srcDir) then
  begin
	if RemoveDir(srcDir) then Log('PreparePrivateDirectX: removed source dir') else Log('PreparePrivateDirectX: failed to remove source dir');
  end;

	{ create a marker file so we know to remove the private redist on uninstall if the user chose that }
  if IsTaskSelected('remove_private_on_uninstall') then
  begin
	if not DeleteFile(dstDir + '\\.dont_remove') then ; // ensure no stale file
	if not SaveStringToFile(dstDir + '\\.dont_remove', 'remove_on_uninstall', False) then Log('PreparePrivateDirectX: failed to create marker file');
  end;

  Log('PreparePrivateDirectX: completed');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  d: string;
begin
  if CurUninstallStep = usUninstall then
  begin
	d := ExpandConstant('{app}\directx_dev12.4');
	if DirExists(d) and IsTaskSelected('remove_private_on_uninstall') then
	begin
	  if FileExists(d + '\\.dont_remove') then
	  begin
		Log('CurUninstallStepChanged: removing private DirectX folder: ' + d);
		if not DelTree(d) then Log('CurUninstallStepChanged: DelTree failed for ' + d);
	  end else Log('CurUninstallStepChanged: marker not found, skipping removal of ' + d);
	end;
  end;
end;
