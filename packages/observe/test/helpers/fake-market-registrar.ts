import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import type {
  MarketRegisterInput,
  MarketRegisterResult,
  MarketRegistrar
} from "#market/types.js";

export interface FakeMarketRegistrarOptions {
  readonly onRegister?: (input: MarketRegisterInput) => void;
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
    })
});

export const defaultFakeRegisterResult = (
  input: MarketRegisterInput
): MarketRegisterResult => ({
  userOpHash: "0xuserop",
  marketId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  streamId: "0x00000000000000000000000000000000000000000000000000000000000000aa",
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
