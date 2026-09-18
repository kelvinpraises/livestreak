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
import {
  createLiveSinkDriver,
  liveSinkDescriptor,
  type LiveSinkConfig,
  type LiveSinkDriverOptions
} from "./pipeline/publish/sinks/live/driver.js";
import {
  createDirectSinkDriver,
  directSinkDescriptor,
  type DirectSinkConfig,
  type DirectSinkDriverOptions
} from "./pipeline/publish/sinks/direct/driver.js";
import type { SinkDriver } from "./pipeline/publish/types.js";

export type BuiltInCaptureDriverId = "file";
export type BuiltInSinkDriverId = "file" | "live" | "direct";

export const builtInObserveRegistry = createObserveRegistry({
  capture: {
    drivers: [{ descriptor: fileCaptureDescriptor }, { descriptor: browserCaptureDescriptor }]
  },
  publish: {
    sinks: [
      { descriptor: fileSinkDescriptor },
      { descriptor: liveSinkDescriptor },
      { descriptor: directSinkDescriptor }
    ]
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
  options: FileSinkDriverOptions & LiveSinkDriverOptions & DirectSinkDriverOptions = {}
): SinkDriver<FileSinkConfig> | SinkDriver<LiveSinkConfig> | SinkDriver<DirectSinkConfig> => {
  if (id === "file") {
    return createFileSinkDriver(options);
  }

  if (id === "live") {
    return createLiveSinkDriver(options);
  }

  if (id === "direct") {
    return createDirectSinkDriver(options);
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
