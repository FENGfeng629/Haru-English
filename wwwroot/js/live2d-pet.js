// Live2D Haru Renderer, English Actions/Expressions Catalog, Hit-Area Interaction & Lip-Sync
window.HaruPet = (() => {
  // Exact 16 English Expressions & Motions mapped to Haru's real model3 expressions (f00-f07), motions (Idle/Tap), & smooth procedural choreography
  const ACTIONS_CATALOG = [
    // --- Expressions (haru_greeter_t03.model3.json f00-f07) ---
    {
      id: "happy",
      word: "Happy",
      emoji: "😊",
      phonetic: "/ˈhæpi/",
      type: "expression",
      meaning: "开心的，快乐的",
      example: "I'm so happy to practice English with you today!",
      expression: "f04",
      motion: { group: "Tap", index: 1 },
      choreo: "bounce",
      sparkle: "✨"
    },
    {
      id: "shy",
      word: "Shy",
      emoji: "😳",
      phonetic: "/ʃaɪ/",
      type: "expression",
      meaning: "害羞的，腼腆的",
      example: "Oh! You're making me feel a little shy!",
      expression: "f06",
      choreo: "shyTilt",
      sparkle: "💕"
    },
    {
      id: "surprised",
      word: "Surprised",
      emoji: "😮",
      phonetic: "/sərˈpraɪzd/",
      type: "expression",
      meaning: "惊讶的，吃惊的",
      example: "Whoa! That really surprised me!",
      expression: "f05",
      choreo: "startle",
      sparkle: "❗"
    },
    {
      id: "excited",
      word: "Excited",
      emoji: "🤩",
      phonetic: "/ɪkˈsaɪtɪd/",
      type: "expression",
      meaning: "兴奋的，激动的",
      example: "Yay! I'm super excited to learn new English words!",
      expression: "f01",
      motion: { group: "Tap", index: 0 },
      choreo: "bounce",
      sparkle: "🌟"
    },
    {
      id: "angry",
      word: "Angry",
      emoji: "😠",
      phonetic: "/ˈæŋɡri/",
      type: "expression",
      meaning: "生气的，愤怒的",
      example: "Hey! Don't get angry—just take a deep breath!",
      expression: "f02",
      choreo: "shake",
      sparkle: "💢"
    },
    {
      id: "sad",
      word: "Sad",
      emoji: "😢",
      phonetic: "/sæd/",
      type: "expression",
      meaning: "难过的，伤心的",
      example: "Aww, I feel a little sad when we don't chat.",
      expression: "f03",
      choreo: "droop",
      sparkle: "💧"
    },
    {
      id: "pouting",
      word: "Pouting",
      emoji: "😤",
      phonetic: "/ˈpaʊtɪŋ/",
      type: "expression",
      meaning: "嘟嘴生闷气的，娇嗔的",
      example: "Hmph! I'm pouting because you forgot our word review!",
      expression: "f07",
      choreo: "poutTurn",
      sparkle: "💨"
    },
    {
      id: "friendly",
      word: "Friendly",
      emoji: "🥰",
      phonetic: "/ˈfrendli/",
      type: "expression",
      meaning: "友好的，亲切的",
      example: "Hello there! It's always wonderful to see a friendly face.",
      expression: "f00",
      motion: { group: "Idle", index: 1 },
      choreo: "sway",
      sparkle: "🌸"
    },
    // --- Physical Motions & Gestures ---
    {
      id: "nod",
      word: "Nod",
      emoji: "👍",
      phonetic: "/nɑːd/",
      type: "motion",
      meaning: "点头（表示同意或认可）",
      example: "Yes, exactly! I nod in agreement—great job!",
      expression: "f04",
      choreo: "nod",
      sparkle: "✅"
    },
    {
      id: "shake",
      word: "Shake",
      emoji: "🙅‍♀️",
      phonetic: "/ʃeɪk/",
      type: "motion",
      meaning: "摇头（表示否定或没关系）",
      example: "No worries! Don't give up—let's try one more time!",
      expression: "f07",
      choreo: "shake",
      sparkle: "💫"
    },
    {
      id: "wink",
      word: "Wink",
      emoji: "😉",
      phonetic: "/wɪŋk/",
      type: "motion",
      meaning: "眨眼（俏皮或鼓励地眨一只眼）",
      example: "Here's a cheerful wink for good luck today!",
      expression: "f00",
      choreo: "wink",
      sparkle: "⭐"
    },
    {
      id: "wave",
      word: "Wave",
      emoji: "👋",
      phonetic: "/weɪv/",
      type: "motion",
      meaning: "挥手打招呼",
      example: "Hi there! Wave hello whenever you start practicing!",
      expression: "f04",
      motion: { group: "Tap", index: 0 },
      choreo: "sway",
      sparkle: "👋"
    },
    {
      id: "bow",
      word: "Bow",
      emoji: "🙇‍♀️",
      phonetic: "/baʊ/",
      type: "motion",
      meaning: "鞠躬致意",
      example: "Thank you very much! That's a polite bow.",
      expression: "f00",
      choreo: "bow",
      sparkle: "🎀"
    },
    {
      id: "confused",
      word: "Confused",
      emoji: "🤔",
      phonetic: "/kənˈfjuːzd/",
      type: "motion",
      meaning: "困惑的，歪头思考的",
      example: "Hmm, I'm a bit confused. Could you explain that again?",
      expression: "f07",
      choreo: "tiltThink",
      sparkle: "❓"
    },
    {
      id: "cheer",
      word: "Cheer",
      emoji: "🎉",
      phonetic: "/tʃɪr/",
      type: "motion",
      meaning: "欢呼，加油打气",
      example: "Hooray! Keep up the amazing English practice!",
      expression: "f04",
      motion: { group: "Tap", index: 1 },
      choreo: "cheer",
      sparkle: "🎉"
    },
    {
      id: "sleepy",
      word: "Sleepy",
      emoji: "😴",
      phonetic: "/ˈsliːpi/",
      type: "motion",
      meaning: "困倦的，打瞌睡的",
      example: "Yawn... I'm feeling a little sleepy. Let's wake up with a word!",
      expression: "f03",
      choreo: "sleepy",
      sparkle: "💤"
    }
  ];

  // Body part click reactions
  const BODY_REACTIONS = {
    headTop: [
      { action: "shy", en: "Hehe, thanks for the head pat! That feels so comforting.", zh: "嘿嘿，谢谢摸头！感觉好温暖呀～" },
      { action: "happy", en: "Pat my head anytime! Ready to learn a new English word?", zh: "随时都可以摸摸头哦！准备好学一个新单词了吗？" }
    ],
    face: [
      { action: "surprised", en: "Hey! You poked my cheek! Want to learn the word 'cheek'?", zh: "呀！你戳了我的脸颊！记住单词 cheek（脸颊）哦！" },
      { action: "wink", en: "Boo! Did you tap my face to say hello?", zh: "哇！你点我的脸是在跟我打招呼吗？" }
    ],
    bodyUpper: [
      { action: "wave", en: "Hey there! Tap my shoulder whenever you want to chat in English!", zh: "嗨！想练英语口语时随时拍拍我的肩膀哦！" },
      { action: "excited", en: "I'm all ears! Let's practice speaking English together!", zh: "我洗耳恭听！一起来练英语对话吧！" }
    ],
    bodyLower: [
      { action: "pouting", en: "Hey, that tickles! Let's stay focused on our English study!", zh: "喂，好痒呀！专心跟我学英语啦！" },
      { action: "shy", en: "Oh my! Mind my dress—how about a quick word quiz instead?", zh: "哎呀！别扯裙子啦，不如来做个单词小测验吧？" }
    ]
  };

  let app = null;
  let model = null;
  let baseWidth = 310;
  let baseHeight = 440;
  let currentScale = 1.0;
  let lipSyncTarget = 0;
  let lipSyncCurrent = 0;
  let activeChoreo = null; // { kind, startTime, duration }
  let onBodyTapCallback = null;
  let currentModelUrl = "";

  async function init(modelUrl, scale = 1.0) {
    currentScale = scale;
    const canvas = document.getElementById("live2d-canvas");

    // Disable built-in Japanese audio from motion3.json so only English speaks
    if (window.PIXI && PIXI.live2d) {
      if (PIXI.live2d.SoundManager) PIXI.live2d.SoundManager.volume = 0;
      if (PIXI.live2d.Live2DModel && PIXI.live2d.Live2DModel.registerTicker) {
        PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);
      }
    }

    const w = Math.round(baseWidth * currentScale);
    const h = Math.round(baseHeight * currentScale);

    if (!app) {
      app = new PIXI.Application({
        view: canvas,
        width: w,
        height: h,
        transparent: true,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      app.ticker.add(onFrameTick);
    } else {
      app.renderer.resize(w, h);
    }

    await loadModel(modelUrl);
  }

  const LOCAL_HARU_URL = "models/haru/haru_greeter_t03.model3.json";
  const REMOTE_HARU_URL = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json";

  async function loadModel(modelUrl) {
    const loaderEl = document.getElementById("pet-loading");
    loaderEl.classList.remove("hidden");
    loaderEl.querySelector("span").textContent = "Loading Haru...";

    // Prefer bundled local Haru if user has default CDN URL or empty URL
    let primaryUrl = (modelUrl || "").trim();
    if (!primaryUrl || primaryUrl === REMOTE_HARU_URL) {
      primaryUrl = LOCAL_HARU_URL;
    }

    const candidates = primaryUrl === LOCAL_HARU_URL
      ? [LOCAL_HARU_URL, REMOTE_HARU_URL]
      : [primaryUrl, LOCAL_HARU_URL];

    let lastErr = null;
    for (const candidate of candidates) {
      try {
        if (model) {
          app.stage.removeChild(model);
          model.destroy();
          model = null;
        }

        HostBridge.log(`Loading Live2D model from: ${candidate}`);
        currentModelUrl = candidate;
        model = await PIXI.live2d.Live2DModel.from(candidate, {
          autoInteract: false,
        });

        app.stage.addChild(model);
        layoutModel();
        loaderEl.classList.add("hidden");
        HostBridge.log(`Live2D loaded OK! internal=${model.internalModel.originalWidth}x${model.internalModel.originalHeight} scale=${model.scale.x.toFixed(3)}`);

        // Friendly welcome animation
        setTimeout(() => performAction("wave"), 400);
        HostBridge.reportHitRects();
        return;
      } catch (err) {
        lastErr = err;
        HostBridge.log(`Live2D candidate failed (${candidate}): ${err?.message || err}`);
        console.error("Live2D load error:", candidate, err);
      }
    }

    loaderEl.querySelector("span").textContent = `Live2D load failed: ${lastErr?.message || "unknown error"}`;
  }

  function layoutModel() {
    if (!app || !model) return;
    const w = Math.round(baseWidth * currentScale);
    const h = Math.round(baseHeight * currentScale);
    app.renderer.resize(w, h);

    const wrap = document.getElementById("pet-canvas-wrap");
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;

    // Fit Haru nicely inside canvas with headroom for hair/bounce
    const internalW = model.internalModel.originalWidth || 1000;
    const internalH = model.internalModel.originalHeight || 1400;
    const fitScale = Math.min((w * 0.98) / internalW, (h * 0.98) / internalH);
    model.scale.set(fitScale);
    model.anchor.set(0.5, 0.5);
    model.x = w * 0.5;
    model.y = h * 0.52;
  }

  function setScale(scale) {
    currentScale = Math.max(0.55, Math.min(1.85, Number(scale) || 1.0));
    layoutModel();
    HostBridge.reportHitRects();
  }

  function lookAtGlobal(globalX, globalY) {
    if (!model) return;
    const canvas = document.getElementById("live2d-canvas");
    const rect = canvas.getBoundingClientRect();
    const localX = globalX - rect.left;
    const localY = globalY - rect.top;
    // Focus smoothly within a soft radius around Haru
    model.focus(localX, localY);
  }

  function setLipSync(level) {
    lipSyncTarget = Math.max(0, Math.min(1, level));
  }

  function spawnSparkle(emoji = "✨") {
    const layer = document.getElementById("pet-sparkle-layer");
    if (!layer) return;
    const el = document.createElement("div");
    el.className = "sparkle-float";
    el.textContent = emoji;
    el.style.left = `${35 + Math.random() * 35}%`;
    el.style.top = `${16 + Math.random() * 25}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1350);
  }

  function performAction(actionId) {
    const item = ACTIONS_CATALOG.find((a) => a.id === actionId) || ACTIONS_CATALOG[0];
    if (!item || !model) return item;

    try {
      if (item.expression) {
        model.expression(item.expression);
      }
      if (item.motion) {
        model.motion(item.motion.group, item.motion.index, 3);
      }
    } catch (e) {
      console.warn("Motion/expression warning:", e);
    }

    if (item.choreo) {
      activeChoreo = {
        kind: item.choreo,
        startTime: performance.now(),
        duration: item.choreo === "sleepy" ? 2600 : 1650,
      };
    }

    if (item.sparkle) spawnSparkle(item.sparkle);
    return item;
  }

  function playIdleAction() {
    if (!model) return;
    const idleIdx = Math.floor(Math.random() * 3);
    try {
      model.motion("Idle", idleIdx, 1);
    } catch { }
  }

  // Handle clicks on Haru's body & head zones
  function handleCanvasClick(clientX, clientY) {
    if (!model) return;
    const canvas = document.getElementById("live2d-canvas");
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const normX = localX / rect.width;
    const normY = localY / rect.height;

    // Ignore clicks far outside Haru's silhouette margins
    if (normX < 0.14 || normX > 0.86 || normY < 0.04 || normY > 0.98) return;

    let hitAreas = [];
    try {
      hitAreas = model.hitTest(localX, localY) || [];
    } catch { }

    let zone = "bodyUpper";
    if (hitAreas.includes("Head") || normY < 0.34) {
      zone = normY < 0.21 ? "headTop" : "face";
    } else if (hitAreas.includes("Body") || normY >= 0.34) {
      zone = normY < 0.64 ? "bodyUpper" : "bodyLower";
    }

    const pool = BODY_REACTIONS[zone] || BODY_REACTIONS.bodyUpper;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    performAction(chosen.action);

    if (onBodyTapCallback) {
      onBodyTapCallback(zone, chosen);
    }
  }

  // Per-frame Lip-Sync + Procedural Live2D Choreographies
  function onFrameTick() {
    if (!model || !model.internalModel || !model.internalModel.coreModel) return;
    const core = model.internalModel.coreModel;

    // Smooth Lip-Sync
    lipSyncCurrent += (lipSyncTarget - lipSyncCurrent) * 0.35;
    if (lipSyncCurrent > 0.015) {
      try {
        core.setParameterValueById("ParamMouthOpenY", Math.min(1, lipSyncCurrent));
      } catch { }
    }

    // Smooth Procedural Choreography overlays (Nod, Shake, Wink, Bow, Bounce, Shy, Sleepy...)
    if (activeChoreo) {
      const now = performance.now();
      const elapsed = now - activeChoreo.startTime;
      const t = Math.min(1, elapsed / activeChoreo.duration);
      const env = Math.sin(t * Math.PI); // Smooth ease-in / ease-out envelope

      const setP = (id, val) => {
        try { core.setParameterValueById(id, val); } catch { }
      };

      switch (activeChoreo.kind) {
        case "nod":
          setP("ParamAngleY", -22 * Math.abs(Math.sin(t * Math.PI * 2)) * env);
          break;
        case "shake":
          setP("ParamAngleX", 26 * Math.sin(t * Math.PI * 3.5) * env);
          break;
        case "wink":
          setP("ParamEyeROpen", Math.max(0, 1 - env * 1.4));
          setP("ParamEyeLSmile", 0.8 * env);
          setP("ParamAngleZ", 12 * env);
          break;
        case "bow":
          setP("ParamAngleY", -28 * env);
          setP("ParamBodyAngleZ", -5 * env);
          break;
        case "bounce":
          setP("ParamAngleZ", 10 * Math.sin(t * Math.PI * 2) * env);
          setP("ParamBodyAngleZ", 6 * Math.sin(t * Math.PI * 2) * env);
          break;
        case "cheer":
          setP("ParamAngleY", 14 * Math.sin(t * Math.PI * 3) * env);
          setP("ParamAngleZ", 14 * Math.sin(t * Math.PI * 2) * env);
          setP("ParamBodyAngleZ", 8 * Math.sin(t * Math.PI * 2) * env);
          break;
        case "shyTilt":
          setP("ParamTere", 1.0 * env);
          setP("ParamAngleZ", -16 * env);
          setP("ParamAngleY", -8 * env);
          break;
        case "startle":
          setP("ParamAngleY", 16 * env);
          setP("ParamBodyAngleX", -6 * env);
          break;
        case "droop":
          setP("ParamAngleY", -16 * env);
          setP("ParamAngleZ", -8 * env);
          break;
        case "poutTurn":
          setP("ParamAngleX", -22 * env);
          setP("ParamAngleZ", 8 * env);
          break;
        case "tiltThink":
          setP("ParamAngleZ", 24 * env);
          setP("ParamAngleX", 10 * env);
          break;
        case "sway":
          setP("ParamBodyAngleZ", 7 * Math.sin(t * Math.PI * 2) * env);
          setP("ParamAngleZ", 8 * Math.sin(t * Math.PI * 2) * env);
          break;
        case "sleepy":
          setP("ParamEyeLOpen", Math.max(0.15, 1 - env * 0.85));
          setP("ParamEyeROpen", Math.max(0.15, 1 - env * 0.85));
          setP("ParamAngleY", -14 * env);
          setP("ParamAngleZ", 12 * Math.sin(t * Math.PI) * env);
          break;
      }

      if (t >= 1) {
        activeChoreo = null;
      }
    }
  }

  return {
    ACTIONS_CATALOG,
    init,
    loadModel,
    setScale,
    lookAtGlobal,
    setLipSync,
    performAction,
    playIdleAction,
    handleCanvasClick,
    spawnSparkle,
    getModelUrl: () => currentModelUrl,
    onBodyTap(fn) { onBodyTapCallback = fn; },
  };
})();
