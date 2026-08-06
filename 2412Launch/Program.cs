using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
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
                LogDiagnostic($"LauncherStartedExe={exePath} time={DateTime.UtcNow:o}");
            }
            else
            {
                LogDiagnostic($"LauncherExeMissing={exePath} time={DateTime.UtcNow:o}");
                notify ??= $"Game executable not found. Expected one of the bundled engine builds under {Path.Combine(AppContext.BaseDirectory, "NativeSamples", "D3D12_8x8_engine", "build", "Release")}";
            }
        }
        catch (Exception ex)
        {
            LogDiagnostic($"LauncherStartExeError={ex.Message} time={DateTime.UtcNow:o}");
            notify ??= "Failed to start game: " + ex.Message;
        }

        if (!string.IsNullOrEmpty(menuUrl))
        {
            try
            {
                var ps = new ProcessStartInfo(menuUrl) { UseShellExecute = true };
                Process.Start(ps);
                LogDiagnostic($"LauncherOpenedMenu={menuUrl} time={DateTime.UtcNow:o}");
            }
            catch (Exception ex)
            {
                LogDiagnostic($"LauncherOpenMenuError={ex.Message} time={DateTime.UtcNow:o}");
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
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Release", "D3D12_8x8_launcher.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Release", "D3D12_8x8_engine.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Debug", "D3D12_8x8_launcher.exe"),
            Path.Combine(baseDir, "NativeSamples", "D3D12_8x8_engine", "build", "Debug", "D3D12_8x8_engine.exe"),
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        var extracted = EnsureEmbeddedEngineRuntime();
        if (!string.IsNullOrWhiteSpace(extracted) && File.Exists(extracted))
        {
            return extracted;
        }

        return configured;
    }

    private static string? EnsureEmbeddedEngineRuntime()
    {
        var payloadRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ConductDyadraModal",
            "runtime",
            "final59");

        Directory.CreateDirectory(payloadRoot);

        var engineExePath = Path.Combine(payloadRoot, "D3D12_8x8_engine.exe");
        var launcherExePath = Path.Combine(payloadRoot, "D3D12_8x8_launcher.exe");

        ExtractResource("Payload.D3D12_8x8_engine.exe", engineExePath);
        ExtractResource("Payload.D3D12_8x8_launcher.exe", launcherExePath);

        if (File.Exists(launcherExePath))
        {
            return launcherExePath;
        }

        if (File.Exists(engineExePath))
        {
            return engineExePath;
        }

        return null;
    }

    private static void ExtractResource(string resourceName, string outputPath)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return;
        }

        var tempPath = outputPath + ".tmp";
        if (File.Exists(tempPath))
        {
            File.Delete(tempPath);
        }

        using (var outStream = File.Create(tempPath))
        {
            stream.CopyTo(outStream);
        }

        if (File.Exists(outputPath))
        {
            File.Delete(outputPath);
        }

        File.Move(tempPath, outputPath);
    }

    private static void LogDiagnostic(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(AppContext.BaseDirectory, "startup-diagnostic.txt"),
                message + Environment.NewLine);
        }
        catch
        {
            // Avoid diagnostic write failures breaking startup.
        }
    }
}