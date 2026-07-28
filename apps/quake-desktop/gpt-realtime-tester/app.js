(() => {
  "use strict";

  const SAMPLE_RATE = 24000;
  const MAX_LOG_LINES = 80;

  const state = {
    health: null,
    socket: null,
    upstreamReady: false,
    connecting: false,
    audioContext: null,
    audioStream: null,
    workletNode: null,
    analyser: null,
    waveformFrame: null,
    muted: false,
    nextPlaybackAt: 0,
    scheduledSources: new Set(),
    assistantDraft: null,
    userDraft: null,
    lastError: "",
    logLines: [],
  };

  const el = Object.fromEntries(
    [
      "connectionStatus", "turnStatus", "stageKicker", "stageTitle", "stageDescription",
      "waveform", "waveLabel", "connectButton", "muteButton", "interruptButton",
      "disconnectButton", "transcriptList", "emptyTranscript", "transcriptHint",
      "textForm", "textInput", "sendButton", "hostValue", "deploymentValue",
      "modeValue", "voiceSelect", "silenceSelect", "instructionsInput", "eventLog",
    ].map((id) => [id, document.getElementById(id)]),
  );

  function setPill(node, label, mode = "") {
    node.className = `status ${mode}`.trim();
    node.lastElementChild.textContent = label;
  }

  function setConnection(label, mode = "") {
    setPill(el.connectionStatus, label, mode);
  }

  function setTurn(label, mode = "") {
    setPill(el.turnStatus, label, mode);
  }

  function log(message, data) {
    const time = new Date().toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const detail = data === undefined ? "" : ` ${typeof data === "string" ? data : JSON.stringify(data)}`;
    state.logLines.push(`[${time}] ${message}${detail}`);
    state.logLines = state.logLines.slice(-MAX_LOG_LINES);
    el.eventLog.textContent = state.logLines.join("\n");
    el.eventLog.scrollTop = el.eventLog.scrollHeight;
  }

  function updateControls() {
    const hasSocket = state.socket?.readyState === WebSocket.OPEN;
    const live = hasSocket && state.upstreamReady;
    el.connectButton.disabled = !state.health?.configured || state.connecting || hasSocket;
    el.disconnectButton.disabled = !hasSocket && !state.connecting;
    el.muteButton.disabled = !live || !state.audioStream;
    el.interruptButton.disabled = !live;
    el.textInput.disabled = !live;
    el.sendButton.disabled = !live;
    el.voiceSelect.disabled = hasSocket || state.connecting;
    el.silenceSelect.disabled = hasSocket || state.connecting;
    el.instructionsInput.disabled = hasSocket || state.connecting;
  }

  function addMessage(role, text) {
    const value = String(text || "").trim();
    if (!value) return null;
    el.emptyTranscript?.remove();

    const entry = document.createElement("article");
    entry.className = `message ${role}`;
    const roleNode = document.createElement("span");
    roleNode.className = "message-role";
    roleNode.textContent = role === "user" ? "Sen" : role === "assistant" ? "Quake Voice" : "Sistem";
    const content = document.createElement("div");
    content.textContent = value;
    entry.append(roleNode, content);
    el.transcriptList.append(entry);
    entry.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return { entry, content, text: value };
  }

  function showError(message) {
    const value = String(message || "Bilinmeyen bağlantı hatası.").trim();
    if (value === state.lastError) return;
    state.lastError = value;
    addMessage("system", value);
    setConnection("Bağlantı hatası", "error");
    setTurn("Durduruldu", "error");
    log("Hata", value);
  }

  function appendDraft(kind, chunk) {
    if (!chunk) return;
    const key = kind === "assistant" ? "assistantDraft" : "userDraft";
    let draft = state[key];
    if (!draft) {
      draft = addMessage(kind, "…");
      if (!draft) return;
      draft.text = "";
      draft.content.textContent = "";
      state[key] = draft;
    }
    draft.text += chunk;
    draft.content.textContent = draft.text;
    draft.entry.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function finishDraft(kind, fallback = "") {
    const key = kind === "assistant" ? "assistantDraft" : "userDraft";
    const draft = state[key];
    if (draft) {
      if (!draft.text.trim()) draft.entry.remove();
      state[key] = null;
    } else if (fallback) {
      addMessage(kind, fallback);
    }
  }

  function socketIsOpen() {
    return state.socket?.readyState === WebSocket.OPEN;
  }

  function send(payload) {
    if (!socketIsOpen()) return false;
    state.socket.send(JSON.stringify(payload));
    return true;
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const step = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, index + step));
    }
    return btoa(binary);
  }

  function downsampleToPcm16(input, sourceRate) {
    if (!input.length) return new ArrayBuffer(0);
    const ratio = sourceRate / SAMPLE_RATE;
    const output = new Int16Array(Math.max(1, Math.round(input.length / ratio)));
    let offset = 0;
    for (let index = 0; index < output.length; index += 1) {
      const nextOffset = Math.min(input.length, Math.round((index + 1) * ratio));
      let total = 0;
      let count = 0;
      for (; offset < nextOffset; offset += 1) {
        total += input[offset];
        count += 1;
      }
      const sample = Math.max(-1, Math.min(1, count ? total / count : 0));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output.buffer;
  }

  async function prepareAudioEngine() {
    if (state.audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.AudioWorkletNode) {
      throw new Error("Bu tarayıcı canlı ses için gereken Web Audio desteğine sahip değil.");
    }
    const context = new AudioContextClass();
    await context.audioWorklet.addModule("/audio-capture-worklet.js?v=2");
    state.audioContext = context;
    state.nextPlaybackAt = context.currentTime;
  }

  async function startMicrophone() {
    if (state.audioStream) return;
    await prepareAudioEngine();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const context = state.audioContext;
    if (context.state === "suspended") await context.resume();

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    const worklet = new AudioWorkletNode(context, "audio-capture-processor");
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    worklet.port.onmessage = ({ data }) => {
      if (data?.type !== "audio" || state.muted || !state.upstreamReady || !socketIsOpen()) return;
      const pcm = downsampleToPcm16(data.samples, context.sampleRate);
      if (pcm.byteLength) send({ type: "lab.audio.append", audio: arrayBufferToBase64(pcm) });
    };

    source.connect(analyser);
    source.connect(worklet);
    worklet.connect(silentGain);
    silentGain.connect(context.destination);
    state.audioStream = stream;
    state.workletNode = worklet;
    state.analyser = analyser;
    el.waveLabel.textContent = "Mikrofon açık";
    drawWaveform();
    updateControls();
  }

  function clearPlayback() {
    for (const source of state.scheduledSources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    state.scheduledSources.clear();
    if (state.audioContext) state.nextPlaybackAt = state.audioContext.currentTime;
  }

  async function releaseAudio() {
    cancelAnimationFrame(state.waveformFrame);
    state.waveformFrame = null;
    clearPlayback();
    if (state.workletNode) {
      try { state.workletNode.disconnect(); } catch { /* no-op */ }
    }
    state.audioStream?.getTracks().forEach((track) => track.stop());
    if (state.audioContext) {
      try { await state.audioContext.close(); } catch { /* no-op */ }
    }
    state.audioContext = null;
    state.audioStream = null;
    state.workletNode = null;
    state.analyser = null;
    state.nextPlaybackAt = 0;
    el.waveLabel.textContent = "Mikrofon kapalı";
    paintIdleWaveform();
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = el.waveform.clientWidth;
    const height = el.waveform.clientHeight;
    if (el.waveform.width !== Math.floor(width * ratio) || el.waveform.height !== Math.floor(height * ratio)) {
      el.waveform.width = Math.floor(width * ratio);
      el.waveform.height = Math.floor(height * ratio);
    }
    return { width, height, ratio };
  }

  function paintIdleWaveform() {
    const { width, height, ratio } = resizeCanvas();
    const context = el.waveform.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(101,216,193,0.04)");
    gradient.addColorStop(0.5, "rgba(101,216,193,0.5)");
    gradient.addColorStop(1, "rgba(87,168,255,0.04)");
    context.strokeStyle = gradient;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }

  function drawWaveform() {
    const context = el.waveform.getContext("2d");
    const render = () => {
      if (!state.analyser) return;
      const { width, height, ratio } = resizeCanvas();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const samples = new Uint8Array(state.analyser.fftSize);
      state.analyser.getByteTimeDomainData(samples);
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#65d8c1");
      gradient.addColorStop(1, "#57a8ff");
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.beginPath();
      samples.forEach((sample, index) => {
        const x = (index / (samples.length - 1)) * width;
        const y = ((sample - 128) / 128) * height * 0.38 + height / 2;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
      state.waveformFrame = requestAnimationFrame(render);
    };
    render();
  }

  function playPcmDelta(base64) {
    if (!state.audioContext || !base64) return;
    let raw;
    try { raw = base64ToArrayBuffer(base64); } catch { return; }
    const pcm = new Int16Array(raw);
    if (!pcm.length) return;
    const audioBuffer = state.audioContext.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.audioContext.destination);
    const startAt = Math.max(state.audioContext.currentTime + 0.025, state.nextPlaybackAt);
    source.start(startAt);
    state.nextPlaybackAt = startAt + audioBuffer.duration;
    state.scheduledSources.add(source);
    source.onended = () => state.scheduledSources.delete(source);
  }

  function sessionSettings() {
    return {
      voice: el.voiceSelect.value,
      silenceDurationMs: Number(el.silenceSelect.value),
      instructions: el.instructionsInput.value.trim(),
    };
  }

  function configureSession() {
    send({ type: "lab.configure", settings: sessionSettings() });
    log("Oturum ayarları gönderildi.", { voice: el.voiceSelect.value });
  }

  function markLive() {
    state.upstreamReady = true;
    state.connecting = false;
    state.lastError = "";
    setConnection("Canlı", "live");
    setTurn("Dinliyor", "live");
    el.stageKicker.textContent = "Azure Realtime bağlı";
    el.stageTitle.textContent = "Konuşmaya başlayabilirsin";
    el.stageDescription.textContent = "Konuşma sonunu model otomatik algılar ve sesli yanıt verir.";
    el.transcriptHint.textContent = "Canlı";
    updateControls();
  }

  function handleAzureEvent(event) {
    const type = event?.type || "";
    switch (type) {
      case "session.created":
        log("Azure oturumu oluşturuldu.");
        break;
      case "session.updated":
        log("Azure oturumu hazır.");
        markLive();
        break;
      case "input_audio_buffer.speech_started":
        clearPlayback();
        setTurn("Seni dinliyor", "live");
        el.waveLabel.textContent = "Konuşma algılandı";
        break;
      case "input_audio_buffer.speech_stopped":
        setTurn("Yanıt hazırlanıyor", "connecting");
        el.waveLabel.textContent = "Yanıt hazırlanıyor";
        break;
      case "conversation.item.input_audio_transcription.delta":
        appendDraft("user", event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        finishDraft("user", event.transcript);
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        appendDraft("assistant", event.delta);
        break;
      case "response.output_audio_transcript.done":
        finishDraft("assistant", event.transcript);
        break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        playPcmDelta(event.delta);
        break;
      case "response.done":
        finishDraft("assistant");
        finishDraft("user");
        setTurn("Dinliyor", "live");
        el.waveLabel.textContent = state.muted ? "Mikrofon sessizde" : "Mikrofon açık";
        break;
      case "response.cancelled":
        finishDraft("assistant");
        setTurn("Yanıt kesildi", "ready");
        break;
      case "error":
        showError(event.error?.message || "Azure Realtime bir hata döndürdü.");
        break;
      default:
        if (type.endsWith(".failed")) showError(event.error?.message || type);
    }
  }

  async function connect() {
    if (!state.health?.configured || state.connecting || socketIsOpen()) return;
    state.connecting = true;
    state.upstreamReady = false;
    state.lastError = "";
    setConnection("Bağlanıyor", "connecting");
    setTurn("Hazırlanıyor", "connecting");
    el.stageKicker.textContent = "Bağlantı kuruluyor";
    el.stageTitle.textContent = "Azure Realtime hazırlanıyor";
    el.stageDescription.textContent = "Önce güvenli Azure bağlantısı kurulacak, ardından mikrofon açılacak.";
    updateControls();

    try {
      await prepareAudioEngine();
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/api/realtime`);
      state.socket = socket;

      socket.addEventListener("open", () => log("Local proxy bağlantısı açıldı."));

      socket.addEventListener("message", async ({ data }) => {
        let message;
        try { message = JSON.parse(data); } catch { return; }
        if (message.type === "lab.status") {
          if (message.status === "upstream-connected") {
            setConnection("Oturum ayarlanıyor", "connecting");
            configureSession();
            try {
              await startMicrophone();
            } catch (error) {
              showError(error.message || "Mikrofon açılamadı.");
              await disconnect(true);
            }
          } else if (message.status === "upstream-disconnected") {
            state.upstreamReady = false;
            log("Azure bağlantısı kapandı.", { code: message.code });
          } else {
            log("Proxy durumu", message.status);
          }
        } else if (message.type === "lab.azure.event") {
          handleAzureEvent(message.event);
        } else if (message.type === "lab.error") {
          showError(message.message);
        }
      });

      socket.addEventListener("close", async (event) => {
        if (state.socket !== socket) return;
        state.socket = null;
        state.connecting = false;
        state.upstreamReady = false;
        await releaseAudio();
        if (!state.lastError) setConnection("Bağlantı kapalı");
        setTurn("Beklemede");
        el.stageKicker.textContent = "Canlı oturum";
        el.stageTitle.textContent = "Hazır olduğunda konuş";
        el.stageDescription.textContent = "Oturumu başlatınca Azure bağlantısı ve mikrofon sırayla hazırlanır.";
        el.transcriptHint.textContent = "Oturum kapalı";
        log("Bağlantı kapandı.", { code: event.code });
        updateControls();
      });

      socket.addEventListener("error", () => log("Yerel WebSocket hatası."));
    } catch (error) {
      state.connecting = false;
      state.socket = null;
      await releaseAudio();
      showError(error.message || "Oturum başlatılamadı.");
      updateControls();
    }
  }

  async function disconnect(preserveError = false) {
    const socket = state.socket;
    state.socket = null;
    state.connecting = false;
    state.upstreamReady = false;
    if (socket) {
      try { socket.close(1000, "User ended session"); } catch { /* no-op */ }
    }
    await releaseAudio();
    if (!preserveError) {
      setConnection(state.health?.configured ? "Hazır" : "Yapılandırma eksik", state.health?.configured ? "ready" : "error");
    }
    setTurn("Beklemede");
    el.stageKicker.textContent = "Canlı oturum";
    el.stageTitle.textContent = "Hazır olduğunda konuş";
    el.stageDescription.textContent = "Oturumu başlatınca Azure bağlantısı ve mikrofon sırayla hazırlanır.";
    el.transcriptHint.textContent = "Oturum kapalı";
    updateControls();
  }

  function toggleMute() {
    state.muted = !state.muted;
    el.muteButton.textContent = state.muted ? "Sesimi aç" : "Sesimi kapat";
    el.waveLabel.textContent = state.muted ? "Mikrofon sessizde" : "Mikrofon açık";
    log(state.muted ? "Mikrofon sessize alındı." : "Mikrofon açıldı.");
  }

  function interruptResponse() {
    clearPlayback();
    send({ type: "lab.response.cancel" });
    setTurn("Yanıt kesiliyor", "connecting");
    log("Yanıt kesme isteği gönderildi.");
  }

  async function loadHealth() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const health = await response.json();
      state.health = health;
      el.hostValue.textContent = health.endpointHost || "—";
      el.deploymentValue.textContent = health.deployment || "—";
      el.modeValue.textContent = health.apiMode === "v1" ? "Realtime GA · v1" : `Preview · ${health.apiVersion || "legacy"}`;
      if (health.configured) {
        setConnection("Hazır", "ready");
        el.stageDescription.textContent = "Oturumu başlatınca Azure bağlantısı ve mikrofon sırayla hazırlanır.";
        log("Azure yapılandırması hazır.", { deployment: health.deployment, mode: health.apiMode });
      } else {
        setConnection("Yapılandırma eksik", "error");
        el.stageDescription.textContent = "Yerel Azure ayarları eksik.";
        showError((health.errors || []).join(" "));
      }
    } catch (error) {
      setConnection("Sunucu yok", "error");
      showError(error.message || "Yerel Voice Lab sunucusuna ulaşılamıyor.");
    }
    updateControls();
  }

  el.connectButton.addEventListener("click", connect);
  el.disconnectButton.addEventListener("click", () => disconnect(false));
  el.muteButton.addEventListener("click", toggleMute);
  el.interruptButton.addEventListener("click", interruptResponse);
  el.textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = el.textInput.value.trim();
    if (!text || !state.upstreamReady) return;
    addMessage("user", text);
    send({ type: "lab.text.send", text });
    el.textInput.value = "";
    setTurn("Yanıt hazırlanıyor", "connecting");
  });
  window.addEventListener("resize", () => { if (!state.analyser) paintIdleWaveform(); });
  window.addEventListener("beforeunload", () => { try { state.socket?.close(); } catch { /* no-op */ } });

  paintIdleWaveform();
  loadHealth();
})();
