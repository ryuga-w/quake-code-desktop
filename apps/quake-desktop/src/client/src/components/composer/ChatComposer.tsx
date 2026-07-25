import React from "react";
import { ArrowUp, Box, Check, ChevronRight, FileSpreadsheet, FileText, FileUp, Folder, Hand, LayoutTemplate, Lightbulb, ListTodo, Paperclip, Plus, Presentation, Puzzle, RotateCcw, ShieldAlert, ShieldCheck, Square, Target, X, Sparkles, Bug, TestTube, type LucideIcon } from "lucide-react";
import type { WebContextUsage, WebPlanState, WebSkillInfo } from "../../../../shared/protocol";
import type { ComposerImage, QueuedUserMessage } from "../../types";
import { THINKING_OPTIONS } from "../../constants";
import { apiGet } from "../../lib/api";
import { COMPOSER_FILE_ACCEPT, hasComposerPayload } from "../../lib/composer-files";
import { composeGithubLinkValue, parseComposerGithubLink } from "../../lib/composer-github-link";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import { useConfirmAction } from "../common/ConfirmContext";
import { ComposerQueue } from "./ComposerQueue";
import { ComposerGithubLinkToken } from "./ComposerGithubLinkToken";
import { DocumentTemplateGallery } from "./DocumentTemplateGallery";
import { getComposerAddMenuExtensions, type ComposerAddMenuExtension, type ComposerAddMenuExtensionKind } from "./composer-add-menu";
import { composerPetContextUsage, composerPetFileKind, type ComposerPetFileKind } from "./composer-pet-signals";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { RuntimeComposerPet } from "./RuntimeComposerPet";
import styles from "./ChatComposer.module.css";

type ComposerModel = {
  provider: string;
  id: string;
  reasoning?: boolean;
  supportsXhigh?: boolean;
  supportsMax?: boolean;
};

type ComposerThinkingOption = (typeof THINKING_OPTIONS)[number];
type PreferencesSubmenu = "model" | "effort";
type PreferencesSubmenuPlacement = "right" | "left" | "stacked";
export type TerminalPolicyMode = "safe" | "allow-all" | "disabled";

/** Codex-style approval mode options (maps to terminal policy / guardian presets). */
const APPROVAL_MODE_OPTIONS: Array<{
  mode: TerminalPolicyMode;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  {
    mode: "disabled",
    label: "Onay iste",
    description: "Harici dosyaları düzenlemeden ve interneti kullanmadan önce her zaman sor",
    Icon: Hand,
  },
  {
    mode: "safe",
    label: "Benim için onayla",
    description: "Yalnızca potansiyel olarak güvenli olmadığı algılanan işlemler için sor",
    Icon: ShieldCheck,
  },
  {
    mode: "allow-all",
    label: "Tam erişim",
    description: "İnternete ve bilgisayarınızdaki tüm dosyalara sınırsız erişim",
    Icon: ShieldAlert,
  },
];

type Props = {
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  hasVisibleMessages: boolean;
  images: ComposerImage[];
  contextCount: number;
  localQueue: QueuedUserMessage[];
  agentBusy: boolean;
  promptPending: boolean;
  isCompacting?: boolean;
  contextUsage?: WebContextUsage;
  planActive: boolean;
  plan?: WebPlanState;
  goalActive?: boolean;
  /** Codex approval mode (terminal policy): disabled=Onay iste, safe=Benim için, allow-all=Tam erişim */
  terminalPolicyMode?: TerminalPolicyMode;
  terminalPolicyPending?: boolean;
  currentModel?: ComposerModel;
  currentModelValue: string;
  currentModelLabel: string;
  currentThinking: string;
  pinnedModelCount: number;
  visibleModels: ComposerModel[];
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSubmitCurrent: () => void;
  onPromptChange: (value: string) => void;
  onPromptPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onAddFiles: (files: readonly File[]) => void | Promise<void>;
  onPromptKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean | void;
  onOpenFiles: () => void;
  onOpenProjects: () => void;
  onOpenPlan?: () => void;
  onOpenDocumentSkill?: (skillName: string) => void;
  onPreviewImage: (image: ComposerImage) => void;
  onRemoveImage: (id: string) => void;
  onSetMode: (mode: "plan" | "execute" | "goal") => void;
  /** Close active Plan chip (switch back to agent). */
  onDismissPlan?: () => void;
  /** Close active Goal chip (clear goal mode / cancel session goal). */
  onDismissGoal?: () => void;
  onSetTerminalPolicy?: (mode: TerminalPolicyMode) => void | Promise<void>;
  onSetThinking: (level: string) => void;
  onSelectModel: (provider: string, id: string) => void;
  onResetPreferences: () => void;
  onAbort: () => void;
  onSendQueued: (item: QueuedUserMessage) => void;
  onEditQueued: (item: QueuedUserMessage) => void;
  onRemoveQueued: (id: string) => void;
  onClearQueue: () => void;
  onCopyQueued: (text: string) => void;
  formatModelLabel: (value: string) => string;
  formatThinkingLabel: (level: string) => string;
  compact?: boolean;
};

