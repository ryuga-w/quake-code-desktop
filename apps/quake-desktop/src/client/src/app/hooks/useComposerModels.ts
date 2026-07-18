import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { formatComposerModelLabel } from "../../lib/format-utils";
import { configuredModels as listConfiguredModels } from "../../lib/models";
import { readStorageArray, writeStorageJson, writeStorageValue } from "../../lib/storage";
import type { ToastState } from "../../state/app-store";

export type ComposerModelsOptions = {
  models: any[];
  sessionModel?: any;
  sessionThinkingLevel?: string;
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  stateCwd: string;
  modelsRefreshSeqRef: MutableRefObject<number>;
  setLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setStore: (patch: any) => void;
  sendCommand: (command: any) => Promise<any>;
  runUiCommand: (command: any, failureMessage?: string) => void;
  showToast: (
    message: string,
    type?: ToastState["type"],
    options?: Pick<ToastState, "actionLabel" | "action">,
  ) => string;
};

/** Owns pinned model visibility, current selection, and model refresh actions. */
export function useComposerModels(options: ComposerModelsOptions) {
  const {
    models,
    sessionModel,
    sessionThinkingLevel,
    defaultProvider,
    defaultModel,
    defaultThinkingLevel,
    stateCwd,
    modelsRefreshSeqRef,
    setLoading,
    setStore,
    sendCommand,
    runUiCommand,
    showToast,
  } = options;
  const [pinnedModels, setPinnedModels] = useState<string[]>(
    () => readStorageArray<string>("quake-web:pinnedComposerModels"),
  );

  useEffect(() => {
    let cancelled = false;
    void apiGet<any>("/api/web-settings").then((result) => {
      if (cancelled) return;
      const persisted = result?.settings?.pinnedComposerModels;
      if (!Array.isArray(persisted)) return;
      const next = persisted.filter((value: unknown): value is string => typeof value === "string");
      setPinnedModels(next);
      writeStorageJson("quake-web:pinnedComposerModels", next);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stateCwd]);

  useEffect(() => {
    const syncPinnedModels = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      setPinnedModels(
        Array.isArray(detail)
          ? detail
          : readStorageArray<string>("quake-web:pinnedComposerModels"),
      );
    };
    window.addEventListener("quake:pinned-models-change", syncPinnedModels);
    return () => window.removeEventListener("quake:pinned-models-change", syncPinnedModels);
  }, []);

  const configuredModels = useMemo(() => listConfiguredModels(models), [models]);
  const visibleModels = useMemo(
    () => pinnedModels.length > 0
      ? configuredModels.filter((model: any) => pinnedModels.includes(`${model.provider}/${model.id}`))
      : configuredModels,
    [configuredModels, pinnedModels],
  );
  const currentModel = visibleModels.find((model: any) => model.current)
    || configuredModels.find((model: any) => model.current)
    || (sessionModel && configuredModels.find(
      (model: any) => model.provider === sessionModel.provider && model.id === sessionModel.id,
    ))
    || configuredModels[0]
    || sessionModel;
  const currentModelValue = currentModel ? `${currentModel.provider}/${currentModel.id}` : "";
  const currentModelLabel = formatComposerModelLabel(currentModelValue);
  const currentThinking = String(sessionThinkingLevel || defaultThinkingLevel || "medium");

  function selectModel(provider: string, modelId: string) {
    const value = `${provider}/${modelId}`;
    setStore({
      models: models.map((model: any) => ({
        ...model,
        current: model.provider === provider && model.id === modelId,
      })),
    });
    writeStorageValue("quake-web:model", value);
    apiPost("/api/web-settings", { selectedModel: value }).catch(() => {});
    void sendCommand({ type: "set_model", provider, modelId })
      .then(() => refreshModels())
      .catch((error: any) => {
        showToast(`Model değiştirilemedi: ${error?.message || "bilinmeyen hata"}`, "error");
        void refreshModels();
      });
  }

  function resetComposerPreferences() {
    const provider = String(defaultProvider || "");
    const modelId = String(defaultModel || "");
    const thinkingLevel = String(defaultThinkingLevel || "medium");
    if (provider && modelId && currentModelValue !== `${provider}/${modelId}`) {
      selectModel(provider, modelId);
    }
    if (currentThinking !== thinkingLevel) {
      runUiCommand(
        { type: "set_thinking_level", level: thinkingLevel },
        "Varsayılan çaba seviyesi uygulanamadı",
      );
    }
  }

  async function refreshModels() {
    const requestSeq = ++modelsRefreshSeqRef.current;
    setLoading((state) => ({ ...state, models: true }));
    try {
      const result = await apiGet<any>("/api/models");
      if (requestSeq !== modelsRefreshSeqRef.current) return;
      setStore({ models: result.models });
    } catch (error: any) {
      if (requestSeq !== modelsRefreshSeqRef.current) return;
      showToast(`Modeller alınamadı: ${error.message}`, "error");
    } finally {
      if (requestSeq === modelsRefreshSeqRef.current) {
        setLoading((state) => ({ ...state, models: false }));
      }
    }
  }

  return {
    pinnedModels,
    configuredModels,
    visibleModels,
    currentModel,
    currentModelValue,
    currentModelLabel,
    currentThinking,
    selectModel,
    resetComposerPreferences,
    refreshModels,
  };
}

export type UseComposerModelsReturn = ReturnType<typeof useComposerModels>;
