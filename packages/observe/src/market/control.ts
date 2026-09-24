import { Effect } from "effect";
import { runCellIdOf } from "#run/control/board/index.js";
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
import { RECORDING_POINTER_KEY } from "#market/keys.js";
import { createMarketRegistrar } from "#market/chains/index.js";
import type {
  MarketFailurePhase,
  MarketLifecycleState,
  MarketRegistrar,
  MarketStorageScheme,
  ObserveRunMarketConfig,
  StreamId
} from "#market/types.js";

export const marketRegisterScope = "market:register" as const;
export const marketGoLiveScope = "market:goLive" as const;
export const marketSetEndedScope = "market:setEnded" as const;
export const marketCloseScope = "market:close" as const;

export interface MarketControlDeps {
  readonly sessionInit?: PackageRuntimeInit;
  readonly resolveRegistrar?: (
    registration: ObserveRunMarketConfig
  ) => Effect.Effect<MarketRegistrar, LiveStreakError>;
  /** Storage scheme used when a lifecycle call carries none. Config-sourced (never a literal in
   *  logic) so a deployment on a different content substrate resolves its own. */
  readonly defaultPointerScheme?: MarketStorageScheme;
}

/** Scheme of last resort: 0 = WalrusTestnet, the substrate the dev/e2e stack runs on. */
const FALLBACK_POINTER_SCHEME: MarketStorageScheme = 0;

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
    const payloadTitle = yield* decodeRegisterPayload(envelope.payload);
    const cellTitle = context.board.cells[context.cellId]?.readonly?.title;
    const title =
      payloadTitle.trim() !== ""
        ? payloadTitle
        : typeof cellTitle === "string"
          ? cellTitle
          : "";
    const runId = readRunId(context);
    const registration = yield* buildMarketConfig(deps, title);
    const registrar = yield* resolveRegistrar(deps, registration);

    // The streamId (and so marketId = hash(observer, streamId)) derives from the registrar's
    // runId — scope it PER OBSERVATION or two families would mint the SAME market.
    const obsId = context.cellId.startsWith("obs:") ? context.cellId.split(":")[1] : undefined;
    const familyRunId = obsId === undefined ? runId : `${runId}#${obsId}`;
    const result = yield* registrar.registerMarket({ runId: familyRunId, title }).pipe(
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

    if (result.status === "registered" && deps.sessionInit !== undefined) {
      // Tag the catalog with the SAME chain the register used (registration.walletInit.chain) — the
      // one source of truth. (Previously derived from sessionInit.chain, a separate CAIP-2 field that
      // could diverge: a solana market got tagged evm and never synced into the catalog.)
      yield* notifyCatalogFailOpen(deps.sessionInit, result.marketId, registration.walletInit.chain);
    }

    return { boardPatch: marketLifecyclePatch(result, Date.now(), context.cellId) };
  });

