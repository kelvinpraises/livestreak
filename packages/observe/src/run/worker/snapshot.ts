import type { CaptureDriverDescriptor, CaptureStageHealth } from "#pipeline/capture/index.js";
import type { SinkFinalizeResult } from "#pipeline/publish/index.js";
import type { WorkerState } from "./state.js";

export interface WorkerSnapshotSink {
  readonly deliveredItems: number;
  readonly finalized: boolean;
  readonly finalizeResult?: SinkFinalizeResult;
}

export interface WorkerSnapshotCapture {
  readonly descriptorId: string;
  readonly sourceType: CaptureDriverDescriptor["sourceType"];
  readonly exhausted: boolean;
  readonly eosAppended: boolean;
  readonly health?: CaptureStageHealth;
}

export interface WorkerSnapshot {
  readonly runId: string;
  readonly lifecycle: WorkerState["lifecycle"];
  readonly controlRevision: number;
  readonly trackDepths: Record<string, number>;
  readonly capture?: WorkerSnapshotCapture;
  readonly sinks: Record<string, WorkerSnapshotSink>;
  readonly error?: string;
}

export const projectWorkerSnapshot = (state: WorkerState): WorkerSnapshot => {
  const trackDepths: Record<string, number> = {};

  for (const [trackId, track] of Object.entries(state.tracks)) {
    trackDepths[trackId] = track.items.length;
  }

  const sinks: WorkerSnapshot["sinks"] = {};
  for (const [sinkId, sinkState] of Object.entries(state.sinks)) {
    sinks[sinkId] = {
      deliveredItems: sinkState.deliveredItems,
      finalized: sinkState.finalized,
      finalizeResult: sinkState.finalizeResult
    };
  }

  let capture: WorkerSnapshotCapture | undefined;
  if (state.capture !== undefined) {
    capture = {
      descriptorId: state.capture.descriptor.id,
      sourceType: state.capture.descriptor.sourceType,
      exhausted: state.capture.exhausted,
      eosAppended: state.capture.eosAppended,
      health: state.capture.health
    };
  }

  return {
    runId: state.runId,
    lifecycle: state.lifecycle,
    controlRevision: state.lastAppliedControlRevision,
    trackDepths,
    capture,
    sinks,
    error: state.error
  };
};
