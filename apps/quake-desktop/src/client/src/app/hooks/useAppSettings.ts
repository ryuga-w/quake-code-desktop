import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { desktop } from "../../lib/desktop";
import { readStorageValue, writeStorageJson, writeStorageValue } from "../../lib/storage";
import { DEFAULT_THEME } from "../../lib/theme";
import { normalizeThemeId, type SettingsView, type ThemeId } from "../../components/settings/SettingsPanels";
import { useAppStore, type ToastState } from "../../state/app-store";

export type AppSettingsDensity = "comfortable" | "compact" | "dense";

export type AppSettingsOptions = {
  commandPaletteOpen: boolean;
  sendCommand: (command: any) => Promise<any>;
  runUiCommand: (command: any, failureMessage?: string) => void;
  selectModel: (provider: string, modelId: string) => void;
  openWorkspace: () => void | Promise<void>;
  setPromptHistory: (history: string[]) => void;
  setStore: (patch: any) => void;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
};

function initialTheme(): ThemeId {
  try {
    if (localStorage.getItem("quake-web:theme-v2") !== "1") {
      localStorage.setItem("quake-web:theme", DEFAULT_THEME);
      localStorage.setItem("quake-web:theme-v2", "1");
      return DEFAULT_THEME;
    }
  } catch {
    // Storage is optional in restricted renderer contexts.
  }
  return normalizeThemeId(readStorageValue("quake-web:theme", DEFAULT_THEME));
}

