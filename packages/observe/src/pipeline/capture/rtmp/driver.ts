import { Effect, Stream } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type { CaptureDriver, CaptureDriverDescriptor, RawFrame } from "../types.js";

export interface RtmpCaptureConfig {
  readonly port: number;
  readonly streamName: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Require a producer audio track; false explicitly selects video-only capture. */
  readonly audio?: boolean;
  readonly startupTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
}

export const rtmpCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "rtmp",
  version: "0.1.0",
  displayName: "RTMP broadcast",
  summary:
    "OBS/FFmpeg input on an owned trusted-loopback listener. Stream names are not credentials.",
  capabilityScopes: ["capture:rtmp:*"],
  flags: [],
  sourceType: "stream",
  sourceMode: "live",
  commands: [
    {
      name: "configure",
      scope: "capture:rtmp:configure",
      help: "Configure the broadcaster's RTMP listener; audio requires a producer audio track.",
      resultKind: "state-patch",
      input: {
        type: "object",
        properties: [
          ...["port", "width", "height", "fps"].map((name) => ({
            name,
            value: { type: "number" as const, required: true },
            help: name,
          })),
          {
            name: "streamName",
            value: { type: "string", description: "Public stream name, not a password." },
            help: "Defaults to this observation's ID.",
          },
          {
            name: "audio",
            value: { type: "boolean", default: true },
            help: "Include stereo audio; false explicitly selects video only.",
          },
          ...["startupTimeoutMs", "idleTimeoutMs"].map((name) => ({
            name,
            value: { type: "number" as const },
            help: "Bounded input timeout in milliseconds.",
          })),
        ],
      },
    },
    {
      name: "close",
      scope: "capture:rtmp:close",
      help: "Clear RTMP readiness; stop the running observation before reconfiguring.",
      resultKind: "state-patch",
    },
  ],
};

export const rtmpPublishUrl = (config: RtmpCaptureConfig): string =>
  `rtmp://127.0.0.1:${config.port}/live/${config.streamName}`;

export const validateRtmpCaptureConfig = (config: RtmpCaptureConfig) =>
  Effect.gen(function* () {
    const fail = (message: string) =>
      Effect.fail(new LiveStreakConfigError({ message: `RTMP capture: ${message}` }));
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
      return yield* fail("port must be in 1..65535");
    if (typeof config.streamName !== "string" || !/^[\w-]{1,128}$/.test(config.streamName))
      return yield* fail(
        "streamName must be 1..128 letters, digits, underscores or hyphens",
      );
    for (const dimension of [config.width, config.height])
      if (
        !Number.isSafeInteger(dimension) ||
        dimension < 2 ||
        dimension > 4096 ||
        dimension % 2 !== 0
      )
        return yield* fail("dimensions must be even integers in 2..4096");
    if (!Number.isInteger(config.fps) || config.fps < 1 || config.fps > 120)
      return yield* fail("fps must be an integer in 1..120");
    if (config.audio !== undefined && typeof config.audio !== "boolean")
      return yield* fail("audio must be boolean");
    for (const timeout of [config.startupTimeoutMs ?? 15000, config.idleTimeoutMs ?? 10000])
      if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
        return yield* fail("timeouts must be integers in 100..120000 ms");
    return {
      port: config.port,
      streamName: config.streamName,
      width: config.width,
      height: config.height,
      fps: config.fps,
      audio: config.audio ?? true,
      startupTimeoutMs: config.startupTimeoutMs ?? 15000,
      idleTimeoutMs: config.idleTimeoutMs ?? 10000,
    };
  });

