import type { ThemeId } from "../components/settings/SettingsPanels";

export const DEFAULT_THEME: ThemeId = "dark";
export const monacoThemeFor = (theme: ThemeId) => (theme === "light" ? "vs" : "vs-dark");
