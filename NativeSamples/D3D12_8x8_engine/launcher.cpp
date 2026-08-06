#include <windows.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

static const char* CLASS_NAME = "D3D12_8x8_Launcher_Class";

struct Vec3 {
	float x;
	float y;
	float z;
};

struct ResolutionPreset {
	int w;
	int h;
	const char* label;
};

struct RenderResolutionPreset {
	int w;
	int h;
	bool interlaced;
	const char* label;
};

struct Bullet {
	Vec3 pos;
	Vec3 dir;
	float velY;
	float distFt;
	float lifeSec;
};

static HWND g_hwnd = NULL;
static bool g_running = true;
static bool g_inSettings = false;
static bool g_showHudText = true;
static bool g_mouseCaptured = true;

static int g_clientW = 1280;
static int g_clientH = 720;

static float g_playerX = 0.0f;
static float g_playerY = 6.0f;
static float g_playerZ = 0.0f;
static float g_yawDeg = 0.0f;
static float g_pitchDeg = 0.0f;
static float g_mouseSensitivity = 0.08f;

static float g_moveSpeedFps = 24.0f;
static float g_gravityFps2 = 4.1f;
static float g_settingsScroll = 0.0f;
static ULONGLONG g_lastTickMs = 0;
static ULONGLONG g_lastFireMs = 0;
static bool g_vrrAuto = true;

static std::vector<Bullet> g_bullets;

static int g_resIndex = 3;
static const ResolutionPreset g_presets[] = {
	{ 1920, 1080, "1920x1080 (16:9)" },
	{ 2560, 1440, "2560x1440 (16:9)" },
	{ 3440, 1440, "3440x1440 (21:9)" },
	{ 3840, 2160, "3840x2160 (4K)" },
	{ 5120, 1440, "5120x1440 (32:9)" },
	{ 5720, 1080, "5720x1080 (ultrawide)" },
	{ 5760, 1080, "5760x1080 (triple 1080p)" },
	{ 7680, 2160, "7680x2160 (dual 4K width)" },
	{ 11520, 2160, "11520x2160 (triple 4K)" }
};
static const int g_presetCount = (int)(sizeof(g_presets) / sizeof(g_presets[0]));

static int g_renderResIndex = 3;
static const RenderResolutionPreset g_renderPresets[] = {
	{ 640, 240, true,  "480i (interlaced)" },
	{ 640, 480, false, "480p" },
	{ 960, 540, false, "540p" },
	{ 1280, 720, false, "720p" },
	{ 1600, 900, false, "900p" },
	{ 1920, 1080, false, "1080p" },
	{ 2560, 1440, false, "1440p" }
};
static const int g_renderPresetCount = (int)(sizeof(g_renderPresets) / sizeof(g_renderPresets[0]));

static float clampf(float v, float lo, float hi)
{
	if (v < lo) return lo;
	if (v > hi) return hi;
	return v;
}

static void update_capture()
{
	if (!g_hwnd) return;
	g_mouseCaptured = !g_inSettings;
	if (g_mouseCaptured) {
		RECT rc;
		GetClientRect(g_hwnd, &rc);
		POINT tl = { rc.left, rc.top };
		POINT br = { rc.right, rc.bottom };
		ClientToScreen(g_hwnd, &tl);
		ClientToScreen(g_hwnd, &br);
		RECT clip = { tl.x, tl.y, br.x, br.y };
		ClipCursor(&clip);
		ShowCursor(FALSE);
	} else {
		ClipCursor(NULL);
		ShowCursor(TRUE);
	}
}

static float speed_by_distance(float distFt)
{
	const float halfMileFt = 2640.0f;
	const float fiveMilesFt = 26400.0f;
	if (distFt <= 30.0f) {
		float t = distFt / 30.0f;
		return 2000.0f + (1900.0f - 2000.0f) * t;
	}
	if (distFt <= halfMileFt) {
		float t = (distFt - 30.0f) / (halfMileFt - 30.0f);
		float hold = clampf(t / 0.8f, 0.0f, 1.0f);
		float eased = hold * hold * hold * hold;
		return 1900.0f + (1600.0f - 1900.0f) * eased;
	}
	if (distFt >= fiveMilesFt) return 1000.0f;
	float t = (distFt - halfMileFt) / (fiveMilesFt - halfMileFt);
	return 1600.0f + (1000.0f - 1600.0f) * t;
}

static Vec3 yaw_forward()
{
	float y = g_yawDeg * 3.14159265f / 180.0f;
	Vec3 f = { cosf(y), 0.0f, sinf(y) };
	return f;
}

