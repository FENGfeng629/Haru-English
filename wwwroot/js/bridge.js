// Host C# WebView2 <-> JS Bridge + Dynamic Click-Through Hit-Rect Reporter
window.HostBridge = (() => {
  const hasWebView = !!(window.chrome && window.chrome.webview);
  const isSettingsView = new URLSearchParams(window.location.search).get("view") === "settings";
  const pending = new Map();
  let reqSeq = 1;
  const trayListeners = [];
  const cursorListeners = [];
  const dragStartedListeners = [];
  const dragMoveListeners = [];
  const dragEdgeFlipListeners = [];
  const dragFinishedListeners = [];
  const forceEndDragListeners = [];
  const windowBoundsAppliedListeners = [];
  const petRestoredListeners = [];
  const fullscreenDndListeners = [];
  const settingsWindowStateListeners = [];
  const syncFromSettingsListeners = [];
  const syncFromPetListeners = [];
  const openSettingsTabListeners = [];
  const settingsMaximizedListeners = [];
  const livePetScaleListeners = [];
  const petActionListeners = [];

  if (hasWebView) {
    window.chrome.webview.addEventListener("message", (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "rpcResponse") {
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          entry.resolve(msg.data);
        }
      } else if (msg.type === "trayCommand") {
        trayListeners.forEach((fn) => fn(msg.command, msg.value));
      } else if (msg.type === "globalCursor") {
        cursorListeners.forEach((fn) => fn(msg.x, msg.y));
      } else if (msg.type === "dragStarted") {
        dragStartedListeners.forEach((fn) => fn());
      } else if (msg.type === "dragMove") {
        dragMoveListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "dragEdgeFlip") {
        dragEdgeFlipListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "dragFinished") {
        dragFinishedListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "forceEndDrag") {
        forceEndDragListeners.forEach((fn) => fn());
      } else if (msg.type === "windowBoundsApplied") {
        windowBoundsAppliedListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "petRestored") {
        petRestoredListeners.forEach((fn) => fn());
      } else if (msg.type === "fullscreenDnd") {
        fullscreenDndListeners.forEach((fn) => fn(!!msg.active));
      } else if (msg.type === "settingsWindowState") {
        settingsWindowStateListeners.forEach((fn) => fn(!!msg.open));
      } else if (msg.type === "syncFromSettings") {
        syncFromSettingsListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "syncFromPet") {
        syncFromPetListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "openSettingsTab") {
        openSettingsTabListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "settingsMaximizedState") {
        settingsMaximizedListeners.forEach((fn) => fn(!!msg.maximized));
      } else if (msg.type === "livePetScale") {
        livePetScaleListeners.forEach((fn) => fn(msg));
      } else if (msg.type === "petAction") {
        petActionListeners.forEach((fn) => fn(msg.action));
      }
    });
  }

  function post(obj) {
    if (hasWebView) {
      window.chrome.webview.postMessage(obj);
    }
  }

  function rpc(method, payload = {}) {
    if (!hasWebView) {
      return Promise.resolve({ ok: false, error: "Not running inside WebView2 host." });
    }
    return new Promise((resolve) => {
      const id = String(reqSeq++);
      pending.set(id, { resolve });
      post({ type: "rpc", id, method, payload });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, error: "RPC timeout" });
        }
      }, 45000);
    });
  }

  function setDragging(dragging, keepWindowFixed = false, meta = null) {
    const payload = {
      type: "setDragging",
      dragging: !!dragging,
      keepWindowFixed: !!keepWindowFixed,
    };
    if (meta && typeof meta === "object") {
      if (Number.isFinite(meta.petOffsetX)) payload.petOffsetX = Math.round(meta.petOffsetX);
      if (Number.isFinite(meta.petW)) payload.petW = Math.round(meta.petW);
      if (Number.isFinite(meta.dockW)) payload.dockW = Math.round(meta.dockW);
      if (typeof meta.flipLeft === "boolean") payload.flipLeft = meta.flipLeft;
      if (typeof meta.canFlip === "boolean") payload.canFlip = meta.canFlip;
    }
    post(payload);
  }

  function setWindowBounds(x, y, w, h, token = 0, freezeRect = null) {
    const payload = {
      type: "setWindowBounds",
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      token: Number(token) || 0,
    };
    if (freezeRect && typeof freezeRect === "object") {
      payload.freezeRect = {
        x: Math.round(freezeRect.x),
        y: Math.round(freezeRect.y),
        w: Math.round(freezeRect.w),
        h: Math.round(freezeRect.h),
      };
    }
    post(payload);
  }

  function revealWindow(token = 0) {
    post({ type: "revealWindow", token: Number(token) || 0 });
  }

  function prewarmTts(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    post({ type: "ttsPrewarm", items });
  }

  function cancelTts() {
    post({ type: "cancelTts" });
  }

  function log(message) {
    post({ type: "log", message: String(message) });
  }

  window.addEventListener("error", (e) => {
    log(`window.error: ${e.message} at ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    log(`unhandledrejection: ${e.reason?.message || e.reason}`);
  });

  // Collect all visible interactive elements' bounding boxes for click-through hit-testing
  let lastRectSignature = "";
  let hitRectRaf = null;
  function scheduleReportHitRects() {
    if (hitRectRaf) return;
    hitRectRaf = requestAnimationFrame(() => {
      hitRectRaf = null;
      reportHitRects();
    });
  }

  function reportHitRects() {
    if (!hasWebView) return;
    const zones = document.querySelectorAll(".hit-zone");
    const rects = [];
    const pad = 2;
    zones.forEach((el) => {
      if (el.classList.contains("hidden")) return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      // Trim transparent side margins around Haru's canvas so nearby desktop icons stay clickable
      if (el.id === "pet-anchor") {
        const trimX = Math.round(r.width * 0.10);
        rects.push({
          x: Math.round(r.left + trimX),
          y: Math.round(r.top + 4),
          w: Math.max(40, Math.round(r.width - trimX * 2)),
          h: Math.max(40, Math.round(r.height - 6)),
        });
      } else {
        rects.push({
          x: Math.round(r.left - pad),
          y: Math.round(r.top - pad),
          w: Math.round(r.width + pad * 2),
          h: Math.round(r.height + pad * 2),
        });
      }
    });

    const sig = JSON.stringify(rects);
    if (sig !== lastRectSignature) {
      lastRectSignature = sig;
      post({ type: "setHitRects", rects });
    }
  }

  function openSettings(tab = "overview", subTab = null) {
    post({ type: "openSettings", tab, subTab });
  }

  function closeSettingsWindow() {
    post({ type: isSettingsView ? "settingsWinClose" : "closeSettings" });
  }

  function settingsReady() {
    post({ type: "settingsReady" });
  }

  function settingsWinDragStart() {
    post({ type: "settingsWinDragStart" });
  }

  function settingsWinDragEnd() {
    post({ type: "settingsWinDragEnd" });
  }

  function settingsWinToggleMax() {
    post({ type: "settingsWinToggleMax" });
  }

  function livePetScale(scale, done = false) {
    post({ type: "livePetScale", scale: Number(scale) || 1.0, done: !!done });
  }

  function petAction(action) {
    post({ type: "petAction", action: String(action || "happy") });
  }

  function startWeakQuiz() {
    post({ type: "startQuizBook", bookId: "weak" });
  }

  function startQuizBook(bookId = "all") {
    post({ type: "startQuizBook", bookId: String(bookId || "all") });
  }

  // Auto-sync hit rects smoothly whenever UI changes (Pet window only; SettingsWindow is a dedicated solid window)
  if (!isSettingsView) {
    setInterval(reportHitRects, 150);
    window.addEventListener("resize", scheduleReportHitRects);
    window.addEventListener("DOMContentLoaded", () => {
      const stage = document.getElementById("desktop-stage");
      if (stage && typeof MutationObserver !== "undefined") {
        new MutationObserver(scheduleReportHitRects).observe(stage, {
          attributes: true,
          attributeFilter: ["class", "style"],
          subtree: true,
        });
      }
      reportHitRects();
    });
  }

  return {
    isSettingsView,
    rpc,
    setDragging,
    setWindowBounds,
    revealWindow,
    prewarmTts,
    cancelTts,
    log,
    reportHitRects,
    openSettings,
    closeSettingsWindow,
    settingsReady,
    settingsWinDragStart,
    settingsWinDragEnd,
    settingsWinToggleMax,
    livePetScale,
    petAction,
    startWeakQuiz,
    startQuizBook,
    onTrayCommand(fn) { trayListeners.push(fn); },
    onGlobalCursor(fn) { cursorListeners.push(fn); },
    onDragStarted(fn) { dragStartedListeners.push(fn); },
    onDragMove(fn) { dragMoveListeners.push(fn); },
    onDragEdgeFlip(fn) { dragEdgeFlipListeners.push(fn); },
    onDragFinished(fn) { dragFinishedListeners.push(fn); },
    onForceEndDrag(fn) { forceEndDragListeners.push(fn); },
    onWindowBoundsApplied(fn) { windowBoundsAppliedListeners.push(fn); },
    onPetRestored(fn) { petRestoredListeners.push(fn); },
    onFullscreenDnd(fn) { fullscreenDndListeners.push(fn); },
    onSettingsWindowState(fn) { settingsWindowStateListeners.push(fn); },
    onSyncFromSettings(fn) { syncFromSettingsListeners.push(fn); },
    onSyncFromPet(fn) { syncFromPetListeners.push(fn); },
    onOpenSettingsTab(fn) { openSettingsTabListeners.push(fn); },
    onSettingsMaximizedState(fn) { settingsMaximizedListeners.push(fn); },
    onLivePetScale(fn) { livePetScaleListeners.push(fn); },
    onPetAction(fn) { petActionListeners.push(fn); },
  };
})();
