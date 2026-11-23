// Host C# WebView2 <-> JS Bridge + Dynamic Click-Through Hit-Rect Reporter
window.HostBridge = (() => {
  const hasWebView = !!(window.chrome && window.chrome.webview);
  const pending = new Map();
  let reqSeq = 1;
  const trayListeners = [];
  const cursorListeners = [];
  const dragMoveListeners = [];
  const forceEndDragListeners = [];

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
      } else if (msg.type === "dragMove") {
        dragMoveListeners.forEach((fn) => fn(msg.x, msg.y));
      } else if (msg.type === "forceEndDrag") {
        forceEndDragListeners.forEach((fn) => fn());
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

  function setDragging(dragging) {
    post({ type: "setDragging", dragging: !!dragging });
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
  function reportHitRects() {
    if (!hasWebView) return;
    const zones = document.querySelectorAll(".hit-zone");
    const rects = [];
    const pad = 6;
    zones.forEach((el) => {
      if (el.classList.contains("hidden")) return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      rects.push({
        x: Math.round(r.left - pad),
        y: Math.round(r.top - pad),
        w: Math.round(r.width + pad * 2),
        h: Math.round(r.height + pad * 2),
      });
    });

    const sig = JSON.stringify(rects);
    if (sig !== lastRectSignature) {
      lastRectSignature = sig;
      post({ type: "setHitRects", rects });
    }
  }

  // Auto-sync hit rects smoothly whenever UI changes
  setInterval(reportHitRects, 180);
  window.addEventListener("resize", reportHitRects);

  return {
    rpc,
    setDragging,
    log,
    reportHitRects,
    onTrayCommand(fn) { trayListeners.push(fn); },
    onGlobalCursor(fn) { cursorListeners.push(fn); },
    onDragMove(fn) { dragMoveListeners.push(fn); },
    onForceEndDrag(fn) { forceEndDragListeners.push(fn); },
  };
})();
