import React, { useEffect, useRef, useState } from "react";
import { Search, FileText, MessageSquare, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { apiGet } from "../../lib/api";
import styles from "./SearchOverlay.module.css";

/**
 * Arama overlay'i (Codex "Arama"). Ortalanmış modal: backdrop, Esc ile kapanır,
 * input autofocus. GET /api/search?q= (debounce'lu) çağırır ve iki sonuç grubu
 * gösterir: "Dosyalar" (path + satır + eşleşen metin) ve "Sohbetler" (oturum adı
 * + snippet). Dosya sonucuna tıklayınca onOpenFile(path), sohbet sonucuna tıklayınca
 * onSwitchSession(path) çalışır.
 *
 * NavRail "Arama" düğmesi main.tsx'te bir state toggle (örn. searchOpen) açar;
 * searchOpen true iken <SearchOverlay onClose={…} onOpenFile={…} onSwitchSession={…} />
 * render edilir.
 *
 * API CONTRACT:
 *   GET /api/search?q= -> { files:[{path,line,text}], sessions:[{path,name,snippet}] }
 */

type SearchFileMatch = { path: string; line: number; text: string };
type SearchSessionMatch = { path: string; name: string; snippet: string };
type SearchResult = { files: SearchFileMatch[]; sessions: SearchSessionMatch[] };

const DEBOUNCE_MS = 220;
const MIN_QUERY = 1;

export function SearchOverlay({
  onClose,
  onOpenFile,
  onSwitchSession,
}: {
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onSwitchSession: (path: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult>({ files: [], sessions: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch. Son isteğin kazanması için stale yanıtları yok say.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResult({ files: [], sessions: [] });
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (cancelled) return;
          setResult({
            files: Array.isArray(data?.files) ? data.files : [],
            sessions: Array.isArray(data?.sessions) ? data.sessions : [],
          });
          setError(null);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setError(err?.message || t("runtime.search.failed"));
          setResult({ files: [], sessions: [] });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, t]);

  const hasQuery = query.trim().length >= MIN_QUERY;
  const total = result.files.length + result.sessions.length;
  const empty = hasQuery && !loading && !error && total === 0;

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-label={t("runtime.search.dialog")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className={styles.inputRow}>
          <Search size={18} strokeWidth={2} aria-hidden="true" className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("runtime.search.placeholder")}
            aria-label={t("runtime.search.queryLabel")}
            spellCheck={false}
            autoComplete="off"
          />
          {loading && <span className={styles.spinner} aria-hidden="true" />}
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t("runtime.search.close")}>
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.results}>
          {!hasQuery && <div className={styles.hint}>{t("runtime.search.hint")}</div>}

          {error && <div className={styles.error}>{error}</div>}

          {empty && <div className={styles.hint}>{t("runtime.search.noMatches")}</div>}

          {hasQuery && !error && result.files.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHead}>
                <FileText size={13} strokeWidth={2} aria-hidden="true" />
                <span>{t("runtime.search.files")}</span>
                <span className={styles.count}>{result.files.length}</span>
              </div>
              <ul className={styles.list}>
                {result.files.map((file, index) => (
                  <li key={`${file.path}:${file.line}:${index}`}>
                    <button
                      type="button"
                      className={styles.item}
                      onClick={() => {
                        onOpenFile(file.path);
                        onClose();
                      }}
                      title={file.path}
                    >
                      <span className={styles.itemTop}>
                        <FileText size={14} strokeWidth={2} aria-hidden="true" className={styles.itemIcon} />
                        <span className={styles.itemPath}>{file.path}</span>
                        <span className={styles.itemLine}>:{file.line}</span>
                      </span>
                      <span className={styles.itemText}>{file.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasQuery && !error && result.sessions.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHead}>
                <MessageSquare size={13} strokeWidth={2} aria-hidden="true" />
                <span>{t("runtime.search.chats")}</span>
                <span className={styles.count}>{result.sessions.length}</span>
              </div>
              <ul className={styles.list}>
                {result.sessions.map((session, index) => (
                  <li key={`${session.path}:${index}`}>
                    <button
                      type="button"
                      className={styles.item}
                      onClick={() => {
                        onSwitchSession(session.path);
                        onClose();
                      }}
                      title={session.name || session.path}
                    >
                      <span className={styles.itemTop}>
                        <MessageSquare size={14} strokeWidth={2} aria-hidden="true" className={styles.itemIcon} />
                        <span className={styles.itemName}>{session.name || session.path}</span>
                      </span>
                      <span className={styles.itemText}>{session.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
