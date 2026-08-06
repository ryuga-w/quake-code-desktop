import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Layers } from "lucide-react";
import { useI18n } from "../../i18n";
import styles from "./ComposerApproval.module.css";

export type McpElicitationField = {
  name: string;
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  enumNames?: string[];
  default?: string | number | boolean | string[];
  format?: string;
  secret?: boolean;
};

export type McpElicitationCardProps = {
  id: string;
  serverName: string;
  mode: string;
  message: string;
  fields: McpElicitationField[];
  url?: string;
  onRespond: (result: {
    action: "accept" | "decline" | "cancel";
    content?: Record<string, string | number | boolean | string[]>;
  }) => void;
};

/**
 * Composer-slot card for MCP elicitation/create (form or URL).
 */
export function McpElicitationCard({
  serverName,
  mode,
  message,
  fields,
  url,
  onRespond,
}: McpElicitationCardProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLElement | null>(null);
  const initial = useMemo(() => {
    const values: Record<string, string | boolean | number> = {};
    for (const f of fields) {
      if (f.default !== undefined && !Array.isArray(f.default)) values[f.name] = f.default as any;
      else if (f.type === "boolean") values[f.name] = false;
      else values[f.name] = "";
    }
    return values;
  }, [fields]);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(initial);
  }, [initial]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRespond({ action: "decline" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRespond]);

  const isUrl = mode === "url" || Boolean(url);

  const submit = () => {
    if (isUrl) {
      onRespond({ action: "accept", content: {} });
      return;
    }
    for (const f of fields) {
      if (!f.required) continue;
      const v = values[f.name];
      if (v === undefined || v === "" || v === null) {
        setError(t("runtime.mcp.required", { name: f.title || f.name }));
        return;
      }
    }
    setError(null);
    const content: Record<string, string | number | boolean | string[]> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "number" || f.type === "integer") content[f.name] = Number(v);
      else if (f.type === "boolean") content[f.name] = Boolean(v);
      else content[f.name] = String(v ?? "");
    }
    onRespond({ action: "accept", content });
  };

  return (
    <section
      ref={rootRef}
      className={styles.root}
      role="alertdialog"
      aria-label={t("runtime.mcp.request")}
      aria-modal="true"
      data-approval-kind="mcp_elicitation"
    >
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden>
          <Layers size={16} strokeWidth={1.9} />
        </span>
        <h3 className={styles.title}>MCP · {serverName || t("runtime.mcp.server")}</h3>
      </header>

      <p className={styles.reason}>{message}</p>

      {isUrl && url ? (
        <p className={styles.reason}>
          <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--accent, #7aa2ff)" }}>
            {url}
          </a>
        </p>
      ) : null}

      {!isUrl && fields.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginBottom: 4 }}>
          {fields.map((f) => (
            <label key={f.name} style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
              <span style={{ color: "var(--muted)" }}>
                {f.title || f.name}
                {f.required ? " *" : ""}
              </span>
              {f.description ? (
                <span style={{ color: "var(--muted)", fontSize: 11, opacity: 0.85 }}>{f.description}</span>
              ) : null}
              {f.type === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(values[f.name])}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                />
              ) : f.enum?.length ? (
                <select
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  style={{
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid color-mix(in srgb, var(--heading) 12%, transparent)",
                    background: "var(--elev-2, #1a1a1a)",
                    color: "var(--heading)",
                    padding: "0 10px",
                  }}
                >
                  <option value="">{t("runtime.mcp.select")}</option>
                  {f.enum.map((opt, i) => (
                    <option key={opt} value={opt}>
                      {f.enumNames?.[i] || opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.secret || f.format === "password" ? "password" : f.type === "number" || f.type === "integer" ? "number" : "text"}
                  value={String(values[f.name] ?? "")}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [f.name]: f.type === "number" || f.type === "integer" ? e.target.valueAsNumber || e.target.value : e.target.value,
                    }))
                  }
                  style={{
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid color-mix(in srgb, var(--heading) 12%, transparent)",
                    background: "var(--elev-2, #1a1a1a)",
                    color: "var(--heading)",
                    padding: "0 10px",
                  }}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      {error ? <p className={styles.reason} style={{ color: "var(--error, #ff6b66)" }}>{error}</p> : null}

      <footer className={styles.footer}>
        <button type="button" className={styles.decline} onClick={() => onRespond({ action: "decline" })}>
          {t("runtime.mcp.decline")}
        </button>
        <button type="button" className={styles.decline} onClick={() => onRespond({ action: "cancel" })}>
          {t("runtime.mcp.cancel")}
        </button>
        {isUrl && url ? (
          <button
            type="button"
            className={styles.allow}
            onClick={() => {
              try {
                window.open(url, "_blank", "noopener,noreferrer");
              } catch {
                /* ignore */
              }
            }}
            style={{ marginRight: 0 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ExternalLink size={13} /> {t("runtime.mcp.openLink")}
            </span>
          </button>
        ) : null}
        <div className={styles.allowGroup}>
          <button type="button" className={styles.allow} onClick={submit}>
            {isUrl ? t("runtime.mcp.completed") : t("runtime.mcp.send")}
          </button>
        </div>
      </footer>
    </section>
  );
}
