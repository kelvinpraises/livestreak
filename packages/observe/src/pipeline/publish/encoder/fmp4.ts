import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import {
  spawnChild,
  validateVideoDimensions,
  waitForProcessClose,
  writeStdinWithBackpressure,
  type FfmpegBinaries
} from "#adapters/ffmpeg/index.js";
import { createFmp4Chunker, type Fmp4Chunk } from "./fmp4-boxes.js";

/**
 * Fragmented-MP4 encoder — ONE H.264 encode of the run's raw I420 frames, chunked at fragment boundaries.
 *
 * This is the encode-once byte fan-out that replaces the per-viewer WebRTC mesh: a single ffmpeg process
 * (libx264, GOP == fragment duration) whose fragmented-MP4 stdout is split by a box scanner into an init
 * segment (ftyp+moov) and GOP-aligned media fragments (moof+mdat). Fragments are delivered as they close —
 * fragment granularity, never accumulate-then-send — so the host can fan the same bytes to N viewers over a
 * single outbound connection. The browser plays them back through MSE.
 *
 * Input frames are raw I420 (yuv420p) — the same decode the run already feeds the sinks. GOP is pinned to
 * `fragmentSeconds * fps` so every fragment starts on a keyframe (each fragment is independently seekable /
 * a valid late-join point).
 */
export interface Fmp4EncoderConfig {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Target fragment duration in seconds (GOP length). ~1s keeps ~1s live latency; must be > 0. */
  readonly fragmentSeconds: number;
  /** Called with each completed init/fragment chunk as ffmpeg emits it. */
  readonly onChunk: (chunk: Fmp4Chunk) => void;
  readonly binaries?: FfmpegBinaries;
}

export interface Fmp4Encoder {
  /** Push one raw I420 (yuv420p) frame; bytes must be width*height*3/2. */
  readonly writeFrame: (data: Uint8Array) => Effect.Effect<void, LiveStreakError>;
  /** Flush + close ffmpeg, drain the last fragment, and stop. Idempotent. */
  readonly finalize: Effect.Effect<void, LiveStreakError>;
}

export const createFmp4Encoder = (
  config: Fmp4EncoderConfig
): Effect.Effect<Fmp4Encoder, LiveStreakError> =>
  Effect.gen(function* () {
    yield* validateVideoDimensions(config.width, config.height);
    yield* validateFragment(config.fps, config.fragmentSeconds);

    const frameSize = (config.width * config.height * 3) / 2;
    const ffmpeg = config.binaries?.ffmpegPath ?? "ffmpeg";
    const child = yield* spawnChild(ffmpeg, makeFfmpegFmp4Arguments(config));
    const stderr: Uint8Array[] = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    // Route ffmpeg's fragmented-MP4 stdout through the box scanner and hand each completed chunk out live.
    const chunker = createFmp4Chunker();
    child.stdout.on("data", (bytes) => {
      for (const chunk of chunker.push(bytes)) {
        config.onChunk(chunk);
      }
    });

    let finalized = false;
    let closed = false;

    const writeFrame = (data: Uint8Array): Effect.Effect<void, LiveStreakError> => {
      if (finalized) {
        return Effect.fail(new LiveStreakRuntimeError({ message: "fMP4 encoder is finalized" }));
      }
      if (data.byteLength !== frameSize) {
        return Effect.fail(
          new LiveStreakRuntimeError({
            message: "fMP4 encoder received a frame with the wrong byte length",
            metadata: { details: `expected ${frameSize}, received ${data.byteLength}` }
          })
        );
      }
      return writeStdinWithBackpressure(child.stdin, data, "fMP4 encoder");
    };

    const finalize = Effect.gen(function* () {
      if (finalized) {
        return;
      }
      finalized = true;
      child.stdin.end();
      if (!closed) {
        yield* waitForProcessClose(child, stderr, "fMP4 encoder");
        closed = true;
      }
      // Drain any whole trailing fragment ffmpeg wrote as it closed the moov/moof at EOS.
      for (const chunk of chunker.flush()) {
        config.onChunk(chunk);
      }
    });

    return { writeFrame, finalize };
  });

// fMP4 to stdout: fragment on keyframe at the GOP boundary. `-g == fps*fragmentSeconds` + `-force_key_frames`
// pins keyframes to fragment edges so each fragment is independently decodable (a valid MSE late-join point);
// `empty_moov+default_base_moof+frag_keyframe` produces streamable init+moof/mdat with no seekable trailer.
export const makeFfmpegFmp4Arguments = (config: Fmp4EncoderConfig): readonly string[] => {
  const gop = Math.max(1, Math.round(config.fps * config.fragmentSeconds));
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "yuv420p",
    "-s",
    `${config.width}x${config.height}`,
    "-r",
    config.fps.toString(),
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-g",
    gop.toString(),
    "-keyint_min",
    gop.toString(),
    "-force_key_frames",
    `expr:gte(t,n_forced*${config.fragmentSeconds})`,
    "-movflags",
    "empty_moov+default_base_moof+frag_keyframe",
    "-frag_duration",
    Math.max(1, Math.round(config.fragmentSeconds * 1_000_000)).toString(),
    "-f",
    "mp4",
    "pipe:1"
  ];
};

// --- helpers ---

const validateFragment = (
  fps: number,
  fragmentSeconds: number
): Effect.Effect<void, LiveStreakConfigError> => {
  if (!Number.isFinite(fps) || fps <= 0) {
    return Effect.fail(new LiveStreakConfigError({ message: "fMP4 encoder fps must be a positive number" }));
  }
  if (!Number.isFinite(fragmentSeconds) || fragmentSeconds <= 0) {
    return Effect.fail(
      new LiveStreakConfigError({ message: "fMP4 encoder fragmentSeconds must be a positive number" })
    );
  }
  return Effect.void;
};
