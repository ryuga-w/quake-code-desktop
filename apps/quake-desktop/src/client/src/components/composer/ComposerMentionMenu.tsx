import React from "react";
import { Braces, FileCode2, FileText, MessageCircle, Presentation, Sheet } from "lucide-react";
import { useAppStore } from "../../state/app-store";
import { getComposerAddMenuExtensions, type ComposerAddMenuExtensionKind } from "./composer-add-menu";
import styles from "./ComposerMentionMenu.module.css";

export type ComposerMentionMenuHandle = {
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

type MentionItem = {
  id: string;
  label: string;
  detail: string;
  insertText: string;
  kind: "extension" | "file" | "history";
  extensionKind?: ComposerAddMenuExtensionKind;
};

type Props = {
  prompt: string;
  promptHistory: string[];
  onPick: (value: string) => void;
};

const EXTENSION_MENTIONS = getComposerAddMenuExtensions([]).map((extension) => ({
  id: `extension:${extension.command}`,
  label: extension.label,
  detail: extension.description,
  insertText: extension.kind === "documents" ? "@documents " : `@${extension.command} `,
  kind: "extension" as const,
  extensionKind: extension.kind,
}));

export const ComposerMentionMenu = React.forwardRef<ComposerMentionMenuHandle, Props>(function ComposerMentionMenu(
  { prompt, promptHistory, onPick },
  ref,
) {
  const files = useAppStore((state) => state.files);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dismissedToken, setDismissedToken] = React.useState("");
  const match = prompt.match(/(^|\s)@([^\s@]*)$/);
  const token = match?.[0] || "";
  const query = (match?.[2] || "").toLocaleLowerCase("en-US");
  const tokenStart = match ? prompt.length - token.length + (match[1] ? match[1].length : 0) : -1;

  const items = React.useMemo<MentionItem[]>(() => {
    if (!match) return [];
    const extensionItems = EXTENSION_MENTIONS.filter((item) => mentionMatches(query, item.label, item.detail, item.insertText));
    const fileItems = files
      .filter((file: any) => file?.type !== "directory")
      .map((file: any): MentionItem => ({
        id: `file:${String(file.path || file.name)}`,
        label: String(file.name || file.path || "Dosya"),
        detail: parentPath(String(file.path || "")),
        insertText: `@${String(file.path || file.name)} `,
        kind: "file",
      }))
      .filter((item) => mentionMatches(query, item.label, item.detail))
      .slice(0, 6);
    const historyItems = promptHistory
      .filter((entry) => entry.trim() && !entry.trim().startsWith("@"))
      .map((entry): MentionItem => ({
        id: `history:${entry}`,
        label: entry,
        detail: "",
        insertText: entry,
        kind: "history",
      }))
      .filter((item) => mentionMatches(query, item.label))
      .slice(0, 5);
    return [...extensionItems, ...fileItems, ...historyItems].slice(0, 10);
  }, [files, match, promptHistory, query]);

  const open = Boolean(match) && dismissedToken !== token;
  const boundedIndex = Math.min(activeIndex, Math.max(0, items.length - 1));

  React.useEffect(() => {
    setActiveIndex(0);
    if (dismissedToken && dismissedToken !== token) setDismissedToken("");
  }, [query, token, dismissedToken]);

  const pick = React.useCallback((item: MentionItem) => {
    if (item.kind === "history") {
      onPick(item.insertText);
      return;
    }
    const before = tokenStart >= 0 ? prompt.slice(0, tokenStart) : prompt;
    onPick(`${before}${item.insertText}`);
  }, [onPick, prompt, tokenStart]);

  React.useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedToken(token);
        return true;
      }
      if (!items.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + delta + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        pick(items[boundedIndex]);
        return true;
      }
      return false;
    },
  }), [boundedIndex, items, open, pick, token]);

  if (!open) return null;

  return (
    <div className={styles.menu} role="listbox" aria-label="Composer eklemeleri">
      {items.length ? items.map((item, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === boundedIndex}
          className={styles.item}
          data-active={index === boundedIndex ? "true" : undefined}
          key={item.id}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => pick(item)}
        >
          <MentionIcon item={item} />
          <span className={styles.label}>{item.label}</span>
          {item.detail ? <span className={styles.detail}>{item.detail}</span> : null}
        </button>
      )) : <div className={styles.empty}>Eşleşme bulunamadı</div>}
    </div>
  );
});

function MentionIcon({ item }: { item: MentionItem }) {
  if (item.kind === "history") return <MessageCircle size={14} strokeWidth={1.8} aria-hidden="true" />;
  if (item.kind === "file") {
    const extension = item.label.split(".").pop()?.toLowerCase();
    if (["ts", "tsx", "js", "jsx"].includes(extension || "")) return <FileCode2 size={14} strokeWidth={1.8} aria-hidden="true" />;
    if (["css", "scss", "less"].includes(extension || "")) return <Braces size={14} strokeWidth={1.8} aria-hidden="true" />;
    return <FileText size={14} strokeWidth={1.8} aria-hidden="true" />;
  }
  if (item.extensionKind === "spreadsheets") return <Sheet size={14} strokeWidth={1.8} aria-hidden="true" />;
  if (item.extensionKind === "presentations") return <Presentation size={14} strokeWidth={1.8} aria-hidden="true" />;
  return <span className={styles.documentIcon} aria-hidden="true"><FileText size={11} strokeWidth={2} /></span>;
}

function mentionMatches(query: string, ...values: string[]): boolean {
  if (!query) return true;
  return values.some((value) => value.toLocaleLowerCase("en-US").includes(query));
}

function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}
