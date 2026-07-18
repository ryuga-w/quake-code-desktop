import React from "react";
import { useAppStore } from "../../state/app-store";

export function SecurityBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const config = useAppStore((s) => s.config);
  if (!config) return null;
  const warnings = securityWarnings(config);
  if (!warnings.length) return null;
  const level = warnings.some((item) => item.level === "error") ? "error" : "warning";
  return <section className={`security-banner ${level}`}><div><strong>Güvenlik uyarısı</strong><span>{warnings.map((item) => item.text).join(" · ")}</span></div><div className="security-pills"><button type="button" onClick={onOpenSettings}>Ayarları aç</button></div></section>;
}

function securityWarnings(config: any): Array<{ level: "warning" | "error"; text: string }> {
  const warnings: Array<{ level: "warning" | "error"; text: string }> = [];
  if (!config.authEnabled) warnings.push({ level: "error", text: "Kimlik doğrulama kapalı" });
  if (config.authEnabled && !window.__QUAKE_WEB_TOKEN__) warnings.push({ level: "error", text: "Oturum anahtarı eksik" });
  if (!["127.0.0.1", "localhost"].includes(String(config.host))) warnings.push({ level: "warning", text: "Uzak bağlantı açık" });
  if (!config.cwd) warnings.push({ level: "warning", text: "Çalışma alanı sınırı belirsiz" });
  return warnings;
}
