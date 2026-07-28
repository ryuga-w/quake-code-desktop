import { describe, expect, it } from "vitest";
import {
  countSignalTrailWords,
  nextAdaptiveSignalTrailSample,
  SIGNAL_TRAIL_MAX_ANIMATED_WORDS,
  signalTrailAnimationStartIndex,
} from "../src/client/src/components/markdown/adaptive-signal-trail";

describe("adaptive Signal Trail", () => {
  it("uses a shorter and lighter profile for rapid updates", () => {
    const initial = nextAdaptiveSignalTrailSample(undefined, "Yanıt", 0);
    const rapid = nextAdaptiveSignalTrailSample(initial, "Yanıt hızla akıyor şimdi", 80);

    expect(rapid.settings.profile).toBe("fast");
    expect(rapid.settings.animationName).toBe("sd-signalTrailFast");
    expect(rapid.settings.durationMs).toBeLessThan(220);
    expect(rapid.settings.staggerMs).toBeLessThanOrEqual(15);
  });

  it("uses a more pronounced profile when words arrive slowly", () => {
    const initial = nextAdaptiveSignalTrailSample(undefined, "Yanıt", 0);
    const slow = nextAdaptiveSignalTrailSample(initial, "Yanıt ilerliyor", 650);

    expect(slow.settings.profile).toBe("slow");
    expect(slow.settings.animationName).toBe("sd-signalTrailSlow");
    expect(slow.settings.durationMs).toBeGreaterThanOrEqual(300);
    expect(slow.settings.staggerMs).toBeGreaterThanOrEqual(20);
  });

  it("lightens large chunks and limits motion to the last ten words", () => {
    const initial = nextAdaptiveSignalTrailSample(undefined, "Başlangıç", 0);
    const largeChunk = nextAdaptiveSignalTrailSample(
      initial,
      "Başlangıç bir iki üç dört beş altı yedi sekiz dokuz on onbir oniki onüç ondört onbeş",
      600,
    );

    expect(largeChunk.settings.profile).toBe("fast");
    expect(largeChunk.settings.maxAnimatedWords).toBe(SIGNAL_TRAIL_MAX_ANIMATED_WORDS);
    expect(signalTrailAnimationStartIndex(24)).toBe(14);
    expect(signalTrailAnimationStartIndex(8)).toBe(0);
  });

  it("counts Turkish and joined words without treating punctuation as motion", () => {
    expect(countSignalTrailWords("ışığın ritmini seç; gerçek-zamanlı akış!")).toBe(5);
    expect(countSignalTrailWords("...\n—")).toBe(0);
  });
});
