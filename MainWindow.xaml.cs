using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using HaruEnglishPet.Models;
using HaruEnglishPet.Services;
using Microsoft.Web.WebView2.Core;
using Forms = System.Windows.Forms;

namespace HaruEnglishPet;

public partial class MainWindow : Window
{
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int VK_LBUTTON = 0x01;
    private const int WM_NCHITTEST = 0x0084;
    private const int WM_MOUSEACTIVATE = 0x0021;
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID_TALK = 0x4101;
    private const int HOTKEY_ID_QUIZ = 0x4102;
    private const int HOTKEY_ID_TOGGLE_PET = 0x4103;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_SHIFT = 0x0004;
    private const uint MOD_WIN = 0x0008;
    private const uint MOD_NOREPEAT = 0x4000;
    private const int HTTRANSPARENT = -1;
    private const int MA_NOACTIVATEANDEAT = 4;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_FRAMECHANGED = 0x0020;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern int GetWindowLong32(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hwnd, int index, int newStyle);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr newStyle);

    private static long GetWindowExStyle(IntPtr hwnd) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GWL_EXSTYLE).ToInt64() : GetWindowLong32(hwnd, GWL_EXSTYLE);

    private static void SetWindowExStyle(IntPtr hwnd, long style)
    {
        if (IntPtr.Size == 8)
            SetWindowLongPtr64(hwnd, GWL_EXSTYLE, new IntPtr(style));
        else
            SetWindowLong32(hwnd, GWL_EXSTYLE, (int)style);
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int pquns);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    private record HitRect(double X, double Y, double W, double H);

    private readonly StorageService _storage;
    private readonly AiApiService _ai = new();
    private readonly TtsService _tts;
    private readonly CloudSyncService _cloud = new();

    private IntPtr _hwnd;
    private Rect _workArea;
    private bool _isClickThrough = false;
    private bool _isDraggingPet = false;
    private bool _dragKeepWindowFixed = false;
    private bool _dragMoved = false;
    private POINT _dragStartCursor;
    private POINT _lastDragCursor;
    private double _dragStartWinLeft;
    private double _dragStartWinTop;
    private double _dragPetOffsetX;
    private double _dragPetW;
    private double _dragDockW;
    private bool _dragFlipLeft;
    private bool _dragCanFlip;
    private double _dragOrigPetDeskLeft;
    private bool _wasLeftButtonDown = false;
    private bool _leftDownLock = false;
    private enum BoundsMaskStage { Idle, WaitingOverlayPaint, WaitingWindowHide, WaitingReveal, WaitingOverlayHide }

    private bool _petVisible = true;
    private int _boundsRevealToken = 0;
    private DispatcherTimer? _revealFallbackTimer;
    private (double Left, double Top, double Width, double Height, int Token)? _pendingBounds;
    private bool _pendingBoundsHooked = false;
    private int _pendingBoundsTicks = 0;
    private BoundsMaskStage _maskStage = BoundsMaskStage.Idle;
    private Window? _freezeOverlay;
    private System.Windows.Controls.Image? _freezeOverlayImage;
    private CoreWebView2Environment? _webViewEnv;
    private SettingsWindow? _settingsWindow;
    private DispatcherTimer? _restoreFadeTimer;
    private DispatcherTimer? _fullscreenTimer;
    private bool _fullscreenDndEnabled = true;
    private bool _hiddenByFullscreen = false;
    private bool _isFullscreenActive = false;
    private List<HitRect> _hitRects = new();
    private readonly object _rectLock = new();
    private readonly object _ttsLock = new();
    private CancellationTokenSource? _ttsCts;
    private readonly DispatcherTimer _cursorTimer;
    private POINT _lastReportedCursor;
    private int _cursorReportTick = 0;

    private Forms.NotifyIcon? _trayIcon;
    private Icon? _generatedIcon;
    private readonly Dictionary<double, Forms.ToolStripMenuItem> _sizeMenuItems = new();
    private readonly Dictionary<string, Forms.ToolStripMenuItem> _activityMenuItems = new();
    private readonly Dictionary<string, Forms.ToolStripMenuItem> _levelMenuItems = new();
    private Forms.ToolStripMenuItem? _toggleShowMenuItem;

    public MainWindow()
    {
        _storage = new StorageService();
        _tts = new TtsService(_storage.DataDir);
        InitializeComponent();

        // Size window tightly around Haru + Side Dock ONLY (never cover the whole desktop!)
        _workArea = SystemParameters.WorkArea;
        var settings = _storage.LoadSettings();
        Topmost = settings.AlwaysOnTop;

        double scale = Math.Clamp(settings.PetScale, 0.45, 1.65);
        double petW = Math.Round(260 * scale);
        double petH = Math.Round(460 * scale);
        double petX = settings.PetX;
        double petY = settings.PetY;
        if (petX < 0 || petY < 0 || petX > _workArea.Width - 80 || petY > _workArea.Height - 80)
        {
            petX = Math.Max(16, _workArea.Width - petW - 76);
            petY = Math.Max(20, _workArea.Height - petH - 18);
        }
        bool dockLeft = (_workArea.Width - (petX + petW)) < 74;
        double minX = Math.Max(0, (dockLeft ? petX - 70 : petX) - 14);
        double maxX = Math.Min(_workArea.Width, (dockLeft ? petX + petW : petX + petW + 70) + 14);
        double minY = Math.Max(0, Math.Min(petY, petY + petH - 345) - 14);
        double maxY = Math.Min(_workArea.Height, petY + petH + 14);

        Left = _workArea.Left + minX;
        Top = _workArea.Top + minY;
        Width = Math.Max(240, maxX - minX);
        Height = Math.Max(240, maxY - minY);

        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;

        _cursorTimer = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(16)
        };
        _cursorTimer.Tick += OnCursorTimerTick;
    }

    private bool _loggedFirstHitRect = false;

    private void DebugLog(string message)
    {
        try
        {
            var logPath = Path.Combine(_storage.DataDir, "startup_debug.log");
            File.AppendAllText(logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
        }
        catch { }
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;

        // Hook Win32 messages for defense-in-depth click-through
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);

        // Start click-through immediately so desktop icons/apps remain clickable even while WebView2 loads
        SetClickThrough(true, force: true);

        var s = _storage.LoadSettings();
        _fullscreenDndEnabled = s.FullscreenDnd;
        ApplyGlobalHotkeys(s.Hotkeys);
        StartFullscreenWatcher();

        DebugLog($"SourceInitialized hwnd=0x{_hwnd.ToInt64():X} win={Left},{Top},{Width}x{Height} workArea={_workArea.Left},{_workArea.Top},{_workArea.Width}x{_workArea.Height} exStyle=0x{GetWindowExStyle(_hwnd):X}");
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_HOTKEY)
        {
            int id = wParam.ToInt32();
            handled = true;
            if (id == HOTKEY_ID_TALK)
            {
                SendTrayCommand("openTalk");
            }
            else if (id == HOTKEY_ID_QUIZ)
            {
                SendTrayCommand("startQuiz");
            }
            else if (id == HOTKEY_ID_TOGGLE_PET)
            {
                _hiddenByFullscreen = false;
                TogglePetVisibility();
            }
            return IntPtr.Zero;
        }
        if (_isClickThrough)
        {
            if (msg == WM_NCHITTEST)
            {
                handled = true;
                return new IntPtr(HTTRANSPARENT);
            }
            if (msg == WM_MOUSEACTIVATE)
            {
                handled = true;
                return new IntPtr(MA_NOACTIVATEANDEAT);
            }
        }
        return IntPtr.Zero;
    }

    private void ApplyGlobalHotkeys(HotkeyConfig? cfg)
    {
        if (_hwnd == IntPtr.Zero) return;
        UnregisterAllHotkeys();
        if (cfg == null) return;
        TryRegisterHotkeyCombo(HOTKEY_ID_TALK, cfg.Talk);
        TryRegisterHotkeyCombo(HOTKEY_ID_QUIZ, cfg.Quiz);
        TryRegisterHotkeyCombo(HOTKEY_ID_TOGGLE_PET, cfg.TogglePet);
    }

    private void UnregisterAllHotkeys()
    {
        if (_hwnd == IntPtr.Zero) return;
        try { UnregisterHotKey(_hwnd, HOTKEY_ID_TALK); } catch { }
        try { UnregisterHotKey(_hwnd, HOTKEY_ID_QUIZ); } catch { }
        try { UnregisterHotKey(_hwnd, HOTKEY_ID_TOGGLE_PET); } catch { }
    }

    private void TryRegisterHotkeyCombo(int id, string? combo)
    {
        if (string.IsNullOrWhiteSpace(combo)) return;
        uint mods = MOD_NOREPEAT;
        uint vk = 0;
        var parts = combo.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var raw in parts)
        {
            var p = raw.ToUpperInvariant();
            if (p is "CTRL" or "CONTROL") mods |= MOD_CONTROL;
            else if (p == "ALT") mods |= MOD_ALT;
            else if (p == "SHIFT") mods |= MOD_SHIFT;
            else if (p is "WIN" or "META") mods |= MOD_WIN;
            else if (p.Length == 1 && ((p[0] >= 'A' && p[0] <= 'Z') || (p[0] >= '0' && p[0] <= '9')))
            {
                vk = p[0];
            }
            else if (p.StartsWith("F") && int.TryParse(p[1..], out int fn) && fn >= 1 && fn <= 12)
            {
                vk = (uint)(0x70 + fn - 1);
            }
            else if (p == "SPACE")
            {
                vk = 0x20;
            }
        }
        if (vk != 0 && (mods & ~MOD_NOREPEAT) != 0)
        {
            RegisterHotKey(_hwnd, id, mods, vk);
        }
    }

    private void StartFullscreenWatcher()
    {
        if (_fullscreenTimer != null) return;
        _fullscreenTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _fullscreenTimer.Tick += (_, _) => CheckFullscreenFocusMode();
        _fullscreenTimer.Start();
    }

    private void CheckFullscreenFocusMode()
    {
        if (!_fullscreenDndEnabled)
        {
            if (_hiddenByFullscreen)
            {
                _hiddenByFullscreen = false;
                _isFullscreenActive = false;
                SetPetVisibility(true);
                PostToWeb(new JsonObject { ["type"] = "fullscreenDnd", ["active"] = false });
            }
            return;
        }

        bool fullNow = IsAnotherAppFullscreen();
        if (fullNow == _isFullscreenActive) return;
        _isFullscreenActive = fullNow;
        PostToWeb(new JsonObject { ["type"] = "fullscreenDnd", ["active"] = fullNow });

        if (fullNow && _petVisible)
        {
            _hiddenByFullscreen = true;
            SetPetVisibility(false);
        }
        else if (!fullNow && _hiddenByFullscreen)
        {
            _hiddenByFullscreen = false;
            SetPetVisibility(true);
        }
    }

    private bool IsAnotherAppFullscreen()
    {
        try
        {
            // QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3, QUNS_PRESENTATION_MODE = 4
            if (SHQueryUserNotificationState(out int state) == 0 && (state == 2 || state == 3 || state == 4))
            {
                return true;
            }

            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero || fg == _hwnd) return false;
            if (_freezeOverlay != null && new WindowInteropHelper(_freezeOverlay).Handle == fg) return false;
            if (_settingsWindow != null && _settingsWindow.WindowHandle == fg) return false;

            var cls = new System.Text.StringBuilder(64);
            GetClassName(fg, cls, cls.Capacity);
            var clsName = cls.ToString();
            if (clsName is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd")
                return false;

            if (GetWindowRect(fg, out var r))
            {
                var screen = Forms.Screen.FromHandle(fg).Bounds;
                bool coversScreen =
                    r.Left <= screen.Left + 2 &&
                    r.Top <= screen.Top + 2 &&
                    r.Right >= screen.Right - 2 &&
                    r.Bottom >= screen.Bottom - 2;
                return coversScreen;
            }
        }
        catch { }
        return false;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        InitSystemTray();
        _cursorTimer.Start();
        // Pre-sync Bing server clock immediately in background so first Edge TTS never suffers 403 retry delay
        _ = _tts.WarmupClockAsync();
        await InitWebViewAsync();
        UpdateClickThroughFromCursor(force: true);
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var userDataFolder = Path.Combine(_storage.DataDir, "WebView2Cache");
            var envOptions = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
            _webViewEnv = env;

            WebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;
            await WebView.EnsureCoreWebView2Async(env);
            WebView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

            var core = WebView.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDevToolsEnabled = true;

            // Auto-allow microphone for Speech-to-Text
            core.PermissionRequested += (_, args) =>
            {
                if (args.PermissionKind == CoreWebView2PermissionKind.Microphone)
                {
                    args.State = CoreWebView2PermissionState.Allow;
                }
            };

            // Map local wwwroot to secure virtual HTTPS host
            var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            core.SetVirtualHostNameToFolderMapping(
                "app.local",
                wwwroot,
                CoreWebView2HostResourceAccessKind.Allow
            );

            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += (_, navArgs) =>
            {
                DebugLog($"NavigationCompleted ok={navArgs.IsSuccess} status={navArgs.WebErrorStatus}");
            };
            core.ProcessFailed += (_, pfArgs) =>
            {
                DebugLog($"ProcessFailed kind={pfArgs.ProcessFailedKind} reason={pfArgs.Reason}");
            };
            DebugLog($"Navigating to https://app.local/index.html (wwwroot={wwwroot}, exists={Directory.Exists(wwwroot)})");
            core.Navigate("https://app.local/index.html");
        }
        catch (Exception ex)
        {
            DebugLog($"InitWebViewAsync EXCEPTION: {ex}");
            System.Windows.MessageBox.Show(
                $"初始化 WebView2 失败：{ex.Message}\n请确认已安装 Microsoft Edge WebView2 Runtime。",
                "Haru English Pet",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            System.Windows.Application.Current.Shutdown();
        }
    }

    private void OnCursorTimerTick(object? sender, EventArgs e)
    {
        if (_hwnd == IntPtr.Zero || !_petVisible) return;
        if (!TryGetCursorCssCoords(out var pt, out double cssX, out double cssY, out bool inWindow)) return;

        // Hardware left mouse button state
        bool leftButtonDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
        bool hitRectNow = inWindow && IsPointInHitRects(cssX, cssY);

        // Instant zero-latency press lock: if left button was pressed inside a pet hit-rect,
        // keep click-through disabled until physical button release so fast flicks NEVER drop the drag!
        if (leftButtonDown && !_wasLeftButtonDown)
        {
            _leftDownLock = hitRectNow;
        }
        else if (!leftButtonDown)
        {
            _leftDownLock = false;
            if (_isDraggingPet)
            {
                FinishNativeDrag();
            }
        }
        _wasLeftButtonDown = leftButtonDown;

        bool hit = _isDraggingPet || _leftDownLock || (!leftButtonDown && hitRectNow);
        SetClickThrough(!hit);

        // High-frequency (125Hz) dragging:
        // - When no modal is open: move tight window natively so Haru glides with zero resize/lag.
        // - When Settings/Words modal is open: keep window stationary so modal never moves, stream cursor to JS!
        if (_isDraggingPet && leftButtonDown)
        {
            var dpi = VisualTreeHelper.GetDpi(this);
            double dx = (pt.X - _dragStartCursor.X) / dpi.DpiScaleX;
            double dy = (pt.Y - _dragStartCursor.Y) / dpi.DpiScaleY;
            if (!_dragMoved && Math.Sqrt(dx * dx + dy * dy) > 4.0)
            {
                _dragMoved = true;
                PostToWeb(new JsonObject { ["type"] = "dragStarted" });
            }
            if (_dragMoved)
            {
                if (_dragKeepWindowFixed)
                {
                    if (pt.X != _lastDragCursor.X || pt.Y != _lastDragCursor.Y)
                    {
                        _lastDragCursor = pt;
                        PostToWeb(new JsonObject
                        {
                            ["type"] = "dragMove",
                            ["dx"] = Math.Round(dx, 1),
                            ["dy"] = Math.Round(dy, 1)
                        });
                    }
                }
                else
                {
                    _workArea = SystemParameters.WorkArea;
                    double curW = ActualWidth > 0 ? ActualWidth : Width;
                    double curH = ActualHeight > 0 ? ActualHeight : Height;

                    // Mid-drag seamless edge flip: Haru's body gets edge priority so one single drag
                    // reaches the far-left or far-right desktop edge without the side dock blocking!
                    double unclampedLeft = _dragStartWinLeft + dx;
                    if (_dragCanFlip && _dragDockW > 0 && _dragPetW > 0)
                    {
                        double petDeskLeft = unclampedLeft + _dragPetOffsetX;
                        double petDeskRight = petDeskLeft + _dragPetW;

                        if (!_dragFlipLeft &&
                            petDeskRight >= _workArea.Right - _dragDockW - 24 &&
                            petDeskLeft >= _workArea.Left + _dragDockW + 16)
                        {
                            double shift = Math.Min(_dragDockW, Math.Max(0, curW - (_dragPetOffsetX + _dragPetW) - 14));
                            _dragFlipLeft = true;
                            if (shift > 0)
                            {
                                _dragStartWinLeft -= shift;
                                _dragPetOffsetX += shift;
                                unclampedLeft = _dragStartWinLeft + dx;
                            }
                            PostToWeb(new JsonObject
                            {
                                ["type"] = "dragEdgeFlip",
                                ["flipLeft"] = true,
                                ["shiftX"] = Math.Round(shift)
                            });
                        }
                        else if (_dragFlipLeft &&
                                 petDeskLeft <= _workArea.Left + _dragDockW + 24 &&
                                 petDeskRight <= _workArea.Right - _dragDockW - 16)
                        {
                            double shift = Math.Min(_dragDockW, Math.Max(0, _dragPetOffsetX - 14));
                            _dragFlipLeft = false;
                            if (shift > 0)
                            {
                                _dragStartWinLeft += shift;
                                _dragPetOffsetX -= shift;
                                unclampedLeft = _dragStartWinLeft + dx;
                            }
                            PostToWeb(new JsonObject
                            {
                                ["type"] = "dragEdgeFlip",
                                ["flipLeft"] = false,
                                ["shiftX"] = -Math.Round(shift)
                            });
                        }
                    }

                    double targetLeft = Math.Clamp(unclampedLeft, _workArea.Left, Math.Max(_workArea.Left, _workArea.Right - curW));
                    double targetTop = Math.Clamp(_dragStartWinTop + dy, _workArea.Top, Math.Max(_workArea.Top, _workArea.Bottom - curH));
                    if (Math.Abs(targetLeft - Left) >= 0.5 || Math.Abs(targetTop - Top) >= 0.5)
                    {
                        Left = targetLeft;
                        Top = targetTop;
                    }
                }
            }
            return;
        }

        // Forward cursor coordinates (window-local DIPs) to Haru for smooth desktop eye-tracking (~15Hz)
        _cursorReportTick++;
        if (_cursorReportTick % 4 == 0 &&
            (Math.Abs(pt.X - _lastReportedCursor.X) > 3 || Math.Abs(pt.Y - _lastReportedCursor.Y) > 3))
        {
            _lastReportedCursor = pt;
            PostToWeb(new JsonObject
            {
                ["type"] = "globalCursor",
                ["x"] = Math.Round(cssX, 1),
                ["y"] = Math.Round(cssY, 1)
            });
        }
    }

    private void FinishNativeDrag()
    {
        double releaseCssX = 0;
        double releaseCssY = 0;
        bool wasMoved = _dragMoved;
        if (TryGetCursorCssCoords(out var pt, out double cssX, out double cssY, out _))
        {
            releaseCssX = Math.Round(cssX, 1);
            releaseCssY = Math.Round(cssY, 1);
            var dpi = VisualTreeHelper.GetDpi(this);
            double finalDx = (pt.X - _dragStartCursor.X) / dpi.DpiScaleX;
            double finalDy = (pt.Y - _dragStartCursor.Y) / dpi.DpiScaleY;
            if (Math.Sqrt(finalDx * finalDx + finalDy * finalDy) > 4.0)
                wasMoved = true;
        }
        bool wasFixed = _dragKeepWindowFixed;
        double appliedDx = wasFixed
            ? 0
            : Math.Round((Left + _dragPetOffsetX) - _dragOrigPetDeskLeft);
        double appliedDy = Math.Round(Top - _dragStartWinTop);
        if (Math.Abs(appliedDx) > 2 || Math.Abs(appliedDy) > 2)
            wasMoved = true;
        double winX = Math.Round(Left - _workArea.Left);
        double winY = Math.Round(Top - _workArea.Top);

        _isDraggingPet = false;
        _dragKeepWindowFixed = false;
        _dragMoved = false;
        _dragCanFlip = false;
        SetCursorTimerHighSpeed(false);
        UpdateClickThroughFromCursor();

        PostToWeb(new JsonObject
        {
            ["type"] = "dragFinished",
            ["moved"] = wasMoved,
            ["keepWindowFixed"] = wasFixed,
            ["dx"] = appliedDx,
            ["dy"] = appliedDy,
            ["winX"] = winX,
            ["winY"] = winY,
            ["clickX"] = releaseCssX,
            ["clickY"] = releaseCssY
        });
    }

    private void ApplyWindowBounds(double relX, double relY, double w, double h, int token = 0, Rect? freezeRect = null)
    {
        if (_isDraggingPet) return;
        _workArea = SystemParameters.WorkArea;

        double targetW = Math.Clamp(Math.Round(w), 180, _workArea.Width);
        double targetH = Math.Clamp(Math.Round(h), 180, _workArea.Height);
        double targetRelX = Math.Clamp(Math.Round(relX), 0, Math.Max(0, _workArea.Width - targetW));
        double targetRelY = Math.Clamp(Math.Round(relY), 0, Math.Max(0, _workArea.Height - targetH));

        double targetLeft = _workArea.Left + targetRelX;
        double targetTop = _workArea.Top + targetRelY;

        bool originMoved = Math.Abs(Left - targetLeft) >= 2 || Math.Abs(Top - targetTop) >= 2;
        bool sizeChanged = Math.Abs(Width - targetW) >= 2 || Math.Abs(Height - targetH) >= 2;

        // Zero-blink & zero-ghost transition:
        // 1. Capture live screen pixels of [Haru + Side Dock] into a click-through topmost freeze overlay
        //    so Haru and the Side Dock stay 100% motionless without blinking!
        // 2. Hide MainWindow (Opacity = 0) behind the freeze overlay, move/resize HWND invisibly (zero top-left ghost!),
        //    let Chromium paint the final layout, reveal MainWindow (Opacity = 1), then hide the freeze overlay!
        bool maskTransition = token > 0 && originMoved && (sizeChanged || targetLeft < Left - 4 || targetTop < Top - 4);
        if (maskTransition)
        {
            _boundsRevealToken = token;
            _pendingBounds = (targetLeft, targetTop, targetW, targetH, token);
            BeginAnimation(OpacityProperty, null);

            bool froze = _petVisible && freezeRect.HasValue && TryShowFreezeOverlay(freezeRect.Value);
            if (froze)
            {
                _maskStage = BoundsMaskStage.WaitingOverlayPaint;
                _pendingBoundsTicks = 1;
            }
            else
            {
                Opacity = 0;
                _maskStage = BoundsMaskStage.WaitingWindowHide;
                _pendingBoundsTicks = 2;
            }

            StartRevealFallbackTimer();
            HookMaskCompositionTick();
            return;
        }

        ApplyWindowBoundsDirect(targetLeft, targetTop, targetW, targetH);
    }

    private void HookMaskCompositionTick()
    {
        if (!_pendingBoundsHooked)
        {
            _pendingBoundsHooked = true;
            CompositionTarget.Rendering += OnPendingBoundsCompositionTick;
        }
    }

    private void UnhookMaskCompositionTick()
    {
        if (_pendingBoundsHooked)
        {
            _pendingBoundsHooked = false;
            CompositionTarget.Rendering -= OnPendingBoundsCompositionTick;
        }
    }

    private void OnPendingBoundsCompositionTick(object? sender, EventArgs e)
    {
        if (--_pendingBoundsTicks > 0) return;

        if (_maskStage == BoundsMaskStage.WaitingOverlayPaint)
        {
            // Freeze overlay is now painted on DWM; safely hide MainWindow behind it with ZERO blink!
            BeginAnimation(OpacityProperty, null);
            Opacity = 0;
            _maskStage = BoundsMaskStage.WaitingWindowHide;
            _pendingBoundsTicks = 2;
            return;
        }

        if (_maskStage == BoundsMaskStage.WaitingWindowHide)
        {
            UnhookMaskCompositionTick();
            var pending = _pendingBounds;
            _pendingBounds = null;
            if (pending == null || _isDraggingPet)
            {
                RevealWindowNow(immediate: true);
                return;
            }

            ApplyWindowBoundsDirect(pending.Value.Left, pending.Value.Top, pending.Value.Width, pending.Value.Height);
            _maskStage = BoundsMaskStage.WaitingReveal;
            PostToWeb(new JsonObject
            {
                ["type"] = "windowBoundsApplied",
                ["token"] = pending.Value.Token
            });
            return;
        }

        if (_maskStage == BoundsMaskStage.WaitingOverlayHide)
        {
            UnhookMaskCompositionTick();
            HideFreezeOverlay();
            _maskStage = BoundsMaskStage.Idle;
            return;
        }

        UnhookMaskCompositionTick();
        _maskStage = BoundsMaskStage.Idle;
    }

    private bool TryShowFreezeOverlay(Rect relRect)
    {
        try
        {
            double dipLeft = _workArea.Left + Math.Clamp(Math.Round(relRect.X), 0, Math.Max(0, _workArea.Width - 20));
            double dipTop = _workArea.Top + Math.Clamp(Math.Round(relRect.Y), 0, Math.Max(0, _workArea.Height - 20));
            double dipW = Math.Clamp(Math.Round(relRect.Width), 20, Math.Max(20, _workArea.Right - dipLeft));
            double dipH = Math.Clamp(Math.Round(relRect.Height), 20, Math.Max(20, _workArea.Bottom - dipTop));

            var dpi = VisualTreeHelper.GetDpi(this);
            int pxLeft = (int)Math.Round(dipLeft * dpi.DpiScaleX);
            int pxTop = (int)Math.Round(dipTop * dpi.DpiScaleY);
            int pxW = Math.Max(1, (int)Math.Round(dipW * dpi.DpiScaleX));
            int pxH = Math.Max(1, (int)Math.Round(dipH * dpi.DpiScaleY));

            using var bmp = new Bitmap(pxW, pxH, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(pxLeft, pxTop, 0, 0, new System.Drawing.Size(pxW, pxH), CopyPixelOperation.SourceCopy);
            }

            IntPtr hBitmap = bmp.GetHbitmap();
            BitmapSource src;
            try
            {
                src = Imaging.CreateBitmapSourceFromHBitmap(
                    hBitmap,
                    IntPtr.Zero,
                    Int32Rect.Empty,
                    BitmapSizeOptions.FromEmptyOptions());
                src.Freeze();
            }
            finally
            {
                DeleteObject(hBitmap);
            }

            EnsureFreezeOverlay();
            if (_freezeOverlay == null || _freezeOverlayImage == null) return false;

            _freezeOverlayImage.Source = src;
            _freezeOverlay.Left = dipLeft;
            _freezeOverlay.Top = dipTop;
            _freezeOverlay.Width = dipW;
            _freezeOverlay.Height = dipH;
            _freezeOverlay.Topmost = Topmost;
            if (!_freezeOverlay.IsVisible)
            {
                _freezeOverlay.Show();
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void EnsureFreezeOverlay()
    {
        if (_freezeOverlay != null) return;
        _freezeOverlayImage = new System.Windows.Controls.Image
        {
            Stretch = Stretch.Fill,
            IsHitTestVisible = false
        };
        _freezeOverlay = new Window
        {
            WindowStyle = WindowStyle.None,
            AllowsTransparency = false,
            ResizeMode = ResizeMode.NoResize,
            ShowInTaskbar = false,
            ShowActivated = false,
            Topmost = true,
            IsHitTestVisible = false,
            Content = _freezeOverlayImage
        };
        _freezeOverlay.SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(_freezeOverlay).Handle;
            if (hwnd != IntPtr.Zero)
            {
                long ex = GetWindowExStyle(hwnd);
                SetWindowExStyle(hwnd, ex | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
            }
        };
    }

    private void HideFreezeOverlay()
    {
        if (_freezeOverlay != null && _freezeOverlay.IsVisible)
        {
            _freezeOverlay.Hide();
        }
        if (_freezeOverlayImage != null)
        {
            _freezeOverlayImage.Source = null;
        }
    }

    private void ApplyWindowBoundsDirect(double targetLeft, double targetTop, double targetW, double targetH)
    {
        bool expanding = targetW > Width || targetH > Height;
        if (expanding)
        {
            if (Math.Abs(Left - targetLeft) >= 1) Left = targetLeft;
            if (Math.Abs(Top - targetTop) >= 1) Top = targetTop;
            if (Math.Abs(Width - targetW) >= 1) Width = targetW;
            if (Math.Abs(Height - targetH) >= 1) Height = targetH;
        }
        else
        {
            if (Math.Abs(Width - targetW) >= 1) Width = targetW;
            if (Math.Abs(Height - targetH) >= 1) Height = targetH;
            if (Math.Abs(Left - targetLeft) >= 1) Left = targetLeft;
            if (Math.Abs(Top - targetTop) >= 1) Top = targetTop;
        }

        UpdateClickThroughFromCursor();
    }

    private void StartRevealFallbackTimer()
    {
        if (_revealFallbackTimer == null)
        {
            _revealFallbackTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(220) };
            _revealFallbackTimer.Tick += (_, _) => RevealWindowNow(immediate: true);
        }
        _revealFallbackTimer.Stop();
        _revealFallbackTimer.Start();
    }

    private void RevealWindowNow(bool immediate = false)
    {
        _revealFallbackTimer?.Stop();
        BeginAnimation(OpacityProperty, null);
        if (Opacity < 1) Opacity = 1;

        if (!immediate && _freezeOverlay != null && _freezeOverlay.IsVisible)
        {
            // Keep freeze overlay 1 tick longer until MainWindow (Opacity = 1) is painted on DWM
            _maskStage = BoundsMaskStage.WaitingOverlayHide;
            _pendingBoundsTicks = 1;
            HookMaskCompositionTick();
        }
        else
        {
            UnhookMaskCompositionTick();
            HideFreezeOverlay();
            _maskStage = BoundsMaskStage.Idle;
        }
    }

    private bool TryGetCursorCssCoords(out POINT pt, out double cssX, out double cssY, out bool inWindow)
    {
        cssX = 0;
        cssY = 0;
        inWindow = false;
        if (!GetCursorPos(out pt)) return false;

        var dpi = VisualTreeHelper.GetDpi(this);
        if (GetWindowRect(_hwnd, out var winRect))
        {
            inWindow = pt.X >= winRect.Left && pt.X <= winRect.Right && pt.Y >= winRect.Top && pt.Y <= winRect.Bottom;
            cssX = (pt.X - winRect.Left) / dpi.DpiScaleX;
            cssY = (pt.Y - winRect.Top) / dpi.DpiScaleY;
        }
        else
        {
            inWindow = true;
            cssX = (pt.X / dpi.DpiScaleX) - Left;
            cssY = (pt.Y / dpi.DpiScaleY) - Top;
        }
        return true;
    }

    private bool IsPointInHitRects(double cssX, double cssY)
    {
        lock (_rectLock)
        {
            foreach (var r in _hitRects)
            {
                if (cssX >= r.X && cssX <= r.X + r.W && cssY >= r.Y && cssY <= r.Y + r.H)
                    return true;
            }
        }
        return false;
    }

    private void UpdateClickThroughFromCursor(bool force = false)
    {
        if (_hwnd == IntPtr.Zero || !_petVisible) return;
        if (!TryGetCursorCssCoords(out _, out double cssX, out double cssY, out bool inWindow))
        {
            SetClickThrough(true, force);
            return;
        }
        bool hitRectNow = inWindow && IsPointInHitRects(cssX, cssY);
        bool hit = _isDraggingPet || _leftDownLock || hitRectNow;
        SetClickThrough(!hit, force);
    }

    private void SetCursorTimerHighSpeed(bool highSpeed)
    {
        var target = highSpeed ? TimeSpan.FromMilliseconds(8) : TimeSpan.FromMilliseconds(16);
        if (_cursorTimer.Interval != target)
            _cursorTimer.Interval = target;
    }

    private void SetClickThrough(bool clickThrough, bool force = false)
    {
        if (_hwnd == IntPtr.Zero) return;

        long exStyle = GetWindowExStyle(_hwnd);
        bool actualTransparent = (exStyle & WS_EX_TRANSPARENT) != 0;
        bool hasLayered = (exStyle & WS_EX_LAYERED) != 0;
        bool hasToolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;

        if (!force && _isClickThrough == clickThrough && actualTransparent == clickThrough && hasLayered && hasToolWindow)
            return;

        _isClickThrough = clickThrough;
        long nextStyle = clickThrough
            ? (exStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW)
            : ((exStyle & ~WS_EX_TRANSPARENT) | WS_EX_LAYERED | WS_EX_TOOLWINDOW);

        SetWindowExStyle(_hwnd, nextStyle);
        SetWindowPos(_hwnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        WebView.IsHitTestVisible = !clickThrough;

        // Also mirror WS_EX_TRANSPARENT on any internal child HWNDs (e.g. Chrome_WidgetWin_*) created by WebView2
        EnumChildWindows(_hwnd, (childHwnd, _) =>
        {
            long childEx = GetWindowExStyle(childHwnd);
            long nextChildEx = clickThrough
                ? (childEx | WS_EX_TRANSPARENT)
                : (childEx & ~WS_EX_TRANSPARENT);
            if (nextChildEx != childEx)
            {
                SetWindowExStyle(childHwnd, nextChildEx);
                SetWindowPos(childHwnd, IntPtr.Zero, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
            }
            return true;
        }, IntPtr.Zero);
    }

    private CancellationTokenSource StartNewTtsCts()
    {
        var next = new CancellationTokenSource();
        CancellationTokenSource? prev;
        lock (_ttsLock)
        {
            prev = _ttsCts;
            _ttsCts = next;
        }
        if (prev != null)
        {
            try { prev.Cancel(); } catch { }
        }
        return next;
    }

    private void ReleaseTtsCts(CancellationTokenSource cts)
    {
        lock (_ttsLock)
        {
            if (ReferenceEquals(_ttsCts, cts))
                _ttsCts = null;
        }
        try { cts.Dispose(); } catch { }
    }

    private void CancelPendingTts()
    {
        CancellationTokenSource? prev;
        lock (_ttsLock)
        {
            prev = _ttsCts;
            _ttsCts = null;
        }
        if (prev != null)
        {
            try { prev.Cancel(); } catch { }
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var root = JsonNode.Parse(e.WebMessageAsJson)?.AsObject();
            if (root == null) return;
            var type = root["type"]?.ToString();

            if (type == "log")
            {
                DebugLog($"[JS] {root["message"]?.ToString()}");
                return;
            }

            if (type == "cancelTts")
            {
                CancelPendingTts();
                return;
            }

            if (type == "setWindowBounds")
            {
                double rx = root["x"]?.GetValue<double>() ?? 0;
                double ry = root["y"]?.GetValue<double>() ?? 0;
                double rw = root["w"]?.GetValue<double>() ?? Width;
                double rh = root["h"]?.GetValue<double>() ?? Height;
                int token = root["token"]?.GetValue<int>() ?? 0;
                Rect? freezeRect = null;
                if (root["freezeRect"] is JsonObject fr)
                {
                    double fx = fr["x"]?.GetValue<double>() ?? 0;
                    double fy = fr["y"]?.GetValue<double>() ?? 0;
                    double fw = fr["w"]?.GetValue<double>() ?? 0;
                    double fh = fr["h"]?.GetValue<double>() ?? 0;
                    if (fw >= 40 && fh >= 40)
                        freezeRect = new Rect(fx, fy, fw, fh);
                }
                ApplyWindowBounds(rx, ry, rw, rh, token, freezeRect);
                return;
            }

            if (type == "revealWindow")
            {
                int token = root["token"]?.GetValue<int>() ?? 0;
                if (token == 0 || token >= _boundsRevealToken)
                {
                    RevealWindowNow();
                }
                return;
            }

            if (type == "openSettings")
            {
                var tab = root["tab"]?.ToString() ?? "overview";
                var subTab = root["subTab"]?.ToString();
                OpenSettingsWindow(tab, subTab);
                return;
            }

            if (type == "closeSettings")
            {
                _settingsWindow?.HideWindow();
                return;
            }

            if (type == "ttsPrewarm")
            {
                PrewarmTtsFromSettings(root["items"]?.AsArray());
                return;
            }

            if (type == "setHitRects")
            {
                var arr = root["rects"]?.AsArray();
                var list = new List<HitRect>();
                if (arr != null)
                {
                    foreach (var item in arr)
                    {
                        if (item is JsonObject o)
                        {
                            list.Add(new HitRect(
                                o["x"]?.GetValue<double>() ?? 0,
                                o["y"]?.GetValue<double>() ?? 0,
                                o["w"]?.GetValue<double>() ?? 0,
                                o["h"]?.GetValue<double>() ?? 0
                            ));
                        }
                    }
                }
                lock (_rectLock) { _hitRects = list; }
                UpdateClickThroughFromCursor();
                if (!_loggedFirstHitRect && list.Count > 0)
                {
                    _loggedFirstHitRect = true;
                    DebugLog($"First setHitRects count={list.Count} first=({list[0].X},{list[0].Y},{list[0].W}x{list[0].H})");
                }
                return;
            }

            if (type == "setDragging")
            {
                bool wantDrag = root["dragging"]?.GetValue<bool>() ?? false;
                bool keepFixed = root["keepWindowFixed"]?.GetValue<bool>() ?? false;
                bool leftButtonDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
                if (wantDrag && leftButtonDown)
                {
                    RevealWindowNow(immediate: true);
                    _isDraggingPet = true;
                    _dragKeepWindowFixed = keepFixed;
                    _dragMoved = false;
                    _lastDragCursor = default;
                    GetCursorPos(out _dragStartCursor);
                    _dragStartWinLeft = Left;
                    _dragStartWinTop = Top;
                    _dragPetOffsetX = root["petOffsetX"]?.GetValue<double>() ?? 0;
                    _dragPetW = root["petW"]?.GetValue<double>() ?? 0;
                    _dragDockW = root["dockW"]?.GetValue<double>() ?? 0;
                    _dragFlipLeft = root["flipLeft"]?.GetValue<bool>() ?? false;
                    _dragCanFlip = root["canFlip"]?.GetValue<bool>() ?? false;
                    _dragOrigPetDeskLeft = Left + _dragPetOffsetX;
                    SetCursorTimerHighSpeed(true);
                    SetClickThrough(false);
                }
                else
                {
                    if (_isDraggingPet)
                    {
                        FinishNativeDrag();
                    }
                    else
                    {
                        SetCursorTimerHighSpeed(false);
                        if (wantDrag && !leftButtonDown)
                        {
                            PostToWeb(new JsonObject { ["type"] = "forceEndDrag" });
                        }
                        UpdateClickThroughFromCursor();
                    }
                }
                return;
            }

            if (type == "rpc")
            {
                var id = root["id"]?.ToString() ?? "";
                var method = root["method"]?.ToString() ?? "";
                var payload = root["payload"]?.AsObject() ?? new JsonObject();
                JsonNode? result = await HandleRpcAsync(method, payload, fromSettingsWindow: false);
                PostToWeb(new JsonObject
                {
                    ["type"] = "rpcResponse",
                    ["id"] = id,
                    ["data"] = result
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"WebMessage error: {ex}");
        }
    }

    public void OpenSettingsWindow(string tab = "overview", string? subTab = null)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (_webViewEnv == null) return;
            _settingsWindow ??= new SettingsWindow(this, _webViewEnv);
            _settingsWindow.ShowTab(tab, subTab);
        });
    }

    public void NotifySettingsWindowState(bool isOpen)
    {
        PostToWeb(new JsonObject
        {
            ["type"] = "settingsWindowState",
            ["open"] = isOpen
        });
    }

    public JsonObject BuildSettingsSyncMessage(string type)
    {
        return new JsonObject
        {
            ["type"] = type,
            ["settings"] = JsonSerializer.SerializeToNode(_storage.LoadSettings(), StorageService.JsonOptions),
            ["weakWords"] = JsonSerializer.SerializeToNode(_storage.LoadWeakWords(), StorageService.JsonOptions),
            ["stats"] = JsonSerializer.SerializeToNode(_storage.LoadStats(), StorageService.JsonOptions),
            ["knowledgePacks"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions),
            ["dataDir"] = _storage.DataDir
        };
    }

    private void SyncStateToSettingsWindow()
    {
        if (_settingsWindow == null || !_settingsWindow.IsReady) return;
        _settingsWindow.PostToWeb(BuildSettingsSyncMessage("syncFromPet"));
    }

    private void SyncStateToPetWindow()
    {
        PostToWeb(BuildSettingsSyncMessage("syncFromSettings"));
    }

    public void ForwardLivePetScale(double scale, bool done)
    {
        PostToWeb(new JsonObject
        {
            ["type"] = "livePetScale",
            ["scale"] = scale,
            ["done"] = done
        });
    }

    public void ForwardPetAction(string action)
    {
        PostToWeb(new JsonObject
        {
            ["type"] = "petAction",
            ["action"] = action
        });
    }

    public void StartQuizBookFromSettings(string bookId = "all")
    {
        Dispatcher.BeginInvoke(() => SendTrayCommand("startQuizBook", JsonValue.Create(bookId)));
    }

    public void CancelTtsFromSettings() => CancelPendingTts();

    public void LogFromSettings(string message) => DebugLog($"[SettingsJS] {message}");

    public void PrewarmTtsFromSettings(JsonArray? itemsArr)
    {
        if (itemsArr == null || itemsArr.Count == 0) return;
        var settings = _storage.LoadSettings();
        var requests = new List<(VoiceConfig voice, string text)>();
        foreach (var item in itemsArr)
        {
            if (item is JsonObject o)
            {
                var txt = o["text"]?.ToString() ?? "";
                if (string.IsNullOrWhiteSpace(txt)) continue;
                var vCfg = o["voice"] != null
                    ? JsonSerializer.Deserialize<VoiceConfig>(o["voice"]!.ToJsonString(), StorageService.JsonOptions) ?? settings.Voice
                    : settings.Voice;
                requests.Add((vCfg, txt));
            }
        }
        if (requests.Count > 0)
        {
            _ = _tts.PrewarmBatchAsync(requests, settings.Api);
        }
    }

    public Task<JsonNode?> HandleRpcFromSettingsAsync(string method, JsonObject payload) =>
        HandleRpcAsync(method, payload, fromSettingsWindow: true);

    private async Task<JsonNode?> HandleRpcAsync(string method, JsonObject payload, bool fromSettingsWindow = false)
    {
        switch (method)
        {
            case "getInitialState":
            {
                var settings = _storage.LoadSettings();
                var weakWords = _storage.LoadWeakWords();
                var stats = _storage.LoadStats();
                var packs = _storage.LoadAllKnowledgePacks();
                JsonObject? workAreaJson = null;
                JsonObject? winBoundsJson = null;
                Dispatcher.Invoke(() =>
                {
                    _workArea = SystemParameters.WorkArea;
                    SyncTrayChecks(settings);
                    workAreaJson = new JsonObject
                    {
                        ["left"] = _workArea.Left,
                        ["top"] = _workArea.Top,
                        ["width"] = _workArea.Width,
                        ["height"] = _workArea.Height
                    };
                    winBoundsJson = new JsonObject
                    {
                        ["x"] = Math.Round(Left - _workArea.Left),
                        ["y"] = Math.Round(Top - _workArea.Top),
                        ["w"] = Math.Round(Width),
                        ["h"] = Math.Round(Height)
                    };
                });
                return new JsonObject
                {
                    ["settings"] = JsonSerializer.SerializeToNode(settings, StorageService.JsonOptions),
                    ["weakWords"] = JsonSerializer.SerializeToNode(weakWords, StorageService.JsonOptions),
                    ["stats"] = JsonSerializer.SerializeToNode(stats, StorageService.JsonOptions),
                    ["knowledgePacks"] = JsonSerializer.SerializeToNode(packs, StorageService.JsonOptions),
                    ["dataDir"] = _storage.DataDir,
                    ["knowledgeDir"] = _storage.KnowledgeDir,
                    ["workArea"] = workAreaJson,
                    ["winBounds"] = winBoundsJson
                };
            }

            case "saveSettings":
            {
                var settings = JsonSerializer.Deserialize<AppSettings>(payload.ToJsonString(), StorageService.JsonOptions)
                    ?? new AppSettings();
                if (fromSettingsWindow)
                {
                    // Preserve live dragged pet coordinates so editing settings never snaps Haru back to an older position
                    var current = _storage.LoadSettings();
                    if (current.PetX >= 0 && current.PetY >= 0 && (settings.PetX >= 0 || settings.PetY >= 0))
                    {
                        settings.PetX = current.PetX;
                        settings.PetY = current.PetY;
                    }
                }
                _storage.SaveSettings(settings);
                Dispatcher.Invoke(() =>
                {
                    Topmost = settings.AlwaysOnTop;
                    _fullscreenDndEnabled = settings.FullscreenDnd;
                    ApplyGlobalHotkeys(settings.Hotkeys);
                    SyncTrayChecks(settings);
                    UpdateClickThroughFromCursor(force: true);
                });
                if (fromSettingsWindow) SyncStateToPetWindow();
                else SyncStateToSettingsWindow();
                return new JsonObject { ["ok"] = true };
            }

            case "saveWeakWords":
            {
                var wordsNode = payload["words"];
                var list = wordsNode != null
                    ? JsonSerializer.Deserialize<List<WeakWord>>(wordsNode.ToJsonString(), StorageService.JsonOptions) ?? new()
                    : new List<WeakWord>();
                _storage.SaveWeakWords(list);
                if (fromSettingsWindow) SyncStateToPetWindow();
                else SyncStateToSettingsWindow();
                return new JsonObject { ["ok"] = true };
            }

            case "saveStats":
            {
                var stats = JsonSerializer.Deserialize<StudyStats>(payload.ToJsonString(), StorageService.JsonOptions)
                    ?? new StudyStats();
                _storage.SaveStats(stats);
                if (!fromSettingsWindow) SyncStateToSettingsWindow();
                return new JsonObject { ["ok"] = true };
            }

            case "saveKnowledgePack":
            {
                var pack = JsonSerializer.Deserialize<KnowledgePack>(payload.ToJsonString(), StorageService.JsonOptions);
                if (pack == null) return new JsonObject { ["ok"] = false };
                _storage.SaveKnowledgePack(pack);
                if (fromSettingsWindow) SyncStateToPetWindow();
                else SyncStateToSettingsWindow();
                return new JsonObject
                {
                    ["ok"] = true,
                    ["packs"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions)
                };
            }

            case "deleteKnowledgePack":
            {
                var id = payload["id"]?.ToString() ?? "";
                var removed = _storage.DeleteKnowledgePack(id);
                if (fromSettingsWindow) SyncStateToPetWindow();
                else SyncStateToSettingsWindow();
                return new JsonObject
                {
                    ["ok"] = removed,
                    ["packs"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions)
                };
            }

            case "importVocabEntries":
            {
                var targetBookId = payload["targetBookId"]?.ToString() ?? "toefl_core";
                var name = payload["name"]?.ToString();
                var desc = payload["description"]?.ToString();
                var level = payload["level"]?.ToString();
                var entriesNode = payload["entries"];
                var entries = entriesNode != null
                    ? JsonSerializer.Deserialize<List<KnowledgeEntry>>(entriesNode.ToJsonString(), StorageService.JsonOptions) ?? new()
                    : new List<KnowledgeEntry>();
                var (added, total, pack) = _storage.ImportVocabEntries(targetBookId, name, desc, level, entries);
                if (fromSettingsWindow) SyncStateToPetWindow();
                else SyncStateToSettingsWindow();
                return new JsonObject
                {
                    ["ok"] = true,
                    ["added"] = added,
                    ["total"] = total,
                    ["targetBookId"] = pack.Id,
                    ["targetName"] = pack.Name,
                    ["packs"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions)
                };
            }

            case "openDataFolder":
            {
                var target = payload["sub"]?.ToString() == "knowledge" ? _storage.KnowledgeDir : _storage.DataDir;
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
                return new JsonObject { ["ok"] = true };
            }

            case "exportBackup":
            {
                return Dispatcher.Invoke(() =>
                {
                    var dlg = new Microsoft.Win32.SaveFileDialog
                    {
                        Title = "导出 Haru 学习数据备份",
                        Filter = "JSON 备份文件 (*.json)|*.json",
                        FileName = $"haru-english-backup-{DateTime.Now:yyyyMMdd}.json"
                    };
                    if (dlg.ShowDialog() != true)
                        return new JsonObject { ["ok"] = false, ["cancelled"] = true };
                    var backup = _storage.BuildSyncPayload();
                    File.WriteAllText(dlg.FileName, JsonSerializer.Serialize(backup, StorageService.JsonOptions));
                    return new JsonObject { ["ok"] = true, ["message"] = $"已导出至 {Path.GetFileName(dlg.FileName)}" };
                });
            }

            case "importBackup":
            {
                return Dispatcher.Invoke(() =>
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog
                    {
                        Title = "导入 Haru 学习数据备份",
                        Filter = "JSON 备份文件 (*.json)|*.json"
                    };
                    if (dlg.ShowDialog() != true)
                        return new JsonObject { ["ok"] = false, ["cancelled"] = true };
                    try
                    {
                        var json = File.ReadAllText(dlg.FileName);
                        var remote = JsonSerializer.Deserialize<SyncPayload>(json, StorageService.JsonOptions);
                        if (remote == null)
                            return new JsonObject { ["ok"] = false, ["message"] = "备份文件格式无效" };
                        _storage.ApplyMergedSyncPayload(remote);
                        if (fromSettingsWindow) SyncStateToPetWindow();
                        else SyncStateToSettingsWindow();
                        return new JsonObject
                        {
                            ["ok"] = true,
                            ["message"] = "已成功合并导入学习记录与生词本",
                            ["weakWords"] = JsonSerializer.SerializeToNode(_storage.LoadWeakWords(), StorageService.JsonOptions),
                            ["stats"] = JsonSerializer.SerializeToNode(_storage.LoadStats(), StorageService.JsonOptions),
                            ["knowledgePacks"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions),
                            ["settings"] = JsonSerializer.SerializeToNode(_storage.LoadSettings(), StorageService.JsonOptions)
                        };
                    }
                    catch (Exception ex)
                    {
                        return new JsonObject { ["ok"] = false, ["message"] = $"导入失败：{ex.Message}" };
                    }
                });
            }

            case "browseModelFile":
            {
                return Dispatcher.Invoke(() =>
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog
                    {
                        Title = "选择 Live2D 模型文件 (*.model3.json)",
                        Filter = "Live2D Cubism 4 模型 (*.model3.json)|*.model3.json|JSON 文件 (*.json)|*.json"
                    };
                    if (dlg.ShowDialog() != true)
                        return new JsonObject { ["ok"] = false, ["cancelled"] = true };
                    var fullPath = dlg.FileName;
                    var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
                    if (fullPath.StartsWith(wwwroot, StringComparison.OrdinalIgnoreCase))
                    {
                        var rel = Path.GetRelativePath(wwwroot, fullPath).Replace('\\', '/');
                        return new JsonObject { ["ok"] = true, ["modelUrl"] = rel };
                    }
                    var dir = Path.GetDirectoryName(fullPath);
                    var fileName = Path.GetFileName(fullPath);
                    if (!string.IsNullOrEmpty(dir) && WebView.CoreWebView2 != null)
                    {
                        WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                            "localmodel.local",
                            dir,
                            CoreWebView2HostResourceAccessKind.Allow);
                        return new JsonObject { ["ok"] = true, ["modelUrl"] = $"https://localmodel.local/{Uri.EscapeDataString(fileName)}" };
                    }
                    return new JsonObject { ["ok"] = false, ["message"] = "无法映射该模型目录" };
                });
            }

            case "aiChat":
            {
                var settings = _storage.LoadSettings();
                var userMsg = payload["message"]?.ToString() ?? "";
                var history = payload["history"] != null
                    ? JsonSerializer.Deserialize<List<ChatTurn>>(payload["history"]!.ToJsonString(), StorageService.JsonOptions) ?? new()
                    : new List<ChatTurn>();
                var weak = _storage.LoadWeakWords();
                return await _ai.ChatAsync(settings.Api, settings.EnglishLevel, userMsg, history, weak, settings.CorrectionStyle);
            }

            case "aiTranslate":
            {
                var settings = _storage.LoadSettings();
                var text = payload["text"]?.ToString() ?? "";
                return await _ai.TranslateAsync(settings.Api, text, settings.EnglishLevel);
            }

            case "aiTranscribe":
            {
                var settings = _storage.LoadSettings();
                var audioBase64 = payload["audioBase64"]?.ToString() ?? "";
                var mimeType = payload["mimeType"]?.ToString() ?? "audio/webm";
                return await _ai.TranscribeAudioAsync(settings.Api, audioBase64, mimeType);
            }

            case "aiTestConnection":
            {
                var apiCfg = JsonSerializer.Deserialize<ApiConfig>(payload.ToJsonString(), StorageService.JsonOptions)
                    ?? _storage.LoadSettings().Api;
                return await _ai.TestConnectionAsync(apiCfg);
            }

            case "ttsSynthesize":
            {
                var cts = StartNewTtsCts();
                try
                {
                    var settings = _storage.LoadSettings();
                    var voiceCfg = payload["voice"] != null
                        ? JsonSerializer.Deserialize<VoiceConfig>(payload["voice"]!.ToJsonString(), StorageService.JsonOptions) ?? settings.Voice
                        : settings.Voice;
                    var text = payload["text"]?.ToString() ?? "";
                    return await _tts.SynthesizeAsync(voiceCfg, settings.Api, text, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    return new JsonObject { ["ok"] = false, ["cancelled"] = true };
                }
                finally
                {
                    ReleaseTtsCts(cts);
                }
            }

            case "cloudSync":
            {
                var settings = _storage.LoadSettings();
                var cloudCfg = payload["config"] != null
                    ? JsonSerializer.Deserialize<CloudSyncConfig>(payload["config"]!.ToJsonString(), StorageService.JsonOptions) ?? settings.CloudSync
                    : settings.CloudSync;
                var mode = payload["mode"]?.ToString() ?? "merge";
                var syncRes = await _cloud.SyncAsync(cloudCfg, _storage, mode);
                if (syncRes["ok"]?.GetValue<bool>() == true)
                {
                    syncRes["weakWords"] = JsonSerializer.SerializeToNode(_storage.LoadWeakWords(), StorageService.JsonOptions);
                    syncRes["stats"] = JsonSerializer.SerializeToNode(_storage.LoadStats(), StorageService.JsonOptions);
                    syncRes["knowledgePacks"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions);
                    syncRes["settings"] = JsonSerializer.SerializeToNode(_storage.LoadSettings(), StorageService.JsonOptions);
                    if (fromSettingsWindow) SyncStateToPetWindow();
                    else SyncStateToSettingsWindow();
                }
                return syncRes;
            }

            case "toggleHidePet":
            {
                Dispatcher.Invoke(() => TogglePetVisibility());
                return new JsonObject { ["ok"] = true };
            }

            case "hideToTray":
            {
                Dispatcher.Invoke(() =>
                {
                    SetPetVisibility(false);
                    try
                    {
                        _trayIcon?.ShowBalloonTip(
                            2600,
                            "Haru 英语桌宠已在后台运行",
                            "桌面已清空不占用显示；双击右下角托盘图标或右键可随时恢复显示。",
                            Forms.ToolTipIcon.Info);
                    }
                    catch { }
                });
                return new JsonObject { ["ok"] = true };
            }

            case "quitApp":
            {
                Dispatcher.Invoke(() =>
                {
                    CleanupTray();
                    System.Windows.Application.Current.Shutdown();
                });
                return new JsonObject { ["ok"] = true };
            }

            default:
                return new JsonObject { ["ok"] = false, ["error"] = $"Unknown method: {method}" };
        }
    }

    private void PostToWeb(JsonObject msg)
    {
        if (WebView.CoreWebView2 == null) return;
        Dispatcher.BeginInvoke(() =>
        {
            try
            {
                WebView.CoreWebView2?.PostWebMessageAsJson(msg.ToJsonString());
            }
            catch { }
        });
    }

    private void SendTrayCommand(string command, JsonNode? value = null)
    {
        if (!_petVisible && command != "toggleVisible")
        {
            SetPetVisibility(true);
        }
        PostToWeb(new JsonObject
        {
            ["type"] = "trayCommand",
            ["command"] = command,
            ["value"] = value
        });
    }

    private void InitSystemTray()
    {
        _generatedIcon = CreateTrayIcon();
        var menu = new Forms.ContextMenuStrip();

        menu.Items.Add("💬 英语对话 / 翻译 (Chat & Translate)", null, (_, _) => SendTrayCommand("openChat"));
        menu.Items.Add("🎭 表情动作词汇 (Actions & Expressions)", null, (_, _) => SendTrayCommand("openActions"));
        menu.Items.Add("📝 立即单词测试 (Start Word Quiz)", null, (_, _) => SendTrayCommand("startQuiz"));
        menu.Items.Add("📚 不熟练的英文 (Weak Words)", null, (_, _) => OpenSettingsWindow("words", "weak"));
        menu.Items.Add("📖 英文知识库管理 (Knowledge Base)", null, (_, _) => OpenSettingsWindow("words", "knowledge"));
        menu.Items.Add(new Forms.ToolStripSeparator());

        // Pet Size submenu
        var sizeMenu = new Forms.ToolStripMenuItem("📏 调整桌宠大小 (Pet Size)");
        var sizes = new (string label, double scale)[]
        {
            ("迷你全身 55% (Mini)", 0.55),
            ("小号全身 75% (Small)", 0.75),
            ("标准 100% (Medium)", 1.0),
            ("大号 125% (Large)", 1.25),
            ("超大 150% (Extra Large)", 1.5)
        };
        foreach (var (label, scale) in sizes)
        {
            var item = new Forms.ToolStripMenuItem(label);
            item.Click += (_, _) =>
            {
                var s = _storage.LoadSettings();
                s.PetScale = scale;
                _storage.SaveSettings(s);
                SyncTrayChecks(s);
                SyncStateToSettingsWindow();
                SendTrayCommand("setScale", JsonValue.Create(scale));
            };
            _sizeMenuItems[scale] = item;
            sizeMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(sizeMenu);

        // Activity Level submenu
        var actMenu = new Forms.ToolStripMenuItem("⚡ 调整活跃度 (Activity Level)");
        var activities = new (string label, string key)[]
        {
            ("静谧 Quiet (很少主动打扰)", "quiet"),
            ("适中 Normal (推荐)", "normal"),
            ("活跃 Lively (高频互动测验)", "lively"),
            ("超活跃 Super Active (密集陪练)", "super")
        };
        foreach (var (label, key) in activities)
        {
            var item = new Forms.ToolStripMenuItem(label);
            item.Click += (_, _) =>
            {
                var s = _storage.LoadSettings();
                s.ActivityLevel = key;
                _storage.SaveSettings(s);
                SyncTrayChecks(s);
                SyncStateToSettingsWindow();
                SendTrayCommand("setActivity", JsonValue.Create(key));
            };
            _activityMenuItems[key] = item;
            actMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(actMenu);

        // English Level submenu
        var levelMenu = new Forms.ToolStripMenuItem("🎓 英语水平 (English Level)");
        var levels = new (string label, string key)[]
        {
            ("A1 入门 (Beginner)", "A1"),
            ("A2 基础 (Elementary)", "A2"),
            ("B1 中级 (Intermediate)", "B1"),
            ("B2 中高级 (Upper-Intermediate)", "B2"),
            ("C1 高级 (Advanced)", "C1"),
            ("C2 精通 (Mastery)", "C2")
        };
        foreach (var (label, key) in levels)
        {
            var item = new Forms.ToolStripMenuItem(label);
            item.Click += (_, _) =>
            {
                var s = _storage.LoadSettings();
                s.EnglishLevel = key;
                _storage.SaveSettings(s);
                SyncTrayChecks(s);
                SyncStateToSettingsWindow();
                SendTrayCommand("setLevel", JsonValue.Create(key));
            };
            _levelMenuItems[key] = item;
            levelMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(levelMenu);

        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("⚙️ 设置：外观 / 词库 / API / 音色 (Settings)", null, (_, _) => OpenSettingsWindow("overview", null));
        menu.Items.Add("☁️ 立即云端同步 (Sync Cloud Now)", null, (_, _) => SendTrayCommand("syncCloud"));
        menu.Items.Add("📂 打开本地数据与知识库文件夹", null, (_, _) =>
        {
            Process.Start(new ProcessStartInfo { FileName = _storage.DataDir, UseShellExecute = true });
        });
        menu.Items.Add(new Forms.ToolStripSeparator());

        _toggleShowMenuItem = new Forms.ToolStripMenuItem("👁️ 隐藏桌宠 (Hide Pet)");
        _toggleShowMenuItem.Click += (_, _) => TogglePetVisibility();
        menu.Items.Add(_toggleShowMenuItem);

        menu.Items.Add("📍 重置桌宠位置 (Reset Position)", null, (_, _) => SendTrayCommand("resetPosition"));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("❌ 退出 Haru (Quit)", null, (_, _) =>
        {
            CleanupTray();
            System.Windows.Application.Current.Shutdown();
        });

        _trayIcon = new Forms.NotifyIcon
        {
            Icon = _generatedIcon,
            Text = "Haru English",
            Visible = true,
            ContextMenuStrip = menu
        };

        _trayIcon.DoubleClick += (_, _) =>
        {
            bool wasHidden = !_petVisible;
            SetPetVisibility(true);
            if (!wasHidden)
            {
                SendTrayCommand("openChat");
            }
        };

        SyncTrayChecks(_storage.LoadSettings());
    }

    private void SyncTrayChecks(AppSettings s)
    {
        foreach (var (scale, item) in _sizeMenuItems)
            item.Checked = Math.Abs(s.PetScale - scale) < 0.06;
        foreach (var (key, item) in _activityMenuItems)
            item.Checked = string.Equals(s.ActivityLevel, key, StringComparison.OrdinalIgnoreCase);
        foreach (var (key, item) in _levelMenuItems)
            item.Checked = string.Equals(s.EnglishLevel, key, StringComparison.OrdinalIgnoreCase);
    }

    private void TogglePetVisibility() => SetPetVisibility(!_petVisible);

    private void SetPetVisibility(bool visible)
    {
        _petVisible = visible;
        _restoreFadeTimer?.Stop();
        HideFreezeOverlay();
        UnhookMaskCompositionTick();
        _maskStage = BoundsMaskStage.Idle;

        if (visible)
        {
            if (_toggleShowMenuItem != null) _toggleShowMenuItem.Text = "👁️ 隐藏桌宠 (Hide Pet)";
            BeginAnimation(OpacityProperty, null);
            Opacity = 0;
            Show();
            UpdateClickThroughFromCursor(force: true);
            PostToWeb(new JsonObject { ["type"] = "petRestored" });

            // Wait ~28ms so WebView2 resumes & renders a fresh Live2D frame before smoothly fading in
            _restoreFadeTimer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(28) };
            _restoreFadeTimer.Stop();
            EventHandler? onTick = null;
            onTick = (_, _) =>
            {
                _restoreFadeTimer.Tick -= onTick;
                _restoreFadeTimer.Stop();
                if (!_petVisible) return;
                var fadeIn = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                fadeIn.Completed += (_, _) =>
                {
                    if (_petVisible)
                    {
                        BeginAnimation(OpacityProperty, null);
                        Opacity = 1;
                    }
                };
                BeginAnimation(OpacityProperty, fadeIn);
            };
            _restoreFadeTimer.Tick += onTick;
            _restoreFadeTimer.Start();
        }
        else
        {
            if (_toggleShowMenuItem != null) _toggleShowMenuItem.Text = "👁️ 显示桌宠 (Show Pet)";
            if (!IsVisible) return;
            var fadeOut = new DoubleAnimation(Opacity, 0, TimeSpan.FromMilliseconds(170))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
            };
            fadeOut.Completed += (_, _) =>
            {
                if (!_petVisible)
                {
                    Hide();
                    BeginAnimation(OpacityProperty, null);
                    Opacity = 1;
                }
            };
            BeginAnimation(OpacityProperty, fadeOut);
        }
    }

    public void CleanupTray()
    {
        CancelPendingTts();
        UnregisterAllHotkeys();
        _cursorTimer.Stop();
        _fullscreenTimer?.Stop();
        _restoreFadeTimer?.Stop();
        _revealFallbackTimer?.Stop();
        UnhookMaskCompositionTick();
        if (_settingsWindow != null)
        {
            try
            {
                _settingsWindow.AllowClose = true;
                _settingsWindow.Close();
            }
            catch { }
            _settingsWindow = null;
        }
        if (_freezeOverlay != null)
        {
            try { _freezeOverlay.Close(); } catch { }
            _freezeOverlay = null;
            _freezeOverlayImage = null;
        }
        if (_trayIcon != null)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _trayIcon = null;
        }
        _generatedIcon?.Dispose();
        _generatedIcon = null;
    }

    private static Icon CreateTrayIcon()
    {
        try
        {
            var icoPath = Path.Combine(AppContext.BaseDirectory, "haru.ico");
            if (File.Exists(icoPath))
            {
                return new Icon(icoPath, new System.Drawing.Size(32, 32));
            }
        }
        catch { }

        using var bmp = new Bitmap(32, 32);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(System.Drawing.Color.Transparent);

        using var bgBrush = new System.Drawing.Drawing2D.LinearGradientBrush(
            new Rectangle(1, 1, 30, 30),
            System.Drawing.Color.FromArgb(255, 255, 118, 158),
            System.Drawing.Color.FromArgb(255, 134, 96, 255),
            45f);
        g.FillEllipse(bgBrush, 1, 1, 30, 30);

        using var borderPen = new System.Drawing.Pen(System.Drawing.Color.White, 2f);
        g.DrawEllipse(borderPen, 2, 2, 28, 28);

        using var font = new Font("Segoe UI", 15f, System.Drawing.FontStyle.Bold, GraphicsUnit.Pixel);
        using var textBrush = new SolidBrush(System.Drawing.Color.White);
        var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString("H", font, textBrush, new RectangleF(0, 1, 32, 31), sf);

        IntPtr hIcon = bmp.GetHicon();
        using var tmp = System.Drawing.Icon.FromHandle(hIcon);
        var clone = (Icon)tmp.Clone();
        DestroyIcon(hIcon);
        return clone;
    }
}
