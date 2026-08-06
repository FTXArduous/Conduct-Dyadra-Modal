Include VC++ Redistributables

Place the following installers in the Installer folder before building the Inno installer:

- vcredist_x86.exe  (Visual C++ Redistributable for Visual Studio)
- vcredist_x64.exe  (Visual C++ Redistributable for Visual Studio)

DirectX Redist (optional)

You may also include DirectX redistributables if your app requires older DirectX SDK runtime files.
Place either the web installer (dxwebsetup.exe) or the full redistributable extracted folder DirectXRedist with DXSETUP.exe inside the Installer folder.

Example files to place in the Installer folder:
- vcredist_x86.exe
- vcredist_x64.exe
- dxwebsetup.exe  (optional)
- DirectXRedist\DXSETUP.exe  (optional)

You can download the latest redistributables from Microsoft:
https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist

The Inno Setup script will copy the correct redistributable into the temporary folder and run it silently during install.

RegisterPrivateDX helper

Build `Installer/RegisterPrivateDX/register_private_dx.c` and place the output
`register_private_dx.exe` in the `Installer` folder before building the Inno installer.

Suggested build (MSVC Developer Command Prompt):

`cl /nologo /O2 /W4 /Fe:register_private_dx.exe RegisterPrivateDX\register_private_dx.c advapi32.lib`

Helper usage:

`register_private_dx.exe [path-to-private-dir] [version] [--system]`

- default: writes HKCU entries (no admin required)
- `--system`: attempts HKLM writes (requires elevation)

Inno Setup integration (private DirectX option):

Add the helper to `[Files]`:

`Source: "register_private_dx.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall`

Run it only when `private_directx` is selected (non-admin HKCU registration):

`Filename: "{tmp}\register_private_dx.exe"; Parameters: """{app}\DirectXRedist"" ""1.0"""; Flags: runhidden waituntilterminated; Tasks: private_directx`

RunPrivateInstall helper

Build `Installer/run_private_install.c` and place the output
`run_private_install.exe` in the `Installer` folder before building the Inno installer.

This helper can be added to the installer and optionally launched post-install
to simplify private DirectX setup for users.
