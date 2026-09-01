import { describe, expect, it } from "vitest";
import { Chunk, Effect, Stream } from "effect";
import {
  browserCaptureSetCaptureFpsScope,
  browserCaptureClearCropScope,
  browserCaptureSetCropScope,
  createBrowserCaptureDriver
} from "#pipeline/capture/browser/index.js";
import { builtInObserveRegistry, getRegistryDescriptor } from "#index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";

describe("browser capture controls", () => {
  it("registers browser command scopes separately from file capture", () => {
    const file = getRegistryDescriptor(builtInObserveRegistry, "capture", "file");
    const browser = getRegistryDescriptor(builtInObserveRegistry, "capture", "browser");

    const fileCommands = new Set(file?.commands.map((command) => command.scope));
    const browserCommands = new Set(browser?.commands.map((command) => command.scope));

    expect(browserCommands.has(browserCaptureSetCropScope)).toBe(true);
    expect(browserCommands.has(browserCaptureSetCaptureFpsScope)).toBe(true);
    expect(fileCommands.has(browserCaptureSetCropScope)).toBe(false);
  });

  it("updates crop and captureFps through the live control surface", async () => {
    const screenshotCrops: Array<{ readonly x: number; readonly y: number }> = [];
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([1, 2, 3]),
      onScreenshot: (options) => {
        if (options.crop !== undefined) {
          screenshotCrops.push({ x: options.crop.x, y: options.crop.y });
        }
      }
    });
    const driver = createBrowserCaptureDriver(adapter);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/controls",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 3
          });
          const source = yield* driver.create(config);
          const requiredFunctions = ["setCrop", "setCaptureFps", "clearCrop"] as const;
          const surface = source.control;
          if (surface === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          if (!requiredFunctions.every((name) => surface.functions.some((entry) => entry.name === name))) {
            return yield* Effect.fail(new Error("expected browser control surface functions"));
          }

          const setCrop = surface.functions.find((entry) => entry.name === "setCrop")!;
          const setCaptureFps = surface.functions.find((entry) => entry.name === "setCaptureFps")!;
          const clearCrop = surface.functions.find((entry) => entry.name === "clearCrop")!;

          yield* setCrop.call(
            {
              callId: "call_set_crop",
              runId: "run_controls",
              scope: browserCaptureSetCropScope,
              payload: { x: 12, y: 24, width: 320, height: 180 }
            },
            { boardRevision: 0, board: { revision: 0, catalogVersion: "0.1.0", cells: {} } }
          );
          yield* setCaptureFps.call(
            {
              callId: "call_set_fps",
              runId: "run_controls",
              scope: browserCaptureSetCaptureFpsScope,
              payload: { captureFps: 15 }
            },
            { boardRevision: 0, board: { revision: 0, catalogVersion: "0.1.0", cells: {} } }
          );

          const frames = yield* source.frames.pipe(Stream.take(2), Stream.runCollect);
          yield* clearCrop.call(
            {
              callId: "call_clear_crop",
              runId: "run_controls",
              scope: browserCaptureClearCropScope,
              payload: undefined
            },
            { boardRevision: 0, board: { revision: 0, catalogVersion: "0.1.0", cells: {} } }
          );

          return {
            frames: Chunk.toReadonlyArray(frames)
          };
        })
      )
    );

    expect(screenshotCrops[0]).toEqual({ x: 12, y: 24 });
    expect(result.frames[1]?.cadence.expectedFps).toBe(15);
  });
});
