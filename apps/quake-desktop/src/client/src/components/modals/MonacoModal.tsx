import React, { useEffect } from "react";
import { normalizeThemeId } from "../settings/SettingsPanels";
import { readStorageValue } from "../../lib/storage";
import { DEFAULT_THEME, monacoThemeFor } from "../../lib/theme";
import { useModalFocusTrap } from "../../lib/modal-focus";
import { EditableMonaco } from "../editor/EditableMonaco";
import type { MonacoModal as MonacoModalType } from "../../types";

const Editor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.default })));
const DiffEditor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })));

export function MonacoModal({ modal, onClose }: { modal: MonacoModalType; onClose: () => void }) {
  const monacoTheme = monacoThemeFor(normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME)));
  const dialogRef = useModalFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="modal-card monaco-card" role="dialog" aria-modal="true" aria-label={modal.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-kicker">Editör</div>
        <h2>{modal.title}</h2>
        <div className="monaco-container">
          {modal.mode === "editor" && modal.path ? (
            <EditableMonaco path={modal.path} content={modal.content} onClose={onClose} />
          ) : (
            <React.Suspense fallback={<div className="panel-loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>Yükleniyor…</div>}>
              {modal.mode === "editor" ? (
                <Editor theme={monacoTheme} value={modal.content} path={modal.path} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />
              ) : (
                <DiffEditor theme={monacoTheme} original={modal.original} modified={modal.modified} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />
              )}
            </React.Suspense>
          )}
        </div>
        {!(modal.mode === "editor" && modal.path) ? (
          <div className="modal-actions"><button type="button" onClick={onClose}>Kapat</button></div>
        ) : null}
      </div>
    </div>
  );
}
