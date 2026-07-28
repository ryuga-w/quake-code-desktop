import type { ToolDefinition } from "@mrquake/quakecode-cli";

export type ScheduleTaskInput = {
  name: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
};

export type ScheduleTaskResult = ScheduleTaskInput & {
  id: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun: string | null;
  createdAt?: string;
};

export type ScheduleTaskCreator = (input: ScheduleTaskInput) => Promise<ScheduleTaskResult>;

/** Runtime tool used by the "Create with chat" flow. */
export function createScheduleTaskToolDefinition(
  getCreator: () => ScheduleTaskCreator | undefined,
): ToolDefinition {
  return {
    name: "create_scheduled_task",
    label: "create_scheduled_task",
    description:
      "Create a recurring scheduled task for the current workspace. Use a valid five-field cron expression, a short task name, and the exact prompt that should run on schedule.",
    promptSnippet: "Create a recurring scheduled task in the current workspace",
    promptGuidelines: [
      "Use this tool when the user asks to run a task later, repeatedly, daily, weekly, or on a schedule.",
      "Convert natural-language timing into a five-field cron expression before calling the tool.",
      "If the task name, schedule, or work to perform is unclear, ask a concise follow-up question first.",
    ],
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short human-readable name for the scheduled task.",
        },
        cron: {
          type: "string",
          description: "A valid five-field cron expression, for example 0 9 * * 1-5.",
        },
        prompt: {
          type: "string",
          description: "The exact instruction to run when the schedule fires.",
        },
        enabled: {
          type: "boolean",
          description: "Whether the task should be enabled immediately. Defaults to true.",
        },
      },
      required: ["name", "cron", "prompt"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params) {
      const input = params as Partial<ScheduleTaskInput> | undefined;
      const name = typeof input?.name === "string" ? input.name.trim() : "";
      const cron = typeof input?.cron === "string" ? input.cron.trim() : "";
      const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
      if (!name || !cron || !prompt) {
        return {
          content: [{ type: "text" as const, text: "name, cron, and prompt are required" }],
          details: { ok: false, name, cron, prompt },
          isError: true,
        };
      }

      const creator = getCreator();
      if (!creator) {
        return {
          content: [{ type: "text" as const, text: "scheduled task service is not available" }],
          details: { ok: false },
          isError: true,
        };
      }

      try {
        const task = await creator({
          name,
          cron,
          prompt,
          enabled: input?.enabled,
        });
        return {
          content: [{
            type: "text" as const,
            text: `Scheduled task created: ${task.name} (${task.cron})`,
          }],
          details: { ok: true, task },
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          details: { ok: false },
          isError: true,
        };
      }
    },
  } as ToolDefinition;
}
