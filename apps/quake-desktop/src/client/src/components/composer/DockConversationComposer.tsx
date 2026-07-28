import React from "react";
import { ArrowUp, Check, FilePlus2, Plus, Square } from "lucide-react";
import { THINKING_OPTIONS } from "../../constants";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  const thinkingLabels: Record<(typeof THINKING_OPTIONS)[number]["value"], string> = {
    minimal: t("composer.preferences.effortLevels.minimal"),
    low: t("composer.preferences.effortLevels.low"),
    medium: t("composer.preferences.effortLevels.medium"),
    high: t("composer.preferences.effortLevels.high"),
    xhigh: t("composer.preferences.effortLevels.xhigh"),
    max: t("composer.preferences.effortLevels.max"),
  };
  const localizedEffortLabel = thinkingLabels[effortLevel as (typeof THINKING_OPTIONS)[number]["value"]] || effortLabel;
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
            <summary className={styles.iconButton} aria-label={t("composer.dock.optionsAria")} title={t("composer.dock.addFileAndContextTitle")}>
              <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
            </summary>
            <div className={styles.addPopover} role="menu" aria-label={t("composer.dock.optionsAria")}>
              <div className={styles.menuLabel}>{t("composer.dock.context")}</div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  addMenuRef.current?.removeAttribute("open");
                  onOpenFiles();
                }}
              >
                <FilePlus2 size={15} aria-hidden="true" />
                <span><b>{t("composer.dock.fileAndContext")}</b><small>{t("composer.dock.openFileOrFolder")}</small></span>
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
                aria-label={t("composer.preferences.summaryAria", { model: modelLabel, effort: localizedEffortLabel })}
                aria-busy={preferencesPending}
                title={modelTitle || t("composer.preferences.title")}
              >
                <span className={styles.preferenceModel}>{modelLabel}</span>
                <span className={styles.preferenceEffort} data-level={effortLevel}>{localizedEffortLabel}</span>
              </summary>
              <div
                className={styles.preferencesPopover}
                role="menu"
                aria-label={t("composer.preferences.title")}
                onKeyDown={(event) => handleMenuKeyDown(event, { onEscape: closePreferences })}
              >
                <section className={styles.preferenceSection} aria-labelledby="dock-model-heading">
                  <h3 id="dock-model-heading">{t("composer.preferences.model")}</h3>
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
                    <h3 id="dock-effort-heading">{t("composer.preferences.effort")}</h3>
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
                            {thinkingLabels[option.value]}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            </details>
          ) : (
            <div className={styles.preferenceSummary} role="group" aria-label={t("composer.preferences.summaryAria", { model: modelLabel, effort: localizedEffortLabel })} title={modelTitle}>
              <span className={styles.preferenceModel}>{modelLabel}</span>
              <span className={styles.preferenceEffort} data-level={effortLevel}>{localizedEffortLabel}</span>
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
