using System.Runtime.InteropServices;
using System.ServiceProcess;

namespace NchlRelay;

/// <summary>
/// NchlRelay.exe                 control window
/// NchlRelay.exe --service       run as the Windows service (used by the service manager)
/// NchlRelay.exe run             run the relay in the foreground until Ctrl+C (testing)
/// NchlRelay.exe install | uninstall | start | stop | pause | resume | status
/// </summary>
static class Program
{
    [DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);

    [STAThread]
    static int Main(string[] args)
    {
        var command = args.Length > 0 ? args[0].TrimStart('-', '/').ToLowerInvariant() : "";

        if (command == "service")
        {
            ServiceBase.Run(new RelayService());
            return 0;
        }
        if (command == "")
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
            return 0;
        }

        // command line use: write to the console the exe was started from
        AttachConsole(-1);
        try
        {
            switch (command)
            {
                case "run":
                    var host = new RelayHost();
                    host.StartAsync().GetAwaiter().GetResult();
                    Console.WriteLine("Relay running. Press Ctrl+C to stop.");
                    var stop = new ManualResetEventSlim();
                    Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Set(); };
                    stop.Wait();
                    host.StopAsync().GetAwaiter().GetResult();
                    break;
                case "install": ServiceControl.Install(); break;
                case "uninstall": ServiceControl.Uninstall(); break;
                case "start": ServiceControl.Start(); break;
                case "stop": ServiceControl.Stop(); break;
                case "pause": ServiceControl.Pause(); break;
                case "resume": ServiceControl.Resume(); break;
                case "status": break;
                default:
                    Console.WriteLine("Usage: NchlRelay.exe [install|uninstall|start|stop|pause|resume|status|run]");
                    return 1;
            }
            Console.WriteLine("NchlRelay service: " + ServiceControl.Status());
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("Error: " + e.Message);
            return 1;
        }
    }
}
