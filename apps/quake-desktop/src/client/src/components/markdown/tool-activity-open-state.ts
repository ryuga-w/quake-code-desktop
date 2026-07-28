import { useCallback, useEffect, useRef, useState } from "react";
import { getToolActivity } from "../../lib/tool-activity";
import type { ToolCardState } from "../../state/app-store";

const OPEN_TOOL_DETAILS = new Set<string>();
const CLOSED_TOOL_DETAILS = new Set<string>();

export function useDetailsOpen(id: string, defaultOpen = false): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (defaultOpen && !CLOSED_TOOL_DETAILS.has(id)) OPEN_TOOL_DETAILS.add(id);
    return OPEN_TOOL_DETAILS.has(id);
  });
  const idRef = useRef(id);

  useEffect(() => {
    if (idRef.current === id) {
      // Placeholder verisi gerçek dosya mutasyonuna dönüştüğünde aynı kimlik
      // korunur. Kullanıcı özellikle kapatmadıysa yeni varsayılanı uygula.
      if (defaultOpen && !CLOSED_TOOL_DETAILS.has(id)) OPEN_TOOL_DETAILS.add(id);
      const stored = OPEN_TOOL_DETAILS.has(id);
      setOpen((prev) => (prev === stored ? prev : stored));
      return;
    }
    // id degisti (or. live placeholder -> gercek toolCallId): acikligi tasi.
    if (OPEN_TOOL_DETAILS.has(idRef.current)) {
      OPEN_TOOL_DETAILS.delete(idRef.current);
      OPEN_TOOL_DETAILS.add(id);
    }
    if (CLOSED_TOOL_DETAILS.has(idRef.current)) {
      CLOSED_TOOL_DETAILS.delete(idRef.current);
      CLOSED_TOOL_DETAILS.add(id);
    }
    idRef.current = id;
    if (defaultOpen && !CLOSED_TOOL_DETAILS.has(id)) OPEN_TOOL_DETAILS.add(id);
    setOpen(OPEN_TOOL_DETAILS.has(id));
  }, [defaultOpen, id]);

  const update = useCallback((next: boolean) => {
    const key = idRef.current;
    if (next) {
      OPEN_TOOL_DETAILS.add(key);
      CLOSED_TOOL_DETAILS.delete(key);
    } else {
      OPEN_TOOL_DETAILS.delete(key);
      CLOSED_TOOL_DETAILS.add(key);
    }
    setOpen(next);
  }, []);

  return [open, update];
}

/** Outer tool-batch card key — must not change while the same batch is streaming. */
export function noticeOpenKey(turnId: number | undefined, names: string[]): string {
  const sorted = [...names].filter(Boolean).sort().join("|");
  return `notice:t${turnId ?? "x"}:${sorted}`;
}

/**
 * Inner tool-run row key. Prefer stable turn+tool+subject over raw toolCallId alone,
 * so open state survives id churn and remounts when the same command updates.
 */
export function runOpenKey(tool: ToolCardState): string {
  const activity = getToolActivity(tool);
  const subject = String(activity.subject || activity.argsSummary || activity.panelSubject || tool.toolName || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  // Include tool.id as soft suffix so two identical commands in one turn can differ,
  // but keep subject primary for open-state survival.
  return `run:t${tool.turnId ?? "x"}:${tool.toolName}:${subject}:${tool.id}`;
}

