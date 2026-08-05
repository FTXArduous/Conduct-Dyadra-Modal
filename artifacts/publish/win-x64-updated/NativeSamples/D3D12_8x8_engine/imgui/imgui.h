#pragma once

// Minimal stub of Dear ImGui API used by this sample.
// This is NOT a full ImGui implementation. It provides the small surface area
// needed by imgui_wrapper.cpp to compile and run. Replace with real Dear ImGui
// sources for full functionality.

#include <stdint.h>

namespace ImGui {

struct ImGuiIO {
	bool WantCaptureMouse;
	bool WantCaptureKeyboard;
};

struct ImDrawData { void* dummy; };

inline void IMGUI_CHECKVERSION() {}
ImGui::ImGuiIO& GetIO();
void CreateContext();
void DestroyContext();
void StyleColorsDark();
void NewFrame();
void Render();
ImDrawData* GetDrawData();

} // namespace ImGui


// Backends forward declarations (real backends provide these)
namespace ImGui_ImplWin32 {
	bool Init(void* hwnd);
	void NewFrame();
	void Shutdown();
	bool WndProcHandler(void* hwnd, unsigned msg, unsigned long wParam, long lParam);
}

namespace ImGui_ImplDX12 {
	bool Init(void* device, int numFramesInFlight, unsigned rtvFormat, void* srvHeap, void* cpuHandle, void* gpuHandle);
	void NewFrame();
	void Shutdown();
	void RenderDrawData(ImGui::ImDrawData* draw_data, void* cmdList);
}

