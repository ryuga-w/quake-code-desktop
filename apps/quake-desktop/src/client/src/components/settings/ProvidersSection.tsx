import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import type { WebProviderListItem, WebModelSummary } from "../../../../shared/protocol";
import { useAppStore } from "../../state/app-store";
import { useConfirmAction } from "../common/ConfirmContext";
import styles from "./ProvidersSection.module.css";

type StatusFilter = "all" | "connected" | "disconnected" | "expired";
type GroupFilter = "all" | "subscription" | "api_key" | "cloud";

function isConnected(status: string): boolean {
  return status === "connected_oauth" || status === "connected_api_key" || status === "connected_env";
}

function statusLabel(status: string): string {
  switch (status) {
    case "connected_oauth":
      return "OAuth bağlı";
    case "connected_api_key":
      return "API key";
    case "connected_env":
      return "Env";
    case "expired":
      return "Süresi dolmuş";
    case "error":
      return "Hata";
    default:
      return "Bağlı değil";
  }
}

function groupLabel(group: string): string {
  if (group === "subscription") return "Abonelik (OAuth)";
  if (group === "cloud") return "Bulut / kurumsal";
  return "API anahtarı";
}

function kindBadge(p: WebProviderListItem): string {
  if (p.group === "subscription" || p.supportsOAuth) return "OAuth";
  if (p.group === "cloud" || p.kind === "cloud_env") return "Bulut";
  return "API key";
}

