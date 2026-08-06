#include <windows.h>
#include <shellapi.h>
#include <stdio.h>

#define IDC_BTN_INSTALL 1001
#define IDC_STATUS 1002

static HWND g_hwndMain = NULL;
static HWND g_btnInstall = NULL;
static HWND g_status = NULL;

static void SetStatus(const char *fmt, ...) {
	char buf[512]; va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
	if (g_status) SetWindowTextA(g_status, buf);
}

static void RunHelperAsync(const char *installerPath, const char *appPath) {
	char cmd[MAX_PATH*2]; snprintf(cmd, sizeof(cmd), "\"%s\\run_private_install.exe\" \"%s\"", installerPath, appPath);
	STARTUPINFOA si = { sizeof(si) }; PROCESS_INFORMATION pi; 
	SetStatus("Starting private install helper...");
	if (CreateProcessA(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
		SetStatus("Running... please wait");
		WaitForSingleObject(pi.hProcess, INFINITE);
		DWORD exitCode = 0; GetExitCodeProcess(pi.hProcess, &exitCode);
		CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
		if (exitCode == 0) SetStatus("Private install completed successfully."); else SetStatus("Private install finished with code %u.", (unsigned)exitCode);
	} else {
		SetStatus("Failed to launch helper: %s", cmd);
	}
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
	switch (msg) {
	case WM_CREATE:
		g_btnInstall = CreateWindowA("BUTTON", "Install Private DirectX", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 20, 20, 260, 40, hwnd, (HMENU)IDC_BTN_INSTALL, NULL, NULL);
		g_status = CreateWindowA("STATIC", "Idle", WS_CHILD|WS_VISIBLE|SS_LEFT, 20, 70, 360, 24, hwnd, (HMENU)IDC_STATUS, NULL, NULL);
		return 0;
	case WM_COMMAND:
		if (LOWORD(wParam) == IDC_BTN_INSTALL) {
			// Determine installer dir (exe location)
			char exePath[MAX_PATH]; GetModuleFileNameA(NULL, exePath, MAX_PATH);
			char *p = strrchr(exePath, '\\'); if (p) *p = '\0';
			char appPath[MAX_PATH]; // default to parent\..\build\Debug
			snprintf(appPath, MAX_PATH, "%s\\..\\build\\Debug", exePath);
			// normalize
			char fullApp[MAX_PATH]; if (!GetFullPathNameA(appPath, MAX_PATH, fullApp, NULL)) strncpy(fullApp, appPath, MAX_PATH);
			// Run in background thread
			SetWindowTextA(g_btnInstall, "Running..."); EnableWindow(g_btnInstall, FALSE);
			RunHelperAsync(exePath, fullApp);
			SetWindowTextA(g_btnInstall, "Close"); EnableWindow(g_btnInstall, TRUE);
		}
		return 0;
	case WM_DESTROY: PostQuitMessage(0); return 0;
	}
	return DefWindowProcA(hwnd,msg,wParam,lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int) {
	const char *cls = "RunPrivateInstallGui";
	WNDCLASSEXA wc = { sizeof(wc), CS_CLASSDC, WndProc, 0,0, hInstance, NULL, NULL, NULL, NULL, cls, NULL };
	RegisterClassExA(&wc);
	g_hwndMain = CreateWindowA(cls, "Private DirectX Installer", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, CW_USEDEFAULT, CW_USEDEFAULT, 420, 150, NULL, NULL, hInstance, NULL);
	if (!g_hwndMain) return -1;
	ShowWindow(g_hwndMain, SW_SHOW);
	UpdateWindow(g_hwndMain);
	MSG msg;
	while (GetMessageA(&msg,NULL,0,0)) { TranslateMessage(&msg); DispatchMessageA(&msg); }
	return 0;
}
