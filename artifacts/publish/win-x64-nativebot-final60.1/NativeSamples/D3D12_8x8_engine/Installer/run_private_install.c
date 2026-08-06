#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

static int compute_sha256_hex(const char *path, char *outHex, size_t outHexSz) {
	HANDLE h = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
	if (h == INVALID_HANDLE_VALUE) return 0;
	BCRYPT_ALG_HANDLE hAlg = 0; if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) { CloseHandle(h); return 0; }
	BCRYPT_HASH_HANDLE hHash = 0; if (BCryptCreateHash(hAlg, &hHash, NULL, 0, NULL, 0, 0) != 0) { BCryptCloseAlgorithmProvider(hAlg,0); CloseHandle(h); return 0; }
	unsigned char buf[4096]; DWORD read = 0; BOOL ok = TRUE;
	while (ReadFile(h, buf, sizeof(buf), &read, NULL) && read > 0) {
		if (BCryptHashData(hHash, buf, read, 0) != 0) { ok = FALSE; break; }
	}
	if (ok) {
		unsigned char hash[32]; if (BCryptFinishHash(hHash, hash, sizeof(hash), 0) != 0) ok = FALSE;
		else {
			if (outHex && outHexSz >= 65) {
				for (int i = 0; i < 32; ++i) sprintf(outHex + i*2, "%02x", hash[i]);
				outHex[64] = '\0';
			}
		}
	}
	BCryptDestroyHash(hHash);
	BCryptCloseAlgorithmProvider(hAlg,0);
	CloseHandle(h);
	return ok ? 1 : 0;
}

static int ensure_dir(const char *path) {
	if (CreateDirectoryA(path, NULL)) return 1;
	DWORD err = GetLastError();
	if (err == ERROR_ALREADY_EXISTS) return 1;
	// try to create parent recursively
	char tmp[MAX_PATH]; strncpy(tmp, path, MAX_PATH); tmp[MAX_PATH-1] = '\0';
	for (char *p = tmp + 1; *p; ++p) {
		if (*p == '\\' || *p == '/') { *p = '\0'; CreateDirectoryA(tmp, NULL); *p = '\\'; }
	}
	return CreateDirectoryA(path, NULL) || GetLastError() == ERROR_ALREADY_EXISTS;
}

static int copy_file(const char *src, const char *dst) {
	// copy with overwrite
	return CopyFileA(src, dst, FALSE);
}

static int copy_dir_recursive(const char *srcDir, const char *dstDir) {
	WIN32_FIND_DATAA fd; char search[MAX_PATH]; snprintf(search, sizeof(search), "%s\\*", srcDir);
	HANDLE h = FindFirstFileA(search, &fd);
	if (h == INVALID_HANDLE_VALUE) return 0;
	ensure_dir(dstDir);
	do {
		if (strcmp(fd.cFileName, ".") == 0 || strcmp(fd.cFileName, "..") == 0) continue;
		char srcPath[MAX_PATH]; char dstPath[MAX_PATH];
		snprintf(srcPath, sizeof(srcPath), "%s\\%s", srcDir, fd.cFileName);
		snprintf(dstPath, sizeof(dstPath), "%s\\%s", dstDir, fd.cFileName);
		if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
			copy_dir_recursive(srcPath, dstPath);
		} else {
			CopyFileA(srcPath, dstPath, FALSE);
		}
	} while (FindNextFileA(h, &fd));
	FindClose(h);
	return 1;
}

static int read_checksums(const char *path, const char *baseDir) {
	FILE *f = fopen(path, "r"); if (!f) return 0;
	char line[512]; int ok = 1;
	while (fgets(line, sizeof(line), f)) {
		char *nl = strchr(line, '\n'); if (nl) *nl = '\0';
		if (line[0] == '\0') continue;
		char hash[128]; char name[256]; if (sscanf(line, "%127s %255s", hash, name) != 2) continue;
		char full[MAX_PATH]; snprintf(full, sizeof(full), "%s\\%s", baseDir, name);
		if (GetFileAttributesA(full) == INVALID_FILE_ATTRIBUTES) { printf("Missing file: %s\n", full); ok = 0; continue; }
		char computed[65]; if (!compute_sha256_hex(full, computed, sizeof(computed))) { printf("Failed to hash: %s\n", full); ok = 0; continue; }
		if (_stricmp(computed, hash) != 0) { printf("Checksum mismatch for %s\nExpected: %s\nActual:   %s\n", name, hash, computed); ok = 0; }
		else printf("Checksum OK: %s\n", name);
	}
	fclose(f); return ok;
}

