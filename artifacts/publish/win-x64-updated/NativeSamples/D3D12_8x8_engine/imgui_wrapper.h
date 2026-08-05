#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// Initialize ImGui integration. If ImGui is not available, this is a no-op stub.
int init_imgui(void *hwnd, void *device, void *srvHeap, unsigned rtvDescriptorSize);
void new_frame_imgui();
void render_imgui();
void shutdown_imgui();
// WndProc handler forwarder
int imgui_wndproc_handler(void *hwnd, unsigned msg, unsigned long wParam, long lParam);

#ifdef __cplusplus
}
#endif
