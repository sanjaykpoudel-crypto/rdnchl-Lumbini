using System.Diagnostics;

namespace NchlRelay;

/// <summary>Control window: install the service and start / stop / pause / resume it.</summary>
sealed class MainForm : Form
{
    readonly Label statusLabel = new() { AutoSize = true };
    readonly Label infoLabel = new() { AutoSize = true, MaximumSize = new Size(520, 0) };
    readonly System.Windows.Forms.Timer refreshTimer = new() { Interval = 2000 };
    readonly Button installButton, startButton, stopButton, pauseButton, resumeButton, uninstallButton;

    public MainForm()
    {
        Text = "NCHL Relay";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        statusLabel.Font = new Font(Font.FontFamily, 12, FontStyle.Bold);

        var layout = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.TopDown,
            AutoSize = true,
            Padding = new Padding(16),
            WrapContents = false
        };
        var serviceButtons = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 12, 0, 0) };
        var otherButtons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };

        installButton = AddButton(serviceButtons, "Install", ServiceControl.Install);
        startButton = AddButton(serviceButtons, "Start", ServiceControl.Start);
        stopButton = AddButton(serviceButtons, "Stop", ServiceControl.Stop);
        pauseButton = AddButton(serviceButtons, "Pause", ServiceControl.Pause);
        resumeButton = AddButton(serviceButtons, "Resume", ServiceControl.Resume);
        uninstallButton = AddButton(otherButtons, "Uninstall", () =>
        {
            if (MessageBox.Show(this, "Remove the NCHL Relay service?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
            {
                ServiceControl.Uninstall();
            }
        });
        AddButton(otherButtons, "Edit settings", () =>
        {
            RelayConfig.Load(); // creates relay.json with defaults if missing
            Process.Start("notepad.exe", RelayConfig.ConfigPath);
            MessageBox.Show(this, "After saving relay.json, Stop and Start the service to apply the changes.", Text);
        });
        AddButton(otherButtons, "Open logs", () =>
        {
            Directory.CreateDirectory(RelayConfig.LogDir);
            Process.Start("explorer.exe", RelayConfig.LogDir);
        });

        layout.Controls.Add(statusLabel);
        layout.Controls.Add(infoLabel);
        layout.Controls.Add(serviceButtons);
        layout.Controls.Add(otherButtons);
        Controls.Add(layout);

        refreshTimer.Tick += (_, _) => RefreshStatus();
        refreshTimer.Start();
        RefreshStatus();
    }

    Button AddButton(FlowLayoutPanel panel, string text, Action action)
    {
        var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(90, 32) };
        button.Click += (_, _) => RunAction(action);
        panel.Controls.Add(button);
        return button;
    }

    void RunAction(Action action)
    {
        try
        {
            UseWaitCursor = true;
            action();
        }
        catch (Exception e)
        {
            MessageBox.Show(this, e.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            UseWaitCursor = false;
            RefreshStatus();
        }
    }

    void RefreshStatus()
    {
        var status = ServiceControl.Status();
        statusLabel.Text = "Service: " + status;
        statusLabel.ForeColor = status switch
        {
            "Running" => Color.ForestGreen,
            "Paused" => Color.DarkOrange,
            _ => Color.Firebrick
        };
        try
        {
            var config = RelayConfig.Load();
            infoLabel.Text = $"Port {config.ListenPort}  →  {config.TargetUrl}\nFolder: {RelayConfig.BaseDir}";
        }
        catch (Exception e)
        {
            infoLabel.Text = "relay.json has an error: " + e.Message;
        }

        var installed = status != "Not installed";
        installButton.Enabled = !installed;
        startButton.Enabled = status == "Stopped";
        stopButton.Enabled = status is "Running" or "Paused";
        pauseButton.Enabled = status == "Running";
        resumeButton.Enabled = status == "Paused";
        uninstallButton.Enabled = installed;
    }
}
