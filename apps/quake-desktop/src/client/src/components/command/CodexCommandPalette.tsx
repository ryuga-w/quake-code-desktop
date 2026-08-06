import React, { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  MessageSquarePlus,
  FolderOpen,
  Settings,
  Zap,
  Archive,
  Pin,
  ArrowUp,
  Search,
  FileSearch,
} from "lucide-react";
import { useI18n } from "../../i18n";
import { apiGet } from "../../lib/api";
import styles from "./CodexCommandPalette.module.css";

/**
 * Codex "Arama" — cmdk tabanlı KOMUT PALETİ (ortalı modal overlay).
 *
 * Görsel (codecodex-ref/arama.png) birebir hedef: koyu panel, gri uppercase bölüm
 * başlıkları, her satırın sağında kbd kısayolu. Bölümler: Sohbetler / Önerilen /
 * Sohbet / Gezinme. Input'a yazılınca ek olarak "Dosyalarda ara" komutu görünür.
 *
 * Tüm callback propları OPSİYONEL — entegratör bağlamadıklarını no-op geçebilir.
 * cmdk filtreleme komut/sohbet etiketleri üzerinden çalışır.
 */

export type CodexRecentSession = {
  /** Sohbet dosya yolu — onOpenSession(path) ile açılır. */
  path: string;
  /** Sol tarafta görünen sohbet adı. */
  name: string;
  /** Sağ tarafta gri görünen proje adı (ör. "quake code"). */
  project?: string;
};

export function CodexCommandPalette({
  open,
  onClose,
  recentSessions = [],
  onOpenSession,
  onNewChat,
  onOpenFolder,
  onSettings,
  onQuickChat,
  onArchive,
  onTogglePin,
  onPrevChat,
  onFileSearch,
}: {
  open: boolean;
  onClose: () => void;
  recentSessions?: CodexRecentSession[];
  onOpenSession?: (path: string) => void | Promise<void>;
  onNewChat?: () => void | Promise<void>;
  onOpenFolder?: () => void | Promise<void>;
  onSettings?: () => void | Promise<void>;
  onQuickChat?: () => void | Promise<void>;
  onArchive?: () => void | Promise<void>;
  onTogglePin?: () => void | Promise<void>;
  onPrevChat?: () => void | Promise<void>;
  onFileSearch?: (query: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Açılışta input'a odaklan ve önceki sorguyu temizle.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const handle = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [open]);

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;

  const close = () => onClose();

  // Bir aksiyonu çalıştır, sonra paleti kapat. Bağlanmamış (undefined) callback'ler no-op.
  const run = (fn?: (...args: any[]) => void | Promise<void>, ...args: any[]) => {
    void Promise.resolve(fn?.(...args)).finally(close);
  };

  const sessions = useMemo(() => recentSessions.slice(0, PALETTE_SESSION_LIMIT), [recentSessions]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <Command
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={t("runtime.codexPalette.dialog")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className={styles.inputRow}>
          <Search size={16} strokeWidth={2} aria-hidden="true" className={styles.searchIcon} />
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t("runtime.codexPalette.placeholder")}
            className={styles.input}
          />
        </div>

        <Command.List className={styles.list}>
          <Command.Empty className={styles.empty}>{t("runtime.codexPalette.noMatches")}</Command.Empty>

          {sessions.length > 0 && (
            <Command.Group heading={t("runtime.codexPalette.chats")} className={styles.group}>
              {sessions.map((session, index) => (
                <Command.Item
                  key={`session:${session.path}:${index}`}
                  value={`sohbet ${session.name} ${session.project || ""} ${session.path}`}
                  onSelect={() => run(onOpenSession, session.path)}
                  className={styles.item}
                >
                  <span className={styles.itemLabel}>{session.name}</span>
                  <span className={styles.itemMeta}>
                    {session.project && <span className={styles.itemProject}>{session.project}</span>}
                    {index < 3 && <kbd className={styles.kbd}>Ctrl+{index + 1}</kbd>}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading={t("runtime.codexPalette.suggested")} className={styles.group}>
            <PaletteItem
              icon={<MessageSquarePlus size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.commandPalette.newChat")}
              shortcut="Ctrl+N"
              value="yeni sohbet new chat"
              onSelect={() => run(onNewChat)}
            />
            <PaletteItem
              icon={<FolderOpen size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.openFolder")}
              shortcut="Ctrl+O"
              value="klasoru ac open folder"
              onSelect={() => run(onOpenFolder)}
            />
            <PaletteItem
              icon={<Settings size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.settings")}
              shortcut="Ctrl+,"
              value="ayarlar settings"
              onSelect={() => run(onSettings)}
            />
          </Command.Group>

          <Command.Group heading={t("runtime.codexPalette.chat")} className={styles.group}>
            <PaletteItem
              icon={<Zap size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.quickChat")}
              shortcut="Ctrl+Alt+N"
              value="yeni hizli sohbet quick chat"
              onSelect={() => run(onQuickChat)}
            />
            <PaletteItem
              icon={<Archive size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.archiveChat")}
              shortcut="Ctrl+Shift+A"
              value="sohbeti arsivle archive"
              onSelect={() => run(onArchive)}
            />
            <PaletteItem
              icon={<Pin size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.togglePin")}
              shortcut="Ctrl+Alt+P"
              value="sabitlemeyi ac kapat toggle pin"
              onSelect={() => run(onTogglePin)}
            />
          </Command.Group>

          <Command.Group heading={t("runtime.codexPalette.navigation")} className={styles.group}>
            <PaletteItem
              icon={<ArrowUp size={16} strokeWidth={2} aria-hidden="true" />}
              label={t("runtime.codexPalette.previousChat")}
              shortcut="Ctrl+Shift+["
              value="onceki sohbet previous chat"
              onSelect={() => run(onPrevChat)}
            />
          </Command.Group>

          {hasQuery && (
            <Command.Group heading={t("runtime.codexPalette.search")} className={styles.group}>
              <PaletteItem
                icon={<FileSearch size={16} strokeWidth={2} aria-hidden="true" />}
                label={t("runtime.codexPalette.searchFiles", { query: trimmed })}
                value={`dosyalarda ara ${trimmed} file search`}
                onSelect={() => runFileSearch(trimmed, onFileSearch, close)}
              />
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

const PALETTE_SESSION_LIMIT = 8;

function PaletteItem({
  icon,
  label,
  shortcut,
  value,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item value={value} onSelect={onSelect} className={styles.item}>
      <span className={styles.itemMain}>
        <span className={styles.itemIcon}>{icon}</span>
        <span className={styles.itemLabel}>{label}</span>
      </span>
      {shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>}
    </Command.Item>
  );
}

// "Dosyalarda ara": entegratör onFileSearch bağladıysa onu çağır (SearchOverlay açabilir).
// Bağlamadıysa inline /api/search'i tetikle (fire-and-forget) ve paleti kapat.
function runFileSearch(
  query: string,
  onFileSearch: ((query: string) => void | Promise<void>) | undefined,
  close: () => void,
) {
  if (onFileSearch) {
    void Promise.resolve(onFileSearch(query)).finally(close);
    return;
  }
  void apiGet(`/api/search?q=${encodeURIComponent(query)}`).catch(() => undefined);
  close();
}
