import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import {
  serializeUnknownError,
  type SerializedError
} from "@livestreak/core";
import {
  browserCaptureInspectTargetsScope,
  browserCaptureRunConfig,
  createObserveBridge,
  createObserveRuntime,
  fileCaptureRunConfig,
  systemPausePauseScope,
  systemPauseResumeScope,
  systemPauseSetPresentationScope,
  systemRunStopScope,
  type Board,
  type BridgeCaller,
  type ControlCallResult,
  type ControlsView,
  type ObserveRunConfig,
  type ObserveRunResult
} from "#index.js";
import {
  createBrowserRuntimeKernelOptions,
  waitForBrowserPreviewCall
} from "#test/helpers/browser-runtime.js";
import {
  makeTinyMp4Fixture,
  removeFixtureDirectory,
  skipUnlessFfmpegIntegration
} from "#test/helpers/ffmpeg.js";
import { waitForBoard } from "#test/helpers/fake-live-runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

const trustedCaller: BridgeCaller = { id: "trusted-cli", trusted: true };
const opaqueArtifactIdPattern = /^art_[0-9a-f-]{36}$/i;

describe("public edge contract", () => {
  describe("Scenario A — Browser control surface and artifact workflow", () => {
    it("uses public runtime and bridge APIs for browser control surfaces and artifacts", async () => {
      const { options } = createBrowserRuntimeKernelOptions(64);
      const runId = "run_edge_browser_cli";
      const outputPath = `/tmp/${runId}.mp4`;
      const config = makeBrowserEdgeRunConfig(runId, outputPath);

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            const bridge = createObserveBridge({ runtime });

            yield* runtime.prepareRun(config);
            yield* runtime.startRun(runId);

            const runtimeBoard = yield* runtime.readBoard(runId);
            const runtimePanel = yield* runtime.readPanel(runId, { includeCatalog: true });
            const bridgeControls = yield* bridge.readControls({ caller: trustedCaller, runId });

            expect(runtimeBoard.cells["system:run"]).toBeDefined();
            expect(runtimeBoard.cells["capture:browser"]).toBeDefined();
            expect(runtimePanel.board.cells["system:pause"]).toBeDefined();
            expect(bridgeControls.cells.some((cell) => cell.id === "capture:browser")).toBe(true);
            expect(bridgeControls.cells.some((cell) => cell.id === "system:pause")).toBe(true);
            expect(JSON.stringify(bridgeControls)).not.toMatch(/"tracks"|"lifecycle"|"pauseCycle"/);

            const boardEvents: number[] = [];
            const boardSubscription = yield* runtime.subscribeBoard(runId, (board) => {
              boardEvents.push(board.revision);
            });

            const preview = yield* waitForBrowserPreviewCall(() =>
              bridge.callFunction({
                caller: trustedCaller,
                envelope: {
                  callId: "call_edge_preview",
                  runId,
                  scope: browserCaptureInspectTargetsScope
                }
              })
            );

            expect(preview.artifactId).toMatch(opaqueArtifactIdPattern);
            expect(preview.artifact?.ownerCell).toBe("capture:browser");
            const previewDataUri = extractPreviewDataUri(preview);

            const artifact = yield* bridge.getArtifact({
              caller: trustedCaller,
              runId,
              artifactId: preview.artifactId!
            });
            expect(artifact).toEqual(preview.artifact);

            const boardAfterPreview = yield* runtime.readBoard(runId);
            const panelAfterPreview = yield* runtime.readPanel(runId, { includeCatalog: true });
            const controlsAfterPreview = yield* bridge.readControls({ caller: trustedCaller, runId });
            assertArtifactPayloadNotEmbeddedInReadModels({
              previewDataUri,
              board: boardAfterPreview,
              panel: panelAfterPreview,
              controls: controlsAfterPreview
            });

            yield* bridge.callFunction({
              caller: trustedCaller,
              envelope: {
                callId: "call_edge_pause",
                runId,
                scope: systemPausePauseScope
              }
            });

            const pausedBoard = yield* waitForBoard(
              () => runtime.readBoard(runId),
              (board) => board.cells["system:pause"]?.settings?.requested === true
            );
            expect(pausedBoard.cells["system:pause"]?.settings?.requested).toBe(true);

            yield* bridge.callFunction({
              caller: trustedCaller,
              envelope: {
                callId: "call_edge_resume",
                runId,
                scope: systemPauseResumeScope
              }
            });

            const resumedBoard = yield* waitForBoard(
              () => runtime.readBoard(runId),
              (board) => board.cells["system:pause"]?.settings?.requested === false
            );
            expect(resumedBoard.cells["system:pause"]?.settings?.requested).toBe(false);

            yield* bridge.callFunction({
              caller: trustedCaller,
              envelope: {
                callId: "call_edge_stop",
                runId,
                scope: systemRunStopScope,
                payload: { reason: "edge contract stop" }
              }
            });

            const result = yield* bridge.awaitRun({ caller: trustedCaller, runId });
            const finalBoard = yield* runtime.readBoard(runId);

            yield* boardSubscription.unsubscribe();

            return {
              preview,
              result,
              finalBoard,
              boardEvents
            };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.result.outcome).toBe("stopped");
        expect(exit.value.finalBoard.cells["system:run"]?.status[0]).toBe("stopped");
        expect(exit.value.boardEvents.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Scenario B — CLI file run path through public runtime APIs", () => {
    it("prepares, starts, and awaits a file passthrough run through public runtime APIs", async (context) => {
      await skipUnlessFfmpegIntegration(context);

      const fixture = await makeTinyMp4Fixture();
      const outputDirectory = await mkdtemp(path.join(tmpdir(), "livestreak-edge-output-"));
      const outputPath = path.join(outputDirectory, "edge-export.mp4");
      const runId = "run_edge_file_cli";

      let exit:
        | Exit.Exit<
            { result: ObserveRunResult; boardAfter: Board; outputPath: string },
            unknown
          >
        | undefined;

      try {
        exit = await runPublicFileEdgeScenario(runId, fixture.path, outputPath);
      } finally {
        await removeFixtureDirectory(fixture.directory);
        await removeFixtureDirectory(outputDirectory);
      }

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.result.outcome).toBe("stopped");
        expect(exit.value.result.outputUri).toBe(outputPath);
        expect(exit.value.boardAfter.cells["system:run"]?.status[0]).toBe("stopped");
      }
    });
  });

  describe("error serialization at the public edge", () => {
    it("serializes missing run, capability denial, bad payload, and missing artifact", async () => {
      const { options } = createSyntheticKernelOptions(4);
      const runId = "run_edge_errors";

      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
            const bridge = createObserveBridge({ runtime });
            yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, `/tmp/${runId}.mp4`));
            yield* runtime.startRun(runId);

            const missingRunExit = yield* Effect.exit(runtime.readBoard("run_edge_missing"));
            const missingRunSerialized = serializedFromExit(missingRunExit);
            expect(missingRunSerialized?.shortName).toBe("config");

            const missingBridgeRunExit = yield* Effect.exit(
              bridge.readBoard({ caller: trustedCaller, runId: "run_edge_missing_bridge" })
            );
            expect(serializedFromExit(missingBridgeRunExit)?.shortName).toBe("config");

            const deniedExit = yield* Effect.exit(
              bridge.callFunction({
                caller: { id: "reader", grants: [] },
                envelope: {
                  callId: "call_edge_denied",
                  runId,
                  scope: systemPauseSetPresentationScope,
                  payload: { whilePaused: "hold" }
                }
              })
            );
            const deniedSerialized = serializedFromExit(deniedExit);
            expect(deniedSerialized?.shortName).toBe("capability");
            if (deniedSerialized && "context" in deniedSerialized) {
              expect(deniedSerialized.context?.requiredScope).toBe(systemPauseSetPresentationScope);
            }

            const badPayloadExit = yield* Effect.exit(
              runtime.callFunction({
                callId: "call_edge_bad_payload",
                runId,
                scope: systemPauseSetPresentationScope,
                payload: { whilePaused: "slate" }
              })
            );
            expect(serializedFromExit(badPayloadExit)?.shortName).toBe("config");

            const missingArtifactExit = yield* Effect.exit(
              runtime.getArtifact(runId, "art_missing_edge")
            );
            expect(serializedFromExit(missingArtifactExit)?.shortName).toBe("config");

            return {
              missingRunSerialized,
              deniedSerialized
            };
          })
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.missingRunSerialized?.tag).toBe("LiveStreakConfigError");
        expect(exit.value.deniedSerialized?.tag).toBe("LiveStreakCapabilityError");
      }
    });

    it("uses serializeUnknownError for native errors at the edge", () => {
      const serialized = serializeUnknownError(new Error("edge failure"));
      expect(serialized).toMatchObject({
        tag: "UnknownError",
        shortName: "unknown",
        message: "edge failure"
      });
      expect(JSON.stringify(serialized)).not.toContain("stack");
    });
  });
});

