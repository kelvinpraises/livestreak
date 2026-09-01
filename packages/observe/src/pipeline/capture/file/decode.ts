import { Effect, Stream } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import {
  concatBytes,
  copyBytes,
  bytesToUtf8,
  killProcess,
  spawnChild,
  type FfmpegBinaries,
  type FfprobeStreamInfo,
  type NodeChildProcess
} from "#adapters/ffmpeg/index.js";
import type { RawFrame, RawFrameCadence } from "#pipeline/capture/types.js";

export interface FileReplayConfig {
  readonly path: string;
}

export interface FileDecodeStats {
  frameCount: number;
  droppedFrames: number;
  lastCadence: RawFrameCadence | undefined;
  startedAtMs: number | undefined;
  status: "idle" | "running" | "failed" | "stopped";
  message: string | undefined;
}

interface RawVideoProcessResource {
  readonly stop: () => void;
}

export const makeFfmpegRawVideoDecodeArguments = (path: string): readonly string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  path,
  "-an",
  "-sn",
  "-dn",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgb24",
  "pipe:1"
];

export const rawVideoFrameStream = (options: {
  readonly config: FileReplayConfig;
  readonly probe: FfprobeStreamInfo;
  readonly sourceId: string;
  readonly binaries?: FfmpegBinaries;
  readonly stats: FileDecodeStats;
}): Stream.Stream<RawFrame, LiveStreakError> => {
  const frameSize = options.probe.width * options.probe.height * 3;
  const effectiveFps = options.probe.fps;
  const ffmpeg = options.binaries?.ffmpegPath ?? "ffmpeg";

  return Stream.asyncPush<RawFrame, LiveStreakError>(
    (emit) =>
      Effect.acquireRelease(
        Effect.flatMap(spawnChild(ffmpeg, makeFfmpegRawVideoDecodeArguments(options.config.path)), (child) =>
          Effect.sync(() => startRawVideoDecodeChild(emit, child, options, frameSize, effectiveFps, ffmpeg))
        ),
        (resource: RawVideoProcessResource) =>
          Effect.sync(() => {
            resource.stop();
          })
      ),
    { bufferSize: 4, strategy: "sliding" }
  );
};

// --- helpers ---

type StreamEmit = {
  readonly single: (frame: RawFrame) => boolean;
  readonly fail: (error: LiveStreakError) => void;
  readonly end: () => void;
};

const startRawVideoDecodeChild = (
  emit: StreamEmit,
  child: NodeChildProcess,
  options: {
    readonly config: FileReplayConfig;
    readonly probe: FfprobeStreamInfo;
    readonly sourceId: string;
    readonly stats: FileDecodeStats;
  },
  frameSize: number,
  effectiveFps: number,
  ffmpeg: string
): RawVideoProcessResource => {
  const stderr: Uint8Array[] = [];
  let pending: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let ended = false;

  options.stats.startedAtMs = Date.now();
  options.stats.status = "running";

  const fail = (error: LiveStreakError) => {
    if (ended) {
      return;
    }
    ended = true;
    options.stats.status = "failed";
    options.stats.message = failMessageFromError(error);
    emit.fail(error);
  };

  child.on("error", (cause) => {
    if (cause.code === "ENOENT") {
      fail(
        new LiveStreakRuntimeError({
          message: `${ffmpeg} is required for file source decoding`,
          metadata: {
            details: `Install ${ffmpeg} or configure a compatible binary on PATH.`,
            cause
          }
        })
      );
      return;
    }
    fail(new LiveStreakRuntimeError({ message: "ffmpeg failed to start", metadata: { details: cause.message } }));
  });

  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdout.on("data", (chunk) => {
    pending = pending.byteLength === 0 ? copyBytes(chunk) : concatBytes([pending, chunk]);

    while (pending.byteLength >= frameSize) {
      const data = new Uint8Array(frameSize);
      data.set(pending.subarray(0, frameSize));
      pending = pending.subarray(frameSize);
      const frameIndex = options.stats.frameCount;
      const elapsedMs =
        options.stats.startedAtMs === undefined ? 0 : Date.now() - options.stats.startedAtMs;
      let observedFps: number | undefined;
      if (elapsedMs > 0) {
        observedFps = ((frameIndex + 1) * 1000) / elapsedMs;
      }

      const cadence: RawFrameCadence = {
        mode: "replay",
        expectedFps: effectiveFps,
        observedFps,
        sequence: frameIndex,
        droppedFrames: options.stats.droppedFrames
      };

      const frame = makeRawFrame(options.sourceId, options.probe, frameIndex, effectiveFps, cadence, data);
      const accepted = emit.single(frame);

      options.stats.frameCount = frameIndex + 1;
      options.stats.lastCadence = cadence;
      if (accepted === false) {
        options.stats.droppedFrames += 1;
      }
    }
  });

  child.on("close", (code, signal) => {
    if (ended) {
      return;
    }
    ended = true;
    options.stats.status = code === 0 ? "stopped" : "failed";

    if (code === 0) {
      emit.end();
      return;
    }

    emit.fail(
      new LiveStreakRuntimeError({
        message: "ffmpeg decode failed",
        metadata: {
          details:
            bytesToUtf8(concatBytes(stderr)).trim() || `exit=${code ?? signal ?? "unknown"}`
        }
      })
    );
  });

  return {
    stop: () => {
      if (ended) {
        return;
      }
      ended = true;
      options.stats.status = "stopped";
      killProcess(child);
    }
  };
};

const makeRawFrame = (
  sourceId: string,
  probe: FfprobeStreamInfo,
  frameIndex: number,
  effectiveFps: number,
  cadence: RawFrameCadence,
  data: Uint8Array
): RawFrame => ({
  id: `${sourceId}:frame:${frameIndex}`,
  sourceId,
  time: {
    wallClockMs: Date.now(),
    mediaTimeMs: (frameIndex * 1000) / effectiveFps,
    sourceTimeMs: (frameIndex * 1000) / effectiveFps,
    frameIndex
  },
  cadence,
  payload: {
    width: probe.width,
    height: probe.height,
    byteFormat: "rgb",
    encoding: "raw",
    expectedFps: effectiveFps,
    data
  }
});

const failMessageFromError = (error: LiveStreakError): string => {
  if ("message" in error) {
    return error.message;
  }
  return "file source failed";
};
