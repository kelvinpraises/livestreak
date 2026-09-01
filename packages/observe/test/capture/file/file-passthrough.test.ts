import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ObserveRunResult } from "#run/kernel.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { fileCaptureRunConfig } from "#test/helpers/run-config.js";
import { prepareObserveRun, startObserveRun } from "#run/kernel.js";
import type { ProbedVideoStream } from "#test/helpers/ffmpeg.js";
import {
  durationWithinEpsilon,
  makeTinyMp4Fixture,
  probeVideoStream,
  removeFixtureDirectory,
  skipUnlessFfmpegIntegration
} from "#test/helpers/ffmpeg.js";

describe("file passthrough", () => {
  it("exports an mp4 through the thin kernel", async (context) => {
    await skipUnlessFfmpegIntegration(context);

    const fixture = await makeTinyMp4Fixture();
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "livestreak-output-"));
    const outputPath = path.join(outputDirectory, "export.mp4");

    try {
      const result = await runFilePassthrough(fixture.path, outputPath);
      const inputProbe = await probeVideoStream(fixture.path);
      const outputProbe = await probeVideoStream(outputPath);

      assertPassthroughResult(result, outputPath, inputProbe, outputProbe);
    } finally {
      await removeFixtureDirectory(fixture.directory);
      await removeFixtureDirectory(outputDirectory);
    }
  });
});

const runFilePassthrough = async (inputPath: string, outputPath: string) => {
  const run = makeObserveRunSync(fileCaptureRunConfig("run_file_passthrough", inputPath, outputPath));

  const prepared = await Effect.runPromise(prepareObserveRun(run));
  expect(prepared.prepared).toBe(true);
  expect(prepared.board.cells["system:run"]?.status[0]).toBe("prepared");

  return Effect.runPromise(startObserveRun(prepared));
};

const assertPassthroughResult = (
  result: ObserveRunResult,
  outputPath: string,
  inputProbe: ProbedVideoStream,
  outputProbe: ProbedVideoStream
) => {
  expect(result.outcome).toBe("stopped");
  expect(result.board.cells["system:run"]?.status[0]).toBe("stopped");
  expect(result.outputUri).toBe(outputPath);
  expect(result.snapshot).toBeDefined();
  expect(result.snapshot!.sinks["file-export"]?.finalized).toBe(true);
  expect(result.snapshot!.sinks["file-export"]?.deliveredItems).toBeGreaterThan(0);
  expect(outputProbe.width).toBe(inputProbe.width);
  expect(outputProbe.height).toBe(inputProbe.height);
  expect(durationWithinEpsilon(outputProbe.durationMs, inputProbe.durationMs, 750)).toBe(true);
};
