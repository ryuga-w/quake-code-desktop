import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  Check,
  Copy,
  Menu,
  Monitor,
  Shield,
  Smartphone,
  Terminal,
  X,
} from "lucide-react";
import "../../landing.css";

const installCommand = "npm install -g @mrquake/quakecode-cli";
const releaseVersion = "0.1.1";
const releaseUrl = "https://github.com/mrquakex/quake-code/releases";

const providers = [
  { name: "Anthropic", src: "/providers/anthropic.svg" },
  { name: "OpenAI", src: "/providers/openai.svg" },
  { name: "Google", src: "/providers/google.svg" },
  { name: "xAI", src: "/providers/xai.svg" },
  { name: "Amazon Bedrock", src: "/providers/amazon-bedrock.svg" },
  { name: "GitHub Copilot", src: "/providers/github-copilot.svg" },
];

const actions = ["PLAN", "SEARCH", "EDIT", "TEST", "BROWSE", "SHIP"];

function useLandingEffects(): void {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12%", threshold: 0.12 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

function BrandMark(): React.JSX.Element {
  return (
    <a className="brand-mark" href="#top" aria-label="Quake Code home">
      <img src="/quake-code-q.png" width="40" height="40" alt="" />
      <span>QUAKE CODE</span>
    </a>
  );
}

function Navigation(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="site-header">
      <BrandMark />
      <button
        className="nav-toggle"
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>
      <nav className={open ? "site-nav is-open" : "site-nav"} aria-label="Main navigation">
        <a href="#system" onClick={close}>System</a>
        <a href="#product" onClick={close}>Product</a>
        <a href="#surfaces" onClick={close}>Surfaces</a>
        <a href="#principles" onClick={close}>Principles</a>
        <a className="nav-signin" href="/auth.html?mode=login" onClick={close}>Sign in</a>
        <a className="nav-cta" href={releaseUrl} target="_blank" rel="noreferrer" onClick={close}>
          Download preview <ArrowRight aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

function SignalLine(): React.JSX.Element {
  return (
    <div className="signal-line" aria-hidden="true">
      {Array.from({ length: 44 }, (_, index) => (
        <i key={index} style={{ "--bar": `${8 + ((index * 17) % 42)}%` } as React.CSSProperties} />
      ))}
    </div>
  );
}

function CopyInstallCommand(): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = installCommand;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="install-command">
      <span aria-hidden="true">$</span>
      <code>{installCommand}</code>
      <button type="button" onClick={() => void copy()} aria-label="Copy install command">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Install command copied" : ""}</span>
    </div>
  );
}

function Hero(): React.JSX.Element {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-media" aria-hidden="true">
        <video
          autoPlay
          muted
          loop
          playsInline
          poster="/landing/quake-core-hero.jpg"
          preload="metadata"
        >
          <source src="/landing/quake-core-loop-seamless.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-content">
        <p className="eyebrow"><span /> Windows preview / v{releaseVersion} / Bring your own key</p>
        <h1 id="hero-title">
          <span>DON&apos;T JUST</span>
          <span>WRITE CODE.</span>
          <span className="accent-line">MOVE SYSTEMS.</span>
        </h1>
        <div className="hero-bottom">
          <p>
            Quake Code sees the workspace, runs the tools, and turns intent into
            verified change. Start with the Windows preview and bring the models
            you already trust.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
              Download Windows Preview <ArrowRight aria-hidden="true" />
            </a>
            <a className="button button-quiet" href="#product">See the system</a>
          </div>
        </div>
      </div>
      <div className="hero-index" aria-hidden="true">Q / 01</div>
      <a className="scroll-cue" href="#system" aria-label="Scroll to product overview">
        <span>SCROLL TO ENTER</span>
        <i />
      </a>
    </section>
  );
}

