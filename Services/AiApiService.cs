using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using HaruEnglishPet.Models;

namespace HaruEnglishPet.Services;

public class AiApiService
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(45) };

    public async Task<JsonObject> ChatAsync(
        ApiConfig api,
        string englishLevel,
        string userMessage,
        List<ChatTurn> history,
        List<WeakWord> weakWords,
        string correctionStyle = "gentle",
        List<string>? activeStudyWords = null)
    {
        if (string.IsNullOrWhiteSpace(api.ApiKey) && !IsLocalEndpoint(api.BaseUrl))
        {
            return BuildOfflineChatFallback(englishLevel, userMessage);
        }

        var practiceWords = (activeStudyWords ?? new List<string>())
            .Where(w => !string.IsNullOrWhiteSpace(w))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(3)
            .ToList();
        if (practiceWords.Count == 0)
        {
            practiceWords = weakWords
                .Where(w => !w.Mastered && !string.IsNullOrWhiteSpace(w.Word))
                .Take(3)
                .Select(w => w.Word)
                .ToList();
        }
        var weakClause = practiceWords.Count > 0
            ? $"ACTIVE VOCABULARY PRACTICE: The learner is currently studying these words: [{string.Join(", ", practiceWords)}]. Naturally weave 1 or 2 of them into your `replyEn` when it fits the context, and wrap each used target word in **double asterisks** (e.g. **word**) so the learner notices it in real conversation."
            : "";
        var isStrict = string.Equals(correctionStyle, "strict", StringComparison.OrdinalIgnoreCase);
        var correctionRule = isStrict
            ? "STRICT COACHING MODE: Carefully inspect the user's English for ANY grammar, tense, article, preposition, or unnatural phrasing issues. ALWAYS provide a clear, concise correction plus a more idiomatic native rewrite in the `correction` field (in Chinese + English example)."
            : "GENTLE CHAT MODE: Prioritize warm, flowing conversation without interrupting. Leave `correction` empty unless there is a clear grammar/spelling mistake worth a brief friendly tip.";

        var systemPrompt = $$"""
You are Haru, a cheerful, warm, encouraging 2D anime desktop pet who helps the user practice English.
Target learner English level: CEFR {{englishLevel}}.
- Match your vocabulary, sentence length, and idioms to CEFR {{englishLevel}}.
- Keep your reply concise (1 to 3 natural spoken English sentences) so it feels like a lively desktop companion.
- {{correctionRule}}
- {{weakClause}}
- ALWAYS respond ONLY as strict JSON with this exact schema (no markdown code fences):
{
  "replyEn": "Your natural English reply to speak aloud",
  "replyZh": "Natural Chinese translation of your reply",
  "correction": "Optional correction/idiomatic rewrite or empty string",
  "emotion": "one of: happy, friendly, shy, surprised, excited, sad, pouting, wink, nod, cheer",
  "vocabulary": [
    { "word": "useful word from reply", "phonetic": "/.../", "meaning": "中文释义", "example": "short example" }
  ]
}
""";

        var messages = new JsonArray
        {
            new JsonObject { ["role"] = "system", ["content"] = systemPrompt }
        };

        foreach (var turn in history.TakeLast(10))
        {
            messages.Add(new JsonObject
            {
                ["role"] = turn.Role,
                ["content"] = turn.Content
            });
        }
        messages.Add(new JsonObject { ["role"] = "user", ["content"] = userMessage });

        var payload = new JsonObject
        {
            ["model"] = string.IsNullOrWhiteSpace(api.Model) ? "gpt-4o-mini" : api.Model,
            ["temperature"] = api.Temperature,
            ["messages"] = messages
        };

        try
        {
            var raw = await PostJsonAsync(CombineUrl(api.BaseUrl, "/chat/completions"), api.ApiKey, payload);
            var content = ExtractAssistantText(raw);
            var parsed = TryParseJsonObject(content);
            if (parsed != null && parsed["replyEn"] != null)
            {
                parsed["ok"] = true;
                parsed["offline"] = false;
                return parsed;
            }
            return new JsonObject
            {
                ["ok"] = true,
                ["offline"] = false,
                ["replyEn"] = content.Trim(),
                ["replyZh"] = "",
                ["correction"] = "",
                ["emotion"] = "happy",
                ["vocabulary"] = new JsonArray()
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["error"] = ex.Message,
                ["replyEn"] = "Oops, I had trouble reaching your AI API. Please check your API URL or key in Settings!",
                ["replyZh"] = $"连接 API 失败：{ex.Message}",
                ["emotion"] = "sad",
                ["vocabulary"] = new JsonArray()
            };
        }
    }

    public async Task<JsonObject> TranslateAsync(ApiConfig api, string text, string englishLevel)
    {
        if (string.IsNullOrWhiteSpace(api.ApiKey) && !IsLocalEndpoint(api.BaseUrl))
        {
            return new JsonObject
            {
                ["ok"] = true,
                ["offline"] = true,
                ["original"] = text,
                ["translation"] = "当前未配置 AI API，无法进行深度智能翻译。请点击托盘「设置」填入 OpenAI / DeepSeek / 硅基流动 / Ollama 等兼容 API Key 即可解锁完整翻译与语法解析！",
                ["phonetic"] = "",
                ["grammarNote"] = "提示：本地词库单词可在知识库与不熟练单词本中直接查询与测验。",
                ["emotion"] = "shy",
                ["keyWords"] = new JsonArray()
            };
        }

        var systemPrompt = $$"""
You are Haru, an English learning desktop pet assistant.
The user will input English text (a word, phrase, or sentence/paragraph). If they input Chinese, translate it to natural English suitable for CEFR {{englishLevel}} and explain.
ALWAYS return ONLY strict JSON (no markdown fences):
{
  "translation": "Accurate, natural Chinese translation (or English if input was Chinese)",
  "spokenEnglish": "Clean English text to read aloud",
  "phonetic": "IPA phonetic transcription if input is a word or short phrase, otherwise empty string",
  "grammarNote": "Brief, clear Chinese explanation of sentence structure, tone, or usage tips",
  "emotion": "friendly",
  "keyWords": [
    { "word": "key word or phrase", "phonetic": "/.../", "meaning": "中文释义", "example": "short example sentence" }
  ]
}
""";

        var payload = new JsonObject
        {
            ["model"] = string.IsNullOrWhiteSpace(api.Model) ? "gpt-4o-mini" : api.Model,
            ["temperature"] = 0.3,
            ["messages"] = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = systemPrompt },
                new JsonObject { ["role"] = "user", ["content"] = $"Please translate and explain:\n{text}" }
            }
        };

        try
        {
            var raw = await PostJsonAsync(CombineUrl(api.BaseUrl, "/chat/completions"), api.ApiKey, payload);
            var content = ExtractAssistantText(raw);
            var parsed = TryParseJsonObject(content);
            if (parsed != null && parsed["translation"] != null)
            {
                parsed["ok"] = true;
                parsed["original"] = text;
                if (parsed["spokenEnglish"] == null || string.IsNullOrWhiteSpace(parsed["spokenEnglish"]?.ToString()))
                    parsed["spokenEnglish"] = text;
                return parsed;
            }
            return new JsonObject
            {
                ["ok"] = true,
                ["original"] = text,
                ["translation"] = content.Trim(),
                ["spokenEnglish"] = text,
                ["phonetic"] = "",
                ["grammarNote"] = "",
                ["emotion"] = "friendly",
                ["keyWords"] = new JsonArray()
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["error"] = ex.Message,
                ["original"] = text,
                ["translation"] = $"翻译请求失败：{ex.Message}",
                ["emotion"] = "sad",
                ["keyWords"] = new JsonArray()
            };
        }
    }

    public async Task<JsonObject> TranscribeAudioAsync(ApiConfig api, string base64Audio, string mimeType)
    {
        if (string.IsNullOrWhiteSpace(api.ApiKey) && !IsLocalEndpoint(api.BaseUrl))
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["error"] = "未配置 API Key，无法调用 Whisper 语音转文字。请在设置中配置 API 或切换为浏览器内置语音识别。"
            };
        }

        try
        {
            var bytes = Convert.FromBase64String(base64Audio);
            var ext = mimeType.Contains("wav") ? "wav" : mimeType.Contains("ogg") ? "ogg" : mimeType.Contains("mp4") ? "m4a" : "webm";

            using var form = new MultipartFormDataContent();
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(mimeType) ? "audio/webm" : mimeType.Split(';')[0]);
            form.Add(fileContent, "file", $"recording.{ext}");
            form.Add(new StringContent(string.IsNullOrWhiteSpace(api.WhisperModel) ? "whisper-1" : api.WhisperModel), "model");
            form.Add(new StringContent("en"), "language");

            using var req = new HttpRequestMessage(HttpMethod.Post, CombineUrl(api.BaseUrl, "/audio/transcriptions"));
            if (!string.IsNullOrWhiteSpace(api.ApiKey))
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", api.ApiKey);
            req.Content = form;

            using var resp = await _http.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                return new JsonObject { ["ok"] = false, ["error"] = $"HTTP {(int)resp.StatusCode}: {Truncate(body, 220)}" };
            }

            var node = JsonNode.Parse(body)?.AsObject();
            var text = node?["text"]?.ToString()?.Trim() ?? "";
            return new JsonObject { ["ok"] = true, ["text"] = text };
        }
        catch (Exception ex)
        {
            return new JsonObject { ["ok"] = false, ["error"] = ex.Message };
        }
    }

    public async Task<JsonObject> TestConnectionAsync(ApiConfig api)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var payload = new JsonObject
            {
                ["model"] = string.IsNullOrWhiteSpace(api.Model) ? "gpt-4o-mini" : api.Model,
                ["max_tokens"] = 16,
                ["messages"] = new JsonArray
                {
                    new JsonObject { ["role"] = "user", ["content"] = "Say 'Hello!' in one short sentence." }
                }
            };
            var raw = await PostJsonAsync(CombineUrl(api.BaseUrl, "/chat/completions"), api.ApiKey, payload);
            sw.Stop();
            var reply = ExtractAssistantText(raw);
            return new JsonObject
            {
                ["ok"] = true,
                ["latencyMs"] = sw.ElapsedMilliseconds,
                ["message"] = $"已连接 · {sw.ElapsedMilliseconds}ms",
                ["reply"] = reply.Trim()
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new JsonObject
            {
                ["ok"] = false,
                ["latencyMs"] = sw.ElapsedMilliseconds,
                ["message"] = $"连接失败：{ex.Message}"
            };
        }
    }

    private async Task<JsonObject> PostJsonAsync(string url, string apiKey, JsonObject payload)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        if (!string.IsNullOrWhiteSpace(apiKey))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"HTTP {(int)resp.StatusCode}: {Truncate(body, 240)}");
        return JsonNode.Parse(body)?.AsObject() ?? new JsonObject();
    }

    private static string ExtractAssistantText(JsonObject raw)
    {
        return raw["choices"]?[0]?["message"]?["content"]?.ToString() ?? "";
    }

    private static JsonObject? TryParseJsonObject(string text)
    {
        try
        {
            var clean = text.Trim();
            if (clean.StartsWith("```"))
            {
                var firstNewline = clean.IndexOf('\n');
                if (firstNewline >= 0) clean = clean[(firstNewline + 1)..];
                if (clean.EndsWith("```")) clean = clean[..^3];
                clean = clean.Trim();
            }
            var start = clean.IndexOf('{');
            var end = clean.LastIndexOf('}');
            if (start >= 0 && end > start)
                clean = clean[start..(end + 1)];
            return JsonNode.Parse(clean)?.AsObject();
        }
        catch
        {
            return null;
        }
    }

    private static bool IsLocalEndpoint(string url)
    {
        var lower = (url ?? "").ToLowerInvariant();
        return lower.Contains("localhost") || lower.Contains("127.0.0.1") || lower.Contains("0.0.0.0");
    }

    private static string CombineUrl(string baseUrl, string path)
    {
        var b = (baseUrl ?? "https://api.openai.com/v1").TrimEnd('/');
        return b + path;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "...";

    private static JsonObject BuildOfflineChatFallback(string level, string userMessage)
    {
        var lower = userMessage.Trim().ToLowerInvariant();
        string en, zh, emotion;
        if (lower.Contains("hello") || lower.Contains("hi") || lower.Contains("hey") || lower.Contains("morning"))
        {
            en = $"Hi there! I'm Haru, your {level} English buddy. How is your day going so far?";
            zh = $"你好呀！我是你的 {level} 英语桌宠 Haru，今天过得怎么样？（在设置中填入 API Key 可解锁完整 AI 自由对话）";
            emotion = "happy";
        }
        else if (lower.Contains("how are you"))
        {
            en = "I'm feeling wonderful and ready to practice English with you! What shall we talk about?";
            zh = "我感觉超棒，随时准备好陪你练英语！你想聊点什么呢？";
            emotion = "excited";
        }
        else if (lower.Contains("tired") || lower.Contains("sad") || lower.Contains("hard"))
        {
            en = "Hang in there! Take a short break if you need one. You're doing better than you think!";
            zh = "坚持住哦！累了就休息一下，你其实已经做得很棒啦！";
            emotion = "shy";
        }
        else if (lower.Contains("thank"))
        {
            en = "You're very welcome! Practicing a little bit every day makes a huge difference.";
            zh = "不客气！每天练习一点点，进步就会非常大哦！";
            emotion = "happy";
        }
        else
        {
            en = $"Nice English! You said: \"{userMessage}\". Tip: Add your OpenAI / DeepSeek / Ollama API key in Settings so I can chat with you about any topic at {level} level!";
            zh = $"很棒的英文表达！在设置里配置你自己的 API Key 后，我就能按 {level} 水平和你畅所欲言啦！";
            emotion = "friendly";
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["offline"] = true,
            ["replyEn"] = en,
            ["replyZh"] = zh,
            ["correction"] = "",
            ["emotion"] = emotion,
            ["vocabulary"] = new JsonArray()
        };
    }
}
