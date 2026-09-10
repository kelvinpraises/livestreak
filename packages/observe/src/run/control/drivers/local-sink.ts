import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import { readLiveConfigurators } from "#run/control/board/visibility.js";
import {
  localSinkCloseScope,
  localSinkConfigureScope
} from "#pipeline/publish/sinks/local/commands.js";

export const createLocalSinkControlSurface = (): ControlSurface => ({
  cell: {
    id: "sink:local",
    cell: {
      label: "Local Preview",
      catalog: "sink:local",
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
  scope: localSinkConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: localSinkCloseScope,
  call: (_envelope, context) => closeCall(context)
});

const configureCall = (
  envelope: ControlCallEnvelope,
  _context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const streamId = yield* decodeStreamIdPayload(envelope.payload);
    const nowMs = Date.now();
    const channelLabel =
      typeof (envelope.payload as Record<string, unknown> | undefined)?.channelLabel === "string"
        ? ((envelope.payload as Record<string, unknown>).channelLabel as string)
        : `livestreak-video:${streamId}`;

    return {
      boardPatch: {
        cells: {
          "sink:local": {
            settings: {
              set: {
                streamId,
                channelLabel,
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
    const live = readLiveConfigurators(context.board).filter(
      (id) => id !== "observe.sink.local"
    );

    return {
      boardPatch: {
        cells: {
          "sink:local": { remove: true },
          "system:config": {
            readonly: { set: { liveConfigurators: live } }
          }
        }
      }
    };
  });

const decodeStreamIdPayload = (payload: unknown): Effect.Effect<string, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "sink:local:configure payload must be an object" })
      );
    }

    const streamId = (payload as Record<string, unknown>).streamId;
    if (typeof streamId !== "string" || streamId.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "sink:local:configure streamId must be a non-empty string"
        })
      );
    }

    return streamId.trim();
  });