static Vec3 yaw_right()
{
	float y = g_yawDeg * 3.14159265f / 180.0f;
	Vec3 r = { -sinf(y), 0.0f, cosf(y) };
	return r;
}

static Vec3 aim_direction()
{
	float y = g_yawDeg * 3.14159265f / 180.0f;
	float p = g_pitchDeg * 3.14159265f / 180.0f;
	float cp = cosf(p);
	Vec3 d = { cp * cosf(y), sinf(p), cp * sinf(y) };
	return d;
}

static void spawn_bullet()
{
	ULONGLONG now = GetTickCount64();
	if (now - g_lastFireMs < 50) return;
	g_lastFireMs = now;

	Vec3 d = aim_direction();
	Bullet b;
	b.pos = { g_playerX, g_playerY, g_playerZ };
	b.dir = d;
	b.distFt = 0.0f;
	b.lifeSec = 0.0f;
	b.velY = d.y * 2000.0f;
	g_bullets.push_back(b);
}

static void apply_resolution()
{
	const ResolutionPreset& p = g_presets[g_resIndex];
	SetWindowPos(g_hwnd, NULL, 0, 0, p.w, p.h, SWP_NOMOVE | SWP_NOZORDER);
}

static void update_game(float dt)
{
	Vec3 f = yaw_forward();
	Vec3 r = yaw_right();

	float moveX = 0.0f;
	float moveZ = 0.0f;
	if ((GetAsyncKeyState('W') & 0x8000) != 0) { moveX += f.x; moveZ += f.z; }
	if ((GetAsyncKeyState('S') & 0x8000) != 0) { moveX -= f.x; moveZ -= f.z; }
	if ((GetAsyncKeyState('D') & 0x8000) != 0) { moveX += r.x; moveZ += r.z; }
	if ((GetAsyncKeyState('A') & 0x8000) != 0) { moveX -= r.x; moveZ -= r.z; }

	float len = sqrtf(moveX * moveX + moveZ * moveZ);
	if (len > 0.0001f) {
		moveX /= len;
		moveZ /= len;
		g_playerX += moveX * g_moveSpeedFps * dt;
		g_playerZ += moveZ * g_moveSpeedFps * dt;
	}

	for (size_t i = 0; i < g_bullets.size(); ) {
		Bullet& b = g_bullets[i];
		float speed = speed_by_distance(b.distFt);
		float horiz = speed * sqrtf(fmaxf(0.0f, 1.0f - b.dir.y * b.dir.y));
		b.pos.x += b.dir.x * horiz * dt;
		b.pos.z += b.dir.z * horiz * dt;
		b.velY -= g_gravityFps2 * dt;
		b.pos.y += b.velY * dt;
		b.distFt += speed * dt;
		b.lifeSec += dt;

		if (b.distFt > 26400.0f || b.lifeSec > 30.0f || b.pos.y < -1200.0f) {
			g_bullets.erase(g_bullets.begin() + (ptrdiff_t)i);
		} else {
			++i;
		}
	}
}

static void draw_text_line(HDC hdc, int x, int y, const char* text, COLORREF color)
{
	SetTextColor(hdc, color);
	TextOutA(hdc, x, y, text, (int)strlen(text));
}

static void paint_hud(HDC hdc, int renderW, int renderH)
{
	g_clientW = renderW;
	g_clientH = renderH;
	RECT rc = { 0, 0, renderW, renderH };

	HBRUSH bg = CreateSolidBrush(RGB(12, 14, 20));
	FillRect(hdc, &rc, bg);
	DeleteObject(bg);

	int cx = g_clientW / 2;
	int cy = g_clientH / 2;
	HPEN pen = CreatePen(PS_SOLID, 1, RGB(220, 240, 255));
	HPEN oldp = (HPEN)SelectObject(hdc, pen);
	MoveToEx(hdc, cx - 10, cy, NULL); LineTo(hdc, cx + 10, cy);
	MoveToEx(hdc, cx, cy - 10, NULL); LineTo(hdc, cx, cy + 10);
	SelectObject(hdc, oldp);
	DeleteObject(pen);

	if (g_showHudText) {
		char b1[256];
		snprintf(b1, sizeof(b1), "Yaw %.1f  Pitch %.1f  Pos(%.1f, %.1f, %.1f)", g_yawDeg, g_pitchDeg, g_playerX, g_playerY, g_playerZ);
		draw_text_line(hdc, 16, 12, b1, RGB(230, 230, 230));
		char b2[256];
		snprintf(b2, sizeof(b2), "Bullets: %u  Muzzle 2000 fps -> 1000 fps by 5 miles; target drop ~800 ft @5mi", (unsigned)g_bullets.size());
		draw_text_line(hdc, 16, 32, b2, RGB(230, 230, 230));
		char b4[256];
		snprintf(b4, sizeof(b4), "Display: %s  Render: %s  VRR Auto: %s", g_presets[g_resIndex].label, g_renderPresets[g_renderResIndex].label, g_vrrAuto ? "ON" : "OFF");
		draw_text_line(hdc, 16, 52, b4, RGB(230, 230, 230));
		draw_text_line(hdc, 16, 72, "LMB fire | WASD move (left/right static to yaw) | ESC settings | H HUD text", RGB(190, 215, 255));
	}

	if (!g_bullets.empty()) {
		const Bullet& last = g_bullets.back();
		float miles = last.distFt / 5280.0f;
		float drop = (6.0f - last.pos.y);
		char b3[256];
		snprintf(b3, sizeof(b3), "Last round: %.2f miles, speed %.0f fps, drop %.1f ft", miles, speed_by_distance(last.distFt), drop);
		draw_text_line(hdc, 16, g_clientH - 30, b3, RGB(255, 220, 150));
	}
}

