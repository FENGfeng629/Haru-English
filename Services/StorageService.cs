using System.IO;
using System.Text.Json;
using HaruEnglishPet.Models;

namespace HaruEnglishPet.Services;

public class StorageService
{
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

    public StorageService()
    {
        DataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "HaruEnglishPet"
        );
        KnowledgeDir = Path.Combine(DataDir, "knowledge_packs");
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(KnowledgeDir);
        EnsureStarterKnowledgePacks();
    }

    public AppSettings LoadSettings()
    {
        if (!File.Exists(SettingsPath))
        {
            var defaults = new AppSettings();
            SaveSettings(defaults);
            return defaults;
        }
        try
        {
            var json = File.ReadAllText(SettingsPath);
            return JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public void SaveSettings(AppSettings settings)
    {
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

    public List<KnowledgePack> LoadAllKnowledgePacks()
    {
        var packs = new List<KnowledgePack>();
        foreach (var file in Directory.GetFiles(KnowledgeDir, "*.json"))
        {
            try
            {
                var json = File.ReadAllText(file);
                var pack = JsonSerializer.Deserialize<KnowledgePack>(json, JsonOptions);
                if (pack != null) packs.Add(pack);
            }
            catch
            {
                // Skip invalid files gracefully
            }
        }
        return packs.OrderByDescending(p => p.BuiltIn).ThenBy(p => p.Level).ThenBy(p => p.Name).ToList();
    }

    public void SaveKnowledgePack(KnowledgePack pack)
    {
        if (string.IsNullOrWhiteSpace(pack.Id))
            pack.Id = Guid.NewGuid().ToString("N")[..10];
        pack.UpdatedAt = DateTime.UtcNow.ToString("o");
        var safeId = string.Concat(pack.Id.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_'));
        if (string.IsNullOrWhiteSpace(safeId)) safeId = Guid.NewGuid().ToString("N")[..10];
        var path = Path.Combine(KnowledgeDir, $"{safeId}.json");
        File.WriteAllText(path, JsonSerializer.Serialize(pack, JsonOptions));
    }

    public bool DeleteKnowledgePack(string id)
    {
        var safeId = string.Concat(id.Where(c => char.IsLetterOrDigit(c) || c == '-' || c == '_'));
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
            SchemaVersion = 1,
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

    private void EnsureStarterKnowledgePacks()
    {
        var packs = new List<KnowledgePack>
        {
            new KnowledgePack
            {
                Id = "builtin-a1-a2-daily",
                Name = "Daily Essentials (A1-A2)",
                Description = "Everyday core English vocabulary and friendly expressions for beginners.",
                Level = "A1",
                Category = "vocabulary",
                BuiltIn = true,
                Entries = new List<KnowledgeEntry>
                {
                    new() { Word = "cheerful", Phonetic = "/ˈtʃɪrfəl/", PartOfSpeech = "adj.", Meaning = "开朗的，高兴的", Example = "She always has a cheerful smile in the morning.", Level = "A2" },
                    new() { Word = "curious", Phonetic = "/ˈkjʊriəs/", PartOfSpeech = "adj.", Meaning = "好奇的", Example = "I am curious about how this app works.", Level = "A2" },
                    new() { Word = "habit", Phonetic = "/ˈhæbɪt/", PartOfSpeech = "n.", Meaning = "习惯", Example = "Studying English for 15 minutes a day is a great habit.", Level = "A2" },
                    new() { Word = "improve", Phonetic = "/ɪmˈpruːv/", PartOfSpeech = "v.", Meaning = "提高，改善", Example = "Practice every day to improve your speaking skills.", Level = "A2" },
                    new() { Word = "journey", Phonetic = "/ˈdʒɜːrni/", PartOfSpeech = "n.", Meaning = "旅程", Example = "Learning a language is a wonderful journey.", Level = "A2" },
                    new() { Word = "polite", Phonetic = "/pəˈlaɪt/", PartOfSpeech = "adj.", Meaning = "有礼貌的", Example = "It is polite to say thank you.", Level = "A1" },
                    new() { Word = "patient", Phonetic = "/ˈpeɪʃənt/", PartOfSpeech = "adj.", Meaning = "有耐心的", Example = "Be patient with yourself when learning new words.", Level = "A2" },
                    new() { Word = "remember", Phonetic = "/rɪˈmembər/", PartOfSpeech = "v.", Meaning = "记住", Example = "I can remember this word easily now.", Level = "A1" },
                    new() { Word = "weather", Phonetic = "/ˈweðər/", PartOfSpeech = "n.", Meaning = "天气", Example = "The weather is sunny and warm today.", Level = "A1" },
                    new() { Word = "wonderful", Phonetic = "/ˈwʌndərfəl/", PartOfSpeech = "adj.", Meaning = "精彩的，极好的", Example = "You did a wonderful job on the quiz!", Level = "A1" },
                    new() { Word = "encourage", Phonetic = "/ɪnˈkɜːrɪdʒ/", PartOfSpeech = "v.", Meaning = "鼓励", Example = "Haru will always encourage you to keep going.", Level = "A2" },
                    new() { Word = "favorite", Phonetic = "/ˈfeɪvərɪt/", PartOfSpeech = "adj.", Meaning = "最喜欢的", Example = "What is your favorite English song?", Level = "A1" }
                }
            },
            new KnowledgePack
            {
                Id = "builtin-b1-b2-fluent",
                Name = "Fluent Conversation (B1-B2)",
                Description = "Practical intermediate to upper-intermediate words for natural English chats.",
                Level = "B1",
                Category = "vocabulary",
                BuiltIn = true,
                Entries = new List<KnowledgeEntry>
                {
                    new() { Word = "consistent", Phonetic = "/kənˈsɪstənt/", PartOfSpeech = "adj.", Meaning = "坚持不懈的，一致的", Example = "Consistent practice brings remarkable progress.", Level = "B2" },
                    new() { Word = "enthusiastic", Phonetic = "/ɪnˌθjuːziˈæstɪk/", PartOfSpeech = "adj.", Meaning = "热情的，满腔热忱的", Example = "She sounded very enthusiastic about the trip.", Level = "B2" },
                    new() { Word = "hesitate", Phonetic = "/ˈhezɪteɪt/", PartOfSpeech = "v.", Meaning = "犹豫，迟疑", Example = "Don't hesitate to ask me if you need a translation.", Level = "B1" },
                    new() { Word = "accomplish", Phonetic = "/əˈkɑːmplɪʃ/", PartOfSpeech = "v.", Meaning = "完成，实现", Example = "You accomplished a full hour of English study!", Level = "B2" },
                    new() { Word = "perspective", Phonetic = "/pərˈspektɪv/", PartOfSpeech = "n.", Meaning = "视角，观点", Example = "Reading in English gives you a fresh perspective.", Level = "B2" },
                    new() { Word = "reluctant", Phonetic = "/rɪˈlʌktənt/", PartOfSpeech = "adj.", Meaning = "不情愿的，勉强的", Example = "He was reluctant to speak aloud at first.", Level = "B2" },
                    new() { Word = "appreciate", Phonetic = "/əˈpriːʃieɪt/", PartOfSpeech = "v.", Meaning = "感激，欣赏", Example = "I really appreciate your effort today.", Level = "B1" },
                    new() { Word = "flexible", Phonetic = "/ˈfleksəbəl/", PartOfSpeech = "adj.", Meaning = "灵活的", Example = "Our study schedule is very flexible.", Level = "B1" },
                    new() { Word = "overcome", Phonetic = "/ˌoʊvərˈkʌm/", PartOfSpeech = "v.", Meaning = "克服，战胜", Example = "With practice, you can overcome shyness.", Level = "B1" },
                    new() { Word = "memorable", Phonetic = "/ˈmemərəbəl/", PartOfSpeech = "adj.", Meaning = "难忘的", Example = "Today's conversation was truly memorable.", Level = "B1" },
                    new() { Word = "articulate", Phonetic = "/ɑːrˈtɪkjəleɪt/", PartOfSpeech = "v./adj.", Meaning = "清晰表达；口齿伶俐的", Example = "Try to articulate each syllable clearly.", Level = "B2" },
                    new() { Word = "spontaneous", Phonetic = "/spɑːnˈteɪniəs/", PartOfSpeech = "adj.", Meaning = "自发的，即兴的", Example = "Spontaneous chats help build real fluency.", Level = "B2" }
                }
            },
            new KnowledgePack
            {
                Id = "builtin-c1-c2-advanced",
                Name = "Advanced Mastery (C1-C2)",
                Description = "Nuanced, eloquent vocabulary and idioms for advanced English learners.",
                Level = "C1",
                Category = "vocabulary",
                BuiltIn = true,
                Entries = new List<KnowledgeEntry>
                {
                    new() { Word = "eloquent", Phonetic = "/ˈeləkwənt/", PartOfSpeech = "adj.", Meaning = "雄辩的，富有表现力的", Example = "She gave an eloquent speech without any notes.", Level = "C1" },
                    new() { Word = "ubiquitous", Phonetic = "/juːˈbɪkwɪtəs/", PartOfSpeech = "adj.", Meaning = "无处不在的", Example = "AI assistants have become ubiquitous in daily work.", Level = "C1" },
                    new() { Word = "serendipity", Phonetic = "/ˌserənˈdɪpəti/", PartOfSpeech = "n.", Meaning = "机缘巧合，意外发现珍奇事物的运气", Example = "Finding this charming study buddy felt like pure serendipity.", Level = "C2" },
                    new() { Word = "resilient", Phonetic = "/rɪˈzɪliənt/", PartOfSpeech = "adj.", Meaning = "有韧性的，能迅速恢复的", Example = "Resilient learners treat mistakes as stepping stones.", Level = "C1" },
                    new() { Word = "nuance", Phonetic = "/ˈnuːɑːns/", PartOfSpeech = "n.", Meaning = "细微差别", Example = "Understanding tone and nuance makes your English sound native.", Level = "C1" },
                    new() { Word = "meticulous", Phonetic = "/məˈtɪkjələs/", PartOfSpeech = "adj.", Meaning = "一丝不苟的，细致的", Example = "She keeps meticulous notes of every unfamiliar idiom.", Level = "C1" },
                    new() { Word = "ephemeral", Phonetic = "/ɪˈfemərəl/", PartOfSpeech = "adj.", Meaning = "短暂的，转瞬即逝的", Example = "Motivation can be ephemeral, so habits matter more.", Level = "C2" },
                    new() { Word = "pragmatic", Phonetic = "/præɡˈmætɪk/", PartOfSpeech = "adj.", Meaning = "务实的，实用主义的", Example = "Let's take a pragmatic approach to expanding your vocabulary.", Level = "C1" },
                    new() { Word = "perspicacious", Phonetic = "/ˌpɜːrspɪˈkeɪʃəs/", PartOfSpeech = "adj.", Meaning = "敏锐的，有洞察力的", Example = "That was a remarkably perspicacious observation.", Level = "C2" },
                    new() { Word = "conscientious", Phonetic = "/ˌkɑːnʃiˈenʃəs/", PartOfSpeech = "adj.", Meaning = "认真尽责的，勤勉的", Example = "A conscientious student reviews weak words regularly.", Level = "C1" }
                }
            },
            new KnowledgePack
            {
                Id = "builtin-phrases-idioms",
                Name = "Everyday Phrases & Idioms",
                Description = "High-frequency spoken English expressions you can use immediately in conversation.",
                Level = "B1",
                Category = "phrases",
                BuiltIn = true,
                Entries = new List<KnowledgeEntry>
                {
                    new() { Word = "break the ice", Phonetic = "/breɪk ði aɪs/", PartOfSpeech = "idiom", Meaning = "打破僵局，破冰", Example = "A warm smile is the easiest way to break the ice.", Level = "B1" },
                    new() { Word = "hang in there", Phonetic = "/hæŋ ɪn ðer/", PartOfSpeech = "phrase", Meaning = "坚持住，别放弃", Example = "Hang in there! You're getting better every day.", Level = "A2" },
                    new() { Word = "piece of cake", Phonetic = "/piːs əv keɪk/", PartOfSpeech = "idiom", Meaning = "小菜一碟", Example = "After reviewing twice, this quiz is a piece of cake!", Level = "A2" },
                    new() { Word = "on the same page", Phonetic = "/ɑːn ðə seɪm peɪdʒ/", PartOfSpeech = "idiom", Meaning = "达成共识，想法一致", Example = "Let's review the plan so we're on the same page.", Level = "B2" },
                    new() { Word = "call it a day", Phonetic = "/kɔːl ɪt ə deɪ/", PartOfSpeech = "idiom", Meaning = "今天就到此为止，收工", Example = "We studied for a whole hour—let's call it a day!", Level = "B1" },
                    new() { Word = "hit the books", Phonetic = "/hɪt ðə bʊks/", PartOfSpeech = "idiom", Meaning = "用功学习，啃书本", Example = "Time to hit the books for ten minutes!", Level = "B1" },
                    new() { Word = "figure out", Phonetic = "/ˈfɪɡjər aʊt/", PartOfSpeech = "phrasal v.", Meaning = "弄清楚，想明白", Example = "Together we can figure out any tricky grammar rule.", Level = "B1" },
                    new() { Word = "keep it up", Phonetic = "/kiːp ɪt ʌp/", PartOfSpeech = "phrase", Meaning = "继续保持，再接再厉", Example = "Amazing pronunciation—keep it up!", Level = "A2" }
                }
            }
        };

        foreach (var pack in packs)
        {
            var path = Path.Combine(KnowledgeDir, $"{pack.Id}.json");
            if (!File.Exists(path))
            {
                File.WriteAllText(path, JsonSerializer.Serialize(pack, JsonOptions));
            }
        }
    }
}
