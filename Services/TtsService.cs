using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using HaruEnglishPet.Models;

namespace HaruEnglishPet.Services;

public class TtsService
{
    private const string EdgeTrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const string EdgeChromiumFullVersion = "143.0.3650.75";
    private const string EdgeChromiumMajorVersion = "143";
    private const string EdgeSecMsGecVersion = "2-" + EdgeChromiumFullVersion;
    private const int MaxDiskCacheFiles = 600;

    private sealed record CachedAudio(string AudioBase64, string MimeType, string Provider, string Voice);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private readonly string _cacheDir;
    private readonly ConcurrentDictionary<string, CachedAudio> _memCache = new();
    private readonly ConcurrentDictionary<string, Task<CachedAudio?>> _inflightPrewarm = new();
    private readonly SemaphoreSlim _prewarmConcurrency = new(3);
    private readonly SemaphoreSlim _clockSyncLock = new(1, 1);
    private static double _clockSkewSeconds = 0.0;
    private static bool _clockSyncedOnce = false;
    private int _diskWriteCount = 0;

    public TtsService(string? dataDir = null)
    {
        var root = string.IsNullOrWhiteSpace(dataDir)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HaruEnglishPet")
            : dataDir;
        _cacheDir = Path.Combine(root, "tts_cache");
        try { Directory.CreateDirectory(_cacheDir); } catch { }
    }

    public async Task WarmupClockAsync(CancellationToken ct = default)
    {
        if (_clockSyncedOnce) return;
        await _clockSyncLock.WaitAsync(ct);
        try
        {
            if (_clockSyncedOnce) return;
            await TrySyncServerClockSkewAsync(ct);
            _clockSyncedOnce = true;
        }
        finally
        {
            _clockSyncLock.Release();
        }
    }

    public async Task PrewarmBatchAsync(IEnumerable<(VoiceConfig voice, string text)> items, ApiConfig api)
    {
        try
        {
            await WarmupClockAsync();
        }
        catch { }

        var tasks = new List<Task>();
        foreach (var (voice, rawText) in items)
        {
            var text = (rawText ?? "").Trim();
            if (string.IsNullOrEmpty(text)) continue;

            var provider = (voice.TtsProvider ?? "edge").ToLowerInvariant();
            if (provider == "webspeech") continue;

            var voiceName = provider == "openai"
                ? (string.IsNullOrWhiteSpace(voice.OpenAiVoice) ? "nova" : voice.OpenAiVoice)
                : (string.IsNullOrWhiteSpace(voice.EdgeVoice) ? "en-US-AnaNeural" : voice.EdgeVoice);

            var cacheKey = BuildCacheKey(provider, voiceName, voice.SpeechRate, voice.SpeechPitch, text);
            if (TryGetCached(cacheKey, provider, voiceName, out _)) continue;
            if (_inflightPrewarm.ContainsKey(cacheKey)) continue;

            var vCopy = voice;
            var tCopy = text;
            tasks.Add(Task.Run(async () =>
            {
                await _prewarmConcurrency.WaitAsync();
                try
                {
                    if (TryGetCached(cacheKey, provider, voiceName, out _)) return;
                    var work = _inflightPrewarm.GetOrAdd(cacheKey, _ => SynthesizeAndCacheCoreAsync(vCopy, api, tCopy, provider, voiceName, cacheKey, CancellationToken.None));
                    try { await work; }
                    finally { _inflightPrewarm.TryRemove(cacheKey, out _); }
                }
                catch { }
                finally
                {
                    _prewarmConcurrency.Release();
                }
            }));
        }

        if (tasks.Count > 0)
        {
            try { await Task.WhenAll(tasks); } catch { }
        }
    }

    public async Task<JsonObject> SynthesizeAsync(VoiceConfig voice, ApiConfig api, string text, CancellationToken ct = default)
    {
        if (ct.IsCancellationRequested)
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };

        var cleanText = (text ?? "").Trim();
        if (string.IsNullOrWhiteSpace(cleanText))
            return new JsonObject { ["ok"] = false, ["fallbackToWebSpeech"] = true };

