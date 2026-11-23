using System.Threading;
using System.Windows;

namespace HaruEnglishPet;

public partial class App : System.Windows.Application
{
    private Mutex? _singleInstanceMutex;
    private MainWindow? _mainWindow;

    protected override void OnStartup(StartupEventArgs e)
    {
        // Prevent any white flicker before WebView2 initializes
        Environment.SetEnvironmentVariable("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

        _singleInstanceMutex = new Mutex(true, "Global\\HaruEnglishPet_SingleInstance_v1", out bool createdNew);
        if (!createdNew)
        {
            System.Windows.MessageBox.Show(
                "Haru 英语桌宠已经在运行中了！请查看桌面或右下角系统托盘图标。",
                "Haru English Pet",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        base.OnStartup(e);
        _mainWindow = new MainWindow();
        _mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _mainWindow?.CleanupTray();
        _singleInstanceMutex?.ReleaseMutex();
        _singleInstanceMutex?.Dispose();
        base.OnExit(e);
    }
}
