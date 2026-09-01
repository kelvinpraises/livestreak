import { Effect } from "effect";
import type { BrowserCaptureTarget } from "#pipeline/capture/browser/control/preview.js";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureOpenOptions,
  BrowserCaptureScreenshotOptions
} from "#pipeline/capture/browser/page/types.js";

export const makeFakeBrowserCaptureAdapter = (options: {
  readonly frameBytes: Uint8Array;
  readonly encoding?: "jpeg" | "png";
  readonly latencyMs?: number;
  readonly targets?: readonly BrowserCaptureTarget[];
  readonly onOpen?: (options: BrowserCaptureOpenOptions) => void;
  readonly onScreenshot?: (options: BrowserCaptureScreenshotOptions) => void;
  readonly onClose?: () => void;
}): BrowserCaptureAdapter => ({
  openPage: (openOptions) =>
    Effect.sync(() => {
      options.onOpen?.(openOptions);

      return {
        screenshot: (screenshotOptions) =>
          Effect.gen(function* () {
            options.onScreenshot?.(screenshotOptions);
            if (options.latencyMs !== undefined) {
              yield* Effect.sleep(`${options.latencyMs} millis`);
            }

            return {
              data: options.frameBytes,
              encoding: options.encoding ?? screenshotOptions.encoding
            };
          }),
        ...(options.targets === undefined
          ? {}
          : {
              inspectTargets: () => Effect.succeed(options.targets ?? [])
            }),
        close: Effect.sync(() => {
          options.onClose?.();
        })
      };
    })
});
