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
        ApplicationConfiguration.Initialize();
        var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot", "web");
        Application.Run(new GameHostForm(webRoot));
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

        if (File.Exists(engineExePath))
        {
            return engineExePath;
        }

        if (File.Exists(launcherExePath))
        {
            return launcherExePath;
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