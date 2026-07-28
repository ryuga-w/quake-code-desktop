/**
 * S-TRUST.3 — first-run trust / access onboarding (once per app install profile).
 * Plain-language Turkish contract: workspace boundary, approval modes, worktree
 * isolation, OS sandbox honesty, optional network proxy.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { FolderLock, GitBranch, Info, Network, Shield, ShieldAlert } from "lucide-react";
import { useI18n } from "../../i18n";
import styles from "./TrustOnboardingModal.module.css";

export const TRUST_ONBOARDING_TITLE = "Güven ve erişim";
export const TRUST_ONBOARDING_PRIMARY = "Anladım";
export const TRUST_ONBOARDING_SECONDARY = "İzinler'e git";

/** Stable copy anchors for source contracts / i18n checks. */
export const TRUST_ONBOARDING_COPY = {
  title: TRUST_ONBOARDING_TITLE,
  intro:
    "Quake güçlü araçlara erişir (terminal, dosya, tarayıcı). Bu özet, varsayılan güven modelini açıklar — pazarlama değil, ürün sözleşmesidir.",
  workspaceTitle: "Çalışma alanı sınırı",
  workspaceBody:
    "Dosya okuma ve yazma seçili proje klasörüyle sınırlıdır. Workspace dışına çıkmak veya riskli işlemler genelde onay ister.",
  accessTitle: "Default ve Full Access",
  accessBody:
    "Default: workspace içinde çalış, riskli komutlarda sor. Full Access: onay sormadan komut çalıştırabilir (dikkatli kullanın). Read Only yalnız okuma eğilimlidir. Bunlar onay rejimidir; işletim sistemi izolasyonu değildir.",
  worktreeTitle: "Paralel ajanlar (worktree)",
  worktreeBody:
    "Birden fazla ajan aynı anda çalışırken varsayılan olarak git worktree ile ayrı kopyalarda düzenler; ana klasörü gereksiz karıştırmaz.",
  osSandboxTitle: "OS sandbox = Windows Sandbox değil",
  osSandboxBody:
    "Bugünkü varsayılan yol politika ve yardımcı (helper) tabanlıdır. Bu, Windows Sandbox değildir. Yardımcı yokken deneysel bayrak fail-closed çalışır.",
  proxyTitle: "İsteğe bağlı ağ proxy",
  proxyBody:
    "İşbirlikçi HTTP proxy yalnızca HTTP_PROXY / HTTPS_PROXY’ye uyan ajan araçlarını loopback’e yönlendirir. Şeffaf OS duvarı veya MITM değildir; varsayılan kapalı veya ayarlardan yönetilir.",
  primary: TRUST_ONBOARDING_PRIMARY,
  secondary: TRUST_ONBOARDING_SECONDARY,
} as const;

export type TrustOnboardingModalProps = {
  open: boolean;
  onDismiss: () => void;
  onOpenPermissions: () => void;
};

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.offsetWidth > 0 && el.offsetHeight > 0;
  });
}

export function TrustOnboardingModal({ open, onDismiss, onOpenPermissions }: TrustOnboardingModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  const handlePermissions = useCallback(() => {
    onDismiss();
    onOpenPermissions();
  }, [onDismiss, onOpenPermissions]);

  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const timer = window.setTimeout(() => {
      const primary = el.querySelector<HTMLElement>("[data-trust-primary]");
      (primary || getFocusable(el)[0] || el).focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(el);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) {
        window.setTimeout(() => previous.focus({ preventScroll: true }), 0);
      }
    };
  }, [open, handleDismiss]);

  if (!open) return null;

  const items = [
    {
      icon: <FolderLock size={16} aria-hidden />,
      title: t("runtime.trust.workspaceTitle"),
      body: t("runtime.trust.workspaceBody"),
    },
    {
      icon: <Shield size={16} aria-hidden />,
      title: t("runtime.trust.accessTitle"),
      body: t("runtime.trust.accessBody"),
    },
    {
      icon: <GitBranch size={16} aria-hidden />,
      title: t("runtime.trust.worktreeTitle"),
      body: t("runtime.trust.worktreeBody"),
    },
    {
      icon: <ShieldAlert size={16} aria-hidden />,
      title: t("runtime.trust.sandboxTitle"),
      body: t("runtime.trust.sandboxBody"),
    },
    {
      icon: <Network size={16} aria-hidden />,
      title: t("runtime.trust.proxyTitle"),
      body: t("runtime.trust.proxyBody"),
    },
  ] as const;

  return (
    <div className={styles.backdrop} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-onboarding-title"
        aria-describedby="trust-onboarding-intro"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            <Info size={22} />
          </span>
          <h2 id="trust-onboarding-title">{t("runtime.trust.title")}</h2>
        </div>
        <p id="trust-onboarding-intro" className={styles.intro}>
          {t("runtime.trust.intro")}
        </p>
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.title} className={styles.item}>
              <span className={styles.itemIcon}>{item.icon}</span>
              <div>
                <p className={styles.itemTitle}>{item.title}</p>
                <p className={styles.itemBody}>{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={handlePermissions}>
            {t("runtime.trust.secondary")}
          </button>
          <button
            type="button"
            className={styles.primary}
            data-trust-primary
            onClick={handleDismiss}
          >
            {t("runtime.trust.primary")}
          </button>
        </div>
      </div>
    </div>
  );
}
