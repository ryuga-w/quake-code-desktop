/**
 * Sound library ported from QuakeCode (`packages/app/src/utils/sound.ts` + `ui/src/assets/audio`).
 * Assets live in `/audio/*.mp3` (public).
 */

export const SOUND_OPTIONS = [
  { id: "alert-01", label: "Alert 01" },
  { id: "alert-02", label: "Alert 02" },
  { id: "alert-03", label: "Alert 03" },
  { id: "alert-04", label: "Alert 04" },
  { id: "alert-05", label: "Alert 05" },
  { id: "alert-06", label: "Alert 06" },
  { id: "alert-07", label: "Alert 07" },
  { id: "alert-08", label: "Alert 08" },
  { id: "alert-09", label: "Alert 09" },
  { id: "alert-10", label: "Alert 10" },
  { id: "bip-bop-01", label: "Bip Bop 01" },
  { id: "bip-bop-02", label: "Bip Bop 02" },
  { id: "bip-bop-03", label: "Bip Bop 03" },
  { id: "bip-bop-04", label: "Bip Bop 04" },
  { id: "bip-bop-05", label: "Bip Bop 05" },
  { id: "bip-bop-06", label: "Bip Bop 06" },
  { id: "bip-bop-07", label: "Bip Bop 07" },
  { id: "bip-bop-08", label: "Bip Bop 08" },
  { id: "bip-bop-09", label: "Bip Bop 09" },
  { id: "bip-bop-10", label: "Bip Bop 10" },
  { id: "staplebops-01", label: "Staplebops 01" },
  { id: "staplebops-02", label: "Staplebops 02" },
  { id: "staplebops-03", label: "Staplebops 03" },
  { id: "staplebops-04", label: "Staplebops 04" },
  { id: "staplebops-05", label: "Staplebops 05" },
  { id: "staplebops-06", label: "Staplebops 06" },
  { id: "staplebops-07", label: "Staplebops 07" },
  { id: "nope-01", label: "Nope 01" },
  { id: "nope-02", label: "Nope 02" },
  { id: "nope-03", label: "Nope 03" },
  { id: "nope-04", label: "Nope 04" },
  { id: "nope-05", label: "Nope 05" },
  { id: "nope-06", label: "Nope 06" },
  { id: "nope-07", label: "Nope 07" },
  { id: "nope-08", label: "Nope 08" },
  { id: "nope-09", label: "Nope 09" },
  { id: "nope-10", label: "Nope 10" },
  { id: "nope-11", label: "Nope 11" },
  { id: "nope-12", label: "Nope 12" },
  { id: "yup-01", label: "Yup 01" },
  { id: "yup-02", label: "Yup 02" },
  { id: "yup-03", label: "Yup 03" },
  { id: "yup-04", label: "Yup 04" },
  { id: "yup-05", label: "Yup 05" },
  { id: "yup-06", label: "Yup 06" },
] as const;

export type SoundOption = (typeof SOUND_OPTIONS)[number];
export type SoundID = SoundOption["id"];

const SOUND_IDS = new Set<string>(SOUND_OPTIONS.map((o) => o.id));

export function isSoundId(id: string | undefined | null): id is SoundID {
  return Boolean(id && SOUND_IDS.has(id));
}

export function soundUrl(id: string | undefined | null): string | undefined {
  if (!isSoundId(id)) return undefined;
  return `/audio/${id}.mp3`;
}

/** Play a sound by URL. Returns cleanup (pause/reset). */
export function playSound(src: string | undefined): (() => void) | undefined {
  if (typeof Audio === "undefined" || !src) return undefined;
  try {
    const audio = new Audio(src);
    audio.volume = 0.55;
    void audio.play().catch(() => undefined);
    return () => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    };
  } catch {
    return undefined;
  }
}

/** Play by sound id (e.g. "staplebops-01"). */
export function playSoundById(id: string | undefined | null): Promise<(() => void) | undefined> {
  const src = soundUrl(id || undefined);
  if (!src) return Promise.resolve(undefined);
  return Promise.resolve(playSound(src));
}

// Demo playback for settings hover/select — debounce overlapping previews.
let demoCleanup: (() => void) | undefined;
let demoTimer: number | undefined;
let demoRun = 0;

export function stopDemoSound() {
  demoRun += 1;
  if (demoCleanup) demoCleanup();
  if (demoTimer !== undefined) window.clearTimeout(demoTimer);
  demoCleanup = undefined;
  demoTimer = undefined;
}

export function playDemoSound(id: string | undefined | null) {
  stopDemoSound();
  if (!id || id === "none") return;
  const run = ++demoRun;
  demoTimer = window.setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoRun !== run) {
        cleanup?.();
        return;
      }
      demoCleanup = cleanup;
    });
  }, 100);
}
