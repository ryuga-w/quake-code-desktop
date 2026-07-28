import React from "react";
import { useAppStore } from "../../state/app-store";
import { ComposerPet, type ComposerPetProps } from "./ComposerPet";
import { deriveComposerPetRuntimeSignals } from "./composer-pet-signals";

type RuntimeComposerPetProps = Omit<
  ComposerPetProps,
  "activeToolKind" | "toolOutcome" | "subagentSignal" | "subagentActive" | "networkSignal" | "sessionKey" | "freshSession"
>;

/** Keeps high-frequency runtime subscriptions isolated from the full composer. */
export function RuntimeComposerPet(props: RuntimeComposerPetProps) {
  const tools = useAppStore((state) => state.tools);
  const messages = useAppStore((state) => state.messages);
  const statusNotice = useAppStore((state) => state.statusNotice);
  const sessionKey = useAppStore((state) => String(state.state?.sessionFile || state.state?.sessionId || ""));
  const freshSession = useAppStore((state) => state.visibleMessageCount === 0);
  const signals = React.useMemo(
    () => deriveComposerPetRuntimeSignals(tools, messages),
    [messages, tools],
  );

  return (
    <ComposerPet
      {...props}
      activeToolKind={signals.activeToolKind}
      toolOutcome={signals.toolOutcome}
      subagentSignal={signals.subagent}
      subagentActive={signals.subagentActive}
      networkSignal={statusNotice && ["provider_disconnected", "provider_connected", "provider_error"].includes(statusNotice.kind)
        ? {
            key: statusNotice.id,
            status: statusNotice.kind === "provider_connected"
              ? "online"
              : statusNotice.kind === "provider_disconnected" ? "offline" : "error",
          }
        : undefined}
      sessionKey={sessionKey || undefined}
      freshSession={freshSession}
    />
  );
}
