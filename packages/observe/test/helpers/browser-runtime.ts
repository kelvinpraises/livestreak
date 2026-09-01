import { Effect, Scope } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import {
  browserCaptureInspectTargetsScope,
  createBrowserCaptureDriver
} from "#index.js";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import type { Board } from "#run/control/board/index.js";
import type { ControlBus } from "#run/control/bus/index.js";
import type { ControlCallResult } from "#run/control/bus/index.js";
import type { RuntimeKernelOptions } from "#run/runtime.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";
import { createSyntheticKernelOptions } from "./runtime.js";

export interface BrowserHandleBusPreviewResult {
  readonly handleBus: ControlBus;
  readonly preview: ControlCallResult;
  readonly artifactId: string;
}

export const createBrowserRuntimeKernelOptions = (
  maxFrames = 64
): { readonly options: RuntimeKernelOptions } => {
  const adapter = makeFakeBrowserCaptureAdapter({
    frameBytes: new Uint8Array([255, 216, 255, 217]),
    targets: []
  });
  const driver = createBrowserCaptureDriver(adapter);
  const { options: base } = createSyntheticKernelOptions(maxFrames);

  return {
    options: {
      ...base,
      captureDriver: driver,
      maxTurns: maxFrames * 64
    }
  };
};

export const waitForBrowserPreviewCall = (
  call: () => ReturnType<
    import("#run/runtime.js").ObserveRuntime["callFunction"]
  >
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const exit = yield* Effect.exit(call());
      if (exit._tag === "Success" && exit.value.artifactId !== undefined) {
        return exit.value;
      }

      yield* Effect.yieldNow();
    }

    return yield* Effect.fail(new Error("browser preview call did not produce an artifact"));
  });

export const createBrowserPreviewHandleBus = (input: {
  readonly runId: string;
  readonly board: Board;
  readonly url: string;
}): Effect.Effect<BrowserHandleBusPreviewResult, Error | LiveStreakError, Scope.Scope> =>
  Effect.gen(function* () {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([255, 216, 255, 217]),
      targets: []
    });
    const driver = createBrowserCaptureDriver(adapter);
    const captureConfig = yield* driver.validate({
      url: input.url,
      captureFps: 30,
      viewport: { width: 640, height: 480 },
      maxFrames: 1
    });
    const source = yield* driver.create(captureConfig);
    if (source.control === undefined) {
      return yield* Effect.fail(new Error("expected browser control surface"));
    }

    const handleBus = yield* createControlBus({
      runId: input.runId,
      board: input.board,
      catalog: buildControlCatalog(),
      surfaces: [source.control]
    });

    const preview = yield* handleBus.callFunction({
      callId: "call_handle_bus_preview",
      runId: input.runId,
      scope: browserCaptureInspectTargetsScope
    });

    const artifactId = preview.artifactId;
    if (artifactId === undefined) {
      return yield* Effect.fail(new Error("expected artifact id"));
    }

    return { handleBus, preview, artifactId };
  });
