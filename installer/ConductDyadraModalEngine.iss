#define MyAppName "Conduct Dyadra Modal"
#define MyAppVersion "1.0.0"
#define MyMainExe "Conduct Dyadra Modal.exe"

; These are passed from the build script:
; /DSourceDir=... /DOutputDir=...
#ifndef SourceDir
  #define SourceDir "staging\\app"
#endif

#ifndef OutputDir
  #define OutputDir "output"
#endif

[Setup]
AppId={{6F64D9A7-88BF-4F3D-AB42-2A8E4D0F3F70}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=FTXArduous
DefaultDirName={autopf}\\Conduct Dyadra Modal
DefaultGroupName=Conduct Dyadra Modal
DisableDirPage=no
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=ConductDyadraModal_EngineInstaller
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\\Conduct Dyadra Modal"; Filename: "{app}\\{#MyMainExe}"
Name: "{autodesktop}\\Conduct Dyadra Modal"; Filename: "{app}\\{#MyMainExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyMainExe}"; Description: "Launch Conduct Dyadra Modal"; Flags: nowait postinstall skipifsilent
