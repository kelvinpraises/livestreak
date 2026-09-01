import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { BrowserCaptureTarget } from "#pipeline/capture/browser/control/preview.js";

export type BrowserCaptureImageEncoding = "jpeg" | "png";

export interface BrowserCaptureViewport {
  readonly width: number;
  readonly height: number;
}

export interface BrowserCaptureCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserCaptureOpenOptions {
  readonly url: string;
  readonly viewport: BrowserCaptureViewport;
  readonly interactive?: boolean;
  readonly debug?: boolean;
}

export interface BrowserCaptureScreenshotOptions {
  readonly crop?: BrowserCaptureCrop;
  readonly encoding: BrowserCaptureImageEncoding;
}

export interface BrowserCaptureScreenshot {
  readonly data: Uint8Array;
  readonly encoding?: BrowserCaptureImageEncoding;
}

export interface BrowserCapturePage {
  readonly screenshot: (
    options: BrowserCaptureScreenshotOptions
  ) => Effect.Effect<BrowserCaptureScreenshot, LiveStreakError>;
  readonly inspectTargets?: () => Effect.Effect<readonly BrowserCaptureTarget[], LiveStreakError>;
  readonly close: Effect.Effect<void, LiveStreakError>;
}

export interface BrowserCaptureAdapter {
  readonly openPage: (
    options: BrowserCaptureOpenOptions
  ) => Effect.Effect<BrowserCapturePage, LiveStreakError>;
}

export const missingBrowserCaptureAdapter: BrowserCaptureAdapter = {
  openPage: () =>
    Effect.fail(
      new LiveStreakRuntimeError({
        message: "Browser capture requires an injected browser capture adapter",
        metadata: {
          details:
            "Provide a BrowserCaptureAdapter backed by Playwright, Puppeteer, or a host browser bridge."
        }
      })
    )
};
