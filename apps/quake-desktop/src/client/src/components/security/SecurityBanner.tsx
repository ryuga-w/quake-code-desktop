import React from "react";
import { type Translate, useI18n } from "../../i18n";
import { useAppStore } from "../../state/app-store";

export function SecurityBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useI18n();
  const config = useAppStore((s) => s.config);
  if (!config) return null;
  const warnings = securityWarnings(config, t);
  if (!warnings.length) return null;
  const level = warnings.some((item) => item.level === "error") ? "error" : "warning";
  return <section className={`security-banner ${level}`}><div><strong>{t("runtime.security.warning")}</strong><span>{warnings.map((item) => item.text).join(" · ")}</span></div><div className="security-pills"><button type="button" onClick={onOpenSettings}>{t("runtime.security.openSettings")}</button></div></section>;
}

function securityWarnings(config: any, t: Translate): Array<{ level: "warning" | "error"; text: string }> {
  const warnings: Array<{ level: "warning" | "error"; text: string }> = [];
  if (!config.authEnabled) warnings.push({ level: "error", text: t("runtime.security.authDisabled") });
  if (config.authEnabled && !window.__QUAKE_WEB_TOKEN__) warnings.push({ level: "error", text: t("runtime.security.tokenMissing") });
  if (!["127.0.0.1", "localhost"].includes(String(config.host))) warnings.push({ level: "warning", text: t("runtime.security.remoteAccess") });
  if (!config.cwd) warnings.push({ level: "warning", text: t("runtime.security.workspaceBoundary") });
  return warnings;
}
