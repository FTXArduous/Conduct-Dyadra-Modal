To create an installer for D3D12_8x8_engine:

1. Build the project in Visual Studio (Debug or Release). The EXE will be at: \NativeSamples\D3D12_8x8_engine\build\Debug\D3D12_8x8_engine.exe
2. Install Inno Setup (https://jrsoftware.org) if you want a native installer (.exe).
3. Open a Developer PowerShell and run the script in the Installer folder:

   pwsh.exe -ExecutionPolicy Bypass -File build_installer.ps1 -BuildDir "..\build\Debug" -OutDir "..\build\installer"

4. If Inno Setup is installed in the default location, the script will automatically invoke ISCC.exe to build the installer from setup.iss. Otherwise you can open setup.iss in the Inno Setup GUI and build manually.

Files:
- setup.iss: Inno Setup script (basic). Edit to include additional DLLs and runtimes.
- build_installer.ps1: Helper script that packages the build output into a zip and invokes Inno Setup if available.
