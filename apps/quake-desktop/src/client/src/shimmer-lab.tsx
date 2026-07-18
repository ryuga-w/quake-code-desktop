import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, Copy, Moon, Pause, Play, RotateCcw, Sun } from "lucide-react";
import type { AnimateOptions } from "streamdown";
import { MarkdownContent, SIGNAL_TRAIL_STREAM_ANIMATION } from "./components/markdown/MarkdownContent";
import "../shimmer-lab.css";

type Theme = "dark" | "light";
type Speed = 0.75 | 1 | 1.35;

type ShimmerVariant = {
  id: string;
  name: string;
  className: string;
  description: string;
  tag: string;
  durationMs: number;
  band: string;
  contrast: string;
  motion: string;
};

type ResponseStyle = {
  id: string;
  name: string;
  tag: string;
  description: string;
  animated: boolean | AnimateOptions;
  caret?: "block" | "circle";
  rhythm: string;
};

const variants: ShimmerVariant[] = [
  {
    id: "S01",
    name: "Crystal Sweep",
    className: "shimmerCurrent",
    description: "Önceki parlak, hızlı ve yüksek kontrastlı uygulama referansı.",
    tag: "ÖNCEKİ",
    durationMs: 1600,
    band: "Orta",
    contrast: "Yüksek",
    motion: "Sağdan sola",
  },
  {
    id: "S02",
    name: "Soft Pearl",
    className: "shimmerPearl",
    description: "Daha geniş ışık bandı; metni patlatmadan yumuşakça parlatır.",
    tag: "YUMUŞAK",
    durationMs: 2300,
    band: "Geniş",
    contrast: "Düşük",
    motion: "Sağdan sola",
  },
  {
    id: "S03",
    name: "Precision Line",
    className: "shimmerPrecision",
    description: "İnce ve keskin bir ışık çizgisi; teknik, hızlı ve kontrollü.",
    tag: "KESKİN",
    durationMs: 1450,
    band: "İnce",
    contrast: "Yüksek",
    motion: "Sağdan sola",
  },
  {
    id: "S04",
    name: "Silver Fog",
    className: "shimmerFog",
    description: "Neredeyse hissedilmeyen, ağır ve geniş bir gümüş geçiş.",
    tag: "SAKİN",
    durationMs: 3100,
    band: "Çok geniş",
    contrast: "Çok düşük",
    motion: "Sağdan sola",
  },
  {
    id: "S05",
    name: "Comet Tail",
    className: "shimmerComet",
    description: "Parlak çekirdeğin arkasında kısa bir kuyruk bırakan asimetrik akış.",
    tag: "CANLI",
    durationMs: 1850,
    band: "Asimetrik",
    contrast: "Orta",
    motion: "Sağdan sola",
  },
  {
    id: "S06",
    name: "Twin Signal",
    className: "shimmerTwin",
    description: "Şu an uygulamada aktif olan çift sinyal; ritmik ama sert değil.",
    tag: "ŞU AN AKTİF",
    durationMs: 2700,
    band: "Çift",
    contrast: "Orta",
    motion: "Sağdan sola",
  },
  {
    id: "S07",
    name: "Moonline",
    className: "shimmerMoonline",
    description: "Ters yönde akan soğuk metal ışığı; diğerlerinden bilinçli biçimde farklı.",
    tag: "TERS AKIŞ",
    durationMs: 2150,
    band: "Orta",
    contrast: "Orta",
    motion: "Soldan sağa",
  },
  {
    id: "S08",
    name: "Quiet Aurora",
    className: "shimmerAurora",
    description: "Monokromu bozmayan hafif mavi ve menekşe tonlu bir yüzey ışığı.",
    tag: "RENKLİ",
    durationMs: 2450,
    band: "Geniş",
    contrast: "Orta",
    motion: "Sağdan sola",
  },
  {
    id: "S09",
    name: "Still Breathing",
    className: "shimmerBreathing",
    description: "Yatay tarama yapmaz; metin tek noktada sakince nefes alır.",
    tag: "TARAMASIZ",
    durationMs: 1900,
    band: "Sabit",
    contrast: "Düşük",
    motion: "Nefes",
  },
  {
    id: "S10",
    name: "One Glint",
    className: "shimmerGlint",
    description: "Tek bir ışık geçişi yapar, sonra dinlenir; en az dikkat isteyen seçenek.",
    tag: "DİNGİN",
    durationMs: 3400,
    band: "İnce",
    contrast: "Orta",
    motion: "Geçiş + bekleme",
  },
];