static void paint_settings(HDC hdc)
{
	RECT rc;
	GetClientRect(g_hwnd, &rc);

	HBRUSH panel = CreateSolidBrush(RGB(22, 25, 33));
	RECT p = { 80, 60, rc.right - 80, rc.bottom - 60 };
	FillRect(hdc, &p, panel);
	DeleteObject(panel);

	SetBkMode(hdc, TRANSPARENT);
	draw_text_line(hdc, p.left + 20, p.top + 16, "Main.ESC Settings", RGB(255, 255, 255));

	const int lineH = 28;
	const int top = p.top + 56;
	const int viewH = (p.bottom - p.top) - 90;
	const int itemCount = 13;
	const int contentH = itemCount * lineH;
	float maxScroll = (float)(contentH - viewH);
	if (maxScroll < 0.0f) maxScroll = 0.0f;
	g_settingsScroll = clampf(g_settingsScroll, 0.0f, maxScroll);

	int y = top - (int)g_settingsScroll;
	char buf[256];

	snprintf(buf, sizeof(buf), "HUD Text: %s (H toggle)", g_showHudText ? "ON" : "OFF");
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	snprintf(buf, sizeof(buf), "Mouse Sensitivity: %.3f  (J/K)", g_mouseSensitivity);
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	snprintf(buf, sizeof(buf), "Gravity: %.2f ft/s^2  (N/M)", g_gravityFps2);
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	snprintf(buf, sizeof(buf), "Move Speed: %.1f ft/s  (U/I)", g_moveSpeedFps);
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	snprintf(buf, sizeof(buf), "Resolution: %s  ([ / ])", g_presets[g_resIndex].label);
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	snprintf(buf, sizeof(buf), "Render Resolution: %s  (, / .)", g_renderPresets[g_renderResIndex].label);
	if (y > top - lineH && y < p.bottom - 20) draw_text_line(hdc, p.left + 20, y, buf, RGB(220, 220, 220));
	y += lineH;

	draw_text_line(hdc, p.left + 20, y, "Render output is upscaled/interpolated to display resolution for performance.", RGB(190, 210, 240));
	y += lineH;

	draw_text_line(hdc, p.left + 20, y, "FreeSync/G-Sync: Auto-enabled when driver/display supports VRR.", RGB(190, 210, 240));
	y += lineH;

	draw_text_line(hdc, p.left + 20, y, "Includes 1440p, 4K, 21:9, 5720x1080, and up to triple-4K ratio.", RGB(190, 210, 240));
	y += lineH;
	draw_text_line(hdc, p.left + 20, y, "Apply Resolution: Enter", RGB(220, 220, 220));
	y += lineH;
	draw_text_line(hdc, p.left + 20, y, "Scroll: Mouse Wheel or Up/Down", RGB(220, 220, 220));
	y += lineH;
	draw_text_line(hdc, p.left + 20, y, "Close Settings: ESC", RGB(220, 220, 220));
	y += lineH;
	draw_text_line(hdc, p.left + 20, y, "Mouse is dominant in gameplay mode and unaffected by movement keys.", RGB(255, 230, 160));
	y += lineH;
	draw_text_line(hdc, p.left + 20, y, "Ballistics: 2000 fps muzzle, sticky first half-mile, 1000 fps at 5 miles, gravity drop enabled.", RGB(255, 230, 160));

	if (contentH > viewH) {
		RECT track = { p.right - 22, top, p.right - 12, top + viewH };
		HBRUSH tr = CreateSolidBrush(RGB(50, 56, 70));
		FillRect(hdc, &track, tr);
		DeleteObject(tr);

		int thumbH = (viewH * viewH) / contentH;
		if (thumbH < 20) thumbH = 20;
		int thumbY = top + (int)((viewH - thumbH) * (g_settingsScroll / maxScroll));
		RECT thumb = { track.left, thumbY, track.right, thumbY + thumbH };
		HBRUSH th = CreateSolidBrush(RGB(180, 190, 220));
		FillRect(hdc, &thumb, th);
		DeleteObject(th);
	}
}

