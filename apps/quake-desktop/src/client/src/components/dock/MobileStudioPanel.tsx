import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Home, Keyboard, MonitorSmartphone, Play, Power, RefreshCw, RotateCw, Square, Smartphone, TabletSmartphone, TerminalSquare, Volume1, Volume2 } from "lucide-react";
import { apiGet, apiPost, authToken } from "../../lib/api";
import styles from "./MobileStudioPanel.module.css";
import { MobileStream } from "./MobileStream";

type Platform = "android" | "ios";
type Device = { id: string; platform: Platform; name: string; kind: string; status: string; osVersion?: string; model?: string };
type Capability = { platform: Platform; available: boolean; mode: string; message?: string };
type Project = { id: string; name: string; frameworks: string[]; languages: string[]; targets: Platform[]; buildSystems: string[]; configurable: boolean };
type VirtualDevice = { name: string; running: boolean; status: "stopped" | "booting" | "ready" | "offline"; deviceId?: string };
type RuntimeLog = { timestamp?: string; level: string; tag?: string; pid?: number; message: string };
type BuildProfile = { id: string; name: string; platform: Platform; source: string; artifact?: string; appId?: string };
type BuildResult = { success: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; installed?: boolean; launched?: boolean };
type StudioStatus = {
  projects: Project[];
  buildProfiles: BuildProfile[];
  capabilities: Capability[];
  devices: Device[];
  androidVirtualDevices: VirtualDevice[];
  foregroundApps: Partial<Record<Platform, { packageName?: string; activity?: string }>>;
  refreshedAt: string;
};
type ScreenPoint = { x: number; y: number };
type SemanticNode = { index: number; ref: string; fingerprint: string; text?: string; resourceId?: string; className?: string; contentDescription?: string; clickable: boolean; bounds?: { left: number; top: number; right: number; bottom: number } };
type SemanticSnapshot = { snapshotId: string; revision: number; deviceId: string; nodes: SemanticNode[] };

function screenPoint(surface: HTMLImageElement | HTMLCanvasElement, clientX: number, clientY: number): ScreenPoint {
  const rect = surface.getBoundingClientRect();
  const width = surface instanceof HTMLImageElement ? surface.naturalWidth : surface.width;
  const height = surface instanceof HTMLImageElement ? surface.naturalHeight : surface.height;
  return {
    x: (clientX - rect.left) * (width || rect.width) / rect.width,
    y: (clientY - rect.top) * (height || rect.height) / rect.height,
  };
}

