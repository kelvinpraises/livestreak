import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import type {
  MarketLifecycleInput,
  MarketLifecycleTxResult,
  MarketRegisterInput,
  MarketRegisterResult,
  MarketRegistrar
} from "#market/types.js";

export interface FakeMarketRegistrarOptions {
  readonly onRegister?: (input: MarketRegisterInput) => void;
  readonly onGoLive?: (input: MarketLifecycleInput) => void;
  readonly onSetEnded?: (input: MarketLifecycleInput) => void;
  readonly result?: MarketRegisterResult;
  readonly delayMs?: number;
  readonly failWith?: LiveStreakConfigError | LiveStreakRuntimeError;
  readonly hang?: boolean;
}

export const createFakeMarketRegistrar = (
  options: FakeMarketRegistrarOptions = {}
): MarketRegistrar => ({
  registerMarket: (input) =>
    Effect.gen(function* () {
      options.onRegister?.(input);

      if (options.delayMs !== undefined && options.delayMs > 0) {
        yield* Effect.sleep(`${options.delayMs} millis`);
      }

      if (options.failWith !== undefined) {
        return yield* Effect.fail(options.failWith);
      }

      if (options.hang === true) {
        return yield* Effect.never;
      }

      if (options.result !== undefined) {
        return options.result;
      }

      return defaultFakeRegisterResult(input);
    }),
  goLive: (input) =>
    Effect.gen(function* () {
      options.onGoLive?.(input);
      if (options.failWith !== undefined) {
        return yield* Effect.fail(options.failWith);
      }
      return { userOpHash: "0xgolive" } satisfies MarketLifecycleTxResult;
    }),
  setEnded: (input) =>
    Effect.gen(function* () {
      options.onSetEnded?.(input);
      if (options.failWith !== undefined) {
        return yield* Effect.fail(options.failWith);
      }
      return { userOpHash: "0xsetended" } satisfies MarketLifecycleTxResult;
    })
});

// Mirrors the real registrar's contract: the market/stream ids are FUNCTIONS of the register
// input's runId — two different (family-scoped) runIds must yield two different markets.
const hexOf = (value: string, salt: string): `0x${string}` => {
  const hex = Array.from(`${salt}:${value}`)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex.slice(0, 64).padEnd(64, "0")}` as `0x${string}`;
};

export const defaultFakeRegisterResult = (
  input: MarketRegisterInput
): MarketRegisterResult => ({
  userOpHash: "0xuserop",
  marketId: hexOf(input.runId, "m"),
  streamId: hexOf(input.runId, "s"),
  title: input.title
});

export const paymasterFailure = (): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: "Paymaster-side registration failure: sponsorship expired"
  });

export const receiptFailure = (): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: "UserOperation included but reverted"
  });
