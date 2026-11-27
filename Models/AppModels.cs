using System.Text.Json.Serialization;

namespace HaruEnglishPet.Models;

public class AppSettings
{
    public int VocabVersion { get; set; } = 0;
    public double PetScale { get; set; } = 1.0;
    // off | quiet | normal | lively | super
    public string ActivityLevel { get; set; } = "normal";
    // A1 | A2 | B1 | B2 | C1 | C2
    public string EnglishLevel { get; set; } = "B1";
    // all | weak | toefl | blender | antigravity | <knowledgePackId>
    public string QuizPackId { get; set; } = "all";
    // Daily Active Pool settings: 5 | 10 | 15 | 20
    public int DailyNewWordsGoal { get; set; } = 10;
    // Checked vocab modules for daily equal-split pool (e.g. ["toefl","blender"] => 50% each)
    public List<string> DailyFocusBooks { get; set; } = new() { "toefl", "blender" };
    // Legacy ratio retained for backward compatibility
    public string DailyFocusRatio { get; set; } = "single_book";
    public string ModelUrl { get; set; } = "models/haru/haru_greeter_t03.model3.json";
    public bool AlwaysOnTop { get; set; } = true;
    public bool LockPosition { get; set; } = false;
    public bool FullscreenDnd { get; set; } = true;
    public bool LaunchAtStartup { get; set; } = false;
    public double PetX { get; set; } = -1; // -1 means auto bottom-right
    public double PetY { get; set; } = -1;
    // Legacy bool retained for backward compatibility; ChineseSubtitleMode takes precedence when set
    public bool ShowChineseSubtitles { get; set; } = true;
    // always | hover | hide
    public string ChineseSubtitleMode { get; set; } = "always";
    // gentle | strict
    public string CorrectionStyle { get; set; } = "gentle";
    public bool AutoSpeak { get; set; } = true;
    public bool EnableIdleQuiz { get; set; } = true;
    public bool EnableHourlyPraise { get; set; } = true;
    public bool EnableAbsenceReminder { get; set; } = true;
    // light | dark | system
    public string UiTheme { get; set; } = "light";
    // pink | blue | purple | green (legacy yellow/gray/red still supported in CSS)
    public string UiBorderColor { get; set; } = "blue";
    public HotkeyConfig Hotkeys { get; set; } = new();
    public ApiConfig Api { get; set; } = new();
    public VoiceConfig Voice { get; set; } = new();
    public CloudSyncConfig CloudSync { get; set; } = new();
}

public class HotkeyConfig
{
    public string Talk { get; set; } = "Alt+T";
    public string Quiz { get; set; } = "Alt+Q";
    public string TogglePet { get; set; } = "Alt+H";
}

public class ApiConfig
{
    public string ProviderPreset { get; set; } = "openai";
    public string BaseUrl { get; set; } = "https://api.openai.com/v1";
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "gpt-4o-mini";
    public string WhisperModel { get; set; } = "whisper-1";
    public string TtsModel { get; set; } = "tts-1";
    public double Temperature { get; set; } = 0.7;
}

public class VoiceConfig
{
    // edge | openai | webspeech
    public string TtsProvider { get; set; } = "edge";
    // Edge neural voice name or OpenAI voice or WebSpeech voice name
    public string EdgeVoice { get; set; } = "en-US-AnaNeural";
    public string OpenAiVoice { get; set; } = "nova";
    public string WebSpeechVoice { get; set; } = "";
    public double SpeechRate { get; set; } = 1.0;
    public double SpeechPitch { get; set; } = 1.0;
    // auto | whisper | webspeech
    public string SttProvider { get; set; } = "auto";
}

public class CloudSyncConfig
{
    // none | webdav | gist | custom
    public string Provider { get; set; } = "none";
    public string Endpoint { get; set; } = "";
    public string Username { get; set; } = "";
    public string TokenOrPassword { get; set; } = "";
    public string RemoteFileName { get; set; } = "haru-english-pet-sync.json";
    public string GistId { get; set; } = "";
    public bool AutoSync { get; set; } = false;
    public string LastSyncAt { get; set; } = "";
}

