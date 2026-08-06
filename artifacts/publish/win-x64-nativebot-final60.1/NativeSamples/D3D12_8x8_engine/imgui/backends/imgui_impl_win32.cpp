#include "imgui.h"
#include "imgui_impl_win32.h"

bool ImGui_ImplWin32_Init(void* hwnd) { (void)hwnd; return true; }
void ImGui_ImplWin32_NewFrame() { }
void ImGui_ImplWin32_Shutdown() { }
bool ImGui_ImplWin32_WndProcHandler(void* hwnd, unsigned msg, unsigned long wParam, long lParam) { (void)hwnd; (void)msg; (void)wParam; (void)lParam; return false; }
