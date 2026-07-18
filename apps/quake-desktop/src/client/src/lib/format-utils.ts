import type React from "react";
import { formatModelDisplayLabel } from "./models";

export function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["ts", "tsx", "js", "jsx"].includes(ext || "")) return "TS";
  if (["json", "jsonl"].includes(ext || "")) return "{}";
  if (["md", "mdx"].includes(ext || "")) return "MD";
  if (["css", "scss"].includes(ext || "")) return "#";
  if (["html"].includes(ext || "")) return "<>";
  return "•";
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(value: number): string {
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function thinkingLabel(level: string): string {
  if (level === "max") return "Maksimum";
  if (level === "xhigh") return "Çok Yüksek";
  if (level === "high") return "Yüksek";
  if (level === "medium") return "Orta";
  if (level === "low") return "Sınırlı";
  if (level === "minimal") return "Minimal";
  if (level === "off") return "Kapalı";
  return level || "Orta";
}

export function formatComposerModelLabel(value: string): string {
  // Shared with Settings → Modeller (Quake Free labels etc.)
  return formatModelDisplayLabel(value);
}

export function normalizeQueuedTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function statusLabel(status: string): string {
  if (status === "done") return "Tamamlandı";
  if (status === "error") return "Dikkat gerekiyor";
  if (status === "running" || status === "streaming") return "Çalışıyor";
  if (status === "queued") return "Sırada";
  return status;
}

export function handleActivationKey(event: React.KeyboardEvent, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export function statusFilterLabel(value: string): string {
  if (value === "all") return "Tümü";
  return statusLabel(value);
}

export function changeKindLabel(value: "created" | "modified" | "deleted"): string {
  if (value === "created") return "oluşturuldu";
  if (value === "deleted") return "silindi";
  return "düzenlendi";
}

export function shortPath(value: unknown): string {
  const text = String(value);
  return text.length > 96 ? `…${text.slice(-93)}` : text;
}