const responseStyles: ResponseStyle[] = [
  {
    id: "R01",
    name: "Native Chunks",
    tag: "MEVCUT",
    description: "Gelen metin parçaları animasyonsuz ve doğrudan görünür.",
    animated: false,
    rhythm: "Anlık",
  },
  {
    id: "R02",
    name: "Quiet Fade",
    tag: "SAKİN",
    description: "Yeni kelimeler kısa ve temiz bir opacity geçişiyle belirir.",
    animated: { animation: "fadeIn", duration: 180, easing: "ease-out", sep: "word", stagger: 18 },
    rhythm: "Kelime · 180ms",
  },
  {
    id: "R03",
    name: "Soft Focus",
    tag: "YUMUŞAK",
    description: "Kelimeler hafif bulanıklıktan çözülerek yerine oturur.",
    animated: { animation: "blurIn", duration: 260, easing: "cubic-bezier(.16, 1, .3, 1)", sep: "word", stagger: 22 },
    rhythm: "Kelime · 260ms",
  },
  {
    id: "R04",
    name: "Word Lift",
    tag: "AKIŞKAN",
    description: "Her yeni kelime aşağıdan çok kısa bir mesafeyle yükselir.",
    animated: { animation: "slideUp", duration: 220, easing: "cubic-bezier(.16, 1, .3, 1)", sep: "word", stagger: 20 },
    rhythm: "Kelime · 220ms",
  },
  {
    id: "R05",
    name: "Fine Type",
    tag: "DETAYLI",
    description: "Harfler hızlı bir fade ile akar; sonda küçük bir canlı nokta kalır.",
    animated: { animation: "fadeIn", duration: 90, easing: "linear", sep: "char", stagger: 6 },
    caret: "circle",
    rhythm: "Harf · 90ms",
  },
  {
    id: "R06",
    name: "Signal Trail",
    tag: "ADAPTİF",
    description: "Akış hızına göre kısalıp güçlenen iz; büyük parçalarda yalnızca son 10 kelime hareket eder.",
    animated: SIGNAL_TRAIL_STREAM_ANIMATION,
    rhythm: "Akışa göre · ≤10 kelime",
  },
];

const STORAGE_SELECTION = "quake-shimmer-lab:selected";
const STORAGE_THEME = "quake-shimmer-lab:theme";
const STORAGE_RESPONSE_SELECTION = "quake-shimmer-lab:response-style";

function findVariant(id: string | null): ShimmerVariant | undefined {
  if (!id) return undefined;
  return variants.find((variant) => variant.id.toLowerCase() === id.toLowerCase());
}

function initialVariantId(): string {
  return findVariant(window.location.hash.slice(1))?.id
    ?? findVariant(window.localStorage.getItem(STORAGE_SELECTION))?.id
    ?? variants[0].id;
}

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_THEME);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function findResponseStyle(id: string | null): ResponseStyle | undefined {
  if (!id) return undefined;
  return responseStyles.find((style) => style.id.toLowerCase() === id.toLowerCase());
}

function initialResponseStyleId(): string {
  return findResponseStyle(window.localStorage.getItem(STORAGE_RESPONSE_SELECTION))?.id ?? responseStyles[0].id;
}

