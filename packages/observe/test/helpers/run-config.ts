import type { ObserveRunConfig } from "#run/config/types.js";
import type { BrowserCaptureConfig } from "#pipeline/capture/browser/index.js";

export { browserCaptureRunConfig, fileCaptureRunConfig } from "#run/config/index.js";

const defaultSyntheticCaptureConfig = {
  frameCount: 8,
  width: 16,
  height: 16,
  fps: 30
} as const;

export const syntheticCaptureRunConfig = (
  runId: string,
  sinkPath: string,
  captureConfig: Record<string, unknown> = defaultSyntheticCaptureConfig
): ObserveRunConfig => ({
  runId,
  capture: {
    driverId: "synthetic",
    config: captureConfig
  },
  sink: {
    driverId: "memory",
    config: { path: sinkPath }
  },
   
  process: null
});

export const defaultBrowserCaptureConfig = (
  overrides: Partial<BrowserCaptureConfig> = {}
): BrowserCaptureConfig => ({
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 480 },
  ...overrides
});
