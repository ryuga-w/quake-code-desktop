import React from "react";
import { createPortal } from "react-dom";
import { Bot, CirclePlus } from "lucide-react";

export type DockPanelChildTab = {
  id: string;
  label: string;
  busy?: boolean;
};

type DockPanelTabPortalProps = {
  kind: "sidechat" | "subagents";
  tabs: DockPanelChildTab[];
  activeId: string;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export function DockPanelTabPortal({
  kind,
  tabs,
  activeId,
  emptyLabel,
  onSelect,
  onClose,
}: DockPanelTabPortalProps) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    setHost(document.querySelector<HTMLElement>(`[data-dock-dynamic-tabs="${kind}"]`));
  }, [kind]);

  if (!host) return null;
  const Icon = kind === "subagents" ? Bot : CirclePlus;

  return createPortal(
    <>
      {tabs.length ? tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div className={`dock-workspace-tab dock-child-tab ${active ? "active" : ""}`} key={tab.id}>
            <button type="button" role="tab" aria-selected={active} onClick={() => onSelect(tab.id)}>
              <Icon aria-hidden="true" />
              <span>{tab.label}</span>
              {tab.busy ? <i className="dock-child-tab-activity" aria-label="Çalışıyor" /> : null}
            </button>
            <button
              type="button"
              className="dock-tab-close"
              aria-label={`${tab.label} sekmesini kapat`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      }) : (
        <div className="dock-workspace-tab dock-child-tab active" data-placeholder="true">
          <button type="button" role="tab" aria-selected="true">
            <Icon aria-hidden="true" />
            <span>{emptyLabel}</span>
          </button>
        </div>
      )}
    </>,
    host,
  );
}
