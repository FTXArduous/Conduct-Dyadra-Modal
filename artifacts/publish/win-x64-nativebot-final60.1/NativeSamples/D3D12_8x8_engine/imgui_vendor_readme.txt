To integrate Dear ImGui into this sample, add the following files into NativeSamples/D3D12_8x8_engine and include them in the Visual Studio project:

Core ImGui:
- imgui/imgui.h
- imgui/imgui.cpp
- imgui/imgui_draw.cpp
- imgui/imgui_widgets.cpp
- imgui/imgui_tables.cpp

Backends (Win32 + DX12):
- imgui/backends/imgui_impl_win32.h
- imgui/backends/imgui_impl_win32.cpp
- imgui/backends/imgui_impl_dx12.h
- imgui/backends/imgui_impl_dx12.cpp

Build notes:
- Add the above .cpp files to the project and compile as C++.
- Define USE_IMGUI in project preprocessor definitions when you want to enable real ImGui integration.
- Link with d3d12.lib and dxgi.lib (already present in the sample).
- Ensure the project is built as a Windows subsystem application (no console) if desired.

Usage:
- The sample will call init_imgui(hwnd, device, srvHeap, rtvDescriptorSize) during initialization. Provide the ID3D12Device* and a shader-visible CBV/SRV heap pointer.
- Call new_frame_imgui() at the start of each frame, then build ImGui UI code and call render_imgui(). The app's render path must call ImGui_ImplDX12_RenderDrawData during command list recording.

This file is a helper; the repo does not include Dear ImGui to avoid licensing and size changes. Copy ImGui sources from the official repository into the indicated paths to enable real ImGui integration.
