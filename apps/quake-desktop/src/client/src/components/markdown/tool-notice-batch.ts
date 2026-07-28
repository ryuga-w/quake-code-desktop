const TOOL_CALL_RE = /^\[tool call:\s*([^\]]+)\]$/i;

export type ToolNoticeBatch = {
  names: string[];
  nextIndex: number;
};

export function matchToolCallNotice(line: string): string | undefined {
  const match = line.trim().match(TOOL_CALL_RE);
  return match?.[1]?.trim();
}

export function collectToolNoticeBatch(lines: string[], startIndex: number): ToolNoticeBatch | undefined {
  const first = matchToolCallNotice(lines[startIndex] || "");
  if (!first) return undefined;

  const names: string[] = [first];
  let cursor = startIndex + 1;

  while (cursor < lines.length) {
    const trimmed = lines[cursor].trim();
    if (!trimmed) {
      cursor += 1;
      continue;
    }

    const next = matchToolCallNotice(trimmed);
    if (!next) break;
    names.push(next);
    cursor += 1;
  }

  return { names, nextIndex: cursor };
}