function ActionTicker(): React.JSX.Element {
  return (
    <div className="action-ticker" role="img" aria-label="Quake Code workflow: plan, search, edit, test, browse, and ship">
      <div aria-hidden="true">
        {[...actions, ...actions].map((action, index) => (
          <React.Fragment key={`${action}-${index}`}>
            <span>{action}</span><b>✦</b>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function LaunchStrip(): React.JSX.Element {
  return (
    <aside className="launch-strip" aria-label={`Quake Code Windows preview version ${releaseVersion}`}>
      <div className="launch-strip-main">
        <span>LATEST BUILD</span>
        <strong>Windows Preview <em>v{releaseVersion}</em></strong>
      </div>
      <div className="launch-strip-meta" aria-label="Release details">
        <span>Windows 10/11 x64</span>
        <span>BYOK</span>
        <span>SHA-256 available</span>
      </div>
      <a className="launch-strip-link" href={releaseUrl} target="_blank" rel="noreferrer">
        Get the preview <ArrowRight aria-hidden="true" />
      </a>
    </aside>
  );
}

function SystemManifesto(): React.JSX.Element {
  return (
    <section className="manifesto section-shell" id="system">
      <div className="section-label" data-reveal>
        <span>01</span>
        <p>THE SYSTEM</p>
      </div>
      <div className="manifesto-copy" data-reveal>
        <p className="kicker">Software does not need another suggestion box.</p>
        <h2>ONE INTENT.<br />AN ENTIRE SYSTEM<br />IN MOTION.</h2>
      </div>
      <div className="manifesto-detail" data-reveal>
        <SignalLine />
        <p>
          Quake understands context, creates a plan, operates real tools, and leaves
          a legible trail. You direct the work. It carries the weight.
        </p>
      </div>
      <div className="system-steps">
        {[
          ["01", "UNDERSTAND", "Reads the codebase, constraints, history, and the shape of the real problem."],
          ["02", "OPERATE", "Edits files, runs commands, uses the browser, and coordinates parallel agents."],
          ["03", "PROVE", "Surfaces every action, diff, result, and failure before the work is called done."],
        ].map(([index, title, body]) => (
          <article key={title} data-reveal>
            <span>{index}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProductStage(): React.JSX.Element {
  return (
    <section className="product-section section-shell" id="product">
      <div className="section-label section-label-light" data-reveal>
        <span>02</span>
        <p>THE COMMAND CENTER</p>
      </div>
      <div className="product-heading" data-reveal>
        <h2>NOT A CHAT WINDOW.<br /><em>A LIVE OPERATING PICTURE.</em></h2>
        <p>
          Work, tools, files, terminals, browsers, plans, and subagents stay visible
          in one spatial system—without hiding the conversation that started it.
        </p>
      </div>
      <div className="product-frame" data-reveal>
        <div className="frame-topbar">
          <span><i /> <i /> <i /></span>
          <b>QUAKE CODE / ACTIVE WORKSPACE</b>
          <small>LOCAL RUNTIME</small>
        </div>
        <div className="product-screen">
          <img
            src="/landing/quake-workspace.png"
            alt="Quake Code desktop workspace showing project navigation, a live conversation, change summaries, the composer, and an embedded browser"
            loading="lazy"
            decoding="async"
          />
          <div className="screen-scan" aria-hidden="true" />
        </div>
        <div className="activity-receipt" aria-hidden="true">
          <small>LIVE ACTIVITY / 04</small>
          <p><Check /> READ <span>workspace state</span><b>done</b></p>
          <p><Check /> SEARCH <span>runtime hooks</span><b>18 matches</b></p>
          <p className="is-active"><i /> EDIT <span>agent-session.ts</span><b>working</b></p>
          <p><i /> TEST <span>targeted suite</span><b>queued</b></p>
        </div>
      </div>
      <div className="product-facts" data-reveal>
        <p><strong>25+</strong><span>model providers</span></p>
        <p><strong>03</strong><span>native surfaces</span></p>
        <p><strong>01</strong><span>shared runtime</span></p>
        <p><strong>∞</strong><span>ways to extend</span></p>
      </div>
    </section>
  );
}

function Surfaces(): React.JSX.Element {
  const surfaces = [
    {
      index: "01",
      title: "TERMINAL",
      icon: Terminal,
      body: "Fast, direct, keyboard-native. The full agent loop where developers already live.",
      meta: "CLI / TUI / scripts",
    },
    {
      index: "02",
      title: "DESKTOP",
      icon: Monitor,
      body: "A spatial workspace for long-running work, rich artifacts, files, terminals, and live tools.",
      meta: "Windows / Web shell",
    },
    {
      index: "03",
      title: "MOBILE",
      icon: Smartphone,
      body: "Keep the thread, inspect progress, and direct the runtime when you step away from the desk.",
      meta: "Android / iOS runtime",
    },
  ];

  return (
    <section className="surfaces section-shell" id="surfaces">
      <div className="surface-art" data-reveal>
        <img src="/landing/quake-layers.jpg" alt="Layered black computational surfaces connected by an orange signal" loading="lazy" />
        <div><span>ONE RUNTIME</span><b>EVERYWHERE<br />WORK HAPPENS.</b></div>
      </div>
      <div className="surface-list">
        <div className="section-label" data-reveal>
          <span>03</span><p>THE SURFACES</p>
        </div>
        {surfaces.map(({ index, title, icon: Icon, body, meta }) => (
          <article key={title} data-reveal>
            <span>{index}</span>
            <Icon aria-hidden="true" />
            <div><h3>{title}</h3><p>{body}</p></div>
            <small>{meta}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function Intelligence(): React.JSX.Element {
  return (
    <section className="intelligence section-shell" aria-labelledby="intelligence-title">
      <div className="intelligence-copy" data-reveal>
        <div className="section-label"><span>04</span><p>THE INTELLIGENCE</p></div>
        <h2 id="intelligence-title">YOUR MODELS.<br />YOUR ROUTING.<br /><em>ONE CONTROL PLANE.</em></h2>
        <p>
          Bring the providers you trust. Switch models by task, control thinking depth,
          and keep the workflow stable while the intelligence underneath evolves.
        </p>
      </div>
      <div className="provider-field" data-reveal>
        {providers.map((provider, index) => (
          <div key={provider.name} style={{ "--delay": `${index * 80}ms` } as React.CSSProperties}>
            <img src={provider.src} alt="" loading="lazy" />
            <span>{provider.name}</span>
          </div>
        ))}
        <p>AND THE NEXT ONE.</p>
      </div>
    </section>
  );
}

function Principles(): React.JSX.Element {
  return (
    <section className="principles section-shell" id="principles">
      <div className="principles-title" data-reveal>
        <Shield aria-hidden="true" />
        <p>BUILT FOR REAL WORK</p>
        <h2>POWER WITHOUT<br />THE BLACK BOX.</h2>
      </div>
      <div className="principle-grid">
        {[
          ["LOCAL BY DEFAULT", "The runtime binds locally and works inside the workspace boundaries you choose."],
          ["EXPLICIT ACTIONS", "Tools are named, arguments are visible, and consequential operations stay reviewable."],
          ["DURABLE CONTEXT", "Sessions, project instructions, skills, and memory carry decisions forward—not noise."],
          ["OPEN EXTENSION", "Providers, MCP servers, custom tools, skills, and UI extensions plug into one runtime."],
        ].map(([title, body], index) => (
          <article key={title} data-reveal>
            <span>0{index + 1}</span><h3>{title}</h3><p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Install(): React.JSX.Element {
  return (
    <section className="install" id="install">
      <div className="install-orbit" aria-hidden="true"><i /><i /><i /></div>
      <div className="install-content" data-reveal>
        <img src="/quake-code-q.png" width="96" height="96" alt="" />
        <p className="eyebrow"><span /> WINDOWS PREVIEW / v{releaseVersion}</p>
        <h2>START WITH<br /><em>THE PREVIEW.</em></h2>
        <p className="install-lede">
          Download the first public build, connect your own provider key, and put the
          whole development system in motion.
        </p>
        <div className="install-actions">
          <a className="button button-primary" href={releaseUrl} target="_blank" rel="noreferrer">
            Download Windows Preview <ArrowRight aria-hidden="true" />
          </a>
          <a className="button button-quiet" href={releaseUrl} target="_blank" rel="noreferrer">
            Release notes
          </a>
        </div>
        <p className="install-meta">v{releaseVersion} · Windows 10/11 x64 · 162 MB · SHA-256 available</p>
        <div className="install-divider"><span>For terminal users</span></div>
        <CopyInstallCommand />
        <div className="install-notes">
          <span><Check /> Node.js 20+</span>
          <span><Check /> Terminal-first</span>
          <span><Check /> Multi-provider</span>
        </div>
      </div>
    </section>
  );
}

function Footer(): React.JSX.Element {
  return (
    <footer>
      <BrandMark />
      <p>THE AGENTIC DEVELOPMENT ENVIRONMENT.</p>
      <div><span>© 2026 QUAKE CODE</span><a href="#top">BACK TO TOP ↑</a></div>
    </footer>
  );
}

function LandingPage(): React.JSX.Element {
  useLandingEffects();
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Navigation />
      <main id="main">
        <Hero />
        <ActionTicker />
        <LaunchStrip />
        <SystemManifesto />
        <ProductStage />
        <Surfaces />
        <Intelligence />
        <Principles />
        <Install />
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LandingPage />
  </React.StrictMode>,
);
