import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  browserCaptureClearCropScope,
  browserCaptureGetPreviewScope,
  browserCaptureInspectTargetsScope,
  browserCaptureSetTargetScope,
  browserPreviewTargetsArtifactKind,
  createBrowserCaptureDriver,
} from "#pipeline/capture/browser/index.js";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";

const sampleTarget = {
  id: "video:0",
  number: 1,
  kind: "video" as const,
  label: "Main video",
  rect: { x: 0, y: 84, width: 640, height: 360 }
};

const testBoard = (runId: string) =>
  createBrowserBoardFixture(runId, {
    url: "https://example.com/preview",
    captureFps: 30,
    viewport: { width: 640, height: 480 },
    encoding: "jpeg"
  });

const runBusFunction = (
  scope: string,
  options: {
    readonly frameBytes: Uint8Array;
    readonly targets?: readonly (typeof sampleTarget)[];
    readonly payload?: unknown;
    readonly runId?: string;
    readonly callId?: string;
  }
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const adapter = makeFakeBrowserCaptureAdapter({
        frameBytes: options.frameBytes,
        targets: options.targets
      });
      const driver = createBrowserCaptureDriver(adapter);
      const config = yield* driver.validate({
        url: "https://example.com/preview",
        captureFps: 30,
        viewport: { width: 640, height: 480 },
        maxFrames: 1
      });
      const source = yield* driver.create(config);
      if (source.control === undefined) {
        return yield* Effect.fail(new Error("expected browser control surface"));
      }

      const runId = options.runId ?? "run_test";
      const bus = yield* createControlBus({
        runId,
        board: testBoard(runId),
        catalog: buildControlCatalog(),
        surfaces: [source.control]
      });

      return yield* bus.callFunction({
        callId: options.callId ?? "call_test",
        runId,
        scope,
        payload: options.payload
      });
    })
  );

describe("browser surface via control bus", () => {
  it("returns preview artifacts without changing board revision", async () => {
    const result = await Effect.runPromise(
      runBusFunction(browserCaptureInspectTargetsScope, {
        frameBytes: new Uint8Array([255, 216, 255, 217]),
        targets: [sampleTarget],
        runId: "run_preview",
        callId: "call_preview"
      })
    );

    expect(result.changed).toBe(false);
    expect(result.boardRevision).toBe(1);
    expect(result.boardPatch).toBeUndefined();
    expect(result.artifact?.kind).toBe(browserPreviewTargetsArtifactKind);
    expect(result.artifact?.id).toMatch(/^art_[0-9a-f-]{36}$/i);
    expect(result.artifact?.payload).toMatchObject({
      preview: {
        revision: 1,
        width: 640,
        height: 480,
        mime: "image/jpeg"
      },
      targets: [sampleTarget]
    });
    expect(JSON.stringify(result.artifact?.payload)).toContain("data:image/jpeg;base64,");
  });

  it("returns boardPatch for setTarget and bumps revision", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([255, 216, 255, 217]),
            targets: [sampleTarget]
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/target",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_target",
            board: testBoard("run_target"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_preview_target",
            runId: "run_target",
            scope: browserCaptureInspectTargetsScope
          });

          return yield* bus.callFunction({
            callId: "call_target",
            runId: "run_target",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:0",
              previewRevision: 1
            }
          });
        })
      )
    );

    expect(result.changed).toBe(true);
    expect(result.boardRevision).toBe(2);
    expect(result.artifact).toBeUndefined();
    expect(result.boardPatch).toEqual({
      cells: {
        "capture:browser": {
          settings: {
            set: {
              crop: sampleTarget.rect,
              selectedTargetId: "video:0",
              cropSource: "target",
              lastPreviewRevision: 1
            }
          }
        }
      }
    });
  });

  it("clearCrop emits an unset-only patch", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([1, 2, 3]),
            targets: [sampleTarget]
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/clear",
            captureFps: 30,
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_clear",
            board: testBoard("run_clear"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_preview_clear",
            runId: "run_clear",
            scope: browserCaptureInspectTargetsScope
          });

          yield* bus.callFunction({
            callId: "call_target_clear",
            runId: "run_clear",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:0",
              previewRevision: 1
            }
          });

          return yield* bus.callFunction({
            callId: "call_clear",
            runId: "run_clear",
            scope: browserCaptureClearCropScope
          });
        })
      )
    );

    expect(result.boardPatch).toEqual({
      cells: {
        "capture:browser": {
          settings: {
            unset: ["crop", "selectedTargetId", "cropSource", "lastPreviewRevision"]
          }
        }
      }
    });
  });

  it("rejects stale previewRevision before mutation", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const adapter = makeFakeBrowserCaptureAdapter({
            frameBytes: new Uint8Array([1, 2, 3]),
            targets: [sampleTarget]
          });
          const driver = createBrowserCaptureDriver(adapter);
          const config = yield* driver.validate({
            url: "https://example.com/stale",
            captureFps: 30,
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_stale",
            board: testBoard("run_stale"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_preview_stale",
            runId: "run_stale",
            scope: browserCaptureInspectTargetsScope
          });

          return yield* bus.callFunction({
            callId: "call_stale",
            runId: "run_stale",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:0",
              previewRevision: 0
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("Browser capture preview revision is stale");
    }
  });

  it("getPreview uses the same artifact kind with empty targets", async () => {
    const result = await Effect.runPromise(
      runBusFunction(browserCaptureGetPreviewScope, {
        frameBytes: new Uint8Array([255, 216, 255, 217]),
        runId: "run_get_preview",
        callId: "call_get_preview"
      })
    );

    expect(result.artifact?.kind).toBe(browserPreviewTargetsArtifactKind);
    expect((result.artifact?.payload as { readonly targets: readonly unknown[] }).targets).toEqual([]);
  });
});

