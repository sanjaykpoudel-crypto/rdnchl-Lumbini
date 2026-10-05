using System.Text.Json;

namespace NchlRelay;

/// <summary>Settings stored in relay.json next to the exe.</summary>
public sealed class RelayConfig
{
    /// <summary>Port NetSuite connects to (npiconfig.js HOST points here).</summary>
    public int ListenPort { get; set; } = 8181;

    /// <summary>NCHL base URL every request is forwarded to, e.g. https://nchl-host:port</summary>
    public string TargetUrl { get; set; } = "https://CHANGE-ME-NCHL-HOST";

    /// <summary>If not empty, only these client IPs may use the relay (e.g. NetSuite's outbound IPs).</summary>
    public string[] AllowedClientIps { get; set; } = [];

    public int TimeoutSeconds { get; set; } = 60;

    /// <summary>Only for NCHL test servers with self-signed certificates.</summary>
    public bool IgnoreTargetCertificateErrors { get; set; }

    public static string BaseDir => AppContext.BaseDirectory;
    public static string ConfigPath => Path.Combine(BaseDir, "relay.json");
    public static string LogDir => Path.Combine(BaseDir, "logs");

    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public static RelayConfig Load()
    {
        if (!File.Exists(ConfigPath))
        {
            var defaults = new RelayConfig();
            File.WriteAllText(ConfigPath, JsonSerializer.Serialize(defaults, JsonOptions));
            return defaults;
        }
        return JsonSerializer.Deserialize<RelayConfig>(File.ReadAllText(ConfigPath))
               ?? throw new InvalidOperationException("relay.json is empty");
    }
}

static class Log
{
    static readonly object Gate = new();

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(RelayConfig.LogDir);
            var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}";
            lock (Gate)
            {
                File.AppendAllText(Path.Combine(RelayConfig.LogDir, $"relay-{DateTime.Now:yyyyMMdd}.log"), line);
            }
        }
        catch
        {
            // logging must never take the relay down
        }
    }
}
