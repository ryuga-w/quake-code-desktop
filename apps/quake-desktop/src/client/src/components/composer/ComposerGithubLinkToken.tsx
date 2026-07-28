import React from "react";
import { Check, ExternalLink, GitFork, Link2, Pencil, X } from "lucide-react";
import { desktop, isDesktop } from "../../lib/desktop";
import {
  githubLinkWithDisplayText,
  githubLinkWithUrl,
  type ComposerGithubLink,
} from "../../lib/composer-github-link";
import styles from "./ComposerGithubLinkToken.module.css";

type EditorMode = "text" | "url";

type Props = {
  link: ComposerGithubLink;
  onChangeSource: (source: string) => void;
};

export function ComposerGithubLinkToken({ link, onChangeSource }: Props) {
  const rootRef = React.useRef<HTMLSpanElement>(null);
  const editInputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [editorMode, setEditorMode] = React.useState<EditorMode>();
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
      setEditorMode(undefined);
      setError("");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      setEditorMode(undefined);
      setError("");
    };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!editorMode) return;
    requestAnimationFrame(() => {
      editInputRef.current?.focus({ preventScroll: true });
      editInputRef.current?.select();
    });
  }, [editorMode]);

  React.useEffect(() => {
    setEditorMode(undefined);
    setError("");
  }, [link.source]);

  const beginEdit = (mode: EditorMode) => {
    setEditorMode(mode);
    setDraft(mode === "text" ? link.displayText : link.url);
    setError("");
  };

  const commit = () => {
    if (editorMode === "text") {
      const text = draft.trim();
      if (!text) {
        setError("Bağlantı metni boş olamaz");
        return;
      }
      onChangeSource(githubLinkWithDisplayText(link, text));
    } else if (editorMode === "url") {
      const source = githubLinkWithUrl(link, draft);
      if (!source) {
        setError("Geçerli bir GitHub bağlantısı veya owner/repo yazın");
        return;
      }
      onChangeSource(source);
    }
    setEditorMode(undefined);
    setError("");
  };

  const openLink = () => {
    if (isDesktop && desktop?.browser.openExternal) {
      void desktop.browser.openExternal(link.url);
    } else {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
    setOpen(false);
  };

  return (
    <span className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.token}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={link.url}
        onClick={() => {
          setOpen((value) => !value);
          setEditorMode(undefined);
          setError("");
        }}
      >
        <GitFork size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>{link.displayText}</span>
      </button>

      {open ? (
        <div className={styles.popover} role="dialog" aria-label="GitHub bağlantısını düzenle">
          {editorMode ? (
            <form
              className={styles.editor}
              onSubmit={(event) => {
                event.preventDefault();
                commit();
              }}
            >
              <span className={styles.editorIcon} aria-hidden="true">
                {editorMode === "text" ? <Pencil size={13} /> : <Link2 size={13} />}
              </span>
              <input
                ref={editInputRef}
                value={draft}
                aria-label={editorMode === "text" ? "Bağlantı metni" : "GitHub bağlantısı"}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError("");
                }}
              />
              <button type="submit" className={styles.editorAction} aria-label="Kaydet" title="Kaydet">
                <Check size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.editorAction}
                aria-label="İptal"
                title="İptal"
                onClick={() => {
                  setEditorMode(undefined);
                  setError("");
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
              {error ? <span className={styles.error} role="alert">{error}</span> : null}
            </form>
          ) : (
            <div className={styles.actions}>
              <button type="button" onClick={openLink}>
                <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>Open link</span>
              </button>
              <button type="button" onClick={() => beginEdit("text")}>
                <Pencil size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>Metni düzenle</span>
              </button>
              <button type="button" onClick={() => beginEdit("url")}>
                <Link2 size={13} strokeWidth={1.8} aria-hidden="true" />
                <span>Bağlantıyı düzenle</span>
              </button>
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
