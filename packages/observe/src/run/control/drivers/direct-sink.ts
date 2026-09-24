import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import {
  directSinkCloseScope,
  directSinkConfigureScope
} from "#pipeline/publish/sinks/direct/commands.js";
import { DEFAULT_DIRECT_PORT } from "#pipeline/publish/sinks/direct/driver.js";
import { DEFAULT_DIRECT_FANOUT } from "#pipeline/publish/sinks/direct/fanout.js";

export const createDirectSinkControlSurface = (): ControlSurface => ({
  cell: {
    id: "sink:direct",
    cell: {
      label: "Direct Stream",
      catalog: "sink:direct",
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
  scope: directSinkConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: directSinkCloseScope,
  call: (_envelope, context) => closeCall(context)
});

interface DirectConfigurePayload {
  readonly port: number;
  readonly maxViewers: number;
  readonly reachability: "require" | "lan";
}

const configureCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(envelope.payload);
    const nowMs = Date.now();

    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            settings: {
              set: {
                port: payload.port,
                maxViewers: payload.maxViewers,
                reachability: payload.reachability,
                subscribe: ["publish.video.rendered"],
                required: true
              }
            },
            readonly: { set: { configured: true } },
            status: ["configured", null, nowMs]
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

const decodePayload = (
  payload: unknown
): Effect.Effect<DirectConfigurePayload, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "sink:direct:configure payload must be an object" })
      );
    }
    const record = payload as Record<string, unknown>;

    const port = record.port ?? DEFAULT_DIRECT_PORT;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "sink:direct:configure port must be an integer in 1..65535"
        })
      );
    }

    const maxViewers = record.maxViewers ?? DEFAULT_DIRECT_FANOUT.maxViewers;
    if (typeof maxViewers !== "number" || !Number.isInteger(maxViewers) || maxViewers < 1) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "sink:direct:configure maxViewers must be a positive integer"
        })
      );
    }

    const reachability = record.reachability ?? "require";
    if (reachability !== "require" && reachability !== "lan") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: 'sink:direct:configure reachability must be "require" or "lan"'
        })
      );
    }

    return { port, maxViewers, reachability };
  });
