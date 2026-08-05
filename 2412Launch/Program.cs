using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace _2412Launch;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var exePath = ResolveExecutablePath(args);
        var exeArgs = args.Length > 1 ? args[1] : Environment.GetEnvironmentVariable("PORTAL_EXE_ARGS") ?? string.Empty;
        var menuUrl = args.Length > 2 ? args[2] : Environment.GetEnvironmentVariable("PORTAL_MENU_URL");
        var notify = args.Length > 3 ? args[3] : Environment.GetEnvironmentVariable("PORTAL_NOTIFY_MSG");
        var timeoutStr = args.Length > 4 ? args[4] : Environment.GetEnvironmentVariable("PORTAL_NOTIFY_SEC") ?? "10";
        int timeout = 10;
        int.TryParse(timeoutStr, out timeout);

        try
        {
            if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
            {
                var psi = new ProcessStartInfo(exePath, exeArgs)
                {
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(exePath) ?? AppContext.BaseDirectory
                };
                Process.Start(psi);
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                    $"LauncherStartedExe={exePath} time={DateTime.UtcNow:o}{Environment.NewLine}");
            }
            else
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                    $"LauncherExeMissing={exePath} time={DateTime.UtcNow:o}{Environment.NewLine}");
                notify ??= $"Game executable not found. Expected one of the bundled engine builds under {Path.Combine(AppContext.BaseDirectory, "NativeSamples", "D3D12_8x8_engine", "build", "Release")}";
            }
        }
        catch (Exception ex)
        {
            File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                $"LauncherStartExeError={ex.Message} time={DateTime.UtcNow:o}{Environment.NewLine}");
            notify ??= "Failed to start game: " + ex.Message;
        }

        if (!string.IsNullOrEmpty(menuUrl))
        {
            try
            {
                var ps = new ProcessStartInfo(menuUrl) { UseShellExecute = true };
                Process.Start(ps);
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                    $"LauncherOpenedMenu={menuUrl} time={DateTime.UtcNow:o}{Environment.NewLine}");
            }
            catch (Exception ex)
            {
                File.AppendAllText(Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                    $"LauncherOpenMenuError={ex.Message} time={DateTime.UtcNow:o}{Environment.NewLine}");
                notify ??= "Failed to open menu: " + ex.Message;
            }
        }

        if (!string.IsNullOrEmpty(notify))
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var form = new Form
            {
                FormBorderStyle = FormBorderStyle.None,
                TopMost = true,
                ShowInTaskbar = false,
                StartPosition = FormStartPosition.Manual,
                Size = new Size(420, 100),
                BackColor = Color.FromArgb(34, 34, 34),
                Opacity = 0.95
            };

            var label = new Label
            {
                Text = notify,
                ForeColor = Color.White,
                Dock = DockStyle.Fill,
                Padding = new Padding(8),
                Font = new Font("Segoe UI", 10f, FontStyle.Regular)
            };

            form.Controls.Add(label);

            form.Load += (_, _) =>
            {
                var area = Screen.PrimaryScreen?.WorkingArea ?? Screen.GetWorkingArea(form);
                form.Location = new Point(area.Right - form.Width - 10, area.Top + 10);
            };

            var timer = new System.Windows.Forms.Timer { Interval = Math.Max(1000, timeout) * 1000 };
            timer.Tick += (_, _) => { timer.Stop(); form.Close(); };
            timer.Start();

            Application.Run(form);
        }
    }

    private static string? ResolveExecutablePath(string[] args)
    {
        var configured = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("PORTAL_EXE_PATH");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
        {
            return configured;
        }

        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Release", "D3D12_8x8_engine.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Release", "D3D12_8x8_launcher.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Debug", "D3D12_8x8_engine.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Debug", "D3D12_8x8_launcher.exe")
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return configured;
    }
}