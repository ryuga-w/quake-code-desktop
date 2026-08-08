/**
 * Desktop notifications + sounds — QuakeCode parity
 * (`packages/app/src/context/notification.tsx` + settings sounds/notifications).
 *
 * Product rule: OS toast + completion sounds only when the app is in the
 * background (minimized / unfocused / hidden), unless the user opts out via
 * `onlyWhenUnfocused: false`.
 */
import { isSoundId, playSoundById, type SoundID } from "./sound";

export type NotificationType = "task" | "operation" | "error";

export interface NotificationConfig {
  /** Master switch for OS / browser notifications */
  enabled: boolean;
  types: Record<NotificationType, boolean>;
  /** @deprecated use sounds.*; kept for migration */
  sound?: boolean;
  /**
   * When true (default): no OS toast / completion sound while the window is
   * focused and visible. Toast only after minimize / blur / another app.
   */
  onlyWhenUnfocused: boolean;
  sounds: {
    agentEnabled: boolean;
    agent: SoundID | "none";
    errorsEnabled: boolean;
    errors: SoundID | "none";
    operationEnabled: boolean;
    operation: SoundID | "none";
  };
}

export type SendNotificationOptions = {
  /** Bypass background-only gate (settings "Test" buttons). */
  force?: boolean;
};

const STORAGE_KEY = "quake-web:notifications";
/** One-time flip: previous default was false; product default is now true. */
const BG_DEFAULT_MIGRATION_KEY = "quake-web:notif-bg-default-v1";
/** One-time: apply user-picked sound defaults (yup-03 / alert-08 / bip-bop-09). */
const SOUNDS_PICK_MIGRATION_KEY = "quake-web:notif-sounds-pick-v1";

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  types: {
    task: true,
    operation: true,
    error: true,
  },
  onlyWhenUnfocused: true,
  sounds: {
    // User-picked from sound-picker.html
    agentEnabled: true,
    agent: "yup-03",
    errorsEnabled: true,
    errors: "alert-08",
    operationEnabled: true,
    operation: "bip-bop-09",
  },
};

let config: NotificationConfig = structuredClone(DEFAULT_CONFIG);

function normalizeSoundId(value: unknown, fallback: SoundID | "none"): SoundID | "none" {
  if (value === "none") return "none";
  if (typeof value === "string" && isSoundId(value)) return value;
  return fallback;
}

function normalizeConfig(raw: Partial<NotificationConfig> | null | undefined): NotificationConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  if (!raw || typeof raw !== "object") return base;

  const types = {
    task: raw.types?.task ?? base.types.task,
    operation: raw.types?.operation ?? base.types.operation,
    error: raw.types?.error ?? base.types.error,
  };

  // Migrate legacy `{ sound: boolean }` → agent/errors sound flags.
  const legacySound = typeof raw.sound === "boolean" ? raw.sound : undefined;
  const soundsIn = raw.sounds || ({} as Partial<NotificationConfig["sounds"]>);

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    types,
    onlyWhenUnfocused:
      typeof raw.onlyWhenUnfocused === "boolean" ? raw.onlyWhenUnfocused : base.onlyWhenUnfocused,
    sounds: {
      agentEnabled:
        typeof soundsIn.agentEnabled === "boolean"
          ? soundsIn.agentEnabled
          : legacySound !== undefined
            ? legacySound
            : base.sounds.agentEnabled,
      agent: normalizeSoundId(soundsIn.agent, base.sounds.agent),
      errorsEnabled:
        typeof soundsIn.errorsEnabled === "boolean"
          ? soundsIn.errorsEnabled
          : legacySound !== undefined
            ? legacySound
            : base.sounds.errorsEnabled,
      errors: normalizeSoundId(soundsIn.errors, base.sounds.errors),
      operationEnabled:
        typeof soundsIn.operationEnabled === "boolean"
          ? soundsIn.operationEnabled
          : legacySound !== undefined
            ? legacySound
            : base.sounds.operationEnabled,
      operation: normalizeSoundId(soundsIn.operation, base.sounds.operation),
    },
  };
}

export function loadNotificationConfig(): NotificationConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let raw: Partial<NotificationConfig> | undefined;
    if (stored) {
      raw = JSON.parse(stored) as Partial<NotificationConfig>;
      let dirty = false;
      // One-time migration: old default was onlyWhenUnfocused:false (always toast).
      // Product rule is background-only; flip once so existing installs match.
      if (localStorage.getItem(BG_DEFAULT_MIGRATION_KEY) !== "1") {
        raw = { ...raw, onlyWhenUnfocused: true };
        localStorage.setItem(BG_DEFAULT_MIGRATION_KEY, "1");
        dirty = true;
      }
      // One-time: apply user sound picks from sound-picker (override prior defaults).
      if (localStorage.getItem(SOUNDS_PICK_MIGRATION_KEY) !== "1") {
        raw = {
          ...raw,
          sounds: {
            ...(raw.sounds || {}),
            agentEnabled: true,
            agent: "yup-03",
            errorsEnabled: true,
            errors: "alert-08",
            operationEnabled: true,
            operation: "bip-bop-09",
          },
        };
        localStorage.setItem(SOUNDS_PICK_MIGRATION_KEY, "1");
        dirty = true;
      }
      if (dirty) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(raw)));
      }
    }
    config = stored ? normalizeConfig(raw) : structuredClone(DEFAULT_CONFIG);
    if (!stored) {
      localStorage.setItem(BG_DEFAULT_MIGRATION_KEY, "1");
      localStorage.setItem(SOUNDS_PICK_MIGRATION_KEY, "1");
    }
  } catch {
    config = structuredClone(DEFAULT_CONFIG);
  }
  return getNotificationConfig();
}

