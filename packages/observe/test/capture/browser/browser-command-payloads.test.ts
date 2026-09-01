import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import type { CapabilityScope } from "#scope/scopes.js";
import {
  browserCaptureSetCaptureFpsScope,
  browserCaptureSetCropScope,
  browserCaptureSetTargetScope,
  createBrowserCaptureDriver
} from "#pipeline/capture/browser/index.js";
import {
  decodeSetCaptureFpsPayload,
  decodeSetCropPayload,
  decodeSetTargetPayload
} from "#pipeline/capture/browser/control/payloads.js";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";

const testBoard = createInitialBoard({
  runId: "run_bad_payload"
});

const expectConfigFailure = async (effect: Effect.Effect<unknown, unknown>): Promise<string> => {
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error("expected failure");
  }

  const rendered = exit.cause.toString();
  expect(rendered).toContain("LiveStreakConfigError");
  return rendered;
};

const runBrowserSurfaceFunction = (scope: CapabilityScope, payload: unknown) =>
  Effect.scoped(
    Effect.gen(function* () {
      const adapter = makeFakeBrowserCaptureAdapter({
        frameBytes: new Uint8Array([255, 216, 255, 217])
      });
      const driver = createBrowserCaptureDriver(adapter);
      const config = yield* driver.validate({
        url: "https://example.com/payload",
        captureFps: 30,
        maxFrames: 1
      });
      const source = yield* driver.create(config);
      if (source.control === undefined) {
        return yield* Effect.fail(new Error("expected browser control surface"));
      }

      const bus = yield* createControlBus({
        runId: "run_bad_payload",
        board: testBoard,
        catalog: buildControlCatalog(),
        surfaces: [source.control]
      });

      return yield* bus.callFunction({
        callId: "call_bad_payload",
        runId: "run_bad_payload",
        scope,
        payload
      });
    })
  );

describe("browser command payload decoders", () => {
  it("decodeSetTargetPayload rejects missing fields", async () => {
    const absentPayload: unknown = void 0;
    const missingPayload = await expectConfigFailure(decodeSetTargetPayload(absentPayload));
    expect(missingPayload).toContain("setTarget payload is required");

    const missingRevision = await expectConfigFailure(
      decodeSetTargetPayload({ targetId: "video:0" })
    );
    expect(missingRevision).toContain("previewRevision");
  });

  it("decodeSetCropPayload rejects malformed crop", async () => {
    const malformed = await expectConfigFailure(decodeSetCropPayload({ x: 1, y: 2 }));
    expect(malformed).toContain("width");

    const wrapped = await expectConfigFailure(
      decodeSetCropPayload({ crop: { x: 0, y: 0, width: 10, height: 10 } })
    );
    expect(wrapped).toContain("previewRevision");
  });

  it("decodeSetCaptureFpsPayload rejects malformed values", async () => {
    const absentPayload: unknown = void 0;
    const missing = await expectConfigFailure(decodeSetCaptureFpsPayload(absentPayload));
    expect(missing).toContain("setCaptureFps payload is required");

    const objectMissingField = await expectConfigFailure(decodeSetCaptureFpsPayload({ fps: 30 }));
    expect(objectMissingField).toContain("captureFps");
  });
});

describe("browser surface payload failures", () => {
  it("malformed setTarget payload fails with LiveStreakConfigError", async () => {
    const rendered = await expectConfigFailure(
      runBrowserSurfaceFunction(browserCaptureSetTargetScope, {})
    );
    expect(rendered).toContain("setTarget");
  });

  it("malformed setCrop payload fails with LiveStreakConfigError", async () => {
    const rendered = await expectConfigFailure(runBrowserSurfaceFunction(browserCaptureSetCropScope, {}));
    expect(rendered).toContain("crop payload");
  });

  it("malformed setCaptureFps payload fails with LiveStreakConfigError", async () => {
    const rendered = await expectConfigFailure(
      runBrowserSurfaceFunction(browserCaptureSetCaptureFpsScope, { fps: 30 })
    );
    expect(rendered).toContain("setCaptureFps");
  });
});