// --- helpers ---

/** Uses browserCaptureRunConfig for public config shape, then injects a memory sink so the test focuses on browser control surfaces and artifacts rather than MP4 encoding. */
const makeBrowserEdgeRunConfig = (runId: string, outputPath: string): ObserveRunConfig => ({
  ...browserCaptureRunConfig(
    runId,
    {
      url: "https://example.com/live",
      captureFps: 30,
      viewport: { width: 640, height: 480 },
      encoding: "jpeg",
      maxFrames: 64
    },
    { path: outputPath }
  ),
  sink: {
    driverId: "memory",
    config: { path: outputPath }
  }
});

const extractPreviewDataUri = (preview: ControlCallResult): string | undefined => {
  const payload = preview.artifact?.payload;
  if (payload === undefined || payload === null || typeof payload !== "object" || !("preview" in payload)) {
    return undefined;
  }

  const dataUri = (payload as { preview?: { dataUri?: string } }).preview?.dataUri;
  return typeof dataUri === "string" ? dataUri : undefined;
};

/** Artifacts are fetched by id through getArtifact; read models must not embed artifact payloads. */
const assertArtifactPayloadNotEmbeddedInReadModels = (input: {
  readonly previewDataUri: string | undefined;
  readonly board: Board;
  readonly panel: { readonly board: Board };
  readonly controls: ControlsView;
}): void => {
  if (input.previewDataUri === undefined) {
    return;
  }

  const snapshots = [
    JSON.stringify(input.board),
    JSON.stringify(input.panel),
    JSON.stringify(input.controls)
  ];

  for (const json of snapshots) {
    expect(json).not.toContain(input.previewDataUri);
  }

  for (const cell of input.controls.cells) {
    for (const reference of Object.values(cell.refs)) {
      expect(typeof reference).toBe("string");
      expect(reference).not.toContain(input.previewDataUri);
    }
  }
};

