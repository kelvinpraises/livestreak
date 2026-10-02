import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";

/** Raw I420 (yuv420p) frame contract shared by the fMP4-encoding sinks (live, direct). */
export interface I420Frame {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly data: Uint8Array;
}

/** Raw source layouts the shared boundary accepts before encoder normalization. */
export type RawSourceByteFormat = "rgba" | "yuv420p";

interface ValidatedSourceFrame {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly byteFormat: RawSourceByteFormat;
  readonly data: Uint8Array;
}

export const readI420Frame = (
  payload: unknown,
  sinkName: string
): Effect.Effect<I420Frame, LiveStreakError> =>
  Effect.gen(function* () {
    const source = yield* readValidatedSourceFrame(payload, sinkName, ["yuv420p"]);
    return {
      width: source.width,
      height: source.height,
      fps: source.fps,
      data: source.data
    };
  });

/**
 * Shared streaming-frame normalization (foundation B-F02-01): exactly one conversion per
 * delivery into each encoder. YUV passes through the strict reader with NO range remapping;
 * RGBA converts with the pinned integer BT.601-style approximation below. Both sink deliver
 * sites call this — never convert at POST admission and never cache across sinks.
 */
export const normalizeToI420 = (
  payload: unknown,
  sinkName: string
): Effect.Effect<I420Frame, LiveStreakError> =>
  Effect.gen(function* () {
    const source = yield* readValidatedSourceFrame(payload, sinkName, ["rgba", "yuv420p"]);
    if (source.byteFormat === "yuv420p") {
      return {
        width: source.width,
        height: source.height,
        fps: source.fps,
        data: source.data
      };
    }
    return {
      width: source.width,
      height: source.height,
      fps: source.fps,
      data: convertRgbaToI420(source.data, source.width, source.height)
    };
  });

const readValidatedSourceFrame = (
  payload: unknown,
  sinkName: string,
  formats: readonly RawSourceByteFormat[]
): Effect.Effect<ValidatedSourceFrame, LiveStreakError> =>
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
      encoding?: unknown;
      expectedFps?: unknown;
    };
    if (!(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0) {
      return yield* fail(`${sinkName} sink received a video payload without frame bytes`);
    }
    // G14-B05: safe integers only — unsafe dims compute Infinity byte counts downstream.
    if (
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      !Number.isSafeInteger(candidate.width) ||
      !Number.isSafeInteger(candidate.height) ||
      candidate.width <= 0 ||
      candidate.height <= 0
    ) {
      return yield* fail(`${sinkName} sink video frame requires safe positive integer width and height`);
    }
    // I420 packs one chroma sample per 2x2 block: odd dimensions have no valid layout.
    // Reject loudly — never silently crop or pad a source frame.
    if (candidate.width % 2 !== 0 || candidate.height % 2 !== 0) {
      return yield* fail(
        `${sinkName} sink video frame requires even width and height for I420, got ${candidate.width}x${candidate.height}`
      );
    }
    // A supported label alone does not establish uncompressed bytes.
    if (candidate.encoding !== "raw") {
      return yield* fail(
        `${sinkName} sink requires raw uncompressed frames, received encoding "${String(candidate.encoding)}"`
      );
    }
    if (!formats.includes(candidate.byteFormat as RawSourceByteFormat)) {
      return yield* fail(
        `${sinkName} sink requires ${formats.join(" or ")} frames, received "${String(candidate.byteFormat)}"`
      );
    }
    if (
      typeof candidate.expectedFps !== "number" ||
      !Number.isFinite(candidate.expectedFps) ||
      candidate.expectedFps <= 0
    ) {
      return yield* fail(
        `${sinkName} sink cannot encode without a finite positive expectedFps on the video payload`
      );
    }
    const expected =
      candidate.byteFormat === "rgba"
        ? candidate.width * candidate.height * 4
        : (candidate.width * candidate.height * 3) / 2;
    // The product of two safe integers can still overflow to Infinity or lose precision.
    if (!Number.isSafeInteger(expected) || expected <= 0) {
      return yield* fail(
        `${sinkName} sink video frame dimensions overflow exact byte arithmetic: ${candidate.width}x${candidate.height}`
      );
    }
    if (candidate.data.byteLength !== expected) {
      return yield* fail(
        `${sinkName} sink frame size mismatch: expected ${expected} bytes for ${candidate.width}x${candidate.height} ${candidate.byteFormat}, got ${candidate.data.byteLength}`
      );
    }
    return {
      width: candidate.width,
      height: candidate.height,
      fps: candidate.expectedFps,
      byteFormat: candidate.byteFormat as RawSourceByteFormat,
      data: candidate.data
    };
  });

/**
 * Pinned RGBA→I420 conversion: straight RGB, alpha ignored, planar Y/U/V, limited-range
 * BT.601-style integer approximation, one chroma sample per 2x2 block. Rounding is pinned:
 * Y=floor((66R+129G+25B+128)/256)+16; per four-pixel channel sums,
 * U=floor((-38ΣR-74ΣG+112ΣB+512)/1024)+128, V=floor((112ΣR-94ΣG-18ΣB+512)/1024)+128;
 * clamped to 0…255. Chosen approximation, not verbatim ITU BT.601 coefficients. The input is
 * never mutated — the encoder owns the returned buffer.
 */
const convertRgbaToI420 = (rgba: Uint8Array, width: number, height: number): Uint8Array => {
  const ySize = width * height;
  const chromaSize = ySize / 4;
  const out = new Uint8Array(ySize + chromaSize * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      out[y * width + x] = clamp255(
        Math.floor((66 * rgba[i]! + 129 * rgba[i + 1]! + 25 * rgba[i + 2]! + 128) / 256) + 16
      );
    }
  }
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          sumR += rgba[i]!;
          sumG += rgba[i + 1]!;
          sumB += rgba[i + 2]!;
        }
      }
      const chromaIndex = (y / 2) * (width / 2) + x / 2;
      out[ySize + chromaIndex] = clamp255(
        Math.floor((-38 * sumR - 74 * sumG + 112 * sumB + 512) / 1024) + 128
      );
      out[ySize + chromaSize + chromaIndex] = clamp255(
        Math.floor((112 * sumR - 94 * sumG - 18 * sumB + 512) / 1024) + 128
      );
    }
  }
  return out;
};

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value);
