// Main menu GUI (6 pages) with left text buttons + 320x180 preview and a right 320x180 preview

#include <windows.h>
#include <winreg.h>
#include <stdint.h>
#include <stdio.h>
#include <math.h>
#include <winhttp.h>
// link WinHTTP lib
#pragma comment(lib, "winhttp.lib")
#include <time.h>
#include <stdarg.h>
#include <wingdi.h>
#pragma comment(lib, "Msimg32.lib")
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")

// GDI+ is used for some drawing placeholders; include and link
#include <gdiplus.h>
#pragma comment(lib, "gdiplus.lib")

// Compatibility layer: define float3 and helper functions used by the renderer.
// The code also contains pv3 helpers later; these float3 helpers mirror those.
typedef struct { float x, y, z; } float3;
static inline float3 f3(float x, float y, float z) { float3 v = { x, y, z }; return v; }
static inline float3 addf3(float3 a, float3 b) { return f3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline float3 mulf3(float3 a, float s) { return f3(a.x * s, a.y * s, a.z * s); }
static inline float lenf3(float3 a) { return sqrtf(a.x*a.x + a.y*a.y + a.z*a.z); }
static inline float3 normalizef3(float3 a) { float L = lenf3(a); if (L == 0.0f) return a; return mulf3(a, 1.0f / L); }
static inline float dotf3(float3 a, float3 b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
static inline float3 reflectf3(float3 v, float3 n) { float d = dotf3(v, n); return f3(v.x - 2.0f*d*n.x, v.y - 2.0f*d*n.y, v.z - 2.0f*d*n.z); }


// IDs
#define IDC_LINK1  1001
#define IDC_LINK2  1002
#define IDC_LINK3  1003
#define IDC_PREV_L 1201
#define IDC_LABEL  1300
#define IDC_BTN_BACK 1401
#define IDC_BTN_NEXT 1402
#define IDC_BTN_FIND 1403
// weapon selection
#define IDC_WEAP1 1501
#define IDC_WEAP2 1502
#define IDC_WEAP3 1503

enum PageId { PAGE_HOME = 1, PAGE_PLAY, PAGE_MATCHMAKING, PAGE_SETTINGS, PAGE_ABOUT, PAGE_EXTRAS, PAGE_DIAGNOSTICS };
static int g_page = PAGE_HOME;

// UI objects
static HFONT g_fontAndroidLarge = NULL;
static HWND g_btnBack = NULL;
static HWND g_btnNext = NULL;
static HWND g_btnFind = NULL;

// Preview buffer (single 320x180 RGBA)
static const int PREW = 320, PREH = 180;
static BITMAPINFO g_bmi;
static void *g_previewPixels = NULL;
static HANDLE g_previewThread = NULL;
static volatile LONG g_previewReady = 0;
static volatile LONG g_framesProduced = 0;
static int g_displayFps = 0;
static volatile LONG g_use_soft_rtx = 0;
static float *g_accumBuffer = NULL; // RGB float accumulation buffer
static int g_accumPass = 0; // number of accumulation passes (clamped to 200)
static volatile LONG g_using_private_dx = 0; // 0 = unknown/system, 1 = private
static CRITICAL_SECTION g_diagCS;
static char g_diagLines[16][192];
static int g_diagNext = 0;

static void diag_log(const char *fmt, ...)
{
	va_list ap;
	EnterCriticalSection(&g_diagCS);
	int idx = g_diagNext % 16;
	g_diagNext++;
	va_start(ap, fmt);
	vsnprintf(g_diagLines[idx], sizeof(g_diagLines[idx]), fmt, ap);
	va_end(ap);
	LeaveCriticalSection(&g_diagCS);
}

static int g_splashPhase = 0;
static HFONT g_splashFont = NULL;
static HBITMAP g_splashBgBitmap = NULL;
static int g_splashBgW = 320;
static int g_splashBgH = 180;
static float sceneSDF(float3 p, int *matOut);
// Render a simple ray-marched glass pipes scene into a 32-bit RGBA buffer
static void render_splash_bitmap(int W, int H, unsigned char *pixels)
{
	// camera
	float fov = 45.0f * (3.14159265f/180.0f);
	float aspect = (float)W / (float)H;
	for (int y = 0; y < H; ++y) {
		for (int x = 0; x < W; ++x) {
			float nx = (2.0f * (x + 0.5f) / (float)W - 1.0f) * aspect * tanf(fov*0.5f);
			float ny = (1.0f - 2.0f * (y + 0.5f) / (float)H) * tanf(fov*0.5f);
			// ray origin and dir
			float3 ro = f3(0.0f, 0.0f, -5.0f);
			float3 rd = normalizef3(f3(nx, ny, 1.0f));

			float t = 0.0f; int hit = 0; float glow = 0.0f;
			float3 col = f3(0.02f, 0.04f, 0.08f);
			for (int iter = 0; iter < 120; ++iter) {
				float3 p = addf3(ro, mulf3(rd, t));
				// sample a few rounded tubes (pipes)
				float3 q = p; q.x -= 1.2f; float d1 = lenf3(f3(q.x, q.y, q.z)) - 0.5f;
				q = p; q.x += 1.2f; float d2 = lenf3(f3(q.x, q.y, q.z)) - 0.5f;
				q = p; q.y += 0.9f; float d3 = lenf3(f3(q.x*0.5f, q.y, q.z)) - 0.6f;
				float d = fminf(fminf(d1,d2), d3);
				if (d < 0.001f) { hit = 1; break; }
				t += d * 0.8f;
				if (t > 40.0f) break;
			}
			if (hit) {
				// simple reflection approximation: reflect ray around normal estimated by gradient
				float3 p = addf3(ro, mulf3(rd, t));
				const float eps = 1e-3f;
				float3 nxp = f3(p.x+eps, p.y, p.z);
				float3 nxm = f3(p.x-eps, p.y, p.z);
				float nxv = (sceneSDF(nxp, NULL) - sceneSDF(nxm, NULL));
				float3 n = normalizef3(f3(nxv, 0.0f, 0.0f));
				float3 refl = reflectf3(rd, n);
				float spec = fmaxf(0.0f, dotf3(refl, f3(0,0,1)));
				col = f3(0.6f + spec*0.6f, 0.7f + spec*0.4f, 0.85f + spec*0.3f);
				glow = 0.6f;
			}
			// add soft vignette and background gradient
			float vx = (float)x/W - 0.5f; float vy = (float)y/H - 0.5f; float vign = 1.0f - (vx*vx+vy*vy)*0.9f;
			col = mulf3(col, vign);
			// convert to 0-255
			int idx = (y*W + x) * 4;
			pixels[idx+0] = (unsigned char)(fminf(1.0f, col.x + glow*0.3f) * 255.0f);
			pixels[idx+1] = (unsigned char)(fminf(1.0f, col.y + glow*0.25f) * 255.0f);
			pixels[idx+2] = (unsigned char)(fminf(1.0f, col.z + glow*0.2f) * 255.0f);
			pixels[idx+3] = 255;
		}
	}
}

LRESULT CALLBACK SplashWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
	switch (msg) {
	case WM_CREATE:
		g_splashPhase = 0;
		g_splashFont = CreateFontA(48,0,0,0,FW_BOLD,FALSE,FALSE,FALSE,ANSI_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,DEFAULT_QUALITY, DEFAULT_PITCH|FF_DONTCARE, "Segoe UI");
		SetTimer(hwnd, 101, 30, NULL);
		return 0;
	case WM_TIMER:
		if (wParam == 101) { g_splashPhase = (g_splashPhase + 1) & 1023; InvalidateRect(hwnd, NULL, FALSE); }
		return 0;
	case WM_PAINT: {
		PAINTSTRUCT ps; HDC hdc = BeginPaint(hwnd, &ps);
		RECT rc; GetClientRect(hwnd, &rc);
		int w = rc.right - rc.left; int h = rc.bottom - rc.top;
		// cached ray-marched background (generated once at lower resolution and stretched)
		if (!g_splashBgBitmap) {
			BITMAPINFO sbmi = {0};
			sbmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
			sbmi.bmiHeader.biWidth = g_splashBgW;
			sbmi.bmiHeader.biHeight = -g_splashBgH;
			sbmi.bmiHeader.biPlanes = 1;
			sbmi.bmiHeader.biBitCount = 32;
			sbmi.bmiHeader.biCompression = BI_RGB;
			void *sbits = NULL;
			HDC tmp = CreateCompatibleDC(hdc);
			g_splashBgBitmap = CreateDIBSection(tmp, &sbmi, DIB_RGB_COLORS, &sbits, NULL, 0);
			if (g_splashBgBitmap && sbits) {
				render_splash_bitmap(g_splashBgW, g_splashBgH, (unsigned char*)sbits);
			}
			DeleteDC(tmp);
		}
		if (g_splashBgBitmap) {
			HDC bgdc = CreateCompatibleDC(hdc);
			HBITMAP oldbg = (HBITMAP)SelectObject(bgdc, g_splashBgBitmap);
			SetStretchBltMode(hdc, HALFTONE);
			StretchBlt(hdc, 0, 0, w, h, bgdc, 0, 0, g_splashBgW, g_splashBgH, SRCCOPY);
			SelectObject(bgdc, oldbg);
			DeleteDC(bgdc);
		} else {
			// vertical gradient background fallback
			for (int y=0;y<h;y++) {
				float t = (float)y / (float)h;
				int r = (int)((1.0f-t)*12 + t*28);
				int g = (int)((1.0f-t)*18 + t*8);
				int b = (int)((1.0f-t)*40 + t*68);
				HBRUSH br = CreateSolidBrush(RGB(r,g,b));
				RECT lr = {rc.left, rc.top + y, rc.right, rc.top + y + 1};
				FillRect(hdc, &lr, br);
				DeleteObject(br);
			}
		}

		// draw decorative 'glass pipes' as translucent ellipses (approximation)
		for (int i=0;i<5;i++) {
			int cx = w/2 + (int)(sinf((g_splashPhase*0.01f)+(i*0.9f))* (w*0.25f));
			int cy = h/2 + (int)(cosf((g_splashPhase*0.013f)+(i*1.1f))*(h*0.08f)) - 10*i;
			int rw = w/3 - i*24; int rh = h/3 - i*10;
			HBRUSH br = CreateSolidBrush(RGB(160 - i*12, 180 - i*10, 220 - i*8));
			HBRUSH old = (HBRUSH)SelectObject(hdc, br);
			SetBkMode(hdc, TRANSPARENT);
			// draw filled ellipse
			Ellipse(hdc, cx - rw, cy - rh, cx + rw, cy + rh);
			SelectObject(hdc, old); DeleteObject(br);
			// highlight arc
			HPEN pen = CreatePen(PS_SOLID, 2, RGB(220,230,255));
			HPEN op = (HPEN)SelectObject(hdc, pen);
			Arc(hdc, cx - rw, cy - rh, cx + rw, cy + rh, cx, cy - rh, cx + rw, cy);
			SelectObject(hdc, op); DeleteObject(pen);
		}

		// Draw animated title with glow: render text into 32-bit DIB then alpha-blend highlight
		HDC mem = CreateCompatibleDC(hdc);
		BITMAPINFO bmi = {0}; bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER); bmi.bmiHeader.biWidth = w; bmi.bmiHeader.biHeight = -h; bmi.bmiHeader.biPlanes = 1; bmi.bmiHeader.biBitCount = 32; bmi.bmiHeader.biCompression = BI_RGB;
		void *bits = NULL; HBITMAP hb = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
		HBITMAP oldb = (HBITMAP)SelectObject(mem, hb);
		// fill transparent
		Gdiplus::Rect rgn; // placeholder to avoid warnings
		// clear
		memset(bits, 0, w * h * 4);
		SetTextColor(mem, RGB(255,255,255)); SetBkMode(mem, TRANSPARENT);
		HFONT oldf = (HFONT)SelectObject(mem, g_splashFont);
		RECT tr = {0, h/2 - 40, w, h/2 + 40};
		DrawTextA(mem, "Mech-Dusk Engine", -1, &tr, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
		SelectObject(mem, oldf);

		// alpha-blend the mem onto main hdc with varying alpha and a moving highlight
		BLENDFUNCTION bf = {AC_SRC_OVER, 0, 255, 0};
		AlphaBlend(hdc, w/2 - w/3, h/2 - 48, w*2/3, 96, mem, 0, 0, w, h, bf);

		// moving highlight: small white gradient bitmap
		int hlW = w/4; int hlH = 32; HBITMAP hhl = CreateDIBSection(mem, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
		// reuse bits
		memset(bits, 0, w * h * 4);
		// draw white rectangle, we'll alpha blend partial by adjusting global alpha
		HBRUSH hwb = CreateSolidBrush(RGB(255,255,255)); HBRUSH oh = (HBRUSH)SelectObject(mem, hwb);
		RECT hrct = {0, h/2 - hlH/2, hlW, h/2 + hlH/2}; FillRect(mem, &hrct, hwb); SelectObject(mem, oh); DeleteObject(hwb);
		int pos = (g_splashPhase * 3) % (w + hlW) - hlW;
		bf.SourceConstantAlpha = 120; AlphaBlend(hdc, pos, h/2 - hlH/2, hlW, hlH, mem, 0, 0, w, h, bf);
		DeleteObject(hhl);

		SelectObject(mem, oldb); DeleteObject(hb); DeleteDC(mem);

		EndPaint(hwnd, &ps);
		return 0; }
	case WM_DESTROY:
		KillTimer(hwnd, 101);
		if (g_splashBgBitmap) { DeleteObject(g_splashBgBitmap); g_splashBgBitmap = NULL; }
		if (g_splashFont) { DeleteObject(g_splashFont); g_splashFont = NULL; }
		return 0;
	}
	return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// forward declare init_dxr (defined later)
static bool init_dxr();

static void reset_accumulation()
{
	if (!g_accumBuffer) return;
	int px = PREW * PREH;
	for (int i = 0; i < px * 3; ++i) g_accumBuffer[i] = 0.0f;
	g_accumPass = 0;
}

// Minimal GPU-style render pass abstraction (stub)
typedef struct RenderPass {
	const char *name;
	int enabled;
	// In a real implementation this would hold pipeline state, descriptors, shaders, etc.
} RenderPass;

static RenderPass g_renderPasses[] = {
	{ "GBuffer", 1 },
	{ "Lighting", 1 },
	{ "PostProcess", 1 },
};
static const int g_renderPassCount = (int)(sizeof(g_renderPasses)/sizeof(g_renderPasses[0]));

static void init_gpu_passes()
{
	// Placeholder: set up GPU pipelines, descriptor heaps, and frame resources for each pass.
	// Implementations should create D3D12 pipeline state objects, root signatures, and resources here.
	for (int i = 0; i < g_renderPassCount; ++i) {
		// mark enabled by default; real setup happens when integrating the GPU renderer
		g_renderPasses[i].enabled = 1;
	}
}

// Matchmaking
static volatile LONG g_matchmakingActive = 0;
static volatile double g_matchmakingProgress = 0.0;
static volatile LONG g_pulseState = 0;
static volatile LONG g_connectionChecked = 0;
static volatile LONG g_connectionOk = 0;
static volatile LONG g_connectionTimeouted = 0;
static LARGE_INTEGER g_connStart = {0};
static char g_connectionHost[128] = "example.com";
static int g_weaponSel = 0; // 0 = none, 1..3 weapon choices

static double PerfSecondsDifference(LARGE_INTEGER a, LARGE_INTEGER b) { LARGE_INTEGER freq; QueryPerformanceFrequency(&freq); return (double)(a.QuadPart - b.QuadPart) / (double)freq.QuadPart; }

// minimal float3 helpers for preview renderer (avoid conflicts)
typedef struct { float x,y,z; } pv3;
static inline pv3 pv3v(float x,float y,float z){ pv3 v={x,y,z}; return v; }
static inline pv3 pv3add(pv3 a,pv3 b){ return pv3v(a.x+b.x,a.y+b.y,a.z+b.z); }
static inline pv3 pv3mul(pv3 a,float s){ return pv3v(a.x*s,a.y*s,a.z*s); }
static inline float pv3dot(pv3 a,pv3 b){ return a.x*b.x + a.y*b.y + a.z*b.z; }
static inline float pv3len(pv3 a){ return sqrtf(pv3dot(a,a)); }
static inline pv3 pv3norm(pv3 a){ float L=pv3len(a); if(L==0) return a; return pv3mul(a,1.0f/L); }
static inline pv3 pv3reflect(pv3 v, pv3 n){ float d = pv3dot(v,n); return pv3v(v.x - 2.0f*d*n.x, v.y - 2.0f*d*n.y, v.z - 2.0f*d*n.z); }

// forward declarations for SDFs so scene helpers can call them
static float sdStarExtrudeLocal(float x, float y, float z);
static float sdCappedCylinderLocal(float x, float y, float z);

static float pv_sceneSDF_noMat(pv3 p)
{
	float dStar = sdStarExtrudeLocal(p.x, p.y, p.z);
	float dCyl = sdCappedCylinderLocal(p.x - 2.5f, p.y, p.z);
	return (dStar < dCyl) ? dStar : dCyl;
}

// sceneSDF: wrapper used by parts of the renderer that expect a float3-based API.
// Returns distance to scene geometry and optionally sets a material index via matOut.
static float sceneSDF(float3 p, int *matOut)
{
	// Convert float3 to pv3 and call the existing scene SDF helper
	pv3 pv = pv3v(p.x, p.y, p.z);
	float d = pv_sceneSDF_noMat(pv);
	if (matOut) *matOut = 0; // default material
	return d;
}

// non-blocking connection check with 6 second timeout
DWORD WINAPI connection_check_thread(LPVOID param)
{
	// Use WinHTTP to perform a quick HEAD request to the configured host with 6s timeout
	HINTERNET hSession = WinHttpOpen(L"CBG-ConnCheck/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
	if (!hSession) { InterlockedExchange(&g_connectionChecked,1); InterlockedExchange(&g_connectionOk,0); return 0; }

	// build URL L"http://host/"
	wchar_t hostw[256] = {0}; MultiByteToWideChar(CP_UTF8, 0, g_connectionHost, -1, hostw, (int)ARRAYSIZE(hostw));
	HINTERNET hConnect = WinHttpConnect(hSession, hostw, 80, 0);
	if (!hConnect) { WinHttpCloseHandle(hSession); InterlockedExchange(&g_connectionChecked,1); InterlockedExchange(&g_connectionOk,0); return 0; }

	HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"HEAD", L"/", NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
	if (!hRequest) { WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); InterlockedExchange(&g_connectionChecked,1); InterlockedExchange(&g_connectionOk,0); return 0; }

	// set timeouts (6000 ms)
	WinHttpSetTimeouts(hRequest, 6000, 6000, 6000, 6000);
	BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
	if (!ok) { WinHttpCloseHandle(hRequest); WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession); InterlockedExchange(&g_connectionChecked,1); InterlockedExchange(&g_connectionOk,0); return 0; }

	ok = WinHttpReceiveResponse(hRequest, NULL);
	if (ok) InterlockedExchange(&g_connectionOk, 1); else InterlockedExchange(&g_connectionOk, 0);
	InterlockedExchange(&g_connectionChecked, 1);

	WinHttpCloseHandle(hRequest);
	WinHttpCloseHandle(hConnect);
	WinHttpCloseHandle(hSession);
	return 0;
}

DWORD WINAPI matchmaking_thread(LPVOID param)
{
	InterlockedExchange(&g_matchmakingActive, 1);
	for (int i = 0; i < 100 && g_matchmakingActive; ++i) {
		g_matchmakingProgress = (i+1) / 100.0;
		Sleep(50);
	}
	InterlockedExchange(&g_matchmakingActive, 0);
	return 0;
}

static pv3 pv_estimateNormal(pv3 p)
{
	const float eps = 1e-3f;
	float dx = pv_sceneSDF_noMat(pv3v(p.x+eps, p.y, p.z)) - pv_sceneSDF_noMat(pv3v(p.x-eps, p.y, p.z));
	float dy = pv_sceneSDF_noMat(pv3v(p.x, p.y+eps, p.z)) - pv_sceneSDF_noMat(pv3v(p.x, p.y-eps, p.z));
	float dz = pv_sceneSDF_noMat(pv3v(p.x, p.y, p.z+eps)) - pv_sceneSDF_noMat(pv3v(p.x, p.y, p.z-eps));
	return pv3norm(pv3v(dx, dy, dz));
}

static float sdStarExtrudeLocal(float x, float y, float z)
{
	float r = sqrtf(x*x + z*z);
	float theta = atan2f(z, x);
	float r0 = 1.0f * (1.0f + 0.35f * sinf(16.0f * theta));
	float d2 = r - r0;
	float dy = fabsf(y) - 0.25f;
	if (d2>0 && dy>0) return sqrtf(d2*d2 + dy*dy);
	return fmaxf(d2, dy);
}
static float sdCappedCylinderLocal(float x, float y, float z)
{
	float d = sqrtf(x*x + z*z) - 0.7f;
	float dy = fabsf(y) - 1.2f;
	if (d>0 && dy>0) return sqrtf(d*d + dy*dy);
	return fmaxf(d, dy);
}

// CPU preview renderer (raymarch simple) runs at logical 1200 Hz
DWORD WINAPI preview_thread_fn(LPVOID param)
{
	LARGE_INTEGER freq_li; QueryPerformanceFrequency(&freq_li);
	LARGE_INTEGER start; QueryPerformanceCounter(&start);
	LONGLONG periodTicks = (LONGLONG)(freq_li.QuadPart / 1200.0);
	LONGLONG nextTick = start.QuadPart;

	int frames = 0; LARGE_INTEGER lastFPS; QueryPerformanceCounter(&lastFPS);

	// camera setup: 12 feet away ~ 3.658 meters; units arbitrary
	const float camDist = 3.658f;

	while (InterlockedCompareExchange(&g_previewReady, 0, 0) != -1) {
		// render into g_previewPixels
			if (g_previewPixels) {
				uint8_t *dst = (uint8_t*)g_previewPixels;
				int useSoft = InterlockedCompareExchange(&g_use_soft_rtx, 0, 0);
				if (useSoft && g_accumBuffer) {
					int passNow = g_accumPass;
					int canAccumulate = (passNow < 200);
					int denom = canAccumulate ? (passNow + 1) : 200;
					for (int y = 0; y < PREH; ++y) {
						for (int x = 0; x < PREW; ++x) {
							uint32_t h = (uint32_t)(x * 1973 + y * 9277 + (passNow + 1) * 26699);
							h ^= (h << 13); h ^= (h >> 17); h ^= (h << 5);
							float jx = (((h & 1023u) / 1023.0f) - 0.5f) / (float)PREW;
							float jy = ((((h >> 10) & 1023u) / 1023.0f) - 0.5f) / (float)PREH;
							float u = (2.0f * (x + 0.5f + jx) / (float)PREW - 1.0f) * (float)PREW / (float)PREH;
							float v = (1.0f - 2.0f * (y + 0.5f + jy) / (float)PREH);
							pv3 ro = pv3v(0.0f, 0.0f, -camDist);
							pv3 rd = pv3norm(pv3v(u*0.5f, v*0.5f, 1.0f));

							float t = 0.0f; int hit = 0; float dist = 0.0f;
							for (int steps=0; steps<120; ++steps) {
								float px = ro.x + rd.x * t;
								float py = ro.y + rd.y * t;
								float pz = ro.z + rd.z * t;
								float dStar = sdStarExtrudeLocal(px, py, pz);
								float dCyl = sdCappedCylinderLocal(px - 2.5f, py, pz);
								dist = (dStar < dCyl) ? dStar : dCyl;
								if (dist < 0.001f) { hit = (dStar<dCyl)?1:2; break; }
								t += dist;
								if (t > 50000.0f) break;
							}
							pv3 color = pv3v(0.08f, 0.12f, 0.2f);
							if (hit) {
								pv3 pos = pv3v(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t);
								pv3 n = pv_estimateNormal(pos);
								pv3 light = pv3norm(pv3v(1000.0f,2000.0f,-500.0f));
								float diff = fmaxf(0.0f, pv3dot(n, light));
								pv3 view = pv3norm(pv3v(-rd.x, -rd.y, -rd.z));
								pv3 refl = pv3reflect(pv3v(-rd.x, -rd.y, -rd.z), n);
								float spec = powf(fmaxf(0.0f, pv3dot(refl, view)), 32.0f) * 0.8f;
								if (hit==1) color = pv3add(pv3mul(pv3v(1.0f,0.9f,0.4f),0.1f), pv3mul(pv3v(1.0f,0.9f,0.4f), diff*0.9f));
								else color = pv3add(pv3mul(pv3v(0.2f,0.4f,0.9f),0.1f), pv3mul(pv3v(0.2f,0.4f,0.9f), diff*0.9f));
								color = pv3add(color, pv3mul(pv3v(1.0f,1.0f,1.0f), spec));
							}
							if ((h & 2047u) == 0u) {
								color = pv3add(color, pv3v(2.0f, 1.8f, 1.4f));
							}
							int pidx = y * PREW + x;
							int idx3 = pidx * 3;
							if (canAccumulate) {
								g_accumBuffer[idx3+0] += color.x;
								g_accumBuffer[idx3+1] += color.y;
								g_accumBuffer[idx3+2] += color.z;
							}
							float avx = g_accumBuffer[idx3+0] / (float)denom;
							float avy = g_accumBuffer[idx3+1] / (float)denom;
							float avz = g_accumBuffer[idx3+2] / (float)denom;
							int idx = pidx * 4;
							dst[idx+0] = (uint8_t)(fminf(1.0f, avx) * 255.0f);
							dst[idx+1] = (uint8_t)(fminf(1.0f, avy) * 255.0f);
							dst[idx+2] = (uint8_t)(fminf(1.0f, avz) * 255.0f);
							dst[idx+3] = 255;
						}
					}
					if (canAccumulate) ++g_accumPass;
				} else {
					for (int y = 0; y < PREH; ++y) {
						for (int x = 0; x < PREW; ++x) {
							float u = (2.0f * (x + 0.5f) / (float)PREW - 1.0f) * (float)PREW / (float)PREH;
							float v = (1.0f - 2.0f * (y + 0.5f) / (float)PREH);
							pv3 ro = pv3v(0.0f, 0.0f, -camDist);
							pv3 rd = pv3norm(pv3v(u*0.5f, v*0.5f, 1.0f));

							float t = 0.0f; int hit = 0; float dist = 0.0f;
							for (int steps=0; steps<120; ++steps) {
								float px = ro.x + rd.x * t;
								float py = ro.y + rd.y * t;
								float pz = ro.z + rd.z * t;
								float dStar = sdStarExtrudeLocal(px, py, pz);
								float dCyl = sdCappedCylinderLocal(px - 2.5f, py, pz);
								dist = (dStar < dCyl) ? dStar : dCyl;
								if (dist < 0.001f) { hit = (dStar<dCyl)?1:2; break; }
								t += dist;
								if (t > 50000.0f) break;
							}
							pv3 color = pv3v(0.08f, 0.12f, 0.2f);
							if (hit) {
								pv3 pos = pv3v(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t);
								pv3 n = pv_estimateNormal(pos);
								pv3 light = pv3norm(pv3v(1000.0f,2000.0f,-500.0f));
								float diff = fmaxf(0.0f, pv3dot(n, light));
								// simple Blinn-Phong/reflective specular
								pv3 view = pv3norm(pv3v(-rd.x, -rd.y, -rd.z));
								pv3 refl = pv3reflect(pv3v(-rd.x, -rd.y, -rd.z), n);
								float spec = powf(fmaxf(0.0f, pv3dot(refl, view)), 32.0f) * 0.8f;
								if (hit==1) color = pv3add(pv3mul(pv3v(1.0f,0.9f,0.4f),0.1f), pv3mul(pv3v(1.0f,0.9f,0.4f), diff*0.9f));
								else color = pv3add(pv3mul(pv3v(0.2f,0.4f,0.9f),0.1f), pv3mul(pv3v(0.2f,0.4f,0.9f), diff*0.9f));
								// add specular highlight
								color = pv3add(color, pv3mul(pv3v(1.0f,1.0f,1.0f), spec));
							}
							int idx = (y*PREW + x) * 4;
							dst[idx+0] = (uint8_t)(fminf(1.0f, color.x) * 255.0f);
							dst[idx+1] = (uint8_t)(fminf(1.0f, color.y) * 255.0f);
							dst[idx+2] = (uint8_t)(fminf(1.0f, color.z) * 255.0f);
							dst[idx+3] = 255;
						}
					}
				}
				InterlockedIncrement(&g_framesProduced);
			}

		// fps calculation
		++frames;
		LARGE_INTEGER now; QueryPerformanceCounter(&now);
		if (PerfSecondsDifference(now, lastFPS) >= 1.0) {
			g_displayFps = frames;
			frames = 0; lastFPS = now;
		}

		// wait until next frame (busy wait with Sleep(0))
		nextTick += periodTicks;
		for (;;) { QueryPerformanceCounter(&now); if (now.QuadPart >= nextTick) break; Sleep(0); }
	}
	return 0;
}

static void DrawPreview(HDC hdc, RECT rc, const char *title, COLORREF bg, const char *objA, const char *objB)
{
	HBRUSH br = CreateSolidBrush(bg);
	FillRect(hdc, &rc, br);
	DeleteObject(br);
	SetTextColor(hdc, RGB(255,255,255));
	SetBkMode(hdc, TRANSPARENT);
	RECT tr = rc; tr.top += 4; tr.left += 4; tr.right -= 4; tr.bottom = tr.top + 18;
	DrawTextA(hdc, title, -1, &tr, DT_SINGLELINE|DT_LEFT|DT_VCENTER);
	// draw two object labels at lower area
	RECT or1 = rc; or1.top = rc.top + (rc.bottom-rc.top)/2 - 10; or1.left += 8; or1.right = or1.left + 140; or1.bottom = or1.top + 20;
	RECT or2 = or1; or2.top += 22; or2.bottom += 22;
	DrawTextA(hdc, objA, -1, &or1, DT_SINGLELINE|DT_LEFT|DT_VCENTER);
	DrawTextA(hdc, objB, -1, &or2, DT_SINGLELINE|DT_LEFT|DT_VCENTER);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
	switch (msg) {
	case WM_TIMER: {
		if (wParam == 1) {
			// pulse state for matchmaking text
			if (g_matchmakingActive) {
				g_pulseState = (g_pulseState + 1) & 7;
				// if matchmaking progress still zero, tick it slowly
				if (g_matchmakingProgress < 0.999) g_matchmakingProgress += 0.005;
			}

			// connection check timeout: if not checked within 6 seconds, mark failed
			if (InterlockedCompareExchange(&g_connectionChecked, 0, 0) == 0) {
				LARGE_INTEGER now; QueryPerformanceCounter(&now);
				if (PerfSecondsDifference(now, g_connStart) >= 6.0) {
					InterlockedExchange(&g_connectionTimeouted, 1);
					InterlockedExchange(&g_connectionChecked, 1);
					InterlockedExchange(&g_connectionOk, 0);
				}
			}
			InvalidateRect(hwnd, NULL, FALSE);
		}
		return 0; }

	case WM_CREATE: {
		// create a large Android-like font (68px equivalent)
		g_fontAndroidLarge = CreateFontA(68, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, ANSI_CHARSET,
			OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_DONTCARE, "Segoe UI");

		// Left column: three text-style buttons (Link style)
		CreateWindowA("BUTTON", "Enter Conflict", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 10, 10, 220, 48, hwnd, (HMENU)IDC_LINK1, NULL, NULL);
		CreateWindowA("BUTTON", "Settings", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 10, 70, 220, 48, hwnd, (HMENU)IDC_LINK2, NULL, NULL);
		CreateWindowA("BUTTON", "Operations", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 10, 130, 220, 48, hwnd, (HMENU)IDC_LINK3, NULL, NULL);

		// Back and Next buttons for flow
		g_btnBack = CreateWindowA("BUTTON", "Back", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 10, 540, 100, 36, hwnd, (HMENU)IDC_BTN_BACK, NULL, NULL);
		g_btnNext = CreateWindowA("BUTTON", "Next", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 120, 540, 100, 36, hwnd, (HMENU)IDC_BTN_NEXT, NULL, NULL);

		// Find Match button (created when on matchmaking page)
		g_btnFind = CreateWindowA("BUTTON", "Find Match", WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON, 200, 260, 160, 48, hwnd, (HMENU)IDC_BTN_FIND, NULL, NULL);

		// Weapon selection radio buttons (visible on PAGE_PLAY)
		CreateWindowA("BUTTON", "Weapon: Photon", WS_CHILD|WS_VISIBLE|BS_AUTORADIOBUTTON, 10, 200, 220, 28, hwnd, (HMENU)IDC_WEAP1, NULL, NULL);
		CreateWindowA("BUTTON", "Weapon: Railgun", WS_CHILD|WS_VISIBLE|BS_AUTORADIOBUTTON, 10, 232, 220, 28, hwnd, (HMENU)IDC_WEAP2, NULL, NULL);
		CreateWindowA("BUTTON", "Weapon: Plasma", WS_CHILD|WS_VISIBLE|BS_AUTORADIOBUTTON, 10, 264, 220, 28, hwnd, (HMENU)IDC_WEAP3, NULL, NULL);

		// Preview area (single 320x180)
		CreateWindowA("STATIC", NULL, WS_CHILD|WS_VISIBLE|SS_BLACKRECT, 250, 10, PREW, PREH, hwnd, (HMENU)IDC_PREV_L, NULL, NULL);
		CreateWindowA("STATIC", "", WS_CHILD|WS_VISIBLE|SS_LEFT, 250, 200, 760, 22, hwnd, (HMENU)IDC_LABEL, NULL, NULL);

		// allocate preview pixels
		g_bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
		g_bmi.bmiHeader.biWidth = PREW;
		g_bmi.bmiHeader.biHeight = -PREH; // top-down
		g_bmi.bmiHeader.biPlanes = 1;
		g_bmi.bmiHeader.biBitCount = 32;
		g_bmi.bmiHeader.biCompression = BI_RGB;
		g_previewPixels = malloc(PREW * PREH * 4);
		memset(g_previewPixels, 0, PREW * PREH * 4);
		g_accumBuffer = (float*)malloc((size_t)PREW * (size_t)PREH * 3u * sizeof(float));
		if (g_accumBuffer) {
			reset_accumulation();
			InterlockedExchange(&g_use_soft_rtx, 1);
		} else {
			InterlockedExchange(&g_use_soft_rtx, 0);
		}

		// start preview thread
		InterlockedExchange(&g_previewReady, 1);
		g_previewThread = CreateThread(NULL, 0, preview_thread_fn, NULL, 0, NULL);

		// init diagnostics
		InitializeCriticalSection(&g_diagCS);
		diag_log("App startup");

		// initialize GPU-style render passes (stub)
		init_gpu_passes();

		// seed RNG for soft-RTX random flakes
		srand((unsigned)time(NULL));

		// allocate accumulation buffer for soft fallback
		g_accumBuffer = (float*)malloc(sizeof(float) * PREW * PREH * 3);
		if (g_accumBuffer) memset(g_accumBuffer, 0, sizeof(float) * PREW * PREH * 3);
		reset_accumulation();

		// DXR detection happens later during D3D12 initialization in main()

		// start a 60Hz UI timer for downsampled updates and FPS display
		SetTimer(hwnd, 1, 1000/60, NULL);

		// start connection check thread but don't block UI; track start time
		QueryPerformanceCounter(&g_connStart);
		CreateThread(NULL, 0, connection_check_thread, NULL, 0, NULL);

		// initial visibility
		ShowWindow(g_btnFind, SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP1), SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP2), SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP3), SW_HIDE);

		return 0; }

	case WM_COMMAND: {
		int id = LOWORD(wParam);
		if (id == IDC_LINK1) { g_page = PAGE_PLAY; }
		else if (id == IDC_LINK2) { g_page = PAGE_SETTINGS; }
		else if (id == IDC_LINK3) { g_page = PAGE_EXTRAS; }
		else if (id == IDC_BTN_BACK) { g_page = PAGE_HOME; }
		else if (id == IDC_BTN_NEXT) { if (g_page == PAGE_PLAY) g_page = PAGE_MATCHMAKING; else g_page = PAGE_SETTINGS; }
		else if (id == IDC_BTN_FIND) {
			if (g_matchmakingActive==0) {
				g_matchmakingProgress = 0.0;
				if (!CreateThread(NULL, 0, matchmaking_thread, NULL, 0, NULL)) {
					// failed to create thread, fallback to UI-driven progress
					InterlockedExchange(&g_matchmakingActive, 1);
					g_matchmakingProgress = 0.01;
				}

			}
		}
		else if (id == IDC_WEAP1) { g_weaponSel = 1; }
		else if (id == IDC_WEAP2) { g_weaponSel = 2; reset_accumulation(); }
		else if (id == IDC_WEAP3) { g_weaponSel = 3; reset_accumulation(); }
		// update label and repaint
		char buf[128];
		switch (g_page) {
		case PAGE_HOME: sprintf_s(buf, "Home"); break;
		case PAGE_PLAY: sprintf_s(buf, "Enter Conflict"); break;
		case PAGE_MATCHMAKING: sprintf_s(buf, "Matchmaking"); break;
		case PAGE_SETTINGS: sprintf_s(buf, "Settings"); break;
		case PAGE_ABOUT: sprintf_s(buf, "About"); break;
		case PAGE_EXTRAS: sprintf_s(buf, "Extras"); break;
		case PAGE_DIAGNOSTICS: sprintf_s(buf, "Diagnostics"); break;
		}
		SetWindowTextA(GetDlgItem(hwnd, IDC_LABEL), buf);
		// show/hide controls based on page
		ShowWindow(g_btnFind, (g_page==PAGE_MATCHMAKING)?SW_SHOW:SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP1), (g_page==PAGE_PLAY)?SW_SHOW:SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP2), (g_page==PAGE_PLAY)?SW_SHOW:SW_HIDE);
		ShowWindow(GetDlgItem(hwnd, IDC_WEAP3), (g_page==PAGE_PLAY)?SW_SHOW:SW_HIDE);
		InvalidateRect(hwnd, NULL, TRUE);
		return 0; }

	case WM_PAINT: {
		PAINTSTRUCT ps; HDC hdc = BeginPaint(hwnd, &ps);
		// blit preview buffer into left preview area
		RECT rl = {250,10,250+PREW,10+PREH};
		if (g_previewPixels) {
			StretchDIBits(hdc, rl.left, rl.top, PREW, PREH, 0, 0, PREW, PREH, g_previewPixels, &g_bmi, DIB_RGB_COLORS, SRCCOPY);
		} else DrawPreview(hdc, rl, "Preview (320x180)", RGB(48,64,96), "Star", "Cylinder");

		// note: single preview only; right preview removed

		// Draw page big title using Android-like font
		HFONT old = (HFONT)SelectObject(hdc, g_fontAndroidLarge);
		RECT rc; GetClientRect(hwnd, &rc);
		rc.top = 220; rc.left = 250; rc.right = rc.right - 20; rc.bottom = rc.top + 80;
		SetBkMode(hdc, TRANSPARENT); SetTextColor(hdc, RGB(240,240,240));
		switch (g_page) {
		case PAGE_HOME: DrawTextA(hdc, "Main Menu - Home", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_PLAY: DrawTextA(hdc, "Enter Conflict", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_MATCHMAKING: DrawTextA(hdc, "Matchmaking", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_SETTINGS: DrawTextA(hdc, "Settings", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_ABOUT: DrawTextA(hdc, "About", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_EXTRAS: DrawTextA(hdc, "Extras", -1, &rc, DT_LEFT|DT_VCENTER); break;
		case PAGE_DIAGNOSTICS: DrawTextA(hdc, "Diagnostics", -1, &rc, DT_LEFT|DT_VCENTER); break;
		}
		SelectObject(hdc, old);

		// FPS counter top-right
		char fpsBuf[64]; snprintf(fpsBuf, sizeof(fpsBuf), "FPS: %d", g_displayFps);
		SetBkMode(hdc, TRANSPARENT); SetTextColor(hdc, RGB(255,255,0));
		TextOutA(hdc, rc.right - 120, 12, fpsBuf, (int)strlen(fpsBuf));

	// Indicate private DirectX usage
	if (InterlockedCompareExchange(&g_using_private_dx, 0, 0) == 1) {
		TextOutA(hdc, rc.right - 280, 12, "Private DirectX", (int)strlen("Private DirectX"));
	}

	// Draw diagnostics lines (up to 6 most recent)
	EnterCriticalSection(&g_diagCS);
	for (int i = 0; i < 6; ++i) {
		int idx = (g_diagNext - 1 - i);
		if (idx < 0) break;
		idx %= 16; if (idx < 0) idx += 16;
		char *line = g_diagLines[idx];
		if (line[0] == '\0') break;
		TextOutA(hdc, 12, rc.bottom - 20 - i*16, line, (int)strlen(line));
	}
	LeaveCriticalSection(&g_diagCS);

		// If matchmaking page show Find Match button and pulsing status
		if (g_page == PAGE_MATCHMAKING) {
			// draw pulsing "finding match" text next to button
			char mp[64]; if (g_matchmakingActive) snprintf(mp, sizeof(mp), "Finding match... %.0f%%", g_matchmakingProgress*100.0); else snprintf(mp, sizeof(mp), "Find Match");
			SetTextColor(hdc, RGB(200,200,255));
			TextOutA(hdc, 380, 270, mp, (int)strlen(mp));
		}

		EndPaint(hwnd, &ps);
		return 0; }

	case WM_DESTROY:
		KillTimer(hwnd, 1);
		InterlockedExchange(&g_previewReady, -1);
		if (g_previewThread) {
			WaitForSingleObject(g_previewThread, INFINITE);
			CloseHandle(g_previewThread);
			g_previewThread = NULL;
		}
		if (g_previewPixels) {
			free(g_previewPixels);
			g_previewPixels = NULL;
		}
		if (g_accumBuffer) {
			free(g_accumBuffer);
			g_accumBuffer = NULL;
			g_accumPass = 0;
		}
		if (g_fontAndroidLarge) {
			DeleteObject(g_fontAndroidLarge);
			g_fontAndroidLarge = NULL;
		}
		DeleteCriticalSection(&g_diagCS);
		PostQuitMessage(0);
		return 0;
	}
	return DefWindowProcA(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int)
{
	const char *cls = "CBG_MainMenu";
	WNDCLASSEXA wc = {};
	wc.cbSize = sizeof(wc);
	wc.lpfnWndProc = WndProc;
	wc.hInstance = hInstance;
	wc.hCursor = LoadCursorA(NULL, IDC_ARROW);
	wc.hbrBackground = (HBRUSH)(COLOR_WINDOW+1);
	wc.lpszClassName = cls;
	RegisterClassExA(&wc);

	// Show a small splash window while probing private DirectX path and preloading DLLs.
	HWND splash = CreateWindowExA(WS_EX_TOPMOST, "STATIC", "Loading Conduct Dyadra Modal...",
		WS_POPUP | WS_VISIBLE | SS_CENTER, CW_USEDEFAULT, CW_USEDEFAULT, 480, 120, NULL, NULL, hInstance, NULL);
	if (splash) {
		ShowWindow(splash, SW_SHOW);
		UpdateWindow(splash);
	}

	// Resolve private DirectX path: prefer HKCU marker, fallback to exe-relative folder.
	{
		char privateDXPath[MAX_PATH] = { 0 };
		HKEY hKey = NULL;
		DWORD cb = (DWORD)sizeof(privateDXPath);
		DWORD type = 0;
		if (RegOpenKeyExA(HKEY_CURRENT_USER, "SOFTWARE\\ConductDyadraModal\\DirectXPrivate", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
			if (RegQueryValueExA(hKey, "InstallPath", NULL, &type, (LPBYTE)privateDXPath, &cb) == ERROR_SUCCESS &&
				(type == REG_SZ || type == REG_EXPAND_SZ) && privateDXPath[0] != '\0') {
				diag_log("HKCU private DX path: %s", privateDXPath);
			} else {
				privateDXPath[0] = '\0';
			}
			RegCloseKey(hKey);
		}

		if (privateDXPath[0] == '\0') {
			char exePath[MAX_PATH];
			if (GetModuleFileNameA(NULL, exePath, (DWORD)ARRAYSIZE(exePath))) {
				char *p = strrchr(exePath, '\\');
				if (p) { *p = '\0'; /* now exePath is directory */ }
				snprintf(privateDXPath, sizeof(privateDXPath), "%s\\directx_dev12.4", exePath);
			}
			diag_log("Fallback private DX path: %s", privateDXPath);
		}

		// If a private DirectX folder exists, prefer its DLLs by adding it to the DLL search path.
		// This reduces the need to modify system DirectX or registry when using private redist files.
		// Also preload critical DirectX DLLs from that folder for predictable runtime behavior.
		{
			DWORD attrs = GetFileAttributesA(privateDXPath);
			if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
#ifndef LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
#define LOAD_LIBRARY_SEARCH_DEFAULT_DIRS 0x00001000
#endif
#ifndef LOAD_WITH_ALTERED_SEARCH_PATH
#define LOAD_WITH_ALTERED_SEARCH_PATH 0x00000008
#endif
				{
					HMODULE hKernel = GetModuleHandleA("kernel32.dll");
					if (hKernel) {
						typedef BOOL (WINAPI *PFN_SetDefaultDllDirectories)(DWORD);
						typedef PVOID (WINAPI *PFN_AddDllDirectory)(PCWSTR);
						PFN_SetDefaultDllDirectories pSetDefaultDllDirectories = (PFN_SetDefaultDllDirectories)GetProcAddress(hKernel, "SetDefaultDllDirectories");
						PFN_AddDllDirectory pAddDllDirectory = (PFN_AddDllDirectory)GetProcAddress(hKernel, "AddDllDirectory");
						if (pSetDefaultDllDirectories && pAddDllDirectory) {
							wchar_t privateDXPathW[MAX_PATH];
							MultiByteToWideChar(CP_ACP, 0, privateDXPath, -1, privateDXPathW, (int)ARRAYSIZE(privateDXPathW));
							pSetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
							pAddDllDirectory(privateDXPathW);
						} else {
							SetDllDirectoryA(privateDXPath);
						}
					} else {
						SetDllDirectoryA(privateDXPath);
					}
				}

				{
				const char *libs[] = { "vcruntime140d.dll", "ucrtbased.dll", "d3d12.dll", "dxgi.dll", "d3dcompiler_47.dll", NULL };
					static HMODULE s_libHandles[8] = { 0 };
					int li = 0;
					for (const char **pp = libs; *pp && li < (int)ARRAYSIZE(s_libHandles); ++pp) {
						char libPath[MAX_PATH];
						snprintf(libPath, sizeof(libPath), "%s\\%s", privateDXPath, *pp);
						DWORD libAttrs = GetFileAttributesA(libPath);
						if (libAttrs != INVALID_FILE_ATTRIBUTES && !(libAttrs & FILE_ATTRIBUTE_DIRECTORY)) {
							HMODULE h = LoadLibraryExA(libPath, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
							if (h) {
								s_libHandles[li++] = h;
								InterlockedExchange(&g_using_private_dx, 1);
								diag_log("Loaded private DLL: %s", *pp);
							} else {
								diag_log("Failed to load private DLL: %s", *pp);
							}
						}
					}
				}
			} else {
				diag_log("Private DX path not present: %s", privateDXPath);
			}
		}
	}

	if (splash) {
		DestroyWindow(splash);
		splash = NULL;
	}

	HWND hwnd = CreateWindowExA(0, cls, "Conduct Dyadra Modal - Main Menu", WS_OVERLAPPEDWINDOW,
		CW_USEDEFAULT, CW_USEDEFAULT, 1024, 640, NULL, NULL, hInstance, NULL);
	if (!hwnd) return -1;
	ShowWindow(hwnd, SW_SHOWMAXIMIZED);
	UpdateWindow(hwnd);

	MSG msg;
	while (GetMessageA(&msg, NULL, 0, 0) > 0) {
		TranslateMessage(&msg);
		DispatchMessageA(&msg);
	}
	return (int)msg.wParam;
}

#if 0
				tlasInputs.InstanceDescs = instUpload->GetGPUVirtualAddress();
				buildDesc.Inputs = tlasInputs;
				buildDesc.DestAccelerationStructureData = tlas->GetGPUVirtualAddress();
				buildDesc.ScratchAccelerationStructureData = tlasScratch->GetGPUVirtualAddress();
				cmdList4->BuildRaytracingAccelerationStructure(&buildDesc, 0, NULL);
				uav.UAV.pResource = tlas;
				cmdList4->ResourceBarrier(1, &uav);
			}
		}

		hr = cmdList4->Close();
		if (FAILED(hr)) goto fallback;
		{
			ID3D12CommandList *lists[] = { (ID3D12CommandList*)cmdList4 };
			g_queue->ExecuteCommandLists(1, lists);
		}

		if (g_blasStar) g_blasStar->Release();
		if (g_blasStarScratch) g_blasStarScratch->Release();
		if (g_blasCyl) g_blasCyl->Release();
		if (g_blasCylScratch) g_blasCylScratch->Release();
		if (g_tlas) g_tlas->Release();
		if (g_tlasScratch) g_tlasScratch->Release();
		if (g_tlasInstanceUpload) g_tlasInstanceUpload->Release();

		g_blasStar = blasStar; blasStar = NULL;
		g_blasStarScratch = blasStarScratch; blasStarScratch = NULL;
		g_blasCyl = blasCyl; blasCyl = NULL;
		g_blasCylScratch = blasCylScratch; blasCylScratch = NULL;
		g_tlas = tlas; tlas = NULL;
		g_tlasScratch = tlasScratch; tlasScratch = NULL;
		g_tlasInstanceUpload = instUpload; instUpload = NULL;

		// Create SRV for TLAS in descriptor heap slot 0
		if (g_uavHeap && g_tlas) {
			D3D12_CPU_DESCRIPTOR_HANDLE srvHandle = g_uavHeap->lpVtbl->GetCPUDescriptorHandleForHeapStart(g_uavHeap);
			D3D12_SHADER_RESOURCE_VIEW_DESC srvDesc = {0};
			srvDesc.ViewDimension = D3D12_SRV_DIMENSION_RAYTRACING_ACCELERATION_STRUCTURE;
			srvDesc.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
			srvDesc.RaytracingAccelerationStructure.Location = g_tlas->GetGPUVirtualAddress();
			g_device->CreateShaderResourceView(g_tlas, &srvDesc, srvHandle);
		}

		OutputDebugStringA("create_acceleration_structures_stub: BLAS/TLAS build commands submitted\n");
		if (cmdList4) cmdList4->Release();
		return true;

fallback:
		OutputDebugStringA("create_acceleration_structures_stub: DXR build failed, continuing with fallback\n");
		if (cmdList4) cmdList4->Release();
		if (blasStar) blasStar->Release();
		if (blasStarScratch) blasStarScratch->Release();
		if (blasCyl) blasCyl->Release();
		if (blasCylScratch) blasCylScratch->Release();
		if (tlas) tlas->Release();
		if (tlasScratch) tlasScratch->Release();
		if (instUpload) instUpload->Release();
		return true;
	}
}

static bool create_raytracing_pipeline_stub()
{
	HRESULT hr;
	const char *basePath = "NativeSamples\\D3D12_8x8_engine\\Shaders\\";
	char path[512];
	FILE *f = NULL;
	long fileSize = 0;
	size_t readBytes = 0;
	ID3DBlob *blobRayGen = NULL;
	ID3DBlob *blobMiss = NULL;
	ID3DBlob *blobCHit = NULL;
	ID3DBlob *rsBlob = NULL;
	ID3DBlob *rsErr = NULL;
	ID3D12StateObject *rtState = NULL;
	ID3D12StateObjectProperties *soProps = NULL;
	ID3D12Resource *shaderTable = NULL;
	ID3D12RootSignature *globalRootSig = NULL;
	UINT subobjectCount = 0;
	UINT shaderConfigIndex = 0;
	D3D12_STATE_SUBOBJECT subobjects[8];
	void *rayGenId = NULL;
	void *missId = NULL;
	void *hitGroupId = NULL;
	const UINT shaderIdSize = D3D12_SHADER_IDENTIFIER_SIZE_IN_BYTES;
	const UINT recordSize = (shaderIdSize + (D3D12_RAYTRACING_SHADER_RECORD_BYTE_ALIGNMENT - 1)) & ~(D3D12_RAYTRACING_SHADER_RECORD_BYTE_ALIGNMENT - 1);
	const UINT tableSizeUnaligned = recordSize * 3;
	const UINT tableSize = (tableSizeUnaligned + (D3D12_RAYTRACING_SHADER_TABLE_BYTE_ALIGNMENT - 1)) & ~(D3D12_RAYTRACING_SHADER_TABLE_BYTE_ALIGNMENT - 1);

	if (!g_device5) {
		OutputDebugStringA("create_raytracing_pipeline_stub: ID3D12Device5 unavailable\n");
		return false;
	}

	memset(subobjects, 0, sizeof(subobjects));

	snprintf(path, sizeof(path), "%sraygen.dxil", basePath);
	f = fopen(path, "rb");
	if (!f) { OutputDebugStringA("create_raytracing_pipeline_stub: raygen.dxil missing\n"); goto fallback; }
	if (fseek(f, 0, SEEK_END) != 0) { fclose(f); f = NULL; goto fallback; }
	fileSize = ftell(f);
	if (fileSize <= 0) { fclose(f); f = NULL; goto fallback; }
	if (fseek(f, 0, SEEK_SET) != 0) { fclose(f); f = NULL; goto fallback; }
	hr = D3DCreateBlob((SIZE_T)fileSize, &blobRayGen);
	if (FAILED(hr) || !blobRayGen) { fclose(f); f = NULL; goto fallback; }
	readBytes = fread(blobRayGen->GetBufferPointer(), 1, (size_t)fileSize, f);
	fclose(f); f = NULL;
	if (readBytes != (size_t)fileSize) goto fallback;

	snprintf(path, sizeof(path), "%smiss.dxil", basePath);
	f = fopen(path, "rb");
	if (!f) { OutputDebugStringA("create_raytracing_pipeline_stub: miss.dxil missing\n"); goto fallback; }
	if (fseek(f, 0, SEEK_END) != 0) { fclose(f); f = NULL; goto fallback; }
	fileSize = ftell(f);
	if (fileSize <= 0) { fclose(f); f = NULL; goto fallback; }
	if (fseek(f, 0, SEEK_SET) != 0) { fclose(f); f = NULL; goto fallback; }
	hr = D3DCreateBlob((SIZE_T)fileSize, &blobMiss);
	if (FAILED(hr) || !blobMiss) { fclose(f); f = NULL; goto fallback; }
	readBytes = fread(blobMiss->GetBufferPointer(), 1, (size_t)fileSize, f);
	fclose(f); f = NULL;
	if (readBytes != (size_t)fileSize) goto fallback;

	snprintf(path, sizeof(path), "%sclosesthit.dxil", basePath);
	f = fopen(path, "rb");
	if (!f) { OutputDebugStringA("create_raytracing_pipeline_stub: closesthit.dxil missing\n"); goto fallback; }
	if (fseek(f, 0, SEEK_END) != 0) { fclose(f); f = NULL; goto fallback; }
	fileSize = ftell(f);
	if (fileSize <= 0) { fclose(f); f = NULL; goto fallback; }
	if (fseek(f, 0, SEEK_SET) != 0) { fclose(f); f = NULL; goto fallback; }
	hr = D3DCreateBlob((SIZE_T)fileSize, &blobCHit);
	if (FAILED(hr) || !blobCHit) { fclose(f); f = NULL; goto fallback; }
	readBytes = fread(blobCHit->GetBufferPointer(), 1, (size_t)fileSize, f);
	fclose(f); f = NULL;
	if (readBytes != (size_t)fileSize) goto fallback;

	{
		D3D12_ROOT_SIGNATURE_DESC rsDesc = { 0 };
		rsDesc.NumParameters = 0;
		rsDesc.pParameters = NULL;
		rsDesc.NumStaticSamplers = 0;
		rsDesc.pStaticSamplers = NULL;
		rsDesc.Flags = D3D12_ROOT_SIGNATURE_FLAG_NONE;
		hr = D3D12SerializeRootSignature(&rsDesc, D3D_ROOT_SIGNATURE_VERSION_1, &rsBlob, &rsErr);
		if (FAILED(hr)) {
			OutputDebugStringA("create_raytracing_pipeline_stub: root signature serialization failed\n");
			if (rsErr && rsErr->lpVtbl->GetBufferPointer(rsErr)) OutputDebugStringA((const char*)rsErr->lpVtbl->GetBufferPointer(rsErr));
			goto fallback;
		}
		hr = g_device5->CreateRootSignature(0, rsBlob->GetBufferPointer(), rsBlob->GetBufferSize(), IID_PPV_ARGS(&globalRootSig));
		if (FAILED(hr) || !globalRootSig) {
			OutputDebugStringA("create_raytracing_pipeline_stub: CreateRootSignature failed\n");
			goto fallback;
		}
	}

	{
		D3D12_EXPORT_DESC exRayGen = { L"RayGen", NULL, D3D12_EXPORT_FLAG_NONE };
		D3D12_EXPORT_DESC exMiss = { L"Miss", NULL, D3D12_EXPORT_FLAG_NONE };
		D3D12_EXPORT_DESC exCHit = { L"ClosestHit", NULL, D3D12_EXPORT_FLAG_NONE };
		D3D12_DXIL_LIBRARY_DESC libRayGen = { 0 };
		D3D12_DXIL_LIBRARY_DESC libMiss = { 0 };
		D3D12_DXIL_LIBRARY_DESC libCHit = { 0 };
		D3D12_HIT_GROUP_DESC hitGroup = { 0 };
		D3D12_RAYTRACING_SHADER_CONFIG shaderConfig = { 0 };
		LPCWSTR shaderExports[] = { L"RayGen", L"Miss", L"HitGroup" };
		D3D12_SUBOBJECT_TO_EXPORTS_ASSOCIATION shaderConfigAssoc = { 0 };
		D3D12_RAYTRACING_PIPELINE_CONFIG pipelineConfig = { 0 };
		D3D12_STATE_OBJECT_DESC stateDesc = { 0 };

		libRayGen.DXILLibrary.pShaderBytecode = blobRayGen->GetBufferPointer();
		libRayGen.DXILLibrary.BytecodeLength = blobRayGen->GetBufferSize();
		libRayGen.NumExports = 1;
		libRayGen.pExports = &exRayGen;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_DXIL_LIBRARY;
		subobjects[subobjectCount].pDesc = &libRayGen;
		++subobjectCount;

		libMiss.DXILLibrary.pShaderBytecode = blobMiss->GetBufferPointer();
		libMiss.DXILLibrary.BytecodeLength = blobMiss->GetBufferSize();
		libMiss.NumExports = 1;
		libMiss.pExports = &exMiss;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_DXIL_LIBRARY;
		subobjects[subobjectCount].pDesc = &libMiss;
		++subobjectCount;

		libCHit.DXILLibrary.pShaderBytecode = blobCHit->GetBufferPointer();
		libCHit.DXILLibrary.BytecodeLength = blobCHit->GetBufferSize();
		libCHit.NumExports = 1;
		libCHit.pExports = &exCHit;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_DXIL_LIBRARY;
		subobjects[subobjectCount].pDesc = &libCHit;
		++subobjectCount;

		hitGroup.Type = D3D12_HIT_GROUP_TYPE_TRIANGLES;
		hitGroup.HitGroupExport = L"HitGroup";
		hitGroup.ClosestHitShaderImport = L"ClosestHit";
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_HIT_GROUP;
		subobjects[subobjectCount].pDesc = &hitGroup;
		++subobjectCount;

		shaderConfig.MaxPayloadSizeInBytes = 16;
		shaderConfig.MaxAttributeSizeInBytes = 8;
		shaderConfigIndex = subobjectCount;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_RAYTRACING_SHADER_CONFIG;
		subobjects[subobjectCount].pDesc = &shaderConfig;
		++subobjectCount;

		shaderConfigAssoc.pSubobjectToAssociate = &subobjects[shaderConfigIndex];
		shaderConfigAssoc.NumExports = 3;
		shaderConfigAssoc.pExports = shaderExports;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_SUBOBJECT_TO_EXPORTS_ASSOCIATION;
		subobjects[subobjectCount].pDesc = &shaderConfigAssoc;
		++subobjectCount;

		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_GLOBAL_ROOT_SIGNATURE;
		subobjects[subobjectCount].pDesc = &globalRootSig;
		++subobjectCount;

		pipelineConfig.MaxTraceRecursionDepth = 1;
		subobjects[subobjectCount].Type = D3D12_STATE_SUBOBJECT_TYPE_RAYTRACING_PIPELINE_CONFIG;
		subobjects[subobjectCount].pDesc = &pipelineConfig;
		++subobjectCount;

		stateDesc.Type = D3D12_STATE_OBJECT_TYPE_RAYTRACING_PIPELINE;
		stateDesc.NumSubobjects = subobjectCount;
		stateDesc.pSubobjects = subobjects;
		hr = g_device5->CreateStateObject(&stateDesc, IID_PPV_ARGS(&rtState));
		if (FAILED(hr) || !rtState) {
			OutputDebugStringA("create_raytracing_pipeline_stub: CreateStateObject failed\n");
			goto fallback;
		}
	}

	hr = rtState->QueryInterface(IID_PPV_ARGS(&soProps));
	if (FAILED(hr) || !soProps) {
		OutputDebugStringA("create_raytracing_pipeline_stub: QueryInterface(ID3D12StateObjectProperties) failed\n");
		goto fallback;
	}

	rayGenId = soProps->GetShaderIdentifier(L"RayGen");
	missId = soProps->GetShaderIdentifier(L"Miss");
	hitGroupId = soProps->GetShaderIdentifier(L"HitGroup");
	if (!rayGenId || !missId || !hitGroupId) {
		OutputDebugStringA("create_raytracing_pipeline_stub: shader identifiers not found\n");
		goto fallback;
	}

	{
		D3D12_HEAP_PROPERTIES heapUpload = { 0 };
		D3D12_RESOURCE_DESC tableDesc = { 0 };
		uint8_t *mapped = NULL;
		UINT offset = 0;

		heapUpload.Type = D3D12_HEAP_TYPE_UPLOAD;
		heapUpload.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
		heapUpload.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;
		heapUpload.CreationNodeMask = 1;
		heapUpload.VisibleNodeMask = 1;

		tableDesc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
		tableDesc.Alignment = 0;
		tableDesc.Width = tableSize;
		tableDesc.Height = 1;
		tableDesc.DepthOrArraySize = 1;
		tableDesc.MipLevels = 1;
		tableDesc.Format = DXGI_FORMAT_UNKNOWN;
		tableDesc.SampleDesc.Count = 1;
		tableDesc.SampleDesc.Quality = 0;
		tableDesc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
		tableDesc.Flags = D3D12_RESOURCE_FLAG_NONE;

		hr = g_device5->CreateCommittedResource(&heapUpload, D3D12_HEAP_FLAG_NONE, &tableDesc,
			D3D12_RESOURCE_STATE_GENERIC_READ, NULL, IID_PPV_ARGS(&shaderTable));
		if (FAILED(hr) || !shaderTable) {
			OutputDebugStringA("create_raytracing_pipeline_stub: CreateCommittedResource(shader table) failed\n");
			goto fallback;
		}

		hr = shaderTable->Map(0, NULL, (void**)&mapped);
		if (FAILED(hr) || !mapped) goto fallback;
		memset(mapped, 0, tableSize);
		memcpy(mapped + offset, rayGenId, shaderIdSize); offset += recordSize;
		memcpy(mapped + offset, missId, shaderIdSize); offset += recordSize;
		memcpy(mapped + offset, hitGroupId, shaderIdSize);
		shaderTable->Unmap(0, NULL);
	}

	if (g_rtGlobalRootSig) { g_rtGlobalRootSig->Release(); }
	if (g_rtStateObject) { g_rtStateObject->Release(); }
	if (g_rtShaderTable) { g_rtShaderTable->Release(); }
	g_rtGlobalRootSig = globalRootSig; globalRootSig = NULL;
	g_rtStateObject = rtState; rtState = NULL;
	g_rtShaderTable = shaderTable; shaderTable = NULL;
	g_rtRecordSize = recordSize;
	g_rtShaderTableSize = tableSize;

	if (soProps) soProps->Release();
	if (rsBlob) rsBlob->Release();
	if (rsErr) rsErr->Release();
	if (blobRayGen) blobRayGen->Release();
	if (blobMiss) blobMiss->Release();
	if (blobCHit) blobCHit->Release();
	OutputDebugStringA("create_raytracing_pipeline_stub: raytracing state object and shader table created\n");
	return true;

fallback:
	OutputDebugStringA("create_raytracing_pipeline_stub: failed, falling back\n");
	if (f) fclose(f);
	if (shaderTable) shaderTable->Release();
	if (soProps) soProps->Release();
	if (rtState) rtState->Release();
	if (globalRootSig) globalRootSig->Release();
	if (rsBlob) rsBlob->Release();
	if (rsErr) rsErr->Release();
	if (blobRayGen) blobRayGen->Release();
	if (blobMiss) blobMiss->Release();
	if (blobCHit) blobCHit->Release();
	return false;
}

static bool init_dxr()
{
	// Query for ID3D12Device5 (DXR) support on the device
	if (!g_device) return false;
	HRESULT hr = g_device->QueryInterface(IID_ID3D12Device5, (void**)&g_device5);
	if (FAILED(hr) || g_device5 == NULL) {
		OutputDebugStringA("DXR not supported on this device (ID3D12Device5 unavailable)\n");
		return false;
	}

	OutputDebugStringA("DXR supported: device5 acquired\n");

	// Build acceleration structures and raytracing pipeline (stubs)
	if (!create_acceleration_structures_stub()) return false;
	if (!create_raytracing_pipeline_stub()) return false;

	return true;
}

static void create_dxr_srv_uav_descriptors()
{
	if (!g_device || !g_uavHeap || !g_previewTexture) return;

	{
	D3D12_CPU_DESCRIPTOR_HANDLE base = g_uavHeap->GetCPUDescriptorHandleForHeapStart();
		D3D12_CPU_DESCRIPTOR_HANDLE uavHandle = base;
		uavHandle.ptr += g_uavDescriptorSize; // slot 1 = UAV

		if (g_tlas) {
			D3D12_SHADER_RESOURCE_VIEW_DESC srvDesc = { 0 };
			srvDesc.ViewDimension = D3D12_SRV_DIMENSION_RAYTRACING_ACCELERATION_STRUCTURE;
			srvDesc.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
			srvDesc.RaytracingAccelerationStructure.Location = g_tlas->GetGPUVirtualAddress();
			g_device->CreateShaderResourceView(NULL, &srvDesc, base); // slot 0 = TLAS SRV
		}

		{
			D3D12_UNORDERED_ACCESS_VIEW_DESC uavDesc = { 0 };
			uavDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
			uavDesc.ViewDimension = D3D12_UAV_DIMENSION_TEXTURE2D;
			g_device->CreateUnorderedAccessView(g_previewTexture, NULL, &uavDesc, uavHandle);
		}
	}
}

static bool update_tlas_for_frame(float t)
{
	if (!g_device5 || !g_cmdList || !g_tlas || !g_tlasScratch || !g_tlasInstanceUpload || !g_blasStar || !g_blasCyl) return false;
	{
		HRESULT hr;
		void *mapped = NULL;
		ID3D12GraphicsCommandList4 *cmdList4 = NULL;
	D3D12_RAYTRACING_INSTANCE_DESC inst[2];
	D3D12_BUILD_RAYTRACING_ACCELERATION_STRUCTURE_DESC buildDesc = { 0 };
		D3D12_BUILD_RAYTRACING_ACCELERATION_STRUCTURE_INPUTS tlasInputs = { 0 };
		D3D12_RESOURCE_BARRIER uav = { 0 };

		memset(inst, 0, sizeof(inst));
		inst[0].Transform[0][0] = 1.0f; inst[0].Transform[1][1] = 1.0f; inst[0].Transform[2][2] = 1.0f;
		inst[0].InstanceID = 0;
		inst[0].InstanceMask = 0xFF;
		inst[0].InstanceContributionToHitGroupIndex = 0;
		inst[0].Flags = D3D12_RAYTRACING_INSTANCE_FLAG_NONE;
		inst[0].AccelerationStructure = g_blasStar->GetGPUVirtualAddress();

		inst[1].Transform[0][0] = 1.0f; inst[1].Transform[1][1] = 1.0f; inst[1].Transform[2][2] = 1.0f;
	// cylinder moves side to side and bends (approx by shifting top vertices in shader via local transform)
	inst[1].Transform[0][3] = 2.5f + (sinf(t) * 0.5f);
	// star bounces up and down using instance 0 translation Y
	inst[0].Transform[1][3] = fabsf(sinf(t * 3.0f)) * 0.5f;
		inst[1].InstanceID = 1;
		inst[1].InstanceMask = 0xFF;
		inst[1].InstanceContributionToHitGroupIndex = 0;
		inst[1].Flags = D3D12_RAYTRACING_INSTANCE_FLAG_NONE;
		inst[1].AccelerationStructure = g_blasCyl->GetGPUVirtualAddress();

		hr = g_tlasInstanceUpload->Map(0, NULL, &mapped);
		if (FAILED(hr) || !mapped) return false;
		memcpy(mapped, inst, sizeof(inst));
		g_tlasInstanceUpload->Unmap(0, NULL);

		hr = g_cmdList->QueryInterface(IID_PPV_ARGS(&cmdList4));
		if (FAILED(hr) || !cmdList4) return false;

		tlasInputs.Type = D3D12_RAYTRACING_ACCELERATION_STRUCTURE_TYPE_TOP_LEVEL;
		tlasInputs.Flags = D3D12_RAYTRACING_ACCELERATION_STRUCTURE_BUILD_FLAG_PREFER_FAST_TRACE;
		tlasInputs.NumDescs = 2;
		tlasInputs.DescsLayout = D3D12_ELEMENTS_LAYOUT_ARRAY;
		tlasInputs.InstanceDescs = g_tlasInstanceUpload->GetGPUVirtualAddress();
		buildDesc.Inputs = tlasInputs;
		buildDesc.DestAccelerationStructureData = g_tlas->GetGPUVirtualAddress();
		buildDesc.ScratchAccelerationStructureData = g_tlasScratch->GetGPUVirtualAddress();
		cmdList4->BuildRaytracingAccelerationStructure(&buildDesc, 0, NULL);

		uav.Type = D3D12_RESOURCE_BARRIER_TYPE_UAV;
		uav.UAV.pResource = g_tlas;
		cmdList4->ResourceBarrier(1, &uav);

		cmdList4->Release();
		return true;
	}
}

// Simple float3 type and helpers
typedef struct { float x, y, z; } float3;
static inline float3 f3(float x, float y, float z) { float3 v = { x,y,z }; return v; }
static inline float3 addf3(float3 a, float3 b) { return f3(a.x+b.x, a.y+b.y, a.z+b.z); }
static inline float3 subf3(float3 a, float3 b) { return f3(a.x-b.x, a.y-b.y, a.z-b.z); }
static inline float3 mulf3(float3 a, float s) { return f3(a.x*s, a.y*s, a.z*s); }
static inline float dotf3(float3 a, float3 b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
static inline float lenf3(float3 a) { return sqrtf(dotf3(a,a)); }
static inline float3 normalizef3(float3 a) { float L = lenf3(a); if (L==0) return a; return mulf3(a, 1.0f / L); }
static inline float3 reflectf3(float3 I, float3 N) { return subf3(I, mulf3(N, 2.0f * dotf3(N, I))); }

// SDF helpers: extruded radial 16-point star and capped cylinder
static float sdStarExtrude(float3 p, float baseR, float amp, int spikes, float halfHeight)
{
	float r = sqrtf(p.x*p.x + p.z*p.z);
	float theta = atan2f(p.z, p.x);
	float r0 = baseR * (1.0f + amp * sinf(spikes * theta));
	float d2 = r - r0;
	float dy = fabsf(p.y) - halfHeight;
	if (d2 > 0.0f && dy > 0.0f) return sqrtf(d2*d2 + dy*dy);
	return fmaxf(d2, dy);
}

static float sdCappedCylinder(float3 p, float radius, float halfHeight)
{
	float d = sqrtf(p.x*p.x + p.z*p.z) - radius;
	float dy = fabsf(p.y) - halfHeight;
	if (d > 0.0f && dy > 0.0f) return sqrtf(d*d + dy*dy);
	return fmaxf(d, dy);
}

// estimate normal by gradient
static float3 estimateNormal(float3 p, float (*sdf)(float3))
{
	const float eps = 1e-3f;
	float3 ex = f3(eps,0,0), ey = f3(0,eps,0), ez = f3(0,0,eps);
	float dx = sdf(addf3(p, ex)) - sdf(subf3(p, ex));
	float dy = sdf(addf3(p, ey)) - sdf(subf3(p, ey));
	float dz = sdf(addf3(p, ez)) - sdf(subf3(p, ez));
	return normalizef3(f3(dx,dy,dz));
}

// Scene SDF returns distance and material id via out param
static float sceneSDF(float3 p, int *matOut)
{
	// place star around origin
	float3 pStar = p; // star at origin
	float dStar = sdStarExtrude(pStar, 1.0f, 0.35f, 16, 0.25f);
	// cylinder to the right
	float3 pCyl = subf3(p, f3(2.5f, 0.0f, 0.0f));
	float dCyl = sdCappedCylinder(pCyl, 0.7f, 1.2f);
	if (dStar < dCyl) { if (matOut) *matOut = 1; return dStar; }
	if (matOut) *matOut = 2; return dCyl;
}

// Simple helpers for raymarch preview (SDFs)
static float sdCylinder(float3 p, float r, float h) { /* placeholder */ return 0.0f; }

// We'll implement a minimal CPU renderer for the 320x180 preview using a simple raymarch SDF
// Wrapper to call sceneSDF without material
static float sceneSDF_noMat(float3 p)
{
	return sceneSDF(p, NULL);
}

DWORD WINAPI preview_thread_fn(LPVOID param)
{
	const int W = 320;
	const int H = 180;
	double hz = 60.0; // preview update rate

	LARGE_INTEGER freq_li;
	QueryPerformanceFrequency(&freq_li);
	LONGLONG freq = freq_li.QuadPart;
	LONGLONG periodTicks = (LONGLONG)((double)freq / hz);
	LARGE_INTEGER start; QueryPerformanceCounter(&start);
	LONGLONG nextTick = start.QuadPart;

	// scene scaling: 1 unit = 1 meter, user requested 3mi x 2mi area
	const float mile = 1609.34f;
	const float sceneW = 3.0f * mile;
	const float sceneD = 2.0f * mile;

	// camera setup: positioned to see area
	float3 camPos = f3(0.0f, 500.0f, -sceneD * 0.5f - 1000.0f);
	float fov = 45.0f * (3.14159265f / 180.0f);

	UINT bufIdx = 0;
	while (g_running) {
		uint8_t *dstBase = g_uploadSmallMapped[bufIdx] + g_footprintSmall.Offset;

		for (int y = 0; y < H; ++y) {
			for (int x = 0; x < W; ++x) {
				float u = (x + 0.5f) / (float)W * 2.0f - 1.0f;
				float v = 1.0f - (y + 0.5f) / (float)H * 2.0f;
				float aspect = (float)W / (float)H;
				float px = u * tanf(fov * 0.5f) * aspect;
				float py = v * tanf(fov * 0.5f);

				float3 ro = camPos;
				float3 rd = normalizef3(f3(px, py, 1.0f));

				// raymarch
				float t = 0.0f;
				int hitMat = 0;
				float dist = 0.0f;
				int steps;
				for (steps = 0; steps < 120; ++steps) {
					float3 p = addf3(ro, mulf3(rd, t));
					dist = sceneSDF(p, &hitMat);
					if (dist < 1.0f) break; // close enough
					t += dist;
					if (t > 20000.0f) break;
				}

				float3 color = f3(0.1f, 0.15f, 0.2f); // sky
				if (steps < 120 && dist < 1.0f) {
					float3 pos = addf3(ro, mulf3(rd, t));
					float3 n = estimateNormal(pos, sceneSDF_noMat);

					// light
					float3 lightPos = f3(1000.0f, 2000.0f, -500.0f);
					float3 L = normalizef3(subf3(lightPos, pos));
					float diff = fmaxf(0.0f, dotf3(n, L));
					float3 baseCol = (hitMat == 1) ? f3(1.0f, 0.9f, 0.4f) : f3(0.2f, 0.4f, 0.9f);
					float reflect = (hitMat == 1) ? 0.7f : 0.8f;

					// ambient + diffuse
					color = addf3(mulf3(baseCol, 0.1f), mulf3(baseCol, diff * 0.9f));

					// specular
					float3 V = normalizef3(mulf3(rd, -1.0f));
					float3 R = reflectf3(mulf3(rd, -1.0f), n);
					float spec = powf(fmaxf(0.0f, dotf3(R, L)), 32.0f);
					color = addf3(color, f3(spec, spec, spec));

					// one-bounce reflection (trace reflected ray a bit)
					if (reflect > 0.05f) {
						float3 reflDir = reflectf3(rd, n);
						float rt = 0.01f;
						for (int rstep = 0; rstep < 60; ++rstep) {
							float3 rp = addf3(pos, mulf3(reflDir, rt));
							int rmat = 0;
							float rdDist = sceneSDF(rp, &rmat);
							if (rdDist < 1.0f) {
								float3 rcol = (rmat==1) ? f3(1.0f,0.9f,0.4f) : f3(0.2f,0.4f,0.9f);
								color = addf3(mulf3(color, 1.0f - reflect), mulf3(rcol, reflect));
								break;
							}
							rt += rdDist;
							if (rt > 20000.0f) break;
						}
					}
				}

				// write to buffer
				uint8_t r = (uint8_t)(fminf(1.0f, color.x) * 255.0f);
				uint8_t g = (uint8_t)(fminf(1.0f, color.y) * 255.0f);
				uint8_t b = (uint8_t)(fminf(1.0f, color.z) * 255.0f);
				size_t row = (size_t)g_rowPitchSmall * y;
				dstBase[row + x*4 + 0] = r;
				dstBase[row + x*4 + 1] = g;
				dstBase[row + x*4 + 2] = b;
				dstBase[row + x*4 + 3] = 255;
			}
		}

		InterlockedExchange(&smallPublishedIndex, bufIdx);
		bufIdx = (bufIdx + 1) % UPLOAD_COUNT;

		nextTick += periodTicks;
		LARGE_INTEGER now;
		for (;;) { QueryPerformanceCounter(&now); if (now.QuadPart >= nextTick) break; Sleep(0); }
	}

	return 0;
}

// Producer thread: toggles white/black at high frequency
DWORD WINAPI producer_thread_fn(LPVOID param)
{
	double engine_hz = 2400.0; // desired producer frequency (frames per second)
	// We'll run a 2-second fade from white -> black. At 2400 Hz that is 4800 frames per cycle.
	const int secondsPerCycle = 2;
	const int cycleFrames = (int)(engine_hz * (double)secondsPerCycle); // 4800

	LARGE_INTEGER freq_li;
	QueryPerformanceFrequency(&freq_li);
	LONGLONG freq = freq_li.QuadPart;
	LONGLONG periodTicks = (LONGLONG)((double)freq / engine_hz);

	LARGE_INTEGER start;
	QueryPerformanceCounter(&start);
	LONGLONG nextTick = start.QuadPart;

	uint32_t frameCounter = 0;
	for (;;) {
		int slot = frameCounter % RING_SIZE;
		FrameSlot *s = &ring[slot];

		// position in the 2-second cycle [0 .. cycleFrames-1]
		int pos = frameCounter % cycleFrames;
		double t = (double)pos / (double)(cycleFrames - 1); // 0.0 -> 1.0
		// linear fade from white (255) to black (0)
		uint8_t val = (uint8_t)(255.0 * (1.0 - t));

		for (int i = 0; i < PIXELS; ++i) {
			s->rgba[i*4 + 0] = val;
			s->rgba[i*4 + 1] = val;
			s->rgba[i*4 + 2] = val;
			s->rgba[i*4 + 3] = 255;
		}

		InterlockedExchange(&publishedIndex, slot);

		++frameCounter;
		// busy-wait-ish timing with Sleep(0) yield
		nextTick += periodTicks;
		LARGE_INTEGER now;
		for (;;) {
			QueryPerformanceCounter(&now);
			if (now.QuadPart >= nextTick) break;
			Sleep(0);
		}
	}

	return 0;
}

// ImGui wrapper
#include "imgui_wrapper.h"

// Forward declare settings (moved earlier so WndProc can reference them)
typedef struct { int width; int height; int hz; } AppSettings;
static AppSettings g_appSettings = { 1280, 720, 1200 };
// Supported refresh rates (Hz) for selection and fallback
static const int g_supportedHz[] = { 2400, 2000, 1800, 1680, 1440, 1200, 960, 900, 720, 540, 480, 320, 240, 120, 60 };
static const int g_supportedHzCount = sizeof(g_supportedHz)/sizeof(g_supportedHz[0]);

static int pick_supported_hz(int desired);
static bool load_settings(const char *path, AppSettings *out);
static bool save_settings_and_restart(const AppSettings *s);
static void open_settings_dialog(void);

// Create a simple window
LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
	// forward to ImGui if available
	imgui_wndproc_handler(hWnd, message, wParam, lParam);
	switch (message) {
	case WM_KEYDOWN:
		if (wParam == 'T') { g_showPreview = !g_showPreview; }
		return 0;
	case WM_COMMAND:
		switch (LOWORD(wParam)) {
		case IDC_BTN_ENTER: PostMessage(hWnd, WM_USER+1, 0, 0); break;
		case IDC_BTN_SETTINGS: open_settings_dialog(); break;
		case IDC_BTN_OPERATIONS: PostMessage(hWnd, WM_USER+2, 0, 0); break;
		case IDC_BTN_APPLY: {
			// read combo values
			HWND cmbRes = GetDlgItem(g_settingsDlg, IDC_CMB_RES);
			HWND cmbHz = GetDlgItem(g_settingsDlg, IDC_CMB_HZ);
			int rsel = (int)SendMessageA(cmbRes, CB_GETCURSEL, 0, 0);
			int hsel = (int)SendMessageA(cmbHz, CB_GETCURSEL, 0, 0);
			g_appSettings.width = rsel ? 1920 : 1280;
			g_appSettings.height = rsel ? 1080 : 720;
			g_appSettings.hz = pick_supported_hz(g_supportedHz[hsel % g_supportedHzCount]);
			save_settings_and_restart(&g_appSettings);
			break; }
		}
		return 0;
	case WM_DESTROY:
		PostQuitMessage(0);
		return 0;
	default:
		return DefWindowProc(hWnd, message, wParam, lParam);
	}
}

static bool create_window(HINSTANCE hInstance, int nCmdShow, int width, int height)
{
	WNDCLASSEXA wc = { 0 };
	wc.cbSize = sizeof(WNDCLASSEXA);
	wc.style = CS_HREDRAW | CS_VREDRAW;
	wc.lpfnWndProc = WndProc;
	wc.hInstance = hInstance;
	wc.hIcon = LoadIconA(NULL, IDI_APPLICATION);
	wc.hCursor = LoadCursorA(NULL, IDC_ARROW);
	wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
	wc.lpszClassName = "D3D12_8x8_Class";
	if (!RegisterClassExA(&wc)) {
		MessageBoxA(NULL, "RegisterClassEx failed", "Error", MB_OK | MB_ICONERROR);
		return false;
	}

	g_hwnd = CreateWindowExA(0, wc.lpszClassName, "D3D12 8x8 Engine Sample",
		WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, width, height,
		NULL, NULL, hInstance, NULL);

	if (!g_hwnd) {
		MessageBoxA(NULL, "CreateWindowEx failed", "Error", MB_OK | MB_ICONERROR);
		return false;
	}

	ShowWindow(g_hwnd, nCmdShow);
	UpdateWindow(g_hwnd);
	SetForegroundWindow(g_hwnd);
	SetFocus(g_hwnd);
	return true;
}

static void create_ui_controls()
{
	if (!g_hwnd) return;
	g_btnEnter = CreateWindowA("BUTTON", "Enter Conflict", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
		10, 10, 120, 28, g_hwnd, (HMENU)IDC_BTN_ENTER, GetModuleHandle(NULL), NULL);
	g_btnSettings = CreateWindowA("BUTTON", "Settings", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
		140, 10, 80, 28, g_hwnd, (HMENU)IDC_BTN_SETTINGS, GetModuleHandle(NULL), NULL);
	g_btnOperations = CreateWindowA("BUTTON", "Operations", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
		230, 10, 100, 28, g_hwnd, (HMENU)IDC_BTN_OPERATIONS, GetModuleHandle(NULL), NULL);
	g_chkPreview = CreateWindowA("BUTTON", "Preview", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
		340, 10, 80, 28, g_hwnd, (HMENU)IDC_CHK_PREVIEW, GetModuleHandle(NULL), NULL);
	g_chkFullscreen = CreateWindowA("BUTTON", "Fullscreen", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
		430, 10, 110, 28, g_hwnd, (HMENU)IDC_CHK_FULLSCREEN, GetModuleHandle(NULL), NULL);
}

static void destroy_ui_controls()
{
	if (g_btnEnter) DestroyWindow(g_btnEnter);
	if (g_btnSettings) DestroyWindow(g_btnSettings);
	if (g_btnOperations) DestroyWindow(g_btnOperations);
	if (g_chkPreview) DestroyWindow(g_chkPreview);
	if (g_chkFullscreen) DestroyWindow(g_chkFullscreen);
}

static void open_settings_dialog()
{
	if (g_settingsDlg) return;
	g_settingsDlg = CreateWindowExA(WS_EX_DLGMODALFRAME, "STATIC", "Settings",
		WS_OVERLAPPEDWINDOW | WS_VISIBLE, CW_USEDEFAULT, CW_USEDEFAULT, 420, 260,
		g_hwnd, NULL, GetModuleHandle(NULL), NULL);
	if (!g_settingsDlg) return;
	CreateWindowA("STATIC", "Resolution", WS_CHILD | WS_VISIBLE,
		10, 10, 200, 18, g_settingsDlg, NULL, GetModuleHandle(NULL), NULL);
	HWND cmbRes = CreateWindowA("COMBOBOX", NULL, WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST,
		10, 30, 260, 220, g_settingsDlg, (HMENU)IDC_CMB_RES, GetModuleHandle(NULL), NULL);
	SendMessageA(cmbRes, CB_ADDSTRING, 0, (LPARAM)"1280x720");
	SendMessageA(cmbRes, CB_ADDSTRING, 0, (LPARAM)"1920x1080");
	SendMessageA(cmbRes, CB_SETCURSEL, (WPARAM)((g_appSettings.width==1920)?1:0), 0);
	CreateWindowA("STATIC", "Refresh Rate", WS_CHILD | WS_VISIBLE,
		10, 70, 200, 18, g_settingsDlg, NULL, GetModuleHandle(NULL), NULL);
	HWND cmbHz = CreateWindowA("COMBOBOX", NULL, WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST,
		10, 90, 260, 220, g_settingsDlg, (HMENU)IDC_CMB_HZ, GetModuleHandle(NULL), NULL);
	for (int i=0;i<g_supportedHzCount;i++) { char b[16]; snprintf(b,sizeof(b),"%d Hz", g_supportedHz[i]); SendMessageA(cmbHz, CB_ADDSTRING, 0, (LPARAM)b); }
	// pick closest index
	int pick = 0; for (int i=0;i<g_supportedHzCount;i++) if (g_supportedHz[i]==g_appSettings.hz) { pick=i; break; }
	SendMessageA(cmbHz, CB_SETCURSEL, (WPARAM)pick, 0);
	CreateWindowA("BUTTON", "Apply", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
		300, 180, 90, 32, g_settingsDlg, (HMENU)IDC_BTN_APPLY, GetModuleHandle(NULL), NULL);
}

static void close_settings_dialog()
{
	if (g_settingsDlg) { DestroyWindow(g_settingsDlg); g_settingsDlg = NULL; }
}

static int pick_supported_hz(int desired)
{
	int best = g_supportedHz[0];
	int bestDiff = abs(desired - best);
	for (int i = 1; i < g_supportedHzCount; ++i) {
		int d = g_supportedHz[i];
		int diff = abs(desired - d);
		if (diff < bestDiff) {
			best = d;
			bestDiff = diff;
		}
	}
	return best;
}

static bool load_settings(const char *path, AppSettings *out)
{
	if (!path || !out) return false;
	FILE *f = fopen(path, "r");
	if (!f) return false;

	int w = 0, h = 0, hz = 0;
	int n = fscanf(f, "width=%d\nheight=%d\nhz=%d\n", &w, &h, &hz);
	fclose(f);
	if (n < 3) return false;

	if (w > 0) out->width = w;
	if (h > 0) out->height = h;
	if (hz > 0) out->hz = pick_supported_hz(hz);
	return true;
}

static bool save_settings_and_restart(const AppSettings *s)
{
	if (!s) return false;
	FILE *f = fopen("settings.cfg", "w");
	if (!f) return false;
	fprintf(f, "width=%d\nheight=%d\nhz=%d\n", s->width, s->height, s->hz);
	fclose(f);
	PostQuitMessage(0);
	return true;
}

static void wait_for_gpu()
{
	++g_fenceValue;
	g_queue->Signal(g_fence, g_fenceValue);
	if (g_fence->GetCompletedValue() < g_fenceValue) {
		g_fence->SetEventOnCompletion(g_fenceValue, g_fenceEvent);
		WaitForSingleObject(g_fenceEvent, INFINITE);
	}
}

static bool init_d3d12(UINT width, UINT height)
{
	HRESULT hr;

	// Create device
	hr = D3D12CreateDevice(NULL, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&g_device));
	if (FAILED(hr)) return false;

	// Create command queue
	D3D12_COMMAND_QUEUE_DESC qdesc = { 0 };
	qdesc.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
	hr = g_device->CreateCommandQueue(&qdesc, IID_PPV_ARGS(&g_queue));
	if (FAILED(hr)) return false;

	// Create swapchain
	IDXGIFactory4 *factory = NULL;
	CreateDXGIFactory1(IID_PPV_ARGS(&factory));

	DXGI_SWAP_CHAIN_DESC swapDesc = { 0 };
	swapDesc.BufferCount = 2;
	swapDesc.BufferDesc.Width = width;
	swapDesc.BufferDesc.Height = height;
	swapDesc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
	swapDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
	swapDesc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
	swapDesc.OutputWindow = g_hwnd;
	swapDesc.SampleDesc.Count = 1;
	swapDesc.Windowed = TRUE;

	IDXGISwapChain *sc = NULL;
	factory->CreateSwapChain((IUnknown*)g_queue, &swapDesc, &sc);
	sc->QueryInterface(IID_PPV_ARGS(&g_swapchain));
	sc->Release();
	factory->Release();

	// Create RTV heap
	D3D12_DESCRIPTOR_HEAP_DESC rtvHeapDesc = { 0 };
	rtvHeapDesc.NumDescriptors = 2;
	rtvHeapDesc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
	rtvHeapDesc.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_NONE;
	hr = g_device->CreateDescriptorHeap(&rtvHeapDesc, IID_PPV_ARGS(&g_rtvHeap));
	if (FAILED(hr)) return false;

	g_rtvDescriptorSize = g_device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);

	// Get back buffers and create RTVs
	D3D12_CPU_DESCRIPTOR_HANDLE rtvHandle = g_rtvHeap->GetCPUDescriptorHandleForHeapStart();
	for (UINT i = 0; i < 2; ++i) {
		g_swapchain->GetBuffer(i, IID_PPV_ARGS(&g_backBuffers[i]));
		g_device->CreateRenderTargetView(g_backBuffers[i], NULL, rtvHandle);
		rtvHandle.ptr += g_rtvDescriptorSize;
	}

	// Create command allocator and list
	hr = g_device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&g_cmdAlloc));
	if (FAILED(hr)) return false;
	hr = g_device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, g_cmdAlloc, NULL, IID_PPV_ARGS(&g_cmdList));
	if (FAILED(hr)) return false;

	// main command allocator/list for present path
	hr = g_device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&g_mainCmdAlloc));
	if (FAILED(hr)) return false;
	hr = g_device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, g_mainCmdAlloc, NULL, IID_PPV_ARGS(&g_mainCmdList));
	if (FAILED(hr)) return false;

	// Create fence
	hr = g_device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&g_fence));
	if (FAILED(hr)) return false;
	g_fenceEvent = CreateEvent(NULL, FALSE, FALSE, NULL);
	g_fenceValue = 0;

	return true;
}

