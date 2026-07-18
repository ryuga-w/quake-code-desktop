import React from "react";

export const WorkspaceDashboard = React.lazy(() =>
  import("../components/workspace/WorkspaceDashboard").then((m) => ({ default: m.WorkspaceDashboard }))
);
export const XtermTerminal = React.lazy(() =>
  import("../components/terminal/XtermTerminal").then((m) => ({ default: m.XtermTerminal }))
);
export const SettingsPage = React.lazy(() =>
  import("../components/settings/SettingsPanels").then((m) => ({ default: m.SettingsPage }))
);
export const FilesPanel = React.lazy(() =>
  import("../components/files/FilesPanel").then((m) => ({ default: m.FilesPanel }))
);
export const CommandPalette = React.lazy(() =>
  import("../components/command/CommandPalette").then((m) => ({ default: m.CommandPalette }))
);
export const BrowserPanel = React.lazy(() =>
  import("../components/dock/BrowserPanel").then((m) => ({ default: m.BrowserPanel }))
);
export const MobileStudioPanel = React.lazy(() =>
  import("../components/dock/MobileStudioPanel").then((m) => ({ default: m.MobileStudioPanel }))
);
export const SchedulePanel = React.lazy(() =>
  import("../components/dock/SchedulePanel").then((m) => ({ default: m.SchedulePanel }))
);
export const SearchOverlay = React.lazy(() =>
  import("../components/search/SearchOverlay").then((m) => ({ default: m.SearchOverlay }))
);
export const SchedulePage = React.lazy(() =>
  import("../components/pages/SchedulePage").then((m) => ({ default: m.SchedulePage }))
);
export const ConversationHistoryPage = React.lazy(() =>
  import("../components/pages/ConversationHistoryPage").then((m) => ({ default: m.ConversationHistoryPage }))
);
export const ExtensionsPage = React.lazy(() =>
  import("../components/pages/ExtensionsPage").then((m) => ({ default: m.ExtensionsPage }))
);
export const CodexCommandPalette = React.lazy(() =>
  import("../components/command/CodexCommandPalette").then((m) => ({ default: m.CodexCommandPalette }))
);

/** Stable empty snapshot for zustand selectors — never allocate `[]` inside getSnapshot. */
export const EMPTY_STREAMING_SESSIONS: string[] = [];
