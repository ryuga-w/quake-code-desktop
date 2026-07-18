import type { ElementInspectResult } from "./desktop";

export type BrowserAnnotation = {
  id: string;
  number: number;
  target: ElementInspectResult;
  comment: string;
  createdAt: number;
};

export type BrowserAnnotationDraft = {
  activeAnnotationId?: string;
  id: string;
  target: ElementInspectResult;
  comment: string;
  createdAt: number;
};

export type BrowserAnnotationBundle = {
  url: string;
  title: string;
  annotations: BrowserAnnotation[];
  image: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    previewUrl: string;
    annotation: string;
    annotationTarget: string;
  };
};

export type ProjectedRect = { left: number; top: number; width: number; height: number };

export function renumberAnnotations(annotations: BrowserAnnotation[]): BrowserAnnotation[] {
  return annotations.map((annotation, index) => ({ ...annotation, number: index + 1 }));
}

export function upsertAnnotation(
  annotations: BrowserAnnotation[],
  annotation: BrowserAnnotation,
): BrowserAnnotation[] {
  const existingIndex = annotations.findIndex((item) => item.id === annotation.id);
  if (existingIndex < 0) return renumberAnnotations([...annotations, annotation]);
  return renumberAnnotations(annotations.map((item, index) => index === existingIndex ? annotation : item));
}

/** Materialize an open picker draft without dropping annotations already saved in the session. */
export function mergeBrowserAnnotationDraft(
  annotations: BrowserAnnotation[],
  draft: BrowserAnnotationDraft,
): BrowserAnnotation[] {
  const existing = annotations.find((annotation) =>
    annotation.id === draft.activeAnnotationId || annotation.target.selector === draft.target.selector,
  );
  return upsertAnnotation(annotations, {
    id: existing?.id || draft.id,
    number: existing?.number || annotations.length + 1,
    target: draft.target,
    comment: draft.comment.trim(),
    createdAt: existing?.createdAt || draft.createdAt,
  });
}

export function removeAnnotation(annotations: BrowserAnnotation[], id: string): BrowserAnnotation[] {
  return renumberAnnotations(annotations.filter((annotation) => annotation.id !== id));
}

export function projectAnnotationRect(
  rect: ElementInspectResult["rect"],
  source: { width: number; height: number },
  destination: { width: number; height: number },
): ProjectedRect {
  const scaleX = destination.width / Math.max(1, source.width);
  const scaleY = destination.height / Math.max(1, source.height);
  return {
    left: Math.max(0, rect.x * scaleX),
    top: Math.max(0, rect.y * scaleY),
    width: Math.max(1, rect.width * scaleX),
    height: Math.max(1, rect.height * scaleY),
  };
}

export function buildBrowserAnnotationContext(url: string, title: string, annotations: BrowserAnnotation[]): string {
  const entries = annotations.map((annotation) => {
    const target = annotation.target;
    const label = `${target.tag}${target.id ? `#${target.id}` : ""}`;
    return [
      `${annotation.number}. ${label}${target.role ? ` (${target.role})` : ""}`,
      `   Selector: ${target.selector}`,
      target.accessibleName ? `   Erişilebilir ad: ${target.accessibleName.slice(0, 160)}` : "",
      target.text ? `   İçerik: ${target.text.slice(0, 220)}` : "",
      `   Açıklama: ${annotation.comment || "Bu seçimi incele."}`,
    ].filter(Boolean).join("\n");
  });
  return [
    "[Tarayıcı Açıklamaları]",
    `URL: ${url}`,
    title ? `Başlık: ${title}` : "",
    "Görsel: browser-annotations.png",
    "",
    ...entries,
  ].filter((line, index) => line || index === 4).join("\n");
}
