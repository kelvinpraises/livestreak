import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import { marketLifecyclePatch } from "#market/board.js";
import { createMarketRegistrar } from "#market/chains/index.js";
import type {
  MarketFailurePhase,
  MarketLifecycleState,
  MarketRegistrar,
  MarketStorageScheme,
  ObserveRunMarketConfig,
  StreamId
} from "#market/types.js";
import { readLiveConfigurators } from "#run/control/board/visibility.js";

export const marketRegisterScope = "market:register" as const;
export const marketGoLiveScope = "market:goLive" as const;
export const marketSetEndedScope = "market:setEnded" as const;
export const marketCloseScope = "market:close" as const;

export interface MarketControlDeps {
  readonly sessionInit?: PackageRuntimeInit;
  readonly resolveRegistrar?: (
    registration: ObserveRunMarketConfig
  ) => Effect.Effect<MarketRegistrar, LiveStreakError>;
}

export const createMarketControlSurface = (deps: MarketControlDeps = {}): ControlSurface => ({
  cell: {
    id: "market",
    cell: {
      label: "Market",
      catalog: "market",
      status: ["none", null, Date.now()],
      readonly: { registrationState: "none" },
      functions: ["register", "goLive", "setEnded", "close"]
    }
  },
  functions: [
    registerFunctionEntry(deps),
    goLiveFunctionEntry(deps),
    setEndedFunctionEntry(deps),
    closeFunctionEntry()
  ]
});

const registerFunctionEntry = (deps: MarketControlDeps): ControlFunctionEntry => ({
  name: "register",
  scope: marketRegisterScope,
  call: (envelope, context) => registerCall(envelope, context, deps)
});

const goLiveFunctionEntry = (deps: MarketControlDeps): ControlFunctionEntry => ({
  name: "goLive",
  scope: marketGoLiveScope,
  call: (envelope, context) => lifecycleCall(envelope, context, deps, "goLive")
});

const setEndedFunctionEntry = (deps: MarketControlDeps): ControlFunctionEntry => ({
  name: "setEnded",
  scope: marketSetEndedScope,
  call: (envelope, context) => lifecycleCall(envelope, context, deps, "setEnded")
});

const closeFunctionEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: marketCloseScope,
  call: (_envelope, context) => closeCall(context)
});

const registerCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext,
  deps: MarketControlDeps
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const title = yield* decodeRegisterPayload(envelope.payload);
    const runId = readRunId(context);
    const registration = yield* buildMarketConfig(deps, title);
    const registrar = yield* resolveRegistrar(deps, registration);

    const result = yield* registrar.registerMarket({ runId, title }).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.succeed(failureFromError(error)),
        onSuccess: (registered) =>
          Effect.succeed({
            status: "registered" as const,
            marketId: registered.marketId,
            streamId: registered.streamId,
            userOpHash: registered.userOpHash,
            registeredAtMs: Date.now()
          })
      })
    );

    return { boardPatch: marketLifecyclePatch(result) };
  });

const lifecycleCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext,
  deps: MarketControlDeps,
  phase: "goLive" | "setEnded"
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const input = yield* decodeLifecyclePayload(envelope.payload, context);
    const registration = yield* buildMarketConfig(deps, "");
    const registrar = yield* resolveRegistrar(deps, registration);

    const tx =
      phase === "goLive"
        ? yield* registrar.goLive(input)
        : yield* registrar.setEnded(input);

    const lifecycle: MarketLifecycleState =
      phase === "goLive"
        ? {
            status: "live",
            marketId: input.marketId,
            scheme: input.scheme,
            pointerId: input.id,
            userOpHash: tx.userOpHash,
            liveAtMs: Date.now()
          }
        : {
            status: "ended",
            marketId: input.marketId,
            scheme: input.scheme,
            pointerId: input.id,
            userOpHash: tx.userOpHash,
            endedAtMs: Date.now()
          };

    return { boardPatch: marketLifecyclePatch(lifecycle) };
  });

const closeCall = (
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    const live = readLiveConfigurators(context.board).filter((id) => id !== "observe.market");

    return {
      boardPatch: {
        cells: {
          market: { remove: true },
          "system:config": {
            readonly: {
              set: { liveConfigurators: live }
            }
          }
        }
      }
    };
  });

const resolveRegistrar = (
  deps: MarketControlDeps,
  registration: ObserveRunMarketConfig
): Effect.Effect<MarketRegistrar, LiveStreakError> => {
  if (deps.resolveRegistrar !== undefined) {
    return deps.resolveRegistrar(registration);
  }
  return createMarketRegistrar(registration);
};

