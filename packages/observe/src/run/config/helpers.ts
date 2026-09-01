import type { BrowserCaptureConfig } from "#pipeline/capture/browser/index.js";
import type { ObserveRunConfig } from "./types.js";

export type {
  BrowserCaptureConfig,
  BrowserCaptureCrop,
  BrowserCaptureImageEncoding,
  BrowserCaptureViewport
} from "#pipeline/capture/browser/index.js";

/** Typed helper for browser capture config without widening the whole run config. */
export const browserCaptureRunConfig = (
  runId: string,
  capture: BrowserCaptureConfig,
  sink: { readonly path: string; readonly instanceId?: string }
): ObserveRunConfig => ({
  runId,
  capture: {
    driverId: "browser",
    config: capture
  },
  sink: {
    driverId: "file",
    instanceId: sink.instanceId,
    config: { path: sink.path }
  },
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  process: null
});

export const fileCaptureRunConfig = (
  runId: string,
  capturePath: string,
  sinkPath: string,
  instanceId?: string
): ObserveRunConfig => ({
  runId,
  capture: {
    driverId: "file",
    config: { path: capturePath }
  },
  sink: {
    driverId: "file",
    instanceId,
    config: { path: sinkPath }
  },
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  process: null
});
