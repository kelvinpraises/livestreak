import { Effect, Ref, Scope, Stream } from "effect";
import { type LiveStreakError } from "@livestreak/core";
import type {
  CaptureStageHealth,
  CaptureVideoPayload,
  FrameSource,
  RawFrame,
  RawFrameCadence
} from "#pipeline/capture/types.js";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureImageEncoding,
  BrowserCapturePage,
  BrowserCaptureViewport
} from "./page/types.js";
import {
  makeBrowserCaptureControls,
  type BrowserCaptureRuntimeConfigSnapshot
} from "./control/controls.js";
import { createBrowserCaptureControlSurface } from "./control/surface.js";
import {
  awaitBrowserLiveResume,
  createBrowserLivePauseRuntime,
  type BrowserLivePauseRuntime
} from "./control/live-pause.js";
import type { BrowserPreviewSession } from "./control/preview.js";
import { browserCaptureDescriptor } from "./descriptor.js";
import {
  normalizeBrowserCaptureConfig,
  validateCaptureFps,
  validateCrop,
  type BrowserCaptureConfig
} from "./config.js";
import {
  countLateCadenceDrops,
  defaultBrowserCaptureClock,
  type BrowserCaptureClock
} from "./timing.js";

const sourceId = "capture:browser";

interface BrowserCaptureStats {
  frameCount: number;
  droppedFrames: number;
  lastCadence: RawFrameCadence | undefined;
  startedAtMs: number | undefined;
  status: "idle" | "running" | "failed" | "stopped";
  message: string | undefined;
}

export const createBrowserCaptureFrameSource = (
  config: BrowserCaptureConfig,
  adapter: BrowserCaptureAdapter,
  clock: BrowserCaptureClock = defaultBrowserCaptureClock()
) =>
  Effect.gen(function* () {
    const normalized = normalizeBrowserCaptureConfig(config);
    const configReference = yield* Ref.make(normalized);
    const previewSessionReference = yield* Ref.make<BrowserPreviewSession>({
      revision: 0,
      targets: []
    });

    const page = yield* adapter.openPage({
      url: normalized.url,
      viewport: normalized.viewport,
      interactive: normalized.interactive,
      debug: normalized.debug
    });

    const controls = makeBrowserCaptureControls({
      configRef: configReference,
      previewSessionRef: previewSessionReference,
      page,
      validateCrop,
      validateCaptureFps
    });
    const livePauseRuntime = yield* createBrowserLivePauseRuntime();
    const stats: BrowserCaptureStats = {
      frameCount: 0,
      droppedFrames: 0,
      lastCadence: undefined,
      startedAtMs: undefined,
      status: "idle",
      message: undefined
    };

    const scope = yield* Effect.scope;
    yield* Scope.addFinalizer(
      scope,
      page.close.pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            stats.status = "failed";
            stats.message = errorMessage(error);
          })
        )
      )
    );

    const frames = browserCaptureFrameStream({
      configRef: configReference,
      page,
      stats,
      sourceId,
      livePauseRuntime,
      clock
    });

    const boundedFrames =
      normalized.maxFrames === undefined
        ? frames
        : frames.pipe(Stream.take(normalized.maxFrames));

    const frameSource: FrameSource = {
      descriptor: browserCaptureDescriptor,
      frames: boundedFrames.pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            if (stats.status === "idle") {
              stats.status = "running";
            }
          })
        ),
        Stream.onDone(() =>
          Effect.sync(() => {
            if (stats.status !== "failed") {
              stats.status = "stopped";
            }
          })
        )
      ),
      health: Effect.sync(() => ({
        stage: "capture",
        descriptorId: browserCaptureDescriptor.id,
        status: captureHealthStatus(stats.status),
        message: stats.message ?? `browser capture reading ${normalized.url}`,
        updatedAtMs: clock.nowMs(),
        sourceId,
        frameCount: stats.frameCount,
        droppedFrames: stats.droppedFrames,
        cadence: stats.lastCadence
      })),
      control: createBrowserCaptureControlSurface(controls),
      live: livePauseRuntime.controls
    };

    return frameSource;
  });

const copyBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const output: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output;
};

const byteFormatForEncoding = (
  encoding: BrowserCaptureImageEncoding
): CaptureVideoPayload["byteFormat"] => (encoding === "png" ? "png" : "jpeg");

const outputDimensions = (
  config: BrowserCaptureRuntimeConfigSnapshot
): BrowserCaptureViewport =>
  config.crop === undefined
    ? config.viewport
    : {
        width: config.crop.width,
        height: config.crop.height
      };

const browserCaptureFrameStream = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
  readonly page: BrowserCapturePage;
  readonly stats: BrowserCaptureStats;
  readonly sourceId: string;
  readonly livePauseRuntime: BrowserLivePauseRuntime;
  readonly clock: BrowserCaptureClock;
}): Stream.Stream<RawFrame, LiveStreakError> => {
  const timing = {
    nextDueMs: 0,
    initialized: false
  };

  return Stream.repeatEffect(
    Effect.gen(function* () {
      yield* awaitBrowserLiveResume(options.livePauseRuntime);

      const config = yield* Ref.get(options.configRef);
      const periodMs = 1000 / config.captureFps;
      const sequence = options.stats.frameCount;
      const isFirstFrame = sequence === 0;

      if (timing.initialized) {
        options.stats.droppedFrames += countLateCadenceDrops(
          timing,
          options.clock.nowMs(),
          periodMs,
          isFirstFrame
        );
        const waitMs = Math.max(0, timing.nextDueMs - options.clock.nowMs());
        if (waitMs > 0) {
          yield* options.clock.sleep(waitMs);
        }
        timing.nextDueMs += periodMs;
      }

      options.stats.status = "running";

      const screenshot = yield* options.page.screenshot({
        crop: config.crop,
        encoding: config.encoding
      });

      const wallClockMs = options.clock.nowMs();
      if (options.stats.startedAtMs === undefined) {
        options.stats.startedAtMs = wallClockMs;
      }

      const startedAtMs = options.stats.startedAtMs;
      if (!timing.initialized) {
        timing.initialized = true;
        timing.nextDueMs = wallClockMs + periodMs;
      }

      const elapsedMs = wallClockMs - startedAtMs;
      const observedFps = elapsedMs > 0 ? ((sequence + 1) * 1000) / elapsedMs : undefined;
      const encoding = screenshot.encoding ?? config.encoding;
      const dimensions = outputDimensions(config);
      const mediaTimeMs = sequence === 0 ? 0 : wallClockMs - startedAtMs;
      const cadence: RawFrameCadence = {
        mode: "capture",
        expectedFps: config.captureFps,
        observedFps,
        sequence,
        droppedFrames: options.stats.droppedFrames
      };

      options.stats.frameCount = sequence + 1;
      options.stats.lastCadence = cadence;

      return {
        id: `${options.sourceId}:frame:${sequence}`,
        sourceId: options.sourceId,
        time: {
          wallClockMs,
          mediaTimeMs,
          sourceTimeMs: mediaTimeMs,
          frameIndex: sequence
        },
        cadence,
        payload: {
          width: dimensions.width,
          height: dimensions.height,
          byteFormat: byteFormatForEncoding(encoding),
          encoding,
          expectedFps: config.captureFps,
          data: copyBytes(screenshot.data)
        }
      } satisfies RawFrame;
    })
  ).pipe(Stream.buffer({ capacity: 1, strategy: "sliding" }));
};

const captureHealthStatus = (
  status: BrowserCaptureStats["status"]
): CaptureStageHealth["status"] => {
  if (status === "idle") {
    return "starting";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "failed") {
    return "failed";
  }
  return "stopped";
};

const errorMessage = (error: LiveStreakError): string => {
  if ("message" in error) {
    return error.message;
  }
  return "browser capture close failed";
};

export type { NormalizedBrowserCaptureConfig } from "./config.js";
