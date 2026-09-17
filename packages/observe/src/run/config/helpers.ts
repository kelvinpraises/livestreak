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

  process: null
});

/**
 * A neutral run-config SHELL that carries no capture/sink identity. It exists only to give a run a valid
 * store identity at construction (`makeObserveRun` → `createInitialBoard` needs a runId; the board is
 * pristine and ignores capture/sink), before the operator has configured anything. The real capture and
 * live/file sink are derived from the CONFIGURED board later (`runConfigFromBoard`), so this shell must
 * never masquerade as a concrete lane: no `file`/`file-export` driver, no paths, no instanceId. Using a
 * fabricated file-export lane here surfaced as phantom `file-export` cruft on the remote console.
 */
export const shellRunConfig = (runId: string): ObserveRunConfig => ({
  runId,
  capture: { driverId: "shell", config: {} },
  sink: { driverId: "shell", config: {} },
  process: null
});
