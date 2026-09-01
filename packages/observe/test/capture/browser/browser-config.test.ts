import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { validateBrowserCaptureConfig } from "#pipeline/capture/browser/index.js";

describe("browser capture config validation", () => {
  it("rejects invalid config with typed config errors", async () => {
    const cases = [
      { url: "not-a-url", captureFps: 30 },
      { url: "ftp://example.com/live", captureFps: 30 },
      { url: "https://example.com/live", captureFps: 0 },
      { url: "https://example.com/live", captureFps: 30, viewport: { width: 0, height: 720 } },
      {
        url: "https://example.com/live",
        captureFps: 30,
        viewport: { width: 640, height: 480 },
        crop: { x: 600, y: 0, width: 100, height: 100 }
      },
      { url: "https://example.com/live", captureFps: 30, encoding: "webp" as "jpeg" },
      { url: "https://example.com/live", captureFps: 30, maxFrames: 0 }
    ];

    for (const config of cases) {
      const exit = await Effect.runPromiseExit(validateBrowserCaptureConfig(config));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain("LiveStreakConfigError");
      }
    }
  });

  it("normalizes url, defaults, and crop validation against viewport", async () => {
    const config = await Effect.runPromise(
      validateBrowserCaptureConfig({
        url: "https://example.com/live/",
        captureFps: 24.5,
        crop: { x: 0, y: 0, width: 640, height: 360 }
      })
    );

    expect(config.url).toBe("https://example.com/live/");
    expect(config.viewport).toEqual({ width: 1280, height: 720 });
    expect(config.encoding).toBe("jpeg");
    expect(config.captureFps).toBe(24.5);
    expect(config.crop).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });
});
