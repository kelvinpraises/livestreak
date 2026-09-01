import { LiveStreakConfigError } from "@livestreak/core";
import { createObserveRegistry } from "./pipeline/registry.js";
import {
  createFileCaptureDriver,
  fileCaptureDescriptor,
  type FileCaptureConfig,
  type FileCaptureDriverOptions
} from "./pipeline/capture/file/driver.js";
import { browserCaptureDescriptor } from "./pipeline/capture/browser/driver.js";
import type { CaptureDriver } from "./pipeline/capture/types.js";
import {
  createFileSinkDriver,
  fileSinkDescriptor,
  type FileSinkConfig,
  type FileSinkDriverOptions
} from "./pipeline/publish/sinks/file/driver.js";
import type { SinkDriver } from "./pipeline/publish/types.js";

export type BuiltInCaptureDriverId = "file";
export type BuiltInSinkDriverId = "file";

export const builtInObserveRegistry = createObserveRegistry({
  capture: {
    drivers: [{ descriptor: fileCaptureDescriptor }, { descriptor: browserCaptureDescriptor }]
  },
  publish: {
    sinks: [{ descriptor: fileSinkDescriptor }]
  }
});

export const getBuiltInCaptureDriver = (
  id: BuiltInCaptureDriverId,
  options: FileCaptureDriverOptions = {}
): CaptureDriver<FileCaptureConfig> => {
  if (id === "file") {
    return createFileCaptureDriver(options);
  }

  return missingCaptureDriver(id);
};

export const getBuiltInSinkDriver = (
  id: BuiltInSinkDriverId,
  options: FileSinkDriverOptions = {}
): SinkDriver<FileSinkConfig> => {
  if (id === "file") {
    return createFileSinkDriver(options);
  }

  return missingSinkDriver(id);
};

// --- helpers ---

const missingCaptureDriver = (id: string): never => {
  throw new LiveStreakConfigError({
    message: `Unknown built-in capture driver: ${id}`
  });
};

const missingSinkDriver = (id: string): never => {
  throw new LiveStreakConfigError({
    message: `Unknown built-in sink driver: ${id}`
  });
};
