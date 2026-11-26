// Main Application Controller for Haru English Pet
(() => {
  const API_PRESETS = {
    openai: { url: "https://api.openai.com/v1", model: "gpt-4o-mini", whisper: "whisper-1" },
    deepseek: { url: "https://api.deepseek.com/v1", model: "deepseek-chat", whisper: "whisper-1" },
    siliconflow: { url: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", whisper: "FunAudioLLM/SenseVoiceSmall" },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", whisper: "whisper-1" },
    ollama: { url: "http://localhost:11434/v1", model: "llama3.2", whisper: "whisper-1" },
    custom: null
  };

  // Activity level -> idle quiz threshold (seconds) & random idle motion interval (seconds)
  const ACTIVITY_CONFIG = {
    off:    { idleQuizSec: Infinity, idleMotionSec: 60 },
    quiet:  { idleQuizSec: 30 * 60,  idleMotionSec: 45 },
    normal: { idleQuizSec: 12 * 60,  idleMotionSec: 24 },
    lively: { idleQuizSec:  5 * 60,  idleMotionSec: 14 },
    super:  { idleQuizSec:  2 * 60,  idleMotionSec:  8 }
  };

  const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

  const PREVIEW_SAMPLE_TEXT = "Hello! I am Haru, your English learning desktop pet. Let's practice together!";
  const IS_SETTINGS_VIEW = !!(window.HostBridge && HostBridge.isSettingsView);

  let state = {
    settings: null,
    weakWords: [],
    stats: null,
    knowledgePacks: [],
    dataDir: "",
    fullscreenDndActive: false,
    settingsWindowOpen: false,
    lastApiStatus: { state: "idle", text: "离线词库模式" },
    workArea: { left: 0, top: 0, width: window.innerWidth || 1920, height: window.innerHeight || 1032 },
    winBounds: { x: 0, y: 0, w: window.innerWidth || 1920, h: window.innerHeight || 1032 },
    hostWinBounds: { x: 0, y: 0, w: window.innerWidth || 1920, h: window.innerHeight || 1032 },
    ctxDeskPos: null,
    chatMode: "chat", // chat | talk | translate
    chatHistory: [],
    activePanel: null, // chat | actions | quiz | null
    activeModal: null, // legacy unused on Pet window; Settings runs in dedicated SettingsWindow
    lastInteractionTime: Date.now(),
    lastActiveStudyPing: Date.now(),
    lastSpokenText: "",
    bubbleTimer: null,
    quiz: null,
    currentActionWord: null,
    petPos: { x: 0, y: 0 },
  };

  // ==================== BOOTSTRAP ====================
  async function bootSettingsView() {
    document.body.dataset.view = "settings";
    const init = await HostBridge.rpc("getInitialState");
    state.settings = { ...defaultSettings(), ...(init.settings || {}) };
    state.weakWords = init.weakWords || [];
    state.stats = { ...defaultStats(), ...(init.stats || {}) };
    state.knowledgePacks = init.knowledgePacks || [];
    state.dataDir = init.dataDir || "";
    state.activeModal = "settings";

    applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (state.settings?.uiTheme === "system") {
          applyAppearance("system", state.settings.uiBorderColor);
        }
      });
    }

    setupWordsModal();
    setupSettingsModal();
    document.querySelectorAll('[data-close="settings"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        VoiceEngine.stopSpeaking();
        HostBridge.closeSettingsWindow();
      });
    });

    populateWebSpeechVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = populateWebSpeechVoices;
    }

    document.getElementById("settings-modal")?.classList.remove("hidden");
    populateSettingsForm();
    renderWeakWordsList();
    renderKnowledgePacksList();
    renderStatsDashboard();

    HostBridge.onOpenSettingsTab((msg) => {
      if (msg?.settings) state.settings = { ...defaultSettings(), ...msg.settings };
      if (msg?.weakWords) state.weakWords = msg.weakWords;
      if (msg?.stats) state.stats = { ...defaultStats(), ...msg.stats };
      if (msg?.knowledgePacks) state.knowledgePacks = msg.knowledgePacks;
      if (msg?.dataDir) state.dataDir = msg.dataDir;
      if (typeof msg?.maximized === "boolean") {
        applySettingsMaximized(msg.maximized, true);
      }
      populateSettingsForm();
      renderWeakWordsList();
      renderKnowledgePacksList();
      renderStatsDashboard();
      switchSettingsTab(msg?.tab || "overview", msg?.subTab || null);
    });

    HostBridge.onSyncFromPet((msg) => {
      if (msg?.settings) state.settings = { ...defaultSettings(), ...msg.settings };
      if (msg?.weakWords) state.weakWords = msg.weakWords;
      if (msg?.stats) state.stats = { ...defaultStats(), ...msg.stats };
      if (msg?.knowledgePacks) state.knowledgePacks = msg.knowledgePacks;
      applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);
      updateSidebarStatus();
      renderWeakWordsList();
      renderKnowledgePacksList();
      renderStatsDashboard();
      const scaleEl = document.getElementById("set-scale");
      if (scaleEl && document.activeElement !== scaleEl) {
        scaleEl.value = state.settings.petScale;
        updateRangeProgress(scaleEl);
        const lblScale = document.getElementById("lbl-scale");
        if (lblScale) lblScale.textContent = `${Math.round(state.settings.petScale * 100)}%`;
      }
    });

    HostBridge.onSettingsMaximizedState((maximized) => {
      applySettingsMaximized(maximized, true);
    });

    HostBridge.settingsReady();
  }

  async function boot() {
    if (IS_SETTINGS_VIEW) {
      await bootSettingsView();
      return;
    }

    const init = await HostBridge.rpc("getInitialState");
    state.settings = { ...defaultSettings(), ...(init.settings || {}) };
    state.weakWords = init.weakWords || [];
    state.stats = { ...defaultStats(), ...(init.stats || {}) };
    state.knowledgePacks = init.knowledgePacks || [];
    state.dataDir = init.dataDir || "";
    if (init.workArea && init.workArea.width > 0 && init.workArea.height > 0) {
      state.workArea = init.workArea;
    }
    if (init.winBounds && init.winBounds.w > 0 && init.winBounds.h > 0) {
      state.winBounds = { ...init.winBounds };
      state.hostWinBounds = { ...init.winBounds };
    }

    // Apply saved theme (white/black) and border color
    applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);

    // Position pet (default bottom-right corner)
    initPetPosition();

    // Initialize Live2D Haru (measures full-body proportions)
    await HaruPet.init(state.settings.modelUrl, state.settings.petScale);
    // Re-sync position & tight window bounds with exact measured full-body canvas size
    setPetPosition(state.petPos.x, state.petPos.y, false);
    HaruPet.onBodyTap((_zone, reaction) => {
      markUserInteraction();
      showBubble(reaction.en, reaction.zh, { badge: "Haru", speak: state.settings.autoSpeak });
    });

    // Global desktop eye-tracking
    HostBridge.onGlobalCursor((x, y) => HaruPet.lookAtGlobal(x, y));

    // Tray commands from C# NotifyIcon
    HostBridge.onTrayCommand(handleTrayCommand);

    // Track standalone SettingsWindow open/closed state for Set dock button highlight
    HostBridge.onSettingsWindowState((isOpen) => {
      state.settingsWindowOpen = !!isOpen;
      syncDockActiveButtons();
    });

    // Live scale preview streamed from SettingsWindow slider
    let remoteScaleCenterX = null;
    let remoteScaleBottom = null;
    HostBridge.onLivePetScale((msg) => {
      const nextScale = Number(msg?.scale);
      if (!Number.isFinite(nextScale) || nextScale < 0.4 || nextScale > 1.8) return;
      const done = !!msg?.done;
      const anchor = document.getElementById("pet-anchor");
      if (remoteScaleCenterX == null || remoteScaleBottom == null) {
        const { width: curW, height: curH } = getPetDimensions(state.settings.petScale);
        remoteScaleCenterX = state.petPos.x + curW / 2;
        remoteScaleBottom = state.petPos.y + curH;
      }
      anchor?.classList.toggle("scaling-live", !done);
      state.settings.petScale = nextScale;
      HaruPet.setScale(nextScale);
      const { width: nextW, height: nextH } = getPetDimensions(nextScale);
      if (done) {
        const finalX = remoteScaleCenterX - nextW / 2;
        const finalY = remoteScaleBottom - nextH;
        remoteScaleCenterX = null;
        remoteScaleBottom = null;
        setPetPosition(finalX, finalY, true, nextScale, false);
      } else {
        setPetPosition(remoteScaleCenterX - nextW / 2, remoteScaleBottom - nextH, false, nextScale, true);
      }
    });

    // Expression preview forwarded from SettingsWindow (e.g. voice test)
    HostBridge.onPetAction((action) => {
      if (action) HaruPet.performAction(action);
    });

    // Live sync whenever user edits settings / words / packs inside standalone SettingsWindow
    HostBridge.onSyncFromSettings(async (msg) => {
      const prevSettings = state.settings || defaultSettings();
      if (msg?.weakWords) state.weakWords = msg.weakWords;
      if (msg?.stats) state.stats = { ...defaultStats(), ...msg.stats };
      if (msg?.knowledgePacks) state.knowledgePacks = msg.knowledgePacks;
      if (msg?.settings) {
        const next = { ...defaultSettings(), ...msg.settings };
        const scaleChanged = Math.abs((prevSettings.petScale || 1) - (next.petScale || 1)) > 0.005;
        const modelChanged = (prevSettings.modelUrl || "") !== (next.modelUrl || "");
        const voiceChanged = JSON.stringify(prevSettings.voice || {}) !== JSON.stringify(next.voice || {});
        const posReset = next.petX < 0 && next.petY < 0;
        state.settings = next;
        applyAppearance(next.uiTheme, next.uiBorderColor);
        updateChatHeaderBadges();
        syncQuizBookButtons(next.quizPackId);
        if (posReset) {
          initPetPosition();
        } else if (scaleChanged) {
          HaruPet.setScale(next.petScale);
          setPetPosition(state.petPos.x, state.petPos.y, false, next.petScale, false);
        }
        if (modelChanged && next.modelUrl) {
          await HaruPet.loadModel(next.modelUrl);
          setPetPosition(state.petPos.x, state.petPos.y, false, next.petScale, false);
        }
        if (voiceChanged) {
          prewarmBodyReactions(next.voice);
        }
      }
    });

    // Zero-blink & zero-ghost window transition handshake:
    // Once WPF moves/resizes MainWindow behind the freeze overlay, apply final layout, paint 2 frames, then reveal!
    HostBridge.onWindowBoundsApplied((msg) => {
      const token = Number(msg?.token || 0);
      clearTimeout(stageSafetyTimer);
      applyLocalLayout();
      HostBridge.reportHitRects();
      requestAnimationFrame(() => {
        applyLocalLayout();
        requestAnimationFrame(() => {
          HostBridge.reportHitRects();
          HostBridge.revealWindow(token);
        });
      });
    });

    // Silky spring glide-in when restoring Haru after hiding to tray
    let wakeAnimTimer = null;
    HostBridge.onPetRestored(() => {
      const anchor = document.getElementById("pet-anchor");
      if (!anchor) return;
      anchor.classList.remove("pet-waking");
      void anchor.offsetWidth;
      anchor.classList.add("pet-waking");
      clearTimeout(wakeAnimTimer);
      wakeAnimTimer = setTimeout(() => {
        anchor.classList.remove("pet-waking");
        HostBridge.reportHitRects();
      }, 380);
      HostBridge.reportHitRects();
    });

    // Fullscreen focus/DND watcher from C# host
    HostBridge.onFullscreenDnd((active) => {
      state.fullscreenDndActive = !!active;
    });

    // Follow OS light/dark theme dynamically when uiTheme === "system"
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (state.settings?.uiTheme === "system") {
          applyAppearance("system", state.settings.uiBorderColor);
        }
      });
    }

    // Wire Pet UI (Settings & Words run inside standalone SettingsWindow so desktop stays 100% clickable!)
    setupDraggingAndClicks();
    setupSideDock();
    setupActionsPanel();
    setupChatPanel();
    setupQuizPanel();
    setupContextMenu();

    updateChatHeaderBadges();
    renderActionsGrid("all");
    addWelcomeChatMessage();

    // Prewarm body-tap reaction audio in background so clicking Haru speaks instantly!
    prewarmBodyReactions(state.settings.voice);

    // Check multi-day absence reminder on startup
    setTimeout(checkAbsenceReminder, 1400);

    // Start background study timer & proactive idle watcher
    startStudyAndIdleLoops();
    syncWindowBounds();
    HostBridge.reportHitRects();
  }

  function prewarmBodyReactions(voiceCfg) {
    const voice = voiceCfg || state.settings?.voice;
    if (!voice || voice.ttsProvider === "webspeech") return;
    const reactions = HaruPet.BODY_REACTIONS || {};
    const items = [];
    Object.values(reactions).forEach((list) => {
      (list || []).forEach((r) => {
        if (r && r.en) items.push({ text: r.en, voice });
      });
    });
    HostBridge.prewarmTts(items);
  }

  function prewarmVoicePreviews(priorityVoiceCfg = null) {
    const formCfg = priorityVoiceCfg || readVoiceForm();
    if (!formCfg || formCfg.ttsProvider === "webspeech") return;
    const items = [{ text: PREVIEW_SAMPLE_TEXT, voice: { ...formCfg } }];
    if (formCfg.ttsProvider === "edge") {
      const sel = document.getElementById("set-edge-voice");
      if (sel) {
        Array.from(sel.options).forEach((opt) => {
          if (opt.value && opt.value !== formCfg.edgeVoice) {
            items.push({
              text: PREVIEW_SAMPLE_TEXT,
              voice: { ...formCfg, edgeVoice: opt.value },
            });
          }
        });
      }
    }
    HostBridge.prewarmTts(items);
  }

  function prewarmActions() {
    const voice = state.settings?.voice;
    if (!voice || voice.ttsProvider === "webspeech") return;
    const items = (HaruPet.ACTIONS_CATALOG || []).map((a) => ({
      text: `${a.word}! ${a.example}`,
      voice,
    }));
    HostBridge.prewarmTts(items);
  }

  function defaultSettings() {
    return {
      petScale: 1.0,
      activityLevel: "normal",
      englishLevel: "B1",
      quizPackId: "all",
      modelUrl: "models/haru/haru_greeter_t03.model3.json",
      alwaysOnTop: true,
      lockPosition: false,
      fullscreenDnd: true,
      petX: -1,
      petY: -1,
      showChineseSubtitles: true,
      chineseSubtitleMode: "always",
      correctionStyle: "gentle",
      autoSpeak: true,
      enableIdleQuiz: true,
      enableHourlyPraise: true,
      enableAbsenceReminder: true,
      uiTheme: "light",
      uiBorderColor: "blue",
      hotkeys: { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" },
      api: { providerPreset: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini", whisperModel: "whisper-1", ttsModel: "tts-1", temperature: 0.7 },
      voice: { ttsProvider: "edge", edgeVoice: "en-US-AnaNeural", openAiVoice: "nova", webSpeechVoice: "", speechRate: 1.0, speechPitch: 1.0, sttProvider: "auto" },
      cloudSync: { provider: "none", endpoint: "", username: "", tokenOrPassword: "", remoteFileName: "haru-english-pet-sync.json", gistId: "", autoSync: false, lastSyncAt: "" }
    };
  }

  function defaultStats() {
    return {
      totalStudySeconds: 0,
      lastHourMilestone: 0,
      lastStudyDate: "",
      streakDays: 0,
      quizzesCompleted: 0,
      totalQuizCorrect: 0,
      totalQuizWrong: 0,
      messagesSent: 0,
      translationsDone: 0,
      todayStudySeconds: 0,
      todayDate: todayStr()
    };
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ==================== APPEARANCE (THEME & BORDER COLOR) ====================
  function updateRangeProgress(el) {
    if (!el) return;
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const val = Number(el.value || 0);
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    el.style.setProperty("--range-pct", `${pct.toFixed(1)}%`);
  }

  function resolveEffectiveTheme(theme) {
    if (theme === "system") {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme === "dark" ? "dark" : "light";
  }

  function applyAppearance(theme, borderColor) {
    const mode = ["light", "dark", "system"].includes(theme) ? theme : "light";
    const resolved = resolveEffectiveTheme(mode);
    const validBorders = ["pink", "blue", "yellow", "gray", "purple", "green", "red"];
    const validBorder = validBorders.includes(borderColor) ? borderColor : "blue";
    document.body.dataset.theme = resolved;
    document.body.dataset.border = validBorder;

    document.querySelectorAll(".theme-seg-btn[data-ui-theme]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.uiTheme === mode);
    });
    document.querySelectorAll(".border-swatch[data-ui-border]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.uiBorder === validBorder);
    });
    document.getElementById("icon-quick-sun")?.classList.toggle("hidden", resolved === "dark");
    document.getElementById("icon-quick-moon")?.classList.toggle("hidden", resolved !== "dark");
  }

  function getChineseMode() {
    const s = state.settings;
    if (!s) return "always";
    if (["always", "hover", "hide"].includes(s.chineseSubtitleMode)) {
      if (s.chineseSubtitleMode === "always" && s.showChineseSubtitles === false) return "hide";
      return s.chineseSubtitleMode;
    }
    return s.showChineseSubtitles === false ? "hide" : "always";
  }

  function applySettingsMaximized(maximized, skipSync = false) {
    state.settingsMaximized = !!maximized;
    const modal = document.getElementById("settings-modal");
    if (modal) {
      modal.classList.toggle("modal-maximized", state.settingsMaximized);
    }
    document.getElementById("icon-settings-max")?.classList.toggle("hidden", state.settingsMaximized);
    document.getElementById("icon-settings-restore")?.classList.toggle("hidden", !state.settingsMaximized);
    if (!skipSync) syncWindowBounds();
  }

  // ==================== POSITION, TIGHT WINDOW BOUNDS & DRAGGING ====================
  function getActiveScale() {
    if (state.activeModal === "settings") {
      const slider = document.getElementById("set-scale");
      if (slider) return Number(slider.value) || state.settings?.petScale || 1.0;
    }
    return state.settings?.petScale || 1.0;
  }

  function getDockMetrics(scaleOverride = null) {
    const s = scaleOverride != null ? scaleOverride : getActiveScale();
    const numS = Number(s) || 1.0;
    // Balanced curve: sleek and proportional alongside Haru across 45%~160% without looking oversized or cramped
    const dockScale = Math.max(0.72, Math.min(1.18, 0.74 + (numS - 0.55) * 0.44));
    const protrude = Math.ceil(40 * dockScale);
    return {
      dockScale,
      dockProtrude: protrude,
      dockW: protrude + 8,
      dockH: Math.ceil(174 * dockScale) + 28,
    };
  }

  function getPanelMetrics(scaleOverride = null) {
    const s = scaleOverride != null ? scaleOverride : getActiveScale();
    const numS = Number(s) || 1.0;
    const { height: petH } = getPetDimensions(numS);
    const panelW = Math.round(Math.max(324, Math.min(400, 324 + (numS - 0.55) * 76)));
    const panelH = Math.round(Math.max(400, Math.min(520, petH * 0.98)));
    const bubbleW = Math.round(Math.max(246, Math.min(320, 250 + (numS - 0.55) * 68)));
    return { panelW, panelH, bubbleW };
  }

  function applyDockScale(scaleOverride = null) {
    const { dockScale, dockProtrude } = getDockMetrics(scaleOverride);
    const { panelW, panelH, bubbleW } = getPanelMetrics(scaleOverride);
    const root = document.documentElement;
    root.style.setProperty("--dock-scale", dockScale.toFixed(3));
    root.style.setProperty("--dock-protrude", `${dockProtrude}px`);
    root.style.setProperty("--panel-w", `${panelW}px`);
    root.style.setProperty("--panel-h", `${panelH}px`);
    root.style.setProperty("--bubble-w", `${bubbleW}px`);
    requestAnimationFrame(() => syncDockActiveButtons());
  }

  function getPetDimensions(scaleOverride = null) {
    const s = scaleOverride != null ? scaleOverride : getActiveScale();
    if (window.HaruPet && typeof HaruPet.getDimensions === "function") {
      return HaruPet.getDimensions(s);
    }
    return { width: Math.round(260 * s), height: Math.round(460 * s) };
  }

  function initPetPosition() {
    const workW = state.workArea.width;
    const workH = state.workArea.height;
    const { width: petW, height: petH } = getPetDimensions(state.settings.petScale);
    let x = state.settings.petX;
    let y = state.settings.petY;
    if (x < 0 || y < 0 || x > workW - 80 || y > workH - 80) {
      x = Math.max(16, workW - petW - 76);
      y = Math.max(20, workH - petH - 18);
    }
    setPetPosition(x, y, false);
  }

  let dockFlipHitTimer = null;
  let winBoundsRaf = null;
  let winBoundsApplyRaf = null;
  let winBoundsSeq = 0;
  let boundsTokenSeq = 0;
  let stageSafetyTimer = null;

  function waitFrames(seq, count, slotSetter, fn) {
    if (count <= 0) {
      if (seq === winBoundsSeq) fn();
      return;
    }
    const id = requestAnimationFrame(() => {
      slotSetter(null);
      if (seq !== winBoundsSeq) return;
      waitFrames(seq, count - 1, slotSetter, fn);
    });
    slotSetter(id);
  }

  function getBubbleMetrics(petX, petY, petW, petH, scaleOverride = null) {
    const bubble = document.getElementById("speech-bubble");
    const workW = state.workArea.width;
    const workH = state.workArea.height;
    const { bubbleW: targetBubbleW } = getPanelMetrics(scaleOverride);
    const bubbleW = Math.min(targetBubbleW, Math.max(220, workW - 24));
    const measuredH = bubble && !bubble.classList.contains("hidden") ? bubble.offsetHeight : 0;
    const bubbleH = Math.max(118, measuredH || 130);

    // Clamp bubble horizontally inside desktop [12 .. workW - bubbleW - 12] so text & close button are never cut off
    const petCenterX = petX + petW / 2;
    const idealLeft = petCenterX - bubbleW / 2;
    const clampedLeft = Math.max(12, Math.min(workW - bubbleW - 12, idealLeft));
    const shiftX = Math.round(clampedLeft - idealLeft);
    const maxArrow = Math.max(16, bubbleW / 2 - 26);
    const arrowOffset = Math.round(Math.max(-maxArrow, Math.min(maxArrow, -shiftX)));

    // Prefer above Haru's head; flip below if near top edge, or nudge down just enough if Haru is tall
    const gap = 10;
    let below = false;
    let bubbleTop = petY - gap - bubbleH;
    let shiftY = 0;
    if (bubbleTop < 12) {
      const belowTop = petY + petH + gap;
      if (belowTop + bubbleH <= workH - 12) {
        below = true;
        bubbleTop = belowTop;
      } else {
        shiftY = Math.round(12 - bubbleTop);
        bubbleTop = 12;
      }
    }

    return {
      left: clampedLeft,
      top: bubbleTop,
      right: clampedLeft + bubbleW,
      bottom: bubbleTop + bubbleH,
      width: bubbleW,
      height: bubbleH,
      shiftX,
      shiftY,
      arrowOffset,
      below,
    };
  }

  function positionSpeechBubble(scaleOverride = null) {
    const bubble = document.getElementById("speech-bubble");
    if (!bubble || bubble.classList.contains("hidden")) return null;
    const { width: petW, height: petH } = getPetDimensions(scaleOverride);
    const m = getBubbleMetrics(state.petPos.x, state.petPos.y, petW, petH, scaleOverride);
    bubble.style.setProperty("--bubble-shift-x", `${m.shiftX}px`);
    bubble.style.setProperty("--bubble-shift-y", `${m.shiftY}px`);
    bubble.style.setProperty("--bubble-arrow-offset", `${m.arrowOffset}px`);
    bubble.classList.toggle("bubble-below", m.below);
    return m;
  }

  function applyLocalLayout() {
    const anchor = document.getElementById("pet-anchor");
    const wb = state.winBounds;
    if (anchor) {
      anchor.style.transform = `translate3d(${Math.round(state.petPos.x - wb.x)}px, ${Math.round(state.petPos.y - wb.y)}px, 0)`;
    }
    positionSpeechBubble();
    if (state.ctxDeskPos) {
      const menu = document.getElementById("pet-context-menu");
      if (menu && !menu.classList.contains("hidden")) {
        menu.style.left = `${Math.round(state.ctxDeskPos.x - wb.x)}px`;
        menu.style.top = `${Math.round(state.ctxDeskPos.y - wb.y)}px`;
      }
    }
  }

  function syncWindowBounds(deferShrink = false) {
    if (winBoundsRaf) {
      cancelAnimationFrame(winBoundsRaf);
      winBoundsRaf = null;
    }
    if (winBoundsApplyRaf) {
      cancelAnimationFrame(winBoundsApplyRaf);
      winBoundsApplyRaf = null;
    }
    const mySeq = ++winBoundsSeq;
    if (deferShrink) {
      // Wait 2 rAFs so Blink paints AND commits the hidden bubble/panel/modal away BEFORE WPF shrinks/moves the window (0 afterimage!)
      waitFrames(mySeq, 2, (id) => { winBoundsRaf = id; }, () => {
        syncWindowBoundsNow(mySeq);
      });
      return;
    }
    syncWindowBoundsNow(mySeq);
  }

  function syncWindowBoundsNow(mySeq) {
    const workW = state.workArea.width;
    const workH = state.workArea.height;
    const activeScale = getActiveScale();
    const { width: petW, height: petH } = getPetDimensions(activeScale);
    const { dockW, dockH } = getDockMetrics(activeScale);
    const petX = state.petPos.x;
    const petY = state.petPos.y;
    const anchor = document.getElementById("pet-anchor");
    const flipLeft = anchor ? anchor.classList.contains("flip-left") : false;
    const openRight = anchor ? anchor.classList.contains("open-right") : false;

    let clampedX = 0;
    let clampedY = 0;
    let w = workW;
    let h = workH;

    if (state.activeModal) {
      // While Settings or Words modal is open, hold a full-workArea stage so dragging Haru anywhere
      // (left / center / right) or scrubbing sliders NEVER resizes the window or shakes Settings!
      // The instant the modal closes, MainWindow shrinks right back to the tight [Haru + Dock] box.
      positionSpeechBubble(activeScale);
      clampedX = 0;
      clampedY = 0;
      w = workW;
      h = workH;
    } else {
      // 1. Base union: Pet + proportionally scaled Side Dock
      let minX = flipLeft ? petX - dockW : petX;
      let maxX = flipLeft ? petX + petW : petX + petW + dockW;
      let minY = Math.min(petY, petY + petH - dockH);
      let maxY = petY + petH;

      // 2. Speech Bubble (using screen-clamped coordinates so text & X button never get cut off!)
      const bubble = document.getElementById("speech-bubble");
      if (bubble && !bubble.classList.contains("hidden")) {
        const bm = positionSpeechBubble(activeScale);
        if (bm) {
          minX = Math.min(minX, bm.left);
          maxX = Math.max(maxX, bm.right);
          minY = Math.min(minY, bm.top - 10);
          maxY = Math.max(maxY, bm.bottom + 10);
        }
      }

      // 3. Floating panel beside pet (coordinated with Haru's height & scale => zero resize jitter when switching!)
      if (state.activePanel) {
        const { panelW: basePanelW, panelH: basePanelH } = getPanelMetrics(activeScale);
        const panelW = basePanelW + 18;
        const panelH = Math.max(basePanelH, 428) + 22;
        if (openRight) {
          maxX = Math.max(maxX, petX + petW + dockW + panelW + 8);
        } else if (flipLeft) {
          minX = Math.min(minX, petX - dockW - panelW - 8);
        } else {
          minX = Math.min(minX, petX - 18 - panelW);
        }
        minY = Math.min(minY, petY + petH - panelH - 18);
      }

      // 4. Right-click context menu
      if (state.ctxDeskPos) {
        const menu = document.getElementById("pet-context-menu");
        if (menu && !menu.classList.contains("hidden")) {
          minX = Math.min(minX, state.ctxDeskPos.x - 10);
          maxX = Math.max(maxX, state.ctxDeskPos.x + 225);
          minY = Math.min(minY, state.ctxDeskPos.y - 10);
          maxY = Math.max(maxY, state.ctxDeskPos.y + 245);
        }
      }

      const pad = 14;
      const x = Math.max(0, Math.floor(minX - pad));
      const y = Math.max(0, Math.floor(minY - pad));
      const right = Math.min(workW, Math.ceil(maxX + pad));
      const bottom = Math.min(workH, Math.ceil(maxY + pad));
      w = Math.max(220, right - x);
      h = Math.max(220, bottom - y);
      clampedX = Math.max(0, Math.min(workW - w, x));
      clampedY = Math.max(0, Math.min(workH - h, y));
    }

    // Always compare against state.hostWinBounds (the actual last bounds SENT to WPF), NOT state.winBounds,
    // so if an earlier rAF was cancelled by a follow-up syncWindowBounds() in the same frame, the host resize is NEVER dropped!
    const sent = state.hostWinBounds;
    const originMoved = Math.abs(sent.x - clampedX) >= 2 || Math.abs(sent.y - clampedY) >= 2;
    const sizeChanged = Math.abs(sent.w - w) >= 2 || Math.abs(sent.h - h) >= 2;
    const originShiftedUpLeft = clampedX < sent.x - 4 || clampedY < sent.y - 4;
    const changed =
      Math.abs(sent.x - clampedX) >= 1 ||
      Math.abs(sent.y - clampedY) >= 1 ||
      Math.abs(sent.w - w) >= 1 ||
      Math.abs(sent.h - h) >= 1;

    state.winBounds = { x: clampedX, y: clampedY, w, h };

    if (changed) {
      const needMask = originMoved && (sizeChanged || originShiftedUpLeft);
      if (needMask) {
        // Compute tight desktop rect of [Haru + Side Dock] so C# captures it into the freeze overlay
        // BEFORE hiding MainWindow => Haru & Side Dock stay 100% motionless with ZERO blink & ZERO top-left ghost!
        const fPad = 10;
        const fx = Math.max(0, Math.floor((flipLeft ? petX - dockW : petX) - fPad));
        const fy = Math.max(0, Math.floor(Math.min(petY, petY + petH - dockH) - fPad));
        const fRight = Math.min(workW, Math.ceil((flipLeft ? petX + petW : petX + petW + dockW) + fPad));
        const fBottom = Math.min(workH, Math.ceil(petY + petH + fPad));
        const freezeRect = {
          x: fx,
          y: fy,
          w: Math.max(60, fRight - fx),
          h: Math.max(60, fBottom - fy),
        };
        const token = ++boundsTokenSeq;
        clearTimeout(stageSafetyTimer);
        stageSafetyTimer = setTimeout(() => {
          applyLocalLayout();
          HostBridge.revealWindow(token);
        }, 260);
        state.hostWinBounds = { x: clampedX, y: clampedY, w, h };
        HostBridge.setWindowBounds(clampedX, clampedY, w, h, token, freezeRect);
      } else {
        clearTimeout(stageSafetyTimer);
        applyLocalLayout();
        state.hostWinBounds = { x: clampedX, y: clampedY, w, h };
        HostBridge.setWindowBounds(clampedX, clampedY, w, h, 0);
        HostBridge.reportHitRects();
      }
    } else {
      clearTimeout(stageSafetyTimer);
      applyLocalLayout();
      HostBridge.reportHitRects();
    }
  }

  function setPetPosition(x, y, persist = false, scaleOverride = null, liveScaling = false, deferShrink = false) {
    const workW = state.workArea.width;
    const workH = state.workArea.height;
    const activeScale = scaleOverride != null ? scaleOverride : getActiveScale();
    applyDockScale(activeScale);
    const { width: petW, height: petH } = getPetDimensions(activeScale);
    const { dockW, dockH } = getDockMetrics(activeScale);
    // Give Haru's body full left/right screen edge priority!
    let clampedX = Math.max(8, Math.min(workW - petW - 8, x));
    let clampedY = Math.max(10, Math.min(workH - petH - 12, y));

    const anchor = document.getElementById("pet-anchor");

    // Smart edge-triggered dock flip:
    // Drag near right edge -> dock smoothly springs to LEFT; drag near left edge -> dock smoothly springs to RIGHT!
    const spaceRight = workW - (clampedX + petW);
    const spaceLeft = clampedX;
    const edgeThreshold = dockW + 28;

    const prevDockLeft = anchor.classList.contains("flip-left");
    let nextDockLeft = prevDockLeft;
    if (!liveScaling) {
      if (!prevDockLeft) {
        if (spaceRight < edgeThreshold && spaceLeft >= dockW + 12) nextDockLeft = true;
      } else {
        if (spaceLeft < edgeThreshold && spaceRight >= dockW + 12) nextDockLeft = false;
      }
    } else {
      // During rapid slider scrubbing, only flip if genuinely overflowing screen edge (no wobble!)
      if (!prevDockLeft && spaceRight < dockW + 6 && spaceLeft >= dockW + 6) nextDockLeft = true;
      else if (prevDockLeft && spaceLeft < dockW + 6 && spaceRight >= dockW + 6) nextDockLeft = false;
    }

    // Only push Haru inward if BOTH sides somehow couldn't fit the dock (ultra-narrow display fallback)
    if (nextDockLeft && clampedX < dockW + 6) {
      clampedX = Math.min(workW - petW - 8, dockW + 6);
    } else if (!nextDockLeft && workW - (clampedX + petW) < dockW + 6) {
      clampedX = Math.max(8, workW - petW - dockW - 6);
    }
    const minPetYForDock = Math.max(10, dockH - petH + 6);
    if (clampedY < minPetYForDock) {
      clampedY = Math.min(workH - petH - 12, minPetYForDock);
    }

    state.petPos = { x: clampedX, y: clampedY };
    anchor.classList.toggle("flip-left", nextDockLeft);

    const { panelW } = getPanelMetrics(activeScale);
    const panelFlipThreshold = panelW + dockW + 20;
    const effSpaceRight = workW - (clampedX + petW);
    const effSpaceLeft = clampedX;
    const prevOpenRight = anchor.classList.contains("open-right");
    let nextOpenRight = prevOpenRight;
    if (!prevOpenRight) {
      if (effSpaceLeft < panelFlipThreshold && effSpaceRight > effSpaceLeft + 60) nextOpenRight = true;
    } else {
      if (effSpaceRight < panelFlipThreshold && effSpaceLeft > effSpaceRight + 60) nextOpenRight = false;
    }
    anchor.classList.toggle("open-right", nextOpenRight);

    if (liveScaling) {
      // Keep window steady during rapid slider scrubbing; only expand if pet/dock would exceed current window
      const wb = state.winBounds;
      const needLeft = nextDockLeft ? clampedX - dockW - 14 : clampedX - 14;
      const needRight = nextDockLeft ? clampedX + petW + 14 : clampedX + petW + dockW + 14;
      const needTop = clampedY - 14;
      const needBottom = clampedY + petH + 14;
      if (needLeft < wb.x || needRight > wb.x + wb.w || needTop < wb.y || needBottom > wb.y + wb.h) {
        syncWindowBounds();
      } else {
        applyLocalLayout();
        HostBridge.reportHitRects();
      }
    } else {
      syncWindowBounds(deferShrink);
    }

    // Re-report hit rects once the smooth side-dock spring glide completes
    if (nextDockLeft !== prevDockLeft) {
      clearTimeout(dockFlipHitTimer);
      dockFlipHitTimer = setTimeout(() => HostBridge.reportHitRects(), 400);
    }

    if (persist) {
      state.settings.petX = Math.round(clampedX);
      state.settings.petY = Math.round(clampedY);
      HostBridge.rpc("saveSettings", state.settings);
    }
  }

  function setupDraggingAndClicks() {
    const wrap = document.getElementById("pet-canvas-wrap");
    let pointerDown = false;
    let dragDidMove = false;
    let keepWindowFixed = false;
    let origX = 0, origY = 0;

    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.buttons & 1) !== 1) return;
      hideContextMenu();
      pointerDown = true;
      dragDidMove = false;
      keepWindowFixed = !!state.activeModal;
      origX = state.petPos.x;
      origY = state.petPos.y;
      if (!state.settings.lockPosition) {
        const activeScale = getActiveScale();
        const { width: petW } = getPetDimensions(activeScale);
        const { dockW } = getDockMetrics(activeScale);
        const anchor = document.getElementById("pet-anchor");
        const flipLeft = anchor ? anchor.classList.contains("flip-left") : false;
        HostBridge.setDragging(true, keepWindowFixed, {
          petOffsetX: state.petPos.x - state.winBounds.x,
          petW,
          dockW,
          flipLeft,
          canFlip: !state.activePanel,
        });
      }
    });

    HostBridge.onDragStarted(() => {
      dragDidMove = true;
      wrap.classList.add("dragging");
    });

    HostBridge.onDragEdgeFlip((msg) => {
      if (!pointerDown || keepWindowFixed || !msg) return;
      const anchor = document.getElementById("pet-anchor");
      if (anchor) anchor.classList.toggle("flip-left", !!msg.flipLeft);
      const shiftX = Number(msg.shiftX || 0);
      if (shiftX) {
        state.winBounds.x -= shiftX;
        state.hostWinBounds.x -= shiftX;
        applyLocalLayout();
      }
    });

    HostBridge.onDragMove((msg) => {
      if (!pointerDown || !keepWindowFixed || !msg) return;
      dragDidMove = true;
      wrap.classList.add("dragging");
      const activeScale = getActiveScale();
      const { width: petW, height: petH } = getPetDimensions(activeScale);
      const { dockW } = getDockMetrics(activeScale);
      const workW = state.workArea.width;
      const workH = state.workArea.height;
      const anchor = document.getElementById("pet-anchor");
      // MainWindow covers full workArea while modal is open => Haru glides freely across left/center/right with ZERO Settings wobble!
      const nextX = Math.max(8, Math.min(workW - petW - 8, origX + Number(msg.dx || 0)));
      const nextY = Math.max(10, Math.min(workH - petH - 12, origY + Number(msg.dy || 0)));
      if (anchor) {
        const flipLeft = anchor.classList.contains("flip-left");
        const spaceRight = workW - (nextX + petW);
        const spaceLeft = nextX;
        if (!flipLeft && spaceRight < dockW + 24 && spaceLeft >= dockW + 16) {
          anchor.classList.add("flip-left");
        } else if (flipLeft && spaceLeft < dockW + 24 && spaceRight >= dockW + 16) {
          anchor.classList.remove("flip-left");
        }
      }
      state.petPos = { x: nextX, y: nextY };
      applyLocalLayout();
    });

    HostBridge.onDragFinished((msg) => {
      wrap.classList.remove("dragging");
      const wasDown = pointerDown;
      pointerDown = false;
      if (!msg) return;
      if (msg.moved) {
        dragDidMove = true;
        if (msg.keepWindowFixed) {
          setPetPosition(state.petPos.x, state.petPos.y, true);
        } else {
          state.winBounds.x = Number(msg.winX ?? state.winBounds.x);
          state.winBounds.y = Number(msg.winY ?? state.winBounds.y);
          state.hostWinBounds.x = state.winBounds.x;
          state.hostWinBounds.y = state.winBounds.y;
          setPetPosition(origX + Number(msg.dx || 0), origY + Number(msg.dy || 0), true);
        }
      } else if (wasDown && !dragDidMove) {
        // Pure stationary click ONLY (never fires after dragging!)
        HaruPet.handleCanvasClick(Number(msg.clickX || 0), Number(msg.clickY || 0));
      }
    });

    wrap.addEventListener("pointerup", (e) => {
      if (!pointerDown) return;
      wrap.classList.remove("dragging");
      if (state.settings.lockPosition) {
        pointerDown = false;
        HaruPet.handleCanvasClick(e.clientX, e.clientY);
      } else {
        // Delegate click-vs-drag decision to HostBridge.onDragFinished so dragging NEVER fires a false tap!
        HostBridge.setDragging(false);
      }
    });

    wrap.addEventListener("pointercancel", () => {
      pointerDown = false;
      wrap.classList.remove("dragging");
      HostBridge.setDragging(false);
    });

    HostBridge.onForceEndDrag(() => {
      pointerDown = false;
      wrap.classList.remove("dragging");
    });

    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      pointerDown = false;
      HostBridge.setDragging(false);
      showContextMenu(e.clientX, e.clientY);
    });
  }

  // ==================== SPEECH BUBBLE ====================
  function showBubble(en, zh = "", opts = {}) {
    if (IS_SETTINGS_VIEW) {
      flashAutoSaved(zh || en || "已完成");
      return;
    }
    const bubble = document.getElementById("speech-bubble");
    const badge = document.getElementById("bubble-badge");
    const enEl = document.getElementById("bubble-en");
    const zhEl = document.getElementById("bubble-zh");
    const extraEl = document.getElementById("bubble-extra");

    badge.textContent = opts.badge || "Haru";
    enEl.textContent = en || "";
    const zhMode = getChineseMode();
    zhEl.classList.remove("zh-hover-mask", "revealed");
    zhEl.onclick = null;
    if (zh && zhMode !== "hide") {
      zhEl.textContent = zh;
      zhEl.classList.remove("hidden");
      if (zhMode === "hover") {
        zhEl.classList.add("zh-hover-mask");
        zhEl.title = "悬停或点击查看中文释义";
        zhEl.onclick = () => zhEl.classList.toggle("revealed");
      } else {
        zhEl.title = "";
      }
    } else {
      zhEl.textContent = "";
      zhEl.classList.add("hidden");
    }

    extraEl.innerHTML = "";
    if (opts.actions && opts.actions.length) {
      opts.actions.forEach((act) => {
        const btn = document.createElement("button");
        btn.className = act.primary ? "primary-btn" : "mini-tag-btn";
        btn.textContent = act.label;
        btn.onclick = () => {
          act.onClick?.();
          if (act.closeBubble !== false) hideBubble();
        };
        extraEl.appendChild(btn);
      });
      extraEl.classList.remove("hidden");
    } else {
      extraEl.classList.add("hidden");
    }

    state.lastSpokenText = en || "";
    bubble.classList.remove("hidden");
    positionSpeechBubble();
    syncWindowBounds();
    requestAnimationFrame(() => {
      positionSpeechBubble();
      syncWindowBounds();
    });

    if (opts.speak && en) {
      VoiceEngine.speak(en, state.settings.voice);
    }

    clearTimeout(state.bubbleTimer);
    if (!opts.sticky) {
      state.bubbleTimer = setTimeout(hideBubble, opts.duration || 8500);
    }
  }

  function hideBubble(stopAudio = false) {
    document.getElementById("speech-bubble").classList.add("hidden");
    if (stopAudio) {
      VoiceEngine.stopSpeaking();
    }
    syncWindowBounds(true);
  }

  document.getElementById("bubble-close-btn").onclick = () => hideBubble(true);
  document.getElementById("bubble-speak-btn").onclick = () => {
    if (state.lastSpokenText) VoiceEngine.speak(state.lastSpokenText, state.settings.voice);
  };

  // ==================== SIDE DOCK & PANELS ====================
  const SPEAKER_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;

  function syncDockActiveButtons() {
    const dockBtns = Array.from(document.querySelectorAll("#side-dock .dock-btn"));
    let activeBtn = null;
    dockBtns.forEach((b) => {
      const p = b.dataset.panel;
      let active = false;
      if (b.id === "dock-quiz-btn") {
        active = state.activePanel === "quiz";
      } else if (p === "settings") {
        active = !state.activePanel && !!state.settingsWindowOpen;
      } else if (p) {
        active = p === state.activePanel;
      }
      b.classList.toggle("active", active);
      if (active) activeBtn = b;
    });

    // Slide the glowing indicator pill smoothly to the active button
    const indicator = document.getElementById("dock-indicator");
    if (indicator) {
      if (activeBtn) {
        const y = activeBtn.offsetTop;
        indicator.style.transform = `translate3d(0, ${y}px, 0) scale(1)`;
        indicator.classList.add("visible");
      } else {
        indicator.classList.remove("visible");
      }
    }
  }

  function setChatMode(mode) {
    state.chatMode = mode;
    document.querySelectorAll("[data-chat-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.chatMode === state.chatMode);
    });
    document.getElementById("talk-stage")?.classList.toggle("hidden", state.chatMode !== "talk");
    const input = document.getElementById("chat-input");
    if (input) {
      input.placeholder =
        state.chatMode === "translate"
          ? "粘贴或输入英文，自动翻译并提取生词..."
          : state.chatMode === "talk"
          ? "当前为语音模式，也可直接打字发送..."
          : `用英语和 Haru 聊天 (${state.settings.englishLevel})...`;
    }
    syncDockActiveButtons();
  }

  function setupSideDock() {
    document.querySelectorAll(".dock-btn[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        markUserInteraction();
        const target = btn.dataset.panel;
        if (target === "settings") {
          if (state.activePanel) closeFloatingPanels();
          HostBridge.openSettings("overview", null);
        } else if (target === "chat") {
          // Repeatedly clicking Chat while already open causes ZERO change (Talk lives inside Chat!)
          if (state.activePanel === "chat") return;
          toggleFloatingPanel("chat", true);
          if (state.chatMode !== "talk") {
            setTimeout(() => document.getElementById("chat-input")?.focus(), 40);
          }
        } else {
          if (state.activePanel === target) return;
          toggleFloatingPanel(target, true);
        }
      });
    });

    document.getElementById("dock-quiz-btn")?.addEventListener("click", () => {
      markUserInteraction();
      if (state.activePanel === "quiz") return;
      startWordQuiz(false);
    });

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.close;
        if (t === "settings") HostBridge.closeSettingsWindow();
        else closeFloatingPanels();
      });
    });
  }

  function toggleFloatingPanel(name, forceOpen = false) {
    if (!state.activeModal && state.activePanel === name) {
      // Idempotent: clicking the currently active option never closes or resets it
      return;
    }
    if (state.activeModal) {
      closeModals(true);
    }
    closeFloatingPanels(true);
    state.activePanel = name;
    document.getElementById(`${name}-panel`)?.classList.remove("hidden");
    syncDockActiveButtons();
    document.getElementById("side-dock").classList.add("active-dock");
    if (name === "chat" && state.chatMode !== "talk") {
      setTimeout(() => document.getElementById("chat-input").focus(), 50);
    } else if (name === "actions") {
      prewarmActions();
    }
    syncWindowBounds();
  }

  function closeFloatingPanels(skipSync = false) {
    if (VoiceEngine.isListening()) {
      VoiceEngine.stopListening();
    }
    ["chat", "actions", "quiz"].forEach((id) => {
      document.getElementById(`${id}-panel`)?.classList.add("hidden");
    });
    state.activePanel = null;
    if (!skipSync) {
      syncDockActiveButtons();
      document.getElementById("side-dock").classList.remove("active-dock");
      syncWindowBounds(true);
    }
  }

  function toggleModal(name, defaultTab = null) {
    if (name === "words") {
      HostBridge.openSettings("words", defaultTab || "weak");
    } else {
      HostBridge.openSettings(defaultTab || "overview", null);
    }
  }

  function closeModals() {
    // Settings runs in its own tight SettingsWindow so MainWindow never resizes for modals
  }

  // ==================== ACTIONS & EXPRESSIONS (ENGLISH WORDS) ====================
  function setupActionsPanel() {
    document.querySelectorAll("[data-act-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-act-tab]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        renderActionsGrid(tab.dataset.actTab);
      });
    });

    document.getElementById("ap-save-weak").addEventListener("click", () => {
      if (!state.currentActionWord) return;
      const a = state.currentActionWord;
      addOrUpdateWeakWord({
        word: a.word.toLowerCase(),
        phonetic: a.phonetic,
        meaning: a.meaning,
        example: a.example,
        level: "A2",
        source: "action"
      });
      showBubble(`Saved "${a.word}" to your Weak Words list!`, `已将「${a.word}」加入不熟练的英文词库！`, { badge: "Saved" });
    });
  }

  function renderActionsGrid(filter) {
    const grid = document.getElementById("actions-grid");
    grid.innerHTML = "";
    const items = HaruPet.ACTIONS_CATALOG.filter((a) => filter === "all" || a.type === filter);

    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "action-word-btn";
      btn.innerHTML = `
        <span class="aw-emoji">${item.emoji}</span>
        <div>
          <span class="aw-en">${item.word}</span>
          <span class="aw-sub">${item.phonetic}</span>
        </div>`;
      btn.addEventListener("click", () => {
        markUserInteraction();
        recordActiveStudySeconds(8);
        document.querySelectorAll(".action-word-btn").forEach((b) => b.classList.remove("playing"));
        btn.classList.add("playing");
        setTimeout(() => btn.classList.remove("playing"), 1400);

        // Haru performs the exact expression/motion and speaks the English word & example
        HaruPet.performAction(item.id);
        state.currentActionWord = item;

        const bar = document.getElementById("action-preview-bar");
        document.getElementById("ap-word").textContent = item.word;
        document.getElementById("ap-phonetic").textContent = item.phonetic;
        document.getElementById("ap-meaning").textContent = item.meaning;
        document.getElementById("ap-example").textContent = `"${item.example}"`;
        bar.classList.remove("hidden");

        showBubble(`${item.word}! ${item.example}`, `${item.word}（${item.meaning}）`, {
          badge: `Action: ${item.word}`,
          speak: true
        });
        HostBridge.reportHitRects();
      });
      grid.appendChild(btn);
    });
  }

  // ==================== ENGLISH CHAT, TRANSLATE & VOICE STT ====================
  function setupChatPanel() {
    document.querySelectorAll("[data-chat-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextMode = btn.dataset.chatMode;
        if (nextMode === state.chatMode) return;
        if (nextMode !== "talk" && VoiceEngine.isListening()) {
          VoiceEngine.stopListening();
        }
        setChatMode(nextMode);
      });
    });

    const input = document.getElementById("chat-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatOrTranslate();
      }
    });

    document.getElementById("chat-send-btn").addEventListener("click", sendChatOrTranslate);
    document.getElementById("chat-mic-btn").addEventListener("click", toggleVoiceInput);
    document.getElementById("talk-big-mic-btn").addEventListener("click", toggleVoiceInput);
    document.getElementById("stt-stop-btn").addEventListener("click", () => VoiceEngine.stopListening());
    document.getElementById("chat-clear-btn").addEventListener("click", () => {
      state.chatHistory = [];
      document.getElementById("chat-messages").innerHTML = "";
      addWelcomeChatMessage();
    });
  }

  function addWelcomeChatMessage() {
    appendAssistantBubble({
      replyEn: `Hi! I'm Haru, your ${state.settings.englishLevel} English companion. Speak or type to chat, or switch to Translate mode anytime!`,
      replyZh: "嗨！我是你的英语桌宠 Haru。可以直接打字或点麦克风语音转文字对话，切换到 Translate 模式还能随时翻译英文并提取生词哦！",
      spoken: false
    });
  }

  async function sendChatOrTranslate() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;

    markUserInteraction();
    input.value = "";
    appendUserBubble(text);

    const thinkingEl = appendThinkingBubble();

    if (state.chatMode === "translate") {
      state.stats.translationsDone++;
      recordActiveStudySeconds(25);
      const res = await HostBridge.rpc("aiTranslate", { text });
      thinkingEl.remove();

      HaruPet.performAction(res.emotion || "friendly");
      const spokenText = res.spokenEnglish || text;
      appendAssistantBubble({
        replyEn: res.phonetic ? `${spokenText}  ${res.phonetic}` : spokenText,
        replyZh: res.translation || "",
        correction: res.grammarNote || "",
        vocabulary: res.keyWords || [],
        speakText: spokenText,
        spoken: state.settings.autoSpeak
      });
    } else {
      state.stats.messagesSent++;
      recordActiveStudySeconds(30);
      const res = await HostBridge.rpc("aiChat", {
        message: text,
        history: state.chatHistory
      });
      thinkingEl.remove();

      state.chatHistory.push({ role: "user", content: text });
      if (res.replyEn) {
        state.chatHistory.push({ role: "assistant", content: res.replyEn });
      }
      if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

      HaruPet.performAction(res.emotion || "happy");
      appendAssistantBubble({
        replyEn: res.replyEn || "Let's keep practicing English!",
        replyZh: getChineseMode() !== "hide" ? (res.replyZh || "") : "",
        correction: res.correction || "",
        vocabulary: res.vocabulary || [],
        speakText: res.replyEn || "",
        spoken: state.settings.autoSpeak
      });
    }
  }

  function appendUserBubble(text) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg user";
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function appendThinkingBubble() {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg assistant";
    div.textContent = "Haru is thinking...";
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function appendAssistantBubble({ replyEn, replyZh, correction, vocabulary, speakText, spoken }) {
    const container = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg assistant";

    const enDiv = document.createElement("div");
    enDiv.className = "chat-msg-text";
    enDiv.textContent = replyEn;
    div.appendChild(enDiv);

    if (replyZh) {
      const zhMode = getChineseMode();
      if (zhMode !== "hide" || state.chatMode === "translate") {
        const zhDiv = document.createElement("div");
        zhDiv.className = "msg-zh";
        zhDiv.textContent = replyZh;
        if (zhMode === "hover" && state.chatMode !== "translate") {
          zhDiv.classList.add("zh-hover-mask");
          zhDiv.title = "悬停或点击查看中文释义";
          zhDiv.onclick = () => zhDiv.classList.toggle("revealed");
        }
        div.appendChild(zhDiv);
      }
    }

    if (correction) {
      const tip = document.createElement("div");
      tip.className = "msg-tip";
      tip.textContent = `💡 ${correction}`;
      div.appendChild(tip);
    }

    if (Array.isArray(vocabulary) && vocabulary.length > 0) {
      const vWrap = document.createElement("div");
      vWrap.className = "msg-vocab-list";
      vocabulary.forEach((v) => {
        if (!v || !v.word) return;
        const chip = document.createElement("button");
        chip.className = "vocab-chip";
        chip.textContent = `+ ${v.word} (${v.meaning || ""})`;
        chip.title = "Click to add to Weak Words (加入不熟练词库)";
        chip.onclick = () => {
          addOrUpdateWeakWord({
            word: v.word,
            phonetic: v.phonetic || "",
            meaning: v.meaning || "",
            example: v.example || "",
            level: state.settings.englishLevel,
            source: state.chatMode === "translate" ? "translate" : "chat"
          });
          chip.textContent = `✓ ${v.word}`;
          chip.disabled = true;
        };
        vWrap.appendChild(chip);
      });
      div.appendChild(vWrap);
    }

    const toSpeak = speakText || replyEn;
    if (toSpeak) {
      const footer = document.createElement("div");
      footer.className = "msg-footer";
      const playBtn = document.createElement("button");
      playBtn.className = "mini-tag-btn";
      playBtn.innerHTML = `${SPEAKER_SVG}<span>朗读</span>`;
      playBtn.onclick = () => VoiceEngine.speak(toSpeak, state.settings.voice);
      footer.appendChild(playBtn);
      div.appendChild(footer);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (spoken && toSpeak) {
      VoiceEngine.speak(toSpeak, state.settings.voice);
    }
  }

  function toggleVoiceInput() {
    const micBtn = document.getElementById("chat-mic-btn");
    const bigMicBtn = document.getElementById("talk-big-mic-btn");
    const bigMicLabel = document.getElementById("talk-mic-label");
    const talkHint = document.getElementById("talk-hint");
    const bar = document.getElementById("stt-status-bar");
    const statusTxt = document.getElementById("stt-status-text");
    const input = document.getElementById("chat-input");

    if (VoiceEngine.isListening()) {
      VoiceEngine.stopListening();
      return;
    }

    if (talkHint) {
      talkHint.className = "talk-hint";
      talkHint.textContent = "正在启动麦克风语音识别...";
    }
    if (bigMicLabel) bigMicLabel.textContent = "正在连接麦克风...";

    VoiceEngine.startListening(state.settings, {
      onStart(msg) {
        micBtn?.classList.add("recording");
        bigMicBtn?.classList.add("recording");
        if (bigMicLabel) bigMicLabel.textContent = "正在聆听中... 点击停止并发送";
        if (talkHint) {
          talkHint.className = "talk-hint";
          talkHint.textContent = msg;
        }
        bar.classList.remove("hidden");
        statusTxt.textContent = msg;
      },
      onStatus(msg) {
        statusTxt.textContent = msg;
        if (talkHint) {
          talkHint.className = "talk-hint";
          talkHint.textContent = msg;
        }
      },
      onInterim(txt) {
        input.value = txt;
      },
      onFinal(txt) {
        input.value = txt;
        if (txt.trim()) sendChatOrTranslate();
      },
      onError(errMsg) {
        if (talkHint) {
          talkHint.className = "talk-hint err";
          talkHint.textContent = errMsg;
        }
        showBubble("Voice input needs a quick check!", errMsg, { badge: "STT Tip" });
      },
      onEnd() {
        micBtn?.classList.remove("recording");
        bigMicBtn?.classList.remove("recording");
        if (bigMicLabel) bigMicLabel.textContent = "点击开始语音对话";
        bar.classList.add("hidden");
      }
    });
  }

  // ==================== PROACTIVE IDLE WORD QUIZ (TOEFL + BLENDER 3D + ANTIGRAVITY + WEAK WORDS) ====================
  function getBookDisplayName(bookId) {
    if (bookId === "toefl" || bookId === "toefl_core") return "托福 TOEFL";
    if (bookId === "blender" || bookId === "blender_3d") return "Blender 3D";
    if (bookId === "antigravity") return "Antigravity";
    if (bookId === "weak") return "个人生词本";
    if (bookId === "all") return "混合抽查";
    const found = (state.knowledgePacks || []).find((p) => p.id === bookId || p.bookId === bookId);
    return found ? found.name : "自定义词库";
  }

  function syncQuizBookButtons(activeBook) {
    const target = activeBook || state.settings?.quizPackId || "all";
    document.querySelectorAll("[data-quiz-book]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.quizBook === target);
    });
  }

  function setupQuizPanel() {
    document.querySelectorAll("[data-quiz-book]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const nextBook = btn.dataset.quizBook || "all";
        if (state.settings.quizPackId === nextBook && state.activePanel === "quiz") return;
        state.settings.quizPackId = nextBook;
        syncQuizBookButtons(nextBook);
        HostBridge.rpc("saveSettings", state.settings);
        startWordQuiz(nextBook === "weak", false, nextBook);
      });
    });
  }

  function buildQuizPool(weakOnly = false, bookOverride = null) {
    const quizPackId = bookOverride || (weakOnly ? "weak" : (state.settings?.quizPackId || "all"));
    const effectiveWeakOnly = weakOnly || quizPackId === "weak";
    const pool = [];
    const seen = new Set();

    // 1. Prioritize unmastered Weak Words (when mode is all or weak)
    if (quizPackId === "all" || effectiveWeakOnly) {
      (state.weakWords || [])
        .filter((w) => !w.mastered && w.word && w.meaning)
        .forEach((w) => {
          const key = w.word.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            pool.push({
              ...w,
              pos: w.pos || "",
              bookId: w.bookId || "weak",
              category: w.category || "",
              shortcut: w.shortcut || "",
              exampleZh: w.exampleZh || "",
              isWeak: true,
              priority: 3 + (w.wrongCount || 1)
            });
          }
        });
    }

    if (!effectiveWeakOnly || pool.length < 4) {
      // 2. Pull entries from selected book (toefl_core / blender_3d / custom) or all enabled packs
      const packs = quizPackId !== "all" && quizPackId !== "weak"
        ? (state.knowledgePacks || []).filter((p) => p.id === quizPackId || p.bookId === quizPackId)
        : (state.knowledgePacks || []).filter((p) => p.enabled !== false);
      packs.forEach((pack) => {
        const bId = pack.bookId || pack.id || "custom";
        (pack.entries || []).forEach((e) => {
          if (!e.word || !e.meaning) return;
          const key = e.word.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          pool.push({
            id: e.id || "",
            bookId: e.bookId || bId,
            word: e.word,
            phonetic: e.phonetic || "",
            pos: e.pos || e.partOfSpeech || "",
            meaning: e.meaning,
            category: e.category || "",
            shortcut: e.shortcut || "",
            example: e.example || "",
            exampleZh: e.exampleZh || "",
            level: e.level || pack.level || "TOEFL",
            isWeak: false,
            priority: 2
          });
        });
      });
    }

    return pool;
  }

  function startWordQuiz(weakOnly = false, isProactiveIdle = false, bookOverride = null) {
    const activeBook = bookOverride || (weakOnly ? "weak" : (state.settings?.quizPackId || "all"));
    const pool = buildQuizPool(weakOnly, activeBook);
    syncQuizBookButtons(activeBook);

    if (pool.length < 4) {
      showBubble(
        "This vocabulary book needs at least 4 words to start a quiz!",
        `「${getBookDisplayName(activeBook)}」词条不足 4 个，请切换其他词库或导入更多单词。`,
        { badge: "Quiz" }
      );
      return;
    }

    // Weighted shuffle favoring weak words
    const weighted = pool
      .map((item) => ({ item, score: Math.random() * item.priority }))
      .sort((a, b) => b.score - a.score);

    const questions = weighted.slice(0, 4).map((w) => w.item);
    // Prewarm TTS for all 4 quiz words immediately so speaker clicks & next questions play instantaneously
    if (typeof VoiceEngine.prewarm === "function") {
      VoiceEngine.prewarm(questions.map((x) => x.word), state.settings.voice);
    }
    state.quiz = {
      bookId: activeBook,
      questions,
      allPool: pool,
      index: 0,
      correct: 0,
      missed: [],
      answered: false
    };

    closeModals();
    toggleFloatingPanel("quiz", true);
    HaruPet.performAction("excited");

    if (isProactiveIdle) {
      const bookLabel = getBookDisplayName(activeBook);
      const firstQ = questions[0];
      const shortcutTip = firstQ?.shortcut
        ? `（快捷键/命令：${firstQ.shortcut}）`
        : "";
      showBubble(
        `You've been quiet for a while! Let's do a quick ${bookLabel} quiz!`,
        `你待机有一会儿啦～来做一组「${bookLabel}」单词抽查吧！${shortcutTip}`,
        { badge: "Idle Quiz", speak: false }
      );
    }

    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const q = state.quiz;
    const body = document.getElementById("quiz-body");
    const prog = document.getElementById("quiz-progress-text");

    if (q.index >= q.questions.length) {
      finishQuiz();
      return;
    }

    const cur = q.questions[q.index];
    q.answered = false;
    const bookName = getBookDisplayName(cur.bookId || q.bookId);
    prog.textContent = `Question ${q.index + 1} / ${q.questions.length} · ${bookName}${cur.isWeak ? " · 重点复习" : ""}`;

    // Prefer distractors from the same book when available so options feel realistic
    const sameBook = q.allPool.filter(
      (x) => (x.bookId === cur.bookId) && x.word.toLowerCase() !== cur.word.toLowerCase() && x.meaning !== cur.meaning
    );
    const otherPool = q.allPool.filter(
      (x) => x.word.toLowerCase() !== cur.word.toLowerCase() && x.meaning !== cur.meaning
    );
    const distractorSource = sameBook.length >= 3 ? sameBook : otherPool;
    const distractors = distractorSource
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((x) => x.meaning);

    const options = [cur.meaning, ...distractors].sort(() => Math.random() - 0.5);

    const metaBadges = [];
    if (cur.pos) metaBadges.push(`<span class="quiz-cat-badge">${escapeHtml(cur.pos)}</span>`);
    if (cur.category) metaBadges.push(`<span class="quiz-cat-badge">${escapeHtml(cur.category)}</span>`);

    body.innerHTML = `
      <div class="quiz-word-box">
        <div class="quiz-word" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;">
          <span>${escapeHtml(cur.word)}</span>
          ${cur.shortcut ? `<kbd class="word-kbd" title="快捷键 / 命令">${escapeHtml(cur.shortcut)}</kbd>` : ""}
          <button id="quiz-say-btn" class="icon-mini-btn" title="发音">${SPEAKER_SVG}</button>
        </div>
        ${cur.phonetic ? `<div class="quiz-phonetic">${escapeHtml(cur.phonetic)}</div>` : ""}
        ${metaBadges.length ? `<div class="quiz-meta-badges">${metaBadges.join("")}</div>` : ""}
        ${cur.example ? `<div class="quiz-hint">"${escapeHtml(cur.example)}"</div>` : ""}
      </div>
      <div class="quiz-options"></div>
    `;

    document.getElementById("quiz-say-btn").onclick = () => VoiceEngine.speak(cur.word, state.settings.voice);
    if (state.settings.autoSpeak) VoiceEngine.speak(cur.word, state.settings.voice);

    const optWrap = body.querySelector(".quiz-options");
    options.forEach((optText) => {
      const btn = document.createElement("button");
      btn.className = "quiz-opt-btn";
      btn.textContent = optText;
      btn.onclick = () => handleQuizAnswer(btn, optText === cur.meaning, cur, optWrap);
      optWrap.appendChild(btn);
    });
    HostBridge.reportHitRects();
  }

  function handleQuizAnswer(clickedBtn, isCorrect, cur, optWrap) {
    if (state.quiz.answered) return;
    state.quiz.answered = true;
    markUserInteraction();
    recordActiveStudySeconds(20);

    optWrap.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
      if (b.textContent === cur.meaning) b.classList.add("correct");
    });

    if (isCorrect) {
      state.quiz.correct++;
      state.stats.totalQuizCorrect++;
      HaruPet.performAction("nod");
      // Increment correct count if in weak words
      const existing = state.weakWords.find((w) => w.word.toLowerCase() === cur.word.toLowerCase());
      if (existing) {
        existing.correctCount = (existing.correctCount || 0) + 1;
        existing.lastReviewedAt = new Date().toISOString();
        if (existing.correctCount >= 3 && existing.correctCount >= existing.wrongCount) {
          existing.mastered = true;
        }
        saveWeakWords();
      }
    } else {
      clickedBtn.classList.add("wrong");
      state.quiz.missed.push(cur);
      state.stats.totalQuizWrong++;
      HaruPet.performAction("shake");
      // Automatically add missed word to Weak Words (preserving TOEFL / Blender metadata & shortcut!)
      addOrUpdateWeakWord({
        bookId: cur.bookId || "",
        word: cur.word,
        phonetic: cur.phonetic || "",
        pos: cur.pos || "",
        meaning: cur.meaning,
        category: cur.category || "",
        shortcut: cur.shortcut || "",
        example: cur.example || "",
        exampleZh: cur.exampleZh || "",
        level: cur.level || "TOEFL",
        source: "quiz"
      });
    }

    setTimeout(() => {
      state.quiz.index++;
      renderQuizQuestion();
    }, 950);
  }

  function finishQuiz() {
    const q = state.quiz;
    const total = q.questions.length;
    const score = q.correct;
    const ratio = score / total;

    state.stats.quizzesCompleted++;
    saveStats();
    maybeAutoCloudSync();

    let enMsg, zhMsg, action;
    if (score === total) {
      // 全对 -> 夸奖!
      action = "cheer";
      enMsg = `Perfect ${score} out of ${total}! You are absolutely brilliant! I'm so proud of you!`;
      zhMsg = `哇！全对啦（${score}/${total}）！你简直太厉害了，Haru 为你骄傲！🎉`;
    } else if (ratio >= 0.5) {
      action = "happy";
      enMsg = `Nice work! You got ${score} out of ${total}. I saved the missed word to your Weak Words so we can master it together!`;
      zhMsg = `不错哦（${score}/${total}）！答错的单词已经自动放进「不熟练的英文」里啦，一起攻克它吧！`;
    } else {
      // 错误多 -> 鼓励!
      action = "shy";
      enMsg = `Don't be discouraged! Getting ${score} out of ${total} is how we grow. I saved those words for review—you've totally got this!`;
      zhMsg = `别灰心呀（${score}/${total}）！犯错正是进步的开始，我已经把这些不熟练的单词收好啦，Haru 会一直陪你加油的！💕`;
    }

    HaruPet.performAction(action);
    showBubble(enMsg, zhMsg, { badge: score === total ? "🏆 Perfect!" : "💪 Keep Going!", speak: true, duration: 10000 });

    const body = document.getElementById("quiz-body");
    body.innerHTML = `
      <div class="quiz-summary">
        <div class="quiz-score-big">${score} / ${total}</div>
        <p style="margin:8px 0;font-size:13px;color:var(--text-main);">${escapeHtml(zhMsg)}</p>
        ${q.missed.length ? `<p style="font-size:12px;color:var(--accent);margin-bottom:10px;">已自动收录不熟练单词：${q.missed.map((m) => escapeHtml(m.word)).join(", ")}</p>` : ""}
        <div class="toolbar-row" style="justify-content:center;margin-top:10px;">
          <button id="quiz-again-btn" class="primary-btn">再来一组</button>
          <button id="quiz-close-btn" class="secondary-btn">完成</button>
        </div>
      </div>
    `;
    document.getElementById("quiz-again-btn").onclick = () => startWordQuiz(false);
    document.getElementById("quiz-close-btn").onclick = closeFloatingPanels;
    HostBridge.reportHitRects();
  }

  // ==================== STUDY TRACKER, 1-HOUR PRAISE & ABSENCE REMINDER ====================
  function markUserInteraction() {
    state.lastInteractionTime = Date.now();
    state.lastActiveStudyPing = Date.now();
  }

  function recordActiveStudySeconds(sec) {
    const today = todayStr();
    if (state.stats.todayDate !== today) {
      state.stats.todayDate = today;
      state.stats.todayStudySeconds = 0;
    }

    // Streak update
    if (state.stats.lastStudyDate !== today) {
      const prev = state.stats.lastStudyDate;
      if (prev) {
        const diffDays = daysBetween(prev, today);
        state.stats.streakDays = diffDays === 1 ? (state.stats.streakDays || 0) + 1 : 1;
      } else {
        state.stats.streakDays = 1;
      }
      state.stats.lastStudyDate = today;
    }

    state.stats.totalStudySeconds += sec;
    state.stats.todayStudySeconds += sec;
    updateChatHeaderBadges();

    // Check 1-hour study milestone (每学习一小时提示并且夸奖)
    const completedHours = Math.floor(state.stats.totalStudySeconds / 3600);
    if (state.settings.enableHourlyPraise && completedHours > (state.stats.lastHourMilestone || 0)) {
      state.stats.lastHourMilestone = completedHours;
      HaruPet.performAction("cheer");
      HaruPet.spawnSparkle("🏆");
      showBubble(
        `Amazing! You've reached ${completedHours} full ${completedHours === 1 ? "hour" : "hours"} of English study! Take a stretch—you truly deserve praise!`,
        `太棒啦！你已经累计学习英语满 ${completedHours} 小时了！你的坚持闪闪发光，记得伸个懒腰休息一下眼睛哦！🏆`,
        { badge: `🎉 ${completedHours}h Milestone!`, speak: true, sticky: true }
      );
    }

    saveStats();
  }

  function checkAbsenceReminder() {
    if (!state.settings.enableAbsenceReminder) return;
    const last = state.stats.lastStudyDate;
    if (!last) {
      showBubble(
        "Hello! I'm Haru, your English desktop pet. Click the tray next to me anytime to chat or practice!",
        "你好呀！我是你的英语桌宠 Haru～点击我旁边的悬浮托盘或右下角系统托盘，就能随时练口语、测单词、做表情动作哦！",
        { badge: "Welcome", speak: state.settings.autoSpeak, duration: 9000 }
      );
      return;
    }

    const gap = daysBetween(last, todayStr());
    if (gap >= 2) {
      HaruPet.performAction("pouting");
      showBubble(
        `I missed you! It's been ${gap} days since our last English session. Ready for a quick warm-up quiz?`,
        `好想你呀！你已经 ${gap} 天没有学英语啦～要不要现在做一组超轻松的单词热身？`,
        {
          badge: `💌 ${gap}天未学习提醒`,
          speak: state.settings.autoSpeak,
          sticky: true,
          actions: [
            { label: "📝 马上热身", primary: true, onClick: () => startWordQuiz(false) },
            { label: "💬 聊两句", onClick: () => toggleFloatingPanel("chat", true) }
          ]
        }
      );
    }
  }

  function startStudyAndIdleLoops() {
    let idleMotionCounter = 0;

    setInterval(() => {
      const now = Date.now();
      const actCfg = ACTIVITY_CONFIG[state.settings.activityLevel] || ACTIVITY_CONFIG.normal;

      // Increment study timer every 15s while user is actively interacting (chat/quiz/words open or recent interaction < 90s)
      const isStudying =
        state.activePanel === "chat" ||
        state.activePanel === "quiz" ||
        state.activePanel === "actions" ||
        state.activeModal === "words" ||
        (now - state.lastActiveStudyPing < 75000);

      if (isStudying) {
        recordActiveStudySeconds(10);
      }

      // Autonomous idle motion
      idleMotionCounter += 10;
      if (idleMotionCounter >= actCfg.idleMotionSec) {
        idleMotionCounter = 0;
        HaruPet.playIdleAction();
      }

      // Proactive idle word quiz when idle too long (paused when off or during fullscreen DND)
      const idleSec = (now - state.lastInteractionTime) / 1000;
      if (
        state.settings.enableIdleQuiz &&
        state.settings.activityLevel !== "off" &&
        !state.fullscreenDndActive &&
        !state.activePanel &&
        !state.activeModal &&
        idleSec >= actCfg.idleQuizSec
      ) {
        state.lastInteractionTime = now; // reset so it doesn't spam
        startWordQuiz(false, true);
      }
    }, 10000);
  }

  function daysBetween(yyyyMmDdA, yyyyMmDdB) {
    const a = new Date(yyyyMmDdA + "T00:00:00");
    const b = new Date(yyyyMmDdB + "T00:00:00");
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function updateChatHeaderBadges() {
    const lvlEl = document.getElementById("chat-level-pill");
    if (lvlEl && state.settings) lvlEl.textContent = state.settings.englishLevel;
    const mins = Math.floor((state.stats?.todayStudySeconds || 0) / 60);
    const timeText = mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;
    const timeEl = document.getElementById("study-time-pill");
    if (timeEl) timeEl.textContent = timeText;
    updateSidebarStatus();
  }

  // ==================== TRI VOCABULARY HUB (TOEFL + BLENDER 3D + ANTIGRAVITY + WEAK WORDS + PAGINATION) ====================
  const VOCAB_PAGE_SIZE = 30;
  let vocabSearchDebounceTimer = null;
  const vocabView = {
    book: "all", // all | weak | toefl | blender | antigravity
    filtered: [],
    renderedCount: 0,
  };

  function selectVocabBook(bookId) {
    const valid = ["all", "weak", "toefl", "blender", "antigravity"].includes(bookId) ? bookId : "all";
    vocabView.book = valid;
    document.querySelectorAll("[data-vocab-book]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.vocabBook === valid);
    });
    const isWeak = valid === "weak";
    document.getElementById("weak-filter")?.classList.toggle("hidden", !isWeak);
    document.getElementById("btn-toggle-add-weak")?.classList.toggle("hidden", !isWeak);
    if (!isWeak) {
      document.getElementById("add-weak-form")?.classList.add("hidden");
    }
    const quizBtn = document.getElementById("btn-quiz-weak");
    if (quizBtn) {
      quizBtn.textContent = isWeak ? "专攻生词测验" : "抽查当前词库";
    }
    // Pre-select matching target in quick JSON importer
    const targetSel = document.getElementById("quick-import-target");
    if (targetSel && (valid === "toefl" || valid === "blender" || valid === "antigravity")) {
      targetSel.value = valid;
      document.getElementById("quick-import-name")?.classList.add("hidden");
    }
    // Ensure we are on the browse view when clicking a book pill
    switchWordsTab("weak");
  }

  function setupWordsModal() {
    document.querySelectorAll("[data-vocab-book]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectVocabBook(btn.dataset.vocabBook);
      });
    });

    document.querySelectorAll("[data-words-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        switchWordsTab(tab.dataset.wordsTab);
      });
    });

    document.getElementById("weak-search")?.addEventListener("input", () => {
      if (vocabSearchDebounceTimer) clearTimeout(vocabSearchDebounceTimer);
      vocabSearchDebounceTimer = setTimeout(() => renderWeakWordsList(), 140);
    });
    document.getElementById("weak-filter")?.addEventListener("change", () => renderWeakWordsList());
    document.getElementById("btn-quiz-weak")?.addEventListener("click", () => {
      const targetBook = vocabView.book || "all";
      if (IS_SETTINGS_VIEW) HostBridge.startQuizBook(targetBook);
      else startWordQuiz(targetBook === "weak", false, targetBook);
    });

    document.getElementById("btn-toggle-add-weak")?.addEventListener("click", () => {
      document.getElementById("quick-import-form")?.classList.add("hidden");
      document.getElementById("add-weak-form")?.classList.toggle("hidden");
    });

    document.getElementById("btn-save-weak")?.addEventListener("click", () => {
      const word = document.getElementById("new-weak-word").value.trim();
      const meaning = document.getElementById("new-weak-meaning").value.trim();
      if (!word || !meaning) return;
      const shortcut = (document.getElementById("new-weak-shortcut")?.value || "").trim();
      const category = (document.getElementById("new-weak-category")?.value || "").trim();
      addOrUpdateWeakWord({
        bookId: shortcut ? (shortcut.startsWith("/") ? "antigravity" : "blender") : "weak",
        word,
        phonetic: document.getElementById("new-weak-phonetic").value.trim(),
        meaning,
        category,
        shortcut,
        example: document.getElementById("new-weak-example").value.trim(),
        level: state.settings.englishLevel,
        source: "manual"
      });
      ["new-weak-word", "new-weak-phonetic", "new-weak-category", "new-weak-shortcut", "new-weak-meaning", "new-weak-example"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      document.getElementById("add-weak-form").classList.add("hidden");
      renderWeakWordsList();
    });

    // One-Click JSON Vocab Importer (Append to TOEFL / Blender or Create Custom Pack)
    const quickImportForm = document.getElementById("quick-import-form");
    const quickImportTarget = document.getElementById("quick-import-target");
    const quickImportName = document.getElementById("quick-import-name");
    document.getElementById("btn-open-json-import")?.addEventListener("click", () => {
      document.getElementById("add-weak-form")?.classList.add("hidden");
      quickImportForm?.classList.toggle("hidden");
    });
    document.getElementById("btn-cancel-quick-import")?.addEventListener("click", () => {
      quickImportForm?.classList.add("hidden");
    });
    quickImportTarget?.addEventListener("change", () => {
      quickImportName?.classList.toggle("hidden", quickImportTarget.value !== "new");
    });
    document.getElementById("quick-import-file")?.addEventListener("change", (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const txt = document.getElementById("quick-import-text");
        if (txt) txt.value = reader.result || "";
        if (quickImportName && !quickImportName.value.trim()) {
          quickImportName.value = file.name.replace(/\.(json|txt|csv)$/i, "");
        }
        const st = document.getElementById("quick-import-status");
        if (st) {
          st.className = "bento-hint-strip ok";
          st.textContent = `已读取文件「${file.name}」，点击「确认导入」即可批量解析并去重入库。`;
        }
      };
      reader.readAsText(file);
    });
    document.getElementById("btn-confirm-quick-import")?.addEventListener("click", handleQuickJsonImport);

    // Pagination Load More + Auto-load when scrolling near bottom of .cv-content
    document.getElementById("btn-vocab-load-more")?.addEventListener("click", appendNextVocabPage);
    const scrollViewport = document.querySelector("#settings-modal .cv-content");
    scrollViewport?.addEventListener("scroll", () => {
      const wordsPage = document.getElementById("set-tab-words");
      const browsePane = document.getElementById("tab-weak");
      if (!wordsPage || wordsPage.classList.contains("hidden") || !browsePane || browsePane.classList.contains("hidden")) return;
      if (vocabView.renderedCount >= vocabView.filtered.length) return;
      if (scrollViewport.scrollTop + scrollViewport.clientHeight >= scrollViewport.scrollHeight - 160) {
        appendNextVocabPage();
      }
    });

    // Knowledge Pack import / create (in 词库包 tab)
    document.getElementById("btn-toggle-import-pack")?.addEventListener("click", () => {
      document.getElementById("import-pack-form")?.classList.toggle("hidden");
    });
    document.getElementById("btn-cancel-pack")?.addEventListener("click", () => {
      document.getElementById("import-pack-form")?.classList.add("hidden");
    });
    document.getElementById("btn-open-knowledge-dir")?.addEventListener("click", () => {
      HostBridge.rpc("openDataFolder", { sub: "knowledge" });
    });

    document.getElementById("pack-file-input")?.addEventListener("change", (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        document.getElementById("pack-bulk-text").value = reader.result || "";
        const nameInput = document.getElementById("pack-name");
        if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.(json|txt|csv)$/i, "");
      };
      reader.readAsText(file);
    });

    document.getElementById("btn-save-pack")?.addEventListener("click", saveCustomKnowledgePack);
  }

  async function handleQuickJsonImport() {
    const raw = (document.getElementById("quick-import-text")?.value || "").trim();
    const targetBookId = document.getElementById("quick-import-target")?.value || "toefl";
    const newName = (document.getElementById("quick-import-name")?.value || "").trim();
    const st = document.getElementById("quick-import-status");
    if (!raw) {
      if (st) {
        st.className = "bento-hint-strip err";
        st.textContent = "请先粘贴 JSON 词表或选择本地 .json / .txt / .csv 文件。";
      }
      return;
    }

    const defaultLvl = targetBookId === "blender" ? "3D" : targetBookId === "antigravity" ? "AI" : "TOEFL";
    const entries = parseBulkKnowledge(raw, defaultLvl);
    if (!entries.length) {
      if (st) {
        st.className = "bento-hint-strip err";
        st.textContent = "未解析到有效词条，请检查 JSON 格式（需包含 word 与 meaning 字段）。";
      }
      return;
    }

    const res = await HostBridge.rpc("importVocabEntries", {
      targetBookId,
      name: newName || "自定义导入词库",
      description: `批量导入词库（${entries.length} 条）`,
      level: defaultLvl,
      entries
    });

    if (res?.ok) {
      if (res.packs) state.knowledgePacks = res.packs;
      document.getElementById("quick-import-text").value = "";
      if (document.getElementById("quick-import-file")) document.getElementById("quick-import-file").value = "";
      if (st) {
        st.className = "bento-hint-strip ok";
        st.textContent = `已导入 ${res.added} 个新词至「${res.targetName}」（去重后共 ${res.total} 词）。`;
      }
      populateQuizPackDropdown();
      renderWeakWordsList();
      renderKnowledgePacksList();
      flashAutoSaved(`已导入 ${res.added} 个新词`);
    } else if (st) {
      st.className = "bento-hint-strip err";
      st.textContent = res?.error || "导入失败，请检查数据格式。";
    }
  }

  function updateWordsSidebarSummary() {
    const unmastered = (state.weakWords || []).filter((w) => !w.mastered).length;
    const s = state.stats || {};
    const acc = (s.totalQuizCorrect + s.totalQuizWrong) > 0
      ? Math.round((s.totalQuizCorrect * 100) / (s.totalQuizCorrect + s.totalQuizWrong)) + "%"
      : "—";
    const toeflPack = (state.knowledgePacks || []).find((p) => p.id === "toefl");
    const blenderPack = (state.knowledgePacks || []).find((p) => p.id === "blender");
    const agPack = (state.knowledgePacks || []).find((p) => p.id === "antigravity");
    const totalEntries = (state.knowledgePacks || []).reduce((sum, p) => sum + (p.entries?.length || 0), 0);
    const wEl = document.getElementById("words-sb-weak");
    const aEl = document.getElementById("words-sb-acc");
    const pEl = document.getElementById("words-sb-packs");
    if (wEl) wEl.textContent = String(unmastered);
    if (aEl) aEl.textContent = acc;
    if (pEl) {
      pEl.textContent = `托福 ${toeflPack?.entries?.length || 0} · Blender ${blenderPack?.entries?.length || 0} · Antigravity ${agPack?.entries?.length || 0}（共 ${totalEntries} 词）`;
    }
    updateSidebarStatus();
  }

  function switchWordsTab(tabName) {
    const valid = ["weak", "knowledge", "stats"].includes(tabName) ? tabName : "weak";
    document.querySelectorAll("[data-words-tab]").forEach((t) => {
      t.classList.toggle("active", t.dataset.wordsTab === valid);
    });
    ["weak", "knowledge", "stats"].forEach((id) => {
      document.getElementById(`tab-${id}`)?.classList.toggle("hidden", id !== valid);
    });
    const contentEl = document.querySelector("#settings-modal .cv-content");
    if (contentEl) contentEl.scrollTop = 0;
    if (valid === "stats") renderStatsDashboard();
    else if (valid === "knowledge") renderKnowledgePacksList();
    else renderWeakWordsList();
    updateWordsSidebarSummary();
  }

  function addOrUpdateWeakWord(entry) {
    const key = entry.word.trim().toLowerCase();
    const existing = state.weakWords.find((w) => w.word.trim().toLowerCase() === key);
    if (existing) {
      existing.wrongCount = (existing.wrongCount || 0) + 1;
      existing.mastered = false;
      if (!existing.bookId && entry.bookId) existing.bookId = entry.bookId;
      if (!existing.pos && entry.pos) existing.pos = entry.pos;
      if (!existing.meaning && entry.meaning) existing.meaning = entry.meaning;
      if (!existing.phonetic && entry.phonetic) existing.phonetic = entry.phonetic;
      if (!existing.category && entry.category) existing.category = entry.category;
      if (!existing.shortcut && entry.shortcut) existing.shortcut = entry.shortcut;
      if (!existing.example && entry.example) existing.example = entry.example;
      if (!existing.exampleZh && entry.exampleZh) existing.exampleZh = entry.exampleZh;
    } else {
      state.weakWords.unshift({
        id: Math.random().toString(36).slice(2, 10),
        bookId: entry.bookId || "",
        word: entry.word.trim(),
        phonetic: entry.phonetic || "",
        pos: entry.pos || "",
        meaning: entry.meaning || "",
        category: entry.category || "",
        shortcut: entry.shortcut || "",
        example: entry.example || "",
        exampleZh: entry.exampleZh || "",
        level: entry.level || state.settings.englishLevel,
        wrongCount: 1,
        correctCount: 0,
        mastered: false,
        source: entry.source || "manual",
        addedAt: new Date().toISOString(),
        lastReviewedAt: ""
      });
    }
    saveWeakWords();
  }

  function collectVocabItemsForBook(bookId) {
    if (bookId === "weak") {
      const filter = document.getElementById("weak-filter")?.value || "unmastered";
      return (state.weakWords || [])
        .filter((w) => {
          if (filter === "unmastered" && w.mastered) return false;
          if (filter === "mastered" && !w.mastered) return false;
          return true;
        })
        .map((w) => ({ ...w, _isWeakRow: true }));
    }

    const packs = bookId === "all"
      ? (state.knowledgePacks || [])
      : (state.knowledgePacks || []).filter((p) => p.id === bookId || p.bookId === bookId);

    const out = [];
    packs.forEach((pack) => {
      const bId = pack.bookId || pack.id;
      const bName = pack.name || getBookDisplayName(bId);
      (pack.entries || []).forEach((e) => {
        if (!e || !e.word) return;
        out.push({
          ...e,
          bookId: e.bookId || bId,
          _bookName: bName,
          pos: e.pos || e.partOfSpeech || "",
          _isWeakRow: false
        });
      });
    });
    return out;
  }

  function createVocabCardElement(item, weakKeySet) {
    const card = document.createElement("div");
    const isWeakRow = !!item._isWeakRow;
    const key = (item.word || "").trim().toLowerCase();
    const alreadyInWeak = weakKeySet.has(key);
    card.className = `word-item-card${isWeakRow && item.mastered ? " mastered" : ""}`;

    const bookId = item.bookId || "";
    const showBookTag = vocabView.book === "all" || (isWeakRow && (bookId === "toefl" || bookId === "blender" || bookId === "antigravity"));
    const bookTagText = bookId === "blender"
      ? "Blender 3D"
      : bookId === "antigravity"
      ? "Antigravity"
      : bookId === "toefl"
      ? "托福 TOEFL"
      : (item._bookName || "");
    const bookTagCls = bookId === "blender"
      ? "word-book-tag blender"
      : bookId === "antigravity"
      ? "word-book-tag antigravity"
      : "word-book-tag";

    const tagsHtml = [];
    if (showBookTag && bookTagText) {
      tagsHtml.push(`<span class="${bookTagCls}">${escapeHtml(bookTagText)}</span>`);
    }
    if (item.category) {
      tagsHtml.push(`<span class="word-cat-tag">${escapeHtml(item.category)}</span>`);
    }
    if (isWeakRow) {
      tagsHtml.push(`<span class="word-cat-tag">错 ${item.wrongCount || 0} / 对 ${item.correctCount || 0}</span>`);
    }

    card.innerHTML = `
      <div class="word-card-body">
        <div class="word-main">
          <span>${escapeHtml(item.word)}</span>
          ${item.shortcut ? `<kbd class="word-kbd" title="快捷键 / 命令">${escapeHtml(item.shortcut)}</kbd>` : ""}
          ${item.pos ? `<span class="word-pos-tag">${escapeHtml(item.pos)}</span>` : ""}
          ${item.phonetic ? `<span class="phonetic">${escapeHtml(item.phonetic)}</span>` : ""}
        </div>
        <div class="word-meta">${escapeHtml(item.meaning || "")}</div>
        ${tagsHtml.length ? `<div class="word-tags-row">${tagsHtml.join("")}</div>` : ""}
        ${item.example ? `<div class="word-example">"${escapeHtml(item.example)}"</div>` : ""}
        ${item.exampleZh ? `<div class="word-example-zh">${escapeHtml(item.exampleZh)}</div>` : ""}
      </div>
      <div class="word-actions">
        <button type="button" class="mini-tag-btn" data-say title="朗读">${SPEAKER_SVG}</button>
        ${isWeakRow
          ? `<button type="button" class="mini-tag-btn" data-toggle>${item.mastered ? "恢复复习" : "已掌握"}</button>
             <button type="button" class="mini-tag-btn danger" data-del>删除</button>`
          : `<button type="button" class="mini-tag-btn" data-collect ${alreadyInWeak ? "disabled" : ""}>${alreadyInWeak ? "✓ 已收藏" : "+ 生词本"}</button>`}
      </div>
    `;

    card.querySelector("[data-say]").onclick = () => VoiceEngine.speak(item.word, state.settings.voice);

    if (isWeakRow) {
      const targetWeak = state.weakWords.find((w) => w.id === item.id);
      card.querySelector("[data-toggle]").onclick = () => {
        if (!targetWeak) return;
        targetWeak.mastered = !targetWeak.mastered;
        saveWeakWords();
        renderWeakWordsList();
        updateWordsSidebarSummary();
      };
      card.querySelector("[data-del]").onclick = () => {
        state.weakWords = state.weakWords.filter((x) => x.id !== item.id);
        saveWeakWords();
        renderWeakWordsList();
        updateWordsSidebarSummary();
      };
    } else {
      const collectBtn = card.querySelector("[data-collect]");
      if (collectBtn && !alreadyInWeak) {
        collectBtn.onclick = () => {
          addOrUpdateWeakWord({
            bookId: item.bookId || "",
            word: item.word,
            phonetic: item.phonetic || "",
            pos: item.pos || "",
            meaning: item.meaning || "",
            category: item.category || "",
            shortcut: item.shortcut || "",
            example: item.example || "",
            exampleZh: item.exampleZh || "",
            level: item.level || "TOEFL",
            source: "vocab"
          });
          collectBtn.textContent = "✓ 已收藏";
          collectBtn.disabled = true;
          updateWordsSidebarSummary();
        };
      }
    }

    return card;
  }

  function updateVocabPaginationBar() {
    const bar = document.getElementById("vocab-more-bar");
    const info = document.getElementById("vocab-count-info");
    const btn = document.getElementById("btn-vocab-load-more");
    if (!bar || !info || !btn) return;
    const total = vocabView.filtered.length;
    const shown = vocabView.renderedCount;
    if (total === 0) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    const remain = Math.max(0, total - shown);
    info.textContent = remain > 0
      ? `已显示 ${shown} / 共 ${total} 词（向下滚动或点击加载更多）`
      : `已显示全部 ${total} 词`;
    btn.classList.toggle("hidden", remain <= 0);
    if (remain > 0) {
      btn.textContent = `加载更多 (+${Math.min(VOCAB_PAGE_SIZE, remain)})`;
    }
  }

  function appendNextVocabPage() {
    const list = document.getElementById("weak-words-list");
    if (!list) return;
    if (vocabView.renderedCount >= vocabView.filtered.length) {
      updateVocabPaginationBar();
      return;
    }
    const weakKeySet = new Set((state.weakWords || []).map((w) => (w.word || "").trim().toLowerCase()));
    const slice = vocabView.filtered.slice(vocabView.renderedCount, vocabView.renderedCount + VOCAB_PAGE_SIZE);
    const frag = document.createDocumentFragment();
    slice.forEach((item) => frag.appendChild(createVocabCardElement(item, weakKeySet)));
    list.appendChild(frag);
    vocabView.renderedCount += slice.length;
    updateVocabPaginationBar();
  }

  function renderWeakWordsList() {
    const list = document.getElementById("weak-words-list");
    if (!list) return;
    const q = (document.getElementById("weak-search")?.value || "").trim().toLowerCase();
    const rawItems = collectVocabItemsForBook(vocabView.book);

    vocabView.filtered = q
      ? rawItems.filter((w) =>
          (w.word || "").toLowerCase().includes(q) ||
          (w.meaning || "").toLowerCase().includes(q) ||
          (w.category || "").toLowerCase().includes(q) ||
          (w.shortcut || "").toLowerCase().includes(q) ||
          (w.example || "").toLowerCase().includes(q)
        )
      : rawItems;
    vocabView.renderedCount = 0;
    list.innerHTML = "";

    if (!vocabView.filtered.length) {
      const emptyMsg = vocabView.book === "weak"
        ? "暂无个人生词记录。Quiz 答错的托福 / Blender / Antigravity 词条，或词表中点击「+ 生词本」的单词都会自动收录在这里！"
        : "未搜索到匹配的词条，可尝试清空搜索词或点击「导入 JSON 词库」扩充词表。";
      list.innerHTML = `<div class="word-meta" style="text-align:center;padding:24px;">${emptyMsg}</div>`;
      updateVocabPaginationBar();
      updateWordsSidebarSummary();
      return;
    }

    appendNextVocabPage();
    if (typeof VoiceEngine.prewarm === "function") {
      VoiceEngine.prewarm(vocabView.filtered.slice(0, 6).map((x) => x.word), state.settings.voice);
    }
    updateWordsSidebarSummary();
  }

  async function saveCustomKnowledgePack() {
    const name = document.getElementById("pack-name").value.trim();
    const level = document.getElementById("pack-level").value;
    const desc = document.getElementById("pack-desc").value.trim();
    const raw = document.getElementById("pack-bulk-text").value.trim();
    if (!name || !raw) return;

    const entries = parseBulkKnowledge(raw, level);
    if (!entries.length) {
      showBubble("Couldn't parse any words from your input!", "未解析到有效词条，请检查格式（JSON 数组或竖线分隔文本）。", { badge: "Import" });
      return;
    }

    const packId = `custom_${Date.now().toString(36)}`;
    const pack = {
      id: packId,
      bookId: packId,
      name,
      description: desc || `自定义词库（${entries.length} 条）`,
      level,
      category: "custom",
      builtIn: false,
      enabled: true,
      entries
    };

    const res = await HostBridge.rpc("saveKnowledgePack", pack);
    if (res && res.packs) state.knowledgePacks = res.packs;
    document.getElementById("pack-name").value = "";
    document.getElementById("pack-desc").value = "";
    document.getElementById("pack-bulk-text").value = "";
    document.getElementById("import-pack-form").classList.add("hidden");
    populateQuizPackDropdown();
    renderKnowledgePacksList();
    renderWeakWordsList();
    maybeAutoCloudSync();
    showBubble(`Added "${name}" with ${entries.length} items!`, `词库包「${name}」已保存（共 ${entries.length} 词）！`, { badge: "Vocab+" });
  }

  function parseBulkKnowledge(raw, defaultLevel) {
    // Try JSON array or object with entries first (supports full TOEFL / Blender schema!)
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : (parsed.entries || parsed.words || []);
        return arr
          .filter((x) => x && (x.word || x.term))
          .map((x, idx) => {
            const pos = String(x.pos || x.partOfSpeech || "").trim();
            return {
              id: String(x.id || "").trim(),
              bookId: String(x.bookId || "").trim(),
              word: String(x.word || x.term).trim(),
              phonetic: String(x.phonetic || x.ipa || "").trim(),
              pos,
              partOfSpeech: pos,
              meaning: String(x.meaning || x.translation || x.zh || "").trim(),
              category: String(x.category || x.module || x.topic || "").trim(),
              shortcut: String(x.shortcut || x.hotkey || "").trim(),
              example: String(x.example || x.sentence || "").trim(),
              exampleZh: String(x.exampleZh || x.example_zh || "").trim(),
              level: String(x.level || defaultLevel || "TOEFL").trim(),
              tags: Array.isArray(x.tags) ? x.tags : []
            };
          });
      } catch { }
    }

    // Parse line-by-line (supports | , \t separated: word | meaning | phonetic | example | category | shortcut)
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const sep = line.includes("|") ? "|" : (line.includes("\t") ? "\t" : ",");
      const parts = line.split(sep).map((p) => p.trim());
      if (parts.length >= 2 && parts[0]) {
        out.push({
          id: "",
          bookId: "",
          word: parts[0],
          meaning: parts[1],
          phonetic: parts[2] || "",
          pos: "",
          partOfSpeech: "",
          example: parts[3] || "",
          exampleZh: "",
          category: parts[4] || "",
          shortcut: parts[5] || "",
          level: defaultLevel || "TOEFL",
          tags: []
        });
      }
    }
    return out;
  }

  function renderKnowledgePacksList() {
    const list = document.getElementById("knowledge-packs-list");
    list.innerHTML = "";
    state.knowledgePacks.forEach((pack) => {
      const card = document.createElement("div");
      card.className = "pack-card";
      card.innerHTML = `
        <div>
          <div class="word-main">${escapeHtml(pack.name)} <span class="level-pill">${escapeHtml(pack.level)}</span> ${pack.builtIn ? '<span class="mini-tag-btn">内置</span>' : '<span class="mini-tag-btn">自定义</span>'}</div>
          <div class="word-meta">${escapeHtml(pack.description || "")} · 共 ${(pack.entries || []).length} 条</div>
        </div>
        <div class="word-actions">
          <label style="font-size:12px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:7px;cursor:pointer;">
            <span>参与测验</span>
            <span class="s-switch"><input type="checkbox" ${pack.enabled !== false ? "checked" : ""} data-enable /><span class="s-switch-track"></span></span>
          </label>
          ${!pack.builtIn ? `<button class="mini-tag-btn danger" data-del>删除</button>` : ""}
        </div>
      `;
      card.querySelector("[data-enable]").onchange = async (ev) => {
        pack.enabled = ev.target.checked;
        await HostBridge.rpc("saveKnowledgePack", pack);
        updateWordsSidebarSummary();
      };
      const delBtn = card.querySelector("[data-del]");
      if (delBtn) {
        delBtn.onclick = async () => {
          const res = await HostBridge.rpc("deleteKnowledgePack", { id: pack.id });
          if (res && res.packs) state.knowledgePacks = res.packs;
          renderKnowledgePacksList();
        };
      }
      list.appendChild(card);
    });
    updateWordsSidebarSummary();
  }

  function renderStatsDashboard() {
    const s = state.stats;
    const totalHours = (s.totalStudySeconds / 3600).toFixed(2);
    const todayMins = Math.floor(s.todayStudySeconds / 60);
    const acc = (s.totalQuizCorrect + s.totalQuizWrong) > 0
      ? Math.round((s.totalQuizCorrect * 100) / (s.totalQuizCorrect + s.totalQuizWrong)) + "%"
      : "—";
    const unmastered = state.weakWords.filter((w) => !w.mastered).length;
    const totalKnowledge = state.knowledgePacks.reduce((acc2, p) => acc2 + (p.entries?.length || 0), 0);

    document.getElementById("stats-dashboard").innerHTML = `
      <div class="stat-card"><div class="stat-value">${totalHours}h</div><div class="stat-label">累计学习时长</div></div>
      <div class="stat-card"><div class="stat-value">${todayMins}m</div><div class="stat-label">今日学习时长</div></div>
      <div class="stat-card"><div class="stat-value">${s.streakDays || 0} 天</div><div class="stat-label">连续打卡天数</div></div>
      <div class="stat-card"><div class="stat-value">${s.quizzesCompleted || 0}</div><div class="stat-label">完成测验次数</div></div>
      <div class="stat-card"><div class="stat-value">${acc}</div><div class="stat-label">测验正确率</div></div>
      <div class="stat-card"><div class="stat-value">${unmastered}</div><div class="stat-label">待巩固生词</div></div>
      <div class="stat-card"><div class="stat-value">${s.messagesSent || 0}</div><div class="stat-label">英语对话轮数</div></div>
      <div class="stat-card"><div class="stat-value">${s.translationsDone || 0}</div><div class="stat-label">英文翻译次数</div></div>
      <div class="stat-card"><div class="stat-value">${totalKnowledge}</div><div class="stat-label">知识库总词条</div></div>
    `;
  }

  // ==================== SETTINGS & CLOUD SYNC (CLASH VERGE AUTO-SAVE CONTROLLER) ====================
  const ACTIVITY_HINTS = {
    off: "已关闭主动待机抽查，仅在你手动点击 Quiz 或按下快捷键时测验。",
    quiet: "待机满 30 分钟且未在全屏状态下，主动发起一组单词抽查。",
    normal: "待机满 12 分钟自动发起一组 4 题单词复习测验（推荐）。",
    lively: "高强度伴学：待机满 5 分钟即发起一次快速单词抽查。",
    super: "高强度伴学：待机满 2 分钟即发起一次快速单词抽查。"
  };

  const CORRECTION_HINTS = {
    gentle: "自然对话不打断，仅在出现明显语法/拼写错误时温和提示。",
    strict: "逐句检查时态、介词与搭配，并给出更地道的母语改写建议。"
  };

  const ZH_MODE_HINTS = {
    always: "在桌宠气泡与对话回复下方始终展示中文辅助翻译。",
    hover: "盲听 / 盲看练习：默认模糊遮罩中文，悬停或点击即可揭晓释义。",
    hide: "纯英文沉浸环境：隐藏气泡与对话中的中文翻译（翻译模式除外）。"
  };

  const STT_HINTS = {
    auto: "已配置 API Key 时优先使用 Whisper 精准转写，否则自动使用浏览器本地识别。",
    webspeech: "使用内置实时语音识别，无需消耗 API 额度（无需填写 Whisper 模型）。",
    whisper: "强制通过上方 AI 接口的 /audio/transcriptions 端点进行高精度语音转写。"
  };

  const DEFAULT_MODEL_LOCAL = "models/haru/haru_greeter_t03.model3.json";
  const DEFAULT_MODEL_CDN = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json";

  let resetConfirmTimer = null;
  let resetConfirming = false;
  let autoSaveBadgeTimer = null;
  let voicePreviewPlaying = false;
  let voicePreviewSeq = 0;
  let recordingHotkeyKey = null;

  function flashAutoSaved(label = "已自动保存") {
    const badge = document.getElementById("cv-autosave-badge");
    if (!badge) return;
    badge.textContent = label;
    badge.classList.add("visible");
    clearTimeout(autoSaveBadgeTimer);
    autoSaveBadgeTimer = setTimeout(() => badge.classList.remove("visible"), 1500);
  }

  async function autoSaveSettings(showToast = true) {
    if (!state.settings) return;
    await HostBridge.rpc("saveSettings", state.settings);
    updateChatHeaderBadges();
    updateSidebarStatus();
    if (showToast) flashAutoSaved("已自动保存");
  }

  function updateSidebarStatus() {
    const wordsEl = document.getElementById("sb-today-words");
    const timeEl = document.getElementById("sb-today-time");
    const dotEl = document.getElementById("sb-api-dot");
    const apiEl = document.getElementById("sb-api-status");

    const weakCount = (state.weakWords || []).filter((w) => !w.mastered).length;
    const mins = Math.floor((state.stats?.todayStudySeconds || 0) / 60);
    const timeText = mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`;
    if (wordsEl) wordsEl.textContent = `${weakCount} 词`;
    if (timeEl) timeEl.textContent = timeText;

    const hasKey = !!(state.settings?.api?.apiKey || "").trim();
    const isLocal = /localhost|127\.0\.0\.1/i.test(state.settings?.api?.baseUrl || "");
    let st = state.lastApiStatus;
    if (st.state === "idle") {
      st = (hasKey || isLocal)
        ? { state: "ok", text: `${state.settings?.api?.model || "API"} 已配置` }
        : { state: "idle", text: "离线词库模式" };
    }
    if (dotEl) dotEl.className = `cv-dot dot-${st.state}`;
    if (apiEl) apiEl.textContent = st.text;

    const sumWords = document.getElementById("data-summary-words");
    const sumPacks = document.getElementById("data-summary-packs");
    const sumHours = document.getElementById("data-summary-hours");
    if (sumWords) sumWords.textContent = String((state.weakWords || []).length);
    if (sumPacks) sumPacks.textContent = String((state.knowledgePacks || []).length);
    if (sumHours) sumHours.textContent = `${((state.stats?.totalStudySeconds || 0) / 3600).toFixed(1)}h`;
  }

  function cancelResetConfirmation() {
    clearTimeout(resetConfirmTimer);
    resetConfirming = false;
    const btn = document.getElementById("btn-reset-settings");
    const cancelBtn = document.getElementById("btn-reset-cancel");
    if (btn) {
      btn.classList.remove("confirming");
      btn.textContent = "恢复默认";
    }
    cancelBtn?.classList.add("hidden");
  }

  function formatHotkeyDisplay(combo) {
    if (!combo) return "未设置";
    return combo.split("+").map((p) => p.trim()).filter(Boolean).join(" + ");
  }

  function syncApiUrlLockState(preset, forceUnlock = false) {
    const urlInput = document.getElementById("set-api-url");
    const unlockBtn = document.getElementById("btn-unlock-baseurl");
    if (!urlInput) return;
    const isOfficialPreset = preset !== "custom" && preset !== "ollama" && !forceUnlock;
    urlInput.readOnly = isOfficialPreset;
    if (unlockBtn) {
      unlockBtn.classList.toggle("hidden", !isOfficialPreset);
    }
  }

  function updateEdgeAccentTag() {
    const sel = document.getElementById("set-edge-voice");
    const tag = document.getElementById("edge-accent-tag");
    if (!sel || !tag) return;
    const opt = sel.options[sel.selectedIndex];
    tag.textContent = opt?.dataset?.accent || "美音";
  }

  function syncModelPresetCards(modelUrl) {
    const url = (modelUrl || "").trim();
    document.querySelectorAll(".model-preset-card[data-model-preset]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.modelPreset === url);
    });
    const lbl = document.getElementById("lbl-current-model");
    if (lbl) {
      if (url === DEFAULT_MODEL_LOCAL) {
        lbl.textContent = "当前模型：本地内置 Haru（无需联网）";
      } else if (url === DEFAULT_MODEL_CDN) {
        lbl.textContent = "当前模型：云端镜像 Haru（jsDelivr CDN）";
      } else {
        const shortName = url.split("/").pop() || url;
        lbl.textContent = `当前自定义模型：${decodeURIComponent(shortName)}`;
      }
    }
  }

  function updateVoicePreviewButton(playing) {
    voicePreviewPlaying = !!playing;
    const btn = document.getElementById("btn-preview-voice");
    if (!btn) return;
    btn.classList.toggle("playing", voicePreviewPlaying);
    btn.textContent = voicePreviewPlaying ? "停止试听" : "试听";
  }

  const SETTINGS_PAGE_IDS = ["overview", "learning", "words", "api", "voice", "data"];

  function switchSettingsTab(tabName, subTab = null) {
    const target = SETTINGS_PAGE_IDS.includes(tabName) ? tabName : "overview";
    let pageTitle = "";
    document.querySelectorAll(".cv-nav-item[data-set-tab]").forEach((t) => {
      const isAct = t.dataset.setTab === target;
      t.classList.toggle("active", isAct);
      if (isAct && t.dataset.pageTitle) pageTitle = t.dataset.pageTitle;
    });
    SETTINGS_PAGE_IDS.forEach((id) => {
      document.getElementById(`set-tab-${id}`)?.classList.toggle("hidden", id !== target);
    });
    const titleEl = document.getElementById("cv-page-title");
    if (titleEl && pageTitle) titleEl.textContent = pageTitle;
    const contentEl = document.querySelector("#settings-modal .cv-content");
    if (contentEl) contentEl.scrollTop = 0;

    if (target === "words") {
      renderKnowledgePacksList();
      renderStatsDashboard();
      if (subTab === "weak") {
        selectVocabBook("weak");
      } else if (subTab === "knowledge" || subTab === "stats") {
        switchWordsTab(subTab);
      } else {
        selectVocabBook(vocabView.book || "all");
      }
    } else if (target === "voice") {
      prewarmVoicePreviews();
    } else if (target === "data") {
      updateSidebarStatus();
    }
  }

  function setupSettingsModal() {
    // 1. Left Sidebar 6-Page Navigation (including merged 词库中心)
    document.querySelectorAll(".cv-nav-item[data-set-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.classList.contains("active")) return;
        switchSettingsTab(tab.dataset.setTab);
      });
    });

    // 2. Integrated Topbar & Brand Native Dragging (moves standalone SettingsWindow smoothly at 125Hz!)
    const dragHandles = [document.getElementById("cv-drag-topbar"), document.getElementById("cv-drag-brand")];
    dragHandles.forEach((handle) => {
      handle?.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target.closest("button, input, select")) return;
        if (IS_SETTINGS_VIEW) {
          HostBridge.settingsWinDragStart();
        }
      });
      const endWinDrag = () => {
        if (IS_SETTINGS_VIEW) HostBridge.settingsWinDragEnd();
      };
      handle?.addEventListener("pointerup", endWinDrag);
      handle?.addEventListener("pointercancel", endWinDrag);
    });

    // 3. Topbar Quick Actions & Window Controls (Theme Toggle, Pin/Topmost, Maximize/Restore)
    document.getElementById("btn-settings-maximize")?.addEventListener("click", () => {
      if (IS_SETTINGS_VIEW) {
        HostBridge.settingsWinToggleMax();
      } else {
        applySettingsMaximized(!state.settingsMaximized);
      }
    });

    document.getElementById("btn-quick-theme")?.addEventListener("click", () => {
      const curResolved = resolveEffectiveTheme(state.settings.uiTheme);
      state.settings.uiTheme = curResolved === "dark" ? "light" : "dark";
      applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);
      autoSaveSettings();
    });

    document.getElementById("btn-quick-topmost")?.addEventListener("click", () => {
      state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
      const cb = document.getElementById("set-topmost");
      if (cb) cb.checked = state.settings.alwaysOnTop;
      document.getElementById("btn-quick-topmost")?.classList.toggle("active", state.settings.alwaysOnTop);
      autoSaveSettings();
    });

    // 4. Page 1: Theme, Accent, Pet Scale, Window Switches, Model Presets + Import Dialog, Global Hotkeys
    document.querySelectorAll(".theme-seg-btn[data-ui-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.uiTheme = btn.dataset.uiTheme;
        applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);
        autoSaveSettings();
      });
    });

    document.querySelectorAll(".border-swatch[data-ui-border]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.uiBorderColor = btn.dataset.uiBorder;
        applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);
        autoSaveSettings();
      });
    });

    const scaleSlider = document.getElementById("set-scale");
    scaleSlider?.addEventListener("input", (e) => {
      const nextScale = Number(e.target.value);
      updateRangeProgress(e.target);
      const lbl = document.getElementById("lbl-scale");
      if (lbl) lbl.textContent = `${Math.round(nextScale * 100)}%`;
      HostBridge.livePetScale(nextScale, false);
    });
    scaleSlider?.addEventListener("change", (e) => {
      const nextScale = Number(e.target.value);
      updateRangeProgress(e.target);
      state.settings.petScale = nextScale;
      HostBridge.livePetScale(nextScale, true);
      autoSaveSettings();
    });

    document.getElementById("set-topmost")?.addEventListener("change", (e) => {
      state.settings.alwaysOnTop = !!e.target.checked;
      document.getElementById("btn-quick-topmost")?.classList.toggle("active", state.settings.alwaysOnTop);
      autoSaveSettings();
    });
    document.getElementById("set-lock")?.addEventListener("change", (e) => {
      state.settings.lockPosition = !!e.target.checked;
      autoSaveSettings();
    });
    document.getElementById("set-fullscreen-dnd")?.addEventListener("change", (e) => {
      state.settings.fullscreenDnd = !!e.target.checked;
      autoSaveSettings();
    });

    // Model Preset Cards + Custom Model Import Sub-dialog
    document.querySelectorAll(".model-preset-card[data-model-preset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nextUrl = btn.dataset.modelPreset;
        if (!nextUrl || state.settings.modelUrl === nextUrl) return;
        state.settings.modelUrl = nextUrl;
        syncModelPresetCards(nextUrl);
        document.getElementById("set-model-url").value = nextUrl;
        await autoSaveSettings();
      });
    });

    const modelDialog = document.getElementById("model-import-dialog");
    const closeModelDialog = () => modelDialog?.classList.add("hidden");
    document.getElementById("btn-open-model-dialog")?.addEventListener("click", () => {
      document.getElementById("set-model-url").value = state.settings.modelUrl || DEFAULT_MODEL_LOCAL;
      const st = document.getElementById("model-dialog-status");
      if (st) {
        st.className = "bento-hint-strip";
        st.textContent = "支持 Live2D Cubism 4 格式（.model3.json），切换后立即加载生效。";
      }
      modelDialog?.classList.remove("hidden");
    });
    document.getElementById("btn-close-model-dialog")?.addEventListener("click", closeModelDialog);
    document.getElementById("btn-cancel-model-dialog")?.addEventListener("click", closeModelDialog);
    document.getElementById("btn-reset-model-url")?.addEventListener("click", () => {
      document.getElementById("set-model-url").value = DEFAULT_MODEL_LOCAL;
    });
    document.getElementById("btn-browse-model")?.addEventListener("click", async () => {
      const res = await HostBridge.rpc("browseModelFile", {});
      if (res?.ok && res.modelUrl) {
        document.getElementById("set-model-url").value = res.modelUrl;
        const st = document.getElementById("model-dialog-status");
        if (st) {
          st.className = "bento-hint-strip ok";
          st.textContent = "已选择本地模型文件，点击「应用模型」立即加载。";
        }
      }
    });
    document.getElementById("btn-apply-model-url")?.addEventListener("click", async () => {
      const url = (document.getElementById("set-model-url")?.value || "").trim();
      if (!url) return;
      state.settings.modelUrl = url;
      syncModelPresetCards(url);
      await autoSaveSettings();
      closeModelDialog();
    });

    // Global Hotkey Recorder
    document.querySelectorAll(".hotkey-cap[data-hotkey-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.hotkeyKey;
        document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
        if (recordingHotkeyKey === key) {
          recordingHotkeyKey = null;
          populateHotkeysUI();
          return;
        }
        recordingHotkeyKey = key;
        btn.classList.add("recording");
        btn.textContent = "按下组合键...";
      });
    });

    window.addEventListener("keydown", (e) => {
      if (!recordingHotkeyKey || state.activeModal !== "settings") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        recordingHotkeyKey = null;
        document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
        populateHotkeysUI();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        state.settings.hotkeys = state.settings.hotkeys || { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" };
        state.settings.hotkeys[recordingHotkeyKey] = "";
        recordingHotkeyKey = null;
        document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
        populateHotkeysUI();
        autoSaveSettings();
        return;
      }
      const modKeys = ["Control", "Alt", "Shift", "Meta"];
      if (modKeys.includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (parts.length === 0) return; // Require at least one modifier for global hotkey safety
      let mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key.toUpperCase();
      if (e.code && e.code.startsWith("Key")) mainKey = e.code.slice(3);
      else if (e.code && e.code.startsWith("Digit")) mainKey = e.code.slice(5);
      else if (e.code === "Space") mainKey = "Space";
      parts.push(mainKey);
      state.settings.hotkeys = state.settings.hotkeys || { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" };
      state.settings.hotkeys[recordingHotkeyKey] = parts.join("+");
      recordingHotkeyKey = null;
      document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
      populateHotkeysUI();
      autoSaveSettings();
    });

    document.getElementById("btn-reset-hotkeys")?.addEventListener("click", () => {
      recordingHotkeyKey = null;
      document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
      state.settings.hotkeys = { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" };
      populateHotkeysUI();
      autoSaveSettings();
    });

    // 5. Page 2: Learning (Level, Correction Style, Idle Quiz Freq, Quiz Pack, Chinese Strategy, Auto Speak)
    document.querySelectorAll("[data-level]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.englishLevel = btn.dataset.level;
        document.querySelectorAll("[data-level]").forEach((b) => b.classList.toggle("active", b === btn));
        autoSaveSettings();
      });
    });

    document.querySelectorAll("[data-correction-style]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const style = btn.dataset.correctionStyle;
        state.settings.correctionStyle = style;
        document.querySelectorAll("[data-correction-style]").forEach((b) => b.classList.toggle("active", b === btn));
        const hint = document.getElementById("hint-correction-style");
        if (hint) hint.textContent = CORRECTION_HINTS[style] || CORRECTION_HINTS.gentle;
        autoSaveSettings();
      });
    });

    document.querySelectorAll("[data-activity]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.activity;
        state.settings.activityLevel = act;
        state.settings.enableIdleQuiz = act !== "off";
        document.querySelectorAll("[data-activity]").forEach((b) => b.classList.toggle("active", b === btn));
        const hint = document.getElementById("hint-activity-level");
        if (hint) hint.textContent = ACTIVITY_HINTS[act] || ACTIVITY_HINTS.normal;
        autoSaveSettings();
      });
    });

    document.getElementById("set-quiz-pack")?.addEventListener("change", (e) => {
      state.settings.quizPackId = e.target.value || "all";
      autoSaveSettings();
    });

    document.querySelectorAll("[data-zh-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.zhMode;
        state.settings.chineseSubtitleMode = mode;
        state.settings.showChineseSubtitles = mode !== "hide";
        document.querySelectorAll("[data-zh-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        const hint = document.getElementById("hint-zh-mode");
        if (hint) hint.textContent = ZH_MODE_HINTS[mode] || ZH_MODE_HINTS.always;
        autoSaveSettings();
      });
    });

    document.getElementById("set-auto-speak")?.addEventListener("change", (e) => {
      state.settings.autoSpeak = !!e.target.checked;
      autoSaveSettings();
    });

    // 6. Page 3: AI API Provider, Base URL, Key, Model & Inline Latency Test
    document.querySelectorAll("[data-api-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.apiPreset;
        state.settings.api.providerPreset = preset;
        document.querySelectorAll("[data-api-preset]").forEach((b) => b.classList.toggle("active", b === btn));
        const p = API_PRESETS[preset];
        if (p) {
          document.getElementById("set-api-url").value = p.url;
          document.getElementById("set-api-model").value = p.model;
          document.getElementById("set-whisper-model").value = p.whisper;
          state.settings.api.baseUrl = p.url;
          state.settings.api.model = p.model;
          state.settings.api.whisperModel = p.whisper;
        }
        syncApiUrlLockState(preset, false);
        autoSaveSettings();
      });
    });

    document.getElementById("btn-unlock-baseurl")?.addEventListener("click", () => {
      syncApiUrlLockState("custom", true);
      document.getElementById("set-api-url")?.focus();
    });

    document.getElementById("btn-toggle-apikey")?.addEventListener("click", () => {
      const inp = document.getElementById("set-api-key");
      if (inp) inp.type = inp.type === "password" ? "text" : "password";
    });

    const saveApiInputs = () => {
      state.settings.api = readApiForm();
      autoSaveSettings();
    };
    ["set-api-url", "set-api-key", "set-api-model", "set-whisper-model"].forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener("blur", saveApiInputs);
      el?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          el.blur();
        }
      });
    });

    document.getElementById("btn-test-api")?.addEventListener("click", async () => {
      state.settings.api = readApiForm();
      await HostBridge.rpc("saveSettings", state.settings);
      const pill = document.getElementById("api-test-pill");
      const dot = pill?.querySelector(".cv-dot");
      const st = document.getElementById("api-test-status");
      if (pill) pill.className = "api-status-pill idle";
      if (dot) dot.className = "cv-dot dot-idle";
      if (st) st.textContent = "正在测试连通性...";

      const res = await HostBridge.rpc("aiTestConnection", state.settings.api);
      if (res?.ok) {
        const latencyText = res.latencyMs != null ? `已连接 · ${res.latencyMs}ms` : "已连接";
        if (pill) pill.className = "api-status-pill ok";
        if (dot) dot.className = "cv-dot dot-ok";
        if (st) st.textContent = latencyText;
        state.lastApiStatus = { state: "ok", text: latencyText };
        flashAutoSaved("已测试并应用");
      } else {
        const errText = res?.message || "连接失败";
        if (pill) pill.className = "api-status-pill err";
        if (dot) dot.className = "cv-dot dot-err";
        if (st) st.textContent = errText;
        state.lastApiStatus = { state: "err", text: "API 连接异常" };
      }
      updateSidebarStatus();
    });

    // 7. Page 4: Voice (TTS + STT with conditional Whisper field)
    const onVoiceChanged = () => {
      voicePreviewSeq++;
      VoiceEngine.stopSpeaking();
      updateVoicePreviewButton(false);
      state.settings.voice = readVoiceForm();
      updateEdgeAccentTag();
      autoSaveSettings();
      prewarmVoicePreviews(state.settings.voice);
      prewarmBodyReactions(state.settings.voice);
    };

    document.querySelectorAll("[data-tts-provider]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.voice.ttsProvider = btn.dataset.ttsProvider;
        document.querySelectorAll("[data-tts-provider]").forEach((b) => b.classList.toggle("active", b === btn));
        updateVoiceProviderRows();
        onVoiceChanged();
      });
    });

    document.getElementById("set-edge-voice")?.addEventListener("change", onVoiceChanged);
    document.getElementById("set-openai-voice")?.addEventListener("change", onVoiceChanged);
    document.getElementById("set-webspeech-voice")?.addEventListener("change", onVoiceChanged);

    document.getElementById("set-rate")?.addEventListener("input", (e) => {
      updateRangeProgress(e.target);
      document.getElementById("lbl-rate").textContent = `${Number(e.target.value).toFixed(2)}x`;
    });
    document.getElementById("set-rate")?.addEventListener("change", onVoiceChanged);

    document.getElementById("btn-preview-voice")?.addEventListener("click", async () => {
      const st = document.getElementById("voice-preview-status");
      if (voicePreviewPlaying) {
        voicePreviewSeq++;
        VoiceEngine.stopSpeaking();
        updateVoicePreviewButton(false);
        if (st) {
          st.className = "bento-hint-strip";
          st.textContent = "已停止试听。";
        }
        return;
      }
      const reqId = ++voicePreviewSeq;
      const cfg = readVoiceForm();
      updateVoicePreviewButton(true);
      if (st) {
        st.className = "bento-hint-strip";
        st.textContent = "正在准备试听...";
      }
      if (IS_SETTINGS_VIEW) HostBridge.petAction("happy");
      else HaruPet.performAction("happy");
      const finalRes = await VoiceEngine.speak(
        PREVIEW_SAMPLE_TEXT,
        cfg,
        (res) => {
          if (reqId !== voicePreviewSeq || !st || !res || res.cancelled) return;
          if (res.provider === "edge") {
            st.className = "bento-hint-strip ok";
            st.textContent = `正在播放 Edge 神经网络音色：${res.voice}`;
          } else if (res.provider === "openai") {
            st.className = "bento-hint-strip ok";
            st.textContent = `正在播放 OpenAI TTS：${res.voice}`;
          } else if (res.fallback) {
            st.className = "bento-hint-strip err";
            st.textContent = `在线音色暂不可用，已回退本地语音 (${res.voice})`;
          } else {
            st.className = "bento-hint-strip ok";
            st.textContent = `正在播放系统本地语音：${res.voice}`;
          }
        }
      );
      if (reqId === voicePreviewSeq) {
        updateVoicePreviewButton(false);
        if (finalRes?.cancelled && st) {
          st.className = "bento-hint-strip";
          st.textContent = "点击右上角「试听」立即体验当前音色与语速。";
        }
      }
    });

    document.querySelectorAll("[data-stt-provider]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stt = btn.dataset.sttProvider;
        state.settings.voice.sttProvider = stt;
        document.querySelectorAll("[data-stt-provider]").forEach((b) => b.classList.toggle("active", b === btn));
        updateSttProviderUI();
        autoSaveSettings();
      });
    });

    // 8. Page 5: Data, Cloud Sync, Local Export/Import & Two-Step Reset
    document.getElementById("btn-open-data-dir")?.addEventListener("click", () => HostBridge.rpc("openDataFolder", {}));

    document.querySelectorAll("[data-cloud-provider]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.cloudSync.provider = btn.dataset.cloudProvider;
        document.querySelectorAll("[data-cloud-provider]").forEach((b) => b.classList.toggle("active", b === btn));
        updateCloudProviderRows();
        autoSaveSettings();
      });
    });

    const saveCloudInputs = () => {
      state.settings.cloudSync = readCloudForm();
      autoSaveSettings();
    };
    ["set-cloud-endpoint", "set-cloud-user", "set-cloud-token", "set-cloud-filename", "set-cloud-gistid"].forEach((id) => {
      document.getElementById(id)?.addEventListener("blur", saveCloudInputs);
    });
    document.getElementById("set-cloud-autosync")?.addEventListener("change", saveCloudInputs);

    document.getElementById("btn-cloud-merge")?.addEventListener("click", () => { saveCloudInputs(); runCloudSync("merge"); });
    document.getElementById("btn-cloud-push")?.addEventListener("click", () => { saveCloudInputs(); runCloudSync("push"); });
    document.getElementById("btn-cloud-pull")?.addEventListener("click", () => { saveCloudInputs(); runCloudSync("pull"); });

    document.getElementById("btn-export-backup")?.addEventListener("click", async () => {
      const st = document.getElementById("backup-status");
      const res = await HostBridge.rpc("exportBackup", {});
      if (res?.cancelled) return;
      if (st) {
        st.className = `bento-hint-strip ${res?.ok ? "ok" : "err"}`;
        st.textContent = res?.message || (res?.ok ? "导出成功" : "导出失败");
      }
    });

    document.getElementById("btn-import-backup")?.addEventListener("click", async () => {
      const st = document.getElementById("backup-status");
      const res = await HostBridge.rpc("importBackup", {});
      if (res?.cancelled) return;
      if (res?.ok) {
        if (res.weakWords) state.weakWords = res.weakWords;
        if (res.stats) state.stats = res.stats;
        if (res.knowledgePacks) state.knowledgePacks = res.knowledgePacks;
        if (res.settings) state.settings = { ...defaultSettings(), ...res.settings };
        populateSettingsForm();
        updateChatHeaderBadges();
      }
      if (st) {
        st.className = `bento-hint-strip ${res?.ok ? "ok" : "err"}`;
        st.textContent = res?.message || (res?.ok ? "导入成功" : "导入失败");
      }
    });

    document.getElementById("btn-reset-cancel")?.addEventListener("click", cancelResetConfirmation);
    document.getElementById("btn-reset-settings")?.addEventListener("click", async () => {
      const btn = document.getElementById("btn-reset-settings");
      const cancelBtn = document.getElementById("btn-reset-cancel");
      if (!resetConfirming) {
        resetConfirming = true;
        if (btn) {
          btn.classList.add("confirming");
          btn.textContent = "确认恢复出厂默认？";
        }
        cancelBtn?.classList.remove("hidden");
        clearTimeout(resetConfirmTimer);
        resetConfirmTimer = setTimeout(cancelResetConfirmation, 4500);
        return;
      }
      cancelResetConfirmation();
      const preservedPos = { petX: state.settings.petX, petY: state.settings.petY };
      state.settings = { ...defaultSettings(), ...preservedPos };
      await HostBridge.rpc("saveSettings", state.settings);
      applyAppearance(state.settings.uiTheme, state.settings.uiBorderColor);
      updateChatHeaderBadges();
      populateSettingsForm();
      prewarmBodyReactions(state.settings.voice);
      flashAutoSaved("已恢复出厂默认");
    });
  }

  function populateHotkeysUI() {
    const hk = state.settings?.hotkeys || { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" };
    const t = document.getElementById("hk-talk");
    const q = document.getElementById("hk-quiz");
    const p = document.getElementById("hk-toggle");
    if (t) t.textContent = formatHotkeyDisplay(hk.talk);
    if (q) q.textContent = formatHotkeyDisplay(hk.quiz);
    if (p) p.textContent = formatHotkeyDisplay(hk.togglePet);
  }

  function populateQuizPackDropdown() {
    const quizPackSel = document.getElementById("set-quiz-pack");
    if (!quizPackSel) return;
    const s = state.settings || {};
    quizPackSel.innerHTML = `<option value="all">混合抽查（托福 + Blender + Antigravity 全部已启用）</option><option value="weak">仅个人生词本</option>`;
    (state.knowledgePacks || []).forEach((pack) => {
      const opt = document.createElement("option");
      opt.value = pack.id;
      opt.textContent = `${pack.name}（${(pack.entries || []).length} 词）`;
      quizPackSel.appendChild(opt);
    });
    const desiredPack = s.quizPackId || "all";
    quizPackSel.value = Array.from(quizPackSel.options).some((o) => o.value === desiredPack)
      ? desiredPack
      : "all";
  }

  function updateSttProviderUI() {
    const stt = state.settings?.voice?.sttProvider || "auto";
    document.querySelectorAll("[data-stt-provider]").forEach((b) => {
      b.classList.toggle("active", b.dataset.sttProvider === stt);
    });
    const hint = document.getElementById("hint-stt-provider");
    if (hint) hint.textContent = STT_HINTS[stt] || STT_HINTS.auto;
    // Only show Whisper model input when cloud Whisper can be used (auto or whisper)
    document.getElementById("row-whisper-model")?.classList.toggle("hidden", stt === "webspeech");
  }

  function populateSettingsForm() {
    const s = state.settings;
    if (!s.hotkeys) s.hotkeys = { talk: "Alt+T", quiz: "Alt+Q", togglePet: "Alt+H" };
    cancelResetConfirmation();
    recordingHotkeyKey = null;
    document.querySelectorAll(".hotkey-cap").forEach((b) => b.classList.remove("recording"));
    updateVoicePreviewButton(false);

    applyAppearance(s.uiTheme || "light", s.uiBorderColor || "blue");
    applySettingsMaximized(!!state.settingsMaximized, true);

    const scaleEl = document.getElementById("set-scale");
    if (scaleEl) {
      scaleEl.value = s.petScale;
      updateRangeProgress(scaleEl);
    }
    const lblScale = document.getElementById("lbl-scale");
    if (lblScale) lblScale.textContent = `${Math.round(s.petScale * 100)}%`;

    const topCb = document.getElementById("set-topmost");
    if (topCb) topCb.checked = !!s.alwaysOnTop;
    document.getElementById("btn-quick-topmost")?.classList.toggle("active", !!s.alwaysOnTop);
    const lockCb = document.getElementById("set-lock");
    if (lockCb) lockCb.checked = !!s.lockPosition;
    const dndCb = document.getElementById("set-fullscreen-dnd");
    if (dndCb) dndCb.checked = s.fullscreenDnd !== false;

    syncModelPresetCards(s.modelUrl);
    const modelInput = document.getElementById("set-model-url");
    if (modelInput) modelInput.value = s.modelUrl || DEFAULT_MODEL_LOCAL;
    populateHotkeysUI();

    // Learning page
    const lvl = s.englishLevel === "C2" ? "C1" : (s.englishLevel || "B1");
    document.querySelectorAll("[data-level]").forEach((b) => {
      b.classList.toggle("active", b.dataset.level === lvl);
    });
    const corrStyle = s.correctionStyle === "strict" ? "strict" : "gentle";
    document.querySelectorAll("[data-correction-style]").forEach((b) => {
      b.classList.toggle("active", b.dataset.correctionStyle === corrStyle);
    });
    const corrHint = document.getElementById("hint-correction-style");
    if (corrHint) corrHint.textContent = CORRECTION_HINTS[corrStyle];

    const effectiveAct = !s.enableIdleQuiz ? "off" : (s.activityLevel === "super" ? "lively" : (s.activityLevel || "normal"));
    document.querySelectorAll("[data-activity]").forEach((b) => {
      b.classList.toggle("active", b.dataset.activity === effectiveAct);
    });
    const actHint = document.getElementById("hint-activity-level");
    if (actHint) actHint.textContent = ACTIVITY_HINTS[effectiveAct] || ACTIVITY_HINTS.normal;

    populateQuizPackDropdown();

    const zhMode = getChineseMode();
    document.querySelectorAll("[data-zh-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.zhMode === zhMode);
    });
    const zhHint = document.getElementById("hint-zh-mode");
    if (zhHint) zhHint.textContent = ZH_MODE_HINTS[zhMode];

    const autoSpeakCb = document.getElementById("set-auto-speak");
    if (autoSpeakCb) autoSpeakCb.checked = !!s.autoSpeak;

    // API page
    const apiPreset = s.api.providerPreset || "openai";
    document.querySelectorAll("[data-api-preset]").forEach((b) => {
      b.classList.toggle("active", b.dataset.apiPreset === apiPreset);
    });
    document.getElementById("set-api-url").value = s.api.baseUrl || "";
    document.getElementById("set-api-key").value = s.api.apiKey || "";
    document.getElementById("set-api-model").value = s.api.model || "";
    document.getElementById("set-whisper-model").value = s.api.whisperModel || "whisper-1";
    syncApiUrlLockState(apiPreset, false);

    // Voice page
    const ttsProv = s.voice.ttsProvider || "edge";
    document.querySelectorAll("[data-tts-provider]").forEach((b) => {
      b.classList.toggle("active", b.dataset.ttsProvider === ttsProv);
    });
    const edgeSel = document.getElementById("set-edge-voice");
    const desiredEdgeVoice = s.voice.edgeVoice || "en-US-AnaNeural";
    if (edgeSel) {
      edgeSel.value = Array.from(edgeSel.options).some((o) => o.value === desiredEdgeVoice)
        ? desiredEdgeVoice
        : "en-US-AnaNeural";
    }
    updateEdgeAccentTag();
    document.getElementById("set-openai-voice").value = s.voice.openAiVoice || "nova";
    document.getElementById("set-webspeech-voice").value = s.voice.webSpeechVoice || "";
    const rateEl = document.getElementById("set-rate");
    if (rateEl) {
      rateEl.value = s.voice.speechRate || 1.0;
      updateRangeProgress(rateEl);
    }
    document.getElementById("lbl-rate").textContent = `${Number(s.voice.speechRate || 1.0).toFixed(2)}x`;
    updateVoiceProviderRows();
    updateSttProviderUI();

    // Data & Cloud page
    const dataDirEl = document.getElementById("settings-data-dir");
    if (dataDirEl) {
      dataDirEl.textContent = state.dataDir || "%APPDATA%\\HaruEnglishPet";
    }
    const cloudProv = s.cloudSync.provider || "none";
    document.querySelectorAll("[data-cloud-provider]").forEach((b) => {
      b.classList.toggle("active", b.dataset.cloudProvider === cloudProv);
    });
    document.getElementById("set-cloud-endpoint").value = s.cloudSync.endpoint || "";
    document.getElementById("set-cloud-user").value = s.cloudSync.username || "";
    document.getElementById("set-cloud-token").value = s.cloudSync.tokenOrPassword || "";
    document.getElementById("set-cloud-filename").value = s.cloudSync.remoteFileName || "haru-english-pet-sync.json";
    document.getElementById("set-cloud-gistid").value = s.cloudSync.gistId || "";
    document.getElementById("set-cloud-autosync").checked = !!s.cloudSync.autoSync;
    const cloudSt = document.getElementById("cloud-sync-status");
    if (cloudSt) {
      cloudSt.className = "bento-hint-strip";
      cloudSt.textContent = s.cloudSync.lastSyncAt
        ? `上次同步：${s.cloudSync.lastSyncAt}`
        : "支持 WebDAV / GitHub 私有 Gist / 自定义 REST 同步。";
    }
    updateCloudProviderRows();
    updateSidebarStatus();
  }

  function updateVoiceProviderRows() {
    const p = state.settings?.voice?.ttsProvider || "edge";
    document.getElementById("row-edge-voice")?.classList.toggle("hidden", p !== "edge");
    document.getElementById("row-openai-voice")?.classList.toggle("hidden", p !== "openai");
    document.getElementById("row-webspeech-voice")?.classList.toggle("hidden", p !== "webspeech");
  }

  function updateCloudProviderRows() {
    const p = state.settings?.cloudSync?.provider || "none";
    document.getElementById("cloud-fields")?.classList.toggle("hidden", p === "none");
    document.getElementById("row-cloud-endpoint")?.classList.toggle("hidden", p === "gist");
    document.getElementById("row-cloud-user")?.classList.toggle("hidden", p !== "webdav");
    document.getElementById("row-cloud-gist")?.classList.toggle("hidden", p !== "gist");
    const lbl = document.getElementById("lbl-cloud-token");
    if (lbl) {
      lbl.textContent =
        p === "gist" ? "GitHub Token (gist 权限)"
        : p === "webdav" ? "WebDAV 应用密码"
        : "Bearer Token (可选)";
    }
  }

  function populateWebSpeechVoices() {
    const sel = document.getElementById("set-webspeech-voice");
    if (!sel) return;
    const voices = VoiceEngine.getWebSpeechVoices();
    sel.innerHTML = `<option value="">自动选择最佳英文女声</option>`;
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(opt);
    });
  }

  function readApiForm() {
    return {
      providerPreset: state.settings?.api?.providerPreset || "openai",
      baseUrl: (document.getElementById("set-api-url")?.value || "").trim(),
      apiKey: (document.getElementById("set-api-key")?.value || "").trim(),
      model: (document.getElementById("set-api-model")?.value || "").trim(),
      whisperModel: (document.getElementById("set-whisper-model")?.value || "").trim() || "whisper-1",
      ttsModel: state.settings?.api?.ttsModel || "tts-1",
      temperature: state.settings?.api?.temperature ?? 0.7
    };
  }

  function readVoiceForm() {
    return {
      ttsProvider: state.settings?.voice?.ttsProvider || "edge",
      edgeVoice: document.getElementById("set-edge-voice")?.value || "en-US-AnaNeural",
      openAiVoice: document.getElementById("set-openai-voice")?.value || "nova",
      webSpeechVoice: document.getElementById("set-webspeech-voice")?.value || "",
      speechRate: Number(document.getElementById("set-rate")?.value || 1.0),
      speechPitch: state.settings?.voice?.speechPitch ?? 1.0,
      sttProvider: state.settings?.voice?.sttProvider || "auto"
    };
  }

  function readCloudForm() {
    return {
      provider: state.settings?.cloudSync?.provider || "none",
      endpoint: (document.getElementById("set-cloud-endpoint")?.value || "").trim(),
      username: (document.getElementById("set-cloud-user")?.value || "").trim(),
      tokenOrPassword: (document.getElementById("set-cloud-token")?.value || "").trim(),
      remoteFileName: (document.getElementById("set-cloud-filename")?.value || "").trim() || "haru-english-pet-sync.json",
      gistId: (document.getElementById("set-cloud-gistid")?.value || "").trim(),
      autoSync: !!document.getElementById("set-cloud-autosync")?.checked,
      lastSyncAt: state.settings?.cloudSync?.lastSyncAt || ""
    };
  }

  async function runCloudSync(mode = "merge", silent = false) {
    const cfg = state.activeModal === "settings" ? readCloudForm() : state.settings.cloudSync;
    const statusEl = document.getElementById("cloud-sync-status");
    if (statusEl && !silent) {
      statusEl.className = "bento-hint-strip";
      statusEl.textContent = "正在同步云端...";
    }

    const res = await HostBridge.rpc("cloudSync", { config: cfg, mode });
    if (res && res.ok) {
      if (res.weakWords) state.weakWords = res.weakWords;
      if (res.stats) state.stats = res.stats;
      if (res.knowledgePacks) state.knowledgePacks = res.knowledgePacks;
      if (res.settings) state.settings = res.settings;
      if (res.gistId && document.getElementById("set-cloud-gistid")) {
        document.getElementById("set-cloud-gistid").value = res.gistId;
      }
      if (statusEl) {
        statusEl.className = "bento-hint-strip ok";
        statusEl.textContent = res.message;
      }
      updateSidebarStatus();
      if (!silent) showBubble("Cloud sync complete!", res.message, { badge: "Cloud Sync" });
    } else if (!silent) {
      if (statusEl) {
        statusEl.className = "bento-hint-strip err";
        statusEl.textContent = res?.message || "同步失败";
      }
      showBubble("Cloud sync failed.", res?.message || "请检查云端配置", { badge: "Cloud Error" });
    }
  }

  function maybeAutoCloudSync() {
    if (state.settings?.cloudSync?.autoSync && state.settings.cloudSync.provider !== "none") {
      runCloudSync("merge", true);
    }
  }

  // ==================== TRAY & CONTEXT MENU ====================
  function handleTrayCommand(cmd, value) {
    markUserInteraction();
    switch (cmd) {
      case "openChat": toggleFloatingPanel("chat", true); break;
      case "openTalk":
        if (state.activeModal) closeModals(true);
        setChatMode("talk");
        if (state.activePanel !== "chat") toggleFloatingPanel("chat", true);
        if (!VoiceEngine.isListening()) toggleVoiceInput();
        break;
      case "openActions": toggleFloatingPanel("actions", true); break;
      case "startQuiz": startWordQuiz(false); break;
      case "startQuizWeak": startWordQuiz(true); break;
      case "startQuizBook": startWordQuiz(value === "weak", false, value || "all"); break;
      case "openWeakWords": HostBridge.openSettings("words", "weak"); break;
      case "openKnowledge": HostBridge.openSettings("words", "knowledge"); break;
      case "openSettings": HostBridge.openSettings("overview", null); break;
      case "syncCloud": runCloudSync("merge", false); break;
      case "setScale":
        state.settings.petScale = Number(value) || 1.0;
        HaruPet.setScale(state.settings.petScale);
        setPetPosition(state.petPos.x, state.petPos.y, true);
        break;
      case "setActivity":
        state.settings.activityLevel = value || "normal";
        state.settings.enableIdleQuiz = state.settings.activityLevel !== "off";
        HaruPet.performAction("excited");
        showBubble(`Activity level set to ${state.settings.activityLevel}!`, `活跃度已调整为：${state.settings.activityLevel}`, { badge: "Activity" });
        break;
      case "setLevel":
        state.settings.englishLevel = value || "B1";
        updateChatHeaderBadges();
        HaruPet.performAction("nod");
        showBubble(`Great! I'll adapt our English to ${state.settings.englishLevel} level.`, `已切换英语水平为 ${state.settings.englishLevel}！`, { badge: "Level", speak: state.settings.autoSpeak });
        break;
      case "resetPosition":
        state.settings.petX = -1;
        state.settings.petY = -1;
        initPetPosition();
        HostBridge.rpc("saveSettings", state.settings);
        break;
    }
  }

  function setupContextMenu() {
    const menu = document.getElementById("pet-context-menu");
    menu.querySelectorAll("button[data-ctx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        hideContextMenu();
        const act = btn.dataset.ctx;
        if (act === "chat") toggleFloatingPanel("chat", true);
        else if (act === "actions") toggleFloatingPanel("actions", true);
        else if (act === "quiz") startWordQuiz(false);
        else if (act === "words") HostBridge.openSettings("words", "weak");
        else if (act === "settings") HostBridge.openSettings("overview", null);
        else if (act === "hide") HostBridge.rpc("toggleHidePet");
      });
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target)) hideContextMenu();
    });
  }

  function showContextMenu(x, y) {
    const menu = document.getElementById("pet-context-menu");
    const deskX = Math.max(8, Math.min(state.winBounds.x + x, state.workArea.width - 215));
    const deskY = Math.max(8, Math.min(state.winBounds.y + y, state.workArea.height - 235));
    state.ctxDeskPos = { x: deskX, y: deskY };
    menu.classList.remove("hidden");
    syncWindowBounds();
  }

  function hideContextMenu() {
    const menu = document.getElementById("pet-context-menu");
    const wasVisible = !!state.ctxDeskPos || (menu && !menu.classList.contains("hidden"));
    state.ctxDeskPos = null;
    if (menu) menu.classList.add("hidden");
    if (wasVisible) {
      syncWindowBounds(true);
    }
  }

  // ==================== HELPERS ====================
  function saveWeakWords() {
    HostBridge.rpc("saveWeakWords", { words: state.weakWords });
  }

  function saveStats() {
    HostBridge.rpc("saveStats", state.stats);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
