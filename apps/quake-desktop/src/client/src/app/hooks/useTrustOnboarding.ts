import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import {
  loadTrustOnboardingSeen,
  saveTrustOnboardingSeen,
} from "../../components/settings/settings-storage";

/** Owns the one-time trust onboarding lifecycle and persistence. */
export function useTrustOnboarding(bootSplash: boolean) {
  const [trustOnboardingOpen, setTrustOnboardingOpen] = useState(false);

  useEffect(() => {
    if (bootSplash || loadTrustOnboardingSeen(false)) return;
    let cancelled = false;
    void apiGet<{ settings?: { trustOnboardingSeen?: boolean } }>("/api/web-settings")
      .then((result) => {
        if (cancelled || loadTrustOnboardingSeen(false)) return;
        if (result?.settings?.trustOnboardingSeen === true) {
          saveTrustOnboardingSeen(true);
          return;
        }
        setTrustOnboardingOpen(true);
      })
      .catch(() => {
        // Settings unavailable must not block the app — still offer onboarding once.
        if (!cancelled && !loadTrustOnboardingSeen(false)) setTrustOnboardingOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bootSplash]);

  const dismissTrustOnboarding = useCallback(() => {
    setTrustOnboardingOpen(false);
    saveTrustOnboardingSeen(true);
    void apiPost("/api/web-settings", { trustOnboardingSeen: true }).catch(() => {});
  }, []);

  return {
    trustOnboardingOpen,
    dismissTrustOnboarding,
  };
}

export type UseTrustOnboardingReturn = ReturnType<typeof useTrustOnboarding>;
