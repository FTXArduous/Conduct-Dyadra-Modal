#pragma once

bool ImGui_ImplWin32_Init(void* hwnd);
void ImGui_ImplWin32_NewFrame();
void ImGui_ImplWin32_Shutdown();
bool ImGui_ImplWin32_WndProcHandler(void* hwnd, unsigned msg, unsigned long wParam, long lParam);
