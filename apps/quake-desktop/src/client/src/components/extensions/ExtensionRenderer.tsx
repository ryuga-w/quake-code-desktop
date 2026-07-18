import React, { useState, useCallback } from "react";
import { File, Folder } from "lucide-react";
import { apiPost } from "../../lib/api";
import { useAppStore } from "../../state/app-store";
import styles from "./ExtensionRenderer.module.css";

interface ExtensionComponentProps {
  type: string;
  props: Record<string, any>;
  requestId?: string;
}

export function ExtensionRenderer({ type, props: componentProps, requestId }: ExtensionComponentProps) {
  const renderer = COMPONENT_REGISTRY[type];
  if (!renderer) return <div className={styles.unknown}>Bilinmeyen bileşen: {type}</div>;
  return <div className={styles.container}>{renderer(componentProps, requestId)}</div>;
}

const COMPONENT_REGISTRY: Record<string, (props: Record<string, any>, requestId?: string) => React.ReactNode> = {
  filepicker: FilePickerComponent,
  codeeditor: CodeEditorComponent,
  formbuilder: FormBuilderComponent,
  select: SelectComponent,
  confirm: ConfirmComponent,
  input: InputComponent,
  notify: NotifyComponent,
};

function FilePickerComponent({ onSelect, filter, multiple }: Record<string, any>, _requestId?: string) {
  const files = useAppStore((s) => s.files);
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = filter ? files.filter((f: any) => {
    const ext = f.name.split(".").pop()?.toLowerCase();
    return Array.isArray(filter) ? filter.includes(ext) : true;
  }) : files;

  function toggle(path: string) {
    setSelected((prev) => multiple ? (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]) : [path]);
  }

  return (
    <div className={styles.filePicker}>
      <div className={styles.fileList}>
        {filtered.map((file: any) => (
          <div key={file.path} className={`${styles.fileItem} ${selected.includes(file.path) ? styles.selected : ""}`} onClick={() => toggle(file.path)}>
            <span aria-hidden="true">{file.type === "directory" ? <Folder size={15} /> : <File size={15} />}</span>
            <span>{file.name}</span>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onSelect?.(multiple ? selected : selected[0])} disabled={selected.length === 0}>Seç</button>
    </div>
  );
}

function CodeEditorComponent({ value, language, onChange, readOnly }: Record<string, any>, _requestId?: string) {
  return (
    <div className={styles.codeEditor}>
      <pre className={styles.codeContent}>{value || ""}</pre>
      {!readOnly && (
        <textarea className={styles.codeInput} value={value || ""} onChange={(e) => onChange?.(e.target.value)} spellCheck={false} />
      )}
    </div>
  );
}

function FormBuilderComponent({ fields, values, onChange, onSubmit }: Record<string, any>, _requestId?: string) {
  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); onSubmit?.(values); }}>
      {(fields || []).map((field: any) => (
        <div key={field.name} className={styles.field}>
          <label>{field.label || field.name}</label>
          {field.type === "select" ? (
            <select value={values?.[field.name] || ""} onChange={(e) => onChange?.({ ...values, [field.name]: e.target.value })}>
              {(field.options || []).map((opt: any) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input type="checkbox" checked={values?.[field.name] || false} onChange={(e) => onChange?.({ ...values, [field.name]: e.target.checked })} />
          ) : (
            <input type={field.type || "text"} value={values?.[field.name] || ""} placeholder={field.placeholder} onChange={(e) => onChange?.({ ...values, [field.name]: e.target.value })} />
          )}
        </div>
      ))}
      <button type="submit">Gönder</button>
    </form>
  );
}

function SelectComponent({ title, options, onSelect }: Record<string, any>, _requestId?: string) {
  return (
    <div className={styles.selectDialog}>
      <h4>{title}</h4>
      <div className={styles.options}>
        {(options || []).map((opt: string, i: number) => (
          <button key={i} type="button" onClick={() => onSelect?.(opt)}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

function ConfirmComponent({ title, message, onConfirm, onCancel }: Record<string, any>, _requestId?: string) {
  return (
    <div className={styles.confirmDialog}>
      <h4>{title}</h4>
      <p>{message}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => onCancel?.()}>İptal</button>
        <button type="button" onClick={() => onConfirm?.()}>Onayla</button>
      </div>
    </div>
  );
}

function InputComponent({ title, placeholder, value, onSubmit, onCancel }: Record<string, any>, _requestId?: string) {
  const [inputValue, setInputValue] = useState(value || "");
  return (
    <div className={styles.inputDialog}>
      <h4>{title}</h4>
      <input type="text" value={inputValue} placeholder={placeholder} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSubmit?.(inputValue); }} autoFocus />
      <div className={styles.actions}>
        <button type="button" onClick={() => onCancel?.()}>İptal</button>
        <button type="button" onClick={() => onSubmit?.(inputValue)}>Gönder</button>
      </div>
    </div>
  );
}

function NotifyComponent({ message, type }: Record<string, any>, _requestId?: string) {
  return (
    <div className={`${styles.notification} ${styles[type || "info"]}`}>
      {message}
    </div>
  );
}
