// Simple ImGui wrapper. If USE_IMGUI is defined and ImGui sources are added, this will initialize ImGui.
#include "imgui_wrapper.h"
#include "fake_imgui.h"
#if defined(USE_IMGUI)
#include "imgui.h"
#include "backends/imgui_impl_win32.h"
#include "backends/imgui_impl_dx12.h"
#include <d3d12.h>
#include <dxgi1_4.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

int init_imgui(void *hwnd, void *device, void *srvHeap, unsigned rtvDescriptorSize)
{
#ifdef USE_IMGUI
	// Initialize Dear ImGui context and backends. The project must include ImGui core and backend sources.
	IMGUI_CHECKVERSION();
	ImGui::CreateContext();
	ImGuiIO &io = ImGui::GetIO(); (void)io;
	ImGui::StyleColorsDark();

	HWND hwnd = (HWND)hwnd; // keep original param name shadowing suppressed
	ImGui_ImplWin32_Init((HWND)hwnd);

	// device and srvHeap are expected to be ID3D12Device* and ID3D12DescriptorHeap*
	ID3D12Device *d3dDevice = (ID3D12Device*)device;
	ID3D12DescriptorHeap *cbvSrvHeap = (ID3D12DescriptorHeap*)srvHeap;

	// We choose 2 frames in flight by default. rtvDescriptorSize is provided by the caller.
	const int numFramesInFlight = 2;
	// Use a common RTV format; the sample uses R8G8B8A8_UNORM for swapchain/offscreen.
	DXGI_FORMAT rtvFormat = DXGI_FORMAT_R8G8B8A8_UNORM;

	// Obtain CPU/GPU descriptor handles from the provided descriptor heap if available.
	D3D12_CPU_DESCRIPTOR_HANDLE cpuHandle = { 0 };
	D3D12_GPU_DESCRIPTOR_HANDLE gpuHandle = { 0 };
	if (cbvSrvHeap) {
		cpuHandle = cbvSrvHeap->GetCPUDescriptorHandleForHeapStart();
		gpuHandle = cbvSrvHeap->GetGPUDescriptorHandleForHeapStart();
	}

	ImGui_ImplDX12_Init(d3dDevice, numFramesInFlight, rtvFormat, cbvSrvHeap, cpuHandle, gpuHandle);
	return 1;
#else
	(void)hwnd; (void)device; (void)srvHeap; (void)rtvDescriptorSize;
	return FakeImGui_Init(hwnd, device, srvHeap, rtvDescriptorSize);
#endif
}

void new_frame_imgui()
{
#ifdef USE_IMGUI
	ImGui_ImplDX12_NewFrame();
	ImGui_ImplWin32_NewFrame();
	ImGui::NewFrame();
#endif
}

void render_imgui()
{
#ifdef USE_IMGUI
	ImGui::Render();
	// The application must call ImGui_ImplDX12_RenderDrawData during command list recording with a valid ID3D12GraphicsCommandList*
	// Here we cannot access the command list; the app should call ImGui_ImplDX12_RenderDrawData from its render path.
	// Provide a fallback: do nothing here.
#endif
}

void shutdown_imgui()
{
#ifdef USE_IMGUI
	ImGui_ImplDX12_Shutdown();
	ImGui_ImplWin32_Shutdown();
	ImGui::DestroyContext();
#endif
}

int imgui_wndproc_handler(void *hwnd, unsigned msg, unsigned long wParam, long lParam)
{
#ifdef USE_IMGUI
	return ImGui_ImplWin32_WndProcHandler((HWND)hwnd, (UINT)msg, (WPARAM)wParam, (LPARAM)lParam) ? 1 : 0;
#else
	return FakeImGui_WndProcHandler(hwnd, msg, wParam, lParam);
#endif
}

#ifdef __cplusplus
}
#endif
