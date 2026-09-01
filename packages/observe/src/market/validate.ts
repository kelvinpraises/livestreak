import { Schema } from "effect";
import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { WalletInit } from "@livestreak/schema";
import type { ObserveRunMarketConfig, ObserveRunMarketOptions } from "./types.js";

export const decodeWalletInit = (
  input: unknown
): Effect.Effect<WalletInit, LiveStreakConfigError> =>
  Schema.decodeUnknown(WalletInit)(input).pipe(
    Effect.mapError(
      (error) =>
        new LiveStreakConfigError({
          message: `Invalid WalletInit: ${formatSchemaError(error)}`
        })
    )
  );

export const validateObserveRunMarketConfig = (
  input: ObserveRunMarketConfig
): Effect.Effect<ObserveRunMarketConfig, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const walletInit = yield* decodeWalletInit(input.walletInit);

    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market.title must be a non-empty string"
        })
      );
    }

    if (!isEvmAddress(input.marketRegistryAddress)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market.marketRegistryAddress must be a 0x-prefixed EVM address"
        })
      );
    }

    if (input.seed === undefined || (typeof input.seed === "string" && input.seed.length === 0)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market.seed must be a non-empty string or Uint8Array"
        })
      );
    }

    if (typeof input.deriveStreamId !== "function") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market.deriveStreamId must be a function"
        })
      );
    }

    const streamId = input.deriveStreamId("validation-probe");
    if (!isBytes32(streamId)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "market.deriveStreamId must return a bytes32 hex string"
        })
      );
    }

    return {
      ...input,
      walletInit,
      title: input.title.trim(),
      marketRegistryAddress: normalizeAddress(input.marketRegistryAddress)
    };
  });

export const validateObserveRunMarketOptions = (
  options: ObserveRunMarketOptions | undefined
): Effect.Effect<ObserveRunMarketOptions | undefined, LiveStreakConfigError> => {
  if (options === undefined) {
    return Effect.succeed(undefined);
  }

  return Effect.gen(function* () {
    const registration = yield* validateObserveRunMarketConfig(options.registration);
    return {
      ...options,
      registration
    };
  });
};

// --- helpers ---

const isEvmAddress = (value: string): value is `0x${string}` =>
  /^0x[0-9a-fA-F]{40}$/.test(value);

const isBytes32 = (value: string): value is `0x${string}` =>
  /^0x[0-9a-fA-F]{64}$/.test(value);

const normalizeAddress = (value: `0x${string}`): `0x${string}` =>
  value.toLowerCase() as `0x${string}`;

const formatSchemaError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};
