#include <windows.h>

const wchar_t CLASS_NAME[] = L"ConductDyadraModalWindowClass";
LRESULT CALLBACK WndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam)
{
    if (uMsg == WM_DESTROY) { PostQuitMessage(0); return 0; }
    if (uMsg == WM_PAINT) {
        PAINTSTRUCT ps; HDC h = BeginPaint(hwnd, &ps);
        const wchar_t msg[] = L"Conduct Dyadra Modal - Placeholder";
        RECT rc; GetClientRect(hwnd, &rc);
        DrawTextW(h, msg, (int)wcslen(msg), &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        EndPaint(hwnd, &ps);
        return 0;
    }
    return DefWindowProc(hwnd, uMsg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE, PWSTR, int nCmdShow)
{
    WNDCLASS wc{}; wc.lpfnWndProc = WndProc; wc.hInstance = hInstance; wc.lpszClassName = CLASS_NAME;
    RegisterClass(&wc);
    HWND hwnd = CreateWindowEx(0, CLASS_NAME, L"Conduct Dyadra Modal", WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1280, 720, NULL, NULL, hInstance, NULL);
    if (!hwnd) return 0;
    ShowWindow(hwnd, nCmdShow);
    MSG msg{}; while (GetMessage(&msg, NULL, 0, 0)) { TranslateMessage(&msg); DispatchMessage(&msg); }
    return 0;
}
