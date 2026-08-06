#include "fake_imgui.h"
#include <stdio.h>

int FakeImGui_Init(void *hwnd, void *device, void *srvHeap, unsigned rtvDescriptorSize)
{
	(void)hwnd; (void)device; (void)srvHeap; (void)rtvDescriptorSize;
	// Minimal success: pretend ImGui initialized so higher-level code can proceed.
	return 1;
}

void FakeImGui_NewFrame()
{
	// No-op
}

void FakeImGui_Render()
{
	// No-op
}

void FakeImGui_Shutdown()
{
}

int FakeImGui_WndProcHandler(void *hwnd, unsigned msg, unsigned long wParam, long lParam)
{
	(void)hwnd; (void)msg; (void)wParam; (void)lParam;
	return 0; // not handled
}
