import React from "react";
import {
  Braces,
  Code2,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  Hash,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import type { WorkspaceEntry } from "./file-tree";
import styles from "./FilesPanel.module.css";

type FileIconTone = "code" | "json" | "text" | "style" | "image" | "config" | "shell" | "default";

export function TreeEntryIcon({ entry, expanded = false }: { entry: WorkspaceEntry; expanded?: boolean }) {
  if (entry.type === "directory") {
    const Icon = expanded ? FolderOpen : Folder;
    return <span className={`${styles.fileIcon} ${styles.folderIcon}`} aria-hidden="true"><Icon size={15} strokeWidth={1.85} /></span>;
  }
  const { Icon, tone } = resolveFileIcon(entry.name);
  return <span className={`${styles.fileIcon} ${styles[`tone_${tone}`]}`} aria-hidden="true"><Icon size={15} strokeWidth={1.85} /></span>;
}

function resolveFileIcon(name: string): { Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tone: FileIconTone } {
  const lower = name.toLowerCase();
  const extension = lower.includes(".") ? lower.split(".").pop() || "" : "";
  const base = lower.split("/").pop() || lower;
  if (["package.json", "package-lock.json", "tsconfig.json", "jsconfig.json", "components.json"].includes(base) || /\.config\.(js|ts|mjs)$/.test(base)) return { Icon: Settings2, tone: "config" };
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(extension)) return { Icon: FileCode2, tone: "code" };
  if (["json", "jsonc", "jsonl"].includes(extension)) return { Icon: FileJson, tone: "json" };
  if (["md", "mdx", "txt", "log", "rst"].includes(extension)) return { Icon: FileText, tone: "text" };
  if (["css", "scss", "sass", "less"].includes(extension)) return { Icon: Hash, tone: "style" };
  if (["html", "htm", "svg", "vue", "svelte"].includes(extension)) return { Icon: Code2, tone: "code" };
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"].includes(extension)) return { Icon: FileImage, tone: "image" };
  if (["sh", "bash", "zsh", "ps1", "bat", "cmd"].includes(extension)) return { Icon: TerminalSquare, tone: "shell" };
  if (["yml", "yaml", "toml", "ini", "env"].includes(extension) || base.startsWith(".env")) return { Icon: Settings2, tone: "config" };
  if (["py", "go", "rs", "java", "kt", "rb", "php", "cs"].includes(extension)) return { Icon: Braces, tone: "code" };
  if (["pdf", "doc", "docx"].includes(extension)) return { Icon: FileType2, tone: "text" };
  return { Icon: File, tone: "default" };
}
