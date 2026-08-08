import type { ThemeId } from "../components/settings/SettingsPanels";

export const DEFAULT_THEME: ThemeId = "dark";
// Ozel temalar Monaco arka planini timeline zemini (#ececec / koyu #141416) ile
// esitler. Kayit registerQuakeMonacoThemes ile beforeMount'ta yapilir.
export const monacoThemeFor = (theme: ThemeId) => (theme === "light" ? "quake-light" : "quake-dark");

let quakeThemesRegistered = false;

/** Monaco arka planini uygulama timeline zeminine esitleyen ozel temalari kaydeder. */
export function registerQuakeMonacoThemes(monaco: {
  editor: { defineTheme: (name: string, data: unknown) => void };
}): void {
  if (quakeThemesRegistered) return;
  quakeThemesRegistered = true;
  try {
    monaco.editor.defineTheme("quake-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ececec",
        "editorGutter.background": "#ececec",
        "editor.lineHighlightBackground": "#e2e2e2",
        "editorLineNumber.foreground": "#9a9a9e",
        "editorLineNumber.activeForeground": "#4a474a",
        "editor.selectionBackground": "#d3d8e6",
        "editor.inactiveSelectionBackground": "#dde0e6",
      },
    });
    monaco.editor.defineTheme("quake-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#141416",
        "editorGutter.background": "#141416",
        "editor.lineHighlightBackground": "#1b1b1e",
      },
    });
  } catch {
    /* Monaco not ready — ignore; falls back to base theme. */
  }
}
