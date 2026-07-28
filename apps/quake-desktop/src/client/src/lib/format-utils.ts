import type React from "react";
import { formatModelDisplayLabel } from "./models";
import type { ToolActivityLocale } from "./tool-activity";

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

export function thinkingLabel(level: string, locale: ToolActivityLocale = "tr"): string {
  if (locale === "en") {
    if (level === "max") return "Maximum";
    if (level === "xhigh") return "Very high";
    if (level === "high") return "High";
    if (level === "medium") return "Medium";
    if (level === "low") return "Low";
    if (level === "minimal") return "Minimal";
    if (level === "off") return "Off";
    return level || "Medium";
  }
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

export function statusLabel(status: string, locale: ToolActivityLocale = "tr"): string {
  if (locale === "en") {
    if (status === "done") return "Completed";
    if (status === "error") return "Needs attention";
    if (status === "running") return "Running";
    if (status === "streaming") return "Streaming";
    if (status === "queued") return "Queued";
    return status;
  }
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

export function statusFilterLabel(value: string, locale: ToolActivityLocale = "tr"): string {
  if (value === "all") return locale === "en" ? "All" : "Tümü";
  return statusLabel(value, locale);
}

export function changeKindLabel(value: "created" | "modified" | "deleted", locale: ToolActivityLocale = "tr"): string {
  if (locale === "en") {
    if (value === "created") return "created";
    if (value === "deleted") return "deleted";
    return "edited";
  }
  if (value === "created") return "oluşturuldu";
  if (value === "deleted") return "silindi";
  return "düzenlendi";
}

export function shortPath(value: unknown): string {
  const text = String(value);
  return text.length > 96 ? `…${text.slice(-93)}` : text;
}
