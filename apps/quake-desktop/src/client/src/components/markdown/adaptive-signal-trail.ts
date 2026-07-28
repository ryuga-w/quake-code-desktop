export const SIGNAL_TRAIL_MAX_ANIMATED_WORDS = 10;

export type SignalTrailProfile = "fast" | "balanced" | "slow";

export type AdaptiveSignalTrailSettings = {
  animationName: "sd-signalTrailFast" | "sd-signalTrail" | "sd-signalTrailSlow";
  durationMs: number;
  staggerMs: number;
  maxAnimatedWords: number;
  profile: SignalTrailProfile;
};

export type AdaptiveSignalTrailSample = {
  content: string;
  sampledAt: number;
  smoothedIntervalMs: number;
  settings: AdaptiveSignalTrailSettings;
};

const DEFAULT_INTERVAL_MS = 260;
const MIN_SAMPLE_INTERVAL_MS = 60;
const MAX_SAMPLE_INTERVAL_MS = 900;

export function nextAdaptiveSignalTrailSample(
  previous: AdaptiveSignalTrailSample | undefined,
  content: string,
  sampledAt: number,
): AdaptiveSignalTrailSample {
  if (previous?.content === content) return previous;

  const appendOnly = Boolean(previous && content.startsWith(previous.content));
  const appendedContent = appendOnly ? content.slice(previous!.content.length) : content;
  const appendedWords = countSignalTrailWords(appendedContent);

  if (!previous || !appendOnly) {
    const initialIntensity = appendedWords > SIGNAL_TRAIL_MAX_ANIMATED_WORDS ? 0.12 : 0.5;
    return {
      content,
      sampledAt,
      smoothedIntervalMs: DEFAULT_INTERVAL_MS,
      settings: settingsForIntensity(initialIntensity),
    };
  }

  // Punctuation-only updates should not distort the cadence of the next word.
  if (appendedWords === 0) return { ...previous, content };

  const intervalMs = clamp(sampledAt - previous.sampledAt, MIN_SAMPLE_INTERVAL_MS, MAX_SAMPLE_INTERVAL_MS);
  const smoothedIntervalMs = (previous.smoothedIntervalMs * 0.55) + (intervalMs * 0.45);
  const wordsPerSecond = appendedWords / (intervalMs / 1000);

  const cadenceIntensity = normalize(smoothedIntervalMs, 120, 540);
  const throughputIntensity = 1 - normalize(wordsPerSecond, 5, 27);
  const burstFactor = normalize(appendedWords, 6, 14);
  const baseIntensity = (cadenceIntensity * 0.68) + (throughputIntensity * 0.32);
  // Large chunks must settle quickly: show their leading words immediately and
  // reserve the motion for a short tail instead of queueing a whole paragraph.
  const intensity = baseIntensity * (1 - (burstFactor * 0.78));

  return {
    content,
    sampledAt,
    smoothedIntervalMs,
    settings: settingsForIntensity(intensity),
  };
}

export function signalTrailAnimationStartIndex(wordCount: number, maxAnimatedWords = SIGNAL_TRAIL_MAX_ANIMATED_WORDS): number {
  return Math.max(0, wordCount - maxAnimatedWords);
}

export function countSignalTrailWords(content: string): number {
  return content.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function settingsForIntensity(rawIntensity: number): AdaptiveSignalTrailSettings {
  const intensity = clamp(rawIntensity, 0, 1);
  const profile: SignalTrailProfile = intensity <= 0.32
    ? "fast"
    : intensity >= 0.68
      ? "slow"
      : "balanced";

  return {
    animationName: profile === "fast"
      ? "sd-signalTrailFast"
      : profile === "slow"
        ? "sd-signalTrailSlow"
        : "sd-signalTrail",
    durationMs: roundToFive(150 + (intensity * 230)),
    staggerMs: roundToFive(10 + (intensity * 16)),
    maxAnimatedWords: SIGNAL_TRAIL_MAX_ANIMATED_WORDS,
    profile,
  };
}

function normalize(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5;
}