const serializedFromExit = (exit: Exit.Exit<unknown, unknown>): SerializedError | undefined => {
  if (Exit.isFailure(exit) === false) {
    return undefined;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    return undefined;
  }

  return serializeUnknownError(failure.value);
};

const runPublicFileEdgeScenario = (
  runId: string,
  inputPath: string,
  outputPath: string
): Promise<
  Exit.Exit<
    {
      readonly result: ObserveRunResult;
      readonly boardAfter: Board;
      readonly outputPath: string;
    },
    unknown
  >
> =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* createObserveRuntime();
        const bridge = createObserveBridge({ runtime });
        const config = fileCaptureRunConfig(runId, inputPath, outputPath);

        expect(config.capture.driverId).toBe("file");
        // eslint-disable-next-line unicorn/no-null -- passthrough signal
        expect(config.process).toBe(null);
        expect(config.sink.driverId).toBe("file");
        expect(config.sink.instanceId).toBeUndefined();

        yield* runtime.prepareRun(config);
        yield* runtime.startRun(runId);

        const bridgeBoard = yield* bridge.readBoard({ caller: trustedCaller, runId });
        expect(bridgeBoard.cells["capture:file"]).toBeDefined();

        const result = yield* runtime.awaitRun(runId);
        const boardAfter = yield* runtime.readBoard(runId);

        return { result, boardAfter, outputPath };
      })
    )
  );
