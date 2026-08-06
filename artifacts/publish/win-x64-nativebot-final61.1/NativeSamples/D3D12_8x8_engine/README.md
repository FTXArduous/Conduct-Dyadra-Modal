D3D12 8x8 Engine Sample (C)

This sample demonstrates a high-frequency 8x8 pixel "engine" producer running in a separate thread and
a Direct3D12 consumer in C that uploads the latest produced frame into the swapchain backbuffer and presents
it. The sample copies the upload buffer directly into the swapchain backbuffer using CopyTextureRegion — no
root signature, shaders or PSOs are required for this demo.

Notes:
- This is a minimal native C example and omits many production checks and optimizations.
- You need the Windows 10+ SDK headers and link to d3d12.lib dxgi.lib d3dcompiler.lib.
- Create a Visual Studio native project and add main.c; set subsystem to Windows if you want no console.

Build hints (MSVC):
- Link: d3d12.lib dxgi.lib d3dcompiler.lib
- Include: Windows SDK (d3d12.h, dxgi1_4.h, d3dcompiler.h)