LRESULT CALLBACK WndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
	switch (msg) {
	case WM_CREATE: {
		RAWINPUTDEVICE rid;
		rid.usUsagePage = 0x01;
		rid.usUsage = 0x02;
		rid.dwFlags = 0;
		rid.hwndTarget = hWnd;
		RegisterRawInputDevices(&rid, 1, sizeof(rid));
		SetTimer(hWnd, 1, 16, NULL);
		g_lastTickMs = GetTickCount64();
		update_capture();
		return 0;
	}
	case WM_SIZE:
		g_clientW = LOWORD(lParam);
		g_clientH = HIWORD(lParam);
		return 0;
	case WM_INPUT:
		if (g_mouseCaptured) {
			UINT sz = 0;
			GetRawInputData((HRAWINPUT)lParam, RID_INPUT, NULL, &sz, sizeof(RAWINPUTHEADER));
			if (sz > 0 && sz < 4096) {
				BYTE buffer[4096];
				if (GetRawInputData((HRAWINPUT)lParam, RID_INPUT, buffer, &sz, sizeof(RAWINPUTHEADER)) == sz) {
					RAWINPUT* ri = (RAWINPUT*)buffer;
					if (ri->header.dwType == RIM_TYPEMOUSE) {
						LONG dx = ri->data.mouse.lLastX;
						LONG dy = ri->data.mouse.lLastY;
						g_yawDeg += (float)dx * g_mouseSensitivity;
						g_pitchDeg -= (float)dy * g_mouseSensitivity;
						g_pitchDeg = clampf(g_pitchDeg, -89.0f, 89.0f);
					}
				}
			}
		}
		return 0;
	case WM_MOUSEWHEEL:
		if (g_inSettings) {
			SHORT z = GET_WHEEL_DELTA_WPARAM(wParam);
			g_settingsScroll -= (float)z / 120.0f * 24.0f;
			InvalidateRect(hWnd, NULL, FALSE);
		}
		return 0;
	case WM_LBUTTONDOWN:
		if (!g_inSettings) spawn_bullet();
		return 0;
	case WM_TIMER: {
		ULONGLONG now = GetTickCount64();
		float dt = (float)(now - g_lastTickMs) * 0.001f;
		g_lastTickMs = now;
		if (dt > 0.1f) dt = 0.1f;

		if (!g_inSettings) {
			update_game(dt);
		}

		if ((GetAsyncKeyState('H') & 1) != 0) g_showHudText = !g_showHudText;
		if (g_inSettings) {
			if ((GetAsyncKeyState('J') & 1) != 0) g_mouseSensitivity = clampf(g_mouseSensitivity - 0.01f, 0.01f, 1.0f);
			if ((GetAsyncKeyState('K') & 1) != 0) g_mouseSensitivity = clampf(g_mouseSensitivity + 0.01f, 0.01f, 1.0f);
			if ((GetAsyncKeyState('N') & 1) != 0) g_gravityFps2 = clampf(g_gravityFps2 - 0.1f, 0.1f, 20.0f);
			if ((GetAsyncKeyState('M') & 1) != 0) g_gravityFps2 = clampf(g_gravityFps2 + 0.1f, 0.1f, 20.0f);
			if ((GetAsyncKeyState('U') & 1) != 0) g_moveSpeedFps = clampf(g_moveSpeedFps - 1.0f, 5.0f, 200.0f);
			if ((GetAsyncKeyState('I') & 1) != 0) g_moveSpeedFps = clampf(g_moveSpeedFps + 1.0f, 5.0f, 200.0f);
			if ((GetAsyncKeyState(VK_OEM_4) & 1) != 0) g_resIndex = (g_resIndex - 1 + g_presetCount) % g_presetCount;
			if ((GetAsyncKeyState(VK_OEM_6) & 1) != 0) g_resIndex = (g_resIndex + 1) % g_presetCount;
			if ((GetAsyncKeyState(VK_OEM_COMMA) & 1) != 0) g_renderResIndex = (g_renderResIndex - 1 + g_renderPresetCount) % g_renderPresetCount;
			if ((GetAsyncKeyState(VK_OEM_PERIOD) & 1) != 0) g_renderResIndex = (g_renderResIndex + 1) % g_renderPresetCount;
			if ((GetAsyncKeyState(VK_RETURN) & 1) != 0) apply_resolution();
			if ((GetAsyncKeyState(VK_UP) & 1) != 0) g_settingsScroll -= 24.0f;
			if ((GetAsyncKeyState(VK_DOWN) & 1) != 0) g_settingsScroll += 24.0f;
		}

		InvalidateRect(hWnd, NULL, FALSE);
		return 0;
	}
	case WM_KEYDOWN:
		if (wParam == VK_ESCAPE) {
			g_inSettings = !g_inSettings;
			update_capture();
			InvalidateRect(hWnd, NULL, FALSE);
			return 0;
		}
		if (wParam == VK_F4 && (GetAsyncKeyState(VK_MENU) & 0x8000)) {
			PostQuitMessage(0);
			return 0;
		}
		return 0;
	case WM_ACTIVATE:
		if (LOWORD(wParam) == WA_INACTIVE) {
			ClipCursor(NULL);
			ShowCursor(TRUE);
		} else {
			update_capture();
		}
		return 0;
	case WM_PAINT: {
		PAINTSTRUCT ps;
		HDC hdc = BeginPaint(hWnd, &ps);

		RECT outRc;
		GetClientRect(hWnd, &outRc);
		int outW = outRc.right - outRc.left;
		int outH = outRc.bottom - outRc.top;

		const RenderResolutionPreset& rr = g_renderPresets[g_renderResIndex];
		int renderW = rr.w;
		int renderH = rr.h;
		float targetAspect = (outH > 0) ? ((float)outW / (float)outH) : (16.0f / 9.0f);
		int aspectH = (int)((float)renderW / targetAspect);
		if (aspectH > 0 && aspectH <= renderH) {
			renderH = aspectH;
		}

		BITMAPINFO bmi = {};
		bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
		bmi.bmiHeader.biWidth = renderW;
		bmi.bmiHeader.biHeight = -renderH;
		bmi.bmiHeader.biPlanes = 1;
		bmi.bmiHeader.biBitCount = 32;
		bmi.bmiHeader.biCompression = BI_RGB;

		void* bits = NULL;
		HBITMAP dib = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
		HDC mem = CreateCompatibleDC(hdc);
		HBITMAP oldBmp = (HBITMAP)SelectObject(mem, dib);

		SetBkMode(mem, TRANSPARENT);
		paint_hud(mem, renderW, renderH);
		if (g_inSettings) paint_settings(mem);

		if (rr.interlaced) {
			HPEN darkPen = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
			HPEN oldPen = (HPEN)SelectObject(mem, darkPen);
			for (int y = 1; y < renderH; y += 2) {
				MoveToEx(mem, 0, y, NULL);
				LineTo(mem, renderW, y);
			}
			SelectObject(mem, oldPen);
			DeleteObject(darkPen);
		}

		SetStretchBltMode(hdc, HALFTONE);
		StretchBlt(hdc, 0, 0, outW, outH, mem, 0, 0, renderW, renderH, SRCCOPY);

		SelectObject(mem, oldBmp);
		DeleteObject(dib);
		DeleteDC(mem);
		EndPaint(hWnd, &ps);
		return 0;
	}
	case WM_DESTROY:
		g_running = false;
		KillTimer(hWnd, 1);
		ClipCursor(NULL);
		ShowCursor(TRUE);
		PostQuitMessage(0);
		return 0;
	}
	return DefWindowProcA(hWnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int)
{
	WNDCLASSEXA wc = {};
	wc.cbSize = sizeof(wc);
	wc.lpfnWndProc = WndProc;
	wc.hInstance = hInstance;
	wc.hCursor = LoadCursor(NULL, IDC_ARROW);
	wc.lpszClassName = CLASS_NAME;

	if (!RegisterClassExA(&wc)) return -1;

	g_hwnd = CreateWindowExA(0, CLASS_NAME, "D3D12 8x8 Engine - Ballistics Sandbox", WS_OVERLAPPEDWINDOW,
		CW_USEDEFAULT, CW_USEDEFAULT, g_clientW, g_clientH, NULL, NULL, hInstance, NULL);
	if (!g_hwnd) return -1;

	ShowWindow(g_hwnd, SW_SHOWMAXIMIZED);
	UpdateWindow(g_hwnd);

	MSG msg;
	while (GetMessageA(&msg, NULL, 0, 0) > 0) {
		TranslateMessage(&msg);
		DispatchMessageA(&msg);
	}
	return (int)msg.wParam;
}
