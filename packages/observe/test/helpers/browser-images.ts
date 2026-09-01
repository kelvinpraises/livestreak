import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BrowserImageFixture {
  readonly directory: string;
  readonly jpegPath: string;
  readonly pngPath: string;
}

export const makeBrowserImageFixtures = async (): Promise<BrowserImageFixture> => {
  const directory = await mkdtemp(path.join(tmpdir(), "livestreak-browser-image-"));
  const jpegPath = path.join(directory, "frame.jpg");
  const pngPath = path.join(directory, "frame.png");

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=8x8:rate=1:duration=1",
    "-frames:v",
    "1",
    "-q:v",
    "2",
    jpegPath
  ]);

  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=8x8:rate=1:duration=1",
    "-frames:v",
    "1",
    pngPath
  ]);

  return { directory, jpegPath, pngPath };
};

export const readFixtureBytes = async (fixturePath: string): Promise<Uint8Array> => {
  const buffer = await readFile(fixturePath);
  return new Uint8Array(buffer);
};

export const removeBrowserImageFixture = async (directory: string): Promise<void> => {
  const { rm } = await import("node:fs/promises");
  await rm(directory, { recursive: true, force: true });
};