const ProviderLogo = memo(function ProviderLogo({ id, name, logoUrl }: { id: string; name: string; logoUrl: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    const letter = (name || id).slice(0, 1).toUpperCase();
    return (
      <div className={styles.logoFallback} aria-hidden="true">
        {letter}
      </div>
    );
  }
  return (
    <img
      className={styles.logo}
      src={logoUrl}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
});

export const ProvidersSection = memo(function ProvidersSection({
  onSetModel,
  onSetDefaultModel,
}: {
  onSetModel?: (value: string) => void;
  onSetDefaultModel?: (value: string) => void;
}) {
  const [providers, setProviders] = useState<WebProviderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [connectedFirst, setConnectedFirst] = useState(true);
  const [selected, setSelected] = useState<WebProviderListItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [detailModels, setDetailModels] = useState<WebModelSummary[]>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [inlineHint, setInlineHint] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<{ id: string; ok: boolean; message: string; at: number } | null>(null);
  const [oauthWaitId, setOauthWaitId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const showStatusNotice = useAppStore((s) => s.showStatusNotice);
  const { confirm } = useConfirmAction();

  // Debounce provider search so typing doesn't re-filter/re-render every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 140);
    return () => window.clearTimeout(t);
  }, [query]);

  /** Local hint in the providers panel (not global toast). */
  const flash = (msg: string) => {
    setInlineHint(msg);
    window.setTimeout(() => setInlineHint(null), 3600);
  };

  const announceProvider = (
    p: WebProviderListItem,
    kind: "provider_connected" | "provider_disconnected" | "provider_pending" | "provider_error",
    subtitle?: string,
  ) => {
    showStatusNotice({
      kind,
      title: p.name,
      subtitle:
        subtitle ||
        (kind === "provider_connected"
          ? "Sağlayıcı hesabı hazır"
          : kind === "provider_disconnected"
            ? "Oturum kapatıldı"
            : kind === "provider_pending"
              ? "Tarayıcıda oturumu tamamlayın"
              : undefined),
      logoUrl: p.logoUrl,
      providerId: p.id,
    });
  };

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ providers: WebProviderListItem[] }>("/api/providers");
      const list = data.providers || [];
      setProviders(list);
      const selId = selectedIdRef.current;
      if (selId) {
        const next = list.find((p) => p.id === selId) || null;
        setSelected(next);
      }
      return list;
    } catch (e: any) {
      setError(e?.message || "Provider listesi alınamadı");
      return null;
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    selectedIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  // Escape closes detail modal
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // After OAuth, poll until connected or timeout
  useEffect(() => {
    if (!oauthWaitId) return;
    let ticks = 0;
    const maxTicks = 40; // ~2 min at 3s
    pollRef.current = window.setInterval(() => {
      ticks += 1;
      void (async () => {
        const list = await refresh({ quiet: true });
        const p = list?.find((x) => x.id === oauthWaitId);
        if (p && isConnected(p.status)) {
          announceProvider(p, "provider_connected", "OAuth bağlantısı tamamlandı");
          setOauthWaitId(null);
          if (selectedIdRef.current === p.id) setSelected(p);
        } else if (ticks >= maxTicks) {
          setOauthWaitId(null);
          flash("OAuth henüz tamamlanmadı — Yenile’ye basabilirsiniz.");
        }
      })();
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [oauthWaitId, refresh]);

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    let list = providers.filter((p) => {
      if (groupFilter !== "all" && p.group !== groupFilter) return false;
      if (statusFilter === "connected" && !isConnected(p.status)) return false;
      if (statusFilter === "disconnected" && (isConnected(p.status) || p.status === "expired")) return false;
      if (statusFilter === "expired" && p.status !== "expired") return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.accountHint || "").toLowerCase().includes(q) ||
        (p.envVar || "").toLowerCase().includes(q)
      );
    });
    if (connectedFirst) {
      list = [...list].sort((a, b) => {
        const ac = isConnected(a.status) || a.status === "expired" ? 0 : 1;
        const bc = isConnected(b.status) || b.status === "expired" ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.name.localeCompare(b.name, "tr");
      });
    }
    return list;
  }, [providers, debouncedQuery, statusFilter, groupFilter, connectedFirst]);

  const groups = useMemo(() => {
    const order = ["subscription", "api_key", "cloud"] as const;
    return order
      .map((g) => ({
        id: g,
        label: groupLabel(g),
        items: filtered.filter((p) => p.group === g),
      }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const filteredModels = useMemo(() => {
    // Never list models for providers without auth (auth yok rows).
    const usable = detailModels.filter((m) => m.configured !== false);
    const q = modelQuery.trim().toLowerCase();
    if (!q) return usable;
    return usable.filter(
      (m) => m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q),
    );
  }, [detailModels, modelQuery]);

  const openDetail = async (p: WebProviderListItem) => {
    setSelected(p);
    selectedIdRef.current = p.id;
    setApiKey("");
    setAccountLabel("");
    setShowKey(false);
    setDetailModels([]);
    setModelQuery("");
    try {
      const data = await apiGet<{ models: WebModelSummary[] }>(
        `/api/providers/${encodeURIComponent(p.id)}/models`,
      );
      setDetailModels(data.models || []);
    } catch {
      setDetailModels([]);
    }
  };

  const connectOAuth = async (p: WebProviderListItem) => {
    setBusyId(p.id);
    try {
      const res = await apiPost<{
        success?: boolean;
        authUrl?: string;
        instructions?: string;
        connected?: boolean;
        pending?: boolean;
        error?: string;
      }>(`/api/providers/${encodeURIComponent(p.id)}/login`, {});
      if (res.authUrl) {
        window.open(res.authUrl, "_blank", "noopener,noreferrer");
        // GitHub Copilot device flow: instructions often contain "Enter code: XXXX-XXXX"
        const codeMatch = String(res.instructions || "").match(/code:\s*([A-Z0-9-]+)/i);
        const subtitle = codeMatch
          ? `Tarayıcıda kodu girin: ${codeMatch[1]} — onaylayınca otomatik bağlanır`
          : res.instructions || "Tarayıcıda oturum açın";
        announceProvider(p, "provider_pending", subtitle);
        flash(subtitle);
        setOauthWaitId(p.id);
      } else if (res.connected) {
        announceProvider(p, "provider_connected", "OAuth bağlantısı tamamlandı");
        setOauthWaitId(null);
      } else if (res.error) {
        announceProvider(p, "provider_error", res.error);
      }
      await refresh({ quiet: true });
    } catch (e: any) {
      announceProvider(p, "provider_error", e?.message || "OAuth başarısız");
    } finally {
      setBusyId(null);
    }
  };

  const saveApiKey = async (p: WebProviderListItem) => {
    if (!apiKey.trim()) {
      flash("API key girin");
      return;
    }
    setBusyId(p.id);
    try {
      await apiPost(`/api/providers/${encodeURIComponent(p.id)}/api-key`, {
        apiKey: apiKey.trim(),
        label: accountLabel.trim() || undefined,
        makeActive: true,
      });
      setApiKey("");
      setAccountLabel("");
      setShowKey(false);
      const count = (p.accountCount || 0) + 1;
      announceProvider(
        p,
        "provider_connected",
        p.accountCount && p.accountCount > 0
          ? `Yeni hesap eklendi (havuz: ~${count})`
          : "API anahtarı kaydedildi",
      );
      await refresh({ quiet: true });
    } catch (e: any) {
      announceProvider(p, "provider_error", e?.message || "Kayıt başarısız");
    } finally {
      setBusyId(null);
    }
  };

  const logout = async (p: WebProviderListItem) => {
    const accepted = await confirm({
      title: `${p.name} bağlantısını kaldır`,
      message: `${p.name} için kayıtlı tüm hesaplar bu cihazdan kaldırılacak. Sağlayıcıyı yeniden kullanmak için tekrar bağlanmanız gerekir.`,
      variant: "danger",
      confirmLabel: "Tüm hesapları kaldır",
    });
    if (!accepted) return;
    setBusyId(p.id);
    try {
      await apiPost(`/api/providers/${encodeURIComponent(p.id)}/logout`, { all: true });
      announceProvider(p, "provider_disconnected", "Tüm hesaplar kaldırıldı");
      if (oauthWaitId === p.id) setOauthWaitId(null);
      await refresh({ quiet: true });
    } catch (e: any) {
      announceProvider(p, "provider_error", e?.message || "Çıkış başarısız");
    } finally {
      setBusyId(null);
    }
  };

  const setActiveAccount = async (p: WebProviderListItem, accountId: string) => {
    setBusyId(p.id);
    try {
      await apiPost(`/api/providers/${encodeURIComponent(p.id)}/accounts/active`, { accountId });
      flash("Aktif hesap değiştirildi");
      await refresh({ quiet: true });
    } catch (e: any) {
      flash(e?.message || "Aktif hesap seçilemedi");
    } finally {
      setBusyId(null);
    }
  };

  const removeOneAccount = async (p: WebProviderListItem, accountId: string, label: string) => {
    const accepted = await confirm({
      title: "Hesabı kaldır",
      message: `“${label}” hesabı ${p.name} bağlantısından kaldırılacak.`,
      variant: "danger",
      confirmLabel: "Hesabı kaldır",
    });
    if (!accepted) return;
    setBusyId(p.id);
    try {
      await apiPost(`/api/providers/${encodeURIComponent(p.id)}/logout`, { accountId });
      flash("Hesap kaldırıldı");
      await refresh({ quiet: true });
    } catch (e: any) {
      flash(e?.message || "Hesap kaldırılamadı");
    } finally {
      setBusyId(null);
    }
  };

  const toggleRotation = async (p: WebProviderListItem, enabled: boolean) => {
    setBusyId(p.id);
    try {
      await apiPost(`/api/providers/${encodeURIComponent(p.id)}/accounts/rotation`, { enabled });
      flash(enabled ? "Otomatik rotasyon açık" : "Otomatik rotasyon kapalı");
      await refresh({ quiet: true });
    } catch (e: any) {
      flash(e?.message || "Rotasyon ayarı güncellenemedi");
    } finally {
      setBusyId(null);
    }
  };

  const testConnection = async (p: WebProviderListItem) => {
    setBusyId(p.id);
    try {
      const res = await apiPost<{ success: boolean; message?: string; error?: string }>(
        `/api/providers/${encodeURIComponent(p.id)}/test`,
        {},
      );
      const message = res.message || res.error || (res.success ? "Bağlantı OK" : "Bağlantı yok");
      setLastTest({ id: p.id, ok: Boolean(res.success), message, at: Date.now() });
      flash(message);
    } catch (e: any) {
      const message = e?.message || "Test başarısız";
      setLastTest({ id: p.id, ok: false, message, at: Date.now() });
      flash(message);
    } finally {
      setBusyId(null);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${label} kopyalandı`);
    } catch {
      flash("Kopyalanamadı");
    }
  };

  const { connectedCount, expiredCount } = useMemo(() => {
    let connected = 0;
    let expired = 0;
    for (const p of providers) {
      if (isConnected(p.status)) connected += 1;
      else if (p.status === "expired") expired += 1;
    }
    return { connectedCount: connected, expiredCount: expired };
  }, [providers]);

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Provider, id veya hesap ara…"
          aria-label="Provider ara"
        />
        <div className={styles.filters} role="group" aria-label="Durum filtresi">
          {(
            [
              ["all", "Tümü"],
              ["connected", "Bağlı"],
              ["disconnected", "Bağlı değil"],
              ["expired", "Süresi dolmuş"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.chip} ${statusFilter === id ? styles.chipActive : ""}`}
              onClick={() => setStatusFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading} aria-label="Provider listesini yenile">
          <RefreshCw size={14} aria-hidden="true" className={loading ? styles.spinning : undefined} />
          Yenile
        </button>
      </div>

      <div className={styles.toolbarSecondary}>
        <div className={styles.filters} role="group" aria-label="Grup filtresi">
          {(
            [
              ["all", "Tüm gruplar"],
              ["subscription", "OAuth"],
              ["api_key", "API key"],
              ["cloud", "Bulut"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.chip} ${groupFilter === id ? styles.chipActive : ""}`}
              onClick={() => setGroupFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={connectedFirst}
            onChange={(e) => setConnectedFirst(e.target.checked)}
          />
          Bağlılar önce
        </label>
      </div>

      <div className={styles.summary}>
        <span>
          <b>{providers.length}</b> sağlayıcı
        </span>
        <span className={styles.dot}>·</span>
        <span>
          <b>{connectedCount}</b> bağlı
        </span>
        {expiredCount > 0 && (
          <>
            <span className={styles.dot}>·</span>
            <span className={styles.warnText}>
              <b>{expiredCount}</b> süresi dolmuş
            </span>
          </>
        )}
        {oauthWaitId && (
          <>
            <span className={styles.dot}>·</span>
            <span className={styles.pendingText}>OAuth bekleniyor…</span>
          </>
        )}
        {inlineHint && <span className={styles.toast}>{inlineHint}</span>}
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button type="button" className={styles.inlineRetry} onClick={() => void refresh()}>
            Tekrar dene
          </button>
        </div>
      )}
      {loading && providers.length === 0 && <div className={styles.muted}>Yükleniyor…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.empty}>
          <p>Filtreye uyan provider yok.</p>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setGroupFilter("all");
            }}
          >
            Filtreleri temizle
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id} className={styles.group}>
          <h3 className={styles.groupTitle}>
            {group.label}
            <span className={styles.groupCount}>{group.items.length}</span>
          </h3>
          <div className={styles.grid}>
            {group.items.map((p) => (
              <article
                key={p.id}
                className={`${styles.card} ${selected?.id === p.id ? styles.cardSelected : ""} ${
                  oauthWaitId === p.id ? styles.cardPending : ""
                }`}
              >
                <button type="button" className={styles.cardMain} onClick={() => void openDetail(p)}>
                  <ProviderLogo id={p.id} name={p.name} logoUrl={p.logoUrl} />
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitleRow}>
                      <div className={styles.cardTitle}>{p.name}</div>
                      <span className={styles.kindBadge}>{kindBadge(p)}</span>
                    </div>
                    <div className={styles.cardMeta}>
                      <span
                        className={`${styles.pill} ${
                          isConnected(p.status)
                            ? styles.pillOk
                            : p.status === "expired"
                              ? styles.pillWarn
                              : styles.pillMuted
                        }`}
                      >
                        {statusLabel(p.status)}
                      </span>
                      {p.accountHint && <span className={styles.hint} title={p.accountHint}>{p.accountHint}</span>}
                      {typeof p.accountCount === "number" && p.accountCount > 1 && (
                        <span className={styles.hint}>{p.accountCount} hesap</span>
                      )}
                      {p.rotationEnabled && (p.accountCount || 0) > 1 && (
                        <span className={styles.hint}>rotasyon</span>
                      )}
                      {typeof p.modelCount === "number" && p.modelCount > 0 && (
                        <span className={styles.hint}>{p.modelCount} model</span>
                      )}
                    </div>
                  </div>
                </button>
                <div className={styles.cardActions}>
                  {p.supportsOAuth && !isConnected(p.status) && (
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={busyId === p.id}
                      onClick={() => void connectOAuth(p)}
                    >
                      {oauthWaitId === p.id ? "Bekleniyor…" : "Bağla"}
                    </button>
                  )}
                  {(p.supportsApiKey || p.kind === "api_key" || p.kind === "cloud_env") &&
                    !isConnected(p.status) && (
                      <button type="button" className={styles.secondaryBtn} onClick={() => void openDetail(p)}>
                        API key
                      </button>
                    )}
                  {isConnected(p.status) && (
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      disabled={busyId === p.id}
                      onClick={() => void testConnection(p)}
                    >
                      Test
                    </button>
                  )}
                  {isConnected(p.status) && (p.supportsApiKey || p.supportsOAuth || p.kind === "api_key") && (
                    <button type="button" className={styles.secondaryBtn} onClick={() => void openDetail(p)}>
                      Hesaplar
                    </button>
                  )}
                  {isConnected(p.status) && p.source !== "env" && (
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      disabled={busyId === p.id}
                      onClick={() => void logout(p)}
                    >
                      Çıkış
                    </button>
                  )}
                  {p.status === "expired" && p.supportsOAuth && (
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={busyId === p.id}
                      onClick={() => void connectOAuth(p)}
                    >
                      Yeniden bağla
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {selected && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setSelected(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={selected.name}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHead}>
              <ProviderLogo id={selected.id} name={selected.name} logoUrl={selected.logoUrl} />
              <div>
                <h3>{selected.name}</h3>
                <div className={styles.idRow}>
                  <code className={styles.idCode}>{selected.id}</code>
                  <button
                    type="button"
                    className={styles.tinyBtn}
                    onClick={() => void copyText(selected.id, "Provider id")}
                  >
                    Kopyala
                  </button>
                </div>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setSelected(null)} aria-label="Sağlayıcı ayrıntılarını kapat">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.modalSection}>
              <div className={styles.row}>
                <span>Durum</span>
                <strong>{statusLabel(selected.status)}</strong>
              </div>
              <div className={styles.row}>
                <span>Tür</span>
                <strong>{kindBadge(selected)}</strong>
              </div>
              {selected.source && (
                <div className={styles.row}>
                  <span>Kaynak</span>
                  <strong>
                    {selected.source === "auth_file"
                      ? "auth.json"
                      : selected.source === "env"
                        ? "Ortam değişkeni"
                        : "—"}
                  </strong>
                </div>
              )}
              {selected.accountHint && (
                <div className={styles.row}>
                  <span>Hesap</span>
                  <strong>{selected.accountHint}</strong>
                </div>
              )}
              {selected.expiresAt && (
                <div className={styles.row}>
                  <span>Token bitiş</span>
                  <strong>{new Date(selected.expiresAt).toLocaleString()}</strong>
                </div>
              )}
              {selected.envVar && (
                <div className={styles.row}>
                  <span>Env</span>
                  <span className={styles.envCopy}>
                    <code>{selected.envVar}</code>
                    <button
                      type="button"
                      className={styles.tinyBtn}
                      onClick={() => void copyText(selected.envVar!, "Env adı")}
                    >
                      Kopyala
                    </button>
                  </span>
                </div>
              )}
              {selected.docsHint && <p className={styles.docs}>{selected.docsHint}</p>}
              {lastTest && lastTest.id === selected.id && (
                <div className={`${styles.testResult} ${lastTest.ok ? styles.testOk : styles.testFail}`}>
                  Son test: {lastTest.message}
                  <span className={styles.testTime}>{new Date(lastTest.at).toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            {/* Multi-account pool */}
            {(selected.accounts && selected.accounts.length > 0) || isConnected(selected.status) ? (
              <div className={styles.modalSection}>
                <div className={styles.accountsHead}>
                  <h4 className={styles.modelsTitle}>
                    Hesaplar ({selected.accounts?.length || selected.accountCount || 0})
                  </h4>
                  <label className={styles.rotationToggle}>
                    <input
                      type="checkbox"
                      checked={selected.rotationEnabled !== false}
                      disabled={busyId === selected.id || (selected.accounts?.length || 0) < 2}
                      onChange={(e) => void toggleRotation(selected, e.target.checked)}
                    />
                    Otomatik rotasyon
                  </label>
                </div>
                <p className={styles.muted}>
                  Kota veya rate-limit dolunca sıradaki müsait hesaba geçilir; sohbet kesilmez.
                </p>
                <ul className={styles.accountList}>
                  {(selected.accounts || []).map((acc) => (
                    <li
                      key={acc.accountId}
                      className={`${styles.accountRow} ${acc.isActive ? styles.accountActive : ""}`}
                    >
                      <div className={styles.accountMain}>
                        <span className={styles.accountLabel}>{acc.label}</span>
                        <span className={styles.accountMeta}>
                          {acc.kind}
                          {acc.isActive ? " · aktif" : ""}
                          {acc.exhaustedUntil ? ` · kota ${new Date(acc.exhaustedUntil).toLocaleString()}` : ""}
                        </span>
                      </div>
                      <span className={styles.accountBtns}>
                        {!acc.isActive && (
                          <button
                            type="button"
                            className={styles.tinyBtn}
                            disabled={busyId === selected.id}
                            onClick={() => void setActiveAccount(selected, acc.accountId)}
                          >
                            Aktif yap
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.tinyBtn}
                          disabled={busyId === selected.id}
                          onClick={() => void removeOneAccount(selected, acc.accountId, acc.label)}
                        >
                          Kaldır
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                {selected.supportsOAuth && (
                  <div className={styles.addAccountRow}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={busyId === selected.id}
                      onClick={() => void connectOAuth(selected)}
                    >
                      + Hesap ekle (OAuth)
                    </button>
                    <p className={styles.muted}>
                      Yeni Google / OAuth oturumu açılır; mevcut hesaplar silinmez, havuza eklenir.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {(selected.supportsApiKey || selected.kind === "api_key" || selected.kind === "cloud_env") && (
              <div className={styles.modalSection}>
                <label className={styles.label} htmlFor="provider-api-key">
                  {isConnected(selected.status) ? "Başka API key ekle" : "API key kaydet"}
                </label>
                <input
                  className={styles.input}
                  type="text"
                  autoComplete="off"
                  placeholder="Etiket (isteğe bağlı) — örn. iş, yedek"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                />
                <div className={styles.keyRow}>
                  <input
                    id="provider-api-key"
                    className={styles.input}
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-… veya ilgili anahtar"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveApiKey(selected);
                    }}
                  />
                  <button type="button" className={styles.secondaryBtn} onClick={() => setShowKey((v) => !v)}>
                    {showKey ? "Gizle" : "Göster"}
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busyId === selected.id || !apiKey.trim()}
                  onClick={() => void saveApiKey(selected)}
                >
                  {isConnected(selected.status) ? "Hesaba ekle" : "Kaydet"}
                </button>
                <p className={styles.muted}>
                  Anahtar diske yazılır ve havuza eklenir; bu ekranda bir daha okunmaz. Birden fazla key ile otomatik
                  rotasyon kullanılır.
                </p>
              </div>
            )}

            <div className={styles.modalActions}>
              {selected.supportsOAuth && !isConnected(selected.status) && selected.status !== "expired" && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busyId === selected.id}
                  onClick={() => void connectOAuth(selected)}
                >
                  OAuth ile bağla
                </button>
              )}
              {selected.supportsOAuth && selected.status === "expired" && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busyId === selected.id}
                  onClick={() => void connectOAuth(selected)}
                >
                  OAuth yenile
                </button>
              )}
              {selected.supportsOAuth && isConnected(selected.status) && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busyId === selected.id}
                  onClick={() => void connectOAuth(selected)}
                >
                  + Hesap ekle
                </button>
              )}
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={busyId === selected.id}
                onClick={() => void testConnection(selected)}
              >
                Bağlantıyı test et
              </button>
              {isConnected(selected.status) && selected.source !== "env" && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  disabled={busyId === selected.id}
                  onClick={() => void logout(selected)}
                >
                  Bağlantıyı kes
                </button>
              )}
            </div>

            {detailModels.length > 0 && (
              <div className={styles.modalSection}>
                <div className={styles.modelsHead}>
                  <h4 className={styles.modelsTitle}>
                    Modeller ({filteredModels.length}
                    {filteredModels.length !== detailModels.length ? ` / ${detailModels.length}` : ""})
                  </h4>
                  <input
                    className={styles.modelSearch}
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Model filtrele…"
                    aria-label="Model filtrele"
                  />
                </div>
                <ul className={styles.modelList}>
                  {filteredModels.slice(0, 60).map((m) => {
                    const value = `${m.provider}/${m.id}`;
                    return (
                      <li key={value} className={styles.modelRow}>
                        <span className={m.configured ? styles.modelOk : styles.modelMuted} title={value}>
                          {m.id}
                          {m.configured ? "" : " · auth yok"}
                        </span>
                        <span className={styles.modelBtns}>
                          {onSetModel && (
                            <button
                              type="button"
                              className={styles.tinyBtn}
                              onClick={() => {
                                onSetModel(value);
                                flash(`Model seçildi: ${m.id}`);
                              }}
                            >
                              Seç
                            </button>
                          )}
                          {onSetDefaultModel && m.configured && (
                            <button
                              type="button"
                              className={styles.tinyBtn}
                              onClick={() => {
                                onSetDefaultModel(value);
                                flash(`Varsayılan: ${m.id}`);
                              }}
                            >
                              Varsayılan
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {filteredModels.length === 0 && <p className={styles.muted}>Filtreye uyan model yok.</p>}
              </div>
            )}

            {detailModels.length === 0 && isConnected(selected.status) && (
              <p className={styles.muted}>
                Bu provider için model listesi boş — yine de sohbette kullanılabilir (özel deployment vb.).
              </p>
            )}

            <p className={styles.footerNote}>
              Kimlik bilgileri <code>~/.quake-code/agent/auth.json</code> (veya Grok ajan dizini) içinde saklanır; CLI ile
              paylaşılır. Ham API key bu arayüzde bir daha gösterilmez.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

export default ProvidersSection;
