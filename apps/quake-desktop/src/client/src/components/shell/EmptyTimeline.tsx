import React from "react";
import { useAppStore } from "../../state/app-store";

export function EmptyTimeline() {
  const cwd = useAppStore((s) => s.state?.cwd || s.config?.cwd || "");
  const workspaceName = cwd.split(/[\\/]/).filter(Boolean).pop() || "çalışma alanı";

  return (
    <div className="empty-timeline">
      <h2>{workspaceName} içinde ne oluşturalım?</h2>
    </div>
  );
}
