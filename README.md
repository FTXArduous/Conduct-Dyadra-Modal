# Conduct Dyadra Modal

This repository includes the published Windows executable as a Git LFS asset.

## Install the full EXE on Windows

1. Install Git for Windows.
2. Install Git LFS.
3. For a fresh clone, open PowerShell and run:

   ```powershell
   git lfs install
   git clone https://github.com/FTXArduous/Conduct-Dyadra-Modal.git
   cd Conduct-Dyadra-Modal
   git lfs pull
   ```

4. For an existing local clone, update both git commits and LFS files:

   ```powershell
   cd Conduct-Dyadra-Modal
   git pull origin main
   git lfs pull
   ```

5. After the update, open the executable at `artifacts/publish/win-x64-updated/Conduct Dyadra Modal.exe`.
6. Double-click the file in File Explorer to launch it.

## Notes

- The executable is stored with Git LFS because it is too large for normal GitHub blobs.
- If you want the exact file path inside the repo, it is `artifacts/publish/win-x64-updated/Conduct Dyadra Modal.exe`.
- The main exe now auto-detects the bundled native engine under `NativeSamples/D3D12_8x8_engine/build/Release`, so you do not need to set `PORTAL_EXE_PATH` for a standard install.
- If you already cloned earlier, always run `git pull origin main` before `git lfs pull`.
- If you download the repo as a ZIP from GitHub, make sure the large file is present after extraction. If it is missing, use `git clone` plus `git lfs pull` instead.
- The included build is the Windows x64 published EXE.
