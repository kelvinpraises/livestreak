import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import type { BoardCellPatch } from "#run/control/bus/index.js";
import { defaultControlPause, defaultControlRun } from "#run/control/board/settings.js";

export const systemConfigConfigureScope = "system:config:configure" as const;
export const systemConfigCloseScope = "system:config:close" as const;
export const systemConfigRemoveScope = "system:config:remove" as const;
export const systemConfigPublishKindScope = "system:config:publishKind" as const;

/** Add observation: the session saves WHAT is observed (title) and WHERE it settles (chain).
 *  Pipeline choices live on the family's own cells — nothing fires at birth (board = state). */
export interface SystemConfigConfigurePayload {
  readonly title: string;
  readonly chain: string;
}

export interface ObservationIndexEntry {
  readonly title: string;
  readonly chain: string;
  readonly createdAtMs: number;
}

export const MAX_OBSERVATIONS = 4;

export const OBSERVATION_CELL_KINDS = ["capture", "publish", "run", "pause", "market"] as const;

export const observationCellId = (
  obsId: string,
  kind: (typeof OBSERVATION_CELL_KINDS)[number]
): string => `obs:${obsId}:${kind}`;

/** obs:<id>:<kind> → <id>, undefined for session-level cells. */
export const observationIdOf = (cellId: string): string | undefined => {
  const parts = cellId.split(":");
  return parts.length === 3 && parts[0] === "obs" ? parts[1] : undefined;
};

/** Publish kind → the sink catalog serving it. The cell id never changes on a kind switch. */
export const publishKindCatalog = (kind: string): string =>
  kind === "live" ? "sink:live" : kind === "direct" ? "sink:direct" : "sink:file-export";

/** One patch flips a family's publish kind: same cell, new catalog, details reset. */
export const observationPublishKindPatch = (
  obsId: string,
  kind: string,
  nowMs: number = Date.now()
): BoardPatch => ({
  cells: {
    [observationCellId(obsId, "publish")]: {
      catalog: publishKindCatalog(kind),
      readonly: { set: { kind, configured: false } },
      status: ["idle", null, nowMs]
    }
  }
});

export const readObservationIndex = (
  board: ControlFunctionContext["board"]
): Readonly<Record<string, ObservationIndexEntry>> => {
  const raw = board.cells["system:config"]?.readonly?.observations;
  return raw !== null && typeof raw === "object"
    ? (raw as Record<string, ObservationIndexEntry>)
    : {};
};

export const createSystemConfigSurface = (): ControlSurface => ({
  cell: {
    id: "system:config",
    cell: {
      label: "Session",
      catalog: "system:config",
      status: ["idle", null, Date.now()],
      settings: {},
      readonly: {},
      functions: ["configure", "close", "remove", "publishKind"]
    }
  },
  functions: [configureFunctionEntry(), closeFunctionEntry(), removeFunctionEntry(), publishKindFunctionEntry()]
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

const removeFunctionEntry = (): ControlFunctionEntry => ({
  name: "remove",
  scope: systemConfigRemoveScope,
  call: (envelope, context) => removeCall(envelope, context)
});

const publishKindFunctionEntry = (): ControlFunctionEntry => ({
  name: "publishKind",
  scope: systemConfigPublishKindScope,
  call: (envelope, context) => publishKindCall(envelope, context)
});

/** Console-reachable kind switch: one call flips a family's publish kind (same cell, new
 *  catalog, details reset). The discriminant UI dispatches this when the kind changes. */
const publishKindCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const record =
      typeof envelope.payload === "object" && envelope.payload !== null
        ? (envelope.payload as Record<string, unknown>)
        : {};
    const obsId = typeof record.obsId === "string" ? record.obsId.trim() : "";
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const index = readObservationIndex(context.board);
    if (obsId === "" || index[obsId] === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: `system:config:publishKind unknown observation ${obsId}` })
      );
    }
    if (kind !== "live" && kind !== "direct" && kind !== "file-export") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: 'system:config:publishKind kind must be "live", "direct" or "file-export"'
        })
      );
    }

    return { boardPatch: observationPublishKindPatch(obsId, kind) };
  });

const configureCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const payload = yield* decodeConfigurePayload(envelope.payload);
    const existing = readObservationIndex(context.board);
    if (Object.keys(existing).length >= MAX_OBSERVATIONS) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Session holds ${MAX_OBSERVATIONS} observations already — remove one first`
        })
      );
    }
    const nowMs = Date.now();
    const obsId = globalThis.crypto.randomUUID();

    const runId =
      typeof context.board.cells["system:config"]?.readonly?.runId === "string"
        ? context.board.cells["system:config"].readonly!.runId
        : "";

    const observations: Record<string, ObservationIndexEntry> = {
      ...existing,
      [obsId]: { title: payload.title, chain: payload.chain, createdAtMs: nowMs }
    };

    const cells: Record<string, BoardCellPatch> = {
      "system:config": {
        readonly: {
          set: { observations }
        },
        status: ["configured", null, nowMs]
      },
      [observationCellId(obsId, "run")]: {
        create: {
          label: "Run",
          catalog: "system:run",
          status: ["created", null, nowMs],
          settings: { ...defaultControlRun },
          readonly: { runId, obsId, prepared: false },
          functions: ["prepare", "start", "await", "stop"]
        }
      },
      [observationCellId(obsId, "pause")]: {
        create: {
          label: "Pause",
          catalog: "system:pause",
          status: ["idle", null, nowMs],
          settings: { ...defaultControlPause },
          readonly: { obsId },
          functions: ["pause", "resume", "setPresentation"]
        }
      },
      [observationCellId(obsId, "market")]: {
        create: {
          label: "Market",
          catalog: "market",
          status: ["none", null, nowMs],
          readonly: {
            registrationState: "none",
            obsId,
            title: payload.title,
            chain: payload.chain
          },
          functions: ["register", "goLive", "setEnded", "close"]
        }
      },
      [observationCellId(obsId, "capture")]: {
        create: {
          label: "Capture",
          catalog: "capture:file",
          status: ["idle", null, nowMs],
          settings: { maxPumpMs: 4 },
          readonly: { obsId, kind: "file", sourceType: "file", sourceMode: "file", configured: false },
          functions: ["configure", "close"]
        }
      },
      [observationCellId(obsId, "publish")]: {
        create: {
          label: "Publish",
          catalog: "sink:live",
          status: ["idle", null, nowMs],
          settings: {
            subscribe: ["publish.video.rendered"],
            required: true
          },
          readonly: { obsId, kind: "live", configured: false },
          functions: ["configure", "close"]
        }
      }
    };

    // Session-level machine cells exist once, created with the first observation.
    if (context.board.cells["system:memory"] === undefined) {
      cells["system:memory"] = {
        create: {
          label: "Memory",
          catalog: "system:memory",
          status: ["idle", null, nowMs],
          readonly: {},
          functions: []
        }
      };
    }
    if (context.board.cells["system:tick"] === undefined) {
      cells["system:tick"] = {
        create: {
          label: "Tick",
          catalog: "system:tick",
          status: ["idle", null, nowMs],
          readonly: {},
          functions: []
        }
      };
    }

    return { boardPatch: { cells } };
  });

/** Remove one observation: its five cells go, its index entry goes. On-chain markets remain. */
const removeCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const record =
      typeof envelope.payload === "object" && envelope.payload !== null
        ? (envelope.payload as Record<string, unknown>)
        : {};
    const obsId = typeof record.obsId === "string" ? record.obsId.trim() : "";
    const index = readObservationIndex(context.board);
    if (obsId === "" || index[obsId] === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: `system:config:remove unknown observation ${obsId}` })
      );
    }

    const nowMs = Date.now();
    const observations = Object.fromEntries(
      Object.entries(index).filter(([id]) => id !== obsId)
    );
    const cells: Record<string, BoardCellPatch> = {
      "system:config": {
        readonly: { set: { observations } },
        status: [Object.keys(observations).length > 0 ? "configured" : "idle", null, nowMs]
      }
    };
    for (const kind of OBSERVATION_CELL_KINDS) {
      const cellId = observationCellId(obsId, kind);
      if (context.board.cells[cellId] !== undefined) {
        cells[cellId] = { remove: true };
      }
    }

    return { boardPatch: { cells } };
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
          unset: ["observations", "chain", "capture", "publish", "process"]
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
    const title = yield* requireNonEmptyString(record.title, "title");
    const chain = yield* requireNonEmptyString(record.chain, "chain");

    return { title, chain };
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
    label: "Add observation",
    description: "Create an observation: save its title and chain, mount its pipeline family.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "title",
          value: {
            type: "string",
            description: "Human name for the observation and its market.",
            required: true
          },
          help: "Becomes the market title at registration."
        },
        {
          name: "chain",
          value: {
            type: "string",
            description: "CAIP-2 chain id this observation settles on.",
            required: true
          },
          help: "e.g. eip155:31337"
        }
      ]
    }
  },
  remove: {
    scope: systemConfigRemoveScope,
    label: "Remove observation",
    description: "Remove an observation's cells from the session. On-chain markets remain.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "obsId",
          value: { type: "string", description: "Observation id to remove.", required: true },
          help: "Supplied by the console from the focused observation."
        }
      ]
    }
  },
  publishKind: {
    scope: systemConfigPublishKindScope,
    label: "Publish kind",
    description: "Switch an observation's publish kind. Details reset; configure them next.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "obsId",
          value: { type: "string", description: "Observation id.", required: true },
          help: "Supplied by the console from the focused observation."
        },
        {
          name: "kind",
          value: {
            type: "enum",
            description: "Publish kind.",
            values: ["live", "direct", "file-export"],
            required: true
          },
          help: "live = host fan-out; direct = broadcaster-served; file-export = MP4."
        }
      ]
    }
  },
  close: {
    scope: systemConfigCloseScope,
    label: "Close",
    description: "Tear down every observation and restore the empty session.",
    result: "patch"
  }
});
