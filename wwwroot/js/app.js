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
    quiet:  { idleQuizSec: 25 * 60, idleMotionSec: 45 },
    normal: { idleQuizSec: 12 * 60, idleMotionSec: 24 },
    lively: { idleQuizSec:  5 * 60, idleMotionSec: 14 },
    super:  { idleQuizSec:  2 * 60, idleMotionSec:  8 }
  };

  const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

  let state = {
    settings: null,
    weakWords: [],
    stats: null,
    knowledgePacks: [],
    chatMode: "chat", // chat | translate
    chatHistory: [],
    activePanel: null, // chat | actions | quiz | null
    activeModal: null, // words | settings | null
    lastInteractionTime: Date.now(),
    lastActiveStudyPing: Date.now(),
    lastSpokenText: "",
    bubbleTimer: null,
    quiz: null,
    currentActionWord: null,
    petPos: { x: 0, y: 0 },
  };

  // ==================== BOOTSTRAP ====================
  async function boot() {
    const init = await HostBridge.rpc("getInitialState");
    state.settings = init.settings || defaultSettings();
    state.weakWords = init.weakWords || [];
    state.stats = init.stats || defaultStats();
    state.knowledgePacks = init.knowledgePacks || [];

    // Position pet (default bottom-right corner)
    initPetPosition();

    // Initialize Live2D Haru
    await HaruPet.init(state.settings.modelUrl, state.settings.petScale);
    HaruPet.onBodyTap((_zone, reaction) => {
      markUserInteraction();
      showBubble(reaction.en, reaction.zh, { badge: "Haru", speak: state.settings.autoSpeak });
    });

    // Global desktop eye-tracking
    HostBridge.onGlobalCursor((x, y) => HaruPet.lookAtGlobal(x, y));

    // Tray commands from C# NotifyIcon
    HostBridge.onTrayCommand(handleTrayCommand);

    // Wire UI
    setupDraggingAndClicks();
    setupSideDock();
    setupActionsPanel();
    setupChatPanel();
    setupWordsModal();
    setupSettingsModal();
    setupContextMenu();
    populateWebSpeechVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = populateWebSpeechVoices;
    }

    updateChatHeaderBadges();
    renderActionsGrid("all");
    addWelcomeChatMessage();

    // Check multi-day absence reminder on startup
    setTimeout(checkAbsenceReminder, 1400);

    // Start background study timer & proactive idle watcher
    startStudyAndIdleLoops();
    HostBridge.reportHitRects();
  }

  function defaultSettings() {
    return {
      petScale: 1.0,
      activityLevel: "normal",
      englishLevel: "B1",
      modelUrl: "models/haru/haru_greeter_t03.model3.json",
      alwaysOnTop: true,
      lockPosition: false,
      petX: -1,
      petY: -1,
      showChineseSubtitles: true,
      autoSpeak: true,
      enableIdleQuiz: true,
      enableHourlyPraise: true,
      enableAbsenceReminder: true,
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

  // ==================== POSITION & DRAGGING ====================
  function initPetPosition() {
    const petW = Math.round(310 * state.settings.petScale);
    const petH = Math.round(440 * state.settings.petScale);
    let x = state.settings.petX;
    let y = state.settings.petY;
    if (x < 0 || y < 0 || x > window.innerWidth - 80 || y > window.innerHeight - 80) {
      x = Math.max(16, window.innerWidth - petW - 76);
      y = Math.max(20, window.innerHeight - petH - 18);
    }
    setPetPosition(x, y, false);
  }

  let dockFlipHitTimer = null;

  function setPetPosition(x, y, persist = false, skipHitRects = false) {
    const petW = Math.round(310 * state.settings.petScale);
    const petH = Math.round(440 * state.settings.petScale);
    const clampedX = Math.max(8, Math.min(window.innerWidth - petW - 12, x));
    const clampedY = Math.max(10, Math.min(window.innerHeight - petH - 6, y));

    state.petPos = { x: clampedX, y: clampedY };
    const anchor = document.getElementById("pet-anchor");
    anchor.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;

    // Smart flip side dock and floating cards with wide hysteresis so slight nudges never jitter!
    if (!skipHitRects) {
      const spaceRight = window.innerWidth - (clampedX + petW);
      const spaceLeft = clampedX;

      const prevDockLeft = anchor.classList.contains("flip-left");
      let nextDockLeft = prevDockLeft;
      const returnRightThreshold = Math.min(280, Math.round(window.innerWidth * 0.25));
      if (!prevDockLeft) {
        if (spaceRight < 68) nextDockLeft = true;
      } else {
        if (spaceLeft < 68 || spaceRight > returnRightThreshold) nextDockLeft = false;
      }
      anchor.classList.toggle("flip-left", nextDockLeft);

      const prevOpenRight = anchor.classList.contains("open-right");
      let nextOpenRight = prevOpenRight;
      if (!prevOpenRight) {
        if (spaceLeft < 380 && spaceRight > spaceLeft + 80) nextOpenRight = true;
      } else {
        if (spaceRight < 380 && spaceLeft > spaceRight + 80) nextOpenRight = false;
      }
      anchor.classList.toggle("open-right", nextOpenRight);

      // Re-report hit rects once the 0.34s smooth side-dock glide completes
      if (nextDockLeft !== prevDockLeft) {
        clearTimeout(dockFlipHitTimer);
        dockFlipHitTimer = setTimeout(() => HostBridge.reportHitRects(), 380);
      }
    }

    if (persist) {
      state.settings.petX = Math.round(clampedX);
      state.settings.petY = Math.round(clampedY);
      HostBridge.rpc("saveSettings", state.settings);
    }
    if (!skipHitRects) {
      HostBridge.reportHitRects();
    }
  }

  function setupDraggingAndClicks() {
    const wrap = document.getElementById("pet-canvas-wrap");
    let pointerDown = false;
    let moved = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    function applyDragCoords(clientX, clientY) {
      if (!pointerDown || state.settings.lockPosition) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        wrap.classList.add("dragging");
      }
      if (moved) {
        // GPU translate3d with skipHitRects=true => zero layout thrash & zero IPC spam during drag!
        setPetPosition(origX + dx, origY + dy, false, true);
      }
    }

    function finishDrag(e, allowClick) {
      if (!pointerDown) return;
      const wasMoved = moved;
      pointerDown = false;
      moved = false;
      wrap.classList.remove("dragging");
      HostBridge.setDragging(false);

      if (wasMoved) {
        // Finalize flip direction, hit-rects, and persist position ONCE
        setPetPosition(state.petPos.x, state.petPos.y, true, false);
      } else if (allowClick && e) {
        HaruPet.handleCanvasClick(e.clientX, e.clientY);
      }
    }

    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.buttons & 1) !== 1) return;
      hideContextMenu();
      pointerDown = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origX = state.petPos.x;
      origY = state.petPos.y;
      if (!state.settings.lockPosition) {
        // Arm 125Hz native cursor streaming immediately on press so fast flicks never lose the pet!
        HostBridge.setDragging(true);
      }
    });

    // Listen on window (not just wrap) so fast mouse motion outside the pet box never drops events
    window.addEventListener("pointermove", (e) => {
      if (!pointerDown) return;
      if ((e.buttons & 1) !== 1) {
        finishDrag(e, false);
        return;
      }
      applyDragCoords(e.clientX, e.clientY);
    });

    // 125Hz Win32 OS hardware cursor stream fallback (keeps tracking even over taskbar / outside focus)
    HostBridge.onDragMove((x, y) => {
      if (!pointerDown) return;
      applyDragCoords(x, y);
    });

    wrap.addEventListener("pointerup", (e) => finishDrag(e, true));
    wrap.addEventListener("pointercancel", (e) => finishDrag(e, false));
    window.addEventListener("pointerup", (e) => finishDrag(e, false));
    window.addEventListener("mouseup", (e) => finishDrag(e, false));
    HostBridge.onForceEndDrag(() => finishDrag(null, false));

    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      finishDrag(null, false);
      showContextMenu(e.clientX, e.clientY);
    });
  }

  // ==================== SPEECH BUBBLE ====================
  function showBubble(en, zh = "", opts = {}) {
    const bubble = document.getElementById("speech-bubble");
    const badge = document.getElementById("bubble-badge");
    const enEl = document.getElementById("bubble-en");
    const zhEl = document.getElementById("bubble-zh");
    const extraEl = document.getElementById("bubble-extra");

    badge.textContent = opts.badge || "Haru";
    enEl.textContent = en || "";
    zhEl.textContent = (state.settings.showChineseSubtitles && zh) ? zh : "";
    zhEl.classList.toggle("hidden", !zhEl.textContent);

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
    HostBridge.reportHitRects();

    if (opts.speak && en) {
      VoiceEngine.speak(en, state.settings.voice);
    }

    clearTimeout(state.bubbleTimer);
    if (!opts.sticky) {
      state.bubbleTimer = setTimeout(hideBubble, opts.duration || 8500);
    }
  }

  function hideBubble() {
    document.getElementById("speech-bubble").classList.add("hidden");
    HostBridge.reportHitRects();
  }

  document.getElementById("bubble-close-btn").onclick = hideBubble;
  document.getElementById("bubble-speak-btn").onclick = () => {
    if (state.lastSpokenText) VoiceEngine.speak(state.lastSpokenText, state.settings.voice);
  };

  // ==================== SIDE DOCK & PANELS ====================
  function setupSideDock() {
    document.querySelectorAll(".dock-btn[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        markUserInteraction();
        const target = btn.dataset.panel;
        if (target === "words" || target === "settings") {
          toggleModal(target);
        } else {
          toggleFloatingPanel(target);
        }
      });
    });

    document.getElementById("dock-quiz-btn").addEventListener("click", () => {
      markUserInteraction();
      startWordQuiz(false);
    });

    document.getElementById("dock-mic-btn").addEventListener("click", () => {
      markUserInteraction();
      if (state.activePanel !== "chat") toggleFloatingPanel("chat", true);
      toggleVoiceInput();
    });

    document.querySelectorAll(".close-btn[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.close;
        if (t === "words" || t === "settings") closeModals();
        else closeFloatingPanels();
      });
    });
  }

  function toggleFloatingPanel(name, forceOpen = false) {
    if (!forceOpen && state.activePanel === name) {
      closeFloatingPanels();
      return;
    }
    closeFloatingPanels();
    state.activePanel = name;
    document.getElementById(`${name}-panel`)?.classList.remove("hidden");
    document.querySelectorAll(".dock-btn[data-panel]").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === name);
    });
    document.getElementById("side-dock").classList.add("active-dock");
    if (name === "chat") {
      setTimeout(() => document.getElementById("chat-input").focus(), 50);
    }
    HostBridge.reportHitRects();
  }

  function closeFloatingPanels() {
    ["chat", "actions", "quiz"].forEach((id) => {
      document.getElementById(`${id}-panel`)?.classList.add("hidden");
    });
    state.activePanel = null;
    document.querySelectorAll(".dock-btn[data-panel]").forEach((b) => {
      if (b.dataset.panel !== state.activeModal) b.classList.remove("active");
    });
    document.getElementById("side-dock").classList.remove("active-dock");
    HostBridge.reportHitRects();
  }

  function toggleModal(name, defaultTab = null) {
    if (state.activeModal === name && !defaultTab) {
      closeModals();
      return;
    }
    closeModals();
    state.activeModal = name;
    document.getElementById(`${name}-modal`)?.classList.remove("hidden");
    if (name === "words") {
      renderWeakWordsList();
      renderKnowledgePacksList();
      renderStatsDashboard();
      if (defaultTab) switchWordsTab(defaultTab);
    } else if (name === "settings") {
      populateSettingsForm();
    }
    HostBridge.reportHitRects();
  }

  function closeModals() {
    ["words", "settings"].forEach((id) => {
      document.getElementById(`${id}-modal`)?.classList.add("hidden");
    });
    state.activeModal = null;
    HostBridge.reportHitRects();
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
        state.chatMode = btn.dataset.chatMode;
        document.querySelectorAll("[data-chat-mode]").forEach((b) => b.classList.toggle("active", b.dataset.chatMode === state.chatMode));
        const input = document.getElementById("chat-input");
        input.placeholder = state.chatMode === "translate"
          ? "Paste or type English to translate & analyze..."
          : `Chat with Haru in English (${state.settings.englishLevel})...`;
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
        replyZh: state.settings.showChineseSubtitles ? (res.replyZh || "") : "",
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
      const zhDiv = document.createElement("div");
      zhDiv.className = "msg-zh";
      zhDiv.textContent = replyZh;
      div.appendChild(zhDiv);
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
      playBtn.textContent = "🔊 Speak";
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
    const dockMic = document.getElementById("dock-mic-btn");
    const bar = document.getElementById("stt-status-bar");
    const statusTxt = document.getElementById("stt-status-text");
    const input = document.getElementById("chat-input");

    if (VoiceEngine.isListening()) {
      VoiceEngine.stopListening();
      return;
    }

    VoiceEngine.startListening(state.settings, {
      onStart(msg) {
        micBtn.classList.add("recording");
        dockMic.classList.add("recording");
        bar.classList.remove("hidden");
        statusTxt.textContent = msg;
      },
      onStatus(msg) {
        statusTxt.textContent = msg;
      },
      onInterim(txt) {
        input.value = txt;
      },
      onFinal(txt) {
        input.value = txt;
        if (txt.trim()) sendChatOrTranslate();
      },
      onError(errMsg) {
        showBubble("Voice input needs a quick check!", errMsg, { badge: "STT Tip" });
      },
      onEnd() {
        micBtn.classList.remove("recording");
        dockMic.classList.remove("recording");
        bar.classList.add("hidden");
      }
    });
  }

  // ==================== PROACTIVE IDLE WORD QUIZ ====================
  function buildQuizPool(weakOnly = false) {
    const targetIdx = LEVEL_ORDER.indexOf(state.settings.englishLevel);
    const pool = [];
    const seen = new Set();

    // 1. Prioritize unmastered Weak Words
    state.weakWords
      .filter((w) => !w.mastered && w.word && w.meaning)
      .forEach((w) => {
        const key = w.word.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          pool.push({ ...w, isWeak: true, priority: 3 + (w.wrongCount || 1) });
        }
      });

    if (!weakOnly || pool.length < 4) {
      // 2. Pull entries from enabled Knowledge Packs matching user's English level
      state.knowledgePacks
        .filter((p) => p.enabled !== false)
        .forEach((pack) => {
          (pack.entries || []).forEach((e) => {
            if (!e.word || !e.meaning) return;
            const key = e.word.toLowerCase();
            if (seen.has(key)) return;
            const entryIdx = LEVEL_ORDER.indexOf(e.Level || e.level || pack.level || "B1");
            const dist = Math.abs((entryIdx >= 0 ? entryIdx : 2) - (targetIdx >= 0 ? targetIdx : 2));
            const priority = dist === 0 ? 3 : dist === 1 ? 2 : 1;
            seen.add(key);
            pool.push({
              word: e.word,
              phonetic: e.phonetic || "",
              meaning: e.meaning,
              example: e.example || "",
              level: e.level || pack.level || "B1",
              isWeak: false,
              priority
            });
          });
        });
    }

    return pool;
  }

  function startWordQuiz(weakOnly = false, isProactiveIdle = false) {
    const pool = buildQuizPool(weakOnly);
    if (pool.length < 4) {
      showBubble(
        "Let's add a few more words to your vocabulary first!",
        "词库单词不足 4 个，请先启用知识包或添加单词。",
        { badge: "Quiz" }
      );
      return;
    }

    // Weighted shuffle favoring weak words & level-matched entries
    const weighted = pool
      .map((item) => ({ item, score: Math.random() * item.priority }))
      .sort((a, b) => b.score - a.score);

    const questions = weighted.slice(0, 4).map((w) => w.item);
    state.quiz = {
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
      showBubble(
        `You've been quiet for a while! Let's do a quick ${state.settings.englishLevel} word quiz!`,
        `你待机有一会儿啦～来做一组 ${state.settings.englishLevel} 水平的单词小测验吧！`,
        { badge: "Idle Quiz", speak: state.settings.autoSpeak }
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
    prog.textContent = `Question ${q.index + 1} / ${q.questions.length} · Level ${cur.level || state.settings.englishLevel}${cur.isWeak ? " · 重点复习" : ""}`;

    // Build 3 distractors + 1 correct option
    const distractors = q.allPool
      .filter((x) => x.word.toLowerCase() !== cur.word.toLowerCase() && x.meaning !== cur.meaning)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((x) => x.meaning);

    const options = [cur.meaning, ...distractors].sort(() => Math.random() - 0.5);

    body.innerHTML = `
      <div class="quiz-word-box">
        <div class="quiz-word">${escapeHtml(cur.word)} <button id="quiz-say-btn" class="icon-mini-btn" title="Pronounce">🔊</button></div>
        <div class="quiz-phonetic">${escapeHtml(cur.phonetic || "")}</div>
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
      // Automatically add missed word to Weak Words (不熟练的英文)
      addOrUpdateWeakWord({
        word: cur.word,
        phonetic: cur.phonetic || "",
        meaning: cur.meaning,
        example: cur.example || "",
        level: cur.level || state.settings.englishLevel,
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

      // Proactive idle word quiz when idle too long
      const idleSec = (now - state.lastInteractionTime) / 1000;
      if (
        state.settings.enableIdleQuiz &&
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
    document.getElementById("chat-level-pill").textContent = state.settings.englishLevel;
    const mins = Math.floor((state.stats.todayStudySeconds || 0) / 60);
    document.getElementById("study-time-pill").textContent = mins >= 60
      ? `${(mins / 60).toFixed(1)}h`
      : `${mins}m`;
  }

  // ==================== WEAK WORDS & KNOWLEDGE BASE ====================
  function setupWordsModal() {
    document.querySelectorAll("[data-words-tab]").forEach((tab) => {
      tab.addEventListener("click", () => switchWordsTab(tab.dataset.wordsTab));
    });

    document.getElementById("weak-search").addEventListener("input", renderWeakWordsList);
    document.getElementById("weak-filter").addEventListener("change", renderWeakWordsList);
    document.getElementById("btn-quiz-weak").addEventListener("click", () => startWordQuiz(true));
    document.getElementById("btn-toggle-add-weak").addEventListener("click", () => {
      document.getElementById("add-weak-form").classList.toggle("hidden");
    });

    document.getElementById("btn-save-weak").addEventListener("click", () => {
      const word = document.getElementById("new-weak-word").value.trim();
      const meaning = document.getElementById("new-weak-meaning").value.trim();
      if (!word || !meaning) return;
      addOrUpdateWeakWord({
        word,
        phonetic: document.getElementById("new-weak-phonetic").value.trim(),
        meaning,
        example: document.getElementById("new-weak-example").value.trim(),
        level: state.settings.englishLevel,
        source: "manual"
      });
      ["new-weak-word", "new-weak-phonetic", "new-weak-meaning", "new-weak-example"].forEach((id) => {
        document.getElementById(id).value = "";
      });
      document.getElementById("add-weak-form").classList.add("hidden");
      renderWeakWordsList();
    });

    // Knowledge Pack import / create
    document.getElementById("btn-toggle-import-pack").addEventListener("click", () => {
      document.getElementById("import-pack-form").classList.toggle("hidden");
    });
    document.getElementById("btn-cancel-pack").addEventListener("click", () => {
      document.getElementById("import-pack-form").classList.add("hidden");
    });
    document.getElementById("btn-open-knowledge-dir").addEventListener("click", () => {
      HostBridge.rpc("openDataFolder", { sub: "knowledge" });
    });

    document.getElementById("pack-file-input").addEventListener("change", (ev) => {
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

    document.getElementById("btn-save-pack").addEventListener("click", saveCustomKnowledgePack);
  }

  function switchWordsTab(tabName) {
    document.querySelectorAll("[data-words-tab]").forEach((t) => t.classList.toggle("active", t.dataset.wordsTab === tabName));
    ["weak", "knowledge", "stats"].forEach((id) => {
      document.getElementById(`tab-${id}`).classList.toggle("hidden", id !== tabName);
    });
    if (tabName === "stats") renderStatsDashboard();
  }

  function addOrUpdateWeakWord(entry) {
    const key = entry.word.trim().toLowerCase();
    const existing = state.weakWords.find((w) => w.word.trim().toLowerCase() === key);
    if (existing) {
      existing.wrongCount = (existing.wrongCount || 0) + 1;
      existing.mastered = false;
      if (!existing.meaning && entry.meaning) existing.meaning = entry.meaning;
      if (!existing.phonetic && entry.phonetic) existing.phonetic = entry.phonetic;
      if (!existing.example && entry.example) existing.example = entry.example;
    } else {
      state.weakWords.unshift({
        id: Math.random().toString(36).slice(2, 10),
        word: entry.word.trim(),
        phonetic: entry.phonetic || "",
        meaning: entry.meaning || "",
        example: entry.example || "",
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

  function renderWeakWordsList() {
    const list = document.getElementById("weak-words-list");
    const q = (document.getElementById("weak-search").value || "").trim().toLowerCase();
    const filter = document.getElementById("weak-filter").value;

    const filtered = state.weakWords.filter((w) => {
      if (filter === "unmastered" && w.mastered) return false;
      if (filter === "mastered" && !w.mastered) return false;
      if (q && !w.word.toLowerCase().includes(q) && !(w.meaning || "").toLowerCase().includes(q)) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = `<div class="word-meta" style="text-align:center;padding:24px;">暂无记录。测验答错的单词、对话或翻译中点击收藏的生词都会自动出现在这里！</div>`;
      return;
    }

    list.innerHTML = "";
    filtered.forEach((w) => {
      const card = document.createElement("div");
      card.className = `word-item-card${w.mastered ? " mastered" : ""}`;
      card.innerHTML = `
        <div>
          <div class="word-main">${escapeHtml(w.word)} <span class="phonetic">${escapeHtml(w.phonetic || "")}</span></div>
          <div class="word-meta">${escapeHtml(w.meaning)} · 错 ${w.wrongCount || 0} 次 / 对 ${w.correctCount || 0} 次 · ${escapeHtml(w.level || "")}</div>
          ${w.example ? `<div class="word-meta" style="font-style:italic;">"${escapeHtml(w.example)}"</div>` : ""}
        </div>
        <div class="word-actions">
          <button class="mini-tag-btn" data-say>🔊</button>
          <button class="mini-tag-btn" data-toggle>${w.mastered ? "恢复复习" : "已掌握"}</button>
          <button class="mini-tag-btn danger" data-del>删</button>
        </div>
      `;
      card.querySelector("[data-say]").onclick = () => VoiceEngine.speak(w.word, state.settings.voice);
      card.querySelector("[data-toggle]").onclick = () => {
        w.mastered = !w.mastered;
        saveWeakWords();
        renderWeakWordsList();
      };
      card.querySelector("[data-del]").onclick = () => {
        state.weakWords = state.weakWords.filter((x) => x.id !== w.id);
        saveWeakWords();
        renderWeakWordsList();
      };
      list.appendChild(card);
    });
  }

  async function saveCustomKnowledgePack() {
    const name = document.getElementById("pack-name").value.trim();
    const level = document.getElementById("pack-level").value;
    const desc = document.getElementById("pack-desc").value.trim();
    const raw = document.getElementById("pack-bulk-text").value.trim();
    if (!name || !raw) return;

    const entries = parseBulkKnowledge(raw, level);
    if (!entries.length) {
      showBubble("Couldn't parse any words from your input!", "未解析到有效词条，请检查格式（每行：单词 | 释义 | 音标 | 例句，或 JSON 数组）。", { badge: "Import" });
      return;
    }

    const pack = {
      id: `custom-${Date.now().toString(36)}`,
      name,
      description: desc || `自定义英文知识包（${entries.length} 条）`,
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
    renderKnowledgePacksList();
    maybeAutoCloudSync();
    showBubble(`Added "${name}" with ${entries.length} English items!`, `知识包「${name}」已保存（共 ${entries.length} 条英文知识），已自动加入测验词库！`, { badge: "Knowledge+" });
  }

  function parseBulkKnowledge(raw, defaultLevel) {
    // Try JSON array or object with entries first
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed) ? parsed : (parsed.entries || []);
        return arr
          .filter((x) => x && (x.word || x.term))
          .map((x) => ({
            word: String(x.word || x.term).trim(),
            meaning: String(x.meaning || x.translation || x.zh || "").trim(),
            phonetic: String(x.phonetic || "").trim(),
            example: String(x.example || "").trim(),
            partOfSpeech: String(x.partOfSpeech || x.pos || "").trim(),
            level: x.level || defaultLevel,
            tags: Array.isArray(x.tags) ? x.tags : []
          }));
      } catch { }
    }

    // Parse line-by-line (supports | , \t separated)
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const sep = line.includes("|") ? "|" : (line.includes("\t") ? "\t" : ",");
      const parts = line.split(sep).map((p) => p.trim());
      if (parts.length >= 2 && parts[0]) {
        out.push({
          word: parts[0],
          meaning: parts[1],
          phonetic: parts[2] || "",
          example: parts[3] || "",
          partOfSpeech: "",
          level: defaultLevel,
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
          <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" ${pack.enabled !== false ? "checked" : ""} data-enable /> 参与测验
          </label>
          ${!pack.builtIn ? `<button class="mini-tag-btn danger" data-del>删除</button>` : ""}
        </div>
      `;
      card.querySelector("[data-enable]").onchange = async (ev) => {
        pack.enabled = ev.target.checked;
        await HostBridge.rpc("saveKnowledgePack", pack);
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

  // ==================== SETTINGS & CLOUD SYNC ====================
  function setupSettingsModal() {
    document.querySelectorAll("[data-set-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-set-tab]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const target = tab.dataset.setTab;
        ["general", "api", "voice", "cloud"].forEach((id) => {
          document.getElementById(`set-tab-${id}`).classList.toggle("hidden", id !== target);
        });
      });
    });

    document.getElementById("set-scale").addEventListener("input", (e) => {
      document.getElementById("lbl-scale").textContent = `${Math.round(Number(e.target.value) * 100)}%`;
      HaruPet.setScale(Number(e.target.value));
    });
    document.getElementById("set-rate").addEventListener("input", (e) => {
      document.getElementById("lbl-rate").textContent = `${Number(e.target.value).toFixed(2)}x`;
    });
    document.getElementById("set-pitch").addEventListener("input", (e) => {
      document.getElementById("lbl-pitch").textContent = `${Number(e.target.value).toFixed(2)}`;
    });

    document.getElementById("set-api-preset").addEventListener("change", (e) => {
      const p = API_PRESETS[e.target.value];
      if (p) {
        document.getElementById("set-api-url").value = p.url;
        document.getElementById("set-api-model").value = p.model;
        document.getElementById("set-whisper-model").value = p.whisper;
      }
    });

    document.getElementById("set-tts-provider").addEventListener("change", updateVoiceProviderRows);
    document.getElementById("set-cloud-provider").addEventListener("change", updateCloudProviderRows);

    document.getElementById("btn-test-api").addEventListener("click", async () => {
      const st = document.getElementById("api-test-status");
      st.className = "status-text";
      st.textContent = "Testing connection...";
      const res = await HostBridge.rpc("aiTestConnection", readApiForm());
      st.className = `status-text ${res.ok ? "ok" : "err"}`;
      st.textContent = res.message || (res.ok ? "OK" : "Failed");
    });

    document.getElementById("btn-preview-voice").addEventListener("click", async () => {
      const st = document.getElementById("voice-preview-status");
      const cfg = readVoiceForm();
      if (st) {
        st.className = "status-text";
        st.textContent = "正在合成语音...";
      }
      HaruPet.performAction("happy");
      await VoiceEngine.speak(
        "Hello! I am Haru, your English learning desktop pet. Let's practice together!",
        cfg,
        (res) => {
          if (!st || !res) return;
          if (res.provider === "edge") {
            st.className = "status-text ok";
            st.textContent = `正在播放 Edge 神经网络音色：${res.voice}`;
          } else if (res.provider === "openai") {
            st.className = "status-text ok";
            st.textContent = `正在播放 OpenAI TTS：${res.voice}`;
          } else if (res.fallback) {
            st.className = "status-text err";
            st.textContent = `在线音色暂不可用，已回退本地语音 (${res.voice})`;
          } else {
            st.className = "status-text ok";
            st.textContent = `正在播放系统本地语音：${res.voice}`;
          }
        }
      );
    });

    document.getElementById("btn-cloud-merge").addEventListener("click", () => runCloudSync("merge"));
    document.getElementById("btn-cloud-push").addEventListener("click", () => runCloudSync("push"));
    document.getElementById("btn-cloud-pull").addEventListener("click", () => runCloudSync("pull"));

    document.getElementById("btn-open-data-dir").addEventListener("click", () => HostBridge.rpc("openDataFolder", {}));
    document.getElementById("btn-save-settings").addEventListener("click", saveSettingsFromForm);
  }

  function populateSettingsForm() {
    const s = state.settings;
    document.getElementById("set-scale").value = s.petScale;
    document.getElementById("lbl-scale").textContent = `${Math.round(s.petScale * 100)}%`;
    document.getElementById("set-activity").value = s.activityLevel;
    document.getElementById("set-level").value = s.englishLevel;
    document.getElementById("set-topmost").checked = s.alwaysOnTop;
    document.getElementById("set-lock").checked = s.lockPosition;
    document.getElementById("set-zh-sub").checked = s.showChineseSubtitles;
    document.getElementById("set-auto-speak").checked = s.autoSpeak;
    document.getElementById("set-idle-quiz").checked = s.enableIdleQuiz;
    document.getElementById("set-hourly-praise").checked = s.enableHourlyPraise;
    document.getElementById("set-absence-remind").checked = s.enableAbsenceReminder;
    document.getElementById("set-model-url").value = s.modelUrl;

    document.getElementById("set-api-preset").value = s.api.providerPreset || "openai";
    document.getElementById("set-api-url").value = s.api.baseUrl || "";
    document.getElementById("set-api-key").value = s.api.apiKey || "";
    document.getElementById("set-api-model").value = s.api.model || "";
    document.getElementById("set-whisper-model").value = s.api.whisperModel || "whisper-1";

    document.getElementById("set-tts-provider").value = s.voice.ttsProvider || "edge";
    const edgeSel = document.getElementById("set-edge-voice");
    const desiredEdgeVoice = s.voice.edgeVoice || "en-US-AnaNeural";
    edgeSel.value = Array.from(edgeSel.options).some((o) => o.value === desiredEdgeVoice)
      ? desiredEdgeVoice
      : "en-US-AnaNeural";
    document.getElementById("set-openai-voice").value = s.voice.openAiVoice || "nova";
    document.getElementById("set-webspeech-voice").value = s.voice.webSpeechVoice || "";
    document.getElementById("set-rate").value = s.voice.speechRate || 1.0;
    document.getElementById("lbl-rate").textContent = `${Number(s.voice.speechRate || 1.0).toFixed(2)}x`;
    document.getElementById("set-pitch").value = s.voice.speechPitch || 1.0;
    document.getElementById("lbl-pitch").textContent = `${Number(s.voice.speechPitch || 1.0).toFixed(2)}`;
    document.getElementById("set-stt-provider").value = s.voice.sttProvider || "auto";

    document.getElementById("set-cloud-provider").value = s.cloudSync.provider || "none";
    document.getElementById("set-cloud-endpoint").value = s.cloudSync.endpoint || "";
    document.getElementById("set-cloud-user").value = s.cloudSync.username || "";
    document.getElementById("set-cloud-token").value = s.cloudSync.tokenOrPassword || "";
    document.getElementById("set-cloud-filename").value = s.cloudSync.remoteFileName || "haru-english-pet-sync.json";
    document.getElementById("set-cloud-gistid").value = s.cloudSync.gistId || "";
    document.getElementById("set-cloud-autosync").checked = !!s.cloudSync.autoSync;
    document.getElementById("cloud-sync-status").textContent = s.cloudSync.lastSyncAt
      ? `上次同步：${s.cloudSync.lastSyncAt}`
      : "";

    updateVoiceProviderRows();
    updateCloudProviderRows();
  }

  function updateVoiceProviderRows() {
    const p = document.getElementById("set-tts-provider").value;
    document.getElementById("row-edge-voice").classList.toggle("hidden", p !== "edge");
    document.getElementById("row-openai-voice").classList.toggle("hidden", p !== "openai");
    document.getElementById("row-webspeech-voice").classList.toggle("hidden", p !== "webspeech");
  }

  function updateCloudProviderRows() {
    const p = document.getElementById("set-cloud-provider").value;
    document.getElementById("cloud-fields").classList.toggle("hidden", p === "none");
    document.getElementById("row-cloud-endpoint").classList.toggle("hidden", p === "gist");
    document.getElementById("row-cloud-user").classList.toggle("hidden", p !== "webdav");
    document.getElementById("row-cloud-gist").classList.toggle("hidden", p !== "gist");
    document.getElementById("lbl-cloud-token").textContent =
      p === "gist" ? "GitHub Personal Access Token (gist 权限)"
      : p === "webdav" ? "WebDAV 应用密码"
      : "Bearer Token (可选)";
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
      providerPreset: document.getElementById("set-api-preset").value,
      baseUrl: document.getElementById("set-api-url").value.trim(),
      apiKey: document.getElementById("set-api-key").value.trim(),
      model: document.getElementById("set-api-model").value.trim(),
      whisperModel: document.getElementById("set-whisper-model").value.trim() || "whisper-1",
      ttsModel: state.settings.api.ttsModel || "tts-1",
      temperature: 0.7
    };
  }

  function readVoiceForm() {
    return {
      ttsProvider: document.getElementById("set-tts-provider").value,
      edgeVoice: document.getElementById("set-edge-voice").value,
      openAiVoice: document.getElementById("set-openai-voice").value,
      webSpeechVoice: document.getElementById("set-webspeech-voice").value,
      speechRate: Number(document.getElementById("set-rate").value),
      speechPitch: Number(document.getElementById("set-pitch").value),
      sttProvider: document.getElementById("set-stt-provider").value
    };
  }

  function readCloudForm() {
    return {
      provider: document.getElementById("set-cloud-provider").value,
      endpoint: document.getElementById("set-cloud-endpoint").value.trim(),
      username: document.getElementById("set-cloud-user").value.trim(),
      tokenOrPassword: document.getElementById("set-cloud-token").value.trim(),
      remoteFileName: document.getElementById("set-cloud-filename").value.trim() || "haru-english-pet-sync.json",
      gistId: document.getElementById("set-cloud-gistid").value.trim(),
      autoSync: document.getElementById("set-cloud-autosync").checked,
      lastSyncAt: state.settings.cloudSync.lastSyncAt || ""
    };
  }

  async function saveSettingsFromForm() {
    const prevModelUrl = state.settings.modelUrl;
    state.settings = {
      ...state.settings,
      petScale: Number(document.getElementById("set-scale").value),
      activityLevel: document.getElementById("set-activity").value,
      englishLevel: document.getElementById("set-level").value,
      alwaysOnTop: document.getElementById("set-topmost").checked,
      lockPosition: document.getElementById("set-lock").checked,
      showChineseSubtitles: document.getElementById("set-zh-sub").checked,
      autoSpeak: document.getElementById("set-auto-speak").checked,
      enableIdleQuiz: document.getElementById("set-idle-quiz").checked,
      enableHourlyPraise: document.getElementById("set-hourly-praise").checked,
      enableAbsenceReminder: document.getElementById("set-absence-remind").checked,
      modelUrl: document.getElementById("set-model-url").value.trim() || prevModelUrl,
      api: readApiForm(),
      voice: readVoiceForm(),
      cloudSync: readCloudForm()
    };

    await HostBridge.rpc("saveSettings", state.settings);
    HaruPet.setScale(state.settings.petScale);
    if (state.settings.modelUrl !== prevModelUrl) {
      await HaruPet.loadModel(state.settings.modelUrl);
    }
    updateChatHeaderBadges();
    closeModals();
    HaruPet.performAction("nod");
    showBubble("Settings saved! Ready to learn!", "设置已保存并立即生效！", { badge: "Settings" });
  }

  async function runCloudSync(mode = "merge", silent = false) {
    const cfg = state.activeModal === "settings" ? readCloudForm() : state.settings.cloudSync;
    const statusEl = document.getElementById("cloud-sync-status");
    if (statusEl && !silent) {
      statusEl.className = "status-text";
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
        statusEl.className = "status-text ok";
        statusEl.textContent = res.message;
      }
      if (!silent) showBubble("Cloud sync complete!", res.message, { badge: "☁️ Cloud Sync" });
    } else if (!silent) {
      if (statusEl) {
        statusEl.className = "status-text err";
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
      case "openActions": toggleFloatingPanel("actions", true); break;
      case "startQuiz": startWordQuiz(false); break;
      case "openWeakWords": toggleModal("words", "weak"); break;
      case "openKnowledge": toggleModal("words", "knowledge"); break;
      case "openSettings": toggleModal("settings"); break;
      case "syncCloud": runCloudSync("merge", false); break;
      case "setScale":
        state.settings.petScale = Number(value) || 1.0;
        HaruPet.setScale(state.settings.petScale);
        setPetPosition(state.petPos.x, state.petPos.y, true);
        break;
      case "setActivity":
        state.settings.activityLevel = value || "normal";
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
        else if (act === "words") toggleModal("words", "weak");
        else if (act === "settings") toggleModal("settings");
        else if (act === "hide") HostBridge.rpc("toggleHidePet");
      });
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target)) hideContextMenu();
    });
  }

  function showContextMenu(x, y) {
    const menu = document.getElementById("pet-context-menu");
    menu.style.left = `${Math.min(x, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 230)}px`;
    menu.classList.remove("hidden");
    HostBridge.reportHitRects();
  }

  function hideContextMenu() {
    document.getElementById("pet-context-menu").classList.add("hidden");
    HostBridge.reportHitRects();
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
