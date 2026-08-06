#include <windows.h>

static const char* CLASS_NAME = "D3D12_8x8_Launcher_Class";

LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
	switch (msg) {
	case WM_DESTROY:
		PostQuitMessage(0);
		return 0;
	case WM_KEYDOWN:
		if (wParam == VK_ESCAPE) PostQuitMessage(0);
		return 0;
	}
	return DefWindowProc(hWnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int) {
	WNDCLASSEXA wc = {};
	wc.cbSize = sizeof(wc);
	wc.lpfnWndProc = WndProc;
	wc.hInstance = hInstance;
	wc.hCursor = LoadCursor(NULL, IDC_ARROW);
	wc.lpszClassName = CLASS_NAME;

	if (!RegisterClassExA(&wc)) return -1;

	HWND hwnd = CreateWindowExA(0, CLASS_NAME, "D3D12 8x8 Engine - Stub", WS_OVERLAPPEDWINDOW,
		CW_USEDEFAULT, CW_USEDEFAULT, 1280, 720, NULL, NULL, hInstance, NULL);
	if (!hwnd) return -1;

	ShowWindow(hwnd, SW_SHOWMAXIMIZED);
	UpdateWindow(hwnd);

	// Simple UI: create a static label in center
	HWND label = CreateWindowA("STATIC", "8x8 Engine Running (stub)\nPress ESC to exit", WS_CHILD | WS_VISIBLE | SS_CENTER,
		0, 0, 400, 60, hwnd, NULL, hInstance, NULL);
	// center label on resize
	SetWindowPos(label, NULL,  (1280-400)/2, (720-60)/2, 0, 0, SWP_NOZORDER | SWP_NOSIZE);

	MSG msg;
	while (GetMessage(&msg, NULL, 0, 0)) {
		TranslateMessage(&msg);
		DispatchMessage(&msg);
	}
	return (int)msg.wParam;
}
