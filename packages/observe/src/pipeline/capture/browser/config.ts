import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type {
  BrowserCaptureCrop,
  BrowserCaptureImageEncoding,
  BrowserCaptureViewport
} from "./page/types.js";
import type { BrowserCaptureRuntimeConfigSnapshot } from "./control/controls.js";

export interface BrowserCaptureConfig {
  readonly url: string;
  readonly captureFps: number;
  readonly viewport?: BrowserCaptureViewport;
  readonly crop?: BrowserCaptureCrop;
  readonly encoding?: BrowserCaptureImageEncoding;
  readonly interactive?: boolean;
  readonly debug?: boolean;
  readonly maxFrames?: number;
}

export type NormalizedBrowserCaptureConfig = BrowserCaptureRuntimeConfigSnapshot;

export const defaultBrowserCaptureViewport: BrowserCaptureViewport = {
  width: 1280,
  height: 720
};

const configError = (message: string, details?: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message,
    metadata: details === undefined ? undefined : { details }
  });

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const validateViewport = (
  viewport: BrowserCaptureViewport | undefined
): Effect.Effect<BrowserCaptureViewport, LiveStreakConfigError> => {
  if (viewport === undefined) {
    return Effect.succeed(defaultBrowserCaptureViewport);
  }

  if (!isPositiveInteger(viewport.width) || !isPositiveInteger(viewport.height)) {
    return Effect.fail(
      configError("Browser capture viewport width and height must be positive integers")
    );
  }

  return Effect.succeed(viewport);
};

export const validateCrop = (
  crop: BrowserCaptureCrop | undefined,
  viewport: BrowserCaptureViewport
): Effect.Effect<BrowserCaptureCrop | undefined, LiveStreakConfigError> => {
  if (crop === undefined) {
    return Effect.succeed(crop);
  }

  if (
    !isNonNegativeInteger(crop.x) ||
    !isNonNegativeInteger(crop.y) ||
    !isPositiveInteger(crop.width) ||
    !isPositiveInteger(crop.height)
  ) {
    return Effect.fail(
      configError("Browser capture crop must use non-negative x/y and positive integer width/height")
    );
  }

  if (crop.x + crop.width > viewport.width || crop.y + crop.height > viewport.height) {
    return Effect.fail(configError("Browser capture crop must fit inside the browser viewport"));
  }

  return Effect.succeed(crop);
};

export const validateEncoding = (
  encoding: BrowserCaptureImageEncoding | undefined
): Effect.Effect<BrowserCaptureImageEncoding, LiveStreakConfigError> => {
  if (encoding === undefined) {
    return Effect.succeed("jpeg");
  }
  if (encoding === "jpeg" || encoding === "png") {
    return Effect.succeed(encoding);
  }

  return Effect.fail(configError("Browser capture encoding must be jpeg or png"));
};

export const validateCaptureFps = (
  captureFps: unknown
): Effect.Effect<number, LiveStreakConfigError> =>
  typeof captureFps === "number" && Number.isFinite(captureFps) && captureFps > 0
    ? Effect.succeed(captureFps)
    : Effect.fail(configError("Browser capture captureFps must be greater than zero"));

const validateMaxFrames = (
  maxFrames: number | undefined
): Effect.Effect<number | undefined, LiveStreakConfigError> => {
  if (maxFrames === undefined) {
    return Effect.succeed(maxFrames);
  }

  if (!isPositiveInteger(maxFrames)) {
    return Effect.fail(configError("Browser capture maxFrames must be a positive integer"));
  }

  return Effect.succeed(maxFrames);
};

export const validateBrowserCaptureConfig = (
  config: BrowserCaptureConfig
): Effect.Effect<BrowserCaptureConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (typeof config.url !== "string" || config.url.trim().length === 0) {
      return yield* Effect.fail(configError("Browser capture url is required"));
    }

    let url: URL;
    try {
      url = new URL(config.url);
    } catch (error) {
      return yield* Effect.fail(
        configError(
          "Browser capture url must be a valid URL",
          error instanceof Error ? error.message : String(error)
        )
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return yield* Effect.fail(configError("Browser capture url must use http or https"));
    }

    const captureFps = yield* validateCaptureFps(config.captureFps);
    const viewport = yield* validateViewport(config.viewport);
    const crop = yield* validateCrop(config.crop, viewport);
    const encoding = yield* validateEncoding(config.encoding);
    const maxFrames = yield* validateMaxFrames(config.maxFrames);

    return {
      ...config,
      url: url.href,
      captureFps,
      viewport,
      crop,
      encoding,
      maxFrames
    };
  });

export const normalizeBrowserCaptureConfig = (
  config: BrowserCaptureConfig
): NormalizedBrowserCaptureConfig => ({
  url: config.url,
  captureFps: config.captureFps,
  viewport: config.viewport ?? defaultBrowserCaptureViewport,
  crop: config.crop,
  encoding: config.encoding ?? "jpeg",
  interactive: config.interactive,
  debug: config.debug,
  maxFrames: config.maxFrames
});
