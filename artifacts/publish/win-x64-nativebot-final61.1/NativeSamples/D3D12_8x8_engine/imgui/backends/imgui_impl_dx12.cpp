#include "imgui.h"
#include "imgui_impl_dx12.h"

bool ImGui_ImplDX12_Init(void* device, int numFramesInFlight, unsigned rtvFormat, void* srvHeap, void* cpuHandle, void* gpuHandle)
{
	(void)device; (void)numFramesInFlight; (void)rtvFormat; (void)srvHeap; (void)cpuHandle; (void)gpuHandle;
	return true;
}

void ImGui_ImplDX12_NewFrame() { }
void ImGui_ImplDX12_Shutdown() { }
void ImGui_ImplDX12_RenderDrawData(void* draw_data, void* cmdList) { (void)draw_data; (void)cmdList; }