int main(void)
{
	// Hide console if present (so app appears as windowed GUI)
	FreeConsole();

	HINSTANCE hInstance = GetModuleHandle(NULL);
	// load settings
	load_settings("settings.cfg", &g_appSettings);
	// Start the app maximized by default so it appears prominently when launched from VS
	if (!create_window(hInstance, SW_SHOWMAXIMIZED, g_appSettings.width, g_appSettings.height)) return -1;

	if (!init_d3d12((UINT)g_appSettings.width, (UINT)g_appSettings.height)) {
		MessageBox(NULL, "Failed to init D3D12", "Error", MB_OK);
		return -1;
	}

	// UI/menu state
	enum MainPage { PAGE_MAIN=0, PAGE_ENTER_CONFLICT, PAGE_SETTINGS, PAGE_OPERATIONS } mainPage = PAGE_MAIN;
	enum EnterSub { EC_NONE=0, EC_WEAPONS, EC_MATCHMAKING } enterSub = EC_NONE;
	enum OpsSub { OP_NONE=0, OP_WEAPONS, OP_MATCHMAKING } opsSub = OP_NONE;
	static int settingsResIndex = (g_appSettings.width == 1920) ? 1 : 0;
	static int settingsHzIndex = 0;
	// requested multiplayer loadout options: three variants each for M4, SCAR, G36C + bazookas + handguns
	const char *rifleFamilies[] = { "M4", "SCAR", "G36C" };
	const char *rifleVariants[3][3] = {
		{ "M4A1 CQB", "M4A1 Marksman", "M4A1 Heavy" },
		{ "SCAR-L Scout", "SCAR-H Battle", "SCAR-H Precision" },
		{ "G36C Compact", "G36C Tactical", "G36C DMR" }
	};
	const char *bazookaVariants[] = { "Bazooka HE-1", "Bazooka Thermobaric", "Bazooka EMP" };
	const char *handgunVariants[] = { "9mm Ranger", ".45 Titan", "Auto-10 Viper" };
	const int rifleFamilyCount = (int)(sizeof(rifleFamilies) / sizeof(rifleFamilies[0]));
	const int rifleVariantCount = 3;
	const int bazookaCount = (int)(sizeof(bazookaVariants) / sizeof(bazookaVariants[0]));
	const int handgunCount = (int)(sizeof(handgunVariants) / sizeof(handgunVariants[0]));
	static int selRifleFamily = 0;
	static int selRifleVariant = 0;
	static int selBazooka = 0;
	static int selHandgun = 0;

	// multiplayer environment targets
	const float mapSizeMiles = 2.0f;
	const float mapSizeMeters = 3218.688f;
	const float mapHalfMeters = mapSizeMeters * 0.5f;
	const int mechBotCount = 12;
	float mechBotX[12] = { 0 };
	float mechBotZ[12] = { 0 };
	float mechBotHeading[12] = { 0 };
	float mechBotSpeed[12] = { 0 };
	for (int i = 0; i < mechBotCount; ++i) {
		float t = ((float)i / (float)mechBotCount) * 6.2831853f;
		mechBotX[i] = cosf(t) * (mapHalfMeters * 0.65f);
		mechBotZ[i] = sinf(t) * (mapHalfMeters * 0.65f);
		mechBotHeading[i] = t + 1.5707963f;
		mechBotSpeed[i] = 42.0f + (float)(i % 4) * 7.0f;
	}

	// player control state for multiplayer FPS session
	int multiplayerFpsActive = 0;
	int flyModeEnabled = 0;
	int aimWithMouse = 1;
	float playerX = 0.0f, playerY = 0.0f, playerZ = 0.0f;
	float aimYaw = 0.0f, aimPitch = 0.0f;
	POINT lastMouse = { 0, 0 };
	int hasMouseBaseline = 0;

	// operations AI difficulty and map
	const char *aiDifficulties[] = { "Easy", "Normal", "Hard" };
	const char *maps[] = { "Two Mile Mech Grid", "Urban", "Canyon" };
	static int selAIDiff = 1; static int selMap = 0;
	// matchmaking state uses globals
	// matchmaking thread simulates loading and then shows mech/map
	DWORD WINAPI matchmaking_thread(void *arg) {
		g_matchmakingActive = true; g_matchmakingProgress = 0.0f;
		for (int i=0;i<100 && g_matchmakingActive;i++) { Sleep(50); g_matchmakingProgress = (i+1)/100.0f; }
		g_matchmakingActive = false; return 0;
	}

	// Start high-frequency producer thread
	HANDLE hProducer = CreateThread(NULL, 0, producer_thread_fn, NULL, 0, NULL);

	// We'll create multiple upload buffers (frames-in-flight) to avoid stalls
	// upload buffers are declared as globals so threads can access them

	// Create an upload buffer sized for 8x8 RGBA
	D3D12_RESOURCE_DESC texDesc = { 0 };
	texDesc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;
	texDesc.Alignment = 0;
	texDesc.Width = FRAME_W;
	texDesc.Height = FRAME_H;
	texDesc.DepthOrArraySize = 1;
	texDesc.MipLevels = 1;
	texDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
	texDesc.SampleDesc.Count = 1;
	texDesc.Layout = D3D12_TEXTURE_LAYOUT_UNKNOWN;
	texDesc.Flags = D3D12_RESOURCE_FLAG_NONE;

	D3D12_RESOURCE_DESC desc = texDesc;
	g_device->GetCopyableFootprints(&desc, 0, 1, 0, &g_footprint, NULL, NULL, &g_requiredSize);
	g_rowPitch = (UINT)g_footprint.Footprint.RowPitch;

	// Prepare a small preview texture footprint (320x180)
	D3D12_RESOURCE_DESC descSmall = texDesc;
	descSmall.Width = 320;
	descSmall.Height = 180;
	g_device->GetCopyableFootprints(&descSmall, 0, 1, 0, &g_footprintSmall, NULL, NULL, &g_requiredSizeSmall);
	g_rowPitchSmall = (UINT)g_footprintSmall.Footprint.RowPitch;

	// Create upload buffers
	D3D12_HEAP_PROPERTIES heapProps = { 0 };
	heapProps.Type = D3D12_HEAP_TYPE_UPLOAD;
	heapProps.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
	heapProps.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;
	heapProps.CreationNodeMask = 1;
	heapProps.VisibleNodeMask = 1;

	D3D12_RESOURCE_DESC bufDesc = { 0 };
	bufDesc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
	bufDesc.Width = (UINT64)g_requiredSize;
	bufDesc.Height = 1;
	bufDesc.DepthOrArraySize = 1;
	bufDesc.MipLevels = 1;
	bufDesc.SampleDesc.Count = 1;
	bufDesc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;

	for (UINT i = 0; i < UPLOAD_COUNT; ++i) {
		HRESULT hr = g_device->CreateCommittedResource(&heapProps, D3D12_HEAP_FLAG_NONE, &bufDesc,
			D3D12_RESOURCE_STATE_GENERIC_READ, NULL, IID_PPV_ARGS(&g_uploadBuffers[i]));
		if (FAILED(hr)) {
			MessageBox(NULL, "Failed to create upload buffer", "Error", MB_OK);
			return -1;
		}
		g_uploadBuffers[i]->Map(0, NULL, (void**)&g_uploadMapped[i]);
	}

	// Create upload buffers for small preview (use globals)
	D3D12_RESOURCE_DESC bufDescSmall = bufDesc;
	bufDescSmall.Width = (UINT64)g_requiredSizeSmall;
	for (UINT i = 0; i < UPLOAD_COUNT; ++i) {
		HRESULT hr = g_device->CreateCommittedResource(&heapProps, D3D12_HEAP_FLAG_NONE, &bufDescSmall,
			D3D12_RESOURCE_STATE_GENERIC_READ, NULL, IID_PPV_ARGS(&g_uploadSmallBuffers[i]));
		if (FAILED(hr)) {
			MessageBox(NULL, "Failed to create small upload buffer", "Error", MB_OK);
			return -1;
		}
		g_uploadSmallBuffers[i]->Map(0, NULL, (void**)&g_uploadSmallMapped[i]);
	}

	// Initialize RTX/AI stubs if enabled
	if (g_enableRTX) {
		g_dxrReady = init_dxr();
		if (!g_dxrReady) {
			// enable CPU soft-RTX fallback when hardware DXR unavailable
			InterlockedExchange(&g_use_soft_rtx, 1);
			reset_accumulation();
		} else {
			InterlockedExchange(&g_use_soft_rtx, 0);
		}
		create_dxr_srv_uav_descriptors();
	}
	if (g_enableAI) {
		// init_ai_effects(); // placeholder for DLSS/AI effects initialization
	}

	// init ImGui
	init_imgui(g_hwnd, g_device, g_uavHeap, g_rtvDescriptorSize);

	// Launch visual thread (file-scope function)

	HANDLE hVisual = CreateThread(NULL, 0, visual_thread_fn, NULL, 0, NULL);

	// Main loop: process messages and present at ~60Hz
	MSG msg = { 0 };
	LARGE_INTEGER freq_li; QueryPerformanceFrequency(&freq_li);
	LONGLONG freq = freq_li.QuadPart;
	double fps = 60.0; LONGLONG period = (LONGLONG)(freq / fps);
	LARGE_INTEGER tstart; QueryPerformanceCounter(&tstart); LONGLONG nextTick = tstart.QuadPart;

	while (true) {
		while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
			if (msg.message == WM_QUIT) goto shutdown;
			TranslateMessage(&msg);
			DispatchMessage(&msg);
		}

		// simple keyboard handling for navigation
		if (GetAsyncKeyState('1') & 1) { mainPage = PAGE_ENTER_CONFLICT; enterSub = EC_WEAPONS; }
		if (GetAsyncKeyState('2') & 1) { mainPage = PAGE_SETTINGS; }
		if (GetAsyncKeyState('3') & 1) { mainPage = PAGE_OPERATIONS; opsSub = OP_WEAPONS; }
		if (GetAsyncKeyState('Q') & 1) { PostQuitMessage(0); }

		// Back / cancel
		if (GetAsyncKeyState(VK_BACK) & 1) {
			mainPage = PAGE_MAIN;
			enterSub = EC_NONE;
			opsSub = OP_NONE;
			multiplayerFpsActive = 0;
		}

		// Enter Conflict weapons navigation
		if (mainPage == PAGE_ENTER_CONFLICT && enterSub == EC_WEAPONS) {
			if (GetAsyncKeyState(VK_LEFT) & 1) {
				selRifleFamily = (selRifleFamily - 1 + rifleFamilyCount) % rifleFamilyCount;
			}
			if (GetAsyncKeyState(VK_RIGHT) & 1) {
				selRifleFamily = (selRifleFamily + 1) % rifleFamilyCount;
			}
			if (GetAsyncKeyState(VK_UP) & 1) {
				selRifleVariant = (selRifleVariant - 1 + rifleVariantCount) % rifleVariantCount;
			}
			if (GetAsyncKeyState(VK_DOWN) & 1) {
				selRifleVariant = (selRifleVariant + 1) % rifleVariantCount;
			}
			if (GetAsyncKeyState('Z') & 1) { selBazooka = (selBazooka - 1 + bazookaCount) % bazookaCount; }
			if (GetAsyncKeyState('X') & 1) { selBazooka = (selBazooka + 1) % bazookaCount; }
			if (GetAsyncKeyState('C') & 1) { selHandgun = (selHandgun - 1 + handgunCount) % handgunCount; }
			if (GetAsyncKeyState('V') & 1) { selHandgun = (selHandgun + 1) % handgunCount; }

			// Next after selecting weapons: Enter or N starts multiplayer matchmaking flow
			if ((GetAsyncKeyState(VK_RETURN) & 1) || (GetAsyncKeyState('N') & 1)) {
				enterSub = EC_MATCHMAKING;
				g_matchmakingProgress = 0.0f;
				HANDLE h = CreateThread(NULL, 0, matchmaking_thread, NULL, 0, NULL);
				if (h) CloseHandle(h);
			}
		}

		if (mainPage == PAGE_ENTER_CONFLICT && enterSub == EC_MATCHMAKING && !g_matchmakingActive && g_matchmakingProgress >= 0.999f) {
			multiplayerFpsActive = 1;
		}

		if (multiplayerFpsActive && mainPage == PAGE_ENTER_CONFLICT) {
			const float dt = 1.0f / 60.0f;
			const float moveSpeed = flyModeEnabled ? 120.0f : 60.0f;
			const float verticalSpeed = 95.0f;

			if (GetAsyncKeyState(VK_SPACE) & 1) flyModeEnabled = !flyModeEnabled;
			if (GetAsyncKeyState('M') & 1) {
				aimWithMouse = !aimWithMouse;
				hasMouseBaseline = 0;
			}

			if (GetAsyncKeyState('W') & 0x8000) playerZ += moveSpeed * dt;
			if (GetAsyncKeyState('S') & 0x8000) playerZ -= moveSpeed * dt;
			if (GetAsyncKeyState('A') & 0x8000) playerX -= moveSpeed * dt;
			if (GetAsyncKeyState('D') & 0x8000) playerX += moveSpeed * dt;

			if (flyModeEnabled) {
				if (GetAsyncKeyState(VK_SPACE) & 0x8000) playerY += verticalSpeed * dt;
				if (GetAsyncKeyState(VK_CONTROL) & 0x8000) playerY -= verticalSpeed * dt;
			}

			if (aimWithMouse) {
				POINT curMouse;
				if (GetCursorPos(&curMouse)) {
					if (!hasMouseBaseline) {
						lastMouse = curMouse;
						hasMouseBaseline = 1;
					} else {
						aimYaw += (float)(curMouse.x - lastMouse.x) * 0.12f;
						aimPitch -= (float)(curMouse.y - lastMouse.y) * 0.12f;
						lastMouse = curMouse;
					}
				}
			} else {
				if (GetAsyncKeyState(VK_LEFT) & 0x8000) aimYaw -= 1.8f;
				if (GetAsyncKeyState(VK_RIGHT) & 0x8000) aimYaw += 1.8f;
				if (GetAsyncKeyState(VK_UP) & 0x8000) aimPitch += 1.4f;
				if (GetAsyncKeyState(VK_DOWN) & 0x8000) aimPitch -= 1.4f;
			}

			if (aimPitch > 89.0f) aimPitch = 89.0f;
			if (aimPitch < -89.0f) aimPitch = -89.0f;

			if (playerX > mapHalfMeters) playerX = mapHalfMeters;
			if (playerX < -mapHalfMeters) playerX = -mapHalfMeters;
			if (playerZ > mapHalfMeters) playerZ = mapHalfMeters;
			if (playerZ < -mapHalfMeters) playerZ = -mapHalfMeters;

			for (int i = 0; i < mechBotCount; ++i) {
				mechBotHeading[i] += (0.18f + 0.05f * (float)(i % 3)) * dt;
				mechBotX[i] += cosf(mechBotHeading[i]) * mechBotSpeed[i] * dt;
				mechBotZ[i] += sinf(mechBotHeading[i]) * mechBotSpeed[i] * dt;
				if (mechBotX[i] > mapHalfMeters || mechBotX[i] < -mapHalfMeters) {
					mechBotHeading[i] = 3.1415926f - mechBotHeading[i];
				}
				if (mechBotZ[i] > mapHalfMeters || mechBotZ[i] < -mapHalfMeters) {
					mechBotHeading[i] = -mechBotHeading[i];
				}
				if (mechBotX[i] > mapHalfMeters) mechBotX[i] = mapHalfMeters;
				if (mechBotX[i] < -mapHalfMeters) mechBotX[i] = -mapHalfMeters;
				if (mechBotZ[i] > mapHalfMeters) mechBotZ[i] = mapHalfMeters;
				if (mechBotZ[i] < -mapHalfMeters) mechBotZ[i] = -mapHalfMeters;
			}
		}

		// Settings page navigation
		if (mainPage == PAGE_SETTINGS) {
			if (GetAsyncKeyState('0') & 1) { settingsResIndex = 0; }
			if (GetAsyncKeyState('9') & 1) { settingsResIndex = 1; }
			if (GetAsyncKeyState(VK_OEM_PLUS) & 1) { settingsHzIndex = (settingsHzIndex + 1) % g_supportedHzCount; }
			if (GetAsyncKeyState(VK_OEM_MINUS) & 1) { settingsHzIndex = (settingsHzIndex - 1 + g_supportedHzCount) % g_supportedHzCount; }
			if (GetAsyncKeyState(VK_RETURN) & 1) {
				g_appSettings.width = settingsResIndex ? 1920 : 1280;
				g_appSettings.height = settingsResIndex ? 1080 : 720;
				g_appSettings.hz = pick_supported_hz(g_supportedHz[settingsHzIndex % g_supportedHzCount]);
				save_settings_and_restart(&g_appSettings);
			}
		}

		// Operations weapons / AI settings
		if (mainPage == PAGE_OPERATIONS) {
			if (opsSub == OP_WEAPONS) {
				if (GetAsyncKeyState(VK_LEFT) & 1) selRifleFamily = (selRifleFamily - 1 + rifleFamilyCount) % rifleFamilyCount;
				if (GetAsyncKeyState(VK_RIGHT) & 1) selRifleFamily = (selRifleFamily + 1) % rifleFamilyCount;
				if (GetAsyncKeyState(VK_UP) & 1) selAIDiff = (selAIDiff - 1 + 3) % 3;
				if (GetAsyncKeyState(VK_DOWN) & 1) selAIDiff = (selAIDiff + 1) % 3;
				if (GetAsyncKeyState(VK_RETURN) & 1) { opsSub = OP_MATCHMAKING; HANDLE h = CreateThread(NULL,0,matchmaking_thread,NULL,0,NULL); CloseHandle(h); }
			}
		}

		// Present frame: copy latest 8x8 to backbuffer and include preview if enabled
		LONG slot = InterlockedCompareExchange(&publishedIndex, -1, -1);
		if (slot >= 0) {
			// copy produced 8x8 into g_uploadMapped[0]
			uint8_t *src = ring[slot].rgba;
			uint8_t *dst = g_uploadMapped[0] + g_footprint.Offset;
			UINT rowPitch = g_footprint.Footprint.RowPitch;
			for (UINT y = 0; y < FRAME_H; ++y) memcpy(dst + (size_t)rowPitch * y, src + (size_t)FRAME_W * 4 * y, FRAME_W * 4);

			// record copy from uploadMapped[0] into backbuffer and copy preview if present

			// use C++ COM method calls (we compile as C++)
			g_mainCmdAlloc->Reset();
			g_mainCmdList->Reset(g_mainCmdAlloc, NULL);

			UINT idx = g_swapchain->GetCurrentBackBufferIndex();
			ID3D12Resource *back = g_backBuffers[idx];

			D3D12_RESOURCE_BARRIER barrier = { 0 };
			barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
			barrier.Flags = D3D12_RESOURCE_BARRIER_FLAG_NONE;
			barrier.Transition.pResource = back;
			barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
			barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_COPY_DEST;
			barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
			g_mainCmdList->ResourceBarrier(1, &barrier);

			D3D12_TEXTURE_COPY_LOCATION srcLoc = { 0 };
			srcLoc.pResource = g_uploadBuffers[0];
			srcLoc.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
			srcLoc.PlacedFootprint = g_footprint;

			D3D12_TEXTURE_COPY_LOCATION dstLoc = { 0 };
			dstLoc.pResource = back;
			dstLoc.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
			dstLoc.SubresourceIndex = 0;

			D3D12_BOX srcBox = { 0 };
			srcBox.left = 0; srcBox.top = 0; srcBox.front = 0;
			srcBox.right = FRAME_W; srcBox.bottom = FRAME_H; srcBox.back = 1;

			g_mainCmdList->CopyTextureRegion(&dstLoc, 0, 0, 0, &srcLoc, &srcBox);

			if (g_showPreview) {
				// copy preview (produced by DXR or compute) into corner
				D3D12_TEXTURE_COPY_LOCATION srcP = { 0 };
				srcP.pResource = g_previewTexture;
				srcP.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
				srcP.SubresourceIndex = 0;
				g_mainCmdList->CopyTextureRegion(&dstLoc, 10, 10, 0, &srcP, NULL);
			}

			barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_COPY_DEST;
			barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
			g_mainCmdList->ResourceBarrier(1, &barrier);

			g_mainCmdList->Close();
			ID3D12CommandList *lists[] = { (ID3D12CommandList*)g_mainCmdList };
			g_queue->ExecuteCommandLists(1, lists);
			g_swapchain->Present(1, 0);
			wait_for_gpu();
			// Draw simple UI overlay using GDI (keyboard-driven)
			HDC hdc = GetDC(g_hwnd);
			if (hdc) {
				SetBkMode(hdc, TRANSPARENT);
				SetTextColor(hdc, RGB(255,255,255));
				HFONT hf = (HFONT)GetStockObject(DEFAULT_GUI_FONT);
				HFONT oldf = (HFONT)SelectObject(hdc, hf);
				const int left = 20, top = 20;
				if (g_showPreview) {
					TextOutA(hdc, left, top, "Preview: ON (T to toggle)", 22);
				} else {
					TextOutA(hdc, left, top, "Preview: OFF (T to toggle)", 23);
				}
				// Main menu
				int y = top + 30;
				TextOutA(hdc, left, y, "Main Menu:", 10); y += 18;
				TextOutA(hdc, left, y, "[1] Enter Conflict", 17); y += 16;
				TextOutA(hdc, left, y, "[2] Settings", 11); y += 16;
				TextOutA(hdc, left, y, "[3] Operations", 12); y += 20;
				TextOutA(hdc, left, y, "Use number keys to navigate. Press Q to quit.", 39);
				y += 24;
				// Show current page details
				if (mainPage == PAGE_ENTER_CONFLICT) {
					TextOutA(hdc, left, y, "Enter Conflict - Multiplayer Weapon Select:", 40); y += 16;
					char rifleBuf[160];
					snprintf(rifleBuf, sizeof(rifleBuf), "Rifle: %s / %s", rifleFamilies[selRifleFamily], rifleVariants[selRifleFamily][selRifleVariant]);
					TextOutA(hdc, left, y, rifleBuf, (int)strlen(rifleBuf)); y += 16;
					char heavyBuf[160];
					snprintf(heavyBuf, sizeof(heavyBuf), "Bazooka: %s    Handgun: %s", bazookaVariants[selBazooka], handgunVariants[selHandgun]);
					TextOutA(hdc, left, y, heavyBuf, (int)strlen(heavyBuf)); y += 16;
					TextOutA(hdc, left, y, "Arrows=Rifle, Z/X=Bazooka, C/V=Handgun, Enter or N=Next", 58); y += 16;
					char mapBuf[200];
					snprintf(mapBuf, sizeof(mapBuf), "Multiplayer map: %.1f mile x %.1f mile (%.0fm x %.0fm), Mech Bots: %d", mapSizeMiles, mapSizeMiles, mapSizeMeters, mapSizeMeters, mechBotCount);
					TextOutA(hdc, left, y, mapBuf, (int)strlen(mapBuf)); y += 16;
					if (enterSub == EC_MATCHMAKING || g_matchmakingActive) {
						char pbuf[64]; snprintf(pbuf, sizeof(pbuf), "Matchmaking: %.0f%%", g_matchmakingProgress*100.0f);
						TextOutA(hdc, left, y, pbuf, (int)strlen(pbuf)); y += 16;
					}
					if (multiplayerFpsActive) {
						TextOutA(hdc, left, y, "Multiplayer FPS Active (Standard 60 FPS loop)", 43); y += 16;
						char ctrlBuf[220];
						snprintf(ctrlBuf, sizeof(ctrlBuf), "Flight: Space toggles mode, WASD flies, Space up, Ctrl down | Aim: %s", aimWithMouse ? "Mouse" : "Arrow Keys");
						TextOutA(hdc, left, y, ctrlBuf, (int)strlen(ctrlBuf)); y += 16;
						char posBuf[180];
						snprintf(posBuf, sizeof(posBuf), "Player xyz: %.1f %.1f %.1f   Aim yaw/pitch: %.1f %.1f", playerX, playerY, playerZ, aimYaw, aimPitch);
						TextOutA(hdc, left, y, posBuf, (int)strlen(posBuf)); y += 16;
						char botBuf[160];
						snprintf(botBuf, sizeof(botBuf), "Bot[0] xz: %.1f %.1f   Bot[1] xz: %.1f %.1f", mechBotX[0], mechBotZ[0], mechBotX[1], mechBotZ[1]);
						TextOutA(hdc, left, y, botBuf, (int)strlen(botBuf)); y += 16;
					}
				} else if (mainPage == PAGE_SETTINGS) {
					TextOutA(hdc, left, y, "Settings:", 9); y += 16;
					char sbuf[64]; snprintf(sbuf, sizeof(sbuf), "Resolution: %dx%d", g_appSettings.width, g_appSettings.height);
					TextOutA(hdc, left, y, sbuf, (int)strlen(sbuf)); y += 16;
					char hbuf[96]; snprintf(hbuf, sizeof(hbuf), "Refresh target: %d Hz", g_supportedHz[settingsHzIndex % g_supportedHzCount]);
					TextOutA(hdc, left, y, hbuf, (int)strlen(hbuf)); y += 16;
					TextOutA(hdc, left, y, "Use +/- to cycle, Enter to apply", 31); y += 16;
				} else if (mainPage == PAGE_OPERATIONS) {
					TextOutA(hdc, left, y, "Operations (Local AI):", 22); y += 16;
					char obuf[160]; snprintf(obuf, sizeof(obuf), "Rifle: %s/%s  AI: %s  Map: %s", rifleFamilies[selRifleFamily], rifleVariants[selRifleFamily][selRifleVariant], aiDifficulties[selAIDiff], maps[selMap]);
					TextOutA(hdc, left, y, obuf, (int)strlen(obuf)); y += 16;
					if (opsSub == OP_MATCHMAKING || g_matchmakingActive) {
						char pbuf[64]; snprintf(pbuf, sizeof(pbuf), "Local Ops: %.0f%%", g_matchmakingProgress*100.0f);
						TextOutA(hdc, left, y, pbuf, (int)strlen(pbuf)); y += 16;
					}
				}
				SelectObject(hdc, oldf);
				ReleaseDC(g_hwnd, hdc);
			}
		}

		nextTick += period;
		LARGE_INTEGER now; for (;;) { QueryPerformanceCounter(&now); if (now.QuadPart >= nextTick) break; Sleep(0); }
	}

shutdown:
	// Shutdown
	g_running = false;
	WaitForSingleObject(hProducer, INFINITE);
	WaitForSingleObject(hVisual, INFINITE);

	for (UINT i = 0; i < UPLOAD_COUNT; ++i) {
		if (g_uploadBuffers[i]) g_uploadBuffers[i]->Unmap(0, NULL);
		if (g_uploadBuffers[i]) g_uploadBuffers[i]->Release();
		if (g_uploadSmallBuffers[i]) g_uploadSmallBuffers[i]->Unmap(0, NULL);
		if (g_uploadSmallBuffers[i]) g_uploadSmallBuffers[i]->Release();
	}

	CloseHandle(hProducer);
	CloseHandle(hVisual);
	CloseHandle(g_fenceEvent);

	return 0;
}
#endif
