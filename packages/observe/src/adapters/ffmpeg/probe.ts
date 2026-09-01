import { Effect } from "effect";
import {
  LiveStreakConfigError,
  LiveStreakRuntimeError,
  type LiveStreakError
} from "@livestreak/core";
import { runChild, type FfmpegBinaries } from "./process.js";

// --- exports ---

export interface FfprobeStreamInfo {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number | undefined;
}

export const maxVideoDimension = 8192;

export const parseFraction = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === "0/0") {
    return undefined;
  }

  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator)) {
    return undefined;
  }

  if (denominator === undefined) {
    if (numerator > 0) {
      return numerator;
    }
    return undefined;
  }

  if (!Number.isFinite(denominator)) {
    return undefined;
  }
  if (denominator <= 0) {
    return undefined;
  }

  const fps = numerator / denominator;
  if (fps > 0) {
    return fps;
  }
  return undefined;
};

export const parseFfprobeStreamInfo = (
  json: string
): Effect.Effect<FfprobeStreamInfo, LiveStreakError> =>
  Effect.try({
    try: () => JSON.parse(json) as ProbeJson,
    catch: (cause) =>
      runtimeFailure(
        "ffprobe returned invalid JSON",
        cause instanceof Error ? cause.message : String(cause)
      )
  }).pipe(
    Effect.flatMap((probe) => {
      const stream = probe.streams?.[0];
      const fps = parseFraction(stream?.avg_frame_rate) ?? parseFraction(stream?.r_frame_rate);
      const duration = stream?.duration === undefined ? Number.NaN : Number(stream.duration);

      const width = stream?.width;
      const height = stream?.height;

      if (stream === undefined) {
        return Effect.fail(
          runtimeFailure("ffprobe could not read a usable video stream", json.slice(0, 1000))
        );
      }
      if (!isPositiveInteger(width)) {
        return Effect.fail(
          runtimeFailure("ffprobe could not read a usable video stream", json.slice(0, 1000))
        );
      }
      if (!isPositiveInteger(height)) {
        return Effect.fail(
          runtimeFailure("ffprobe could not read a usable video stream", json.slice(0, 1000))
        );
      }
      if (fps === undefined) {
        return Effect.fail(
          runtimeFailure("ffprobe could not read a usable video stream", json.slice(0, 1000))
        );
      }

      let durationMs: number | undefined;
      if (Number.isFinite(duration) && duration > 0) {
        durationMs = duration * 1000;
      }

      return Effect.succeed({
        width,
        height,
        fps,
        durationMs
      });
    })
  );

export const probeMedia = (
  path: string,
  binaries: FfmpegBinaries = {}
): Effect.Effect<FfprobeStreamInfo, LiveStreakError> => {
  const ffprobe = binaries.ffprobePath ?? "ffprobe";

  return runChild(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate,r_frame_rate,duration",
    "-of",
    "json",
    path
  ]).pipe(
    Effect.flatMap((result) => {
      if (result.code === 0) {
        return parseFfprobeStreamInfo(result.stdout);
      }

      return Effect.fail(
        runtimeFailure(
          "ffprobe could not inspect the media file",
          result.stderr.trim() || `exit=${result.code ?? result.signal ?? "unknown"}`
        )
      );
    })
  );
};

export const validateVideoDimensions = (
  width: number,
  height: number
): Effect.Effect<void, LiveStreakConfigError> => {
  if (!isPositiveInteger(width)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Video width must be a positive integer"
      })
    );
  }
  if (!isPositiveInteger(height)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Video height must be a positive integer"
      })
    );
  }
  if (width > maxVideoDimension) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `Video width must be at most ${maxVideoDimension}`
      })
    );
  }
  if (height > maxVideoDimension) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `Video height must be at most ${maxVideoDimension}`
      })
    );
  }

  return Effect.void;
};

// --- helpers ---

interface ProbeJson {
  readonly streams?: readonly {
    readonly width?: number;
    readonly height?: number;
    readonly avg_frame_rate?: string;
    readonly r_frame_rate?: string;
    readonly duration?: string;
  }[];
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const runtimeFailure = (message: string, details?: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message,
    metadata: details === undefined ? undefined : { details }
  });
