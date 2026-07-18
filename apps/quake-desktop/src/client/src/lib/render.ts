export function textFromMessage(message: any): string {
  if (!message) return "";
  if (message.stopReason === "error" && message.errorMessage) {
    return `**Model hatası:** ${message.errorMessage}`;
  }
  if (message.role === "user" && typeof message.displayContent === "string") {
    return stripPlanClarificationBlocks(message.displayContent);
  }
  if (typeof message.content === "string") return renderMessageText(message, message.content);
  if (!Array.isArray(message.content)) return "";
  return renderMessageText(message, message.content
    .map((part: any) => {
      if (part.type === "text") return part.text || "";
      if (part.type === "thinking" || part.type === "reasoning") {
        const thinking = textFromThinkingPart(part);
        return thinking ? `[thinking]\n${thinking}\n[/thinking]` : message.__streaming ? "[thinking]\n[/thinking]" : "";
      }
      if (part.type === "toolCall") return `[tool call: ${part.name}]`;
      if (part.type === "image") return "";
      return `[${part.type}]`;
    })
    .filter(Boolean)
    .join("\n"));
}

function renderMessageText(message: any, text: string): string {
  const normalized = stripPlanClarificationBlocks(text);
  return message?.role === "user" ? stripLegacyComposerContext(normalized) : normalized;
}

/** Hide metadata emitted by older clients before user/model text was separated. */
function stripLegacyComposerContext(text: string): string {
  const boundaries = [
    text.search(/(?:^|\n\n)### Açıklama \d+[^\n]*\n\[Tarayıcı Açıklamaları\]/),
    text.search(/(?:^|\n\n)\[Bağlam\]\n### (?:file|terminal|tool|annotation):/),
  ].filter((index) => index >= 0);
  if (!boundaries.length) return text;
  const visible = text.slice(0, Math.min(...boundaries)).trim();
  return visible || "Bu görseli incele.";
}

export function stripPlanClarificationBlocks(text: string): string {
  return String(text || "")
    .replace(/<\/?\s*proposed_plan\s*>/gi, "")
    .replace(/^\s*<\/?\s*proposed_plan[^>]*>?\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textFromThinkingPart(part: any): string {
  const candidates = [part.thinking, part.reasoning, part.summary, part.text, part.content];
  for (const candidate of candidates) {
    const text = stringifyThinkingValue(candidate).trim();
    if (text) return text;
  }
  return "";
}

function stringifyThinkingValue(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyThinkingValue).filter(Boolean).join("\n");
  if (typeof value === "object") {
    return stringifyThinkingValue(value.text ?? value.content ?? value.summary ?? value.reasoning ?? value.thinking ?? "");
  }
  return String(value);
}

export function textFromToolResult(result: any): string {
  if (!result || !Array.isArray(result.content)) return "";
  return result.content.map((part: any) => part.text || (part.type ? `[${part.type}]` : "")).join("\n");
}

export function formatDate(value: any): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

export function isDiff(text?: string): boolean {
  return Boolean(text && text.split("\n").some((line) => line.startsWith("+") || line.startsWith("-") || line.startsWith("@@")));
}

/**
 * Produces a clean, short display title for a session in sidebars.
 * Prefers explicit name, falls back to cleaned firstMessage.
 * Strips markdown links, URLs, repo paths, excessive length.
 */
export function formatSessionTitle(session: any, alias?: string): string {
  let raw = (alias || session?.name || session?.firstMessage || session?.id || "").toString().trim();
  if (!raw) return "Yeni sohbet";

  // Strip markdown links [text](url) → keep the visible text
  raw = raw.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");

  // Remove bare http/https URLs
  raw = raw.replace(/https?:\/\/\S+/gi, "");

  // Remove common git/repo path noise at the start
  raw = raw.replace(/^\s*[\[\(]?(?:https?:\/\/)?(?:github\.com\/|openai\/)?[^\s/]+\/[^\s/]+\.git[\]\)]?\s*/i, "");
  raw = raw.replace(/^\s*(?:repo|proje|klasör|folder|workspace)[:\s-]*/i, "");

  // Take first meaningful line
  let title = raw.split(/\r?\n/)[0].trim();

  // If it still looks like a long path or command, try to cut to first sentence-ish
  if (title.length > 70 || /[\\/]/.test(title) || title.includes("git")) {
    const sentenceMatch = title.match(/^(.{10,60}?)(?:[.!?]|$)/);
    if (sentenceMatch) title = sentenceMatch[1];
  }

  // Final hard truncate
  if (title.length > 58) {
    title = title.slice(0, 55).trimEnd() + "…";
  }

  // If after cleaning we have garbage (just symbols, very short), fallback
  const cleaned = title.replace(/[^\wÇçĞğİıÖöŞşÜü\s]/g, "").trim();
  if (cleaned.length < 3 || /^[\s\W]+$/.test(title)) {
    const shortId = (session?.id || "").toString().slice(0, 8);
    return shortId ? `Sohbet ${shortId}` : "Sohbet";
  }

  return title || "Yeni sohbet";
}
