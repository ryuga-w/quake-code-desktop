import React, { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import styles from "./AppErrorBoundary.module.css";

type CopyStatus = "idle" | "copied" | "failed";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  capturedAt: string;
  resetVersion: number;
  copyStatus: CopyStatus;
}

export interface AppErrorDiagnosticInput {
  error: Error;
  componentStack?: string;
  capturedAt?: string;
  url?: string;
  userAgent?: string;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Bilinmeyen arayüz hatası");
}

export function buildAppErrorDiagnostic({
  error,
  componentStack = "",
  capturedAt = new Date().toISOString(),
  url = typeof window === "undefined" ? "Bilinmiyor" : window.location.href,
  userAgent = typeof navigator === "undefined" ? "Bilinmiyor" : navigator.userAgent,
}: AppErrorDiagnosticInput): string {
  const sections = [
    "Quake Code arayüz tanı raporu",
    `Zaman: ${capturedAt}`,
    `Sayfa: ${url}`,
    `Kullanıcı aracısı: ${userAgent}`,
    `Hata: ${error.name}: ${error.message}`,
  ];

  if (error.stack) sections.push(`Hata yığını:\n${error.stack}`);
  if (componentStack.trim()) sections.push(`Bileşen yığını:${componentStack}`);
  return sections.join("\n\n");
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: "",
    capturedAt: "",
    resetVersion: 0,
    copyStatus: "idle",
  };

  static getDerivedStateFromError(value: unknown): Partial<AppErrorBoundaryState> {
    return {
      error: normalizeError(value),
      capturedAt: new Date().toISOString(),
      copyStatus: "idle",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
    console.error("Quake Code arayüzü beklenmedik bir hata verdi.", error, info);
  }

  private handleRetry = (): void => {
    this.setState((state) => ({
      error: null,
      componentStack: "",
      capturedAt: "",
      resetVersion: state.resetVersion + 1,
      copyStatus: "idle",
    }));
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleCopyDiagnostic = async (): Promise<void> => {
    const { error, componentStack, capturedAt } = this.state;
    if (!error) return;

    const diagnostic = buildAppErrorDiagnostic({ error, componentStack, capturedAt });

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostic);
      } else if (!copyWithTextarea(diagnostic)) {
        throw new Error("Tarayıcı kopyalama işlemini reddetti");
      }
      this.setState({ copyStatus: "copied" });
    } catch {
      this.setState({ copyStatus: "failed" });
    }
  };

  render(): ReactNode {
    const { children } = this.props;
    const { error, resetVersion, copyStatus } = this.state;

    if (!error) {
      return <Fragment key={resetVersion}>{children}</Fragment>;
    }

    return (
      <main className={styles.root} aria-labelledby="app-error-title">
        <section className={styles.card} role="alert" aria-describedby="app-error-description">
          <div className={styles.icon} aria-hidden="true">!</div>
          <p className={styles.eyebrow}>Quake Code</p>
          <h1 id="app-error-title" className={styles.title}>Beklenmedik bir arayüz hatası oluştu</h1>
          <p id="app-error-description" className={styles.description}>
            Çalışma alanındaki dosyalarına dokunulmadı. Arayüzü yeniden deneyebilir veya uygulamayı yenileyebilirsin.
          </p>

          <div className={styles.actions}>
            <button type="button" className={styles.primaryAction} onClick={this.handleRetry} autoFocus>
              Yeniden dene
            </button>
            <button type="button" className={styles.secondaryAction} onClick={this.handleReload}>
              Uygulamayı yenile
            </button>
            <button type="button" className={styles.secondaryAction} onClick={() => void this.handleCopyDiagnostic()}>
              Tanıyı kopyala
            </button>
          </div>

          <p className={styles.copyStatus} role="status" aria-live="polite">
            {copyStatus === "copied" && "Tanı bilgisi panoya kopyalandı."}
            {copyStatus === "failed" && "Tanı bilgisi kopyalanamadı. Uygulamayı yenileyip tekrar deneyebilirsin."}
          </p>

          <details className={styles.details}>
            <summary>Teknik ayrıntı</summary>
            <code>{error.name}: {error.message}</code>
          </details>
        </section>
      </main>
    );
  }
}

export default AppErrorBoundary;
