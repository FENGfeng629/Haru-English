using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace HaruEnglishPet;

public partial class SettingsWindow : Window
{
    private const int VK_LBUTTON = 0x01;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private readonly MainWindow _owner;
    private readonly CoreWebView2Environment _env;
    private readonly DispatcherTimer _dragTimer;

    private bool _initStarted = false;
    private bool _isReady = false;
    private bool _hasPositioned = false;
    private bool _isMaximized = false;
    private bool _isDragging = false;
    private POINT _dragStartCursor;
    private double _dragStartLeft;
    private double _dragStartTop;
    private string _pendingTab = "overview";
    private string? _pendingSubTab = null;

    public bool AllowClose { get; set; } = false;
    public bool IsReady => _isReady;

    public IntPtr WindowHandle => new WindowInteropHelper(this).Handle;

    public SettingsWindow(MainWindow owner, CoreWebView2Environment env)
    {
        _owner = owner;
        _env = env;
        InitializeComponent();

        _dragTimer = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(8)
        };
        _dragTimer.Tick += OnDragTimerTick;

        Closing += OnWindowClosing;
    }

    public void ShowTab(string tab = "overview", string? subTab = null)
    {
        _pendingTab = string.IsNullOrWhiteSpace(tab) ? "overview" : tab;
        _pendingSubTab = subTab;

        if (!_hasPositioned)
        {
            _hasPositioned = true;
            var wa = SystemParameters.WorkArea;
            double w = Math.Min(860, wa.Width - 28);
            double h = Math.Min(620, wa.Height - 28);
            Width = w;
            Height = h;
            Left = wa.Left + Math.Round((wa.Width - w) / 2);
            Top = wa.Top + Math.Round((wa.Height - h) / 2);
        }

        if (!_isReady)
        {
            Opacity = 0;
            if (!IsVisible) Show();
            _ = EnsureInitializedAsync();
            return;
        }

        Opacity = 1;
        if (!IsVisible) Show();
        Activate();
        PushTabAndState(_pendingTab, _pendingSubTab);
        _owner.NotifySettingsWindowState(true);
    }

    public void HideWindow()
    {
        StopDrag();
        if (IsVisible) Hide();
        _owner.NotifySettingsWindowState(false);
    }

    public void PostToWeb(JsonObject msg)
    {
        if (SettingsWebView.CoreWebView2 == null) return;
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                SettingsWebView.CoreWebView2?.PostWebMessageAsJson(msg.ToJsonString());
            }
            catch { }
        });
    }

    private async Task EnsureInitializedAsync()
    {
        if (_initStarted) return;
        _initStarted = true;
        try
        {
            _owner.LogFromSettings("EnsureInitializedAsync starting...");
            SettingsWebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;
            await SettingsWebView.EnsureCoreWebView2Async(_env);
            SettingsWebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

            var core = SettingsWebView.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = true;

            var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            core.SetVirtualHostNameToFolderMapping(
                "app.local",
                wwwroot,
                CoreWebView2HostResourceAccessKind.Allow);

            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += (_, navArgs) =>
            {
                _owner.LogFromSettings($"NavigationCompleted ok={navArgs.IsSuccess} status={navArgs.WebErrorStatus}");
                if (!navArgs.IsSuccess)
                {
                    Opacity = 1;
                }
            };
            core.Navigate("https://app.local/index.html?view=settings");
        }
        catch (Exception ex)
        {
            _owner.LogFromSettings($"EnsureInitializedAsync EXCEPTION: {ex}");
            Debug.WriteLine($"SettingsWindow init error: {ex}");
            _initStarted = false;
            HideWindow();
        }
    }

    private void PushTabAndState(string tab, string? subTab)
    {
        var payload = _owner.BuildSettingsSyncMessage("openSettingsTab");
        payload["tab"] = tab;
        if (!string.IsNullOrWhiteSpace(subTab))
            payload["subTab"] = subTab;
        payload["maximized"] = _isMaximized;
        PostToWeb(payload);
    }

    private void ToggleMaximize(bool? desired = null)
    {
        _isMaximized = desired ?? !_isMaximized;
        var wa = SystemParameters.WorkArea;
        double targetW = _isMaximized ? Math.Min(1040, wa.Width - 28) : Math.Min(860, wa.Width - 28);
        double targetH = _isMaximized ? Math.Min(800, wa.Height - 28) : Math.Min(620, wa.Height - 28);
        double centerX = Left + Width / 2;
        double centerY = Top + Height / 2;

        Width = targetW;
        Height = targetH;
        Left = Math.Clamp(Math.Round(centerX - targetW / 2), wa.Left + 8, Math.Max(wa.Left + 8, wa.Right - targetW - 8));
        Top = Math.Clamp(Math.Round(centerY - targetH / 2), wa.Top + 8, Math.Max(wa.Top + 8, wa.Bottom - targetH - 8));

        PostToWeb(new JsonObject
        {
            ["type"] = "settingsMaximizedState",
            ["maximized"] = _isMaximized
        });
    }

    private void StartDrag()
    {
        if ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) == 0) return;
        if (!GetCursorPos(out _dragStartCursor)) return;
        _dragStartLeft = Left;
        _dragStartTop = Top;
        _isDragging = true;
        _dragTimer.Start();
    }

    private void StopDrag()
    {
        _isDragging = false;
        _dragTimer.Stop();
    }

    private void OnDragTimerTick(object? sender, EventArgs e)
    {
        if (!_isDragging)
        {
            _dragTimer.Stop();
            return;
        }
        bool down = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
        if (!down)
        {
            StopDrag();
            return;
        }
        if (!GetCursorPos(out var pt)) return;
        var dpi = VisualTreeHelper.GetDpi(this);
        double dx = (pt.X - _dragStartCursor.X) / dpi.DpiScaleX;
        double dy = (pt.Y - _dragStartCursor.Y) / dpi.DpiScaleY;

        var wa = SystemParameters.WorkArea;
        double w = ActualWidth > 0 ? ActualWidth : Width;
        double h = ActualHeight > 0 ? ActualHeight : Height;
        double targetLeft = Math.Clamp(Math.Round(_dragStartLeft + dx), wa.Left - w + 120, wa.Right - 120);
        double targetTop = Math.Clamp(Math.Round(_dragStartTop + dy), wa.Top, Math.Max(wa.Top, wa.Bottom - 60));

        if (Math.Abs(targetLeft - Left) >= 0.5 || Math.Abs(targetTop - Top) >= 0.5)
        {
            Left = targetLeft;
            Top = targetTop;
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var root = JsonNode.Parse(e.WebMessageAsJson)?.AsObject();
            if (root == null) return;
            var type = root["type"]?.ToString();

            switch (type)
            {
                case "settingsReady":
                    _isReady = true;
                    PushTabAndState(_pendingTab, _pendingSubTab);
                    Opacity = 1;
                    if (!IsVisible) Show();
                    Activate();
                    _owner.NotifySettingsWindowState(true);
                    return;

                case "settingsWinDragStart":
                    StartDrag();
                    return;

                case "settingsWinDragEnd":
                    StopDrag();
                    return;

                case "settingsWinToggleMax":
                    ToggleMaximize();
                    return;

                case "settingsWinClose":
                    HideWindow();
                    return;

                case "livePetScale":
                {
                    double scale = root["scale"]?.GetValue<double>() ?? 1.0;
                    bool done = root["done"]?.GetValue<bool>() ?? false;
                    _owner.ForwardLivePetScale(scale, done);
                    return;
                }

                case "petAction":
                {
                    var action = root["action"]?.ToString() ?? "happy";
                    _owner.ForwardPetAction(action);
                    return;
                }

                case "startWeakQuiz":
                    HideWindow();
                    _owner.StartQuizBookFromSettings("weak");
                    return;

                case "startQuizBook":
                {
                    var bookId = root["bookId"]?.ToString() ?? "all";
                    HideWindow();
                    _owner.StartQuizBookFromSettings(bookId);
                    return;
                }

                case "cancelTts":
                    _owner.CancelTtsFromSettings();
                    return;

                case "ttsPrewarm":
                    _owner.PrewarmTtsFromSettings(root["items"]?.AsArray());
                    return;

                case "log":
                    _owner.LogFromSettings(root["message"]?.ToString() ?? "");
                    return;

                case "rpc":
                {
                    var id = root["id"]?.ToString() ?? "";
                    var method = root["method"]?.ToString() ?? "";
                    var payload = root["payload"]?.AsObject() ?? new JsonObject();
                    JsonNode? result = await _owner.HandleRpcFromSettingsAsync(method, payload);
                    PostToWeb(new JsonObject
                    {
                        ["type"] = "rpcResponse",
                        ["id"] = id,
                        ["data"] = result
                    });
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"SettingsWindow WebMessage error: {ex}");
        }
    }

    private void OnWindowClosing(object? sender, CancelEventArgs e)
    {
        if (!AllowClose)
        {
            e.Cancel = true;
            HideWindow();
        }
        else
        {
            StopDrag();
        }
    }
}
