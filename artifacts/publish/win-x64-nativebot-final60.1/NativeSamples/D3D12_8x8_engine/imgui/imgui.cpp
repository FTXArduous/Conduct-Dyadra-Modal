#include "imgui.h"
#include <stdio.h>

static ImGui::ImGuiIO g_io = { false, false };

ImGui::ImGuiIO& ImGui::GetIO() { return g_io; }
void ImGui::CreateContext() { }
void ImGui::DestroyContext() { }
void ImGui::StyleColorsDark() { }
void ImGui::NewFrame() { }
void ImGui::Render() { }
ImGui::ImDrawData* ImGui::GetDrawData() { return NULL; }
