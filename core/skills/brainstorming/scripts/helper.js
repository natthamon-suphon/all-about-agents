(function () {
  const MIN_RECONNECT_MS = 500;
  const MAX_RECONNECT_MS = 30_000;
  const TOMBSTONE_AFTER_MS = 15_000;
  const MAX_EVENT_QUEUE_LENGTH = 64;
  const MAX_EVENT_TEXT_LENGTH = 512;
  const MAX_EVENT_BYTES = 4096;

  function nextReconnectDelay(current, max) {
    return Math.min(current * 2, max);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      nextReconnectDelay,
      MIN_RECONNECT_MS,
      MAX_RECONNECT_MS,
      TOMBSTONE_AFTER_MS,
      MAX_EVENT_QUEUE_LENGTH,
      MAX_EVENT_TEXT_LENGTH,
      MAX_EVENT_BYTES
    };
  }

  if (typeof window === "undefined") return;

  let ws = null;
  let eventQueue = [];
  let reconnectDelay = MIN_RECONNECT_MS;
  let reconnectTimer = null;
  let disconnectedSince = null;
  let everConnected = false;
  let tombstoneShown = false;

  function boundedText(value, fallback = "") {
    const text = typeof value === "string" ? value : String(value ?? fallback);
    return [...text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")]
      .slice(0, MAX_EVENT_TEXT_LENGTH).join("");
  }

  function sessionKey() {
    try { return window.sessionStorage?.getItem("brainstorm-session-key") || null; } catch { return null; }
  }

  function websocketUrl() {
    const key = sessionKey();
    return `ws://${window.location.host}${key ? `/?key=${encodeURIComponent(key)}` : ""}`;
  }

  function reloadAfterRecovery() {
    const key = sessionKey();
    window.location.replace(key ? `/?key=${encodeURIComponent(key)}` : "/");
  }

  function setStatus(state) {
    const element = document.querySelector(".status");
    if (!element) return;
    const labels = {
      connecting: "Connecting.",
      connected: "Connected",
      reconnecting: "Reconnecting.",
      disconnected: "Disconnected"
    };
    element.textContent = labels[state] || labels.disconnected;
  }

  function showTombstone() {
    if (tombstoneShown) return;
    tombstoneShown = true;
    const element = document.createElement("div");
    element.id = "bs-tombstone";
    element.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;background:rgba(20,20,22,.92);color:#f5f5f7;font-family:system-ui,sans-serif";
    const box = document.createElement("div");
    box.style.maxWidth = "480px";
    const heading = document.createElement("h2");
    heading.textContent = "Companion paused";
    const message = document.createElement("p");
    message.textContent = "This brainstorm companion has stopped. Ask your coding agent to bring it back; this page reconnects automatically.";
    box.append(heading, message);
    element.append(box);
    document.body?.append(element);
  }

  function queueEvent(event) {
    if (eventQueue.length >= MAX_EVENT_QUEUE_LENGTH) return false;
    const serialized = JSON.stringify(event);
    if (new TextEncoder().encode(serialized).length > MAX_EVENT_BYTES) return false;
    eventQueue.push(event);
    return true;
  }

  function sendEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return false;
    const event = {
      type: rawEvent.type === "choice" ? "choice" : "click",
      timestamp: Date.now()
    };
    for (const key of ["text", "choice", "id", "value"]) {
      if (rawEvent[key] !== undefined && rawEvent[key] !== null) event[key] = boundedText(rawEvent[key]);
    }
    const serialized = JSON.stringify(event);
    if (new TextEncoder().encode(serialized).length > MAX_EVENT_BYTES) return false;
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(serialized); return true; } catch { return false; }
    }
    return queueEvent(event);
  }

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    setStatus(everConnected ? "reconnecting" : "connecting");
    try { ws = new WebSocket(websocketUrl()); } catch { ws = null; return; }
    ws.onopen = () => {
      const recovered = tombstoneShown;
      everConnected = true;
      disconnectedSince = null;
      reconnectDelay = MIN_RECONNECT_MS;
      tombstoneShown = false;
      setStatus("connected");
      const pending = eventQueue;
      eventQueue = [];
      pending.forEach((event) => sendEvent(event));
      if (recovered) reloadAfterRecovery();
    };
    ws.onmessage = (message) => {
      try { if (JSON.parse(message.data)?.type === "reload") window.location.reload(); } catch { /* ignore malformed server data */ }
    };
    ws.onclose = () => {
      ws = null;
      if (disconnectedSince === null) disconnectedSince = Date.now();
      if (Date.now() - disconnectedSince >= TOMBSTONE_AFTER_MS) {
        setStatus("disconnected");
        showTombstone();
      } else setStatus("reconnecting");
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = nextReconnectDelay(reconnectDelay, MAX_RECONNECT_MS);
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* close owns retry */ } };
  }

  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-choice]");
    if (!target) return;
    sendEvent({
      type: "click",
      text: target.textContent?.trim(),
      choice: target.dataset.choice,
      id: target.id || null
    });
  });

  window.selectedChoice = null;
  window.toggleSelect = function (element) {
    const container = element?.closest?.(".options, .cards");
    const multi = container?.dataset.multiselect !== undefined;
    if (container && !multi) container.querySelectorAll(".option, .card").forEach((item) => item.classList.remove("selected"));
    if (multi) element.classList.toggle("selected");
    else element.classList.add("selected");
    window.selectedChoice = boundedText(element.dataset.choice);
  };

  window.brainstorm = Object.freeze({
    send: sendEvent,
    choice(value, metadata = {}) {
      const event = { type: "choice", value };
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        for (const key of ["id", "text"]) if (metadata[key] !== undefined) event[key] = metadata[key];
      }
      return sendEvent(event);
    }
  });
  connect();
}());