export const createRtmpCaptureDriver = (): CaptureDriver<RtmpCaptureConfig> => ({
  descriptor: rtmpCaptureDescriptor,
  validate: validateRtmpCaptureConfig,
  describeControl: (config, context) =>
    Effect.succeed({
      id: "capture:rtmp",
      cell: {
        label: "RTMP broadcast",
        catalog: "capture:rtmp",
        status: ["idle", null, context.nowMs ?? Date.now()],
        settings: {},
        readonly: {
          sourceType: "stream",
          sourceMode: "live",
          publishUrl: rtmpPublishUrl(config),
          audio: config.audio ?? true,
        },
        functions: [],
      },
    }),
  create: (config) =>
    Effect.gen(function* () {
      const resolved = yield* validateRtmpCaptureConfig(config);
      const { spawn } = yield* Effect.promise(() => import("node:child_process"));
      const frames: RawFrame[] = [];
      let video = Buffer.alloc(0),
        audio = Buffer.alloc(0),
        sequence = 0,
        dropped = 0,
        paused = false,
        revision = 0;
      let terminal = false,
        closing = false,
        failure: Error | undefined,
        wake: (() => void) | undefined;
      let status: "starting" | "running" | "stopped" | "failed" = "starting";
      let stderr = "";
      const frameBytes = (resolved.width * resolved.height * 3) / 2;
      const arguments_ = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-probesize",
        "2048",
        "-analyzeduration",
        "1",
        "-threads",
        "1",
        "-flags",
        "low_delay",
        "-listen",
        "1",
        "-f",
        "flv",
        "-i",
        rtmpPublishUrl(resolved),
        "-map",
        "0:v:0",
        "-vf",
        `scale=${resolved.width}:${resolved.height}:force_original_aspect_ratio=decrease,pad=${resolved.width}:${resolved.height}:(ow-iw)/2:(oh-ih)/2,fps=${resolved.fps}`,
        "-fps_mode",
        "passthrough",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "rawvideo",
        "pipe:1",
      ];
      if (resolved.audio)
        arguments_.push(
          "-map",
          "0:a:0",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-f",
          "s16le",
          "pipe:3",
        );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const child = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            new Promise<import("node:child_process").ChildProcess>((resolve, reject) => {
              const process = spawn("ffmpeg", arguments_, {
                stdio: ["ignore", "pipe", "pipe", resolved.audio ? "pipe" : "ignore"],
              });
              process.once("error", reject);
              process.once("spawn", () => resolve(process));
            }),
          catch: (cause) =>
            new LiveStreakRuntimeError({
              message: `RTMP receiver could not start: ${String(cause)}`,
            }),
        }),
        (process) =>
          Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                closing = true;
                terminal = true;
                wake?.();
                clearTimeout(timer);
                if (process.exitCode !== null || process.signalCode !== null) {
                  resolve();
                  return;
                }
                process.once("close", () => {
                  clearTimeout(force);
                  clearTimeout(deadline);
                  resolve();
                });
                process.kill("SIGTERM");
                const force = setTimeout(() => process.kill("SIGKILL"), 500);
                const deadline = setTimeout(
                  () => reject(new Error("RTMP receiver did not exit after SIGKILL")),
                  2500,
                );
              }),
            catch: (cause) => new LiveStreakRuntimeError({ message: String(cause) }),
          }).pipe(Effect.orDie),
      );
      const finish = (error?: Error) => {
        if (terminal) return;
        terminal = true;
        failure = error;
        status = error ? "failed" : "stopped";
        clearTimeout(timer);
        wake?.();
      };
      const timeout = () => {
        finish(
          new Error(
            status === "starting"
              ? "RTMP startup timed out waiting for decoded media"
              : "RTMP source stopped delivering media",
          ),
        );
        child.kill("SIGTERM");
      };
      timer = setTimeout(timeout, resolved.startupTimeoutMs);
      const emit = () => {
        while (video.length >= frameBytes) {
          const samples =
            Math.floor(((sequence + 1) * 48000) / resolved.fps) -
            Math.floor((sequence * 48000) / resolved.fps);
          const audioBytes = samples * 4;
          if (resolved.audio && audio.length < audioBytes) break;
          const bytes = new Uint8Array(video.subarray(0, frameBytes));
          video = video.subarray(frameBytes);
          const pcm = resolved.audio
            ? new Uint8Array(audio.subarray(0, audioBytes))
            : undefined;
          if (resolved.audio) audio = audio.subarray(audioBytes);
          const index = sequence++;
          clearTimeout(timer);
          timer = setTimeout(timeout, resolved.idleTimeoutMs);
          status = "running";
          if (paused || frames.length >= 4) {
            dropped++;
            continue;
          }
          frames.push({
            id: `capture:rtmp:${index}`,
            sourceId: "capture:rtmp",
            time: nowTimePoint(Date.now()),
            cadence: {
              mode: "capture",
              expectedFps: resolved.fps,
              sequence: index,
              droppedFrames: dropped,
            },
            payload: {
              width: resolved.width,
              height: resolved.height,
              byteFormat: "yuv420p",
              encoding: "raw",
              expectedFps: resolved.fps,
              data: bytes,
              ...(pcm
                ? {
                    audio: {
                      data: pcm,
                      sampleRate: 48000,
                      channels: 2,
                      format: "s16le" as const,
                    },
                  }
                : {}),
            },
          });
          wake?.();
        }
      };
      child.stdout!.on("data", (chunk: Buffer) => {
        if (terminal) return;
        video = Buffer.concat([video, chunk]);
        emit();
        if (video.length > frameBytes * 4) {
          finish(new Error("RTMP audio/video synchronization buffer exceeded"));
          child.kill("SIGTERM");
        }
      });
      if (resolved.audio)
        (child.stdio[3] as import("node:stream").Readable).on("data", (chunk: Buffer) => {
          if (terminal) return;
          audio = Buffer.concat([audio, chunk]);
          emit();
          if (audio.length > 48000 * 4 * 10) {
            finish(new Error("RTMP audio buffer exceeded ten seconds"));
            child.kill("SIGTERM");
          }
        });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4096);
      });
      child.once("error", (error) => finish(error));
      child.once("close", (code) => {
        if (!closing)
          finish(
            code === 0 ? undefined : new Error(`RTMP receiver exited (${code}): ${stderr}`),
          );
      });
      const iterable = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (frames.length) {
              yield frames.shift()!;
              continue;
            }
            if (terminal) {
              if (failure) throw failure;
              return;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          }
        },
      };
      return {
        descriptor: rtmpCaptureDescriptor,
        frames: Stream.fromAsyncIterable(
          iterable,
          (cause) => new LiveStreakRuntimeError({ message: String(cause) }),
        ),
        health: Effect.sync(() => ({
          stage: "capture" as const,
          descriptorId: "rtmp",
          status,
          updatedAtMs: Date.now(),
          sourceId: "capture:rtmp",
          frameCount: sequence - dropped,
          droppedFrames: dropped,
          message:
            failure?.message ?? `Trusted-loopback listener: ${rtmpPublishUrl(resolved)}`,
        })),
        live: {
          pause: () =>
            Effect.sync(() => {
              if (!paused) {
                paused = true;
                revision++;
                dropped += frames.length;
                frames.length = 0;
              }
              return { paused, revision };
            }),
          resume: () =>
            Effect.sync(() => {
              if (paused) {
                paused = false;
                revision++;
              }
              return { paused, revision };
            }),
          snapshot: Effect.sync(() => ({ paused, revision })),
        },
      };
    }),
});