// Instant catalog ingest: a fresh market appears in the app catalog without waiting for the
// host's catalog-sync cron. Fail-open — registration success never depends on the host.
const notifyCatalogFailOpen = (
  sessionInit: PackageRuntimeInit,
  marketId: string,
  chain: "evm" | "sui" | "solana"
): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    const base = sessionInit.hostUrl.replace(/\/$/, "");
    await fetch(`${base}/catalog/markets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, marketId })
    });
  }).pipe(Effect.catchAll(() => Effect.void));

const lifecycleCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext,
  deps: MarketControlDeps,
  phase: "goLive" | "setEnded"
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const input = yield* decodeLifecyclePayload(envelope.payload, context, deps);
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

    return { boardPatch: marketLifecyclePatch(lifecycle, Date.now(), context.cellId) };
  });

const closeCall = (
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    return {
      boardPatch: {
        cells: {
          [context.cellId]: { remove: true }
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

    // The registry ADDRESS is an EVM/Sui concept; on Solana every registry account is a PDA
    // derived from the programId carried by contracts.solanaMarketRegistry below.
    const chain = wallet.walletInit.chain;
    const marketRegistryAddress = deps.sessionInit?.contracts?.marketRegistry;
    if (
      chain !== "solana" &&
      (typeof marketRegistryAddress !== "string" || !marketRegistryAddress.startsWith("0x"))
    ) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market controls require contracts.marketRegistry in runtime init"
        })
      );
    }
    if (chain === "solana" && deps.sessionInit?.contracts?.solanaMarketRegistry === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market controls require contracts.solanaMarketRegistry in runtime init"
        })
      );
    }

    return {
      walletInit: wallet.walletInit,
      seed: wallet.seed,
      ...(typeof marketRegistryAddress === "string" && marketRegistryAddress.startsWith("0x")
        ? { marketRegistryAddress: marketRegistryAddress as ObserveRunMarketConfig["marketRegistryAddress"] }
        : {}),
      title,
      ...(deps.sessionInit?.contracts?.suiMarketRegistry === undefined
        ? {}
        : {
            suiRegistry: JSON.parse(deps.sessionInit.contracts.suiMarketRegistry) as NonNullable<
              ObserveRunMarketConfig["suiRegistry"]
            >
          }),
      ...(deps.sessionInit?.contracts?.solanaMarketRegistry === undefined
        ? {}
        : {
            solanaRegistry: JSON.parse(deps.sessionInit.contracts.solanaMarketRegistry) as NonNullable<
              ObserveRunMarketConfig["solanaRegistry"]
            >
          })
    };
  });

const readRunId = (context: ControlFunctionContext): string => {
  const runCellId = runCellIdOf(context.board);
  const fromRun = runCellId === undefined ? undefined : context.board.cells[runCellId]?.readonly?.runId;
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

// The pointer and scheme are BOARD-DERIVED, never operator-typed — the same design-out the live
// sink's streamId got (see sinks/live/commands.ts, board-run-config.ts). Derivation order:
//
//   pointer := explicit payload (pointerId | id)   — CLI, tests, Slice-2 tooling
//           ?? board-saved recording pointer        — the Slice-2 seam; nothing writes it yet
//           ?? the market cell's marketId sans 0x   — the honest formality
//   scheme  := explicit payload ?? deps default ?? FALLBACK_POINTER_SCHEME
//
// Chain-agnostic on purpose: it sits ABOVE the per-chain registrar dispatch, and marketId is a
// 0x-bytes32 on all three chains (keccak on Solana too, not a base58 pubkey), so `.slice(2)` is
// exactly the 64 chars every registrar's 1..64 guard accepts.
const decodeLifecyclePayload = (
  payload: unknown,
  context: ControlFunctionContext,
  deps: MarketControlDeps = {}
): Effect.Effect<
  { readonly marketId: StreamId; readonly scheme: MarketStorageScheme; readonly id: string },
  LiveStreakConfigError
> =>
  Effect.gen(function* () {
    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle payload must be an object" })
      );
    }

    const record = (payload ?? {}) as Record<string, unknown>;
    const marketReadonly = context.board.cells[context.cellId]?.readonly;
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

    const scheme = record.scheme ?? deps.defaultPointerScheme ?? FALLBACK_POINTER_SCHEME;
    if (scheme !== 0 && scheme !== 1 && scheme !== 2 && scheme !== 3) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle scheme must be 0..3" })
      );
    }

    const explicitPointer =
      typeof record.pointerId === "string" && record.pointerId.length > 0
        ? record.pointerId
        : typeof record.id === "string" && record.id.length > 0
          ? record.id
          : undefined;

    // Slice-2 seam: the recording upload will save its blob id under RECORDING_POINTER_KEY and
    // this reads it with no further change. Nothing writes the key today — do not build upload
    // logic for it. The key is a shared constant (market/keys.ts) so the future writer cannot
    // pick a different literal and leave this silently falling back to the formality.
    const recorded = marketReadonly?.[RECORDING_POINTER_KEY];
    const recordedPointer = typeof recorded === "string" && recorded.length > 0 ? recorded : undefined;

    const derivedPointer = marketId.slice(2);
    const pointer = explicitPointer ?? recordedPointer ?? derivedPointer;

    // Guard the formality branch only: an explicit or recorded pointer is legitimately any 1..64
    // bytes, but the marketId-derived one must be a full bytes32 body. If a chain ever mints a
    // native-address marketId this fails loudly instead of emitting a short/long pointer.
    if (explicitPointer === undefined && recordedPointer === undefined && derivedPointer.length !== 64) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `market lifecycle derived pointer must be exactly 64 chars, got ${derivedPointer.length} from marketId ${marketId}`
        })
      );
    }

    if (pointer.length === 0 || pointer.length > 64) {
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
  // No `input`: the pointer and scheme are board-derived (see decodeLifecyclePayload), so the
  // console renders these as plain rows with nothing to type. An explicit payload still wins.
  goLive: {
    scope: marketGoLiveScope,
    label: "Go live",
    description: "Transition the registered market to live. The storage pointer is board-derived.",
    result: "patch"
  },
  setEnded: {
    scope: marketSetEndedScope,
    label: "Set ended",
    description: "Mark the market stream as ended on-chain. The storage pointer is board-derived.",
    result: "patch"
  },
  close: {
    scope: marketCloseScope,
    label: "Close",
    description: "Remove the market configurator from the active board path.",
    result: "patch"
  }
});
