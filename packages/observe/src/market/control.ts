import { Effect } from "effect";
import { runCellIdOf } from "#run/control/board/index.js";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import { marketLifecyclePatch } from "#market/board.js";
import { NO_RECORDING_POINTER_ID } from "#market/keys.js";
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

/** Host routing/storage uses slot 4; slots 0..3 retain their historical decoding. */
const FALLBACK_POINTER_SCHEME: MarketStorageScheme = 4;

export const createMarketControlSurface = (deps: MarketControlDeps = {}): ControlSurface => ({
  cell: {
    id: "market",
    cell: {
      label: "Market",
      catalog: "market",
      status: ["none", null, Date.now()],
      readonly: { registrationState: "none" },
      functions: ["register", "goLive", "setEnded", "recording", "retryRecording", "close"]
    }
  },
  functions: [
    registerFunctionEntry(deps),
    goLiveFunctionEntry(deps),
    setEndedFunctionEntry(deps),
    { name: "recording", scope: "market:recording", call: (_envelope, context) => recordingCall(context, deps, false) },
    { name: "retryRecording", scope: "market:retryRecording", call: (_envelope, context) => recordingCall(context, deps, true) },
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

// Archive operations update only progress. Publishing the signed chain pointer remains setEnded.
const recordingCall = (
  context: ControlFunctionContext,
  deps: MarketControlDeps,
  retry: boolean
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const init = deps.sessionInit;
    const marketId = context.board.cells[context.cellId]?.readonly?.marketId;
    if (!init || typeof marketId !== "string" || !/^0x[a-f0-9]{64}$/i.test(marketId))
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Recording lookup requires a registered market and Host"
        })
      );
    const obsId = context.cellId.startsWith("obs:")
      ? context.cellId.split(":")[1]
      : undefined;
    const runId =
      obsId === undefined ? readRunId(context) : `${readRunId(context)}#${obsId}`;
    const chain = init.wallet.walletInit.chain;
    const base = init.hostUrl.replace(/\/$/, "");
    const request = (path: string, options?: RequestInit) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(base + path, {
            ...options,
            signal: AbortSignal.timeout(30000)
          });
          if (!response.ok)
            throw new Error(`Recording request failed (${response.status})`);
          return response.json() as Promise<{
            id: string;
            marketId: string;
            runId: string;
            chain: string;
            status: string;
            segments: number;
            bytes: number;
            durationSeconds: number;
            error?: string;
          }>;
        },
        catch: (error) =>
          new LiveStreakConfigError({
            message: error instanceof Error ? error.message : "Host recording unavailable"
          })
      });
    let receipt = yield* request(
      `/recordings/by-market/${chain}/${marketId}?runId=${encodeURIComponent(runId)}`
    );
    const valid = () =>
      receipt &&
      receipt.marketId === marketId.toLowerCase() &&
      receipt.runId === runId &&
      receipt.chain === chain &&
      /^[a-f0-9]{64}$/.test(receipt.id) &&
      ["recording", "processing", "ready", "failed"].includes(receipt.status) &&
      [receipt.segments, receipt.bytes, receipt.durationSeconds].every(
        (value) => Number.isFinite(value) && value >= 0
      );
    if (!valid())
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Recording receipt does not belong to this market/run"
        })
      );
    if (retry) {
      if (!init.hostApiToken)
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "Host recording write access is not configured"
          })
        );
      receipt = yield* request(`/recordings/${receipt.id}/retry`, {
        method: "POST",
        headers: { authorization: `Bearer ${init.hostApiToken}` }
      });
      if (!valid())
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "Retry returned a different recording" })
        );
    }
    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            readonly: {
              set: {
                recordingState: receipt.status,
                recordingSegments: receipt.segments,
                recordingBytes: receipt.bytes,
                recordingDurationSeconds: receipt.durationSeconds,
                recordingError: receipt.error ?? ""
              }
            }
          }
        }
      }
    };
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
    const input = yield* decodeLifecyclePayload(envelope.payload, context, deps, phase);
    const registration = yield* buildMarketConfig(deps, "");
    const registrar = yield* resolveRegistrar(deps, registration);

    const saved = context.board.cells[context.cellId]?.readonly?.endSubmission as
      { marketId?: unknown; scheme?: unknown; id?: unknown; hash?: unknown } | undefined;
    const submittedHash = phase === "setEnded" && saved?.marketId === input.marketId &&
      saved.scheme === input.scheme && saved.id === input.id && typeof saved.hash === "string" && saved.hash.length > 0
      ? saved.hash : undefined;
    const endInput = {
      ...input,
      ...(submittedHash === undefined ? {} : { submittedHash }),
      onSubmitted: (hash: string) => context.checkpoint?.({
        cells: { [context.cellId]: { readonly: { set: {
          endSubmission: { marketId: input.marketId, scheme: input.scheme, id: input.id, hash }
        } } } }
      }) ?? Effect.void
    };
    const tx = phase === "goLive" ? yield* registrar.goLive(input) : yield* registrar.setEnded(endInput).pipe(
      Effect.catchAll(error => Effect.gen(function* () {
        // Only a definitely failed receipt permits a fresh submission. Timeout/disconnect
        // keeps the original checkpoint so a retry confirms the same hash.
        if (error.metadata?.retryable === false && context.checkpoint !== undefined) {
          yield* context.checkpoint({ cells: { [context.cellId]: { readonly: { unset: ["endSubmission"] } } } });
        }
        return yield* Effect.fail(error);
      }))
    );

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
            userOpHash: tx.userOpHash || (context.board.cells[context.cellId]?.readonly?.registrationState === "ended" ? String(context.board.cells[context.cellId]?.readonly?.userOpHash ?? "") : ""),
            endedAtMs: tx.endedAtMs ?? Date.now()
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

