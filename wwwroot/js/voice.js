// Multi-Timbre English TTS (Edge Neural / OpenAI / WebSpeech + Live Lip-Sync) & STT (Whisper + WebSpeech)
window.VoiceEngine = (() => {
  let audioCtx = null;
  let currentAudio = null;
  let currentAudioCancel = null;
  let lipSyncRaf = null;
  let fakeLipTimer = null;
  let speakSeq = 0;

  // STT state
  let isListening = false;
  let activeRecognition = null;
  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let activeSttCallbacks = null;

  function ensureAudioContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function clearAudioPlaybackOnly() {
    if (currentAudioCancel) {
      const fn = currentAudioCancel;
      currentAudioCancel = null;
      try { fn(); } catch { }
    }
    if (currentAudio) {
      try {
        currentAudio.onplay = null;
        currentAudio.onended = null;
        currentAudio.onerror = null;
        currentAudio.pause();
        currentAudio.src = "";
      } catch { }
      currentAudio = null;
    }
    if (lipSyncRaf) {
      cancelAnimationFrame(lipSyncRaf);
      lipSyncRaf = null;
    }
    if (fakeLipTimer) {
      clearInterval(fakeLipTimer);
      fakeLipTimer = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    HaruPet.setLipSync(0);
  }

  function stopSpeaking(notifyHost = true) {
    // Bump generation so any in-flight TTS synthesis RPC or stale audio callback is discarded
    speakSeq++;
    if (notifyHost && window.HostBridge && typeof HostBridge.cancelTts === "function") {
      HostBridge.cancelTts();
    }
    clearAudioPlaybackOnly();
  }

  async function speak(text, voiceConfig, onStart) {
    const clean = (text || "").replace(/[*_`#]/g, "").trim();
    if (!clean) return { ok: false, provider: "none" };

    // Immediately stop any active speech and cancel any in-flight synthesis request
    stopSpeaking(true);
    const mySeq = speakSeq;

    const cfg = voiceConfig || {
      ttsProvider: "edge",
      edgeVoice: "en-US-AnaNeural",
      openAiVoice: "nova",
      webSpeechVoice: "",
      speechRate: 1.0,
      speechPitch: 1.0,
    };

    let fallbackError = "";
    if (cfg.ttsProvider !== "webspeech") {
      try {
        const res = await HostBridge.rpc("ttsSynthesize", { text: clean, voice: cfg });
        // Drop stale or superseded synthesis result immediately
        if (mySeq !== speakSeq || (res && res.cancelled)) {
          return { ok: false, cancelled: true };
        }
        if (res && res.ok && res.audioBase64) {
          const info = { ok: true, provider: res.provider || cfg.ttsProvider, voice: res.voice || cfg.edgeVoice };
          if (typeof onStart === "function") onStart(info);
          await playBase64AudioWithLipSync(res.audioBase64, res.mimeType || "audio/mpeg", mySeq);
          return info;
        }
        fallbackError = (res && res.error) ? res.error : "";
      } catch (e) {
        if (mySeq !== speakSeq) return { ok: false, cancelled: true };
        fallbackError = e?.message || String(e);
        console.warn("Native TTS fallback to WebSpeech:", e);
      }
    }

    if (mySeq !== speakSeq) return { ok: false, cancelled: true };

    const usedLocalVoice = speakWithWebSpeech(clean, cfg, mySeq);
    if (mySeq !== speakSeq) return { ok: false, cancelled: true };

    const fallbackInfo = {
      ok: true,
      provider: "webspeech",
      voice: usedLocalVoice || "System Default",
      fallback: cfg.ttsProvider !== "webspeech",
      error: fallbackError
    };
    if (typeof onStart === "function") onStart(fallbackInfo);
    return fallbackInfo;
  }

  function playBase64AudioWithLipSync(base64, mimeType, seq) {
    return new Promise((resolve) => {
      if (seq !== speakSeq) {
        resolve();
        return;
      }

      // Guarantee no previous audio element can survive alongside this one
      clearAudioPlaybackOnly();

      let finished = false;
      let source = null;
      let analyser = null;
      let audio = null;

      const finish = () => {
        if (finished) return;
        finished = true;
        if (currentAudioCancel === finish) currentAudioCancel = null;
        if (audio) {
          try {
            audio.onplay = null;
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.src = "";
          } catch { }
          if (currentAudio === audio) currentAudio = null;
          audio = null;
        }
        try { source?.disconnect(); } catch { }
        try { analyser?.disconnect(); } catch { }
        source = null;
        analyser = null;
        if (seq === speakSeq) {
          if (lipSyncRaf) {
            cancelAnimationFrame(lipSyncRaf);
            lipSyncRaf = null;
          }
          HaruPet.setLipSync(0);
        }
        resolve();
      };

      try {
        const ctx = ensureAudioContext();
        audio = new Audio(`data:${mimeType};base64,${base64}`);
        currentAudio = audio;
        currentAudioCancel = finish;

        source = ctx.createMediaElementSource(audio);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const updateLip = () => {
          if (finished || seq !== speakSeq || currentAudio !== audio || !audio || audio.paused || audio.ended) {
            if (seq === speakSeq) HaruPet.setLipSync(0);
            return;
          }
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          HaruPet.setLipSync(Math.min(1, rms * 4.5));
          lipSyncRaf = requestAnimationFrame(updateLip);
        };

        audio.onplay = () => {
          if (finished || seq !== speakSeq) {
            finish();
            return;
          }
          lipSyncRaf = requestAnimationFrame(updateLip);
        };
        audio.onended = () => finish();
        audio.onerror = () => finish();

        audio.play().catch(() => finish());
      } catch {
        finish();
      }
    });
  }

  function speakWithWebSpeech(text, cfg, seq) {
    if (!window.speechSynthesis || seq !== speakSeq) return "";
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = Math.max(0.5, Math.min(2, cfg.speechRate || 1.0));
    utter.pitch = Math.max(0.5, Math.min(1.6, cfg.speechPitch || 1.0));

    const voices = window.speechSynthesis.getVoices() || [];
    let chosen = null;
    if (cfg.webSpeechVoice) {
      chosen = voices.find((v) => v.name === cfg.webSpeechVoice);
    }
    if (!chosen) {
      chosen =
        voices.find((v) => /en-US|en-GB/i.test(v.lang) && /Aria|Jenny|Zira|Sonia|Natural|Female/i.test(v.name)) ||
        voices.find((v) => /^en/i.test(v.lang));
    }
    if (chosen) utter.voice = chosen;

    utter.onstart = () => {
      if (seq !== speakSeq) return;
      if (fakeLipTimer) clearInterval(fakeLipTimer);
      fakeLipTimer = setInterval(() => {
        if (seq !== speakSeq) {
          clearInterval(fakeLipTimer);
          fakeLipTimer = null;
          return;
        }
        HaruPet.setLipSync(0.2 + Math.random() * 0.65);
      }, 95);
    };
    utter.onend = () => {
      if (seq === speakSeq) clearAudioPlaybackOnly();
    };
    utter.onerror = () => {
      if (seq === speakSeq) clearAudioPlaybackOnly();
    };
    window.speechSynthesis.speak(utter);
    return chosen ? chosen.name : "";
  }

  function getWebSpeechVoices() {
    if (!window.speechSynthesis) return [];
    return (window.speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang));
  }

  // ---- Speech-to-Text (语音转文字) ----
  async function startListening(settings, callbacks) {
    if (isListening) {
      stopListening();
      return;
    }

    const sttMode = (settings.voice && settings.voice.sttProvider) || "auto";
    const hasApiKey = !!(settings.api && settings.api.apiKey && settings.api.apiKey.trim());
    const useWhisper = sttMode === "whisper" || (sttMode === "auto" && hasApiKey);

    activeSttCallbacks = callbacks || {};
    isListening = true;

    if (useWhisper) {
      await startWhisperRecording(callbacks);
    } else {
      const started = startBrowserSpeechRecognition(callbacks);
      if (!started) {
        if (hasApiKey) {
          await startWhisperRecording(callbacks);
        } else {
          isListening = false;
          callbacks?.onError?.("当前环境不支持浏览器内置语音识别，请在设置中配置支持 Whisper 的 API Key。");
        }
      }
    }
  }

  function startBrowserSpeechRecognition(callbacks) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      activeRecognition = rec;

      let finalText = "";
      rec.onstart = () => callbacks?.onStart?.("Listening via Browser Speech... Speak English now");
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t + " ";
          else interim += t;
        }
        callbacks?.onInterim?.((finalText + interim).trim());
      };
      rec.onerror = (ev) => {
        isListening = false;
        activeRecognition = null;
        if (ev.error === "network" || ev.error === "service-not-allowed") {
          callbacks?.onError?.("浏览器在线语音识别服务不可达，建议在「设置 -> API」填入支持 Whisper 的 API Key 使用 Whisper 语音转文字！");
        } else if (ev.error !== "aborted") {
          callbacks?.onError?.(`语音识别提示：${ev.error}`);
        }
        callbacks?.onEnd?.();
      };
      rec.onend = () => {
        isListening = false;
        activeRecognition = null;
        if (finalText.trim()) callbacks?.onFinal?.(finalText.trim());
        callbacks?.onEnd?.();
      };
      rec.start();
      return true;
    } catch {
      return false;
    }
  }

  async function startWhisperRecording(callbacks) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: mimeType });
        cleanupMedia();
        if (blob.size < 400) {
          callbacks?.onEnd?.();
          return;
        }
        callbacks?.onStatus?.("Transcribing with Whisper...");
        const base64 = await blobToBase64(blob);
        const res = await HostBridge.rpc("aiTranscribe", { audioBase64: base64, mimeType });
        if (res && res.ok && res.text) {
          callbacks?.onFinal?.(res.text);
        } else {
          callbacks?.onError?.(res?.error || "Whisper 语音转文字失败，请检查 API 设置。");
        }
        callbacks?.onEnd?.();
      };

      mediaRecorder.start();
      callbacks?.onStart?.("Recording English... Click Stop (or Mic) when done");
    } catch (err) {
      cleanupMedia();
      isListening = false;
      callbacks?.onError?.(`无法打开麦克风：${err.message}`);
      callbacks?.onEnd?.();
    }
  }

  function stopListening() {
    isListening = false;
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch { }
      activeRecognition = null;
    }
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try { mediaRecorder.stop(); } catch { }
    } else {
      cleanupMedia();
      activeSttCallbacks?.onEnd?.();
    }
  }

  function cleanupMedia() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    mediaRecorder = null;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result || "";
        const idx = dataUrl.indexOf(",");
        resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return {
    speak,
    stopSpeaking,
    getWebSpeechVoices,
    startListening,
    stopListening,
    isListening: () => isListening,
  };
})();
