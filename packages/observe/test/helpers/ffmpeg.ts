import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { parseFfprobeStreamInfo } from "#adapters/ffmpeg/index.js";

const execFileAsync = promisify(execFile);

export const hasBinary = async (binary: string): Promise<boolean> => {
  try {
    await execFileAsync(binary, ["-version"]);
    return true;
  } catch {
    return false;
  }
};

interface FfmpegIntegrationStatus {
  readonly available: boolean;
  readonly missing: readonly string[];
}

let cachedFfmpegIntegrationStatus: FfmpegIntegrationStatus | undefined;

export const ffmpegIntegrationAvailable = async (): Promise<boolean> => {
  const status = await resolveFfmpegIntegrationStatus();
  return status.available;
};

export interface FfmpegTestContext {
  readonly skip: (note?: string) => void;
}

export const skipUnlessFfmpegIntegration = async (context: FfmpegTestContext): Promise<void> => {
  const status = await resolveFfmpegIntegrationStatus();
  if (status.available) {
    return;
  }

  context.skip(`${status.missing.join(" and ")} not available on PATH`);
};

export const makeTinyMp4Fixture = async (): Promise<{
  readonly directory: string;
  readonly path: string;
}> => {
  const directory = await mkdtemp(path.join(tmpdir(), "livestreak-file-"));
  const fixturePath = path.join(directory, "tiny.mp4");

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=4x4:rate=5:duration=2",
    "-pix_fmt",
    "yuv420p",
    fixturePath
  ]);

  return { directory, path: fixturePath };
};

export interface ProbedVideoStream {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number | undefined;
}

export const probeVideoStream = async (pathToFile: string): Promise<ProbedVideoStream> => {
  const result = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate,r_frame_rate,duration",
    "-of",
    "json",
    pathToFile
  ]);

  return Effect.runPromise(parseFfprobeStreamInfo(result.stdout));
};

export const removeFixtureDirectory = async (directory: string): Promise<void> => {
  await rm(directory, { recursive: true, force: true });
};

export const durationWithinEpsilon = (
  actualMs: number | undefined,
  expectedMs: number | undefined,
  epsilonMs: number
): boolean => {
  if (actualMs === undefined) {
    return false;
  }
  if (expectedMs === undefined) {
    return false;
  }

  return Math.abs(actualMs - expectedMs) <= epsilonMs;
};

const resolveFfmpegIntegrationStatus = async (): Promise<FfmpegIntegrationStatus> => {
  if (cachedFfmpegIntegrationStatus !== undefined) {
    return cachedFfmpegIntegrationStatus;
  }

  const ffmpeg = await hasBinary("ffmpeg");
  const ffprobe = await hasBinary("ffprobe");
  const missing: string[] = [];

  if (ffmpeg === false) {
    missing.push("ffmpeg");
  }
  if (ffprobe === false) {
    missing.push("ffprobe");
  }

  cachedFfmpegIntegrationStatus = {
    available: missing.length === 0,
    missing
  };

  return cachedFfmpegIntegrationStatus;
};
