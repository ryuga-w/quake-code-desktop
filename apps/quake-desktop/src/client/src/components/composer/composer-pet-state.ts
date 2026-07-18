export type ComposerPetState = "idle" | "typing" | "ready" | "working" | "result";

export function resolveComposerPetState(input: {
  busy: boolean;
  resultVisible: boolean;
  recentlyTyping: boolean;
  canSubmit: boolean;
}): ComposerPetState {
  if (input.busy) return "working";
  if (input.resultVisible) return "result";
  if (input.recentlyTyping) return "typing";
  if (input.canSubmit) return "ready";
  return "idle";
}
