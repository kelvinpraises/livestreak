import type { BrowserCaptureCrop } from "#pipeline/capture/browser/page/types.js";
import type { BrowserCaptureCropSource } from "#pipeline/capture/browser/control/preview.js";

export interface BrowserCaptureControlConfig {
  readonly url: string;
  readonly captureFps: number;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly crop?: BrowserCaptureCrop;
  readonly encoding: "jpeg" | "png";
  readonly interactive?: boolean;
  readonly debug?: boolean;
  readonly maxFrames?: number;
  readonly selectedTargetId?: string;
  readonly cropSource?: BrowserCaptureCropSource;
  readonly lastPreviewRevision?: number;
}

export const browserCaptureControlConfigKeys = [
  "url",
  "captureFps",
  "viewport",
  "crop",
  "encoding",
  "interactive",
  "debug",
  "maxFrames",
  "selectedTargetId",
  "cropSource",
  "lastPreviewRevision"
] as const satisfies readonly (keyof BrowserCaptureControlConfig)[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isBrowserCaptureControlConfig = (
  value: unknown
): value is BrowserCaptureControlConfig => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.url !== "string") {
    return false;
  }

  if (typeof value.captureFps !== "number" || !Number.isFinite(value.captureFps)) {
    return false;
  }

  if (!isRecord(value.viewport)) {
    return false;
  }

  if (
    typeof value.viewport.width !== "number" ||
    typeof value.viewport.height !== "number"
  ) {
    return false;
  }

  if (value.encoding !== "jpeg" && value.encoding !== "png") {
    return false;
  }

  return true;
};
