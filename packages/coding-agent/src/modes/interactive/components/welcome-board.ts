import {
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@mrquake/quakecode-tui";
import { theme } from "../theme/theme.js";

export type WelcomeMenuAction =
  "newSession" | "resumeSession" | "changelog" | "quit";

export interface WelcomeBoardConfig {
  version: string;
  displayName: string;
  announcementTitle: string;
  announcementBody: string;
  workspace?: string;
  model?: string;
  getTerminalRows: () => number;
  onMenuAction: (action: WelcomeMenuAction) => void;
  requestRender: () => void;
}

type MenuRow = {
  action: WelcomeMenuAction;
  label: string;
  description: string;
  shortcut: string;
};

const MENU_ROWS: MenuRow[] = [
  {
    action: "newSession",
    label: "New session",
    description: "Start with a clean context",
    shortcut: "ctrl+w",
  },
  {
    action: "resumeSession",
    label: "Resume",
    description: "Continue a previous session",
    shortcut: "ctrl+s",
  },
  {
    action: "changelog",
    label: "What's new",
    description: "Review release notes",
    shortcut: "ctrl+d",
  },
  {
    action: "quit",
    label: "Exit",
    description: "Return to the terminal",
    shortcut: "ctrl+q",
  },
];

function padLine(content: string, width: number): string {
  const clipped = truncateToWidth(content, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function centerLine(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  const left = Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2));
  return `${" ".repeat(left)}${clipped}`;
}

function formatMetaRow(label: string, value: string, width: number): string {
  const labelText = theme.fg("dim", label.toUpperCase().padEnd(11));
  const valueText = theme.fg(
    "muted",
    truncateToWidth(value, Math.max(1, width - 11), "…"),
  );
  return padLine(`${labelText}${valueText}`, width);
}

function formatActionRow(row: MenuRow, width: number): string {
  const key = theme.fg("accent", row.shortcut.padEnd(9));
  const labelWidth = Math.min(14, Math.max(8, width - 24));
  const label = theme.fg("text", row.label.padEnd(labelWidth));
  const descriptionWidth = Math.max(0, width - 9 - labelWidth);
  const description =
    descriptionWidth >= 8
      ? theme.fg("dim", truncateToWidth(row.description, descriptionWidth, "…"))
      : "";
  return padLine(`${key}${label}${description}`, width);
}

export class WelcomeBoardComponent implements Component {
  constructor(private readonly config: WelcomeBoardConfig) {}

  invalidate(): void {}

  // Retained for input-layer compatibility. Welcome actions are keyboard-only.
  setMouseHovered(_action: WelcomeMenuAction | null): void {}

  render(width: number): string[] {
    if (width <= 0) return [];

    const panelWidth = Math.max(1, Math.min(68, width - (width >= 56 ? 8 : 2)));
    if (panelWidth < 26) {
      return [
        centerLine(
          theme.bold(theme.fg("text", this.config.displayName)),
          width,
        ),
      ];
    }

    const innerWidth = panelWidth - 4;
    const border = (text: string) => theme.fg("borderMuted", text);
    const strongBorder = (text: string) => theme.fg("border", text);
    const body: string[] = [];

    const product = theme.bold(
      theme.fg("text", this.config.displayName.toUpperCase()),
    );
    const descriptor = theme.fg("dim", "TERMINAL CODING AGENT");
    const version = theme.fg("muted", `v${this.config.version}`);
    const brandLeft = `${product}  ${descriptor}`;
    const brandGap = Math.max(
      1,
      innerWidth - visibleWidth(brandLeft) - visibleWidth(version),
    );
    body.push(
      padLine(`${brandLeft}${" ".repeat(brandGap)}${version}`, innerWidth),
    );
    body.push(border("─".repeat(innerWidth)));

    if (this.config.workspace)
      body.push(formatMetaRow("workspace", this.config.workspace, innerWidth));
    if (this.config.model)
      body.push(formatMetaRow("model", this.config.model, innerWidth));

    if (this.config.workspace || this.config.model) body.push("");
    body.push(theme.fg("dim", "ACTIONS"));
    for (const row of MENU_ROWS) body.push(formatActionRow(row, innerWidth));

    body.push("");
    body.push(theme.fg("dim", "LATEST"));
    body.push(
      padLine(
        theme.fg(
          "text",
          truncateToWidth(this.config.announcementTitle, innerWidth, "…"),
        ),
        innerWidth,
      ),
    );
    body.push(
      padLine(
        theme.fg(
          "muted",
          truncateToWidth(this.config.announcementBody, innerWidth, "…"),
        ),
        innerWidth,
      ),
    );

    const panel = [
      strongBorder(`┌${"─".repeat(panelWidth - 2)}┐`),
      ...body.map(
        (line) => `${border("│")} ${padLine(line, innerWidth)} ${border("│")}`,
      ),
      strongBorder(`└${"─".repeat(panelWidth - 2)}┘`),
    ];

    const terminalRows = this.config.getTerminalRows() || 24;
    const bottomReserved = 9;
    const availableTop = Math.max(
      1,
      terminalRows - panel.length - bottomReserved,
    );
    const topPadding = Math.max(1, Math.floor(availableTop * 0.45));
    const lines = Array.from({ length: topPadding }, () => "");
    lines.push(...panel.map((line) => centerLine(line, width)), "");

    const targetHeight = Math.max(lines.length, terminalRows - 4);
    while (lines.length < targetHeight) lines.push("");
    return lines.map((line) => truncateToWidth(line, width, ""));
  }
}

export class WelcomeTipComponent implements Component {
  constructor(private readonly text: string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const tip = `${theme.fg("dim", "QUICK START")}  ${theme.fg("muted", this.text)}`;
    return [centerLine(tip, width)];
  }
}
