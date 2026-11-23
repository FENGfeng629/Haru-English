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
    private const int VK_LBUTTON = 0x01;
    private const uint LWA_ALPHA = 0x00000002;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_DONOTROUND = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MARGINS
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS pMarInset);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private record HitRect(double X, double Y, double W, double H);

    private readonly StorageService _storage = new();
    private readonly AiApiService _ai = new();
    private readonly TtsService _tts = new();
    private readonly CloudSyncService _cloud = new();

    private IntPtr _hwnd;
    private bool _isClickThrough = false;
    private bool _isDraggingPet = false;
    private bool _wasLeftButtonDown = false;
    private bool _leftDownLock = false;
    private bool _petVisible = true;
    private List<HitRect> _hitRects = new();
    private readonly object _rectLock = new();
    private readonly DispatcherTimer _cursorTimer;
    private POINT _lastReportedCursor;
    private POINT _lastDragCursor;
    private int _cursorReportTick = 0;

    private Forms.NotifyIcon? _trayIcon;
    private Icon? _generatedIcon;
    private readonly Dictionary<double, Forms.ToolStripMenuItem> _sizeMenuItems = new();
    private readonly Dictionary<string, Forms.ToolStripMenuItem> _activityMenuItems = new();
    private readonly Dictionary<string, Forms.ToolStripMenuItem> _levelMenuItems = new();
    private Forms.ToolStripMenuItem? _toggleShowMenuItem;

    public MainWindow()
    {
        InitializeComponent();

        // Cover primary desktop work area with transparent per-pixel overlay
        var area = SystemParameters.WorkArea;
        Left = area.Left;
        Top = area.Top;
        Width = area.Width;
        Height = area.Height;

        var settings = _storage.LoadSettings();
        Topmost = settings.AlwaysOnTop;

        SourceInitialized += OnSourceInitialized;
        Loaded += OnLoaded;

        _cursorTimer = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(35)
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

        // Hide from Alt+Tab & taskbar while preserving WPF's native AllowsTransparency (WS_EX_LAYERED)
        int exStyle = GetWindowLong(_hwnd, GWL_EXSTYLE);
        SetWindowLong(_hwnd, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW);

        DebugLog($"SourceInitialized hwnd=0x{_hwnd.ToInt64():X} workArea={Left},{Top},{Width}x{Height} exStyle=0x{GetWindowLong(_hwnd, GWL_EXSTYLE):X}");
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        InitSystemTray();
        await InitWebViewAsync();
        _cursorTimer.Start();
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            var userDataFolder = Path.Combine(_storage.DataDir, "WebView2Cache");
            var envOptions = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);

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
        if (!GetCursorPos(out var pt)) return;

        var dpi = VisualTreeHelper.GetDpi(this);
        double cssX = (pt.X / dpi.DpiScaleX) - Left;
        double cssY = (pt.Y / dpi.DpiScaleY) - Top;

        // Hardware left mouse button state
        bool leftButtonDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;

        bool hitRectNow = false;
        lock (_rectLock)
        {
            foreach (var r in _hitRects)
            {
                if (cssX >= r.X && cssX <= r.X + r.W && cssY >= r.Y && cssY <= r.Y + r.H)
                {
                    hitRectNow = true;
                    break;
                }
            }
        }

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
                _isDraggingPet = false;
                SetCursorTimerHighSpeed(false);
                PostToWeb(new JsonObject { ["type"] = "forceEndDrag" });
            }
        }
        _wasLeftButtonDown = leftButtonDown;

        bool hit = _isDraggingPet || _leftDownLock || hitRectNow;
        SetClickThrough(!hit);

        // High-frequency (125Hz) OS cursor streaming while dragging so Haru sticks to the cursor at any speed
        if (_isDraggingPet && leftButtonDown)
        {
            if (pt.X != _lastDragCursor.X || pt.Y != _lastDragCursor.Y)
            {
                _lastDragCursor = pt;
                PostToWeb(new JsonObject
                {
                    ["type"] = "dragMove",
                    ["x"] = Math.Round(cssX, 1),
                    ["y"] = Math.Round(cssY, 1)
                });
            }
            return;
        }

        // Forward cursor coordinates to Haru for smooth desktop eye-tracking (~14Hz)
        _cursorReportTick++;
        if (_cursorReportTick % 2 == 0 &&
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

    private void SetCursorTimerHighSpeed(bool highSpeed)
    {
        var target = highSpeed ? TimeSpan.FromMilliseconds(8) : TimeSpan.FromMilliseconds(35);
        if (_cursorTimer.Interval != target)
            _cursorTimer.Interval = target;
    }

    private void SetClickThrough(bool clickThrough)
    {
        if (_hwnd == IntPtr.Zero || _isClickThrough == clickThrough) return;
        _isClickThrough = clickThrough;
        int exStyle = GetWindowLong(_hwnd, GWL_EXSTYLE);
        if (clickThrough)
            SetWindowLong(_hwnd, GWL_EXSTYLE, exStyle | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW);
        else
            SetWindowLong(_hwnd, GWL_EXSTYLE, (exStyle & ~WS_EX_TRANSPARENT) | WS_EX_TOOLWINDOW);
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
                bool leftButtonDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
                _isDraggingPet = wantDrag && leftButtonDown;
                SetCursorTimerHighSpeed(_isDraggingPet);
                if (_isDraggingPet)
                {
                    _lastDragCursor = default;
                    SetClickThrough(false);
                }
                else if (wantDrag && !leftButtonDown)
                {
                    PostToWeb(new JsonObject { ["type"] = "forceEndDrag" });
                }
                return;
            }

            if (type == "rpc")
            {
                var id = root["id"]?.ToString() ?? "";
                var method = root["method"]?.ToString() ?? "";
                var payload = root["payload"]?.AsObject() ?? new JsonObject();
                JsonNode? result = await HandleRpcAsync(method, payload);
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

    private async Task<JsonNode?> HandleRpcAsync(string method, JsonObject payload)
    {
        switch (method)
        {
            case "getInitialState":
            {
                var settings = _storage.LoadSettings();
                var weakWords = _storage.LoadWeakWords();
                var stats = _storage.LoadStats();
                var packs = _storage.LoadAllKnowledgePacks();
                Dispatcher.Invoke(() => SyncTrayChecks(settings));
                return new JsonObject
                {
                    ["settings"] = JsonSerializer.SerializeToNode(settings, StorageService.JsonOptions),
                    ["weakWords"] = JsonSerializer.SerializeToNode(weakWords, StorageService.JsonOptions),
                    ["stats"] = JsonSerializer.SerializeToNode(stats, StorageService.JsonOptions),
                    ["knowledgePacks"] = JsonSerializer.SerializeToNode(packs, StorageService.JsonOptions),
                    ["dataDir"] = _storage.DataDir,
                    ["knowledgeDir"] = _storage.KnowledgeDir
                };
            }

            case "saveSettings":
            {
                var settings = JsonSerializer.Deserialize<AppSettings>(payload.ToJsonString(), StorageService.JsonOptions)
                    ?? new AppSettings();
                _storage.SaveSettings(settings);
                Dispatcher.Invoke(() =>
                {
                    Topmost = settings.AlwaysOnTop;
                    SyncTrayChecks(settings);
                });
                return new JsonObject { ["ok"] = true };
            }

            case "saveWeakWords":
            {
                var wordsNode = payload["words"];
                var list = wordsNode != null
                    ? JsonSerializer.Deserialize<List<WeakWord>>(wordsNode.ToJsonString(), StorageService.JsonOptions) ?? new()
                    : new List<WeakWord>();
                _storage.SaveWeakWords(list);
                return new JsonObject { ["ok"] = true };
            }

            case "saveStats":
            {
                var stats = JsonSerializer.Deserialize<StudyStats>(payload.ToJsonString(), StorageService.JsonOptions)
                    ?? new StudyStats();
                _storage.SaveStats(stats);
                return new JsonObject { ["ok"] = true };
            }

            case "saveKnowledgePack":
            {
                var pack = JsonSerializer.Deserialize<KnowledgePack>(payload.ToJsonString(), StorageService.JsonOptions);
                if (pack == null) return new JsonObject { ["ok"] = false };
                _storage.SaveKnowledgePack(pack);
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
                return new JsonObject
                {
                    ["ok"] = removed,
                    ["packs"] = JsonSerializer.SerializeToNode(_storage.LoadAllKnowledgePacks(), StorageService.JsonOptions)
                };
            }

            case "openDataFolder":
            {
                var target = payload["sub"]?.ToString() == "knowledge" ? _storage.KnowledgeDir : _storage.DataDir;
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
                return new JsonObject { ["ok"] = true };
            }

            case "aiChat":
            {
                var settings = _storage.LoadSettings();
                var userMsg = payload["message"]?.ToString() ?? "";
                var history = payload["history"] != null
                    ? JsonSerializer.Deserialize<List<ChatTurn>>(payload["history"]!.ToJsonString(), StorageService.JsonOptions) ?? new()
                    : new List<ChatTurn>();
                var weak = _storage.LoadWeakWords();
                return await _ai.ChatAsync(settings.Api, settings.EnglishLevel, userMsg, history, weak);
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
                var settings = _storage.LoadSettings();
                var voiceCfg = payload["voice"] != null
                    ? JsonSerializer.Deserialize<VoiceConfig>(payload["voice"]!.ToJsonString(), StorageService.JsonOptions) ?? settings.Voice
                    : settings.Voice;
                var text = payload["text"]?.ToString() ?? "";
                return await _tts.SynthesizeAsync(voiceCfg, settings.Api, text);
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
                }
                return syncRes;
            }

            case "toggleHidePet":
            {
                Dispatcher.Invoke(() => TogglePetVisibility());
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
        menu.Items.Add("📚 不熟练的英文 (Weak Words)", null, (_, _) => SendTrayCommand("openWeakWords"));
        menu.Items.Add("📖 英文知识库管理 (Knowledge Base)", null, (_, _) => SendTrayCommand("openKnowledge"));
        menu.Items.Add(new Forms.ToolStripSeparator());

        // Pet Size submenu
        var sizeMenu = new Forms.ToolStripMenuItem("📏 调整桌宠大小 (Pet Size)");
        var sizes = new (string label, double scale)[]
        {
            ("小号 75% (Small)", 0.75),
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
                SendTrayCommand("setLevel", JsonValue.Create(key));
            };
            _levelMenuItems[key] = item;
            levelMenu.DropDownItems.Add(item);
        }
        menu.Items.Add(levelMenu);

        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("⚙️ 设置：API / 音色 / 云端同步 (Settings)", null, (_, _) => SendTrayCommand("openSettings"));
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
            SetPetVisibility(true);
            SendTrayCommand("openChat");
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
        if (visible)
        {
            Show();
            if (_toggleShowMenuItem != null) _toggleShowMenuItem.Text = "👁️ 隐藏桌宠 (Hide Pet)";
        }
        else
        {
            Hide();
            if (_toggleShowMenuItem != null) _toggleShowMenuItem.Text = "👁️ 显示桌宠 (Show Pet)";
        }
    }

    public void CleanupTray()
    {
        _cursorTimer.Stop();
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
