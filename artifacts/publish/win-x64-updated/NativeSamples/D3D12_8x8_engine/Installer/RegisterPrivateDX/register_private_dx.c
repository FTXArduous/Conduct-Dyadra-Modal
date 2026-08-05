#include <windows.h>
#include <stdio.h>

int write_reg_string(HKEY root, const char* subkey, const char* name, const char* value) {
	HKEY hKey;
	DWORD disposition;
	LONG r = RegCreateKeyExA(root, subkey, 0, NULL, 0, KEY_WRITE, NULL, &hKey, &disposition);
	if (r != ERROR_SUCCESS) return 0;
	r = RegSetValueExA(hKey, name, 0, REG_SZ, (const BYTE*)value, (DWORD)(strlen(value) + 1));
	RegCloseKey(hKey);
	return r == ERROR_SUCCESS;
}

int main(int argc, char** argv) {
	// Usage: register_private_dx.exe [path-to-private-dir] [version] [--system]
	char pathBuf[MAX_PATH];
	char versionBuf[64] = "4.09.00.0904"; // default version string used earlier in installer
	int writeSystem = 0;

	if (argc >= 2) {
		strncpy(pathBuf, argv[1], MAX_PATH - 1);
		pathBuf[MAX_PATH - 1] = '\0';
	} else {
		// default to exe directory + \directx_dev12.4
		if (!GetModuleFileNameA(NULL, pathBuf, MAX_PATH)) pathBuf[0] = '\0';
		char* p = strrchr(pathBuf, '\\');
		if (p) { *p = '\0'; }
		strncat(pathBuf, "\\directx_dev12.4", MAX_PATH - strlen(pathBuf) - 1);
	}
	if (argc >= 3) {
		strncpy(versionBuf, argv[2], sizeof(versionBuf)-1);
		versionBuf[sizeof(versionBuf)-1] = '\0';
	}
	if (argc >= 4 && strcmp(argv[3], "--system") == 0) writeSystem = 1;

	printf("Registering private DirectX path: %s\n", pathBuf);
	printf("Version: %s (system write=%d)\n", versionBuf, writeSystem);

	// Write HKCU key so application can detect private DirectX without touching HKLM
	int ok = write_reg_string(HKEY_CURRENT_USER, "SOFTWARE\\Microsoft\\DirectX", "Version", versionBuf);
	if (!ok) {
		printf("Failed to write HKCU\\SOFTWARE\\Microsoft\\DirectX\\Version\n");
	} else {
		printf("Wrote HKCU\\SOFTWARE\\Microsoft\\DirectX\\Version=%s\n", versionBuf);
	}

	// Also write an application-specific marker with path
	char appSub[128];
	snprintf(appSub, sizeof(appSub), "SOFTWARE\\ConductDyadraModal\\DirectXPrivate");
	ok = write_reg_string(HKEY_CURRENT_USER, appSub, "InstallPath", pathBuf);
	if (!ok) printf("Failed to write HKCU app marker\n"); else printf("Wrote HKCU\\%s\\InstallPath=%s\n", appSub, pathBuf);

	if (writeSystem) {
		// attempt to write HKLM (requires admin)
		if (!write_reg_string(HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\DirectX", "Version", versionBuf)) {
			printf("Warning: failed to write HKLM\\SOFTWARE\\Microsoft\\DirectX (insufficient privileges?)\n");
		} else {
			printf("Wrote HKLM\\SOFTWARE\\Microsoft\\DirectX\\Version=%s\n", versionBuf);
		}
	}

	return 0;
}
