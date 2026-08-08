import React from "react";
import { normalizeThemeId } from "../settings/SettingsPanels";
import { readStorageValue } from "../../lib/storage";
import { DEFAULT_THEME, monacoThemeFor } from "../../lib/theme";
import { useI18n } from "../../i18n";
import { EditableMonaco } from "./EditableMonaco";
import type { MainView } from "../../types";

const Editor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.default })));
const DiffEditor = React.lazy(() => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })));

export function MainEditorView({ view, onBack }: { view: Exclude<MainView, { mode: "chat" }>; onBack: () => void }) {
  const { t } = useI18n();
  const monacoTheme = monacoThemeFor(normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME)));
  return (
    <section className="main-editor-view">
      <header>
        <div>
          <button type="button" onClick={onBack}>← Sohbete dön</button>
          <h2>{view.title}</h2>
        </div>
      </header>
      <div className="main-editor-container">
        {view.mode === "editor" && view.path ? (
          <EditableMonaco path={view.path} content={view.content} onClose={onBack} />
        ) : view.mode === "editor" ? (
          <React.Suspense fallback={<div className="panel-loading">{t("tools.activity.loading")}</div>}>
            <Editor theme={monacoTheme} value={view.content} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />
          </React.Suspense>
        ) : (
          <React.Suspense fallback={<div className="panel-loading">{t("tools.activity.loading")}</div>}>
            <DiffEditor theme={monacoTheme} original={view.original} modified={view.modified} options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }} />
          </React.Suspense>
        )}
      </div>
    </section>
  );
}
