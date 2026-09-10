import type { PackageRuntimeInit } from "@livestreak/schema";
import { createFileCaptureControlSurface } from "./drivers/file-capture.js";
import { createFileSinkControlSurface } from "./drivers/file-sink.js";
import { createLocalSinkControlSurface } from "./drivers/local-sink.js";
import { createMarketControlSurface, type MarketControlDeps } from "#market/control.js";
import { createSystemConfigSurface } from "./system/config.js";
import { createSystemPauseSurface } from "./system/pause.js";
import { createSystemRunSurface, type SystemRunHooks } from "./system/run.js";
import type { ControlSurface } from "./bus/types.js";

export interface CreateObserveControlSurfacesInput {
  readonly sessionInit?: PackageRuntimeInit;
  readonly runHooks?: SystemRunHooks;
  readonly market?: MarketControlDeps;
}

export const createObserveControlSurfaces = (
  input: CreateObserveControlSurfacesInput = {}
): readonly ControlSurface[] => [
  createSystemConfigSurface(),
  createSystemRunSurface(input.runHooks ?? {}),
  createSystemPauseSurface(),
  createMarketControlSurface({
    sessionInit: input.sessionInit,
    ...input.market
  }),
  createFileCaptureControlSurface(),
  createFileSinkControlSurface("file-export"),
  createLocalSinkControlSurface()
];
