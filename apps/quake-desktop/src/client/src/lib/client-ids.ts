import type { ToastState } from "../state/app-store";
import type { ComposerImage, QueuedUserMessage } from "../types";
import { composerFileSourceKey } from "./composer-files";
import { artifactTemplateSkillFromPrompt } from "./artifact-template-message";

export function extensionNotifyType(value: unknown): ToastState["type"] {
  return value === "success" || value === "warning" || value === "error" || value === "info" ? value : "info";
}

export function createClientSideId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeSessionDraftKey(value: string): string {
  return String(value || "").replace(/\//g, "\\").toLocaleLowerCase("en-US");
}

export function createQueuedUserMessage(message: string, images: ComposerImage[], modelMessage?: string): QueuedUserMessage {
  return {
    id: createClientSideId("queued-message"),
    message,
    modelMessage,
    artifactTemplateSkill: artifactTemplateSkillFromPrompt(modelMessage),
    images,
  };
}

export function toPromptImages(images: ComposerImage[]) {
  return images.map(({ mimeType, data }) => ({ type: "image" as const, mimeType, data }));
}

export function imagesFromMessage(message: any): ComposerImage[] {
  if (!Array.isArray(message?.content)) return [];
  return message.content.flatMap((part: any, index: number) => {
    if (part?.type !== "image" || !part.data) return [];
    const mimeType = String(part.mimeType || part.mediaType || "image/png");
    const rawData = String(part.data);
    const previewUrl = rawData.startsWith("data:") ? rawData : `data:${mimeType};base64,${rawData}`;
    return [{
      id: `message-image-${message.id || message.timestamp || "local"}-${index}`,
      name: String(part.name || `görsel-${index + 1}`),
      mimeType,
      data: rawData.startsWith("data:") ? rawData.split(",")[1] || "" : rawData,
      previewUrl,
    }];
  });
}

export function fileToComposerImage(file: File, mimeTypeOverride?: string): Promise<ComposerImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Görsel okunamadı"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, data = ""] = result.split(",");
      const resolvedMimeType = mimeTypeOverride || file.type || "image/png";
      const previewUrl = result.replace(/^data:[^;,]*/, `data:${resolvedMimeType}`);
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name || "panodan görsel",
        mimeType: resolvedMimeType,
        data,
        previewUrl,
        sourceKey: composerFileSourceKey(file),
      });
    };
    reader.readAsDataURL(file);
  });
}
