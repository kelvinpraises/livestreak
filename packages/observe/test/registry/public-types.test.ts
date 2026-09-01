import { describe, expect, it } from "vitest";
import type {
  Board,
  CapabilityGrant,
  CaptureDriver,
  ControlCallEnvelope,
  ControlCellView,
  ControlFunctionView,
  ControlsView,
  ControlSurface,
  FrameSource,
  MarketLifecycleState,
  ObserveRunMarketConfig,
  ObserveRunResult,
  ProcessPack,
  SinkDriver
} from "#index.js";

export const publicTypeContracts = {
  board: {} as Board,
  grant: {} as CapabilityGrant,
  captureDriver: {} as CaptureDriver,
  envelope: {} as ControlCallEnvelope,
  surface: {} as ControlSurface,
  frameSource: {} as FrameSource,
  processPack: {} as ProcessPack,
  sinkDriver: {} as SinkDriver,
  controlsView: {} as ControlsView,
  controlCellView: {} as ControlCellView,
  controlFunctionView: {} as ControlFunctionView,
  marketLifecycle: {} as MarketLifecycleState,
  marketConfig: {} as ObserveRunMarketConfig
};

describe("public type contracts", () => {
  it("imports extension-contract types from the package root", () => {
    expect(publicTypeContracts.board).toBeDefined();
    expect(publicTypeContracts.marketLifecycle).toBeDefined();
  });
});
