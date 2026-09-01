import type { LiveStreakConfigError } from "@livestreak/core";
import { Effect } from "effect";
import { createInitialBoard, type Board } from "./control/board/model.js";
import { createPassthroughVideoManifest, type PublishManifest } from "./worker/state.js";
import type { ControlBus } from "./control/bus/types.js";
import { validateObserveRunConfig, type ObserveRunConfig } from "./config/index.js";

export type {
  ObserveRunConfig,
  ObserveRunProcessConfig,
  ObserveRunSinkConfig,
  ObserveRunStageConfig,
  BrowserCaptureConfig,
  BrowserCaptureCrop,
  BrowserCaptureImageEncoding,
  BrowserCaptureViewport
} from "./config/index.js";

export {
  validateObserveRunConfig,
  browserCaptureRunConfig,
  fileCaptureRunConfig
} from "./config/index.js";

export interface ObserveRun {
  readonly config: ObserveRunConfig;
  readonly board: Board;
  readonly bus?: ControlBus;
  readonly manifest: PublishManifest;
  readonly prepared: boolean;
}

export const makeObserveRun = (
  config: unknown
): Effect.Effect<ObserveRun, LiveStreakConfigError> =>
  Effect.map(validateObserveRunConfig(config), createObserveRunFromConfig);

const createObserveRunFromConfig = (validated: ObserveRunConfig): ObserveRun => ({
  config: validated,
  board: createInitialBoard({
    runId: validated.runId
  }),
  manifest: createPassthroughVideoManifest(),
  prepared: false
});
