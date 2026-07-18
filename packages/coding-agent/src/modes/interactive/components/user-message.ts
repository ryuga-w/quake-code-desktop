import type { ImageContent, Message } from "@mrquake/quakecode-ai";
import {
  Box,
  type Component,
  Container,
  getCapabilities,
  Image,
  Markdown,
  type MarkdownTheme,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@mrquake/quakecode-tui";
import { convertToPng } from "../../../utils/image-convert.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

const USER_BAR_PREFIX_WIDTH = 2;

function userBarLeadPrefix(): string {
  return theme.fg("text", "› ");
}

function userBarContinuationPrefix(): string {
  return " ".repeat(USER_BAR_PREFIX_WIDTH);
}

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export type UserRenderablePart =
  { type: "text"; text: string } | { type: "image"; image: ImageContent };

export type UserMessageOptions = {
  markdownTheme?: MarkdownTheme;
  showImages?: boolean;
  requestRender?: () => void;
  showRoleLabel?: boolean;
  timestamp?: number;
};

function stripHiddenAttachmentInstruction(text: string): string {
  return text
    .replace(
      /\n\n\[(?:\d+) image attached\. Please use (?:it|them) when answering\.\]\s*$/u,
      "",
    )
    .trim();
}

export function formatUserMessageTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function joinLineWithTimestamp(
  line: string,
  timestamp: string,
  width: number,
): string {
  const ts = theme.fg("customMessageLabel", timestamp);
  const gap = Math.max(1, width - visibleWidth(line) - visibleWidth(ts));
  return `${line}${" ".repeat(gap)}${ts}`;
}

function fitFirstLineWithTimestamp(
  prefix: string,
  text: string,
  timestamp: string,
  width: number,
): string {
  const ts = theme.fg("customMessageLabel", timestamp);
  const tsWidth = visibleWidth(ts);
  const prefixWidth = visibleWidth(prefix);
  const textWidth = Math.max(1, width - prefixWidth - tsWidth - 1);
  const truncated = truncateToWidth(text, textWidth);
  const line = `${prefix}${truncated}`;
  return joinLineWithTimestamp(line, timestamp, width);
}

export function buildUserRenderablePartsFromMessage(
  message: Message,
): UserRenderablePart[] {
  if (message.role !== "user") {
    return [];
  }

  if (typeof message.content === "string") {
    const sanitized = stripHiddenAttachmentInstruction(message.content);
    return sanitized.trim() ? [{ type: "text", text: sanitized }] : [];
  }

  const parts: UserRenderablePart[] = [];
  let bufferedText: string[] = [];

  const flushText = () => {
    const joined = bufferedText.join("\n\n").trim();
    bufferedText = [];
    if (joined) {
      parts.push({ type: "text", text: joined });
    }
  };

  for (const content of message.content) {
    if (content.type === "text") {
      bufferedText.push(
        stripHiddenAttachmentInstruction(
          (content as { text?: string }).text ?? "",
        ),
      );
      continue;
    }

    if (content.type === "image") {
      flushText();
      parts.push({ type: "image", image: content as ImageContent });
    }
  }

  flushText();
  return parts;
}

/**
 * Component that renders a user message as a full-width bar (message left, timestamp right).
 */
export class UserMessageComponent extends Container {
  private readonly barBox: Box;
  private readonly barContent: Container;
  private firstLinePending = true;

  constructor(
    readonly parts: UserRenderablePart[],
    private readonly options: UserMessageOptions = {},
  ) {
    super();
    const markdownTheme = options.markdownTheme ?? getMarkdownTheme();

    this.barContent = new Container();
    this.barBox = new Box(1, 0, (value) => theme.bg("userMessageBg", value));
    this.barBox.addChild(this.barContent);

    for (const part of parts) {
      if (part.type === "text") {
        this.addMarkdownBlock(part.text, markdownTheme);
      } else {
        this.addImagePart(part.image);
      }
    }
  }

  private takeFirstLine(): boolean {
    if (!this.firstLinePending) {
      return false;
    }
    this.firstLinePending = false;
    return true;
  }

  private addMarkdownBlock(text: string, markdownTheme: MarkdownTheme): void {
    const md = new Markdown(text, 0, 0, markdownTheme, {
      color: (value: string) => theme.fg("userMessageText", value),
    });

    this.barContent.addChild({
      invalidate: () => md.invalidate(),
      render: (width: number) => {
        const mdWidth = Math.max(1, width - USER_BAR_PREFIX_WIDTH);
        return this.prefixLines(md.render(mdWidth), width);
      },
    } as Component);
  }

  private prefixLines(lines: string[], width: number): string[] {
    if (lines.length === 0) {
      return lines;
    }

    const timestamp = this.options.timestamp;
    return lines.map((line, index) => {
      const prefix =
        index === 0 ? userBarLeadPrefix() : userBarContinuationPrefix();
      if (index === 0 && timestamp !== undefined && this.takeFirstLine()) {
        return fitFirstLineWithTimestamp(
          prefix,
          line,
          formatUserMessageTimestamp(timestamp),
          width,
        );
      }
      return `${prefix}${line}`;
    });
  }

  private addImagePart(image: ImageContent): void {
    const show = this.options.showImages !== false;
    const capabilities = getCapabilities();
    const requestRender = this.options.requestRender;

    if (!show || !capabilities.images || !image.data || !image.mimeType) {
      this.barContent.addChild({
        render: (width: number) =>
          this.prefixLines([theme.fg("dim", "image attached")], width),
      } as Component);
      return;
    }

    const imageOptions = {
      fallbackColor: (value: string) => theme.fg("userMessageText", value),
    } as const;
    const layout = { maxWidthCells: 60 } as const;

    const slot = new Container();
    this.barContent.addChild({
      invalidate: () => slot.invalidate?.(),
      render: (width: number) => {
        const slotLines = slot.render(
          Math.max(1, width - USER_BAR_PREFIX_WIDTH),
        );
        if (slotLines.length === 0) {
          return this.prefixLines([theme.fg("dim", "image attached")], width);
        }
        return this.prefixLines(slotLines, width);
      },
    } as Component);

    const mount = (data: string, mimeType: string) => {
      slot.addChild(new Spacer(1));
      slot.addChild(new Image(data, mimeType, imageOptions, layout));
    };

    if (capabilities.images === "kitty" && image.mimeType !== "image/png") {
      convertToPng(image.data, image.mimeType).then((converted) => {
        if (!converted) {
          slot.addChild(
            new Text(
              theme.fg("dim", "image preview unavailable in this terminal"),
              0,
              0,
            ),
          );
          requestRender?.();
          return;
        }
        mount(converted.data, converted.mimeType);
        requestRender?.();
      });
      return;
    }

    mount(image.data, image.mimeType);
  }

  override render(width: number): string[] {
    this.firstLinePending = true;
    const barLines = this.barBox.render(width);
    if (barLines.length === 0) {
      return barLines;
    }

    barLines[0] = OSC133_ZONE_START + barLines[0];
    barLines[barLines.length - 1] =
      barLines[barLines.length - 1] + OSC133_ZONE_END + OSC133_ZONE_FINAL;
    return [...barLines, ""];
  }
}
