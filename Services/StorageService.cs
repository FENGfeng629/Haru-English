using System.IO;
using System.Text.Json;
using HaruEnglishPet.Models;

namespace HaruEnglishPet.Services;

public class StorageService
{
    public const int CurrentVocabVersion = 5;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public string DataDir { get; }
    public string KnowledgeDir { get; }

    private string SettingsPath => Path.Combine(DataDir, "settings.json");
    private string WeakWordsPath => Path.Combine(DataDir, "weak_words.json");
    private string StatsPath => Path.Combine(DataDir, "study_stats.json");
    private string VocabProgressPath => Path.Combine(DataDir, "vocab_progress.json");

    public StorageService()
    {
        DataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HaruEnglishPet"
        );
        KnowledgeDir = Path.Combine(DataDir, "knowledge_packs");
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(KnowledgeDir);
        RunVocabMigrationIfNeeded();
        EnsureBuiltInVocabBooks();
    }

    public AppSettings LoadSettings()
    {
        if (!File.Exists(SettingsPath))
        {
            var defaults = new AppSettings { VocabVersion = CurrentVocabVersion };
            SaveSettings(defaults);
            return defaults;
        }
        try
        {
            var json = File.ReadAllText(SettingsPath);
            return JsonSerializer.Deserialize<AppSettings>(json, JsonOptions)
                ?? new AppSettings { VocabVersion = CurrentVocabVersion };
        }
        catch
        {
            return new AppSettings { VocabVersion = CurrentVocabVersion };
        }
    }

    public void SaveSettings(AppSettings settings)
    {
        if (settings.VocabVersion < CurrentVocabVersion)
            settings.VocabVersion = CurrentVocabVersion;
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, JsonOptions));
    }

    public List<WeakWord> LoadWeakWords()
    {
        if (!File.Exists(WeakWordsPath)) return new List<WeakWord>();
        try
        {
            var json = File.ReadAllText(WeakWordsPath);
            return JsonSerializer.Deserialize<List<WeakWord>>(json, JsonOptions) ?? new List<WeakWord>();
        }
        catch
        {
            return new List<WeakWord>();
        }
    }

    public void SaveWeakWords(List<WeakWord> words)
    {
        File.WriteAllText(WeakWordsPath, JsonSerializer.Serialize(words, JsonOptions));
    }

    public StudyStats LoadStats()
    {
        if (!File.Exists(StatsPath))
        {
            var stats = new StudyStats { TodayDate = DateTime.Now.ToString("yyyy-MM-dd") };
            SaveStats(stats);
            return stats;
        }
        try
        {
            var json = File.ReadAllText(StatsPath);
            var stats = JsonSerializer.Deserialize<StudyStats>(json, JsonOptions) ?? new StudyStats();
            var today = DateTime.Now.ToString("yyyy-MM-dd");
            if (stats.TodayDate != today)
            {
                stats.TodayDate = today;
                stats.TodayStudySeconds = 0;
                SaveStats(stats);
            }
            return stats;
        }
        catch
        {
            return new StudyStats();
        }
    }

    public void SaveStats(StudyStats stats)
    {
        File.WriteAllText(StatsPath, JsonSerializer.Serialize(stats, JsonOptions));
    }

    public VocabProgressStore LoadVocabProgress()
    {
        if (!File.Exists(VocabProgressPath))
        {
            return new VocabProgressStore { DailyDate = DateTime.Now.ToString("yyyy-MM-dd") };
        }
        try
        {
            var json = File.ReadAllText(VocabProgressPath);
            var store = JsonSerializer.Deserialize<VocabProgressStore>(json, JsonOptions) ?? new VocabProgressStore();
            store.DailyQueue ??= new List<string>();
            store.Items ??= new Dictionary<string, WordProgress>(StringComparer.OrdinalIgnoreCase);
            return store;
        }
        catch
        {
            return new VocabProgressStore { DailyDate = DateTime.Now.ToString("yyyy-MM-dd") };
        }
    }

    public void SaveVocabProgress(VocabProgressStore store)
    {
        store.DailyQueue ??= new List<string>();
        store.Items ??= new Dictionary<string, WordProgress>(StringComparer.OrdinalIgnoreCase);
        File.WriteAllText(VocabProgressPath, JsonSerializer.Serialize(store, JsonOptions));
    }

    public List<KnowledgePack> LoadAllKnowledgePacks()
    {
        var packs = new List<KnowledgePack>();
        foreach (var file in Directory.GetFiles(KnowledgeDir, "*.json"))
        {
            try
            {
                var json = File.ReadAllText(file);
                var pack = JsonSerializer.Deserialize<KnowledgePack>(json, JsonOptions);
                if (pack != null)
                {
                    NormalizePack(pack);
                    packs.Add(pack);
                }
            }
            catch
            {
                // Skip invalid files gracefully
            }
        }
        return packs
            .OrderByDescending(p => p.Id == "toefl")
            .ThenByDescending(p => p.Id == "blender")
            .ThenByDescending(p => p.Id == "antigravity")
            .ThenByDescending(p => p.BuiltIn)
            .ThenBy(p => p.Name)
            .ToList();
    }

    public void SaveKnowledgePack(KnowledgePack pack)
    {
        if (string.IsNullOrWhiteSpace(pack.Id))
            pack.Id = Guid.NewGuid().ToString("N")[..10];
        if (string.IsNullOrWhiteSpace(pack.BookId))
            pack.BookId = pack.Id;
        pack.UpdatedAt = DateTime.UtcNow.ToString("o");
        NormalizePack(pack);
        var safeId = SanitizeId(pack.Id);
        var path = Path.Combine(KnowledgeDir, $"{safeId}.json");
        File.WriteAllText(path, JsonSerializer.Serialize(pack, JsonOptions));
    }

    public (int Added, int Total, KnowledgePack TargetPack) ImportVocabEntries(
        string targetBookId,
        string? newPackName,
        string? newPackDesc,
        string? newPackLevel,
        List<KnowledgeEntry> incoming)
    {
        var all = LoadAllKnowledgePacks();
        KnowledgePack? target = null;

        if (!string.IsNullOrWhiteSpace(targetBookId) &&
            !string.Equals(targetBookId, "new", StringComparison.OrdinalIgnoreCase))
        {
            target = all.FirstOrDefault(p =>
                string.Equals(p.Id, targetBookId, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(p.BookId, targetBookId, StringComparison.OrdinalIgnoreCase));
        }

        if (target == null)
        {
            var id = $"custom_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}";
            target = new KnowledgePack
            {
                Id = id,
                BookId = id,
                Name = string.IsNullOrWhiteSpace(newPackName) ? "自定义词库" : newPackName.Trim(),
                Description = string.IsNullOrWhiteSpace(newPackDesc) ? "用户导入的 JSON 词库" : newPackDesc.Trim(),
                Level = string.IsNullOrWhiteSpace(newPackLevel) ? "TOEFL" : newPackLevel.Trim(),
                Category = "custom",
                BuiltIn = false,
                Enabled = true,
                Entries = new List<KnowledgeEntry>()
            };
        }

        var existingKeys = new HashSet<string>(
            target.Entries
                .Where(e => !string.IsNullOrWhiteSpace(e.Word))
                .Select(e => e.Word.Trim().ToLowerInvariant()));

        int added = 0;
        int seq = target.Entries.Count + 1;
        foreach (var raw in incoming)
        {
            if (raw == null || string.IsNullOrWhiteSpace(raw.Word)) continue;
            var word = raw.Word.Trim();
            var key = word.ToLowerInvariant();
            if (!existingKeys.Add(key)) continue;

            var pos = !string.IsNullOrWhiteSpace(raw.Pos) ? raw.Pos.Trim() : raw.PartOfSpeech.Trim();
            var entry = new KnowledgeEntry
            {
                Id = string.IsNullOrWhiteSpace(raw.Id) ? $"{target.Id}_{seq:D4}" : raw.Id.Trim(),
                BookId = target.BookId,
                Word = word,
                Phonetic = raw.Phonetic?.Trim() ?? "",
                Pos = pos,
                PartOfSpeech = pos,
                Meaning = raw.Meaning?.Trim() ?? "",
                Category = string.IsNullOrWhiteSpace(raw.Category)
                    ? (target.Id == "blender" ? "Blender · 自定义"
                        : target.Id == "antigravity" ? "Antigravity · 自定义"
                        : "导入词条")
                    : raw.Category.Trim(),
                UiLocation = raw.UiLocation?.Trim() ?? "",
                Shortcut = raw.Shortcut?.Trim() ?? "",
                Example = raw.Example?.Trim() ?? "",
                ExampleZh = raw.ExampleZh?.Trim() ?? "",
                Level = string.IsNullOrWhiteSpace(raw.Level) ? target.Level : raw.Level.Trim(),
                Tags = raw.Tags ?? new List<string>()
            };
            target.Entries.Add(entry);
            seq++;
            added++;
        }

        SaveKnowledgePack(target);
        return (added, target.Entries.Count, target);
    }

    public bool DeleteKnowledgePack(string id)
    {
        var safeId = SanitizeId(id);
        var path = Path.Combine(KnowledgeDir, $"{safeId}.json");
        if (File.Exists(path))
        {
            File.Delete(path);
            return true;
        }
        return false;
    }

    public SyncPayload BuildSyncPayload()
    {
        var settings = LoadSettings();
        var packs = LoadAllKnowledgePacks().Where(p => !p.BuiltIn).ToList();
        return new SyncPayload
        {
            SchemaVersion = CurrentVocabVersion,
            UpdatedAt = DateTime.UtcNow.ToString("o"),
            EnglishLevel = settings.EnglishLevel,
            Stats = LoadStats(),
            WeakWords = LoadWeakWords(),
            CustomPacks = packs
        };
    }

    public void ApplyMergedSyncPayload(SyncPayload remote)
    {
        var localSettings = LoadSettings();
        if (!string.IsNullOrWhiteSpace(remote.EnglishLevel))
        {
            localSettings.EnglishLevel = remote.EnglishLevel;
            SaveSettings(localSettings);
        }

        // Merge stats safely (take max cumulative progress)
        var localStats = LoadStats();
        localStats.TotalStudySeconds = Math.Max(localStats.TotalStudySeconds, remote.Stats.TotalStudySeconds);
        localStats.LastHourMilestone = Math.Max(localStats.LastHourMilestone, remote.Stats.LastHourMilestone);
        localStats.QuizzesCompleted = Math.Max(localStats.QuizzesCompleted, remote.Stats.QuizzesCompleted);
        localStats.TotalQuizCorrect = Math.Max(localStats.TotalQuizCorrect, remote.Stats.TotalQuizCorrect);
        localStats.TotalQuizWrong = Math.Max(localStats.TotalQuizWrong, remote.Stats.TotalQuizWrong);
        localStats.MessagesSent = Math.Max(localStats.MessagesSent, remote.Stats.MessagesSent);
        localStats.TranslationsDone = Math.Max(localStats.TranslationsDone, remote.Stats.TranslationsDone);
        if (string.Compare(remote.Stats.LastStudyDate, localStats.LastStudyDate, StringComparison.Ordinal) > 0)
            localStats.LastStudyDate = remote.Stats.LastStudyDate;
        localStats.StreakDays = Math.Max(localStats.StreakDays, remote.Stats.StreakDays);
        SaveStats(localStats);

        // Merge weak words by lowercase word
        var localWords = LoadWeakWords();
        var map = localWords.ToDictionary(w => w.Word.Trim().ToLowerInvariant(), w => w);
        foreach (var rw in remote.WeakWords)
        {
            var key = rw.Word.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(key)) continue;
            if (map.TryGetValue(key, out var existing))
            {
                existing.WrongCount = Math.Max(existing.WrongCount, rw.WrongCount);
                existing.CorrectCount = Math.Max(existing.CorrectCount, rw.CorrectCount);
                existing.Mastered = existing.Mastered || rw.Mastered;
                if (string.IsNullOrWhiteSpace(existing.Meaning)) existing.Meaning = rw.Meaning;
                if (string.IsNullOrWhiteSpace(existing.Phonetic)) existing.Phonetic = rw.Phonetic;
                if (string.IsNullOrWhiteSpace(existing.Example)) existing.Example = rw.Example;
                if (string.IsNullOrWhiteSpace(existing.Category)) existing.Category = rw.Category;
                if (string.IsNullOrWhiteSpace(existing.UiLocation)) existing.UiLocation = rw.UiLocation;
                if (string.IsNullOrWhiteSpace(existing.Shortcut)) existing.Shortcut = rw.Shortcut;
            }
            else
            {
                map[key] = rw;
            }
        }
        SaveWeakWords(map.Values.OrderBy(w => w.Mastered).ThenByDescending(w => w.WrongCount).ToList());

        // Merge custom knowledge packs
        foreach (var rp in remote.CustomPacks)
        {
            rp.BuiltIn = false;
            SaveKnowledgePack(rp);
        }
    }

    /// <summary>
    /// Version-gated migration (vocabVersion = 3):
    /// Purges all legacy seed knowledge packs, old weak words, and old word stats
    /// for the TOEFL + Blender 3D + Antigravity tri-vocab system,
    /// while strictly preserving user API keys, voice config, appearance, hotkeys, and pet position.
    /// </summary>
    private void RunVocabMigrationIfNeeded()
    {
        AppSettings settings;
        bool hadSettingsFile = File.Exists(SettingsPath);
        if (hadSettingsFile)
        {
            try
            {
                var json = File.ReadAllText(SettingsPath);
                settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
            }
            catch
            {
                settings = new AppSettings();
            }
        }
        else
        {
            settings = new AppSettings();
        }

        if (settings.VocabVersion >= CurrentVocabVersion)
            return;

        // 1. Delete all legacy knowledge_packs/*.json files
        try
        {
            foreach (var file in Directory.GetFiles(KnowledgeDir, "*.json"))
            {
                try { File.Delete(file); } catch { }
            }
        }
        catch { }

        // 2. Clear legacy weak_words.json
        SaveWeakWords(new List<WeakWord>());

        // 3. Reset legacy word/quiz statistics & SRS progress for the new tri-vocab system
        SaveStats(new StudyStats { TodayDate = DateTime.Now.ToString("yyyy-MM-dd") });
        SaveVocabProgress(new VocabProgressStore { DailyDate = DateTime.Now.ToString("yyyy-MM-dd") });

        // 4. Preserve ALL user settings (API, Voice, Appearance, Hotkeys, Position, CloudSync),
        //    only migrating/resetting stale QuizPackId and bumping VocabVersion = 4
        if (settings.QuizPackId == "toefl_core") settings.QuizPackId = "toefl";
        else if (settings.QuizPackId == "blender_3d") settings.QuizPackId = "blender";
        if (settings.QuizPackId is not ("all" or "weak" or "toefl" or "blender" or "antigravity"))
        {
            settings.QuizPackId = "all";
        }
        settings.VocabVersion = CurrentVocabVersion;
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings, JsonOptions));
    }

    private void EnsureBuiltInVocabBooks()
    {
        var vocabDir = Path.Combine(AppContext.BaseDirectory, "src", "data", "vocab");
        var seedFiles = new (string fileName, string bookId)[]
        {
            ("toefl.json", "toefl"),
            ("blender.json", "blender"),
            ("antigravity.json", "antigravity")
        };

        foreach (var (fileName, bookId) in seedFiles)
        {
            var destPath = Path.Combine(KnowledgeDir, $"{bookId}.json");
            if (File.Exists(destPath)) continue;

            var srcPath = Path.Combine(vocabDir, fileName);
            if (!File.Exists(srcPath)) continue;

            try
            {
                var json = File.ReadAllText(srcPath);
                var pack = JsonSerializer.Deserialize<KnowledgePack>(json, JsonOptions);
                if (pack != null)
                {
                    pack.Id = bookId;
                    pack.BookId = bookId;
                    pack.BuiltIn = true;
                    NormalizePack(pack);
                    File.WriteAllText(destPath, JsonSerializer.Serialize(pack, JsonOptions));
                }
            }
            catch
            {
                // Ignore malformed seed file gracefully
            }
        }
    }

    private static void NormalizePack(KnowledgePack pack)
    {
        if (string.IsNullOrWhiteSpace(pack.BookId))
            pack.BookId = pack.Id;
        if (pack.Entries == null)
        {
            pack.Entries = new List<KnowledgeEntry>();
            return;
        }
        for (int i = 0; i < pack.Entries.Count; i++)
        {
            var e = pack.Entries[i];
            if (string.IsNullOrWhiteSpace(e.Id))
                e.Id = $"{pack.BookId}_{i + 1:D4}";
            if (string.IsNullOrWhiteSpace(e.BookId))
                e.BookId = pack.BookId;
            if (string.IsNullOrWhiteSpace(e.Pos) && !string.IsNullOrWhiteSpace(e.PartOfSpeech))
                e.Pos = e.PartOfSpeech;
            if (string.IsNullOrWhiteSpace(e.PartOfSpeech) && !string.IsNullOrWhiteSpace(e.Pos))
                e.PartOfSpeech = e.Pos;
        }
    }

    private static string SanitizeId(string id)
    {
        var safeId = string.Concat(id.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_'));
        return string.IsNullOrWhiteSpace(safeId) ? Guid.NewGuid().ToString("N")[..10] : safeId;
    }
}
