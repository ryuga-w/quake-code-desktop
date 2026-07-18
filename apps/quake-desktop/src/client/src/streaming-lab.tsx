import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronDown, Code2, RotateCcw, Sparkles, Terminal, Wrench } from "lucide-react";
import "../streaming-lab.css";

type VariantId = "quiet" | "pulse" | "terminal" | "steps";
type Phase = "thinking" | "tool" | "answer" | "done";

type Variant = {
  id: VariantId;
  index: string;
  name: string;
  description: string;
  badge: string;
};

const variants: Variant[] = [
  { id: "quiet", index: "01", name: "Quiet Instant", description: "Mevcut yaklaşıma en yakın; sessiz, hızlı ve içerik odaklı.", badge: "MINIMAL" },
  { id: "pulse", index: "02", name: "Signal Pulse", description: "Quake sinyal çizgisiyle akışın canlı olduğunu hissettirir.", badge: "BRANDED" },
  { id: "terminal", index: "03", name: "Live Console", description: "Araç ve düşünce akışını kompakt bir geliştirici konsolu gibi gösterir.", badge: "TECHNICAL" },
  { id: "steps", index: "04", name: "Execution Steps", description: "Düşünme, araç ve yanıt aşamalarını açık bir zaman çizgisine böler.", badge: "EXPLICIT" },
];

const thinkingText = "İsteği analiz ediyorum. Mevcut bileşen yapısını ve stil tokenlarını kontrol edip en az değişiklikle uygulanabilecek yolu belirliyorum…";
const answerText = "Streaming akışını ayrı bir karşılaştırma laboratuvarına taşıdım. Burada dört farklı yaklaşımı aynı veri ve hızla izleyebilir, beğendiğin varyasyonu seçebilirsin.";

function useDemoClock(replayKey: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const timer = window.setInterval(() => setTick((value) => value >= 150 ? 0 : value + 1), 42);
    return () => window.clearInterval(timer);
  }, [replayKey]);
  const phase: Phase = tick < 48 ? "thinking" : tick < 70 ? "tool" : tick < 142 ? "answer" : "done";
  const thinking = thinkingText.slice(0, Math.min(thinkingText.length, tick * 3));
  const answerProgress = Math.max(0, tick - 70);
  const answer = answerText.slice(0, answerProgress * 3);
  return { phase, thinking, answer };
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`status-dot ${active ? "active" : ""}`} aria-hidden="true" />;
}

function Answer({ text, active }: { text: string; active: boolean }) {
  return (
    <div className="answer-copy">
      {text || <span className="answer-placeholder">Yanıt birazdan burada başlayacak.</span>}
      {active && <span className="stream-caret" aria-hidden="true" />}
    </div>
  );
}

function QuietVariant({ phase, thinking, answer }: ReturnType<typeof useDemoClock>) {
  return (
    <div className="demo quiet-demo">
      <div className="quiet-thinking">
        <div className="thinking-label"><Sparkles size={13} /><span>{phase === "thinking" ? "Düşünüyor" : "Düşünme tamamlandı"}</span></div>
        <p>{thinking}</p>
      </div>
      {(phase === "tool" || phase === "answer" || phase === "done") && (
        <div className="quiet-tool"><Wrench size={13} /><span>3 dosya incelendi</span><Check size={13} /></div>
      )}
      <Answer text={answer} active={phase === "answer"} />
    </div>
  );
}

function PulseVariant({ phase, thinking, answer }: ReturnType<typeof useDemoClock>) {
  return (
    <div className="demo pulse-demo">
      <div className={`signal ${phase !== "done" ? "running" : ""}`}>
        <svg viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true">
          <path className="signal-base" d="M1 12h60l8-2 8 4 9-10 10 16 10-13 9 8 9-3h115" />
          <path className="signal-run" pathLength="240" d="M1 12h60l8-2 8 4 9-10 10 16 10-13 9 8 9-3h115" />
        </svg>
        <span>{phase === "thinking" ? "ANALYZING" : phase === "tool" ? "READING FILES" : phase === "answer" ? "RESPONDING" : "COMPLETE"}</span>
      </div>
      <p className="pulse-trace">{thinking}</p>
      <Answer text={answer} active={phase === "answer"} />
    </div>
  );
}

function TerminalVariant({ phase, thinking, answer }: ReturnType<typeof useDemoClock>) {
  return (
    <div className="demo terminal-demo">
      <div className="console-bar"><span className="console-icon"><Terminal size={13} /></span><span>agent / stream</span><span className="console-live"><StatusDot active={phase !== "done"} /> LIVE</span></div>
      <div className="console-body">
        <p><span className="prompt">›</span><span className="dim"> reasoning</span> {thinking}</p>
        {(phase === "tool" || phase === "answer" || phase === "done") && <p><span className="prompt cyan">›</span><span className="dim"> read</span> src/client <span className="success">done 18ms</span></p>}
        {answer && <p className="console-answer"><span className="prompt">›</span><span className="dim"> answer</span> {answer}{phase === "answer" && <span className="block-caret" />}</p>}
      </div>
    </div>
  );
}

