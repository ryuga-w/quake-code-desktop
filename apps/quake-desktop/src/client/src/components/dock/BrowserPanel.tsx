import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CirclePlus,
  EllipsisVertical,
  Globe,
  Info,
  RotateCw,
  X,
} from "lucide-react";
import { isDesktop, desktop, type ElementInspectResult } from "../../lib/desktop";
import {
  buildBrowserAnnotationContext,
  type BrowserAnnotation,
  type BrowserAnnotationBundle,
} from "../../lib/browser-annotations";
import styles from "./BrowserPanel.module.css";

const DEFAULT_URL = "https://www.google.com";

function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("about:")) return value;
  const looksLikeHost = /^[^\s/]+\.[^\s/]+/.test(value) || value.startsWith("localhost");
  if (looksLikeHost) {
    const isLocal = value.startsWith("localhost")
      || /^127\.0\.0\.1/.test(value)
      || /^0\.0\.0\.0/.test(value);
    return `${isLocal ? "http" : "https"}://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function compactAddress(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.replace(/^www\./, "") || raw;
    }
  } catch {
    // Keep incomplete user input readable until it can be normalized.
  }
  return raw;
}

function fallbackPageTitle(raw: string): string {
  const compact = compactAddress(raw);
  return compact || "Tarayıcı";
}

type NavigationState = {
  history: string[];
  index: number;
};

type SessionBrowserState = {
  nav: NavigationState;
  draft: string;
  title: string;
};

const browserStateBySession = new Map<string, SessionBrowserState>();

type BrowserPanelProps = {
  sessionKey: string;
  initialUrl?: string;
  onElementSelected?: (element: ElementInspectResult, comment?: string) => void;
  onAnnotationBundle?: (bundle: BrowserAnnotationBundle) => void;
  onMetadataChange?: (metadata: { title: string; url: string }) => void;
};

export function BrowserPanel({
  sessionKey,
  initialUrl,
  onElementSelected: _onElementSelected,
  onAnnotationBundle,
  onMetadataChange,
}: BrowserPanelProps) {
  const restoredState = useMemo(() => browserStateBySession.get(sessionKey), [sessionKey]);
  const start = useMemo(() => {
    if (restoredState) return restoredState.draft;
    if (initialUrl) return normalizeUrl(initialUrl);
    if (isDesktop) return "";
    return normalizeUrl(DEFAULT_URL);
  }, [initialUrl, restoredState]);

  const [nav, setNav] = useState<NavigationState>(() =>
    restoredState?.nav || (start ? { history: [start], index: 0 } : { history: [], index: -1 }),
  );
  const [draft, setDraft] = useState(restoredState?.draft || start);
  const [pageTitle, setPageTitle] = useState(restoredState?.title || "");
  const [addressFocused, setAddressFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nativeReady, setNativeReady] = useState(!isDesktop || Boolean(restoredState));
  const [nativeNavigation, setNativeNavigation] = useState({ canGoBack: false, canGoForward: false });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [inspectorActive, setInspectorActive] = useState(false);
  const [inspectorError, setInspectorError] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  const pickerRunIdRef = useRef(0);

  const { history, index } = nav;
  const current = index >= 0 ? history[index] : "";
  const canBack = isDesktop ? nativeNavigation.canGoBack : index > 0;
  const canForward = isDesktop
    ? nativeNavigation.canGoForward
    : index >= 0 && index < history.length - 1;

  useEffect(() => {
    browserStateBySession.set(sessionKey, { nav, draft, title: pageTitle });
  }, [sessionKey, nav, draft, pageTitle]);

  useEffect(() => {
    onMetadataChange?.({
      title: pageTitle.trim() || fallbackPageTitle(current),
      url: current,
    });
  }, [current, onMetadataChange, pageTitle]);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  const navigate = useCallback((rawUrl: string) => {
    const next = normalizeUrl(rawUrl);
    if (!next) return;
    setNav((previous) => {
      const base = previous.index >= 0
        ? previous.history.slice(0, previous.index + 1)
        : [];
      if (base[base.length - 1] === next) return previous;
      const merged = [...base, next];
      return { history: merged, index: merged.length - 1 };
    });
    setPageTitle("");
    setLoading(true);
  }, []);

  const go = useCallback(() => {
    const next = normalizeUrl(draft);
    if (!next) return;
    if (next === current) {
      if (isDesktop) desktop?.browser.reload();
      else setReloadNonce((value) => value + 1);
      setLoading(true);
      return;
    }
    navigate(next);
  }, [current, draft, navigate]);

  const back = useCallback(() => {
    if (isDesktop) {
      desktop?.browser.back();
      return;
    }
    setNav((previous) => {
      if (previous.index <= 0) return previous;
      setLoading(true);
      return { ...previous, index: previous.index - 1 };
    });
  }, []);

  const forward = useCallback(() => {
    if (isDesktop) {
      desktop?.browser.forward();
      return;
    }
    setNav((previous) => {
      if (previous.index >= previous.history.length - 1) return previous;
      setLoading(true);
      return { ...previous, index: previous.index + 1 };
    });
  }, []);

  const reload = useCallback(() => {
    if (!current) return;
    if (isDesktop) desktop?.browser.reload();
    else setReloadNonce((value) => value + 1);
    setLoading(true);
  }, [current]);

  const openExternal = useCallback(() => {
    if (!current) return;
    if (isDesktop && desktop?.browser.openExternal) {
      void desktop.browser.openExternal(current);
      return;
    }
    window.open(current, "_blank", "noopener,noreferrer");
  }, [current]);

  const resetInspector = useCallback(async () => {
    pickerRunIdRef.current += 1;
    setInspectorActive(false);
    if (isDesktop && desktop?.browser) await desktop.browser.clearHighlight();
  }, []);

  useEffect(() => {
    if (!isDesktop || !desktop?.browser) return;
    const browser = desktop.browser;
    if (!current) {
      browser.hide();
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;

    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        browser.hide();
        return;
      }
      browser.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    const resizeObserver = new ResizeObserver(syncBounds);
    resizeObserver.observe(viewport);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);
    syncBounds();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
      browser.hide();
    };
  }, [current]);

  useEffect(() => {
    if (!isDesktop || !desktop?.browser) return;
    const browser = desktop.browser;
    const syncNavigationState = () => {
      void browser.getNavigationState().then((state) => {
        setNativeNavigation({ canGoBack: state.canGoBack, canGoForward: state.canGoForward });
        if (state.url) setDraft(state.url);
        setPageTitle(state.title || "");
        setLoading(state.loading);
      }).catch(() => {});
    };
    const unsubscribeStart = browser.onDidStartLoading(() => {
      setLoading(true);
      syncNavigationState();
    });
    const unsubscribeStop = browser.onDidStopLoading(() => {
      setLoading(false);
      syncNavigationState();
    });
    const unsubscribeNavigate = browser.onDidNavigate((url: string) => {
      setDraft(url);
      setPageTitle("");
      setNav((previous) => {
        if (previous.history[previous.index] === url) return previous;
        const base = previous.history.slice(0, previous.index + 1);
        if (base[base.length - 1] === url) return previous;
        const merged = [...base, url];
        return { history: merged, index: merged.length - 1 };
      });
      syncNavigationState();
      void browser.cancelElementPicker();
      void resetInspector();
    });

    syncNavigationState();
    return () => {
      unsubscribeStart();
      unsubscribeStop();
      unsubscribeNavigate();
    };
  }, [resetInspector]);

  useEffect(() => {
    if (!isDesktop || !desktop?.browser) {
      setNativeReady(true);
      return;
    }
    if (restoredState) {
      setNativeReady(true);
      return;
    }
    let cancelled = false;
    void desktop.browser.getUrl().then((url) => {
      if (cancelled) return;
      if (url && url !== "about:blank") {
        setDraft(url);
        setNav({ history: [url], index: 0 });
      } else if (!initialUrl) {
        const fallback = normalizeUrl(DEFAULT_URL);
        setDraft(fallback);
        setNav({ history: [fallback], index: 0 });
      }
      setNativeReady(true);
    }).catch(() => {
      if (!cancelled) setNativeReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [initialUrl, restoredState]);

  useEffect(() => {
    if (!isDesktop || !desktop?.browser || !current || !nativeReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await desktop.browser.getUrl();
        if (cancelled || existing === current) return;
        await desktop.browser.navigate(current);
      } catch {
        // Native navigation failures are surfaced by the browser view itself.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, reloadNonce, nativeReady]);

  useEffect(() => () => {
    pickerRunIdRef.current += 1;
    if (isDesktop && desktop?.browser) {
      void desktop.browser.cancelElementPicker();
      void desktop.browser.clearHighlight();
      desktop.browser.hide();
    }
  }, []);

  const handleInspectorToggle = useCallback(() => {
    if (!isDesktop || !desktop?.browser || !current) return;
    const browser = desktop.browser;
    if (inspectorActive) {
      setInspectorError("");
      void browser.cancelElementPicker().finally(() => resetInspector());
      return;
    }

    const runId = pickerRunIdRef.current + 1;
    pickerRunIdRef.current = runId;
    setInspectorError("");
    setInspectorActive(true);

    void browser.startElementPicker().then(async (result) => {
      if (pickerRunIdRef.current !== runId) return;
      if (result.status === "cancelled") {
        setInspectorError("");
        await resetInspector();
        return;
      }
      if (result.status === "error") {
        await resetInspector();
        setInspectorError(result.message || "Element seçici başlatılamadı");
        return;
      }

      const createdAt = Date.now();
      const annotations = result.annotations.map((entry, index): BrowserAnnotation => ({
        id: `browser-annotation-${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        number: index + 1,
        target: entry.target,
        comment: entry.comment,
        createdAt,
      }));
      const screenshot = result.screenshot || "";
      if (!screenshot || !annotations.length) {
        await resetInspector();
        setInspectorError("Canlı sayfa görüntüsü alınamadı; seçimleri yeniden deneyin.");
        return;
      }

      const previewUrl = screenshot.startsWith("data:")
        ? screenshot
        : `data:image/png;base64,${screenshot}`;
      const title = result.documentTitle || current;
      onAnnotationBundle?.({
        url: current,
        title,
        annotations,
        image: {
          id: `browser-annotation-bundle-${createdAt}`,
          name: "browser-annotations.png",
          mimeType: "image/png",
          data: previewUrl.split(",")[1] || previewUrl,
          previewUrl,
          annotation: buildBrowserAnnotationContext(current, title, annotations),
          annotationTarget: `${annotations.length} açıklama`,
        },
      });
      setInspectorError("");
      await resetInspector();
    }).catch((error) => {
      if (pickerRunIdRef.current !== runId) return;
      const message = error instanceof Error ? error.message : "Element seçici başlatılamadı";
      void resetInspector().then(() => setInspectorError(message));
    });
  }, [current, inspectorActive, onAnnotationBundle, resetInspector]);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.navGroup}>
          <button type="button" className={styles.iconBtn} onClick={back} disabled={!canBack} aria-label="Geri" title="Geri">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={forward} disabled={!canForward} aria-label="İleri" title="İleri">
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconBtn} onClick={reload} disabled={!current} aria-label="Yenile" title="Yenile">
            <RotateCw size={14} className={loading ? styles.spin : undefined} aria-hidden="true" />
          </button>
        </div>

        <form className={styles.addressForm} onSubmit={(event) => { event.preventDefault(); go(); }}>
          <Globe size={14} className={styles.addressIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.address}
            value={addressFocused ? draft : compactAddress(draft)}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => {
              const input = event.currentTarget;
              setAddressFocused(true);
              requestAnimationFrame(() => input.select());
            }}
            onBlur={() => setAddressFocused(false)}
            placeholder={DEFAULT_URL}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Adres"
          />
        </form>

        <div className={styles.actionGroup}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.inspectorToggle} ${inspectorActive ? styles.inspectorToggleActive : ""}`}
            onClick={handleInspectorToggle}
            disabled={!isDesktop || !current}
            aria-pressed={inspectorActive}
            aria-label={inspectorActive ? "Canlı element seçiciyi kapat" : "Canlı element seçiciyi aç"}
            title={!isDesktop ? "Element seçici yalnızca masaüstü uygulamasında kullanılabilir" : inspectorActive ? "Not eklemeyi kapat" : "Not ekleme"}
          >
            <CirclePlus size={15} aria-hidden="true" />
            <span className={styles.inspectorLabel}>Not ekleme</span>
          </button>

          <button type="button" className={styles.iconBtn} onClick={openExternal} disabled={!current} aria-label="Yeni sekmede aç" title="Yeni sekmede aç">
            <EllipsisVertical size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {inspectorError && (
        <div className={styles.inspectorError} role="alert">
          <span>{inspectorError}</span>
          <button type="button" onClick={() => setInspectorError("")} aria-label="Uyarıyı kapat"><X size={13} /></button>
        </div>
      )}

      <div className={`${styles.viewport} ${inspectorActive ? styles.viewportInspector : ""}`} ref={viewportRef}>
        {!current ? (
          <div className={styles.placeholder}>
            <Globe size={28} aria-hidden="true" />
            <p className={styles.placeholderText}>Bir adres girin ve gezinmeye başlayın</p>
          </div>
        ) : isDesktop ? (
          <div className={styles.frame} style={{ background: "transparent" }} />
        ) : (
          <iframe
            key={`if-${index}-${reloadNonce}`}
            src={current}
            className={styles.frame}
            title="Tarayıcı"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
            onLoad={() => setLoading(false)}
          />
        )}
      </div>

      {!isDesktop && current && (
        <div className={styles.hint}>
          <Info size={12} aria-hidden="true" />
          <span>
            Web modunda bazı siteler güvenlik (X-Frame-Options/CSP) nedeniyle çerçeve içinde
            açılmaz. Masaüstü uygulamasında bu sınırlama yoktur.
          </span>
        </div>
      )}
    </div>
  );
}

export default BrowserPanel;
