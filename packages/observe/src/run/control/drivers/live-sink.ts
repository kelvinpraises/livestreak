import { Effect } from "effect";
import { type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import {
  liveSinkCloseScope,
  liveSinkConfigureScope
} from "#pipeline/publish/sinks/live/commands.js";

export const createLiveSinkControlSurface = (): ControlSurface => ({
  cell: {
    id: "sink:live",
    cell: {
      label: "Live Stream",
      catalog: "sink:live",
      status: ["idle", null, Date.now()],
      settings: { subscribe: ["publish.video.rendered"], required: true },
      readonly: { configured: false },
      functions: ["configure", "close"]
    }
  },
  functions: [configureEntry(), closeEntry()]
});

const configureEntry = (): ControlFunctionEntry => ({
  name: "configure",
  scope: liveSinkConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: liveSinkCloseScope,
  call: (_envelope, context) => closeCall(context)
});

// The stream id is board-derived (obsId → streamId → marketId at Prepare); configure only
// confirms the sink. See board-run-config.ts, which builds the real sink config from the market cell.
const configureCall = (
  _envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            settings: {
              set: {
                subscribe: ["publish.video.rendered"],
                required: true
              }
            },
            readonly: { set: { configured: true } },
            status: ["configured", null, Date.now()]
          }
        }
      }
    };
  });

const closeCall = (
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            readonly: { set: { configured: false } },
            status: ["idle", null, Date.now()]
          }
        }
      }
    };
  });