function StepsVariant({ phase, thinking, answer }: ReturnType<typeof useDemoClock>) {
  const toolReached = phase !== "thinking";
  const answerReached = phase === "answer" || phase === "done";
  return (
    <div className="demo steps-demo">
      <div className={`step ${phase === "thinking" ? "current" : "complete"}`}>
        <span className="step-node">{phase === "thinking" ? "1" : <Check size={12} />}</span>
        <div><strong>İsteği anla</strong><p>{thinking}</p></div>
      </div>
      <div className={`step ${phase === "tool" ? "current" : toolReached ? "complete" : "pending"}`}>
        <span className="step-node">{phase === "answer" || phase === "done" ? <Check size={12} /> : "2"}</span>
        <div><strong>Çalışma alanını incele</strong><p>{toolReached ? "Bileşenler ve tema tokenları taranıyor." : "Bekliyor"}</p></div>
      </div>
      <div className={`step ${phase === "answer" ? "current" : phase === "done" ? "complete" : "pending"}`}>
        <span className="step-node">{phase === "done" ? <Check size={12} /> : "3"}</span>
        <div><strong>Yanıtı oluştur</strong>{answerReached && <Answer text={answer} active={phase === "answer"} />}</div>
      </div>
    </div>
  );
}

function VariantPreview({ id, clock }: { id: VariantId; clock: ReturnType<typeof useDemoClock> }) {
  if (id === "quiet") return <QuietVariant {...clock} />;
  if (id === "pulse") return <PulseVariant {...clock} />;
  if (id === "terminal") return <TerminalVariant {...clock} />;
  return <StepsVariant {...clock} />;
}

function App() {
  const [selected, setSelected] = useState<VariantId>(() => (localStorage.getItem("quake-streaming-lab:selected") as VariantId) || "quiet");
  const [replayKey, setReplayKey] = useState(0);
  const clock = useDemoClock(replayKey);
  const selectedVariant = useMemo(() => variants.find((variant) => variant.id === selected) ?? variants[0], [selected]);

  function choose(id: VariantId) {
    setSelected(id);
    localStorage.setItem("quake-streaming-lab:selected", id);
  }

  return (
    <main>
      <header className="lab-header">
        <a className="brand" href="/" aria-label="Quake Code ana sayfa"><span className="brand-mark">Q</span><span>QUAKE CODE</span></a>
        <div className="header-meta"><span>INTERACTION LAB</span><span className="header-rule" /><span>STREAM / 01</span></div>
        <button className="replay-button" type="button" onClick={() => setReplayKey((value) => value + 1)}><RotateCcw size={14} /> Akışı yeniden oynat</button>
      </header>

      <section className="intro">
        <div><span className="eyebrow">STREAMING EXPERIENCE STUDY</span><h1>Akış nasıl<br /><em>hissettirmeli?</em></h1></div>
        <div className="intro-copy"><p>Aynı yanıt, dört farklı ritim. Her varyasyon gerçek akış sırasını simüle eder: düşünme, araç kullanımı ve yanıt.</p><div className="selected-summary"><span>SEÇİLİ VARYASYON</span><strong>{selectedVariant.index} — {selectedVariant.name}</strong></div></div>
      </section>

      <section className="variant-grid" aria-label="Streaming varyasyonları">
        {variants.map((variant) => {
          const active = selected === variant.id;
          return (
            <article className={`variant-card ${active ? "selected" : ""}`} key={variant.id}>
              <div className="card-head">
                <span className="variant-number">{variant.index}</span>
                <div><div className="variant-title-row"><h2>{variant.name}</h2><span className="variant-badge">{variant.badge}</span></div><p>{variant.description}</p></div>
                <button className="select-button" type="button" aria-pressed={active} onClick={() => choose(variant.id)}>{active ? <><Check size={14} /> Seçildi</> : "Bunu seç"}</button>
              </div>
              <div className="preview-shell"><div className="preview-top"><span><Code2 size={13} /> QUAKE RESPONSE</span><span>{clock.phase === "done" ? "DONE" : "STREAMING"}</span></div><VariantPreview id={variant.id} clock={clock} /></div>
            </article>
          );
        })}
      </section>

      <footer><span>Seçim tarayıcıda kaydedilir.</span><button type="button" onClick={() => document.querySelector(".selected")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{selectedVariant.name}<ChevronDown size={13} /></button></footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
