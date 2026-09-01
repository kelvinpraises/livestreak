import { Effect } from "effect";
import type { BrowserCaptureClock } from "#pipeline/capture/browser/timing.js";

export interface ManualBrowserCaptureClock extends BrowserCaptureClock {
  readonly advance: (durationMs: number) => void;
}

export const createManualBrowserCaptureClock = (
  initialNowMs = 0
): ManualBrowserCaptureClock => {
  let nowMs = initialNowMs;

  return {
    nowMs: () => nowMs,
    sleep: (durationMs) =>
      Effect.sync(() => {
        nowMs += durationMs;
      }),
    advance: (durationMs) => {
      nowMs += durationMs;
    }
  };
};
