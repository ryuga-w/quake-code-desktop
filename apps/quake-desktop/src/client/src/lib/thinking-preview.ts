const LEADING_CONTINUATION_MARKER = /^(?:(?:\.{2,}|…+|⋯+)\s*)+/;

function stripLeadingContinuationMarker(value: string): string {
  return value.replace(LEADING_CONTINUATION_MARKER, "").trimStart();
}

export function latestPublishedThinkingSummary(content: string): string {
  const lines = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
      .replace(/[`*_>#]/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  let summary = lines.at(-1) || "";
  if (summary.length < 24 && lines.length > 1) summary = `${lines.at(-2)} ${summary}`.trim();
  summary = stripLeadingContinuationMarker(summary);
  summary = summary.replace(/^(?:thinking|analysis|reasoning)\s*:?\s*/i, "").trim();
  summary = stripLeadingContinuationMarker(summary);
  if (!summary) return "";

  const maxLength = 156;
  if (summary.length <= maxLength) return summary;

  // Keep the newest live thought rather than freezing the first 156 characters,
  // but start at a clean word boundary without a distracting leading ellipsis.
  const tail = summary.slice(-maxLength);
  const wordBoundaryTail = tail.replace(/^\S+\s+/, "");
  return stripLeadingContinuationMarker(wordBoundaryTail || tail).trim();
}
