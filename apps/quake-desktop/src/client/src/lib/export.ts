import type { ToolCardState } from "../state/app-store";

export interface ExportOptions {
  format: "markdown" | "json" | "pdf";
  includeTools?: boolean;
  includeThinking?: boolean;
}

export function exportConversation(messages: any[], tools: Record<string, ToolCardState>, options: ExportOptions): string {
  if (options.format === "json") return exportAsJSON(messages, tools, options);
  if (options.format === "markdown") return exportAsMarkdown(messages, tools, options);
  return exportAsMarkdown(messages, tools, options);
}

function exportAsJSON(messages: any[], tools: Record<string, ToolCardState>, options: ExportOptions): string {
  const data = {
    exportedAt: new Date().toISOString(),
    format: "quake-web-session",
    version: 1,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      id: m.id,
    })),
    tools: options.includeTools ? Object.values(tools).map((t) => ({
      name: t.toolName,
      status: t.status,
      args: t.args,
      output: t.output,
      durationMs: t.durationMs,
    })) : undefined,
  };
  return JSON.stringify(data, null, 2);
}

function exportAsMarkdown(messages: any[], tools: Record<string, ToolCardState>, options: ExportOptions): string {
  const lines: string[] = [
    "# Quake Code Sohbet Dışa Aktarımı",
    "",
    `Dışa aktarıldı: ${new Date().toLocaleString("tr-TR")}`,
    "",
    "---",
    "",
  ];

  for (const message of messages) {
    if (message.role === "toolResult") continue;
    const role = message.role === "user" ? "Kullanıcı" : message.role === "assistant" ? "Asistan" : message.role;
    const text = extractText(message);
    
    if (!text.trim()) continue;
    
    lines.push(`## ${role}`, "");
    
    if (options.includeThinking && message.role === "assistant") {
      const thinking = extractThinking(text);
      if (thinking) {
        lines.push("> **Düşünce:**", `> ${thinking.replace(/\n/g, "\n> ")}`, "");
      }
    }
    
    const cleanText = options.includeThinking ? text : removeThinkingBlocks(text);
    lines.push(cleanText, "");
    lines.push("---", "");
  }

  return lines.join("\n");
}

function extractText(message: any): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p: any) => p.type === "text" || p.type === "thinking")
      .map((p: any) => p.text || "")
      .join("\n");
  }
  return "";
}

function extractThinking(text: string): string | undefined {
  const match = text.match(/\[thinking\]([\s\S]*?)\[\/thinking\]/);
  return match?.[1]?.trim();
}

function removeThinkingBlocks(text: string): string {
  return text.replace(/\[thinking\][\s\S]*?\[\/thinking\]/g, "").trim();
}

export function downloadFile(content: string, filename: string, mimeType: string = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importSession(data: string): { messages: any[]; error?: string } {
  try {
    const parsed = JSON.parse(data);
    if (parsed.format === "quake-web-session" && Array.isArray(parsed.messages)) {
      return { messages: parsed.messages };
    }
    return { messages: [], error: "Geçersiz format" };
  } catch {
    return { messages: [], error: "JSON ayrıştırılamadı" };
  }
}
