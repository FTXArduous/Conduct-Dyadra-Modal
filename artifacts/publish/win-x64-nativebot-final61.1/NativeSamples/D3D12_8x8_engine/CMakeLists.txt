cmake_minimum_required(VERSION 3.15)
project(D3D12_8x8_engine LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Collect sources
file(GLOB IMGUI_SRCS
	"${CMAKE_CURRENT_SOURCE_DIR}/imgui/*.cpp"
	"${CMAKE_CURRENT_SOURCE_DIR}/imgui/backends/*.cpp"
)

set(SRCS
	"${CMAKE_CURRENT_SOURCE_DIR}/main.c"
	"${CMAKE_CURRENT_SOURCE_DIR}/imgui_wrapper.cpp"
	"${CMAKE_CURRENT_SOURCE_DIR}/fake_imgui.c"
	${IMGUI_SRCS}
)

add_executable(D3D12_8x8_engine WIN32 ${SRCS})

# Ensure the target subsystem is Windows GUI so Visual Studio launches the window and not a console
set_target_properties(D3D12_8x8_engine PROPERTIES LINK_FLAGS "-SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup")

target_include_directories(D3D12_8x8_engine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(D3D12_8x8_engine PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/imgui)

target_link_libraries(D3D12_8x8_engine PRIVATE d3d12 dxgi d3dcompiler)

target_compile_definitions(D3D12_8x8_engine PRIVATE _CRT_SECURE_NO_WARNINGS)

# Compile main.c as C++ now that it contains a coherent Win32 GUI main/menu implementation.
set_source_files_properties("${CMAKE_CURRENT_SOURCE_DIR}/main.c" PROPERTIES LANGUAGE CXX)

# Simple launcher target to provide a runnable GUI while the full native sample is still compiling
add_executable(D3D12_8x8_launcher WIN32 "${CMAKE_CURRENT_SOURCE_DIR}/launcher.cpp")
set_target_properties(D3D12_8x8_launcher PROPERTIES LINK_FLAGS "-SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup")
