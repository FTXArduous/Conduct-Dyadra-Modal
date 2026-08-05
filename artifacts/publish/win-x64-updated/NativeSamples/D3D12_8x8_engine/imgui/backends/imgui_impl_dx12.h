#pragma once

bool ImGui_ImplDX12_Init(void* device, int numFramesInFlight, unsigned rtvFormat, void* srvHeap, void* cpuHandle, void* gpuHandle);
void ImGui_ImplDX12_NewFrame();
void ImGui_ImplDX12_Shutdown();
void ImGui_ImplDX12_RenderDrawData(void* draw_data, void* cmdList);
