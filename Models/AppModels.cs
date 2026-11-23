using System.Text.Json.Serialization;

namespace HaruEnglishPet.Models;

public class AppSettings
{
    public double PetScale { get; set; } = 1.0;
    // quiet | normal | lively | super
    public string ActivityLevel { get; set; } = "normal";
    // A1 | A2 | B1 | B2 | C1 | C2
    public string EnglishLevel { get; set; } = "B1";
    public string ModelUrl { get; set; } = "models/haru/haru_greeter_t03.model3.json";
    public bool AlwaysOnTop { get; set; } = true;
    public bool LockPosition { get; set; } = false;
    public double PetX { get; set; } = -1; // -1 means auto bottom-right
    public double PetY { get; set; } = -1;
    public bool ShowChineseSubtitles { get; set; } = true;
    public bool AutoSpeak { get; set; } = true;
    public bool EnableIdleQuiz { get; set; } = true;
    public bool EnableHourlyPraise { get; set; } = true;
    public bool EnableAbsenceReminder { get; set; } = true;
    public ApiConfig Api { get; set; } = new();
    public VoiceConfig Voice { get; set; } = new();
    public CloudSyncConfig CloudSync { get; set; } = new();
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
    public string Word { get; set; } = "";
    public string Phonetic { get; set; } = "";
    public string Meaning { get; set; } = "";
    public string Example { get; set; } = "";
    public string Level { get; set; } = "B1";
    public int WrongCount { get; set; } = 1;
    public int CorrectCount { get; set; } = 0;
    public bool Mastered { get; set; } = false;
    public string Source { get; set; } = "manual"; // quiz | chat | translate | action | manual
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
    public string Word { get; set; } = "";
    public string Phonetic { get; set; } = "";
    public string PartOfSpeech { get; set; } = "";
    public string Meaning { get; set; } = "";
    public string Example { get; set; } = "";
    public string Level { get; set; } = "B1";
    public List<string> Tags { get; set; } = new();
}

public class KnowledgePack
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..10];
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Level { get; set; } = "B1";
    public string Category { get; set; } = "vocabulary"; // vocabulary | phrases | grammar | custom
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
