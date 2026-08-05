# Conduct Dyadra Modal

This repository includes the published Windows executable as a Git LFS asset.

## Install the full EXE on Windows

1. Install Git for Windows.
2. Install Git LFS.
3. Open PowerShell and run:

   ```powershell
   git lfs install
   git clone https://github.com/FTXArduous/Conduct-Dyadra-Modal.git
   cd Conduct-Dyadra-Modal
   git lfs pull
   ```

4. After `git lfs pull`, open the executable at `artifacts/publish/win-x64-updated/Conduct Dyadra Modal.exe`.
5. Double-click the file in File Explorer to launch it.

## Notes

- The executable is stored with Git LFS because it is too large for normal GitHub blobs.
- If you want the exact file path inside the repo, it is `artifacts/publish/win-x64-updated/Conduct Dyadra Modal.exe`.
- If you download the repo as a ZIP from GitHub, make sure the large file is present after extraction. If it is missing, use `git clone` plus `git lfs pull` instead.
- The included build is the Windows x64 published EXE.