// Live routing identity is not an archive. End always represents explicit absence until
// Flow07 supplies a real market-bound upload/read verification path. Saved metadata alone
// and user-typed ids cannot assert stored bytes exist.
const decodeLifecyclePayload = (
  payload: unknown,
  context: ControlFunctionContext,
  deps: MarketControlDeps = {},
  phase: "goLive" | "setEnded"
): Effect.Effect<
  {
    readonly marketId: StreamId;
    readonly scheme: MarketStorageScheme;
    readonly id: string;
  },
  LiveStreakConfigError
> =>
  Effect.gen(function* () {
    if (
      payload !== undefined &&
      (typeof payload !== "object" || payload === null || Array.isArray(payload))
    ) {
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
    if (scheme !== 0 && scheme !== 1 && scheme !== 2 && scheme !== 3 && scheme !== 4) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "market lifecycle scheme must be 0..4" })
      );
    }

    const explicitPointer =
      typeof record.pointerId === "string" && record.pointerId.length > 0
        ? record.pointerId
        : typeof record.id === "string" && record.id.length > 0
          ? record.id
          : undefined;

    if (phase === "setEnded") {
      if (explicitPointer !== undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message:
              "Recording pointer is unverified. End without a recording; verified replay belongs to Flow07."
          })
        );
      }
      if (record.scheme !== undefined && record.scheme !== 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "No recording requires scheme 0" })
        );
      }
      if (record.publishReplay === true || record.publishReplay === "true") {
        const init = deps.sessionInit;
        if (!init?.hostApiToken)
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: "Host recording access is not configured"
            })
          );
        const obsId = context.cellId.startsWith("obs:")
          ? context.cellId.split(":")[1]
          : undefined;
        const runId =
          obsId === undefined ? readRunId(context) : `${readRunId(context)}#${obsId}`;
        const chain = init.wallet.walletInit.chain;
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(
              `${init.hostUrl.replace(/\/$/, "")}/recordings/by-market/${chain}/${marketId}?runId=${encodeURIComponent(runId)}`,
              { signal: AbortSignal.timeout(15000) }
            ),
          catch: () =>
            new LiveStreakConfigError({
              message:
                "Host recording lookup unavailable; end without replay or retry later"
            })
        });
        if (!response.ok)
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Recording lookup failed (${response.status})`
            })
          );
        const receipt = yield* Effect.tryPromise({
          try: () =>
            response.json() as Promise<{
              status: string;
              marketId: string;
              runId: string;
              chain: string;
              pointer?: { scheme: string; id: string; url: string };
            }>,
          catch: () => new LiveStreakConfigError({ message: "Invalid recording receipt" })
        });
        if (
          receipt === null ||
          typeof receipt !== "object" ||
          typeof receipt.marketId !== "string" ||
          typeof receipt.pointer?.url !== "string" ||
          typeof receipt.pointer?.id !== "string" ||
          receipt.status !== "ready" ||
          receipt.marketId.toLowerCase() !== marketId.toLowerCase() ||
          receipt.runId !== runId ||
          receipt.chain !== chain ||
          receipt.pointer?.scheme !== "host" ||
          !receipt.pointer.url.startsWith("https://") ||
          !/^[a-f0-9]{64}$/.test(receipt.pointer.id)
        )
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Recording is not verified for this market/run (${receipt?.status ?? "invalid"})`
            })
          );
        return { marketId: marketId as StreamId, scheme: 4, id: receipt.pointer.id };
      }
      const current = context.board.cells[context.cellId]?.readonly;
      if (
        current?.registrationState === "ended" &&
        current.scheme === 4 &&
        typeof current.pointerId === "string" &&
        /^[a-f0-9]{64}$/.test(current.pointerId)
      )
        return { marketId: marketId as StreamId, scheme: 4, id: current.pointerId };
      return { marketId: marketId as StreamId, scheme: 0, id: NO_RECORDING_POINTER_ID };
    }

    const derivedPointer = marketId.slice(2);
    const recordedPointer = undefined;
    const pointer = explicitPointer ?? derivedPointer;

    // Guard the formality branch only: an explicit or recorded pointer is legitimately any 1..64
    // bytes, but the marketId-derived one must be a full bytes32 body. If a chain ever mints a
    // native-address marketId this fails loudly instead of emitting a short/long pointer.
    if (
      explicitPointer === undefined &&
      recordedPointer === undefined &&
      derivedPointer.length !== 64
    ) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `market lifecycle derived pointer must be exactly 64 chars, got ${derivedPointer.length} from marketId ${marketId}`
        })
      );
    }

    if (pointer.length === 0 || pointer.length > 64) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market lifecycle pointer id must be 1..64 bytes"
        })
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
    description:
      "Mark the market stream as ended on-chain. Ends without an archive by default. publishReplay requests a verified Host recording for the exact market/run.",
    result: "patch",
    input: { type: "object", properties: [{ name: "publishReplay", value: { type: "boolean", default: false }, help: "Publish only a verified Host recording." }] }
  },
  recording: { scope: "market:recording", label: "Check recording", description: "Read cloud recording progress for this exact market/run.", result: "patch" },
  retryRecording: { scope: "market:retryRecording", label: "Retry recording", description: "Retry verification of a completed cloud recording; never publishes or signs a chain pointer.", result: "patch" },
  close: {
    scope: marketCloseScope,
    label: "Close",
    description: "Remove the market configurator from the active board path.",
    result: "patch"
  }
});