export function ChatComposer({
  promptRef,
  prompt,
  hasVisibleMessages,
  images,
  contextCount,
  localQueue,
  agentBusy,
  promptPending,
  isCompacting = false,
  contextUsage,
  planActive,
  plan,
  goalActive = false,
  terminalPolicyMode = "safe",
  terminalPolicyPending = false,
  currentModel,
  currentModelValue,
  currentModelLabel,
  currentThinking,
  pinnedModelCount,
  visibleModels,
  onSubmit,
  onSubmitCurrent,
  onPromptChange,
  onPromptPaste,
  onAddFiles,
  onPromptKeyDown,
  onOpenFiles,
  onOpenProjects,
  onOpenPlan,
  onOpenDocumentSkill,
  onPreviewImage,
  onRemoveImage,
  onSetMode,
  onDismissPlan,
  onDismissGoal,
  onSetTerminalPolicy,
  onSetThinking,
  onSelectModel,
  onResetPreferences,
  onAbort,
  onSendQueued,
  onEditQueued,
  onRemoveQueued,
  onClearQueue,
  onCopyQueued,
  formatModelLabel,
  formatThinkingLabel,
  compact = false,
}: Props) {
  const documentMatch = prompt.match(/^(?:@documents(?:\[([a-z0-9-]+)\])?\s+|\/(?:docx|documents?)\s*)/i);
  const documentPrefix = documentMatch?.[0];
  const selectedDocumentSkill = documentMatch?.[1];
  const documentModeActive = Boolean(documentPrefix);
  const selectedDocumentLabel = selectedDocumentSkill ? documentTemplateDisplayName(selectedDocumentSkill) : undefined;
  const documentCommand = documentPrefix?.trim().startsWith("@")
    ? `@documents${selectedDocumentSkill ? `[${selectedDocumentSkill}]` : ""} `
    : "/docx ";
  const visiblePrompt = documentPrefix ? prompt.slice(documentPrefix.length) : prompt;
  const githubLink = parseComposerGithubLink(visiblePrompt);
  const editablePrompt = githubLink?.rest ?? visiblePrompt;
  const expanded = editablePrompt.length > 120 || editablePrompt.includes("\n");
  const availableThinkingOptions = getAvailableThinkingOptions(currentModel);
  const currentEffortLabel = currentModel?.reasoning ? formatThinkingLabel(currentThinking) : "Standart";
  const [preferencesSubmenu, setPreferencesSubmenu] = React.useState<PreferencesSubmenu>();
  const [preferencesSubmenuPlacement, setPreferencesSubmenuPlacement] = React.useState<PreferencesSubmenuPlacement>("right");
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [addMenuExtensions, setAddMenuExtensions] = React.useState<ComposerAddMenuExtension[]>(() => getComposerAddMenuExtensions([]));
  const addMenuRef = React.useRef<HTMLDetailsElement>(null);
  const preferencesMenuRef = React.useRef<HTMLDetailsElement>(null);
  const preferencesPopoverRef = React.useRef<HTMLDivElement>(null);
  const approvalMenuRef = React.useRef<HTMLDetailsElement>(null);
  const advancedPreferencesMenuRef = React.useRef<HTMLDivElement>(null);
  const modelSubmenuRef = React.useRef<HTMLDivElement>(null);
  const effortSubmenuRef = React.useRef<HTMLDivElement>(null);
  const modelSubmenuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const effortSubmenuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const fileDragDepthRef = React.useRef(0);
  const [fileDragActive, setFileDragActive] = React.useState(false);
  const [petFileKind, setPetFileKind] = React.useState<ComposerPetFileKind>("text");
  const { confirm } = useConfirmAction();
  const canSubmit = hasComposerPayload(prompt, images.length, contextCount);
  const [petImpactSequence, setPetImpactSequence] = React.useState(0);
  const [petStopSequence, setPetStopSequence] = React.useState(0);
  const petContext = React.useMemo(() => composerPetContextUsage(contextUsage), [contextUsage]);
  const planCompletedCount = plan?.completed ?? plan?.steps.filter((step) => step.completed || step.status === "completed").length ?? 0;
  const triggerPetImpact = React.useCallback(() => {
    if (!canSubmit || promptPending || agentBusy) return;
    setPetImpactSequence((current) => current + 1);
  }, [agentBusy, canSubmit, promptPending]);
  const triggerPetStop = React.useCallback(() => {
    setPetStopSequence((current) => current + 1);
    onAbort();
  }, [onAbort]);
  const addFilesWithPet = React.useCallback((files: readonly File[]) => {
    if (files.length) setPetFileKind(composerPetFileKind(files));
    return onAddFiles(files);
  }, [onAddFiles]);
  const selectAddMenuExtension = React.useCallback((extension: ComposerAddMenuExtension) => {
    const separator = prompt && !/\s$/.test(prompt) ? " " : "";
    onPromptChange(`${prompt}${separator}${extension.insertText}`);
    if (addMenuRef.current) addMenuRef.current.open = false;
    requestAnimationFrame(() => {
      const textarea = promptRef.current;
      textarea?.focus({ preventScroll: true });
      const end = textarea?.value.length ?? 0;
      textarea?.setSelectionRange(end, end);
    });
  }, [onPromptChange, prompt, promptRef]);

  React.useEffect(() => {
    if (/^documents$/i.test(prompt.trim())) onPromptChange("/docx ");
  }, [onPromptChange, prompt]);

  React.useEffect(() => {
    let active = true;
    void apiGet<{ skills?: WebSkillInfo[] }>("/api/skills")
      .then((payload) => {
        if (active) setAddMenuExtensions(getComposerAddMenuExtensions(payload.skills || []));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!fileDragActive) return;
    const reset = () => {
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, [fileDragActive]);

  React.useEffect(() => {
    if (!addMenuOpen) return;
    const dismissAddMenu = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || addMenuRef.current?.contains(target)) return;
      if (addMenuRef.current) addMenuRef.current.open = false;
    };
    document.addEventListener("pointerdown", dismissAddMenu, true);
    return () => document.removeEventListener("pointerdown", dismissAddMenu, true);
  }, [addMenuOpen]);

  const handleFileDragEnter = (event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLFormElement>) => {
    if (!fileDragActive) return;
    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  };

  const handleFileDragOver = (event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleFileDrop = (event: React.DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void addFilesWithPet(files);
  };

  const activeApprovalMode =
    APPROVAL_MODE_OPTIONS.find((option) => option.mode === terminalPolicyMode) || APPROVAL_MODE_OPTIONS[1];
  const ActiveApprovalIcon = activeApprovalMode.Icon;

  const selectApprovalMode = React.useCallback(
    async (mode: TerminalPolicyMode) => {
      if (!onSetTerminalPolicy || mode === terminalPolicyMode || terminalPolicyPending) return;
      if (mode === "allow-all") {
        const accepted = await confirm({
          title: "Tam erişim açılsın mı?",
          message:
            "Ajan onay sormadan komut çalıştırabilir ve workspace dışına yazabilir. Yalnızca güvendiğiniz ortamlarda kullanın.",
          variant: "warning",
          confirmLabel: "Tam erişim",
        });
        if (!accepted) return;
      }
      await onSetTerminalPolicy(mode);
    },
    [confirm, onSetTerminalPolicy, terminalPolicyMode, terminalPolicyPending],
  );

  const resetPreferencesSurface = React.useCallback(() => {
    setPreferencesSubmenu(undefined);
    setPreferencesSubmenuPlacement("right");
  }, []);

  const closePreferencesMenu = React.useCallback(() => {
    const details = preferencesMenuRef.current;
    if (details) details.open = false;
    resetPreferencesSurface();
    restoreMenuTriggerFocus(details?.querySelector<HTMLElement>("summary") ?? null);
  }, [resetPreferencesSurface]);

  const closeApprovalMenu = React.useCallback((restoreFocus = false) => {
    const details = approvalMenuRef.current;
    if (details) details.open = false;
    if (restoreFocus) restoreMenuTriggerFocus(details?.querySelector<HTMLElement>("summary") ?? null);
  }, []);

  const openPreferencesSubmenu = React.useCallback((submenu: PreferencesSubmenu) => {
    setPreferencesSubmenu(submenu);
    requestAnimationFrame(() => {
      focusFirstMenuItem(submenu === "model" ? modelSubmenuRef.current : effortSubmenuRef.current);
    });
  }, []);

  const closePreferencesSubmenu = React.useCallback((submenu: PreferencesSubmenu) => {
    setPreferencesSubmenu(undefined);
    restoreMenuTriggerFocus(
      submenu === "model" ? modelSubmenuTriggerRef.current : effortSubmenuTriggerRef.current,
    );
  }, []);

  React.useEffect(() => {
    if (!preferencesSubmenu) {
      setPreferencesSubmenuPlacement("right");
      return;
    }

    let frameId = 0;
    const updatePlacement = () => {
      const popover = preferencesPopoverRef.current;
      if (!popover) return;

      const surfaceBounds = popover.closest(".main")?.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth);
      const boundaryLeft = Math.max(viewportLeft + 8, surfaceBounds?.left ?? viewportLeft + 8);
      const boundaryRight = Math.min(viewportRight - 8, surfaceBounds?.right ?? viewportRight - 8);
      const popoverBounds = popover.getBoundingClientRect();
      const submenuWidth = preferencesSubmenu === "model" ? 282 : 182;
      const fitsRight = boundaryRight - popoverBounds.right >= submenuWidth - 2;
      const fitsLeft = popoverBounds.left - boundaryLeft >= submenuWidth - 2;

      setPreferencesSubmenuPlacement(fitsRight ? "right" : fitsLeft ? "left" : "stacked");
    };

    const schedulePlacementUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updatePlacement);
    };

    schedulePlacementUpdate();
    window.addEventListener("resize", schedulePlacementUpdate);
    window.visualViewport?.addEventListener("resize", schedulePlacementUpdate);
    const surface = preferencesPopoverRef.current?.closest(".main");
    const observer = surface && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedulePlacementUpdate)
      : undefined;
    if (observer && surface) observer.observe(surface);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", schedulePlacementUpdate);
      window.visualViewport?.removeEventListener("resize", schedulePlacementUpdate);
      observer?.disconnect();
    };
  }, [preferencesSubmenu]);

  const showApprovalHelp = React.useCallback(() => {
    closeApprovalMenu();
    void confirm({
      title: "İşlem onayları nasıl çalışır?",
      message: "Onay iste her riskli adımı size bırakır. Benim için onayla yalnızca güvenli olmadığı düşünülen işlemleri sorar. Tam erişim ise internet ve tüm dosyalar için onay istemeden çalışır.",
      variant: "info",
      confirmLabel: "Anladım",
      cancelLabel: "Kapat",
    });
  }, [closeApprovalMenu, confirm]);

  const renderQuickActions = () => {
    if (hasVisibleMessages || compact) return null;
    const actions = [
      { label: "Kodu Açıkla", command: "/explain", icon: Sparkles },
      { label: "Hata Bul", command: "/debug", icon: Bug },
      { label: "Test Yaz", command: "/test", icon: TestTube },
      { label: "Dokümante Et", command: "/doc", icon: FileText },
    ];
    return (
      <div className={styles.quickActionsContainer} aria-label="Hızlı başlangıçlar">
        {actions.map((act) => {
          const IconComponent = act.icon;
          return (
            <button
              key={act.command}
              type="button"
              className={styles.quickActionPill}
              title={act.label}
              onClick={() => {
                onPromptChange(act.command);
                requestAnimationFrame(() => {
                  promptRef.current?.focus();
                  onSubmitCurrent();
                });
              }}
            >
              <IconComponent size={13.5} strokeWidth={1.75} className={styles.quickActionIcon} />
              <span>{act.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return <>
    {!compact && plan?.steps.some((step) => !step.completed && step.status !== "completed")
      ? <ComposerPlanPill plan={plan} onOpenPlan={onOpenPlan} />
      : null}
    <form
      id="composer"
      className={[
        "composer",
        styles.composer,
        !hasVisibleMessages ? "empty-hero" : "",
        expanded ? "expanded" : "",
        images.length ? "has-images" : "",
        images.length > 1 ? "multi-images" : "single-image",
        compact ? styles.compact : "",
      ].filter(Boolean).join(" ")}
      data-busy={agentBusy ? "true" : "false"}
      data-composer-drop-zone="true"
      data-file-drag-active={fileDragActive ? "true" : undefined}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDragOver={handleFileDragOver}
      onDrop={handleFileDrop}
      onSubmit={(event) => {
        triggerPetImpact();
        onSubmit(event);
      }}
    >
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        multiple
        accept={COMPOSER_FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = "";
          if (files.length) void addFilesWithPet(files);
        }}
      />
      {fileDragActive && (
        <div className={styles.fileDropOverlay} role="status" aria-live="polite">
          <FileUp size={20} strokeWidth={1.8} aria-hidden="true" />
          <span><b>Dosyaları bağlama ekle</b><small>Görseller önizlenir; metin ve kod dosyaları bağlam olur</small></span>
        </div>
      )}
      {documentModeActive && (
        <DocumentTemplateGallery
          onSelect={(template) => {
            onPromptChange(`@documents[${template.skillName}] ${visiblePrompt}`);
            requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }));
          }}
        />
      )}
      {localQueue.length > 0 && (
        <ComposerQueue
          items={localQueue}
          agentBusy={agentBusy || promptPending}
          onSendNow={onSendQueued}
          onEdit={onEditQueued}
          onRemove={onRemoveQueued}
          onClearAll={onClearQueue}
          onCopy={onCopyQueued}
        />
      )}

      <RuntimeComposerPet
        prompt={prompt}
        canSubmit={canSubmit}
        busy={agentBusy || promptPending}
        compact={compact}
        sendImpact={petImpactSequence}
        stopSignal={petStopSequence}
        fileDragActive={fileDragActive}
        attachmentCount={images.length + contextCount}
        fileKind={petFileKind}
        planActive={planActive}
        planCompletedCount={planCompletedCount}
        contextPercent={petContext.percent}
        contextLoad={petContext.load}
      />

      {images.length > 0 && (
        <div className={styles.attachments} aria-label="Eklenen görseller">
          {images.map((image, index) => (
            <div className={`${styles.attachment} ${image.annotation !== undefined || image.annotationTarget ? styles.annotationAttachment : ""}`} key={image.id}>
              <button type="button" className={styles.attachmentPreview} onClick={() => onPreviewImage(image)} aria-label={`${image.name} önizleme`}>
                <img src={image.previewUrl} alt={image.name} />
                {(image.annotation !== undefined || image.annotationTarget) && <span className={styles.attachmentPin}>{image.annotationCount || index + 1}</span>}
              </button>
              {(image.annotation !== undefined || image.annotationTarget) && <span className={styles.attachmentAnnotation}>{image.annotationCount ? `${image.annotationCount} açıklama` : image.annotation || image.annotationTarget || "Seçim"}</span>}
              <button type="button" className={styles.attachmentRemove} aria-label={`${image.name} görselini kaldır`} onClick={() => onRemoveImage(image.id)}>
                <X size={13} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={styles.inputRow}
        data-document-mode={documentModeActive ? "true" : undefined}
        data-inline-content={documentModeActive || githubLink ? "true" : undefined}
      >
        {documentModeActive ? (
          <span className={styles.documentModeLabel}>
            <span className={styles.documentModeIcon} aria-hidden="true"><FileText size={12} strokeWidth={2} /></span>
            <span>Documents</span>
          </span>
        ) : null}
        {selectedDocumentSkill && selectedDocumentLabel ? (
          <button
            type="button"
            className={styles.documentTemplateChip}
            title={`${selectedDocumentLabel} SKILL.md dosyasını aç`}
            onClick={() => onOpenDocumentSkill?.(selectedDocumentSkill)}
          >
            <Box size={13} strokeWidth={1.8} aria-hidden="true" />
            <span>{selectedDocumentLabel}</span>
          </button>
        ) : null}
        {githubLink ? (
          <ComposerGithubLinkToken
            link={githubLink}
            onChangeSource={(source) => {
              const nextVisiblePrompt = composeGithubLinkValue(source, githubLink.rest);
              onPromptChange(documentModeActive ? `${documentCommand}${nextVisiblePrompt}` : nextVisiblePrompt);
            }}
          />
        ) : null}
        <textarea
          ref={promptRef}
          id="prompt"
          rows={1}
          value={editablePrompt}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files || []);
            if (files.length) setPetFileKind(composerPetFileKind(files));
            onPromptPaste(event);
          }}
          onChange={(event) => {
            const nextVisiblePrompt = githubLink
              ? composeGithubLinkValue(githubLink.source, event.target.value)
              : event.target.value;
            onPromptChange(documentModeActive ? `${documentCommand}${nextVisiblePrompt}` : nextVisiblePrompt);
          }}
          placeholder={githubLink ? "" : documentModeActive ? "Oluşturmak istediğin belgeyi anlat…" : hasVisibleMessages ? "Quake’e bir görev ver…" : "Ne oluşturmak veya değiştirmek istiyorsun?"}
          aria-label="Quake'e mesaj"
          onKeyDown={(event) => {
            if (githubLink && event.key === "Backspace" && !githubLink.rest) {
              event.preventDefault();
              onPromptChange(documentModeActive ? documentCommand : "");
              return;
            }
            if (documentModeActive && event.key === "Backspace" && !visiblePrompt) {
              event.preventDefault();
              onPromptChange("");
              return;
            }
            if (onPromptKeyDown(event)) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              triggerPetImpact();
              onSubmitCurrent();
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              triggerPetImpact();
              onSubmitCurrent();
              return;
            }
          }}
        />
      </div>

      <footer className={styles.footer}>
        <div className={styles.primaryControls}>
          <details
            ref={addMenuRef}
            name="composer-control-menu"
            className={styles.addMenu}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setAddMenuOpen(open);
              if (open) focusFirstMenuItem(event.currentTarget.querySelector<HTMLElement>('[role="menu"]'));
            }}
          >
            <summary
              className={styles.iconButton}
              aria-label="Ekle"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              title="Dosya, proje, hedef veya plan ekle"
            >
              <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
            </summary>
            <div
              className={styles.addPopover}
              role="menu"
              aria-label="Ekle"
              onKeyDown={(event) => handleMenuKeyDown(event, {
                onEscape: () => closeDetailsElement(addMenuRef.current),
              })}
            >
              <div className={styles.addPanelTitle}>Ekle</div>
              <button className={styles.addAction} type="button" role="menuitem" onClick={(event) => { closeDetails(event); fileInputRef.current?.click(); }}>
                <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
                <span className={styles.addActionText}><b>Dosyalar ve klasörler</b></span>
              </button>
              <button className={styles.addAction} type="button" role="menuitem" onClick={(event) => { closeDetails(event); onOpenProjects(); }}>
                <Folder size={15} strokeWidth={1.7} aria-hidden="true" />
                <span className={styles.addActionText}><b>Proje</b><small>Yeni görevler için proje seç</small></span>
              </button>
              <button className={styles.addAction} type="button" role="menuitemradio" aria-checked={goalActive} onClick={(event) => { closeDetails(event); onSetMode("goal"); }}>
                <Target size={15} strokeWidth={1.7} aria-hidden="true" />
                <span className={styles.addActionText}><b>Hedef</b><small>Üzerinde çalışmak için bir hedef belirle</small></span>
              </button>
              <button className={styles.addAction} type="button" role="menuitemradio" aria-checked={planActive} onClick={(event) => { closeDetails(event); onSetMode("plan"); }}>
                <Lightbulb size={15} strokeWidth={1.7} aria-hidden="true" />
                <span className={styles.addActionText}><b>Plan modu</b><small>Plan modunu aç</small></span>
              </button>
              <div className={styles.addSection} role="group" aria-label="Eklentiler">
                <div className={styles.addSectionTitle}>Eklentiler</div>
                {addMenuExtensions.map((extension) => (
                  <button
                    className={`${styles.addAction} ${styles.addExtensionAction}`}
                    type="button"
                    role="menuitem"
                    key={extension.command}
                    onClick={() => selectAddMenuExtension(extension)}
                  >
                    <ComposerAddMenuExtensionIcon kind={extension.kind} />
                    <span className={styles.addActionText}><b>{extension.label}</b><small>{extension.description}</small></span>
                  </button>
                ))}
              </div>
              <div className={styles.addSection} role="group" aria-label="Dosyalar ve görevler">
                <button className={styles.addPlainAction} type="button" role="menuitem" onClick={(event) => { closeDetails(event); onOpenFiles(); }}>
                  Dosyalar ve görevler
                </button>
                <div className={styles.addSearchHint} aria-hidden="true">Dosya veya görev aramak için yaz</div>
              </div>
            </div>
          </details>
          {/* Active mode chips — hover reveals X to dismiss Plan or Goal */}
          {planActive ? (
            <span className={`${styles.modeChip} ${styles.modeChipActive}`} data-mode="plan">
              <ListTodo size={13} strokeWidth={2} aria-hidden="true" />
              <span className={styles.modeChipLabel}>Plan</span>
              <button
                type="button"
                className={styles.modeChipDismiss}
                aria-label="Planı kapat"
                title="Planı kapat"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (onDismissPlan) onDismissPlan();
                  else onSetMode("execute");
                }}
              >
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {goalActive ? (
            <span className={`${styles.modeChip} ${styles.modeChipActive}`} data-mode="goal">
              <Target size={13} strokeWidth={2} aria-hidden="true" />
              <span className={styles.modeChipLabel}>Hedef</span>
              <button
                type="button"
                className={styles.modeChipDismiss}
                aria-label="Hedefi kapat"
                title="Hedefi kapat"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (onDismissGoal) onDismissGoal();
                  else onSetMode("execute");
                }}
              >
                <X size={12} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </span>
          ) : null}

          {onSetTerminalPolicy ? (
            <details
              ref={approvalMenuRef}
              name="composer-control-menu"
              className={`${styles.approvalMenu} composer-menu`}
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  focusFirstMenuItem(event.currentTarget.querySelector<HTMLElement>('[role="menu"]'));
                }
              }}
            >
              <summary
                className={styles.approvalTrigger}
                aria-label={`Onay modu: ${activeApprovalMode.label}`}
                title="Quake işlemleri nasıl onaylanmalı?"
                data-mode={terminalPolicyMode}
                data-pending={terminalPolicyPending ? "true" : "false"}
              >
                <ActiveApprovalIcon size={14} strokeWidth={1.9} aria-hidden />
                <span>{activeApprovalMode.label}</span>
              </summary>
              <div
                className={styles.approvalPopover}
                role="menu"
                aria-label="Onay modu"
                onKeyDown={(event) => handleMenuKeyDown(event, {
                  onEscape: () => closeApprovalMenu(true),
                })}
              >
                <header className={styles.approvalHeader}>
                  <span className={styles.approvalHeaderTitle}>Quake işlemleri nasıl onaylanmalı?</span>
                  <button type="button" className={styles.approvalLearnMore} onClick={showApprovalHelp}>
                    Daha fazla bilgi
                  </button>
                </header>
                {APPROVAL_MODE_OPTIONS.map((option) => {
                  const selected = option.mode === terminalPolicyMode;
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={styles.approvalOption}
                      disabled={terminalPolicyPending}
                      onClick={(event) => {
                        closeDetails(event);
                        closeApprovalMenu();
                        void selectApprovalMode(option.mode);
                      }}
                    >
                      <Icon className={styles.approvalOptionIcon} size={16} strokeWidth={1.7} aria-hidden />
                      <span className={styles.approvalOptionText}>
                        <b>{option.label}</b>
                        <small>{option.description}</small>
                      </span>
                      <span className={styles.approvalCheck} aria-hidden>
                        {selected ? <Check size={15} strokeWidth={1.9} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>

        <div className={styles.secondaryControls}>
          {isCompacting ? (
            <span className={styles.compactionStatus} role="status" aria-live="polite">
              <i aria-hidden="true" />
              Bağlam sıkıştırılıyor
            </span>
          ) : null}
          <ContextUsageIndicator usage={contextUsage} />
          <details
            ref={preferencesMenuRef}
            name="composer-control-menu"
            className={`${styles.preferencesMenu} composer-menu`}
            onToggle={(event) => {
              if (!event.currentTarget.open) {
                resetPreferencesSurface();
                return;
              }
              setPreferencesSubmenu(undefined);
              setPreferencesSubmenuPlacement("right");
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closePreferencesMenu();
            }}
          >
            <summary
              aria-label={`Model: ${currentModelLabel || "Model"}, çaba: ${currentEffortLabel}`}
              title="Model ve çaba ayarları"
            >
              <span className={styles.preferenceModel}>{currentModelLabel || "Model seç"}</span>
              <span className={styles.preferenceEffort} data-level={currentThinking}>{currentEffortLabel}</span>
            </summary>

            <div
              ref={preferencesPopoverRef}
              className={styles.preferencesPopover}
              data-submenu={preferencesSubmenu}
              data-submenu-placement={preferencesSubmenuPlacement}
              aria-label="Model ve çaba ayarları"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closePreferencesMenu();
                } else if (event.key === "ArrowLeft" && preferencesSubmenu) {
                  event.preventDefault();
                  event.stopPropagation();
                  closePreferencesSubmenu(preferencesSubmenu);
                }
              }}
            >
              <div
                    ref={advancedPreferencesMenuRef}
                    className={styles.advancedPreferencesPanel}
                    role="menu"
                    aria-label="Gelişmiş ayarlar"
                    onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closePreferencesMenu })}
                  >
                    <button
                      ref={modelSubmenuTriggerRef}
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={preferencesSubmenu === "model"}
                      className={`${styles.advancedRow} ${preferencesSubmenu === "model" ? styles.activeRow : ""}`}
                      onMouseEnter={() => setPreferencesSubmenu("model")}
                      onFocus={() => setPreferencesSubmenu("model")}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowRight") {
                          event.preventDefault();
                          event.stopPropagation();
                          openPreferencesSubmenu("model");
                        }
                      }}
                      onClick={() => openPreferencesSubmenu("model")}
                    >
                      <span>Model</span>
                      <span className={styles.advancedValue}>{currentModelLabel || "Seçilmedi"}</span>
                      <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button
                      ref={effortSubmenuTriggerRef}
                      type="button"
                      role="menuitem"
                      aria-haspopup={currentModel?.reasoning ? "menu" : undefined}
                      aria-expanded={preferencesSubmenu === "effort"}
                      disabled={!currentModel?.reasoning}
                      className={`${styles.advancedRow} ${preferencesSubmenu === "effort" ? styles.activeRow : ""}`}
                      onMouseEnter={() => currentModel?.reasoning && setPreferencesSubmenu("effort")}
                      onFocus={() => currentModel?.reasoning && setPreferencesSubmenu("effort")}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowRight" && currentModel?.reasoning) {
                          event.preventDefault();
                          event.stopPropagation();
                          openPreferencesSubmenu("effort");
                        }
                      }}
                      onClick={() => currentModel?.reasoning && openPreferencesSubmenu("effort")}
                    >
                      <span>Çaba</span>
                      <span className={styles.advancedValue}>{currentEffortLabel}</span>
                      {currentModel?.reasoning ? <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" /> : <span />}
                    </button>
                    <div className={styles.preferencesSeparator} />
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.resetPreferences}
                      onMouseEnter={() => setPreferencesSubmenu(undefined)}
                      onFocus={() => setPreferencesSubmenu(undefined)}
                      onClick={() => {
                        onResetPreferences();
                        closePreferencesMenu();
                      }}
                    >
                      <span>Varsayılana sıfırla</span>
                      <RotateCcw size={14} strokeWidth={1.65} aria-hidden="true" />
                    </button>
              </div>

                  {preferencesSubmenu === "model" ? (
                    <div
                      ref={modelSubmenuRef}
                      className={`${styles.preferencesSubmenu} ${styles.modelSubmenu}`}
                      role="menu"
                      aria-label={pinnedModelCount > 0 ? `Model, ${pinnedModelCount} sabitlenen` : "Model"}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") {
                          event.preventDefault();
                          event.stopPropagation();
                          closePreferencesSubmenu("model");
                          return;
                        }
                        handleMenuKeyDown(event, { onEscape: closePreferencesMenu });
                      }}
                    >
                      <button type="button" className={styles.submenuHeading} onClick={() => closePreferencesSubmenu("model")}>
                        <span>Model</span>
                      </button>
                      <div className={styles.submenuList}>
                        {visibleModels.map((model) => {
                          const value = `${model.provider}/${model.id}`;
                          const selected = currentModelValue === value;
                          return (
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              key={value}
                              className={`${styles.submenuOption} ${selected ? styles.selectedSubmenuOption : ""}`}
                              onClick={() => {
                                onSelectModel(model.provider, model.id);
                                closePreferencesMenu();
                              }}
                            >
                              <span>{formatModelLabel(value)}</span>
                              {selected ? <Check size={14} strokeWidth={1.8} aria-hidden="true" /> : null}
                            </button>
                          );
                        })}
                        {visibleModels.length === 0 ? <div className={styles.emptySubmenu}>Yapılandırılmış model yok.</div> : null}
                      </div>
                    </div>
                  ) : null}

                  {preferencesSubmenu === "effort" ? (
                    <div
                      ref={effortSubmenuRef}
                      className={`${styles.preferencesSubmenu} ${styles.effortSubmenu}`}
                      role="menu"
                      aria-label="Çaba"
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft") {
                          event.preventDefault();
                          event.stopPropagation();
                          closePreferencesSubmenu("effort");
                          return;
                        }
                        handleMenuKeyDown(event, { onEscape: closePreferencesMenu });
                      }}
                    >
                      <button type="button" className={styles.submenuHeading} onClick={() => closePreferencesSubmenu("effort")}>
                        <span>Çaba</span>
                      </button>
                      <div className={styles.submenuList}>
                        {availableThinkingOptions.map((option) => {
                          const selected = currentThinking === option.value;
                          return (
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              key={option.value}
                              className={`${styles.submenuOption} ${selected ? styles.selectedSubmenuOption : ""}`}
                              onClick={() => {
                                onSetThinking(option.value);
                                closePreferencesMenu();
                              }}
                            >
                              <span>{option.label}</span>
                              {selected ? <Check size={14} strokeWidth={1.8} aria-hidden="true" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
            </div>
          </details>

          {agentBusy ? (
            <button type="button" className={`${styles.sendButton} ${styles.stopButton}`} aria-label="Yanıtı durdur" title="Yanıtı durdur" onClick={triggerPetStop}>
              <Square size={13} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className={styles.sendButton} aria-label={promptPending ? "Gönderiliyor" : "Gönder"} disabled={promptPending || !canSubmit}>
              {promptPending ? <span className={styles.pendingDots}>…</span> : <ArrowUp size={18} strokeWidth={2.2} aria-hidden="true" />}
            </button>
          )}
        </div>
      </footer>
    </form>
    {renderQuickActions()}
  </>;
}

function ComposerAddMenuExtensionIcon({ kind }: { kind: ComposerAddMenuExtensionKind }) {
  if (kind === "pdf") {
    return <span className={styles.addExtensionIcon} data-kind={kind} aria-hidden="true"><span className={styles.addPdfGlyph}>PDF</span></span>;
  }
  const Icon = kind === "documents"
    ? FileText
    : kind === "spreadsheets"
      ? FileSpreadsheet
      : kind === "presentations"
        ? Presentation
        : kind === "templates"
          ? LayoutTemplate
          : Puzzle;
  return <span className={styles.addExtensionIcon} data-kind={kind} aria-hidden="true"><Icon size={10} strokeWidth={2.1} /></span>;
}

function ComposerPlanPill({ plan, onOpenPlan }: { plan: WebPlanState; onOpenPlan?: () => void }) {
  const total = plan.steps.length;
  const completed = plan.steps.filter((step) => step.completed || step.status === "completed").length;
  const complete = total > 0 && completed === total;
  if (complete) return null;
  const currentIndex = Math.max(
    0,
    plan.steps.findIndex((step) => step.status === "active") >= 0
      ? plan.steps.findIndex((step) => step.status === "active")
      : plan.steps.findIndex((step) => !step.completed),
  );
  const current = plan.steps[currentIndex];
  const label = current?.fullText || current?.text || `${total} plan adımı`;
  const currentStep = Math.min(total, Math.max(1, currentIndex + 1));
  const progressStart = total > 0 ? completed / total : 0;
  const progressTarget = Math.min(0.96, (completed + 0.82) / total);
  const ringStyle = {
    "--plan-progress-from": `${100 - (progressStart * 100)}`,
    "--plan-progress-to": `${100 - (progressTarget * 100)}`,
  } as React.CSSProperties;

  return <section className={styles.planPill} aria-label="Plan ilerlemesi">
    <div className={styles.planPillDetail} role="status" aria-live="polite">
      <ol className={styles.planPillStepList} aria-label="Plan adımları">
        {plan.steps.map((step, index) => {
          const isCompleted = step.completed || step.status === "completed";
          const isActive = !isCompleted && (step.status === "active" || index === currentIndex);
          const isBlocked = step.status === "blocked";
          const status = isCompleted ? "completed" : isActive ? "active" : isBlocked ? "blocked" : "pending";
          const text = step.fullText || step.text || `Adım ${step.step || index + 1}`;
          return (
            <li className={styles.planPillStep} data-status={status} key={`${step.step}:${step.text}:${index}`}>
              <span className={styles.planPillStatusMark} data-status={status} aria-hidden="true">
                {isCompleted
                  ? <Check size={10} strokeWidth={2.6} />
                  : isActive
                    ? <span className={styles.planPillSpinner} />
                    : <span className={styles.planPillPendingDot} />}
              </span>
              <span className={styles.planPillStepText}>{text}</span>
            </li>
          );
        })}
      </ol>
    </div>
    <button
      type="button"
      className={styles.planPillTrigger}
      aria-label={`${label}. Adım ${currentStep} / ${total}. Planı aç`}
      title="Planı aç"
      onClick={onOpenPlan}
    >
      <svg className={styles.planPillRing} viewBox="0 0 16 16" aria-hidden="true">
        <circle className={styles.planPillRingTrack} cx="8" cy="8" r="5.5" pathLength="100" />
        <circle
          key={`${completed}:${currentStep}`}
          className={styles.planPillRingValue}
          cx="8"
          cy="8"
          r="5.5"
          pathLength="100"
          style={ringStyle}
        />
      </svg>
      <span>Adım {currentStep} / {total}</span>
    </button>
  </section>;
}

function closeDetails(event: React.MouseEvent<HTMLElement>) {
  const details = event.currentTarget.closest("details");
  closeDetailsElement(details);
}

function documentTemplateDisplayName(skillName: string): string {
  return skillName
    .replace(/^artifact-template-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function closeDetailsElement(details: HTMLDetailsElement | null) {
  if (!details) return;
  details.open = false;
  restoreMenuTriggerFocus(details.querySelector<HTMLElement>("summary"));
}

function getAvailableThinkingOptions(model?: ComposerModel): ComposerThinkingOption[] {
  if (!model?.reasoning) return [];
  return THINKING_OPTIONS.filter((option) => (
    (option.value !== "xhigh" || model.supportsXhigh)
    && (option.value !== "max" || model.supportsMax)
  ));
}
