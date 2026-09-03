import { Effect, type Scope } from "effect";
import { type LiveStreakError } from "@livestreak/core";
import type { ControlBus } from "#run/control/bus/index.js";
import { applyMarketLifecycleToBoard } from "./board.js";
import { createMarketRegistrar } from "./chains/index.js";
import type {
  MarketFailurePhase,
  MarketLifecycleState,
  MarketRegistrar,
  ObserveRunMarketConfig,
  ObserveRunMarketOptions
} from "./types.js";
import { validateMarketRunId, validateObserveRunMarketOptions } from "./validate.js";

export interface MarketRegistrationForkInput {
  readonly runId: string;
  readonly bus: ControlBus;
  readonly registration: ObserveRunMarketConfig;
  readonly registrar: MarketRegistrar;
}

const startedRunIds = new Set<string>();

export const resetMarketRegistrationRunsForTests = (): void => {
  startedRunIds.clear();
};

export const forkMarketRegistrationIfNeeded = (
  input: Omit<MarketRegistrationForkInput, "registration"> & {
    readonly registration: ObserveRunMarketConfig;
  }
): Effect.Effect<void, LiveStreakError, Scope.Scope> =>
  Effect.gen(function* () {
    if (startedRunIds.has(input.runId)) {
      return;
    }

    startedRunIds.add(input.runId);
    yield* Effect.forkScoped(runMarketRegistrationLifecycle(input));
  });

export const runMarketRegistrationLifecycle = (
  input: MarketRegistrationForkInput
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    yield* validateMarketRunId(input.runId);

    const pending: MarketLifecycleState = {
      status: "pending",
      startedAtMs: Date.now()
    };

    yield* commitMarketLifecycle(input.bus, pending);

    const registerResult = yield* input.registrar
      .registerMarket({
        runId: input.runId,
        title: input.registration.title
      })
      .pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            commitMarketLifecycle(input.bus, failureFromError(error)).pipe(Effect.asVoid),
          onSuccess: (result) =>
            commitMarketLifecycle(input.bus, {
              status: "registered",
              marketId: result.marketId,
              streamId: result.streamId,
              userOpHash: result.userOpHash,
              registeredAtMs: Date.now()
            }).pipe(Effect.asVoid)
        })
      );

    return registerResult;
  });

// --- helpers ---

const commitMarketLifecycle = (
  bus: ControlBus,
  lifecycle: MarketLifecycleState
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const board = yield* bus.readBoard();
    yield* bus.commitBoard(applyMarketLifecycleToBoard(board, lifecycle));
  });

const failureFromError = (error: LiveStreakError): MarketLifecycleState => {
  const metadataPhase = readFailurePhase(error);
  const phase = metadataPhase ?? inferFailurePhase(error.message);

  return {
    status: "failed",
    reason: error.message,
    phase,
    failedAtMs: Date.now()
  };
};

const readFailurePhase = (error: LiveStreakError): MarketFailurePhase | undefined => {
  const metadata = error.metadata;
  if (metadata === undefined || typeof metadata !== "object") {
    return undefined;
  }

  const phase = (metadata as Record<string, unknown>)["phase"];
  if (
    phase === "validation" ||
    phase === "send" ||
    phase === "receipt" ||
    phase === "paymaster" ||
    phase === "unsupported"
  ) {
    return phase;
  }

  return undefined;
};

const inferFailurePhase = (message: string): MarketFailurePhase => {
  const lower = message.toLowerCase();

  if (lower.includes("paymaster") || lower.includes("sponsor")) {
    return "paymaster";
  }

  if (lower.includes("reverted") || lower.includes("useroperation included")) {
    return "receipt";
  }

  if (lower.includes("useroperation receipt") || lower.includes("receipt")) {
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

export const resolveMarketRegistrarFromOptions = (
  market: ObserveRunMarketOptions | undefined
): Effect.Effect<
  { readonly registration: ObserveRunMarketConfig; readonly registrar: MarketRegistrar } | undefined,
  LiveStreakError
> =>
  Effect.gen(function* () {
    const validated = yield* validateObserveRunMarketOptions(market);
    if (validated === undefined) {
      return undefined;
    }

    const registrar =
      validated.registrar ?? (yield* createMarketRegistrar(validated.registration));

    return {
      registration: validated.registration,
      registrar
    };
  });
