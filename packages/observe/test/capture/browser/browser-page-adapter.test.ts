import { describe, expect, it, vi } from "vitest";
import { Chunk, Effect, Either, Stream } from "effect";
import { LiveStreakCapabilityError } from "@livestreak/core";
import {
  createBrowserCaptureDriver,
  makeBrowserPageCaptureAdapter,
  makeBrowserPageFactoryCaptureAdapter,
  validateBrowserCapturePageReadiness
} from "#pipeline/capture/browser/index.js";

const bytes = (...values: readonly number[]): Uint8Array => new Uint8Array(values);

const noopAsync = async (): Promise<void> => {};

describe("browser page adapter", () => {
  it("maps Playwright-like pages to viewport, navigation, screenshot crop, and close calls", async () => {
    const page = {
      goto: vi.fn().mockImplementation(noopAsync),
      setViewportSize: vi.fn().mockImplementation(noopAsync),
      screenshot: vi.fn().mockResolvedValue(bytes(1, 2, 3)),
      close: vi.fn().mockImplementation(noopAsync)
    };
    const adapter = makeBrowserPageCaptureAdapter(page, {
      kind: "playwright",
      closePage: true
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/live",
            captureFps: 30,
            viewport: { width: 640, height: 360 },
            crop: { x: 10, y: 20, width: 320, height: 180 },
            encoding: "png",
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          const frames = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);

          return Chunk.toReadonlyArray(frames)[0];
        })
      )
    );

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 640, height: 360 });
    expect(page.goto).toHaveBeenCalledWith("https://example.com/live");
    expect(page.screenshot).toHaveBeenCalledWith({
      type: "png",
      clip: { x: 10, y: 20, width: 320, height: 180 }
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(result?.payload.width).toBe(320);
    expect(result?.payload.height).toBe(180);
    expect(result?.payload.byteFormat).toBe("png");
    expect(result?.sourceId).toBe("capture:browser");
  });

  it("maps Puppeteer-like pages without taking a Playwright dependency", async () => {
    const page = {
      goto: vi.fn().mockImplementation(noopAsync),
      setViewport: vi.fn().mockImplementation(noopAsync),
      screenshot: vi.fn().mockResolvedValue(bytes(4, 5, 6)),
      close: vi.fn().mockImplementation(noopAsync)
    };
    const adapter = makeBrowserPageCaptureAdapter(page, {
      kind: "puppeteer",
      closePage: true
    });

    const frame = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/scoreboard",
            captureFps: 24,
            viewport: { width: 800, height: 450 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          const frames = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);

          return Chunk.toReadonlyArray(frames)[0];
        })
      )
    );

    expect(page.setViewport).toHaveBeenCalledWith({ width: 800, height: 450 });
    expect(page.goto).toHaveBeenCalledWith("https://example.com/scoreboard");
    expect(page.screenshot).toHaveBeenCalledWith({ type: "jpeg" });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(frame?.payload.width).toBe(800);
    expect(frame?.payload.height).toBe(450);
    expect(frame?.payload.byteFormat).toBe("jpeg");
  });

  it("reports typed readiness errors when required browser methods are absent", async () => {
    const page = {
      goto: vi.fn().mockImplementation(noopAsync),
      screenshot: vi.fn().mockResolvedValue(bytes(1))
    };

    const missingMethod = await Effect.runPromise(
      validateBrowserCapturePageReadiness(page, { kind: "playwright" }).pipe(Effect.either)
    );
    const unsupported = await Effect.runPromise(
      validateBrowserCapturePageReadiness({}).pipe(Effect.either)
    );

    expect(Either.isLeft(missingMethod)).toBe(true);
    if (Either.isLeft(missingMethod)) {
      expect(missingMethod.left).toBeInstanceOf(LiveStreakCapabilityError);
      expect(missingMethod.left.readinessCode).toBe("missing-method");
      expect(missingMethod.left.requiredScope).toBe("capture:browser:setViewportSize");
    }

    expect(Either.isLeft(unsupported)).toBe(true);
    if (Either.isLeft(unsupported)) {
      expect(unsupported.left.readinessCode).toBe("unsupported-page");
      expect(unsupported.left.requiredScope).toBe("capture:browser:*");
    }
  });

  it("uses a page factory adapter and closes pages by default", async () => {
    const close = vi.fn().mockImplementation(noopAsync);
    const adapter = makeBrowserPageFactoryCaptureAdapter(() =>
      Effect.succeed({
        goto: vi.fn().mockImplementation(noopAsync),
        setViewportSize: vi.fn().mockImplementation(noopAsync),
        screenshot: vi.fn().mockResolvedValue(bytes(9, 9, 9)),
        close
      })
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/factory",
            captureFps: 30,
            maxFrames: 1
          });
          yield* driver.create(config);
        })
      )
    );

    expect(close).toHaveBeenCalledTimes(1);
  });
});
