import { Effect } from "effect";
import type { CaptureDriver } from "#pipeline/capture/types.js";
import type { BrowserCaptureAdapter } from "./page/types.js";
import { missingBrowserCaptureAdapter } from "./page/types.js";
import { browserCaptureDescriptor } from "./descriptor.js";
import { validateBrowserCaptureConfig, type BrowserCaptureConfig } from "./config.js";
import { describeBrowserCaptureCell } from "./cell.js";
import { createBrowserCaptureFrameSource } from "./source.js";

export type { BrowserCaptureConfig } from "./config.js";

export const createBrowserCaptureDriver = (
  adapter: BrowserCaptureAdapter = missingBrowserCaptureAdapter
): CaptureDriver<BrowserCaptureConfig> => ({
  descriptor: browserCaptureDescriptor,
  validate: validateBrowserCaptureConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeBrowserCaptureCell(config, context)),
  create: (config) => createBrowserCaptureFrameSource(config, adapter)
});

export { browserCaptureDescriptor } from "./descriptor.js";

export {
  validateBrowserCaptureConfig,
  validateCaptureFps,
  validateCrop,
  validateEncoding,
  validateViewport
} from "./config.js";

export {
  browserCaptureSetCaptureFpsScope,
  browserCaptureSetCropScope,
  browserCaptureClearCropScope,
  type BrowserCaptureControls,
  type BrowserCaptureRuntimeConfigSnapshot,
  type BrowserCaptureSetCaptureFpsPayload,
  type BrowserCaptureSetCropPayload
} from "./control/controls.js";

export {
  browserCaptureGetPreviewScope,
  browserCaptureInspectTargetsScope,
  browserCaptureSetTargetScope,
  browserPreviewTargetsArtifactKind,
  type BrowserCapturePreview,
  type BrowserCaptureSetTargetPayload,
  type BrowserCaptureTarget,
  type BrowserCaptureTargetInspection,
  type BrowserPreviewTargetsArtifactPayload
} from "./control/preview.js";

export type {
  BrowserCaptureAdapter,
  BrowserCaptureCrop,
  BrowserCaptureImageEncoding,
  BrowserCaptureOpenOptions,
  BrowserCapturePage,
  BrowserCaptureScreenshot,
  BrowserCaptureScreenshotOptions,
  BrowserCaptureViewport
} from "./page/types.js";

export {
  makeBrowserPageCaptureAdapter,
  makeBrowserPageFactoryCaptureAdapter,
  validateBrowserCapturePageReadiness,
  type BrowserCaptureBridgeError,
  type BrowserCapturePageReadiness,
  type BrowserCaptureReadinessError,
  type BrowserPageCaptureAdapterKind,
  type BrowserPageCaptureAdapterOptions,
  type BrowserPageCaptureFactory,
  type ResolvedBrowserPageCaptureAdapterKind
} from "./page/adapter.js";
