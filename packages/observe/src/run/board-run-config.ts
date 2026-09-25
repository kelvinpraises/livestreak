import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import { createHostFmp4IngestTransport } from "#pipeline/publish/sinks/live/transport.js";
import { defaultSyntheticCaptureConfig } from "#pipeline/capture/synthetic/driver.js";
import type { Board } from "./control/board/index.js";
import type { ObserveRunConfig } from "./run.js";
import { observationCellId, readObservationIndex } from "./control/system/config.js";

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
  /** Which observation to derive. Absent = the session's only one; ambiguity fails closed. */
  readonly obsId?: string;
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

    const index = readObservationIndex(board);
    const obsId =
      input.obsId ?? (Object.keys(index).length === 1 ? Object.keys(index)[0] : undefined);
    if (obsId === undefined || index[obsId] === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message:
            Object.keys(index).length === 0
              ? "Add an observation before going live."
              : "Several observations exist — say which one to prepare (obsId)."
        })
      );
    }

    const captureCell = cellRecord(board, observationCellId(obsId, "capture"));
    // Authoritative capture gate (B4-R01): fresh mounts and post-switch cells carry
    // configured:false, so derivation refuses stale input in both directions until the
    // destination configure lands. This is the console path's choke point into prepare.
    if (captureCell.readonly.configured !== true) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Configure capture before going live."
        })
      );
    }
    const captureSettings = captureCell.settings;
    const syntheticSelected = captureSettings.source === "synthetic";
    const ingestSelected = captureSettings.source === "ingest";

    const publish = cellRecord(board, observationCellId(obsId, "publish")).readonly.kind;
    if (publish !== "live" && publish !== "direct") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message:
            "Going live streams to viewers — set the publish sink to 'live' (host fan-out) or 'direct' (broadcaster-served)."
        })
      );
    }

    const marketId = cellRecord(board, observationCellId(obsId, "market")).readonly.marketId;
    if (typeof marketId !== "string" || marketId.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "Register a market before going live." })
      );
    }

    // Decode straight to I420 at real time (`-re`) so frames feed the fMP4 encode with no color conversion
    // and stream paced at wall-clock FPS (see the live/direct sinks + file capture).
    // Supported generated-frame input for producer bots (C's example): the board selects it
    // with `source: "synthetic"` on the capture cell; dimensions/fps/continuity ride alongside.
    // The default is the continuous producer input; pass `continuous: false` for a bounded take.
    // Driver validation still rejects non-positive dimensions/fps downstream.
    let capture: { readonly driverId: string; readonly config: unknown };
    if (syntheticSelected) {
      capture = {
        driverId: "synthetic",
        config: {
          ...defaultSyntheticCaptureConfig,
          ...(typeof captureSettings.frameCount === "number" ? { frameCount: captureSettings.frameCount } : {}),
          ...(typeof captureSettings.width === "number" ? { width: captureSettings.width } : {}),
          ...(typeof captureSettings.height === "number" ? { height: captureSettings.height } : {}),
          ...(typeof captureSettings.fps === "number" ? { fps: captureSettings.fps } : {}),
          continuous:
            typeof captureSettings.continuous === "boolean" ? captureSettings.continuous : true
        }
      };
    } else if (ingestSelected) {
      // Bot-pushed generated show: the producer bot renders arbitrary frames and POSTs them
      // to the driver's loopback endpoint (see capture/ingest/driver.ts for the contract).
      // Width/height/fps are required — the board carries the bot's contract, no guessing.
      // Driver validation fails closed with an operator-facing message when they are missing.
      capture = {
        driverId: "ingest",
        config: {
          ...(typeof captureSettings.port === "number" ? { port: captureSettings.port } : {}),
          ...(typeof captureSettings.path === "string" ? { path: captureSettings.path } : {}),
          ...(typeof captureSettings.width === "number" ? { width: captureSettings.width } : {}),
          ...(typeof captureSettings.height === "number" ? { height: captureSettings.height } : {}),
          ...(typeof captureSettings.fps === "number" ? { fps: captureSettings.fps } : {}),
          ...(typeof captureSettings.byteFormat === "string" ? { byteFormat: captureSettings.byteFormat } : {})
        }
      };
    } else {
      const filePath = captureSettings.path;
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "Set the capture media file (Configure capture) before going live."
          })
        );
      }
      capture = {
        driverId: "file",
        config: { path: filePath, pixelFormat: "yuv420p", realtime: true }
      };
    }

    if (publish === "direct") {
      // Broadcaster-served fan-out: the sink opens its own viewer door (UPnP + host echo eligibility);
      // the host does signaling only. Operator knobs come from the sink:direct cell.
      const settings = cellRecord(board, observationCellId(obsId, "publish")).settings;
      return {
        runId,
        obsId,
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
      obsId,
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
