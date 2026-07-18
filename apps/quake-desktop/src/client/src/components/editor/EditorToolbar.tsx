import React from "react";
import { Braces, Redo2, RotateCcw, Save, Undo2, WrapText, X } from "lucide-react";
import styles from "./EditorToolbar.module.css";

export interface EditorToolbarProps {
  path?: string;
  isDirty: boolean;
  isSaving: boolean;
  isReadOnly?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onSave: () => void;
  onRevert: () => void;
  onClose: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFormat?: () => void;
  wordWrap?: boolean;
  onToggleWordWrap?: () => void;
}

export function EditorToolbar({ path, isDirty, isSaving, isReadOnly, canUndo, canRedo, onSave, onRevert, onClose, onUndo, onRedo, onFormat, wordWrap, onToggleWordWrap }: EditorToolbarProps) {
  const fileName = path?.split(/[\\/]/).pop() || "Dosya";
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        <span className={styles.fileName}>{fileName}</span>
        {path && <span className={styles.filePath}>{path}</span>}
        {isDirty && <span className={styles.dirty}>•</span>}
        {isReadOnly && <span className={styles.readOnly}>Salt okunur</span>}
      </div>
      <div className={styles.right}>
        {onToggleWordWrap && (
          <button type="button" className={`${styles.iconBtn} ${wordWrap ? styles.active : ""}`} onClick={onToggleWordWrap} title={wordWrap ? "Sözcük kaydırmayı kapat" : "Sözcük kaydırmayı aç"} aria-label={wordWrap ? "Sözcük kaydırmayı kapat" : "Sözcük kaydırmayı aç"} aria-pressed={Boolean(wordWrap)}>
            <WrapText size={15} aria-hidden="true" />
          </button>
        )}
        {onFormat && (
          <button type="button" className={styles.iconBtn} onClick={onFormat} title="Biçimlendir" aria-label="Dosyayı biçimlendir">
            <Braces size={15} aria-hidden="true" />
          </button>
        )}
        {onUndo && (
          <button type="button" className={styles.iconBtn} onClick={onUndo} disabled={!canUndo} title="Geri al (Ctrl+Z)" aria-label="Geri al">
            <Undo2 size={15} aria-hidden="true" />
          </button>
        )}
        {onRedo && (
          <button type="button" className={styles.iconBtn} onClick={onRedo} disabled={!canRedo} title="İleri al (Ctrl+Shift+Z)" aria-label="İleri al">
            <Redo2 size={15} aria-hidden="true" />
          </button>
        )}
        <span className={styles.separator} aria-hidden="true" />
        <button type="button" className={styles.iconBtn} onClick={onRevert} disabled={!isDirty || isSaving} title="Kaydedilmemiş değişiklikleri geri al" aria-label="Değişiklikleri geri al">
          <RotateCcw size={15} aria-hidden="true" />
        </button>
        {!isReadOnly && <button type="button" className={styles.save} onClick={onSave} disabled={!isDirty || isSaving} title="Kaydet (Ctrl+S)">
          <Save size={14} aria-hidden="true" /><span>{isSaving ? "Kaydediliyor…" : "Kaydet"}</span>
        </button>}
        <button type="button" className={`${styles.iconBtn} ${styles.close}`} onClick={onClose} title="Kapat" aria-label="Editörü kapat">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
