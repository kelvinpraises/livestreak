import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { prepareObserveRun } from "#run/kernel.js";
import { browserCaptureRunConfig } from "#test/helpers/run-config.js";

describe("observe run kernel config", () => {
  it("prepareObserveRun fails with LiveStreakConfigError when browser driver is not injected", async () => {
    const run = makeObserveRunSync(
      browserCaptureRunConfig("run_missing_browser_driver", {
        url: "https://example.com",
        captureFps: 30,
        viewport: { width: 640, height: 480 },
        encoding: "jpeg"
      }, { path: "/tmp/out.mp4" })
    );

    const exit = await Effect.runPromiseExit(prepareObserveRun(run));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      expect(exit.cause.toString()).toContain('Unknown capture driver "browser"');
    }
  });
});