function ShimmerText({ className, children, cycleMs }: { className: string; children: React.ReactNode; cycleMs: number }) {
  return (
    <span
      className={`shimmerText ${className}`}
      style={{ "--shimmer-cycle": `${cycleMs}ms` } as React.CSSProperties}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

type StreamingPhase = "thinking" | "streaming" | "complete";

const LIVE_RESPONSE_CHUNKS = [
  "Aynen hocam, ",
  "bahsettiğin şey ajanın yanıtının ",
  "**parça parça ekrana akması**. ",
  "Quake gelen her yeni metin parçasını aynı cevap üzerinde büyütüyor.\n\n",
  "Bu sırada:\n\n",
  "- tamamlanmamış Markdown güvenle çiziliyor,\n",
  "- yeni parçalar mevcut metne ekleniyor,\n",
  "- yanıt bittiğinde aynı yüzey sabit hale geliyor.\n\n",
  "Bu sahne, ana uygulamadaki **gerçek Streamdown renderer’ını** kullanıyor.",
] as const;

const LIVE_RESPONSE_DELAYS = [180, 260, 210, 340, 190, 300, 250, 330, 270] as const;
const LIVE_RESPONSE_SETTLE_MS = 900;
const ignoreFileOpen = () => undefined;

function useStreamingShowcase(replayKey: number, variantId: string, paused: boolean, speed: Speed) {
  const [phase, setPhase] = useState<StreamingPhase>("thinking");
  const [chunkCount, setChunkCount] = useState(0);

  useEffect(() => {
    setPhase("thinking");
    setChunkCount(0);
  }, [replayKey, variantId]);

  useEffect(() => {
    if (paused) return;
    let delay: number | undefined;
    let advance: (() => void) | undefined;

    if (phase === "thinking") {
      delay = 1750 / speed;
      advance = () => {
        setChunkCount(1);
        setPhase("streaming");
      };
    } else if (phase === "streaming" && chunkCount < LIVE_RESPONSE_CHUNKS.length) {
      delay = LIVE_RESPONSE_DELAYS[chunkCount] / speed;
      advance = () => setChunkCount((value) => value + 1);
    } else if (phase === "streaming") {
      // Keep Streamdown in streaming mode until even the longest character-
      // stagger option has visibly settled. Switching to static sooner removes
      // its animation spans and makes the large preview appear to finish later.
      delay = LIVE_RESPONSE_SETTLE_MS / speed;
      advance = () => setPhase("complete");
    }

    if (delay === undefined || !advance) return;
    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [chunkCount, paused, phase, replayKey, speed, variantId]);

  return {
    phase,
    content: LIVE_RESPONSE_CHUNKS.slice(0, chunkCount).join(""),
  };
}

function ResponseFlowCard({
  style,
  active,
  phase,
  content,
  replayKey,
  onChoose,
}: {
  style: ResponseStyle;
  active: boolean;
  phase: StreamingPhase;
  content: string;
  replayKey: number;
  onChoose: (id: string) => void;
}) {
  return (
    <article className={`responseStyleCard ${active ? "selected" : ""}`} data-response-style={style.id}>
      <header>
        <span className="responseStyleId">{style.id}</span>
        <div><h3>{style.name}</h3><p>{style.description}</p></div>
        <span className="responseStyleTag">{style.tag}</span>
      </header>
      <div className="responseFlowPreview">
        {content ? (
          <MarkdownContent
            adaptiveSignalTrail={style.id === "R06"}
            animated={style.animated}
            caret={style.caret}
            content={content}
            isStreaming={phase !== "complete"}
            key={`${style.id}-${replayKey}`}
            onOpenFile={ignoreFileOpen}
          />
        ) : (
          <span className="responseFlowWaiting"><i />Ortak yanıt akışı bekleniyor</span>
        )}
      </div>
      <footer>
        <span>{style.rhythm}</span>
        <button type="button" aria-pressed={active} onClick={() => onChoose(style.id)}>
          {active ? <><Check size={12} /> Seçildi</> : "Bunu seç"}
        </button>
      </footer>
    </article>
  );
}

function StreamingShowcase({
  variant,
  responseStyle,
  paused,
  speed,
  replayKey,
  onReplay,
  onChooseResponse,
}: {
  variant: ShimmerVariant;
  responseStyle: ResponseStyle;
  paused: boolean;
  speed: Speed;
  replayKey: number;
  onReplay: () => void;
  onChooseResponse: (id: string) => void;
}) {
  const { phase, content } = useStreamingShowcase(replayKey, variant.id, paused, speed);
  const phaseLabel = phase === "thinking" ? "DÜŞÜNÜYOR" : phase === "streaming" ? "YANIT AKIYOR" : "TAMAMLANDI";
  const cycleMs = Math.round(variant.durationMs / speed);

  return (
    <section className="streamingShowcase" aria-labelledby="streaming-showcase-title">
      <header className="streamingShowcaseHeader">
        <div>
          <span className="sectionKicker">YANIT AKIŞI · 6 VARYASYON</span>
          <h2 id="streaming-showcase-title">Ajanın yazısı nasıl gelsin?</h2>
          <p>Aynı parçalı yanıt ve tek zaman çizgisi, altı farklı hareket. Tamamı ana uygulamanın gerçek Streamdown streaming motoruyla çalışıyor.</p>
        </div>
        <div className="streamingShowcaseActions">
          <span className="streamingState" data-phase={phase}><i />{paused ? "DURAKLATILDI" : phaseLabel}</span>
          <button type="button" onClick={onReplay}><RotateCcw size={13} /> Akışı baştan oynat</button>
        </div>
      </header>

      <div className="responseStyleGrid" aria-label="Yanıt streaming stili seçenekleri">
        {responseStyles.map((style) => (
          <ResponseFlowCard
            key={style.id}
            style={style}
            active={responseStyle.id === style.id}
            phase={phase}
            content={content}
            replayKey={replayKey}
            onChoose={onChooseResponse}
          />
        ))}
      </div>

      <div className="streamingCanvas">
        <div className="streamingCanvasTopline">
          <span>SEÇİLİ AKIŞ · {responseStyle.id} — {responseStyle.name}</span>
          <span>PRODUCTION RENDERER · STREAMDOWN</span>
        </div>
        <div className="liveThread">
          <div className="liveUserBubble">Vitrine bizim şu anki streaming akışını da ekle.</div>
          <div className="liveAssistant" aria-label={phase === "thinking" ? "Quake düşünüyor" : phase === "streaming" ? "Quake yanıtlıyor" : "Quake yanıtı"}>
            {phase === "thinking" ? (
              <div className="liveThinking">
                <ShimmerText className={variant.className} cycleMs={cycleMs}>Düşünüyor</ShimmerText>
                <span className="srOnly">Düşünüyor</span>
              </div>
            ) : (
              <div className="liveResponse">
                <MarkdownContent
                  adaptiveSignalTrail={responseStyle.id === "R06"}
                  animated={responseStyle.animated}
                  caret={responseStyle.caret}
                  content={content}
                  isStreaming={phase === "streaming"}
                  key={`${responseStyle.id}-${replayKey}`}
                  onOpenFile={ignoreFileOpen}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="streamingStages" aria-hidden="true">
        <span className={phase === "thinking" ? "active" : "done"}><i />Düşünme</span>
        <span className={phase === "streaming" ? "active" : phase === "complete" ? "done" : ""}><i />Parçalı yanıt</span>
        <span className={phase === "complete" ? "active done" : ""}><i />Sabit mesaj</span>
      </div>
    </section>
  );
}

function VariantCard({
  variant,
  active,
  speed,
  onChoose,
}: {
  variant: ShimmerVariant;
  active: boolean;
  speed: Speed;
  onChoose: (id: string) => void;
}) {
  const cycleMs = Math.round(variant.durationMs / speed);
  return (
    <article className={`variantCard ${active ? "selected" : ""}`} data-variant={variant.id}>
      <header className="cardHeader">
        <div className="variantIdentity">
          <span className="variantId">{variant.id}</span>
          <div>
            <div className="variantTitleRow">
              <h2>{variant.name}</h2>
              <span className="variantTag">{variant.tag}</span>
            </div>
            <p>{variant.description}</p>
          </div>
        </div>
        <button
          className="chooseButton"
          type="button"
          aria-pressed={active}
          aria-label={`${variant.id} ${variant.name} stilini seç`}
          onClick={() => onChoose(variant.id)}
        >
          {active ? <><Check size={13} /> Seçildi</> : "Bunu seç"}
        </button>
      </header>

      <div className="previewStage" aria-label={`${variant.name} shimmer önizlemesi`}>
        <div className="previewGrid" aria-hidden="true" />
        <div className="messagePreview">
          <div className="userLine">Shimmer seçeneklerini karşılaştır.</div>
          <div className="assistantPreview">
            <span className="assistantMark">Q</span>
            <div className="thinkingSamples">
              <ShimmerText className={variant.className} cycleMs={cycleMs}>Düşünüyor</ShimmerText>
              <ShimmerText className={`${variant.className} longSample`} cycleMs={cycleMs}>
                Mevcut arayüz ritmi ve hareket dili inceleniyor
              </ShimmerText>
            </div>
          </div>
        </div>
        <span className="srOnly">Düşünüyor. Mevcut arayüz ritmi ve hareket dili inceleniyor.</span>
      </div>

      <dl className="specRow">
        <div><dt>Tur</dt><dd>{(variant.durationMs / 1000).toFixed(2)} sn</dd></div>
        <div><dt>Bant</dt><dd>{variant.band}</dd></div>
        <div><dt>Kontrast</dt><dd>{variant.contrast}</dd></div>
        <div><dt>Hareket</dt><dd>{variant.motion}</dd></div>
      </dl>
    </article>
  );
}

function App() {
  const [selectedId, setSelectedId] = useState(initialVariantId);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [speed, setSpeed] = useState<Speed>(1);
  const [paused, setPaused] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [selectedResponseId, setSelectedResponseId] = useState(initialResponseStyleId);
  const selected = useMemo(() => findVariant(selectedId) ?? variants[0], [selectedId]);
  const selectedResponse = useMemo(() => findResponseStyle(selectedResponseId) ?? responseStyles[0], [selectedResponseId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_THEME, theme);
  }, [theme]);

  function choose(id: string) {
    const variant = findVariant(id);
    if (!variant) return;
    setSelectedId(variant.id);
    setCopyState("idle");
    window.localStorage.setItem(STORAGE_SELECTION, variant.id);
    window.history.replaceState(null, "", `#${variant.id.toLowerCase()}`);
  }

  function chooseResponse(id: string) {
    const style = findResponseStyle(id);
    if (!style) return;
    setSelectedResponseId(style.id);
    setCopyState("idle");
    setReplayKey((value) => value + 1);
    window.localStorage.setItem(STORAGE_RESPONSE_SELECTION, style.id);
  }

  async function copySelection() {
    const baseUrl = window.location.href.split("#")[0];
    const text = `Quake seçimleri:\nShimmer: ${selected.id} — ${selected.name}\nYanıt akışı: ${selectedResponse.id} — ${selectedResponse.name}\n${baseUrl}#${selected.id.toLowerCase()}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  return (
    <main className={paused ? "labPaused" : ""}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Quake Code ana sayfa">
          <span className="brandDiamond"><span>Q</span></span>
          <span>QUAKE CODE</span>
        </a>
        <div className="labIndex"><span>MOTION LAB</span><i /><span>SHIMMER / 01</span></div>
        <div className="topActions">
          <button type="button" className="iconButton" onClick={() => setPaused((value) => !value)} aria-label={paused ? "Animasyonları oynat" : "Animasyonları duraklat"}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button type="button" className="iconButton" onClick={() => setReplayKey((value) => value + 1)} aria-label="Animasyonları baştan oynat">
            <RotateCcw size={14} />
          </button>
          <button type="button" className="themeButton" onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Açık zemin" : "Koyu zemin"}
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">DÜŞÜNME DURUMU · GÖRSEL KARŞILAŞTIRMA</span>
          <h1>Işığın<br /><em>ritmini seç.</em></h1>
        </div>
        <div className="heroAside">
          <p>Aynı “Düşünüyor” satırını on farklı karakterle izle. Seçili shimmer’ın gerçek ajan yanıtına nasıl devrettiğini canlı sahnede gör; beğendiğin kartta <strong>Bunu seç</strong> de.</p>
          <div className="heroNote"><span>NASIL SEÇECEKSİN?</span><strong>Bana yalnızca {selected.id} yazman yeterli.</strong></div>
        </div>
      </section>

      <section className="controlRail" aria-label="Shimmer laboratuvarı kontrolleri">
        <div className="controlStatus">
          <span className="liveDot" aria-hidden="true" />
          <span>{paused ? "ÖNİZLEME DURAKLATILDI" : "TÜM ÖNİZLEMELER CANLI"}</span>
        </div>
        <div className="speedControl" role="group" aria-label="Animasyon hızı">
          <span>HIZ</span>
          {([0.75, 1, 1.35] as const).map((value) => (
            <button key={value} type="button" aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
        </div>
      </section>

      <StreamingShowcase
        variant={selected}
        responseStyle={selectedResponse}
        paused={paused}
        speed={speed}
        replayKey={replayKey}
        onReplay={() => setReplayKey((value) => value + 1)}
        onChooseResponse={chooseResponse}
      />

      <section className="variantGrid" key={replayKey} aria-label="Shimmer stil seçenekleri">
        {variants.map((variant) => (
          <VariantCard key={variant.id} variant={variant} active={selected.id === variant.id} speed={speed} onChoose={choose} />
        ))}
      </section>

      <aside className="selectionBar" aria-live="polite">
        <div className="selectionCodes"><span>{selected.id}</span><span>{selectedResponse.id}</span></div>
        <div className="selectionText"><span>SEÇİLİ SHIMMER · YANIT AKIŞI</span><strong>{selected.name} · {selectedResponse.name}</strong></div>
        <p>{selectedResponse.id === "R01" ? "R01 şu an uygulamadaki akış; diğerleri yalnızca vitrinde." : `${selectedResponse.id} yalnızca vitrinde seçili; henüz uygulamaya geçmedi.`}</p>
        <button type="button" onClick={copySelection}>
          {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
          {copyState === "copied" ? "Kopyalandı" : copyState === "failed" ? "Kopyalanamadı" : "Seçimi kopyala"}
        </button>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
