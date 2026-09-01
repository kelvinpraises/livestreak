import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createBrowserCaptureDriver } from "#pipeline/capture/browser/index.js";
import type { ObserveRunResult } from "#run/kernel.js";
import { prepareObserveRun, startObserveRun } from "#run/kernel.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { browserCaptureRunConfig } from "#run/run.js";
import {
  makeBrowserImageFixtures,
  readFixtureBytes,
  removeBrowserImageFixture
} from "#test/helpers/browser-images.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";
import {
  durationWithinEpsilon,
  probeVideoStream,
  removeFixtureDirectory,
  skipUnlessFfmpegIntegration
} from "#test/helpers/ffmpeg.js";

describe("browser passthrough", () => {
  it("exports jpeg browser capture to mp4 through the thin kernel", async (context) => {
    await skipUnlessFfmpegIntegration(context);

    const imageFixture = await makeBrowserImageFixtures();
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "livestreak-browser-output-"));
    const outputPath = path.join(outputDirectory, "export.mp4");
    const frameBytes = await readFixtureBytes(imageFixture.jpegPath);

    try {
      const result = await runBrowserPassthrough({
        frameBytes,
        outputPath,
        frameCount: 10,
        captureFps: 5
      });
      const outputProbe = await probeVideoStream(outputPath);

      assertBrowserPassthroughResult(result, outputPath, outputProbe, 10, 5);
    } finally {
      await removeBrowserImageFixture(imageFixture.directory);
      await removeFixtureDirectory(outputDirectory);
    }
  });
});

const assertBrowserPassthroughResult = (
  result: ObserveRunResult,
  outputPath: string,
  outputProbe: Awaited<ReturnType<typeof probeVideoStream>>,
  frameCount: number,
  captureFps: number
) => {
  expect(result.outcome).toBe("stopped");
  expect(result.board.cells["system:run"]?.status[0]).toBe("stopped");
  expect(result.outputUri).toBe(outputPath);
  expect(result.snapshot).toBeDefined();
  expect(result.snapshot!.sinks["file-export"]?.finalized).toBe(true);
  expect(result.snapshot!.sinks["file-export"]?.deliveredItems).toBe(frameCount);
  expect(result.snapshot!.capture?.descriptorId).toBe("browser");
  expect(result.snapshot!.capture?.sourceType).toBe("browser");
  expect(outputProbe.width).toBe(8);
  expect(outputProbe.height).toBe(8);
  expect(durationWithinEpsilon(outputProbe.durationMs, (frameCount * 1000) / captureFps, 900)).toBe(
    true
  );
};

const runBrowserPassthrough = async (options: {
  readonly frameBytes: Uint8Array;
  readonly outputPath: string;
  readonly frameCount: number;
  readonly captureFps: number;
}): Promise<ObserveRunResult> => {
  const adapter = makeFakeBrowserCaptureAdapter({
    frameBytes: options.frameBytes,
    encoding: "jpeg"
  });
  const driver = createBrowserCaptureDriver(adapter);

  const run = makeObserveRunSync(
    browserCaptureRunConfig(
      "run_browser_passthrough",
      {
        url: "https://example.com/live",
        captureFps: options.captureFps,
        viewport: { width: 8, height: 8 },
        encoding: "jpeg",
        maxFrames: options.frameCount
      },
      { path: options.outputPath }
    )
  );

  const kernelOptions = { captureDriver: driver };
  const prepared = await Effect.runPromise(prepareObserveRun(run, kernelOptions));
  expect(prepared.prepared).toBe(true);

  return Effect.runPromise(startObserveRun(prepared, kernelOptions));
};
