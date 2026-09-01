import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";
import { browserCaptureFunctionNames, browserCaptureSurfaceCellId } from "./control/surface.js";
import type { BrowserCaptureConfig } from "./config.js";

export const describeBrowserCaptureCell = (
  config: BrowserCaptureConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();

  return {
    id: browserCaptureSurfaceCellId,
    cell: {
      label: "Browser Capture",
      catalog: browserCaptureSurfaceCellId,
      // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
      status: ["idle", null, nowMs],
      settings: {
        url: config.url,
        captureFps: config.captureFps,
        viewport: config.viewport,
        crop: config.crop,
        encoding: config.encoding,
        interactive: config.interactive,
        debug: config.debug,
        maxPumpMs: 4,
        ...(config.maxFrames === undefined ? {} : { maxFrames: config.maxFrames })
      },
      readonly: {
        sourceType: "browser",
        sourceMode: "live"
      },
      functions: [...browserCaptureFunctionNames]
    }
  };
};
