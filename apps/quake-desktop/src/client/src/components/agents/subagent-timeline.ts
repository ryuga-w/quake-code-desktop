import type { WebSubagentActivity } from "../../../../shared/protocol";

function eventTime(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function projectSubagentTimeline(messages: any[], activities: WebSubagentActivity[]): any[] {
  const projected = [...messages];
  const existingToolCallIds = new Set<string>();
  const existingToolResultIds = new Set<string>();
  for (const message of messages) {
    if (message?.role === "toolResult" && message.toolCallId) existingToolResultIds.add(String(message.toolCallId));
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (part?.type === "toolCall" && (part.id || part.toolCallId)) {
        existingToolCallIds.add(String(part.id || part.toolCallId));
      }
    }
  }

  const users = messages
    .filter((message) => message?.role === "user")
    .map((message, index) => ({ time: eventTime(message.timestamp, index + 1), turnId: index + 1 }))
    .sort((left, right) => left.time - right.time);
  const turnAt = (time: number) => {
    let turnId = 1;
    for (const user of users) {
      if (user.time > time) break;
      turnId = user.turnId;
    }
    return turnId;
  };

  for (const activity of activities) {
    const startedAt = eventTime(activity.startedAt, Date.now());
    const updatedAt = Math.max(startedAt, eventTime(activity.updatedAt, startedAt));
    const turnId = turnAt(startedAt);
    if (!existingToolCallIds.has(activity.id)) {
      projected.push({
        id: `subagent-tool-call:${activity.id}`,
        role: "assistant",
        turnId,
        timestamp: startedAt,
        content: [{
          type: "toolCall",
          id: activity.id,
          name: activity.toolName,
          arguments: activity.input || "",
        }],
        __subagentActivity: true,
      });
    }
    if (activity.status !== "running" && !existingToolResultIds.has(activity.id)) {
      projected.push({
        id: `subagent-tool-result:${activity.id}`,
        role: "toolResult",
        turnId,
        toolCallId: activity.id,
        toolName: activity.toolName,
        timestamp: updatedAt,
        isError: activity.status === "error",
        content: activity.output || (activity.status === "error" ? "Araç çalışması hata verdi." : "Araç çalışması tamamlandı."),
        __subagentActivity: true,
      });
    }
  }

  return projected
    .map((message, index) => ({ message, index, time: eventTime(message?.timestamp, index + 1) }))
    .sort((left, right) => left.time - right.time || left.index - right.index)
    .map((entry) => entry.message);
}