export function saveNotificationConfig(next: NotificationConfig) {
  config = normalizeConfig(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  try {
    localStorage.setItem(BG_DEFAULT_MIGRATION_KEY, "1");
    localStorage.setItem(SOUNDS_PICK_MIGRATION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function getNotificationConfig(): NotificationConfig {
  return {
    ...config,
    types: { ...config.types },
    sounds: { ...config.sounds },
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** True when user is not actively looking at the app (DOM signals). */
function windowIsUnfocusedDom(): boolean {
  try {
    if (typeof document !== "undefined" && document.hidden) return true;
    if (typeof document !== "undefined" && !document.hasFocus()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Prefer Electron main-process focus (frameless window + WCO can confuse document.hasFocus).
 * Falls back to DOM visibility/focus.
 */
async function isAppInBackground(): Promise<boolean> {
  const desktop = (window as unknown as { quakeDesktop?: { isWindowInBackground?: () => Promise<boolean> } })
    .quakeDesktop;
  if (desktop?.isWindowInBackground) {
    try {
      return await desktop.isWindowInBackground();
    } catch {
      /* fall through */
    }
  }
  return windowIsUnfocusedDom();
}

function playForType(type: NotificationType) {
  const s = config.sounds;
  if (type === "error") {
    if (!s.errorsEnabled || s.errors === "none") return;
    void playSoundById(s.errors);
    return;
  }
  if (type === "operation") {
    if (!s.operationEnabled || s.operation === "none") return;
    void playSoundById(s.operation);
    return;
  }
  // task / agent complete
  if (!s.agentEnabled || s.agent === "none") return;
  void playSoundById(s.agent);
}

function showOsNotification(
  type: NotificationType,
  title: string,
  body?: string,
  onClick?: () => void,
  force?: boolean,
) {
  // Prefer Electron native notification when available (works without browser permission on desktop).
  const desktop = (window as unknown as {
    quakeDesktop?: { showNotification?: (title: string, body?: string, force?: boolean) => void };
  }).quakeDesktop;
  if (desktop?.showNotification) {
    try {
      desktop.showNotification(title, body, force);
      return;
    } catch {
      /* fall through */
    }
  }

  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const notification = new Notification(title, {
      body,
      icon: "/app-icon.png",
      badge: "/quake-code-q.png",
      tag: `quake-code-${type}`,
    });
    if (onClick) {
      notification.onclick = () => {
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        onClick();
        notification.close();
      };
    }
    window.setTimeout(() => {
      try {
        notification.close();
      } catch {
        /* ignore */
      }
    }, 8000);
  } catch {
    /* ignore */
  }
}

export function sendNotification(
  type: NotificationType,
  title: string,
  body?: string,
  onClick?: () => void,
  options?: SendNotificationOptions,
) {
  // Always respect type toggles for sound + OS toast.
  if (!config.types[type]) return;

  const force = options?.force === true;

  const deliver = (inBackground: boolean) => {
    // Background-only gate: while the user is looking at the app, stay silent.
    if (!force && config.onlyWhenUnfocused && !inBackground) {
      return;
    }

    // Sound + OS toast only after gate (settings Test uses force).
    playForType(type);

    if (!config.enabled) return;
    showOsNotification(type, title, body, onClick, force);
  };

  if (force) {
    deliver(true);
    return;
  }

  void isAppInBackground().then(deliver);
}

export function notifyTaskComplete(taskName: string, options?: SendNotificationOptions & { title?: string }) {
  sendNotification("task", options?.title ?? "Yanıt hazır", taskName, undefined, options);
}

export function notifyOperationComplete(operation: string, options?: SendNotificationOptions) {
  sendNotification("operation", "İşlem tamamlandı", operation, undefined, options);
}

export function notifyError(message: string, options?: SendNotificationOptions) {
  sendNotification("error", "Hata", message, undefined, options);
}

/** Preview sound from settings without sending an OS notification. */
export function previewNotificationSound(which: "agent" | "errors" | "operation") {
  const s = config.sounds;
  if (which === "agent") void playSoundById(s.agent === "none" ? undefined : s.agent);
  else if (which === "errors") void playSoundById(s.errors === "none" ? undefined : s.errors);
  else void playSoundById(s.operation === "none" ? undefined : s.operation);
}
