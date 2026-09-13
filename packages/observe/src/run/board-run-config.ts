import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import { createHostMediatedSinkSignaling } from "#pipeline/publish/sinks/local/host-signaling.js";
import type { Board } from "./control/board/index.js";
import type { ObserveRunConfig } from "./run.js";

// A live producer streams continuously and waits for a viewer to join: the WebRTC answer arrives whenever a
// viewer opens the stream page (seconds to minutes after go-live), not within a tight window of `start`. Keep
// the answer-wait generous so that handshake completes regardless of when the viewer shows up; the answer
// fiber is background/forked and interrupted when the run stops.
const liveViewerAnswerTimeoutMs = 10 * 60_000;

// Read a board cell's settings/readonly maps with safe defaults — the only place that knows the board's
// cell-id / field-path schema for deriving a run config.
const cellRecord = (
  board: Board,
  cellId: string
): { settings: Record<string, unknown>; readonly: Record<string, unknown> } => {
  const cell = (board.cells as Record<string, { settings?: unknown; readonly?: unknown }>)[cellId];
  return {
    settings: (cell?.settings as Record<string, unknown>) ?? {},
    readonly: (cell?.readonly as Record<string, unknown>) ?? {}
  };
};

export interface RunConfigFromBoardInput {
  readonly runId: string;
  readonly board: Board;
  /** Host relay base URL for the local WebRTC sink's signaling channel (the gateway's deployment value). */
  readonly hostBaseUrl: string;
}

/**
 * Derive the LIVE run config from the console-configured board: capture path from the `capture:file` cell,
 * a local WebRTC sink whose signaling is keyed to the registered marketId (the id the viewer consumes
 * under). Going live streams to the local sink, so `publish` must be "local" — the file-export recording
 * sink is a separate, non-live concern. Fails with an operator-facing message when a prerequisite is
 * missing. Kept Node-free on purpose: observe's barrel is bundled into the browser (consumer) app too.
 */
export const runConfigFromBoard = (
  input: RunConfigFromBoardInput
): Effect.Effect<ObserveRunConfig, LiveStreakError> =>
  Effect.gen(function* () {
    const { runId, board, hostBaseUrl } = input;

    const capturePath = cellRecord(board, "capture:file").settings.path;
    if (typeof capturePath !== "string" || capturePath.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Set the capture media file (capture:file → configure) before going live."
        })
      );
    }

    const publish = cellRecord(board, "system:config").readonly.publish;
    if (publish !== "local") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Going live streams to the local WebRTC sink — set the publish sink to 'local'."
        })
      );
    }

    const marketId = cellRecord(board, "market").readonly.marketId;
    if (typeof marketId !== "string" || marketId.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "Register a market before going live." })
      );
    }

    return {
      runId,
      // Decode straight to I420 at real time (`-re`) so frames feed the local sink's WebRTC video track with
      // no color conversion and stream paced at wall-clock FPS (see the local sink + file capture).
      capture: {
        driverId: "file",
        config: { path: capturePath, pixelFormat: "yuv420p", realtime: true }
      },
      sink: {
        driverId: "local",
        instanceId: "local",
        // Real-time media-track preview keyed to the registered market (the id the viewer consumes under).
        config: {
          streamId: marketId,
          answerTimeoutMs: liveViewerAnswerTimeoutMs,
          signaling: createHostMediatedSinkSignaling({
            baseUrl: hostBaseUrl,
            streamId: marketId,
            answerTimeoutMs: liveViewerAnswerTimeoutMs
          })
        }
      },
      process: null
    };
  });
