import React, { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { formatDate, formatSessionTitle } from "../../lib/render";
import { formatModelRefLabel } from "../../lib/models";
import { useAppStore } from "../../state/app-store";
import styles from "./CommandPalette.module.css";

const PALETTE_COMMAND_LIMIT = 240;
const PALETTE_FILE_LIMIT = 1_200;
const PALETTE_FILE_IDLE_LIMIT = 180;
const PALETTE_SESSION_LIMIT = 600;
const PALETTE_SESSION_IDLE_LIMIT = 90;

export function CommandPalette({
  onClose,
  onRunCommand,
  onOpenFile,
  onSwitchSession,
  onSetModel,
  onAction,
}: {
  onClose: () => void;
  onRunCommand: (command: string) => void | Promise<void>;
  onOpenFile: (path: string) => void;
  onSwitchSession: (path: string) => void | Promise<void>;
  onSetModel: (value: string) => void;
  onAction: (action: string) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commands = useAppStore((s) => s.commands);
  const files = useAppStore((s) => s.files);
  const sessions = useAppStore((s) => s.sessions);
  const models = useAppStore((s) => s.models);
  const showToast = useAppStore((s) => s.showToast);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const mode = query.startsWith(">") ? "command" : query.startsWith("@") ? "file" : "all";
  const q = (mode === "all" ? query : query.slice(1)).trim();

  const items = useMemo<PaletteItem[]>(() => {
    const action = (id: string, title: string, subtitle: string, hint: string, name: string): PaletteItem => ({
      id: `action:${id}`,
      type: "Action",
      title,
      subtitle,
      hint,
      keywords: [title, subtitle, hint],
      run: () => onAction(name),
    });
    const staticItems: PaletteItem[] = [
      action("new", "Yeni sohbet", "Temiz bir konuşma başlat", "yeni", "new"),
      action("refresh", "Durumu yenile", "Yapılandırma, sohbetler, modeller ve dosyaları tazele", "yenile", "refresh"),
      action("terminal", "Terminali aç", "Komut çıktıları ve canlı oturum akışları", "terminal", "terminal"),
      action("files", "Dosyaları göster", "Çalışma alanı gezgini ve dosya önizlemeleri", "dosyalar", "files"),
      action("settings", "Ayarları aç", "Tema, model varsayılanları, kimlik ve terminal politikası", "ayarlar", "settings"),
      action("toggle-left", "Sol menüyü değiştir", "Gezinti alanını odaklı moda al", "yerleşim", "toggle-left"),
      action("abort", "Aktif yanıtı durdur", "Çalışan agent yanıtını kes", "durdur", "abort"),
    ];
    return [
      ...(mode === "all" ? staticItems : []),
      ...(mode !== "file"
        ? selectPaletteCandidates(commands, q, PALETTE_COMMAND_LIMIT, commandSearchText).map((command: any, index: number) => ({
            id: `command:${command.source || ""}:${command.name}:${index}`,
            type: "Command" as const,
            title: command.name,
            subtitle: command.description || command.source,
            keywords: [command.name, command.description, command.source].filter(Boolean) as string[],
            hint: ">",
            run: () => onRunCommand(command.name),
          }))
        : []),
      ...(mode !== "command"
        ? selectPaletteCandidates(files, q, q ? PALETTE_FILE_LIMIT : PALETTE_FILE_IDLE_LIMIT, fileSearchText, (entry: any) => entry.type !== "directory").map((entry: any, index: number) => ({
            id: `file:${entry.path}:${index}`,
            type: "File" as const,
            title: entry.name,
            subtitle: entry.path,
            keywords: [entry.name, entry.path].filter(Boolean) as string[],
            hint: "@",
            run: () => onOpenFile(entry.path),
          }))
        : []),
      ...(mode === "all"
        ? selectPaletteCandidates(sessions, q, q ? PALETTE_SESSION_LIMIT : PALETTE_SESSION_IDLE_LIMIT, sessionSearchText).map((session: any, index: number) => ({
            id: `session:${session.path}:${index}`,
            type: "Session" as const,
            title: formatSessionTitle(session),
            subtitle: `${formatDate(session.modified)} · ${session.messageCount} mesaj`,
            keywords: [session.name, session.firstMessage, session.id].filter(Boolean) as string[],
            hint: "sürdür",
            run: () => onSwitchSession(session.path),
          }))
        : []),
      ...(mode === "all"
        ? models.filter((model: any) => model.configured).map((model: any, index: number) => ({
            id: `model:${model.provider}/${model.id}:${index}`,
            type: "Model" as const,
            title: formatModelRefLabel(model),
            subtitle: model.current ? "Geçerli model" : model.provider === "opencode-free" ? "Quake Code Free" : model.name || "Tanımlı",
            keywords: [model.provider, model.id, model.name, "quake free", "free"].filter(Boolean) as string[],
            hint: "model",
            run: () => onSetModel(`${model.provider}/${model.id}`),
          }))
        : []),
    ];
  }, [commands, files, mode, models, onAction, onOpenFile, onRunCommand, onSetModel, onSwitchSession, q, sessions]);

  const runById = useMemo(() => {
    // cmdk lowercases item `value` and echoes that lowercased string back to onSelect,
    // so key the dispatch map by the lowercased id to guarantee a hit.
    const map = new Map<string, () => void | Promise<void>>();
    for (const item of items) map.set(item.id.toLowerCase(), item.run);
    return map;
  }, [items]);

  const grouped = useMemo(() => groupPaletteItems(items), [items]);

  const execute = (run: (() => void | Promise<void>) | undefined) => {
    if (!run) return;
    void Promise.resolve(run())
      .catch((error: any) => showToast(`Komut çalıştırılamadı: ${error?.message || "bilinmeyen hata"}`, "error"))
      .finally(onClose);
  };

  // cmdk lowercases item values; match on the stable (lowercased) id and dispatch the mapped action.
  const handleSelect = (value: string) => execute(runById.get(value.toLowerCase()));

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <Command
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Komut paleti"
        // cmdk values are lowercased; our ids are already lowercase-stable, so filter on the raw query (q) against keywords/value.
        shouldFilter={Boolean(q)}
        filter={(value, search, keywords) => paletteFilter(value, search, keywords)}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab" && mode === "all") {
            event.preventDefault();
            setQuery(query.startsWith("@") ? ">" : "@");
          }
        }}
      >
        <div className={styles.inputRow}>
          <span aria-hidden="true">{mode === "command" ? ">" : mode === "file" ? "@" : <SearchGlyph />}</span>
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={mode === "command" ? "Komut ara…" : mode === "file" ? "Dosya ara…" : "Aksiyon, dosya veya sohbet ara…"}
          />
        </div>
        <Command.List className={styles.list}>
          <Command.Empty className={styles.empty}>Eşleşme yok</Command.Empty>
          {grouped.map((group) => (
            <Command.Group key={group.type} heading={paletteTypeLabel(group.type)} className={styles.group}>
              {group.items.map((item) => (
                <Command.Item key={item.id} value={item.id} keywords={item.keywords} onSelect={handleSelect} className={styles.item}>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

type PaletteItem = {
  id: string;
  type: "Action" | "Command" | "File" | "Session" | "Model";
  title: string;
  subtitle: string;
  hint: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

// cmdk's default filter matches against the item value, but our values are opaque ids.
// Match against the human-readable keywords (title/subtitle/source) instead. Returns a
// score > 0 to keep an item, 0 to hide it.
function paletteFilter(_value: string, search: string, keywords?: string[]): number {
  // The input still carries the mode prefix (">"/"@"); strip it so matching aligns
  // with the bounded candidate set (which already searched on the prefix-stripped query).
  const stripped = search.startsWith(">") || search.startsWith("@") ? search.slice(1) : search;
  const q = stripped.trim().toLowerCase();
  if (!q) return 1;
  const hay = (keywords || []).join(" ").toLowerCase();
  if (!hay) return 0;
  if (hay.includes(q)) return 1;
  // subsequence (fuzzy) fallback so typing scattered characters still matches.
  let last = -1;
  for (const char of q) {
    const found = hay.indexOf(char, last + 1);
    if (found === -1) return 0;
    last = found;
  }
  return 0.5;
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="m20 20-4.2-4.2" />
      <circle cx="11" cy="11" r="6" />
    </svg>
  );
}

function selectPaletteCandidates<T>(items: T[], query: string, limit: number, searchText: (item: T) => string, include: (item: T) => boolean = () => true): T[] {
  const q = query.trim().toLowerCase();
  const direct: T[] = [];
  const fallback: T[] = [];
  for (const item of items) {
    if (!include(item)) continue;
    if (!q) {
      direct.push(item);
      if (direct.length >= limit) break;
      continue;
    }
    const haystack = searchText(item).toLowerCase();
    if (haystack.includes(q)) {
      direct.push(item);
      if (direct.length >= limit) break;
    } else if (fallback.length < limit) {
      fallback.push(item);
    }
  }
  return direct.length >= limit ? direct : [...direct, ...fallback.slice(0, limit - direct.length)];
}

function commandSearchText(command: any): string {
  return `${command?.name || ""} ${command?.description || ""} ${command?.source || ""}`;
}

function fileSearchText(entry: any): string {
  return `${entry?.name || ""} ${entry?.path || ""}`;
}

function sessionSearchText(session: any): string {
  return `${session?.name || ""} ${session?.firstMessage || ""} ${session?.id || ""}`;
}

function groupPaletteItems(items: PaletteItem[]): Array<{ type: PaletteItem["type"]; items: PaletteItem[] }> {
  const order: PaletteItem["type"][] = ["Action", "Command", "File", "Session", "Model"];
  return order.map((type) => ({ type, items: items.filter((item) => item.type === type) })).filter((group) => group.items.length);
}

function paletteTypeLabel(type: PaletteItem["type"]): string {
  if (type === "Action") return "Aksiyon";
  if (type === "Command") return "Komut";
  if (type === "File") return "Dosya";
  if (type === "Session") return "Sohbet";
  return "Model";
}
