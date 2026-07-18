import React, { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { readStorageArray, writeStorageJson } from "../../lib/storage";
import { useAppStore } from "../../state/app-store";

export type SlashAutocompleteHandle = {
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

export function nextSlashAutocompleteIndex(current: number, itemCount: number, direction: 1 | -1): number {
  if (itemCount <= 0) return 0;
  return (current + direction + itemCount) % itemCount;
}

type SlashAutocompleteProps = {
  prompt: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onPick: (value: string) => void;
};

export const SlashAutocomplete = React.forwardRef<SlashAutocompleteHandle, SlashAutocompleteProps>(function SlashAutocomplete(
  { prompt, inputRef, onPick },
  ref,
) {
  const commands = useAppStore((s) => s.commands);
  const [recent, setRecent] = useState<string[]>(() => readStorageArray<string>("quake-web:recentSlashCommands"));
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const previousPromptRef = useRef(prompt);
  const listboxId = `${useId()}-slash-commands`;
  const isSlashPrompt = prompt.startsWith("/") && !prompt.includes(" ");
  const q = prompt.toLowerCase();
  const items = commands.filter((command: any) => String(command.name).toLowerCase().startsWith(q)).slice(0, 8);
  const open = isSlashPrompt && !dismissed;
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, items.length - 1));
  const activeOptionId = items.length ? `${listboxId}-option-${boundedActiveIndex}` : undefined;

  useEffect(() => {
    if (previousPromptRef.current === prompt) return;
    previousPromptRef.current = prompt;
    setActiveIndex(0);
    setDismissed(false);
  }, [prompt]);

  useEffect(() => {
    if (activeIndex < items.length || activeIndex === 0) return;
    setActiveIndex(Math.max(0, items.length - 1));
  }, [activeIndex, items.length]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    if (isSlashPrompt) {
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-haspopup", "listbox");
      input.setAttribute("aria-expanded", String(open));
      if (open) input.setAttribute("aria-controls", listboxId);
      else input.removeAttribute("aria-controls");
      if (open && activeOptionId) input.setAttribute("aria-activedescendant", activeOptionId);
      else input.removeAttribute("aria-activedescendant");
    } else {
      input.removeAttribute("role");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-haspopup");
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    }

    return () => {
      input.removeAttribute("role");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-haspopup");
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    };
  }, [activeOptionId, inputRef, isSlashPrompt, listboxId, open]);

  const pick = useCallback((name: string) => {
    const next = [name, ...recent.filter((item) => item !== name)].slice(0, 12);
    setRecent(next);
    writeStorageJson("quake-web:recentSlashCommands", next);
    onPick(`${name} `);
  }, [onPick, recent]);

  useImperativeHandle(ref, () => ({
    handleKeyDown(event) {
      if (!open) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return true;
      }
      if (!items.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => nextSlashAutocompleteIndex(current, items.length, direction));
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        pick(String(items[boundedActiveIndex].name));
        return true;
      }
      return false;
    },
  }), [boundedActiveIndex, items, open, pick]);

  if (!open) return null;

  return <div className="slash-autocomplete">
    <div className="slash-head">Slash komutları <span>Oklarla seç, Tab veya tıklamayla ekle</span></div>
    <div id={listboxId} role="listbox" aria-label="Slash komutları">
      {items.length ? items.map((command: any, index: number) => {
        const active = index === boundedActiveIndex;
        const description = String(command.description || command.source || "");
        return <button
          type="button"
          role="option"
          id={`${listboxId}-option-${index}`}
          key={command.name}
          aria-selected={active}
          aria-label={`${command.name}${description ? `: ${description}` : ""}`}
          style={active ? { backgroundColor: "var(--accent-wash)" } : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => pick(String(command.name))}
        >
          <b>{command.name}</b><span>{description}</span><kbd>{recent.includes(command.name) ? "son" : command.source}</kbd>
        </button>;
      }) : <div className="slash-empty" role="status">Komut yok</div>}
    </div>
  </div>;
});

export function ContextChips({ chips, onRemove }: { chips: Array<{ id: string; type: string; label: string; text: string }>; onRemove: (id: string) => void }) {
  // Browser annotations are already represented by their numbered preview
  // inside the composer. Keep legacy annotation chips model-only so the UI
  // does not show the same attachment twice.
  const visibleChips = chips.filter((chip) => chip.type !== "annotation");
  if (!visibleChips.length) return null;
  return <div className="context-chips">
    <span>Bağlam</span>
    {visibleChips.map((chip) => <button type="button" key={chip.id} className={`context-chip ${chip.type}`} onClick={() => onRemove(chip.id)}><b>{contextTypeLabel(chip.type)}</b>{chip.label}<em>×</em></button>)}
  </div>;
}

function contextTypeLabel(type: string): string {
  if (type === "file") return "dosya";
  if (type === "terminal") return "terminal";
  if (type === "tool") return "araç";
  return type;
}
