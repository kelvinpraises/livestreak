import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";

/** Raw I420 (yuv420p) frame contract shared by the fMP4-encoding sinks (live, direct). */
export interface I420Frame {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly data: Uint8Array;
}

export const readI420Frame = (
  payload: unknown,
  sinkName: string
): Effect.Effect<I420Frame, LiveStreakError> =>
  Effect.gen(function* () {
    const fail = (message: string): Effect.Effect<never, LiveStreakConfigError> =>
      Effect.fail(new LiveStreakConfigError({ message }));

    if (payload === null || typeof payload !== "object") {
      return yield* fail(`${sinkName} sink received an invalid video payload`);
    }
    const candidate = payload as {
      data?: unknown;
      width?: unknown;
      height?: unknown;
      byteFormat?: unknown;
      expectedFps?: unknown;
    };
    if (!(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0) {
      return yield* fail(`${sinkName} sink received a video payload without frame bytes`);
    }
    if (
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      candidate.width <= 0 ||
      candidate.height <= 0
    ) {
      return yield* fail(`${sinkName} sink video frame requires positive width and height`);
    }
    // The encode consumes I420. The capture is wired to decode yuv420p for these sinks; a mismatch is a
    // pipeline misconfiguration, so fail loudly rather than feed garbage into ffmpeg.
    if (candidate.byteFormat !== "yuv420p") {
      return yield* fail(
        `${sinkName} sink requires I420 (yuv420p) frames, received "${String(candidate.byteFormat)}" — ` +
          "configure the capture with pixelFormat: 'yuv420p'"
      );
    }
    if (typeof candidate.expectedFps !== "number" || candidate.expectedFps <= 0) {
      return yield* fail(
        `${sinkName} sink cannot encode without a positive expectedFps on the video payload`
      );
    }
    const expected = (candidate.width * candidate.height * 3) / 2;
    if (candidate.data.byteLength !== expected) {
      return yield* fail(
        `${sinkName} sink I420 frame size mismatch: expected ${expected} bytes for ${candidate.width}x${candidate.height}, got ${candidate.data.byteLength}`
      );
    }
    return {
      width: candidate.width,
      height: candidate.height,
      fps: candidate.expectedFps,
      data: candidate.data
    };
  });
