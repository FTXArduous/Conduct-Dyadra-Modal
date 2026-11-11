using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace _2412Launch;

internal sealed class GameHostForm : Form
{
    private readonly string _webRoot;
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private bool _borderless = true;

    public GameHostForm(string webRoot)
    {
        _webRoot = webRoot;
        Text = "Conduct Dyadra Modal";
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        KeyPreview = true;
        MinimumSize = new Size(960, 600);
        Controls.Add(_webView);
        Load += InitializeGameAsync;
    }

    private async void InitializeGameAsync(object? sender, EventArgs e)
    {
        if (!File.Exists(Path.Combine(_webRoot, "index.html")))
        {
            MessageBox.Show(this, "The bundled game files are missing.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ConductDyadraModal",
                "WebView2",
                "60.5");
            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userData,
                options: new CoreWebView2EnvironmentOptions());
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "conduct-game.local",
                _webRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            var audioRoot = Path.Combine(
                AppContext.BaseDirectory,
                "NativeSamples",
                "D3D12_8x8_engine",
                "build",
                "Release");
            if (Directory.Exists(audioRoot))
            {
                _webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "conduct-audio.local",
                    audioRoot,
                    CoreWebView2HostResourceAccessKind.Allow);
            }
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.WebMessageReceived += (_, message) =>
            {
                var logPath = Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt");
                File.AppendAllText(logPath, $"WebGameMessage={message.WebMessageAsJson} time={DateTime.UtcNow:o}{Environment.NewLine}");
                var command = message.TryGetWebMessageAsString();
                if (command == "exit")
                {
                    Close();
                    return;
                }
                if (command == "toggleWindowMode")
                {
                    ToggleWindowMode();
                    _webView.CoreWebView2.PostWebMessageAsString(_borderless ? "window-mode:borderless" : "window-mode:windowed");
                }
            };
            _webView.CoreWebView2.NavigationCompleted += async (_, navigation) =>
            {
                var logPath = Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt");
                if (!navigation.IsSuccess)
                {
                    File.AppendAllText(logPath, $"WebGameNavigationError={navigation.WebErrorStatus} time={DateTime.UtcNow:o}{Environment.NewLine}");
                    return;
                }

                try
                {
                    string readiness = "null";
                    for (var attempt = 0; attempt < 150 && readiness == "null"; attempt++)
                    {
                        readiness = await _webView.CoreWebView2.ExecuteScriptAsync(
                            "window.__CONDUCT_GAME_READY__ ? JSON.stringify(window.__CONDUCT_GAME_READY__) : null");
                        if (readiness == "null") await Task.Delay(100);
                    }
                    File.AppendAllText(logPath, $"WebGameReady={readiness} time={DateTime.UtcNow:o}{Environment.NewLine}");
                    if (readiness == "null")
                    {
                        const string diagnosticProbe = "JSON.stringify({readyState:document.readyState,title:document.title,canvas:!!document.getElementById('world'),moduleScripts:[...document.querySelectorAll('script[type=module]')].map(s=>s.src),gameError:window.__CONDUCT_GAME_ERROR__||null})";
                        var pageState = await _webView.CoreWebView2.ExecuteScriptAsync(diagnosticProbe);
                        File.AppendAllText(logPath, $"WebGamePageState={pageState} time={DateTime.UtcNow:o}{Environment.NewLine}");
                        Text = "Conduct Dyadra Modal - Game Load Timeout";
                    }
                    else
                    {
                        Text = "Conduct Dyadra Modal - Game Ready";
                    }
                }
                catch (Exception ex)
                {
                    File.AppendAllText(logPath, $"WebGameProbeError={ex.Message} time={DateTime.UtcNow:o}{Environment.NewLine}");
                }
            };
            _webView.Source = new Uri("https://conduct-game.local/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Unable to initialize the game renderer:\n{ex.Message}", Text,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void ToggleWindowMode()
    {
        if (_borderless)
        {
            _borderless = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = FormWindowState.Normal;
            Size = new Size(1600, 900);
            CenterToScreen();
            return;
        }

        _borderless = true;
        FormBorderStyle = FormBorderStyle.None;
        WindowState = FormWindowState.Maximized;
        BringToFront();
    }
}
