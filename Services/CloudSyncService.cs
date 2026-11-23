using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using HaruEnglishPet.Models;

namespace HaruEnglishPet.Services;

public class CloudSyncService
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(25) };

    public async Task<JsonObject> SyncAsync(CloudSyncConfig cfg, StorageService storage, string mode = "merge")
    {
        var provider = (cfg.Provider ?? "none").ToLowerInvariant();
        if (provider == "none")
            return new JsonObject { ["ok"] = false, ["message"] = "尚未启用云端同步，请先在设置中选择云端类型（WebDAV / GitHub Gist / 自定义 REST）。" };

        try
        {
            SyncPayload? remote = null;
            if (mode == "pull" || mode == "merge")
            {
                remote = provider switch
                {
                    "webdav" => await PullWebDavAsync(cfg),
                    "gist" => await PullGistAsync(cfg),
                    "custom" => await PullCustomRestAsync(cfg),
                    _ => null
                };

                if (remote != null)
                {
                    storage.ApplyMergedSyncPayload(remote);
                }
            }

            string? createdGistId = null;
            if (mode == "push" || mode == "merge")
            {
                var merged = storage.BuildSyncPayload();
                var json = JsonSerializer.Serialize(merged, StorageService.JsonOptions);
                switch (provider)
                {
                    case "webdav":
                        await PushWebDavAsync(cfg, json);
                        break;
                    case "gist":
                        createdGistId = await PushGistAsync(cfg, json);
                        break;
                    case "custom":
                        await PushCustomRestAsync(cfg, json);
                        break;
                }
            }

            var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            var settings = storage.LoadSettings();
            settings.CloudSync.LastSyncAt = now;
            if (!string.IsNullOrWhiteSpace(createdGistId))
                settings.CloudSync.GistId = createdGistId;
            storage.SaveSettings(settings);

            var actionLabel = mode switch { "push" => "上传", "pull" => "拉取合并", _ => "双向合并同步" };
            return new JsonObject
            {
                ["ok"] = true,
                ["message"] = $"云端{actionLabel}成功！（{now}）",
                ["lastSyncAt"] = now,
                ["gistId"] = settings.CloudSync.GistId
            };
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["ok"] = false,
                ["message"] = $"云端同步失败：{ex.Message}"
            };
        }
    }

    private string BuildWebDavFileUrl(CloudSyncConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.Endpoint))
            throw new Exception("请填写 WebDAV 地址（例如 https://dav.jianguoyun.com/dav/HaruEnglishPet/）");
        var baseUrl = cfg.Endpoint.TrimEnd('/');
        var file = string.IsNullOrWhiteSpace(cfg.RemoteFileName) ? "haru-english-pet-sync.json" : cfg.RemoteFileName.TrimStart('/');
        return baseUrl.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? baseUrl : $"{baseUrl}/{file}";
    }

    private AuthenticationHeaderValue BuildBasicAuth(string user, string pass)
    {
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{user}:{pass}"));
        return new AuthenticationHeaderValue("Basic", token);
    }

    private async Task<SyncPayload?> PullWebDavAsync(CloudSyncConfig cfg)
    {
        var url = BuildWebDavFileUrl(cfg);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrWhiteSpace(cfg.Username) || !string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            req.Headers.Authorization = BuildBasicAuth(cfg.Username, cfg.TokenOrPassword);

        using var resp = await _http.SendAsync(req);
        if (resp.StatusCode == HttpStatusCode.NotFound)
            return null;
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"WebDAV GET HTTP {(int)resp.StatusCode}");

        var body = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<SyncPayload>(body, StorageService.JsonOptions);
    }

    private async Task PushWebDavAsync(CloudSyncConfig cfg, string json)
    {
        var url = BuildWebDavFileUrl(cfg);
        using var req = new HttpRequestMessage(HttpMethod.Put, url);
        if (!string.IsNullOrWhiteSpace(cfg.Username) || !string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            req.Headers.Authorization = BuildBasicAuth(cfg.Username, cfg.TokenOrPassword);
        req.Content = new StringContent(json, Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"WebDAV PUT HTTP {(int)resp.StatusCode}: {await resp.Content.ReadAsStringAsync()}");
    }

    private async Task<SyncPayload?> PullGistAsync(CloudSyncConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.GistId))
            return null; // Will create new Gist on push

        using var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/gists/{cfg.GistId.Trim()}");
        req.Headers.UserAgent.ParseAdd("HaruEnglishPet/1.0");
        if (!string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.TokenOrPassword.Trim());

        using var resp = await _http.SendAsync(req);
        if (resp.StatusCode == HttpStatusCode.NotFound)
            return null;
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"GitHub Gist GET HTTP {(int)resp.StatusCode}");

        var body = await resp.Content.ReadAsStringAsync();
        var root = JsonNode.Parse(body)?.AsObject();
        var fileName = string.IsNullOrWhiteSpace(cfg.RemoteFileName) ? "haru-english-pet-sync.json" : cfg.RemoteFileName;
        var content = root?["files"]?[fileName]?["content"]?.ToString();
        if (string.IsNullOrWhiteSpace(content)) return null;
        return JsonSerializer.Deserialize<SyncPayload>(content, StorageService.JsonOptions);
    }

    private async Task<string?> PushGistAsync(CloudSyncConfig cfg, string json)
    {
        if (string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            throw new Exception("请填写 GitHub Personal Access Token（需具备 gist 权限）");

        var fileName = string.IsNullOrWhiteSpace(cfg.RemoteFileName) ? "haru-english-pet-sync.json" : cfg.RemoteFileName;
        var payload = new JsonObject
        {
            ["description"] = "Haru English Pet Cloud Sync Data",
            ["public"] = false,
            ["files"] = new JsonObject
            {
                [fileName] = new JsonObject { ["content"] = json }
            }
        };

        var isUpdate = !string.IsNullOrWhiteSpace(cfg.GistId);
        var url = isUpdate ? $"https://api.github.com/gists/{cfg.GistId.Trim()}" : "https://api.github.com/gists";
        var method = isUpdate ? HttpMethod.Patch : HttpMethod.Post;

        using var req = new HttpRequestMessage(method, url);
        req.Headers.UserAgent.ParseAdd("HaruEnglishPet/1.0");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.TokenOrPassword.Trim());
        req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"GitHub Gist HTTP {(int)resp.StatusCode}: {body}");

        var node = JsonNode.Parse(body)?.AsObject();
        return node?["id"]?.ToString();
    }

    private async Task<SyncPayload?> PullCustomRestAsync(CloudSyncConfig cfg)
    {
        if (string.IsNullOrWhiteSpace(cfg.Endpoint))
            throw new Exception("请填写自定义云端 REST Endpoint URL");

        using var req = new HttpRequestMessage(HttpMethod.Get, cfg.Endpoint.Trim());
        if (!string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.TokenOrPassword.Trim());

        using var resp = await _http.SendAsync(req);
        if (resp.StatusCode == HttpStatusCode.NotFound) return null;
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Custom REST GET HTTP {(int)resp.StatusCode}");

        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return null;
        return JsonSerializer.Deserialize<SyncPayload>(body, StorageService.JsonOptions);
    }

    private async Task PushCustomRestAsync(CloudSyncConfig cfg, string json)
    {
        if (string.IsNullOrWhiteSpace(cfg.Endpoint))
            throw new Exception("请填写自定义云端 REST Endpoint URL");

        using var req = new HttpRequestMessage(HttpMethod.Put, cfg.Endpoint.Trim());
        if (!string.IsNullOrWhiteSpace(cfg.TokenOrPassword))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.TokenOrPassword.Trim());
        req.Content = new StringContent(json, Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
            throw new Exception($"Custom REST PUT HTTP {(int)resp.StatusCode}");
    }
}