public class WeakWord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..10];
    public string BookId { get; set; } = "";
    public string Word { get; set; } = "";
    public string Phonetic { get; set; } = "";
    public string Pos { get; set; } = "";
    public string Meaning { get; set; } = "";
    public string Category { get; set; } = "";
    public string UiLocation { get; set; } = "";
    public string Shortcut { get; set; } = "";
    public string Example { get; set; } = "";
    public string ExampleZh { get; set; } = "";
    public string Level { get; set; } = "TOEFL";
    public int WrongCount { get; set; } = 1;
    public int CorrectCount { get; set; } = 0;
    public bool Mastered { get; set; } = false;
    public string Source { get; set; } = "manual"; // quiz | chat | translate | action | manual | vocab
    public string AddedAt { get; set; } = DateTime.UtcNow.ToString("o");
    public string LastReviewedAt { get; set; } = "";
}

public class StudyStats
{
    public long TotalStudySeconds { get; set; } = 0;
    public int LastHourMilestone { get; set; } = 0;
    public string LastStudyDate { get; set; } = ""; // yyyy-MM-dd
    public int StreakDays { get; set; } = 0;
    public int QuizzesCompleted { get; set; } = 0;
    public int TotalQuizCorrect { get; set; } = 0;
    public int TotalQuizWrong { get; set; } = 0;
    public int MessagesSent { get; set; } = 0;
    public int TranslationsDone { get; set; } = 0;
    public long TodayStudySeconds { get; set; } = 0;
    public string TodayDate { get; set; } = DateTime.Now.ToString("yyyy-MM-dd");
}

public class KnowledgeEntry
{
    public string Id { get; set; } = "";
    public string BookId { get; set; } = ""; // toefl | blender | antigravity | custom
    public string Word { get; set; } = "";
    public string Phonetic { get; set; } = "";
    public string Pos { get; set; } = "";
    public string PartOfSpeech { get; set; } = "";
    public string Meaning { get; set; } = "";
    public string Category { get; set; } = "";
    public string UiLocation { get; set; } = "";
    public string Shortcut { get; set; } = "";
    public string Example { get; set; } = "";
    public string ExampleZh { get; set; } = "";
    public string Level { get; set; } = "TOEFL";
    public List<string> Tags { get; set; } = new();
}

public class KnowledgePack
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..10];
    public string BookId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Level { get; set; } = "TOEFL";
    public string Category { get; set; } = "vocabulary"; // toefl | blender | antigravity | vocabulary | custom
    public bool BuiltIn { get; set; } = false;
    public bool Enabled { get; set; } = true;
    public string UpdatedAt { get; set; } = DateTime.UtcNow.ToString("o");
    public List<KnowledgeEntry> Entries { get; set; } = new();
}

public class SyncPayload
{
    public int SchemaVersion { get; set; } = 1;
    public string UpdatedAt { get; set; } = DateTime.UtcNow.ToString("o");
    public string EnglishLevel { get; set; } = "B1";
    public StudyStats Stats { get; set; } = new();
    public List<WeakWord> WeakWords { get; set; } = new();
    public List<KnowledgePack> CustomPacks { get; set; } = new();
}

public class ChatTurn
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
}

public class WordProgress
{
    public string Key { get; set; } = ""; // lowercase word
    public string BookId { get; set; } = "";
    public string Word { get; set; } = "";
    // unseen | learning | reviewing | mastered
    public string Status { get; set; } = "unseen";
    public int SeenCount { get; set; } = 0;
    public int Streak { get; set; } = 0;
    // Unix epoch milliseconds; 0 means not scheduled / mastered
    public long NextReviewAt { get; set; } = 0;
    public int WrongCount { get; set; } = 0;
    public int CorrectCount { get; set; } = 0;
    public string UnlockedDate { get; set; } = "";
    public string LastReviewedAt { get; set; } = "";
}

public class VocabProgressStore
{
    public string DailyDate { get; set; } = "";
    public List<string> DailyQueue { get; set; } = new(); // ordered lowercase word keys for today
    public string DailyGoalCelebratedDate { get; set; } = "";
    public Dictionary<string, WordProgress> Items { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