/** Owns settings-page state, appearance persistence, and settings actions. */
export function useAppSettings(options: AppSettingsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [density, setDensity] = useState<AppSettingsDensity>(
    () => readStorageValue("quake-web:density", "comfortable") as AppSettingsDensity,
  );
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<SettingsView | undefined>();
  const [terminalPolicyPending, setTerminalPolicyPending] = useState(false);
  const terminalPolicyPendingRef = useRef(false);
  const settingsOpenRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem("quake-web:theme", theme);
    } catch {
      // Ignore unavailable storage; DOM theme still applies.
    }
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    desktop?.setResolvedTheme?.(theme);
    if (theme === "dark") desktop?.setOverlay?.("#201e20", "#e8e8ea");
    else desktop?.setOverlay?.("#f1eff1", "#1a1a1a");
  }, [theme]);

  useEffect(() => {
    settingsOpenRef.current = settingsModalOpen;
  }, [settingsModalOpen]);

  useEffect(() => {
    if (!settingsModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || options.commandPaletteOpen) return;
      event.preventDefault();
      setSettingsModalOpen(false);
      setSettingsInitialView(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [options.commandPaletteOpen, settingsModalOpen]);

  useEffect(() => {
    const fontSize = readStorageValue("quake-web:fontSize", "");
    if (fontSize) document.documentElement.style.setProperty("--font-size", fontSize);
    const animationSpeed = readStorageValue("quake-web:animationSpeed", "");
    if (!animationSpeed) return;
    document.documentElement.style.setProperty("--animation-speed", animationSpeed);
    if (animationSpeed === "0") document.documentElement.setAttribute("data-motion", "off");
    else if (animationSpeed !== "1") document.documentElement.setAttribute("data-motion", "scaled");
  }, []);

  const openSettingsPage = useCallback((view?: SettingsView) => {
    setSettingsInitialView(view);
    setSettingsModalOpen(true);
  }, []);

  const closeSettingsModal = useCallback(() => {
    setSettingsModalOpen(false);
    setSettingsInitialView(undefined);
  }, []);

  const updateDensity = useCallback((value: AppSettingsDensity) => {
    setDensity(value);
    writeStorageValue("quake-web:density", value);
  }, []);

  const updateTheme = useCallback((value: ThemeId) => {
    const next = normalizeThemeId(value);
    setTheme(next);
    writeStorageValue("quake-web:theme", next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: ThemeId = current === "dark" ? "light" : "dark";
      writeStorageValue("quake-web:theme", next);
      return next;
    });
  }, []);

  const onSettingsThinking = useCallback((level: any) => {
    optionsRef.current.runUiCommand(
      { type: "set_thinking_level", level },
      "Düşünme seviyesi değiştirilemedi",
    );
  }, []);

  const onSettingsSetModel = useCallback((value: string) => {
    const [provider, ...idParts] = value.split("/");
    optionsRef.current.selectModel(provider, idParts.join("/"));
  }, []);

  const onSettingsOpenWorkspace = useCallback(() => {
    closeSettingsModal();
    void optionsRef.current.openWorkspace();
  }, [closeSettingsModal]);

  const onSettingsCompact = useCallback(() => {
    optionsRef.current.runUiCommand(
      { type: "slash_command", command: "compact", args: "" },
      "Sıkıştırma başlatılamadı",
    );
  }, []);

  const onSettingsClearPromptHistory = useCallback(() => {
    optionsRef.current.setPromptHistory([]);
    writeStorageJson("quake-web:promptHistory", []);
    optionsRef.current.showToast("Komut geçmişi temizlendi", "success");
  }, []);

  const onSettingsSetDefaultModel = useCallback((value: string) => {
    const [provider, ...idParts] = value.split("/");
    const current = optionsRef.current;
    current.sendCommand({ type: "set_default_model", provider, modelId: idParts.join("/") })
      .then(() => apiGet<any>("/api/settings"))
      .then((result) => current.setStore({ runtimeSettings: result.settings }))
      .catch(() => current.showToast("Varsayılan model kaydedilemedi", "error"));
  }, []);

  const onSettingsSetDefaultThinking = useCallback((level: string) => {
    const current = optionsRef.current;
    current.sendCommand({ type: "set_default_thinking", level })
      .then(() => apiGet<any>("/api/settings"))
      .then((result) => current.setStore({ runtimeSettings: result.settings }))
      .catch(() => current.showToast("Varsayılan düşünme kaydedilemedi", "error"));
  }, []);

  const onSettingsAutoCompaction = useCallback((enabled: boolean) => {
    optionsRef.current.runUiCommand(
      { type: "set_auto_compaction", enabled },
      "Otomatik sıkıştırma değiştirilemedi",
    );
  }, []);

  const onSettingsTerminalPolicy = useCallback(async (mode: "safe" | "allow-all" | "disabled") => {
    if (terminalPolicyPendingRef.current) return;
    terminalPolicyPendingRef.current = true;
    setTerminalPolicyPending(true);
    const current = optionsRef.current;
    try {
      const response = await current.sendCommand({ type: "set_terminal_policy", mode });
      const data = (response?.data || {}) as {
        terminalPolicyMode?: "safe" | "allow-all" | "disabled";
        terminalEnabled?: boolean;
        approvalPreset?: string;
        approvalLabel?: string;
        approvalPresetId?: string;
        approvalPresetLabel?: string;
      };
      const nextMode = data.terminalPolicyMode || mode;
      const storeConfig = useAppStore.getState().config || {};
      current.setStore({
        config: {
          ...storeConfig,
          terminalPolicyMode: nextMode,
          terminalEnabled: data.terminalEnabled ?? nextMode !== "disabled",
          approvalPresetId: data.approvalPreset || data.approvalPresetId || storeConfig.approvalPresetId,
          approvalPresetLabel: data.approvalLabel || data.approvalPresetLabel || storeConfig.approvalPresetLabel,
        },
      });
    } catch (error: any) {
      current.showToast(`Erişim rejimi değiştirilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
      throw error;
    } finally {
      terminalPolicyPendingRef.current = false;
      setTerminalPolicyPending(false);
    }
  }, []);

  const onSettingsBlockImages = useCallback((blocked: boolean) => {
    optionsRef.current.runUiCommand(
      { type: "set_block_images", blocked },
      "Görsel engeli değiştirilemedi",
    );
  }, []);

  const onSettingsShowImages = useCallback((show: boolean) => {
    optionsRef.current.runUiCommand(
      { type: "set_show_images", show },
      "Görsel gösterimi değiştirilemedi",
    );
  }, []);

  return {
    density,
    theme,
    settingsModalOpen,
    settingsInitialView,
    terminalPolicyPending,
    settingsOpenRef,
    openSettingsPage,
    closeSettingsModal,
    updateDensity,
    updateTheme,
    toggleTheme,
    onSettingsThinking,
    onSettingsSetModel,
    onSettingsOpenWorkspace,
    onSettingsCompact,
    onSettingsClearPromptHistory,
    onSettingsSetDefaultModel,
    onSettingsSetDefaultThinking,
    onSettingsAutoCompaction,
    onSettingsTerminalPolicy,
    onSettingsBlockImages,
    onSettingsShowImages,
  };
}

export type UseAppSettingsReturn = ReturnType<typeof useAppSettings>;