        var provider = (voice.TtsProvider ?? "edge").ToLowerInvariant();
        if (provider == "webspeech")
        {
            return new JsonObject { ["ok"] = false, ["fallbackToWebSpeech"] = true, ["provider"] = "webspeech" };
        }

        var voiceName = provider == "openai"
            ? (string.IsNullOrWhiteSpace(voice.OpenAiVoice) ? "nova" : voice.OpenAiVoice)
            : (string.IsNullOrWhiteSpace(voice.EdgeVoice) ? "en-US-AnaNeural" : voice.EdgeVoice);

        var cacheKey = BuildCacheKey(provider, voiceName, voice.SpeechRate, voice.SpeechPitch, cleanText);

        // 1. Instant Memory / Disk cache hit (< 3ms!)
        if (TryGetCached(cacheKey, provider, voiceName, out var cached))
        {
            return BuildSuccessJson(cached);
        }

        // 2. Join or create a shared in-flight synthesis for this exact phrase & voice
        //    so rapid clicks on the speaker icon never cancel & restart a cold Edge WebSocket!
        var sharedTask = _inflightPrewarm.GetOrAdd(
            cacheKey,
            _ => SynthesizeAndCacheCoreAsync(voice, api, cleanText, provider, voiceName, cacheKey, CancellationToken.None));

        try
        {
            var synthesized = await sharedTask.WaitAsync(ct);
            if (ct.IsCancellationRequested)
                return new JsonObject { ["ok"] = false, ["cancelled"] = true };
            if (synthesized != null)
                return BuildSuccessJson(synthesized);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }
        catch { }
        finally
        {
            if (sharedTask.IsCompleted)
                _inflightPrewarm.TryRemove(new KeyValuePair<string, Task<CachedAudio?>>(cacheKey, sharedTask));
        }

        // 3. Fallback path if OpenAI failed (try Edge) or return WebSpeech fallback
        if (provider == "openai")
        {
            var edgeFallbackVoice = string.IsNullOrWhiteSpace(voice.EdgeVoice) ? "en-US-AnaNeural" : voice.EdgeVoice;
            var edgeFallbackKey = BuildCacheKey("edge", edgeFallbackVoice, voice.SpeechRate, voice.SpeechPitch, cleanText);
            if (TryGetCached(edgeFallbackKey, "edge", edgeFallbackVoice, out var fallbackCached))
                return BuildSuccessJson(fallbackCached);

            var edgeTask = _inflightPrewarm.GetOrAdd(
                edgeFallbackKey,
                _ => SynthesizeAndCacheCoreAsync(voice, api, cleanText, "edge", edgeFallbackVoice, edgeFallbackKey, CancellationToken.None));
            try
            {
                var edgeSynthesized = await edgeTask.WaitAsync(ct);
                if (ct.IsCancellationRequested)
                    return new JsonObject { ["ok"] = false, ["cancelled"] = true };
                if (edgeSynthesized != null)
                    return BuildSuccessJson(edgeSynthesized);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return new JsonObject { ["ok"] = false, ["cancelled"] = true };
            }
            catch { }
            finally
            {
                if (edgeTask.IsCompleted)
                    _inflightPrewarm.TryRemove(new KeyValuePair<string, Task<CachedAudio?>>(edgeFallbackKey, edgeTask));
            }
        }

