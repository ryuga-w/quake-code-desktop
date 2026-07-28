import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type SetStateAction,
} from "react";
import { fileToComposerImage, normalizeSessionDraftKey } from "../../lib/client-ids";
import {
  classifyComposerFile,
  COMPOSER_CONTEXT_LIMIT,
  COMPOSER_FILE_BATCH_LIMIT,
  COMPOSER_IMAGE_LIMIT,
  COMPOSER_IMAGE_MAX_BYTES,
  composerFileSourceKey,
  readComposerTextFile,
} from "../../lib/composer-files";
import { readStorageArray } from "../../lib/storage";
import type { ToastState } from "../../state/app-store";
import type { ComposerImage } from "../../types";

export type ComposerContextChip = {
  id: string;
  type: "file" | "terminal" | "tool" | "annotation";
  label: string;
  text: string;
};

export type SessionComposerDraft = {
  prompt: string;
  images: ComposerImage[];
  contextChips: ComposerContextChip[];
};

export type ComposerDraftOptions = {
  initialSessionKey: string;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
};

/** Owns composer text/images/context plus session-scoped draft refs. */
export function useComposerDraft({ initialSessionKey, showToast }: ComposerDraftOptions) {
  const [prompt, setPrompt] = useState("");
  const deferredPrompt = useDeferredValue(prompt);
  const [composerImages, setComposerImages] = useState<ComposerImage[]>([]);
  const [sentImagePreviews, setSentImagePreviews] = useState<Record<string, ComposerImage[]>>({});
  const [contextChips, setContextChips] = useState<ComposerContextChip[]>([]);
  const [promptHistory, setPromptHistory] = useState<string[]>(
    () => readStorageArray<string>("quake-web:promptHistory"),
  );
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | undefined>();
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const promptValueRef = useRef(prompt);
  const composerImagesRef = useRef(composerImages);
  const contextChipsRef = useRef(contextChips);
  const composerDraftVersionRef = useRef(0);
  const composerDraftsBySessionRef = useRef(new Map<string, SessionComposerDraft>());
  const activeComposerDraftKeyRef = useRef(normalizeSessionDraftKey(initialSessionKey || "boot"));

  function setPromptDraft(next: SetStateAction<string>) {
    setPrompt((current) => {
      const value = typeof next === "function" ? next(current) : next;
      promptValueRef.current = value;
      if (value !== current) composerDraftVersionRef.current += 1;
      return value;
    });
  }

  function setComposerImagesDraft(next: SetStateAction<ComposerImage[]>) {
    setComposerImages((current) => {
      const value = typeof next === "function" ? next(current) : next;
      composerImagesRef.current = value;
      composerDraftVersionRef.current += 1;
      return value;
    });
  }

  function setContextChipsDraft(next: SetStateAction<ComposerContextChip[]>) {
    setContextChips((current) => {
      const value = typeof next === "function" ? next(current) : next;
      contextChipsRef.current = value;
      composerDraftVersionRef.current += 1;
      return value;
    });
  }

  function addContextChip(chip: Omit<ComposerContextChip, "id">) {
    const id = `${chip.type}-${chip.label}`;
    setContextChipsDraft((chips) => [
      { id, ...chip },
      ...chips.filter((item) => item.id !== id),
    ].slice(0, 6));
  }

  function removeContextChip(id: string) {
    setContextChipsDraft((chips) => chips.filter((chip) => chip.id !== id));
  }

  async function addComposerFiles(files: readonly File[]) {
    const candidates = Array.from(files).slice(0, COMPOSER_FILE_BATCH_LIMIT);
    if (!candidates.length) return;

    const draftKey = activeComposerDraftKeyRef.current;
    const incomingImages: ComposerImage[] = [];
    const incomingChips: ComposerContextChip[] = [];
    const rejected: string[] = [];
    const knownImageKeys = new Set(
      composerImagesRef.current.map((image) => image.sourceKey).filter((key): key is string => Boolean(key)),
    );
    const knownChipIds = new Set(contextChipsRef.current.map((chip) => chip.id));
    let projectedImageCount = composerImagesRef.current.length;
    let projectedContextCount = contextChipsRef.current.length;

    if (files.length > candidates.length) {
      rejected.push(`${files.length - candidates.length} dosya toplu ekleme sınırını aştı`);
    }

    for (const file of candidates) {
      const classification = classifyComposerFile(file);
      if (classification.kind === "image") {
        const sourceKey = composerFileSourceKey(file);
        if (knownImageKeys.has(sourceKey)) {
          rejected.push(`${file.name}: zaten eklendi`);
          continue;
        }
        if (file.size <= 0) {
          rejected.push(`${file.name}: boş görsel`);
          continue;
        }
        if (file.size > COMPOSER_IMAGE_MAX_BYTES) {
          rejected.push(`${file.name}: 10 MB sınırını aşıyor`);
          continue;
        }
        if (projectedImageCount >= COMPOSER_IMAGE_LIMIT) {
          rejected.push(`${file.name}: görsel sınırı ${COMPOSER_IMAGE_LIMIT}`);
          continue;
        }
        try {
          incomingImages.push(await fileToComposerImage(file, classification.mimeType));
          knownImageKeys.add(sourceKey);
          projectedImageCount += 1;
        } catch (error) {
          rejected.push(`${file.name}: ${error instanceof Error ? error.message : "okunamadı"}`);
        }
        continue;
      }

      if (classification.kind === "text") {
        const id = `file-${file.name}`;
        const replacesExisting = knownChipIds.has(id);
        if (!replacesExisting && projectedContextCount >= COMPOSER_CONTEXT_LIMIT) {
          rejected.push(`${file.name}: bağlam sınırı ${COMPOSER_CONTEXT_LIMIT}`);
          continue;
        }
        try {
          const result = await readComposerTextFile(file);
          const chip = { id, type: "file" as const, label: file.name, text: result.text };
          const incomingIndex = incomingChips.findIndex((entry) => entry.id === id);
          if (incomingIndex >= 0) incomingChips.splice(incomingIndex, 1);
          incomingChips.push(chip);
          if (!replacesExisting) projectedContextCount += 1;
          knownChipIds.add(id);
        } catch (error) {
          rejected.push(`${file.name}: ${error instanceof Error ? error.message : "okunamadı"}`);
        }
        continue;
      }

      rejected.push(`${file.name}: desteklenmeyen dosya türü`);
    }

    if (activeComposerDraftKeyRef.current !== draftKey) {
      showToast("Dosyalar eklenmedi: işlem sırasında sohbet değişti", "warning");
      return;
    }

    if (incomingImages.length) {
      setComposerImagesDraft((current) => {
        const currentKeys = new Set(current.map((image) => image.sourceKey).filter(Boolean));
        const uniqueIncoming = incomingImages.filter((image) => !image.sourceKey || !currentKeys.has(image.sourceKey));
        return [...current, ...uniqueIncoming].slice(0, COMPOSER_IMAGE_LIMIT);
      });
    }
    if (incomingChips.length) {
      setContextChipsDraft((current) => {
        const incomingIds = new Set(incomingChips.map((chip) => chip.id));
        return [...incomingChips, ...current.filter((chip) => !incomingIds.has(chip.id))].slice(0, COMPOSER_CONTEXT_LIMIT);
      });
    }

    const added: string[] = [];
    if (incomingImages.length) added.push(`${incomingImages.length} görsel`);
    if (incomingChips.length) added.push(`${incomingChips.length} dosya bağlamı`);
    if (added.length) {
      showToast(`${added.join(" ve ")} eklendi`, "success");
      requestAnimationFrame(() => promptRef.current?.focus());
    }
    if (rejected.length) {
      const preview = rejected.slice(0, 2).join(" · ");
      const remaining = rejected.length > 2 ? ` · +${rejected.length - 2} sorun` : "";
      showToast(`Bazı dosyalar eklenemedi: ${preview}${remaining}`, "warning");
    }
  }

  async function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    await addComposerFiles(files);
  }

  function removeComposerImage(id: string) {
    setComposerImagesDraft((images) => images.filter((image) => image.id !== id));
    // Older drafts may still contain the annotation chip that used to mirror
    // the preview. Remove that backing entry together with the attachment.
    setContextChipsDraft((chips) => chips.filter((chip) => chip.type !== "annotation" || chip.id !== id));
  }

  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [composerImages.length, deferredPrompt]);

  useEffect(() => {
    promptValueRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages]);

  return {
    prompt,
    composerImages,
    sentImagePreviews,
    contextChips,
    promptHistory,
    promptHistoryIndex,
    promptRef,
    promptValueRef,
    composerImagesRef,
    contextChipsRef,
    composerDraftVersionRef,
    composerDraftsBySessionRef,
    activeComposerDraftKeyRef,
    setPrompt,
    setComposerImages,
    setSentImagePreviews,
    setContextChips,
    setPromptHistory,
    setPromptHistoryIndex,
    setPromptDraft,
    setComposerImagesDraft,
    setContextChipsDraft,
    addContextChip,
    removeContextChip,
    addComposerFiles,
    handleComposerPaste,
    removeComposerImage,
  };
}

export type UseComposerDraftReturn = ReturnType<typeof useComposerDraft>;
