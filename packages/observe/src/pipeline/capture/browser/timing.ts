import { Effect } from "effect";

export interface BrowserCaptureClock {
  readonly nowMs: () => number;
  readonly sleep: (durationMs: number) => Effect.Effect<void>;
}

export const defaultBrowserCaptureClock = (): BrowserCaptureClock => ({
  nowMs: () => Date.now(),
  sleep: (durationMs) => Effect.sleep(`${durationMs} millis`)
});

export const countLateCadenceDrops = (
  timing: { nextDueMs: number },
  nowMs: number,
  periodMs: number,
  skipWhenFirstFrame: boolean
): number => {
  if (skipWhenFirstFrame) {
    return 0;
  }

  let droppedFrames = 0;

  while (timing.nextDueMs < nowMs) {
    droppedFrames += 1;
    timing.nextDueMs += periodMs;
  }

  return droppedFrames;
};