describe("browser preview controls", () => {
  it("keeps dataUri out of the durable snapshot", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([255, 216, 255, 217]),
      targets: [sampleTarget]
    });
    const driver = createBrowserCaptureDriver(adapter);

    const settings = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/snapshot",
            captureFps: 30,
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_snapshot",
            board: testBoard("run_snapshot"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_snapshot_preview",
            runId: "run_snapshot",
            scope: browserCaptureInspectTargetsScope
          });

          yield* bus.callFunction({
            callId: "call_snapshot_target",
            runId: "run_snapshot",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:0",
              previewRevision: 1
            }
          });

          const board = yield* bus.readBoard();
          return board.cells["capture:browser"]?.settings;
        })
      )
    );

    expect(settings?.selectedTargetId).toBe("video:0");
    expect(settings?.cropSource).toBe("target");
    expect(settings?.lastPreviewRevision).toBe(1);
    expect(JSON.stringify(settings)).not.toContain("data:");
    expect(JSON.stringify(settings)).not.toContain("dataUri");
  });

  it("still allows raw setCrop without previewRevision", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([1, 2, 3])
    });
    const driver = createBrowserCaptureDriver(adapter);

    const settings = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/manual-crop",
            captureFps: 30,
            viewport: { width: 640, height: 480 },
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_manual_crop",
            board: testBoard("run_manual_crop"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_manual_crop",
            runId: "run_manual_crop",
            scope: "capture:browser:setCrop",
            payload: { x: 4, y: 8, width: 320, height: 180 }
          });

          const board = yield* bus.readBoard();
          return board.cells["capture:browser"]?.settings;
        })
      )
    );

    expect(settings?.crop).toEqual({ x: 4, y: 8, width: 320, height: 180 });
    expect(settings?.cropSource).toBe("manual");
    expect(settings?.selectedTargetId).toBeUndefined();
  });

  it("rejects unknown target ids for the current preview revision", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([1, 2, 3]),
      targets: [sampleTarget]
    });
    const driver = createBrowserCaptureDriver(adapter);

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/missing-target",
            captureFps: 30,
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_missing_target",
            board: testBoard("run_missing_target"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_missing_preview",
            runId: "run_missing_target",
            scope: browserCaptureInspectTargetsScope
          });

          return yield* bus.callFunction({
            callId: "call_missing_target",
            runId: "run_missing_target",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:9",
              previewRevision: 1
            }
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "Browser capture target is not available for the current preview"
      );
    }
  });

  it("clearCrop clears crop, target selection, and cropSource", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([1, 2, 3]),
      targets: [sampleTarget]
    });
    const driver = createBrowserCaptureDriver(adapter);

    const settings = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/clear",
            captureFps: 30,
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          if (source.control === undefined) {
            return yield* Effect.fail(new Error("expected browser control surface"));
          }

          const bus = yield* createControlBus({
            runId: "run_clear_snapshot",
            board: testBoard("run_clear_snapshot"),
            catalog: buildControlCatalog(),
            surfaces: [source.control]
          });

          yield* bus.callFunction({
            callId: "call_clear_snapshot_preview",
            runId: "run_clear_snapshot",
            scope: browserCaptureInspectTargetsScope
          });

          yield* bus.callFunction({
            callId: "call_clear_snapshot_target",
            runId: "run_clear_snapshot",
            scope: browserCaptureSetTargetScope,
            payload: {
              targetId: "video:0",
              previewRevision: 1
            }
          });

          yield* bus.callFunction({
            callId: "call_clear_snapshot_clear",
            runId: "run_clear_snapshot",
            scope: browserCaptureClearCropScope
          });

          const board = yield* bus.readBoard();
          return board.cells["capture:browser"]?.settings;
        })
      )
    );

    expect(settings?.crop).toBeUndefined();
    expect(settings?.selectedTargetId).toBeUndefined();
    expect(settings?.cropSource).toBeUndefined();
    expect(settings?.lastPreviewRevision).toBeUndefined();
  });
});

describe("browser descriptor command metadata", () => {
  it("advertises resultKind and artifact output for inspectTargets", async () => {
    const { browserCaptureDescriptor } = await import("#pipeline/capture/browser/index.js");
    const command = browserCaptureDescriptor.commands.find(
      (entry) => entry.scope === browserCaptureInspectTargetsScope
    );

    expect(command?.resultKind).toBe("artifact");
    expect(command?.output?.type).toBe("object");
    expect(command?.output?.properties?.some((property) => property.name === "preview")).toBe(true);
    expect(command?.output?.properties?.some((property) => property.name === "targets")).toBe(true);
  });
});