        if (ct.IsCancellationRequested)
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };

        return new JsonObject
        {
            ["ok"] = false,
            ["fallbackToWebSpeech"] = true,
            ["provider"] = "webspeech",
            ["error"] = "Edge TTS unavailable"
        };
    }

    private async Task<CachedAudio?> SynthesizeAndCacheCoreAsync(
        VoiceConfig voice, ApiConfig api, string text, string provider, string voiceName, string cacheKey, CancellationToken ct)
    {
        if (provider == "edge" && !_clockSyncedOnce)
        {
            try { await WarmupClockAsync(ct); } catch { }
        }

        if (provider == "openai")
        {
            var oaRes = await SynthesizeOpenAiAsync(voice, api, text, ct);
            if (oaRes["ok"]?.GetValue<bool>() == true)
            {
                var b64 = oaRes["audioBase64"]?.ToString();
                if (!string.IsNullOrEmpty(b64))
                {
                    var entry = new CachedAudio(b64, "audio/mpeg", "openai", voiceName);
                    SaveToCache(cacheKey, Convert.FromBase64String(b64), entry);
                    return entry;
                }
            }
            return null;
        }

        for (int attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                var mp3 = await SynthesizeEdgeNeuralAsync(voiceName, text, voice.SpeechRate, voice.SpeechPitch, ct);
                if (mp3.Length > 0)
                {
                    var b64 = Convert.ToBase64String(mp3);
                    var entry = new CachedAudio(b64, "audio/mpeg", "edge", voiceName);
                    SaveToCache(cacheKey, mp3, entry);
                    return entry;
                }
            }
            catch
            {
                if (attempt == 0)
                {
                    var synced = await TrySyncServerClockSkewAsync(ct);
                    if (synced) continue;
                }
                break;
            }
        }
        return null;
    }

    private static string BuildCacheKey(string provider, string voiceName, double rate, double pitch, string text)
    {
        var raw = $"{provider}|{voiceName}|{rate:F2}|{pitch:F2}|{text}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(hash)[..24].ToLowerInvariant();
    }

    private static JsonObject BuildSuccessJson(CachedAudio entry) => new()
    {
        ["ok"] = true,
        ["audioBase64"] = entry.AudioBase64,
        ["mimeType"] = entry.MimeType,
        ["provider"] = entry.Provider,
        ["voice"] = entry.Voice
    };

    private bool TryGetCached(string cacheKey, string provider, string voiceName, out CachedAudio entry)
    {
        if (_memCache.TryGetValue(cacheKey, out var mem))
        {
            entry = mem;
            return true;
        }

        try
        {
            var path = Path.Combine(_cacheDir, cacheKey + ".mp3");
            if (File.Exists(path))
            {
                var bytes = File.ReadAllBytes(path);
                if (bytes.Length > 0)
                {
                    entry = new CachedAudio(Convert.ToBase64String(bytes), "audio/mpeg", provider, voiceName);
                    _memCache[cacheKey] = entry;
                    try { File.SetLastAccessTimeUtc(path, DateTime.UtcNow); } catch { }
                    return true;
                }
            }
        }
        catch { }

        entry = default!;
        return false;
    }

    private void SaveToCache(string cacheKey, byte[] mp3Bytes, CachedAudio entry)
    {
        _memCache[cacheKey] = entry;
        try
        {
            var path = Path.Combine(_cacheDir, cacheKey + ".mp3");
            if (!File.Exists(path))
            {
                File.WriteAllBytes(path, mp3Bytes);
                if (Interlocked.Increment(ref _diskWriteCount) % 25 == 0)
                {
                    _ = Task.Run(TrimDiskCache);
                }
            }
        }
        catch { }
    }

    private void TrimDiskCache()
    {
        try
        {
            var files = new DirectoryInfo(_cacheDir).GetFiles("*.mp3");
            if (files.Length <= MaxDiskCacheFiles) return;
            foreach (var f in files.OrderBy(f => f.LastAccessTimeUtc).Take(files.Length - MaxDiskCacheFiles))
            {
                try { f.Delete(); } catch { }
            }
        }
        catch { }
    }

    private async Task<bool> TrySyncServerClockSkewAsync(CancellationToken ct = default)
    {
        try
        {
            using var req = new HttpRequestMessage(
                HttpMethod.Get,
                $"https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken={EdgeTrustedClientToken}");
            req.Headers.TryAddWithoutValidation(
                "User-Agent",
                $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{EdgeChromiumMajorVersion}.0.0.0 Safari/537.36 Edg/{EdgeChromiumMajorVersion}.0.0.0");

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if (resp.Headers.Date.HasValue)
            {
                var serverUnix = resp.Headers.Date.Value.ToUnixTimeSeconds();
                var localUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var newSkew = serverUnix - localUnix;
                if (Math.Abs(newSkew - _clockSkewSeconds) > 5)
                {
                    _clockSkewSeconds = newSkew;
                    return true;
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Ignore sync errors
        }
        return false;
    }

    private async Task<JsonObject> SynthesizeOpenAiAsync(VoiceConfig voice, ApiConfig api, string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(api.ApiKey))
            return new JsonObject { ["ok"] = false };

        try
        {
            var baseUrl = (api.BaseUrl ?? "https://api.openai.com/v1").TrimEnd('/');
            var voiceName = string.IsNullOrWhiteSpace(voice.OpenAiVoice) ? "nova" : voice.OpenAiVoice;
            var payload = new JsonObject
            {
                ["model"] = string.IsNullOrWhiteSpace(api.TtsModel) ? "tts-1" : api.TtsModel,
                ["input"] = text,
                ["voice"] = voiceName,
                ["speed"] = Math.Clamp(voice.SpeechRate, 0.5, 2.0),
                ["response_format"] = "mp3"
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, baseUrl + "/audio/speech");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.ApiKey);
            req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
                return new JsonObject { ["ok"] = false };

            var bytes = await resp.Content.ReadAsByteArrayAsync(ct);
            return new JsonObject
            {
                ["ok"] = true,
                ["audioBase64"] = Convert.ToBase64String(bytes),
                ["mimeType"] = "audio/mpeg",
                ["provider"] = "openai",
                ["voice"] = voiceName
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new JsonObject { ["ok"] = false, ["cancelled"] = true };
        }
        catch
        {
            return new JsonObject { ["ok"] = false };
        }
    }

    private static async Task<byte[]> SynthesizeEdgeNeuralAsync(string voiceName, string text, double rate, double pitch, CancellationToken ct = default)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(14));
        using var ws = new ClientWebSocket();

        var connectionId = Guid.NewGuid().ToString("N");
        var secMsGec = EdgeDrmV2.GenerateSecMsGecV2(_clockSkewSeconds);
        var muid = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

        var uri = new Uri(
            $"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
            $"?TrustedClientToken={EdgeTrustedClientToken}" +
            $"&ConnectionId={connectionId}" +
            $"&Sec-MS-GEC={secMsGec}" +
            $"&Sec-MS-GEC-Version={EdgeSecMsGecVersion}"
        );

        ws.Options.SetRequestHeader("Pragma", "no-cache");
        ws.Options.SetRequestHeader("Cache-Control", "no-cache");
        ws.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
        ws.Options.SetRequestHeader(
            "User-Agent",
            $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{EdgeChromiumMajorVersion}.0.0.0 Safari/537.36 Edg/{EdgeChromiumMajorVersion}.0.0.0");
        ws.Options.SetRequestHeader("Accept-Encoding", "gzip, deflate, br, zstd");
        ws.Options.SetRequestHeader("Accept-Language", "en-US,en;q=0.9");
        ws.Options.SetRequestHeader("Cookie", $"muid={muid};");

        await ws.ConnectAsync(uri, cts.Token);

        var timestamp = DateTime.UtcNow.ToString(
            "ddd MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'",
            System.Globalization.CultureInfo.InvariantCulture);

        var configMsg =
            $"X-Timestamp:{timestamp}\r\n" +
            "Content-Type:application/json; charset=utf-8\r\n" +
            "Path:speech.config\r\n\r\n" +
            "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";

        await SendTextAsync(ws, configMsg, cts.Token);

        var ratePct = (int)Math.Round((Math.Clamp(rate, 0.5, 1.8) - 1.0) * 100);
        var rateStr = ratePct >= 0 ? $"+{ratePct}%" : $"{ratePct}%";
        var pitchHz = (int)Math.Round((Math.Clamp(pitch, 0.7, 1.4) - 1.0) * 40);
        var pitchStr = pitchHz >= 0 ? $"+{pitchHz}Hz" : $"{pitchHz}Hz";
        var escaped = SecurityElement.Escape(text) ?? text;
        var reqId = Guid.NewGuid().ToString("N");

        // Extract locale from voiceName (e.g. "en-GB" from "en-GB-SoniaNeural")
        var lang = "en-US";
        var parts = voiceName.Split('-');
        if (parts.Length >= 2)
        {
            lang = $"{parts[0]}-{parts[1]}";
        }

        var ssmlMsg =
            $"X-RequestId:{reqId}\r\n" +
            "Content-Type:application/ssml+xml\r\n" +
            $"X-Timestamp:{timestamp}Z\r\n" +
            "Path:ssml\r\n\r\n" +
            $"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{lang}'>" +
            $"<voice name='{voiceName}'>" +
            $"<prosody pitch='{pitchStr}' rate='{rateStr}' volume='+0%'>{escaped}</prosody>" +
            "</voice></speak>";

        await SendTextAsync(ws, ssmlMsg, cts.Token);

        using var audioStream = new MemoryStream();
        var buffer = new byte[16384];
        using var msgBuffer = new MemoryStream();

        while (ws.State == WebSocketState.Open)
        {
            msgBuffer.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                if (result.MessageType == WebSocketMessageType.Close)
                    break;
                msgBuffer.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
                break;

            var data = msgBuffer.ToArray();
            if (result.MessageType == WebSocketMessageType.Text)
            {
                var txt = Encoding.UTF8.GetString(data);
                if (txt.Contains("Path:turn.end", StringComparison.OrdinalIgnoreCase))
                    break;
            }
            else if (result.MessageType == WebSocketMessageType.Binary && data.Length > 2)
            {
                int headerLen = (data[0] << 8) | data[1];
                int audioOffset = 2 + headerLen;
                if (audioOffset < data.Length)
                {
                    audioStream.Write(data, audioOffset, data.Length - audioOffset);
                }
            }
        }

        if (ws.State == WebSocketState.Open)
        {
            try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None); }
            catch { }
        }

        return audioStream.ToArray();
    }

    private static Task SendTextAsync(ClientWebSocket ws, string text, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        return ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    /// <summary>
    /// Microsoft Edge Read-Aloud Sec-MS-GEC v2 token generator (CS64 + keyed SHA-256).
    /// Produces "&lt;16 hex&gt;-&lt;64 hex&gt;" required by Edge TTS since Oct 2026.
    /// </summary>
    private static class EdgeDrmV2
    {
        private const long WinEpoch = 11644473600L;

        private static readonly uint[] Sha256Initial =
        {
            0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
            0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19
        };

        private static readonly uint[] Sha256State =
        {
            0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
            0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2
        };

        private static readonly uint[] Sha256Schedule =
        {
            0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
            0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
            0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
            0xD258B060, 0x72766564
        };

        private static readonly uint[] Sha256RoundConstants =
        {
            0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
            0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
            0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
            0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
            0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
            0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
            0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
            0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
        };

        private const uint Sha256Adjustment = 0xC9DC06A7;
        private const uint Sha256Sigma0Adjustment = 0x059C0B80;
        private const uint Sha256Sigma1Adjustment = 0x000B92C0;

        private static readonly uint[] Sha256BlockConstants = BuildBlockConstants();

        private static readonly (uint Coeff, uint Offset)[] Cs64Coefficients =
        {
            (0xE82E91B1, 0xB32700D0),
            (0x44DE24C6, 0x88DFF51D),
            (0x3BEB65BC, 0x29514038),
            (0xC89C5933, 0xB328CBDF),
            (0x8D1EC211, 0xD405B4D5),
            (0x314EF5D5, 0x26E55F3C),
            (0xE92491B1, 0x607801C6),
            (0xF0A5B9D5, 0x82B2C1FB),
            (0x06064CF3, 0xFA51A3DA),
            (0xDA79FA60, 0x207CC464),
            (0xBED20560, 0x3C3C74F3),
            (0x89F9C9F8, 0xD2D14B61),
            (0x35FA38C6, 0xBB04A2C1),
            (0xCB49E3C6, 0xC5626167)
        };

        private const uint Cs64Factor = 0x82893933;
        private const uint Cs64Adjustment0 = 0xF2F90B1A;
        private const uint Cs64Adjustment1 = 0x0B1A0000;

        private static uint[] BuildBlockConstants()
        {
            var arr = (uint[])Sha256RoundConstants.Clone();
            arr[14] = Sha256Adjustment;
            return arr;
        }

        private static uint Rol16(uint v) => (v << 16) | (v >> 16);
        private static uint Rotr(uint v, int n) => (v >> n) | (v << (32 - n));
        private static uint Sigma0(uint v) => Rotr(v, 7) ^ Rotr(v, 18) ^ (v >> 3);
        private static uint Sigma1(uint v) => Rotr(v, 17) ^ Rotr(v, 19) ^ (v >> 10);

        public static string GenerateSecMsGecV2(double clockSkewSeconds)
        {
            long unixSeconds = (long)Math.Floor(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 + clockSkewSeconds);
            long ticksSeconds = unixSeconds + WinEpoch;
            ticksSeconds -= ticksSeconds % 300;
            long ticks = ticksSeconds * 10_000_000L;

            var data = Encoding.ASCII.GetBytes($"{ticks}{EdgeTrustedClientToken}");
            var digest = Sha256Digest(data);
            var (lo, hi) = Cs64Digest(data, digest);

            Span<byte> cs64Bytes = stackalloc byte[8];
            BinaryPrimitives.WriteUInt32LittleEndian(cs64Bytes.Slice(0, 4), lo);
            BinaryPrimitives.WriteUInt32LittleEndian(cs64Bytes.Slice(4, 4), hi);

            return $"{Convert.ToHexString(cs64Bytes)}-{Convert.ToHexString(digest)}";
        }

        private static void ExpandSchedule(uint[] w, int firstWord)
        {
            for (int i = firstWord; i < 64; i++)
            {
                w[i] = unchecked(Sigma1(w[i - 2]) + w[i - 7] + Sigma0(w[i - 15]) + w[i - 16]);
            }
        }

        private static uint[] Sha256Rounds(uint[] state, uint[] w, int firstRound = 0)
        {
            uint a = state[0], b = state[1], c = state[2], d = state[3];
            uint e = state[4], f = state[5], g = state[6], h = state[7];
            var k = firstRound == 14 ? Sha256BlockConstants : Sha256RoundConstants;

            for (int i = firstRound; i < 64; i++)
            {
                uint s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
                uint ch = g ^ (e & (f ^ g));
                uint t1 = unchecked(h + s1 + ch + k[i] + w[i]);
                uint s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
                uint maj = (a & b) | (c & (a | b));
                uint t2 = unchecked(s0 + maj);

                h = g;
                g = f;
                f = e;
                e = unchecked(d + t1);
                d = c;
                c = b;
                b = a;
                a = unchecked(t1 + t2);
            }

            return new[] { a, b, c, d, e, f, g, h };
        }

        private static uint[] Sha256Init(ReadOnlySpan<byte> prefix7)
        {
            var w = new uint[64];
            w[14] = ((uint)prefix7[0] << 16) | ((uint)prefix7[1] << 8) | prefix7[2];
            w[15] = BinaryPrimitives.ReadUInt32BigEndian(prefix7.Slice(3, 4));

            for (int i = 16; i < 30; i++)
            {
                uint value = Sha256Schedule[i - 16];
                if (i - 2 >= 14)
                {
                    uint s1 = Sigma1(w[i - 2]);
                    value = unchecked(value + (i == 16 ? (s1 ^ Sha256Sigma1Adjustment) : s1));
                }
                if (i - 7 >= 14)
                {
                    value = unchecked(value + w[i - 7]);
                }
                if (i - 15 >= 14)
                {
                    uint s0 = Sigma0(w[i - 15]);
                    value = unchecked(value + (i == 29 ? (s0 ^ Sha256Sigma0Adjustment) : s0));
                }
                w[i] = value;
            }

            w[30] = unchecked(
                Sigma1(w[28]) + w[23] + Sigma0(w[15]) + w[14] + Sha256Adjustment - Sha256RoundConstants[14]
            );

            ExpandSchedule(w, 31);
            var working = Sha256Rounds(Sha256State, w, 14);
            var state = new uint[8];
            for (int i = 0; i < 8; i++)
                state[i] = unchecked(Sha256Initial[i] + working[i]);
            return state;
        }

        private static byte[] Sha256Digest(byte[] data)
        {
            int length = 57 + data.Length;
            int tailLen = data.Length - 7;
            int zeroPad = ((55 - length) % 64 + 64) % 64;
            var padded = new byte[tailLen + 1 + zeroPad + 8];
            Buffer.BlockCopy(data, 7, padded, 0, tailLen);
            padded[tailLen] = 0x80;
            BinaryPrimitives.WriteUInt64BigEndian(padded.AsSpan(padded.Length - 8, 8), (ulong)length * 8UL);

            var state = Sha256Init(data.AsSpan(0, 7));
            var w = new uint[64];
            for (int offset = 0; offset < padded.Length; offset += 64)
            {
                for (int i = 0; i < 16; i++)
                    w[i] = BinaryPrimitives.ReadUInt32BigEndian(padded.AsSpan(offset + i * 4, 4));
                ExpandSchedule(w, 16);
                var working = Sha256Rounds(state, w, 0);
                for (int i = 0; i < 8; i++)
                    state[i] = unchecked(state[i] + working[i]);
            }

            var output = new byte[32];
            for (int i = 0; i < 8; i++)
                BinaryPrimitives.WriteUInt32BigEndian(output.AsSpan(i * 4, 4), state[i]);
            return output;
        }

        private static (uint Lo, uint Hi) Cs64Digest(byte[] data, byte[] digest)
        {
            uint keyA = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(0, 4)) | 1u;
            uint keyB = BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(4, 4)) | 1u;

            uint factorA = unchecked(keyA * Cs64Factor);
            uint factorB = unchecked(keyB * Cs64Factor);

            var terms = new List<uint>(Cs64Coefficients.Length + 20);
            var offsets = new List<uint>(Cs64Coefficients.Length + 20);

            for (int i = 0; i < Cs64Coefficients.Length; i++)
            {
                var (coeff, off) = Cs64Coefficients[i];
                terms.Add(unchecked(coeff * (i % 2 == 0 ? factorA : factorB)));
                offsets.Add(off);
            }

            // b"\x00" + data padded to 4-byte little-endian words, even count
            int rawLen = 1 + data.Length;
            int pad4 = (4 - (rawLen % 4)) % 4;
            int wordCount = (rawLen + pad4) / 4;
            if (wordCount % 2 != 0) wordCount++;
            var buf = new byte[wordCount * 4];
            Buffer.BlockCopy(data, 0, buf, 1, data.Length);

            for (int i = 0; i < wordCount; i++)
            {
                uint word = BinaryPrimitives.ReadUInt32LittleEndian(buf.AsSpan(i * 4, 4));
                uint term = unchecked(word * (i % 2 == 0 ? keyA : keyB));
                uint offset = unchecked(Rol16(word) * (i % 2 == 0 ? 0xEF0569FBu : 0xC31713DBu));
                if (i == 0)
                {
                    term = unchecked(term + Cs64Adjustment0 * factorA);
                    offset = unchecked(offset + Cs64Adjustment1);
                }
                terms.Add(term);
                offsets.Add(offset);
            }

            uint swapAcc = 0, swapLast = 0, state = 0, acc = 0;
            for (int i = 0; i < terms.Count; i += 2)
            {
                uint x = terms[i];
                uint y = terms[i + 1];

                uint t = Rol16(unchecked(offsets[i] + x));
                uint q = unchecked(t * 0x76F50F34u);
                swapAcc = unchecked(swapAcc + Rol16(q) * 0xC3EFEA97u + q);

                t = Rol16(unchecked(offsets[i + 1] + y));
                q = unchecked(t * 0x1881CE3Cu);
                swapLast = unchecked(Rol16(q) * 0x35BD1EC9u + q);
                swapAcc = unchecked(swapAcc + swapLast);

                state = unchecked(state * keyA + x);
                state = unchecked(Rol16(state) * 0xCF98B111u);
                state = unchecked(Rol16(state) * 0x87085B9Fu);
                state = unchecked(Rol16(state) * 0x12CEB96Du);
                state = unchecked(Rol16(state) * 0x257E1D83u);
                acc = unchecked(acc + state);

                t = unchecked(state * keyB + y);
                t = unchecked(Rol16(t) * 0xA27416F5u);
                t = unchecked(Rol16(t) * 0xD38396FFu);
                state = unchecked(Rol16(unchecked(Rol16(t) * 0x7C932B89u)) * 0xBFA49F69u);
                acc = unchecked(acc + state);
            }

            return (swapLast ^ state, swapAcc ^ acc);
        }
    }
}