const buildMarketConfig = (
  deps: MarketControlDeps,
  title: string
): Effect.Effect<ObserveRunMarketConfig, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const wallet = deps.sessionInit?.wallet;
    if (wallet === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market controls require SessionWallet from gateway runtime init"
        })
      );
    }

    const marketRegistryAddress = deps.sessionInit?.contracts?.marketRegistry;
    if (typeof marketRegistryAddress !== "string" || !marketRegistryAddress.startsWith("0x")) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market controls require contracts.marketRegistry in runtime init"
        })
      );
    }

    return {
      walletInit: wallet.walletInit,
      seed: wallet.seed,
      marketRegistryAddress: marketRegistryAddress as ObserveRunMarketConfig["marketRegistryAddress"],
      title,
      ...(deps.sessionInit?.contracts?.suiMarketRegistry === undefined
        ? {}
        : {
            suiRegistry: JSON.parse(deps.sessionInit.contracts.suiMarketRegistry) as NonNullable<
              ObserveRunMarketConfig["suiRegistry"]
            >
          })
    };
  });

const readRunId = (context: ControlFunctionContext): string => {
  const fromRun = context.board.cells["system:run"]?.readonly?.runId;
  if (typeof fromRun === "string" && fromRun.length > 0) {
    return fromRun;
  }

  const fromConfig = context.board.cells["system:config"]?.readonly?.runId;
  return typeof fromConfig === "string" ? fromConfig : "";
};

const decodeRegisterPayload = (
  payload: unknown
): Effect.Effect<string, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (payload === undefined) {
      return "";
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market:register payload must be an object" })
      );
    }

    const record = payload as Record<string, unknown>;
    if (record.title === undefined) {
      return "";
    }

    if (typeof record.title !== "string" || record.title.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market:register title must be a non-empty string" })
      );
    }

    return record.title.trim();
  });

const decodeLifecyclePayload = (
  payload: unknown,
  context: ControlFunctionContext
): Effect.Effect<
  { readonly marketId: StreamId; readonly scheme: MarketStorageScheme; readonly id: string },
  LiveStreakConfigError
> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle payload must be an object" })
      );
    }

    const record = payload as Record<string, unknown>;
    const marketReadonly = context.board.cells.market?.readonly;
    const marketId =
      typeof record.marketId === "string"
        ? record.marketId
        : typeof marketReadonly?.marketId === "string"
          ? marketReadonly.marketId
          : undefined;

    if (marketId === undefined || !marketId.startsWith("0x")) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle requires marketId" })
      );
    }

    const scheme = record.scheme;
    if (scheme !== 0 && scheme !== 1 && scheme !== 2 && scheme !== 3) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle scheme must be 0..3" })
      );
    }

    const pointer =
      typeof record.pointerId === "string"
        ? record.pointerId
        : typeof record.id === "string"
          ? record.id
          : undefined;

    if (pointer === undefined || pointer.length === 0 || pointer.length > 64) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle pointer id must be 1..64 bytes" })
      );
    }

    return { marketId: marketId as StreamId, scheme, id: pointer };
  });

const failureFromError = (error: LiveStreakError): MarketLifecycleState => ({
  status: "failed",
  reason: error.message,
  phase: inferFailurePhase(error.message),
  failedAtMs: Date.now()
});

const inferFailurePhase = (message: string): MarketFailurePhase => {
  const lower = message.toLowerCase();
  if (lower.includes("paymaster") || lower.includes("sponsor")) {
    return "paymaster";
  }
  if (lower.includes("reverted") || lower.includes("useroperation included")) {
    return "receipt";
  }
  if (lower.includes("not supported")) {
    return "unsupported";
  }
  if (lower.includes("send") || lower.includes("useroperation")) {
    return "send";
  }
  return "validation";
};

export const marketCatalogFunctions = (): Readonly<
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
  register: {
    scope: marketRegisterScope,
    label: "Register",
    description: "Register an on-chain market for this observe run.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "title",
          value: { type: "string", description: "Human-readable market title." },
          help: "Optional; defaults to empty."
        }
      ]
    }
  },
  goLive: {
    scope: marketGoLiveScope,
    label: "Go live",
    description: "Transition the registered market to live with a storage pointer.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "scheme",
          value: { type: "integer", description: "StorageScheme enum (0..3).", required: true },
          help: "0=WalrusTestnet, 1=WalrusMainnet, 2=Ipfs, 3=Arweave"
        },
        {
          name: "pointerId",
          value: { type: "string", description: "Storage pointer id (1..64 bytes).", required: true },
          help: "Walrus blob id or IPFS CID fragment."
        }
      ]
    }
  },
  setEnded: {
    scope: marketSetEndedScope,
    label: "Set ended",
    description: "Mark the market stream as ended on-chain.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "scheme",
          value: { type: "integer", description: "StorageScheme enum (0..3).", required: true },
          help: "Must match goLive pointer scheme."
        },
        {
          name: "pointerId",
          value: { type: "string", description: "Final storage pointer id.", required: true },
          help: "Pointer recorded when the stream ended."
        }
      ]
    }
  },
  close: {
    scope: marketCloseScope,
    label: "Close",
    description: "Remove the market configurator from the active board path.",
    result: "patch"
  }
});
