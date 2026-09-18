import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import { createHostFmp4IngestTransport } from "#pipeline/publish/sinks/live/transport.js";
import type { Board } from "./control/board/index.js";
import type { ObserveRunConfig } from "./run.js";

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
 * and the encode-once fMP4 `live` sink whose ingest transport is keyed to the registered marketId (the id
 * the viewer consumes under, over the host `/live/watch/:streamId` endpoint). Going live means streaming to
 * viewers, so the board's live publish selector (`publish === "live"`, the go-live path) maps to the
 * `live` sink here — the file-export recording sink is a separate, non-live concern. Fails with an
 * operator-facing message when a prerequisite is missing. Kept Node-free on purpose: observe's barrel is
 * bundled into the browser (consumer) app too — `createHostFmp4IngestTransport` only builds the transport
 * object (its `ws` import is lazy/Node-only, evaluated when a fragment is first sent).
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
    if (publish !== "live" && publish !== "direct") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message:
            "Going live streams to viewers — set the publish sink to 'live' (host fan-out) or 'direct' (broadcaster-served)."
        })
      );
    }

    const marketId = cellRecord(board, "market").readonly.marketId;
    if (typeof marketId !== "string" || marketId.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "Register a market before going live." })
      );
    }

    // Decode straight to I420 at real time (`-re`) so frames feed the fMP4 encode with no color conversion
    // and stream paced at wall-clock FPS (see the live/direct sinks + file capture).
    const capture = {
      driverId: "file",
      config: { path: capturePath, pixelFormat: "yuv420p", realtime: true }
    };

    if (publish === "direct") {
      // Broadcaster-served fan-out: the sink opens its own viewer door (UPnP + host echo eligibility);
      // the host does signaling only. Operator knobs come from the sink:direct cell.
      const settings = cellRecord(board, "sink:direct").settings;
      return {
        runId,
        capture,
        sink: {
          driverId: "direct",
          instanceId: "direct",
          config: {
            streamId: marketId,
            hostBaseUrl,
            ...(typeof settings.port === "number" ? { port: settings.port } : {}),
            ...(typeof settings.maxViewers === "number" ? { maxViewers: settings.maxViewers } : {}),
            ...(settings.reachability === "lan" ? { reachability: "lan" as const } : {})
          }
        },
        process: null
      };
    }

    return {
      runId,
      capture,
      sink: {
        driverId: "live",
        instanceId: "live",
        // Encode-once fMP4 fan-out keyed to the registered market (the id the viewer consumes under, over
        // the host `/live/watch/:streamId` endpoint).
        config: {
          streamId: marketId,
          transport: createHostFmp4IngestTransport({ baseUrl: hostBaseUrl, streamId: marketId })
        }
      },
      process: null
    };
  });