int main(int argc, char **argv) {
	// Determine installer directory (where this exe lives)
	char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, MAX_PATH);
	char *p = strrchr(exePath, '\\'); if (p) *p = '\0';
	char installerDir[MAX_PATH]; strncpy(installerDir, exePath, MAX_PATH);

	// Determine target app dir
	char appDir[MAX_PATH]; if (argc >= 2) { strncpy(appDir, argv[1], MAX_PATH); } else {
		// default to ..\build\Debug
		snprintf(appDir, MAX_PATH, "%s\\..\\build\\Debug", installerDir);
	}
	// normalize
	if (GetFullPathNameA(appDir, MAX_PATH, appDir, NULL) == 0) { printf("Invalid app dir\n"); return 1; }

	printf("Installer helper running. InstallerDir=%s\n", installerDir);
	printf("Target app dir=%s\n", appDir);

	// Ensure app dir exists
	if (GetFileAttributesA(appDir) == INVALID_FILE_ATTRIBUTES) {
		printf("App dir does not exist: %s\n", appDir); return 1;
	}

	char privateSrc[MAX_PATH]; snprintf(privateSrc, MAX_PATH, "%s\\DirectXRedist", installerDir);
	char privateDst[MAX_PATH]; snprintf(privateDst, MAX_PATH, "%s\\directx_dev12.4", appDir);

	if (GetFileAttributesA(privateDst) == INVALID_FILE_ATTRIBUTES) {
		printf("Private dir missing, attempting to copy from %s\n", privateSrc);
		if (GetFileAttributesA(privateSrc) == INVALID_FILE_ATTRIBUTES) { printf("No DirectXRedist found to copy.\n"); return 1; }
		ensure_dir(privateDst);
		if (!copy_dir_recursive(privateSrc, privateDst)) { printf("Failed to copy DirectXRedist.\n"); return 1; }
		printf("Copied DirectXRedist to %s\n", privateDst);
	} else printf("Private dir already exists: %s\n", privateDst);

	// Copy release CRTs if present in installerDir
	const char *crts[] = {"vcruntime140.dll","ucrtbase.dll", NULL};
	for (int i=0; crts[i]; ++i) {
		char src[MAX_PATH], dst[MAX_PATH]; snprintf(src, MAX_PATH, "%s\\%s", installerDir, crts[i]); snprintf(dst, MAX_PATH, "%s\\%s", privateDst, crts[i]);
		if (GetFileAttributesA(dst) == INVALID_FILE_ATTRIBUTES) {
			if (GetFileAttributesA(src) != INVALID_FILE_ATTRIBUTES) { CopyFileA(src, dst, FALSE); printf("Copied CRT %s\n", crts[i]); }
		}
	}

	// Check crt_checksums.txt in installerDir
	char chkPath[MAX_PATH]; snprintf(chkPath, MAX_PATH, "%s\\crt_checksums.txt", installerDir);
	if (GetFileAttributesA(chkPath) != INVALID_FILE_ATTRIBUTES) {
		printf("Found checksum file: %s\n", chkPath);
		if (!read_checksums(chkPath, privateDst)) { printf("Checksum validation failed. Aborting.\n"); return 1; }
	} else {
		printf("No checksum file found, skipping checksum validation.\n");
	}

	// Run register_private_dx.exe if present in installerDir\\RegisterPrivateDX or app Tools
	char regExe[MAX_PATH]; snprintf(regExe, MAX_PATH, "%s\\RegisterPrivateDX\\register_private_dx.exe", installerDir);
	if (GetFileAttributesA(regExe) == INVALID_FILE_ATTRIBUTES) {
		snprintf(regExe, MAX_PATH, "%s\\Tools\\register_private_dx.exe", appDir);
	}
	if (GetFileAttributesA(regExe) != INVALID_FILE_ATTRIBUTES) {
		printf("Running registry helper: %s\n", regExe);
		STARTUPINFOA si = { sizeof(si) }; PROCESS_INFORMATION pi; BOOL ok = CreateProcessA(regExe, NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi);
		if (ok) { WaitForSingleObject(pi.hProcess, INFINITE); CloseHandle(pi.hProcess); CloseHandle(pi.hThread); printf("Registry helper finished.\n"); }
		else printf("Failed to run registry helper.\n");
	} else printf("No registry helper found, skipping registry write.\n");

	// Launch the main exe
	char mainExe[MAX_PATH]; snprintf(mainExe, MAX_PATH, "%s\\D3D12_8x8_engine.exe", appDir);
	if (GetFileAttributesA(mainExe) != INVALID_FILE_ATTRIBUTES) {
		printf("Launching %s\n", mainExe);
		STARTUPINFOA si = { sizeof(si) }; PROCESS_INFORMATION pi; if (CreateProcessA(mainExe, NULL, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) { CloseHandle(pi.hProcess); CloseHandle(pi.hThread); }
		else printf("Failed to launch main exe.\n");
	} else printf("Main exe not found at %s\n", mainExe);

	return 0;
}
