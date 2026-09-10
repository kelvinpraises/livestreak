import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import {
  captureCellId,
  captureConfiguratorId,
  isValidFlowPermutation,
  marketConfiguratorId,
  publishCellId,
  publishConfiguratorId,
  systemRunConfiguratorId
} from "#flows/permutations.js";
import type { BoardCellPatch } from "#run/control/bus/index.js";
import { defaultControlPause, defaultControlRun } from "#run/control/board/settings.js";
import { defaultLiveConfigurators } from "#run/control/board/visibility.js";

export const systemConfigConfigureScope = "system:config:configure" as const;
export const systemConfigCloseScope = "system:config:close" as const;

export interface SystemConfigConfigurePayload {
  readonly chain: string;
  readonly capture: string;
  readonly process: null;
  readonly publish: string;
}

export const createSystemConfigSurface = (): ControlSurface => ({
  cell: {
    id: "system:config",
    cell: {
      label: "Config",
      catalog: "system:config",
      status: ["idle", null, Date.now()],
      settings: {},
      readonly: {
        liveConfigurators: [...defaultLiveConfigurators()]
      },
      functions: ["configure", "close"]
    }
  },
  functions: [configureFunctionEntry(), closeFunctionEntry()]
});

const configureFunctionEntry = (): ControlFunctionEntry => ({
  name: "configure",
  scope: systemConfigConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeFunctionEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: systemConfigCloseScope,
  call: (_envelope, context) => closeCall(context)
});

const configureCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const payload = yield* decodeConfigurePayload(envelope.payload);
    const nowMs = Date.now();

    const captureId = captureCellId(payload.capture);
    const publishId = publishCellId(payload.publish);
    const runId =
      typeof context.board.cells["system:config"]?.readonly?.runId === "string"
        ? context.board.cells["system:config"].readonly!.runId
        : "";

    return {
      boardPatch: {
        cells: {
          "system:config": {
            readonly: {
              set: {
                chain: payload.chain,
                capture: payload.capture,
                publish: payload.publish,
                process: null,
                liveConfigurators: [
                  captureConfiguratorId(payload.capture),
                  publishConfiguratorId(payload.publish),
                  systemRunConfiguratorId,
                  marketConfiguratorId
                ]
              }
            },
            status: ["configured", null, nowMs]
          },
          "system:run": {
            create: {
              label: "Run",
              catalog: "system:run",
              status: ["created", null, nowMs],
              settings: { ...defaultControlRun },
              readonly: { runId, prepared: false },
              functions: ["prepare", "start", "await", "stop"]
            }
          },
          "system:pause": {
            create: {
              label: "Pause",
              catalog: "system:pause",
              status: ["idle", null, nowMs],
              settings: { ...defaultControlPause },
              functions: ["pause", "resume", "setPresentation"]
            }
          },
          "system:memory": {
            create: {
              label: "Memory",
              catalog: "system:memory",
              status: ["idle", null, nowMs],
              readonly: {},
              functions: []
            }
          },
          "system:tick": {
            create: {
              label: "Tick",
              catalog: "system:tick",
              status: ["idle", null, nowMs],
              readonly: {},
              functions: []
            }
          },
          market: {
            create: {
              label: "Market",
              catalog: "market",
              status: ["none", null, nowMs],
              readonly: { registrationState: "none" },
              functions: ["register", "goLive", "setEnded", "close"]
            }
          },
          [captureId]: {
            create: {
              label: "File Capture",
              catalog: "capture:file",
              status: ["idle", null, nowMs],
              settings: { maxPumpMs: 4 },
              readonly: {
                sourceType: payload.capture,
                sourceMode: "file",
                configured: false
              },
              functions: ["configure", "close"]
            }
          },
          [publishId]: {
            create: {
              label: payload.publish === "local" ? "Local Preview" : "File Export",
              catalog: payload.publish === "local" ? "sink:local" : "sink:file",
              status: ["idle", null, nowMs],
              settings: {
                subscribe: ["publish.video.rendered"],
                required: true
              },
              readonly: { configured: false },
              functions: ["configure", "close"]
            }
          }
        }
      }
    };
  });

const closeCall = (
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    const nowMs = Date.now();
    const cellsToRemove = Object.keys(context.board.cells).filter(
      (id) => id !== "system:config"
    );

    const cells: Record<string, BoardCellPatch> = {
      "system:config": {
        readonly: {
          set: { liveConfigurators: [...defaultLiveConfigurators()] },
          unset: ["chain", "capture", "publish", "process"]
        },
        status: ["idle", null, nowMs]
      }
    };

    for (const cellId of cellsToRemove) {
      cells[cellId] = { remove: true };
    }

    return { boardPatch: { cells } };
  });

const decodeConfigurePayload = (
  payload: unknown
): Effect.Effect<SystemConfigConfigurePayload, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:config:configure payload must be an object"
        })
      );
    }

    const record = payload as Record<string, unknown>;
    const chain = yield* requireNonEmptyString(record.chain, "chain");
    const capture = yield* requireNonEmptyString(record.capture, "capture");
    const publish = yield* requireNonEmptyString(record.publish, "publish");

    if (record.process !== null) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:config:configure process must be null in v0"
        })
      );
    }

    if (!isValidFlowPermutation({ capture, process: null, publish })) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Invalid flow permutation capture=${capture} publish=${publish}`
        })
      );
    }

    return { chain, capture, process: null, publish };
  });

const requireNonEmptyString = (
  value: unknown,
  field: string
): Effect.Effect<string, LiveStreakConfigError> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `system:config:configure ${field} must be a non-empty string`
      })
    );
  }

  return Effect.succeed(value.trim());
};

export const systemConfigCatalogFunctions = (): Readonly<
  Record<
    string,
    {
      readonly scope: string;
      readonly label: string;
      readonly description: string;
      readonly result: "patch";
      readonly input?: import("#run/control/catalog.js").JsonSchema;
    }
  >
> => ({
  configure: {
    scope: systemConfigConfigureScope,
    label: "Configure",
    description: "Select capture/publish permutation and mount pipeline configurators.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "chain",
          value: { type: "string", description: "CAIP-2 chain id for this session.", required: true },
          help: "e.g. eip155:31337"
        },
        {
          name: "capture",
          value: { type: "enum", description: "Capture driver id.", values: ["file"], required: true },
          help: "v0 supports file capture only."
        },
        {
          name: "process",
          value: { type: "unknown", description: "Process stage (null in v0).", required: true },
          help: "Must be null."
        },
        {
          name: "publish",
          value: {
            type: "enum",
            description: "Publish sink instance id.",
            values: ["file-export", "local"],
            required: true
          },
          help: "file-export writes MP4; local delivers over WebRTC."
        }
      ]
    }
  },
  close: {
    scope: systemConfigCloseScope,
    label: "Close",
    description: "Tear down mounted configurators and restore the root config level.",
    result: "patch"
  }
});