export function MobileStudioPanel({ sessionKey }: { sessionKey: string }) {
  const storageKey = `quake-mobile-studio:${sessionKey}`;
  const restored = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}"); } catch { return {}; }
  }, [storageKey]);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("android");
  const [selectedProjectId, setSelectedProjectId] = useState<string>(restored.projectId || "");
  const [workspaceTab, setWorkspaceTab] = useState<"device" | "inspector" | "logs" | "builds" | "tests" | "data" | "diagnostics">(restored.workspaceTab || "device");
  const [selectedDevices, setSelectedDevices] = useState<Partial<Record<Platform, string>>>(restored.devices || {});
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [screenOrientation, setScreenOrientation] = useState<"portrait" | "landscape">("portrait");
  const [loading, setLoading] = useState(true);
  const [startingAvd, setStartingAvd] = useState("");
  const [textInput, setTextInput] = useState("");
  const [textMode, setTextMode] = useState<"append" | "replace">("append");
  const [buildingProfile, setBuildingProfile] = useState("");
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [logs, setLogs] = useState<RuntimeLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("verbose");
  const [error, setError] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<SemanticSnapshot | null>(null);
  const [inspectorQuery, setInspectorQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<SemanticNode | null>(null);
  const [annotationComment, setAnnotationComment] = useState("");
  const dragStartRef = useRef<ScreenPoint | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) { setError(""); setPreviewFailed(false); }
    try {
      const next = await apiGet<StudioStatus>("/api/mobile/status");
      setStatus(next);
      setSelectedDevices((current) => {
        const updated = { ...current };
        for (const platform of ["android", "ios"] as const) {
          if (!next.devices.some((device) => device.id === updated[platform] && device.platform === platform && device.status === "ready")) {
            updated[platform] = next.devices.find((device) => device.platform === platform && device.status === "ready")?.id;
          }
        }
        return updated;
      });
      if (next.androidVirtualDevices.some((avd) => avd.running)) setStartingAvd("");
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "Mobil runtime okunamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true);
      if (selectedDevices[selectedPlatform] && !streaming) setPreviewNonce((value) => value + 1);
    }, selectedDevices[selectedPlatform] ? (streaming ? 3000 : 700) : 3000);
    return () => window.clearInterval(timer);
  }, [refresh, selectedDevices, selectedPlatform, streaming]);
  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify({ platform: selectedPlatform, devices: selectedDevices, projectId: selectedProjectId, workspaceTab, logsOpen, inspectorOpen, logQuery, logLevel, textMode }));
  }, [inspectorOpen, logLevel, logQuery, logsOpen, selectedDevices, selectedPlatform, selectedProjectId, storageKey, textMode, workspaceTab]);
  useEffect(() => {
    setPreviewFailed(false);
  }, [selectedDevices, selectedPlatform]);
  const capability = status?.capabilities.find((item) => item.platform === selectedPlatform);
  const platformDevices = status?.devices.filter((device) => device.platform === selectedPlatform) || [];
  const deviceId = selectedDevices[selectedPlatform];
  const device = platformDevices.find((item) => item.id === deviceId && item.status === "ready");
  const project = status?.projects.find((item) => item.id === selectedProjectId) || status?.projects[0];
  const foregroundApp = status?.foregroundApps[selectedPlatform];

  useEffect(() => {
    if (!device || previewFailed) return;
    const controller = new AbortController();
    void fetch(`/api/mobile/screenshot?platform=${selectedPlatform}&deviceId=${encodeURIComponent(device.id)}&sessionKey=${encodeURIComponent(sessionKey)}&v=${previewNonce}`, {
      headers: authToken ? { "X-Quake-Web-Token": authToken } : undefined,
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Screenshot ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return objectUrl; });
      setError("");
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPreviewFailed(true);
      setError("Cihaz ekranı alınamadı. Cihaz yeniden hazır olduğunda bağlantı kurulacak.");
    });
    return () => controller.abort();
  }, [device, previewFailed, previewNonce, selectedPlatform]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const action = useCallback(async (payload: Record<string, unknown>) => {
    if (!deviceId) return;
    setError("");
    try {
      await apiPost("/api/mobile/action", { platform: selectedPlatform, deviceId, action: payload });
      window.setTimeout(() => setPreviewNonce((value) => value + 1), 180);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mobil eylem tamamlanamadı");
    }
  }, [deviceId, selectedPlatform]);

  const startEmulator = useCallback(async (name: string) => {
    setStartingAvd(name);
    setError("");
    try {
      await apiPost("/api/mobile/emulator/start", { platform: "android", name });
      window.setTimeout(() => void refresh(true), 1200);
    } catch (reason) {
      setStartingAvd("");
      setError(reason instanceof Error ? reason.message : "Emülatör başlatılamadı");
    }
  }, [refresh]);

  const stopEmulator = useCallback(async (targetDeviceId = deviceId) => {
    if (!targetDeviceId) return;
    try {
      await apiPost("/api/mobile/emulator/stop", { platform: "android", deviceId: targetDeviceId });
      setSelectedDevices((current) => ({ ...current, android: current.android === targetDeviceId ? undefined : current.android }));
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Emülatör durdurulamadı");
    }
  }, [deviceId, refresh]);

  const restartEmulator = useCallback(async (avd: VirtualDevice) => {
    if (!avd.deviceId) return;
    setStartingAvd(avd.name);
    setError("");
    try {
      await apiPost("/api/mobile/emulator/restart", { platform: "android", name: avd.name, deviceId: avd.deviceId });
      setSelectedDevices((current) => ({ ...current, android: undefined }));
      window.setTimeout(() => void refresh(true), 1200);
    } catch (reason) {
      setStartingAvd("");
      setError(reason instanceof Error ? reason.message : "Emülatör yeniden başlatılamadı");
    }
  }, [refresh]);

  const runBuild = useCallback(async (profileId: string) => {
    setBuildingProfile(profileId);
    setBuildResult(null);
    setError("");
    try {
      const response = await apiPost<{ result: BuildResult }>("/api/mobile/build", { profileId, deviceId });
      setBuildResult(response.result);
      if (response.result.success) {
        await refresh(true);
        setPreviewNonce((value) => value + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mobil build tamamlanamadı");
    } finally {
      setBuildingProfile("");
    }
  }, [deviceId, refresh]);

  const refreshInspector = useCallback(async () => {
    if (!deviceId) return;
    try {
      const result = await apiGet<SemanticSnapshot>(`/api/mobile/snapshot?platform=${selectedPlatform}&deviceId=${encodeURIComponent(deviceId)}`);
      setSnapshot(result);
      setInspectorOpen(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Element ağacı okunamadı"); }
  }, [deviceId, selectedPlatform]);

  const sendAnnotation = useCallback(() => {
    if (!selectedNode || !previewUrl) return;
    const target = selectedNode.text || selectedNode.contentDescription || selectedNode.resourceId || selectedNode.className || selectedNode.ref;
    window.dispatchEvent(new CustomEvent("quake:mobile-annotation", { detail: {
      id: `mobile-annotation-${Date.now()}`,
      name: "mobile-element.png",
      previewUrl,
      annotation: `Android native element: ${target}\nRef: ${selectedNode.ref}\nSnapshot: ${snapshot?.snapshotId}\nBounds: ${JSON.stringify(selectedNode.bounds)}\nAçıklama: ${annotationComment || "Bu elementi incele."}`,
      annotationTarget: target,
    } }));
    setAnnotationComment("");
  }, [annotationComment, previewUrl, selectedNode, snapshot]);

  const refreshLogs = useCallback(async () => {
    if (!deviceId || logsPaused) return;
    try {
      const params = new URLSearchParams({ platform: selectedPlatform, deviceId, lines: "300", level: logLevel, query: logQuery });
      if (foregroundApp?.packageName) params.set("packageName", foregroundApp.packageName);
      const result = await apiGet<{ logs: RuntimeLog[] }>(`/api/mobile/logs?${params}`);
      setLogs(result.logs);
      setLogsOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cihaz logları okunamadı");
    }
  }, [deviceId, foregroundApp?.packageName, logLevel, logQuery, logsPaused, selectedPlatform]);

  return (
    <section className={styles.panel} aria-label="Quake Mobile Studio">
      <div className={styles.hero}>
        <div><span className={styles.eyebrow}>QUAKE MOBILE STUDIO</span><h2>Paralel mobil çalışma alanı</h2></div>
        <button type="button" onClick={() => void refresh()} aria-label="Mobil cihazları yenile"><RefreshCw size={15} className={loading ? styles.spinning : ""} /></button>
      </div>

      <div className={styles.platformSwitch} role="tablist" aria-label="Mobil platform">
        {(["android", "ios"] as const).map((platform) => {
          const platformCapability = status?.capabilities.find((item) => item.platform === platform);
          return <button type="button" role="tab" aria-selected={selectedPlatform === platform} className={selectedPlatform === platform ? styles.active : ""} onClick={() => setSelectedPlatform(platform)} key={platform}>
            {platform === "android" ? <Smartphone size={15} /> : <TabletSmartphone size={15} />}
            <span>{platform === "android" ? "Android" : "iOS"}</span>
            <i className={platformCapability?.available ? styles.online : styles.offline} />
          </button>;
        })}
      </div>

      {project && <div className={styles.projectCard}>
        <div><strong>{project.name}</strong><span>{project.frameworks.join(" · ") || "Özel mobil proje"}</span></div>
        {status && status.projects.length > 1 ? <select value={project.id} onChange={(event) => setSelectedProjectId(event.target.value)}>{status.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : <small>Android</small>}
      </div>}

      <div className={styles.workspaceTabs}>{(["device", "inspector", "logs", "builds", "tests", "data", "diagnostics"] as const).map((tab) => <button type="button" className={workspaceTab === tab ? styles.active : ""} onClick={() => { setWorkspaceTab(tab); if (tab === "inspector") void refreshInspector(); if (tab === "logs") void refreshLogs(); }} key={tab}>{tab === "device" ? "Cihaz" : tab === "inspector" ? "Elementler" : tab === "logs" ? "Loglar" : tab === "builds" ? "Build" : tab === "tests" ? "Test" : tab === "data" ? "Veri" : "Tanı"}</button>)}</div>

      <div className={styles.deviceBar}>
        <MonitorSmartphone size={15} />
        <select value={deviceId || ""} onChange={(event) => setSelectedDevices((current) => ({ ...current, [selectedPlatform]: event.target.value || undefined }))} aria-label={`${selectedPlatform} cihazı`}>
          <option value="">{platformDevices.some((item) => item.status === "ready") ? "Cihaz seçin" : "Hazır cihaz yok"}</option>
          {platformDevices.filter((item) => item.status === "ready").map((item) => <option value={item.id} key={item.id}>{item.name} · {item.kind}</option>)}
        </select>
        {device && <span className={styles.ready}>Hazır</span>}
      </div>

      {!device && selectedPlatform === "android" && Boolean(status?.androidVirtualDevices.length) && <div className={styles.avdList}>
        <span className={styles.sectionLabel}>SANAL CİHAZLAR</span>
        {status!.androidVirtualDevices.map((avd) => <div className={styles.avdRow} key={avd.name}>
          <div><Smartphone size={14} /><span><b>{avd.name}</b><small>{avd.status === "ready" ? "Hazır" : avd.status === "offline" ? "Yanıt vermiyor" : avd.status === "booting" ? "Başlatılıyor" : "Başlatılmaya hazır"}</small></span></div>
          {avd.status === "offline" ? <button type="button" disabled={Boolean(startingAvd)} onClick={() => void restartEmulator(avd)}><RefreshCw size={12} />Yeniden başlat</button>
            : avd.running && avd.deviceId ? <button type="button" onClick={() => void stopEmulator(avd.deviceId)}><Square size={12} />Durdur</button>
            : <button type="button" disabled={Boolean(startingAvd)} onClick={() => void startEmulator(avd.name)}><Play size={12} />{startingAvd === avd.name ? "Başlatılıyor" : "Başlat"}</button>}
        </div>)}
      </div>}

      {Boolean(status?.buildProfiles.filter((profile) => profile.platform === selectedPlatform).length) && <div className={styles.buildProfiles}>
        <span className={styles.sectionLabel}>BUILD PROFİLLERİ</span>
        {status!.buildProfiles.filter((profile) => profile.platform === selectedPlatform).map((profile) => <button type="button" disabled={Boolean(buildingProfile)} onClick={() => void runBuild(profile.id)} key={profile.id}>
          <Play size={12} /><span><b>{profile.name}</b><small>{profile.source === "custom" ? "Özel yapılandırma" : "Otomatik algılandı"}</small></span><em>{buildingProfile === profile.id ? "Derleniyor…" : deviceId && profile.platform === "android" ? "Derle + Kur" : "Derle"}</em>
        </button>)}
      </div>}

      {buildResult && <div className={buildResult.success ? styles.buildSuccess : styles.buildFailure}>
        <strong>{buildResult.success ? "Build tamamlandı" : `Build başarısız · exit ${buildResult.exitCode ?? "?"}`}</strong>
        <span>{Math.max(1, Math.round(buildResult.durationMs / 1000))} sn{buildResult.installed ? " · cihaza kuruldu" : ""}{buildResult.launched ? " · açıldı" : ""}</span>
        {!buildResult.success && <pre>{(buildResult.stderr || buildResult.stdout).slice(-4000)}</pre>}
      </div>}

      <div className={styles.viewportShell}>
        {device ? <>
          <div className={styles.deviceTop}><span>{device.name}</span><span>{foregroundApp?.packageName || selectedPlatform.toUpperCase()}</span></div>
          <div className={styles.screen}>
            {previewUrl && !previewFailed ? <MobileStream
              deviceId={device.id}
              fallbackUrl={previewUrl}
              alt={`${device.name} ekranı`}
              onStreamingChange={setStreaming}
              onOrientationChange={setScreenOrientation}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                dragStartRef.current = screenPoint(event.currentTarget, event.clientX, event.clientY);
                event.currentTarget.dataset.pointerStartedAt = String(event.timeStamp);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const start = dragStartRef.current;
                dragStartRef.current = null;
                if (!start) return;
                event.preventDefault();
                const end = screenPoint(event.currentTarget, event.clientX, event.clientY);
                const distance = Math.hypot(end.x - start.x, end.y - start.y);
                const heldMs = event.timeStamp - (Number(event.currentTarget.dataset.pointerStartedAt) || event.timeStamp);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                void action(distance > 18 ? { type: "swipe", fromX: start.x, fromY: start.y, toX: end.x, toY: end.y, durationMs: 300 } : heldMs > 500 ? { type: "long_press", x: end.x, y: end.y, durationMs: Math.round(heldMs) } : { type: "tap", x: end.x, y: end.y });
              }}
              onPointerCancel={() => { dragStartRef.current = null; }}
            /> : <div className={styles.emptyState}><MonitorSmartphone size={24} /><strong>Ekran bağlantısı bekleniyor</strong><p>Cihaz durumu yeniden kontrol ediliyor.</p></div>}
          </div>
          <div className={styles.deviceControls}>
            <button type="button" onClick={() => void action({ type: "key", key: "back" })} aria-label="Geri"><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => void action({ type: "key", key: "home" })} aria-label="Ana ekran"><Home size={15} /></button>
            <button type="button" onClick={() => void action({ type: "rotate", orientation: screenOrientation === "portrait" ? "landscape" : "portrait" })} aria-label={`Ekranı ${screenOrientation === "portrait" ? "yatay" : "dikey"} döndür`}><RotateCw size={14} /></button>
            <button type="button" onClick={() => void action({ type: "key", key: "power" })} aria-label="Güç"><Power size={14} /></button>
            <button type="button" onClick={() => void action({ type: "key", key: "volume-down" })} aria-label="Sesi azalt"><Volume1 size={14} /></button>
            <button type="button" onClick={() => void action({ type: "key", key: "volume-up" })} aria-label="Sesi artır"><Volume2 size={14} /></button>
            <button type="button" onClick={() => void refreshInspector()} aria-label="Native element inspector"><MonitorSmartphone size={14} /></button>
            <button type="button" onClick={() => void refreshLogs()} aria-label="Logcat"><TerminalSquare size={14} /></button>
            {device.kind === "emulator" && <button type="button" onClick={() => void stopEmulator()} aria-label="Emülatörü durdur"><Square size={13} /></button>}
          </div>
        </> : <div className={styles.emptyState}>
          <MonitorSmartphone size={28} />
          <strong>{startingAvd ? `${startingAvd} başlatılıyor` : selectedPlatform === "ios" ? "iOS Runner bekleniyor" : "Android cihazı bekleniyor"}</strong>
          <p>{startingAvd ? "Android boot tamamlandığında cihaz otomatik bağlanacak." : capability?.message || (selectedPlatform === "android" ? "Bir emülatör başlatın veya USB cihaz bağlayın." : "Bir macOS runner eşleştirin.")}</p>
        </div>}
      </div>

      {inspectorOpen && snapshot && <div className={styles.inspectorPanel}>
        <div className={styles.inspectorHeader}><strong>ELEMENT INSPECTOR</strong><button type="button" onClick={() => setInspectorOpen(false)}>×</button></div>
        <input value={inspectorQuery} onChange={(event) => setInspectorQuery(event.target.value)} placeholder="Text, resource ID veya class ara…" />
        <div className={styles.inspectorNodes}>{snapshot.nodes.filter((node) => {
          const query = inspectorQuery.toLowerCase();
          return !query || [node.text, node.contentDescription, node.resourceId, node.className].some((value) => value?.toLowerCase().includes(query));
        }).slice(0, 200).map((node) => <button type="button" className={selectedNode?.ref === node.ref ? styles.inspectorSelected : ""} onClick={() => setSelectedNode(node)} key={node.ref}>
          <b>{node.text || node.contentDescription || node.resourceId || node.className || "Element"}</b><span>{node.ref}{node.clickable ? " · clickable" : ""}</span>
        </button>)}</div>
        {selectedNode && <div className={styles.inspectorDetail}><code>{selectedNode.resourceId || selectedNode.className}</code><small>{JSON.stringify(selectedNode.bounds)}</small><textarea value={annotationComment} onChange={(event) => setAnnotationComment(event.target.value)} placeholder="Bu element için açıklama…" /><button type="button" onClick={sendAnnotation}>Composer'a ekle</button></div>}
      </div>}

      {device && <form className={styles.textBar} onSubmit={(event) => { event.preventDefault(); if (!textInput) return; void action({ type: "type", text: textInput, mode: textMode }); setTextInput(""); }}>
        <Keyboard size={14} /><select value={textMode} onChange={(event) => setTextMode(event.target.value as "append" | "replace")} aria-label="Metin yazma modu"><option value="append">Ekle</option><option value="replace">Değiştir</option></select><input value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Unicode metin, emoji veya JSON yaz…" /><button type="button" onClick={() => void action({ type: "clear_text" })}>Temizle</button><button type="submit" disabled={!textInput}>Gönder</button>
      </form>}

      {logsOpen && <div className={styles.logsPanel}>
        <div><span>LOGCAT · {foregroundApp?.packageName || "sistem"} · {logs.length}</span><span><button type="button" onClick={() => setLogsPaused((value) => !value)}>{logsPaused ? "Devam" : "Duraklat"}</button><button type="button" onClick={() => setLogs([])}>Temizle</button><button type="button" onClick={() => setLogsOpen(false)}>×</button></span></div>
        <div className={styles.logFilters}><select value={logLevel} onChange={(event) => setLogLevel(event.target.value)}><option value="verbose">Verbose+</option><option value="info">Info+</option><option value="warning">Warning+</option><option value="error">Error+</option></select><input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Tag veya metin ara…" /><button type="button" disabled={logsPaused} onClick={() => void refreshLogs()}>Yenile</button></div>
        <pre>{logs.length ? logs.map((log) => `${log.timestamp || ""} ${log.level.toUpperCase().padEnd(7)} ${log.tag || "app"}: ${log.message}`).join("\n") : "Henüz log kaydı yok."}</pre>
      </div>}

      <div className={styles.parallelStrip}>
        <span>PARALEL HEDEFLER</span>
        {(["android", "ios"] as const).map((platform) => {
          const ready = status?.devices.some((item) => item.platform === platform && item.status === "ready");
          return <div key={platform}><i className={ready ? styles.online : styles.offline} /><b>{platform === "android" ? "Android" : "iOS"}</b><small>{ready ? "hazır" : platform === "ios" ? "runner gerekli" : "cihaz bekleniyor"}</small></div>;
        })}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </section>
  );
}

export default MobileStudioPanel;
