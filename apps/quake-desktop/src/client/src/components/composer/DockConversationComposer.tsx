import React from "react";
import { ArrowUp, Check, FilePlus2, Plus, Square } from "lucide-react";
import { THINKING_OPTIONS } from "../../constants";
import { focusFirstMenuItem, handleMenuKeyDown, restoreMenuTriggerFocus } from "../../lib/menu-keyboard";
import styles from "./DockConversationComposer.module.css";

export type DockConversationModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  supportsXhigh?: boolean;
  supportsMax?: boolean;
};

type DockConversationComposerProps = {
  value: string;
  ariaLabel: string;
  placeholder: string;
  modelLabel: string;
  modelTitle?: string;
  currentModelValue?: string;
  models?: DockConversationModel[];
  effortLabel: string;
  effortLevel?: string;
  preferencesPending?: boolean;
  busy?: boolean;
  disabled?: boolean;
  sendLabel: string;
  stopLabel: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
  onOpenFiles: () => void;
  onSelectModel?: (provider: string, id: string) => void | Promise<void>;
  onSetThinking?: (level: string) => void | Promise<void>;
  formatModelLabel?: (value: string) => string;
};

export const DockConversationComposer = React.forwardRef<HTMLTextAreaElement, DockConversationComposerProps>(function DockConversationComposer({
  value,
  ariaLabel,
  placeholder,
  modelLabel,
  modelTitle,
  currentModelValue,
  models = [],
  effortLabel,
  effortLevel = "medium",
  preferencesPending = false,
  busy = false,
  disabled = false,
  sendLabel,
  stopLabel,
  onChange,
  onSubmit,
  onAbort,
  onOpenFiles,
  onSelectModel,
  onSetThinking,
  formatModelLabel = (value) => value.split("/").at(-1) || value,
}, forwardedRef) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const addMenuRef = React.useRef<HTMLDetailsElement | null>(null);
  const preferencesMenuRef = React.useRef<HTMLDetailsElement | null>(null);
  const selectedModel = models.find((model) => `${model.provider}/${model.id}` === currentModelValue);
  const thinkingOptions = selectedModel?.reasoning && onSetThinking
    ? THINKING_OPTIONS.filter((option) => (
      (option.value !== "xhigh" || selectedModel.supportsXhigh)
      && (option.value !== "max" || selectedModel.supportsMax)
    ))
    : [];
  const preferencesEnabled = Boolean(onSelectModel && models.length);

  React.useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement, []);

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(220, Math.max(50, textarea.scrollHeight))}px`;
  }, [value]);

  const submit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (disabled || !value.trim()) return;
    void onSubmit();
  };

  const closePreferences = () => {
    const details = preferencesMenuRef.current;
    if (!details) return;
    details.open = false;
    restoreMenuTriggerFocus(details.querySelector<HTMLElement>("summary"));
  };

  return (
    <form className={styles.composer} data-busy={busy ? "true" : "false"} onSubmit={submit}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
      </div>
      <footer className={styles.footer}>
        <div className={styles.primaryControls}>
          <details ref={addMenuRef} className={styles.addMenu}>
            <summary className={styles.iconButton} aria-label="Composer seçenekleri" title="Dosya ve bağlam ekle">
              <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
            </summary>
            <div className={styles.addPopover} role="menu" aria-label="Composer seçenekleri">
              <div className={styles.menuLabel}>Bağlam</div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  addMenuRef.current?.removeAttribute("open");
                  onOpenFiles();
                }}
              >
                <FilePlus2 size={15} aria-hidden="true" />
                <span><b>Dosya ve bağlam</b><small>Projeden dosya veya klasör aç</small></span>
              </button>
            </div>
          </details>
        </div>
        <div className={styles.secondaryControls}>
          {preferencesEnabled ? (
            <details
              ref={preferencesMenuRef}
              name="composer-control-menu"
              className={styles.preferencesMenu}
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  focusFirstMenuItem(event.currentTarget.querySelector<HTMLElement>('[role="menu"]'));
                }
              }}
            >
              <summary
                className={styles.preferenceSummary}
                aria-label={`Model: ${modelLabel}, çaba: ${effortLabel}`}
                aria-busy={preferencesPending}
                title={modelTitle || "Model ve çaba ayarları"}
              >
                <span className={styles.preferenceModel}>{modelLabel}</span>
                <span className={styles.preferenceEffort} data-level={effortLevel}>{effortLabel}</span>
              </summary>
              <div
                className={styles.preferencesPopover}
                role="menu"
                aria-label="Model ve çaba ayarları"
                onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closePreferences })}
              >
                <section className={styles.preferenceSection} aria-labelledby="dock-model-heading">
                  <h3 id="dock-model-heading">Model</h3>
                  <div className={styles.preferenceList}>
                    {models.map((model) => {
                      const value = `${model.provider}/${model.id}`;
                      const selected = currentModelValue === value;
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          disabled={preferencesPending}
                          key={value}
                          onClick={() => {
                            closePreferences();
                            void onSelectModel?.(model.provider, model.id);
                          }}
                        >
                          <span>{model.name || formatModelLabel(value)}</span>
                          {selected ? <Check size={14} strokeWidth={1.9} aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
                {thinkingOptions.length ? (
                  <section className={styles.preferenceSection} aria-labelledby="dock-effort-heading">
                    <h3 id="dock-effort-heading">Çaba</h3>
                    <div className={styles.effortOptions}>
                      {thinkingOptions.map((option) => {
                        const selected = effortLevel === option.value;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            data-selected={selected ? "true" : "false"}
                            disabled={preferencesPending}
                            key={option.value}
                            onClick={() => {
                              closePreferences();
                              void onSetThinking?.(option.value);
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            </details>
          ) : (
            <div className={styles.preferenceSummary} role="group" aria-label={`Model: ${modelLabel}, çaba: ${effortLabel}`} title={modelTitle}>
              <span className={styles.preferenceModel}>{modelLabel}</span>
              <span className={styles.preferenceEffort} data-level={effortLevel}>{effortLabel}</span>
            </div>
          )}
          {busy ? (
            <button type="button" className={`${styles.sendButton} ${styles.stopButton}`} aria-label={stopLabel} title={stopLabel} onClick={() => void onAbort()}>
              <Square size={13} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className={styles.sendButton} aria-label={sendLabel} disabled={disabled || !value.trim()}>
              <ArrowUp size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </form>
  );
});
