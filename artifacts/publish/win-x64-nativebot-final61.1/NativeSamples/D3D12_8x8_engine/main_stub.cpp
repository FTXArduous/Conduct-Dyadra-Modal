#include <windows.h>
#include <wrl/client.h>
#include <d3d12.h>
#include <dxgi1_4.h>

using Microsoft::WRL::ComPtr;
#pragma comment(lib, "d3d12.lib")
#pragma comment(lib, "dxgi.lib")

static const UINT FrameCount = 2;

struct D3DState {
	ComPtr<ID3D12Device> device;
	ComPtr<ID3D12CommandQueue> commandQueue;
	ComPtr<IDXGISwapChain3> swapchain;
	ComPtr<ID3D12DescriptorHeap> rtvHeap;
	ComPtr<ID3D12Resource> renderTargets[FrameCount];
	ComPtr<ID3D12CommandAllocator> commandAllocator;
	ComPtr<ID3D12GraphicsCommandList> commandList;
	ComPtr<ID3D12Fence> fence;
	UINT rtvDescriptorSize = 0;
	UINT frameIndex = 0;
	UINT64 fenceValue = 0;
	HANDLE fenceEvent = NULL;
} g_d3d;

HWND g_hwnd = NULL;

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
	if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
	return DefWindowProc(hWnd, message, wParam, lParam);
}

static bool InitD3D(UINT width, UINT height)
{
	HRESULT hr;
	ComPtr<IDXGIFactory4> factory;
	hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
	if (FAILED(hr)) return false;

	hr = D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&g_d3d.device));
	if (FAILED(hr)) return false;

	D3D12_COMMAND_QUEUE_DESC qDesc = {};
	qDesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
	hr = g_d3d.device->CreateCommandQueue(&qDesc, IID_PPV_ARGS(&g_d3d.commandQueue));
	if (FAILED(hr)) return false;

	DXGI_SWAP_CHAIN_DESC1 scDesc = {};
	scDesc.BufferCount = FrameCount;
	scDesc.Width = width;
	scDesc.Height = height;
	scDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
	scDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
	scDesc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
	scDesc.SampleDesc.Count = 1;

	ComPtr<IDXGISwapChain1> swapchain1;
	hr = factory->CreateSwapChainForHwnd(g_d3d.commandQueue.Get(), g_hwnd, &scDesc, nullptr, nullptr, &swapchain1);
	if (FAILED(hr)) return false;

	hr = swapchain1.As(&g_d3d.swapchain);
	if (FAILED(hr)) return false;

	g_d3d.frameIndex = g_d3d.swapchain->GetCurrentBackBufferIndex();

	D3D12_DESCRIPTOR_HEAP_DESC rtvHeapDesc = {};
	rtvHeapDesc.NumDescriptors = FrameCount;
	rtvHeapDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
	hr = g_d3d.device->CreateDescriptorHeap(&rtvHeapDesc, IID_PPV_ARGS(&g_d3d.rtvHeap));
	if (FAILED(hr)) return false;

	g_d3d.rtvDescriptorSize = g_d3d.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);

	D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle = g_d3d.rtvHeap->GetCPUDescriptorHandleForHeapStart();
	for (UINT i = 0; i < FrameCount; ++i) {
		hr = g_d3d.swapchain->GetBuffer(i, IID_PPV_ARGS(&g_d3d.renderTargets[i]));
		if (FAILED(hr)) return false;
		g_d3d.device->CreateRenderTargetView(g_d3d.renderTargets[i].Get(), nullptr, rtvHandle);
		rtvHandle.ptr += g_d3d.rtvDescriptorSize;
	}

	hr = g_d3d.device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&g_d3d.commandAllocator));
	if (FAILED(hr)) return false;

	hr = g_d3d.device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, g_d3d.commandAllocator.Get(), nullptr, IID_PPV_ARGS(&g_d3d.commandList));
	if (FAILED(hr)) return false;
	g_d3d.commandList->Close();

	hr = g_d3d.device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&g_d3d.fence));
	if (FAILED(hr)) return false;
	g_d3d.fenceValue = 1;
	g_d3d.fenceEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
	if (!g_d3d.fenceEvent) return false;

	return true;
}

static void WaitForGPU()
{
	const UINT64 fence = g_d3d.fenceValue;
	g_d3d.commandQueue->Signal(g_d3d.fence.Get(), fence);
	g_d3d.fenceValue++;
	if (g_d3d.fence->GetCompletedValue() < fence) {
		g_d3d.fence->SetEventOnCompletion(fence, g_d3d.fenceEvent);
		WaitForSingleObject(g_d3d.fenceEvent, INFINITE);
	}
}

static void PopulateCommandList()
{
	g_d3d.commandAllocator->Reset();
	g_d3d.commandList->Reset(g_d3d.commandAllocator.Get(), nullptr);

	D3D12_RESOURCE_BARRIER barrier = {};
	barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
	barrier.Transition.pResource = g_d3d.renderTargets[g_d3d.frameIndex].Get();
	barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
	barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
	barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
	g_d3d.commandList->ResourceBarrier(1, &barrier);

	D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle = g_d3d.rtvHeap->GetCPUDescriptorHandleForHeapStart();
	rtvHandle.ptr += g_d3d.frameIndex * g_d3d.rtvDescriptorSize;
	const float clearColor[] = { 0.2f, 0.3f, 0.4f, 1.0f };
	g_d3d.commandList->ClearRenderTargetView(rtvHandle, clearColor, 0, nullptr);

	barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET;
	barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
	g_d3d.commandList->ResourceBarrier(1, &barrier);

	g_d3d.commandList->Close();
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int)
{
	const char* className = "D3D12_8x8_Stub_Main";
	WNDCLASSEXA wc = {};
	wc.cbSize = sizeof(wc);
	wc.lpfnWndProc = WndProc;
	wc.hInstance = hInstance;
	wc.lpszClassName = className;
	RegisterClassExA(&wc);

	g_hwnd = CreateWindowExA(0, className, "D3D12 8x8 Engine - Running", WS_OVERLAPPEDWINDOW,
		CW_USEDEFAULT, CW_USEDEFAULT, 1280, 720, nullptr, nullptr, hInstance, nullptr);
	if (!g_hwnd) return -1;

	ShowWindow(g_hwnd, SW_SHOWMAXIMIZED);

	if (!InitD3D(1280, 720)) {
		MessageBoxA(nullptr, "Failed to initialize D3D12", "Error", MB_OK);
		return -1;
	}

	MSG msg = {};
	bool running = true;
	while (running) {
		while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
			if (msg.message == WM_QUIT) { running = false; break; }
			TranslateMessage(&msg);
			DispatchMessage(&msg);
		}
		if (!running) break;

		PopulateCommandList();
		ID3D12CommandList* lists[] = { g_d3d.commandList.Get() };
		g_d3d.commandQueue->ExecuteCommandLists(1, lists);
		g_d3d.swapchain->Present(1, 0);
		WaitForGPU();
		g_d3d.frameIndex = g_d3d.swapchain->GetCurrentBackBufferIndex();
	}

	WaitForGPU();
	CloseHandle(g_d3d.fenceEvent);
	return 0;
}
