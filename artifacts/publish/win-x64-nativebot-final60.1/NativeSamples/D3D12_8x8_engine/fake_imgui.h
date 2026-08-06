#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Minimal fake ImGui shim to satisfy integration while real Dear ImGui is vendored.
int FakeImGui_Init(void *hwnd, void *device, void *srvHeap, unsigned rtvDescriptorSize);
void FakeImGui_NewFrame();
void FakeImGui_Render();
void FakeImGui_Shutdown();
int FakeImGui_WndProcHandler(void *hwnd, unsigned msg, unsigned long wParam, long lParam);

#ifdef __cplusplus
}
#endif

