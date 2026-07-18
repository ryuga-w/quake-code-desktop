import React from "react";
import { createRoot } from "react-dom/client";
import { ToolCallNotice } from "./components/markdown/MarkdownMessage";
import { useAppStore, type ToolCardState } from "./state/app-store";
import "../tailwind.css";
import "../styles.css";
import "../foundation.css";
import "./components/timeline/timeline.css";

const previewTool: ToolCardState = {
  id: "preview-apply-patch",
  toolName: "apply_patch",
  status: "running",
  turnId: 1,
  startedAt: Date.now(),
  args: `*** Begin Patch
*** Add File: tool-test/test-a.txt
+İlk sürüm
+Durum: oluşturuldu
*** Add File: tool-test/test-b.txt
+Geçici test dosyası
+Durum: silinmeyi bekliyor
*** End Patch`,
};

useAppStore.getState().set({ tools: { [previewTool.id]: previewTool } });

function Preview() {
  return (
    <main style={{ minHeight: "100vh", padding: "42px 56px", background: "#181818" }}>
      <article className="message assistant clean-assistant tool-only-message" style={{ width: 560 }}>
        <div className="message-body">
          <ToolCallNotice
            names={["apply_patch"]}
            turnId={1}
            toolSnapshots={[previewTool]}
            pendingOverride
            historyScope="all"
          />
        </div>
      </article>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
