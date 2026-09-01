/**
 * Compile-only guard: public extension-contract types import from the package root.
 * No runtime assertions — `npm run check` validates these imports.
 */
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
  controlFunctionView: {} as ControlFunctionView
};

const assertSnapshotWhenNotInterrupted = (result: ObserveRunResult): void => {
  if (result.outcome !== "interrupted") {
    void result.snapshot?.lifecycle;
  }
};

export const observeRunOutcomeContracts = {
  assertSnapshotWhenNotInterrupted
};
