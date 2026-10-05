using System.Diagnostics;
using System.ServiceProcess;

namespace NchlRelay;

/// <summary>The Windows service: Start/Stop run the relay, Pause/Continue make it answer 503.</summary>
sealed class RelayService : ServiceBase
{
    readonly RelayHost host = new();

    public RelayService()
    {
        ServiceName = ServiceControl.Name;
        CanStop = true;
        CanShutdown = true;
        CanPauseAndContinue = true;
    }

    protected override void OnStart(string[] args)
    {
        try
        {
            host.StartAsync().GetAwaiter().GetResult();
        }
        catch (Exception e)
        {
            Log.Write("START FAILED: " + e.Message);
            throw;
        }
    }

    protected override void OnStop() => host.StopAsync().GetAwaiter().GetResult();

    protected override void OnShutdown() => OnStop();

    protected override void OnPause()
    {
        host.Paused = true;
        Log.Write("PAUSED");
    }

    protected override void OnContinue()
    {
        host.Paused = false;
        Log.Write("RESUMED");
    }
}

/// <summary>Install and control the NchlRelay Windows service.</summary>
static class ServiceControl
{
    public const string Name = "NchlRelay";
    const string DisplayName = "NCHL Relay (NetSuite to NCHL)";
    const string FirewallRule = "NCHL Relay";
    static readonly TimeSpan Wait = TimeSpan.FromSeconds(30);

    public static string Status()
    {
        using var service = Find();
        return service == null ? "Not installed" : service.Status.ToString();
    }

    public static void Install()
    {
        var exe = Environment.ProcessPath ?? throw new InvalidOperationException("Cannot find the exe path");
        var port = RelayConfig.Load().ListenPort;
        Run("sc.exe", "create", Name, "binPath=", $"\"{exe}\" --service", "start=", "auto", "DisplayName=", DisplayName);
        Run("sc.exe", "description", Name, $"Forwards NetSuite NCHL API calls to NCHL. Settings: {RelayConfig.ConfigPath}");
        // restart automatically if the relay crashes
        Run("sc.exe", "failure", Name, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/30000");
        Run("netsh", "advfirewall", "firewall", "add", "rule", $"name={FirewallRule}", "dir=in", "action=allow",
            "protocol=TCP", $"localport={port}");
        Log.Write($"INSTALLED from {exe}");
    }

    public static void Uninstall()
    {
        using (var service = Find())
        {
            if (service != null && service.Status != ServiceControllerStatus.Stopped)
            {
                service.Stop();
                service.WaitForStatus(ServiceControllerStatus.Stopped, Wait);
            }
        }
        Run("sc.exe", "delete", Name);
        try
        {
            Run("netsh", "advfirewall", "firewall", "delete", "rule", $"name={FirewallRule}");
        }
        catch
        {
            // rule may already be gone
        }
        Log.Write("UNINSTALLED");
    }

    public static void Start() => Control(s =>
    {
        s.Start();
        s.WaitForStatus(ServiceControllerStatus.Running, Wait);
    });

    public static void Stop() => Control(s =>
    {
        s.Stop();
        s.WaitForStatus(ServiceControllerStatus.Stopped, Wait);
    });

    public static void Pause() => Control(s =>
    {
        s.Pause();
        s.WaitForStatus(ServiceControllerStatus.Paused, Wait);
    });

    public static void Resume() => Control(s =>
    {
        s.Continue();
        s.WaitForStatus(ServiceControllerStatus.Running, Wait);
    });

    static ServiceController? Find() =>
        ServiceController.GetServices().FirstOrDefault(s => s.ServiceName.Equals(Name, StringComparison.OrdinalIgnoreCase));

    static void Control(Action<ServiceController> action)
    {
        using var service = Find() ?? throw new InvalidOperationException("The NchlRelay service is not installed.");
        action(service);
    }

    static void Run(string file, params string[] args)
    {
        var info = new ProcessStartInfo(file)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException($"Could not run {file}");
        var output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{file} {args[0]} failed: {output.Trim()}");
        }
    }
}
