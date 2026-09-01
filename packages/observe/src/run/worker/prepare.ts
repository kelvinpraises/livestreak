import { Effect } from "effect";
import { LiveStreakRuntimeError } from "@livestreak/core";
import type { WorkerControlView } from "#run/control/board/index.js";
import { resolveManifestSourceTrackId, type WorkerState } from "./state.js";

export const validateWorkerPrepare = (
  state: WorkerState,
  view: WorkerControlView
): Effect.Effect<void, LiveStreakRuntimeError> => {
  return Effect.gen(function* () {
    for (const sinkPolicy of view.sinks) {
      const sinkState = state.sinks[sinkPolicy.sinkId];
      if (sinkState === undefined) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message: `Worker prepare failed: unknown sink ${sinkPolicy.sinkId}`
          })
        );
      }

      for (const publishTrackId of sinkPolicy.subscribe) {
        const sourceTrackId = resolveManifestSourceTrackId(state.manifest, publishTrackId);
        if (sourceTrackId === undefined) {
          return yield* Effect.fail(
            new LiveStreakRuntimeError({
              message: `Worker prepare failed: sink ${sinkPolicy.sinkId} subscribed to unknown manifest track ${publishTrackId}`
            })
          );
        }

        const sourceTrack = state.tracks[sourceTrackId];
        if (sourceTrack === undefined) {
          return yield* Effect.fail(
            new LiveStreakRuntimeError({
              message: `Worker prepare failed: manifest source track ${sourceTrackId} is not present in worker state`
            })
          );
        }
      }
    }
  });
};
