import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { createWalletManager } from "@livestreak/wallet";
import { evm } from "@livestreak/contracts";
import { encodeAbiParameters, encodeFunctionData, keccak256 } from "viem";
import type {
  EvmAddress,
  MarketRegisterResult,
  MarketRegistrar,
  ObserveRunMarketConfig,
  StreamId
} from "#market/types.js";
import { validateMarketRunId } from "#market/validate.js";

const { marketRegistryAbi } = evm;

/** Byte-identical to observe's canonical streamId: keccak256(abi.encode(observer, runId)). */
export const observeRunStreamId = (observer: EvmAddress, runId: string): StreamId =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "string" }],
      [observer, runId]
    )
  );

/** Byte-identical to MarketRegistry.computeMarketId(observer, streamId). */
export const computeMarketId = (
  observer: EvmAddress,
  streamId: StreamId
): StreamId =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [observer, streamId]
    )
  );

export const createEvmMarketRegistrar = (
  config: ObserveRunMarketConfig
): MarketRegistrar => ({
  registerMarket: (input) =>
    Effect.gen(function* () {
      if (config.walletInit.chain !== "evm") {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "EVM market registrar requires walletInit.chain === evm"
          })
        );
      }

      const runId = yield* validateMarketRunId(input.runId);

      const manager = createWalletManager(
        "evm",
        config.seed,
        config.walletInit.config as import("@livestreak/wallet").EvmErc4337WalletConfig
      );
      const account = yield* Effect.tryPromise({
        try: () => manager.getAccount(),
        catch: (error) => toRuntimeError("Failed to open wallet account", error)
      });

      const readOnly = yield* Effect.tryPromise({
        try: () => account.toReadOnlyAccount(),
        catch: (error) => toRuntimeError("Failed to open read-only wallet account", error)
      });

      const observer = yield* Effect.tryPromise({
        try: () => readOnly.getAddress(),
        catch: (error) => toRuntimeError("Failed to read wallet address", error)
      });

      const streamId = observeRunStreamId(observer as EvmAddress, runId);
      const marketId = computeMarketId(observer as EvmAddress, streamId);

      const data = encodeFunctionData({
        abi: marketRegistryAbi,
        functionName: "registerMarket",
        args: [input.title, streamId]
      });

      const sendResult = yield* Effect.tryPromise({
        try: () =>
          account.sendTransaction({
            to: config.marketRegistryAddress,
            data,
            value: 0n
          }),
        catch: (error) => classifySendFailure(error)
      });

      yield* pollUntilUserOperationIncluded(readOnly, sendResult.hash);

      return {
        userOpHash: sendResult.hash,
        marketId,
        streamId,
        title: input.title
      } satisfies MarketRegisterResult;
    })
});

export const assertUserOperationSucceeded = (
  receipt: unknown
): Effect.Effect<void, LiveStreakRuntimeError> => {
  if (!isRecord(receipt)) {
    return Effect.fail(
      receiptFailure("UserOperation receipt payload is not an object")
    );
  }

  const success = readUserOperationSuccess(receipt);
  if (success === undefined) {
    return Effect.fail(receiptFailure("UserOperation receipt is missing success"));
  }

  if (success === false) {
    return Effect.fail(receiptFailure("UserOperation included but reverted"));
  }

  return Effect.void;
};

// --- helpers ---

const pollUntilUserOperationIncluded = (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Effect.Effect<void, LiveStreakRuntimeError> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const receipt = yield* Effect.tryPromise({
        try: () => readOnly.getUserOperationReceipt(userOpHash),
        catch: (error) => toRuntimeError("getUserOperationReceipt failed", error)
      });

      if (receipt !== null && receipt !== undefined) {
        return yield* assertUserOperationSucceeded(receipt);
      }

      yield* Effect.sleep(`${delayMs} millis`);
    }

    return yield* Effect.fail(
      receiptFailure(`Timed out waiting for UserOperation receipt for ${userOpHash}`)
    );
  });

const readUserOperationSuccess = (receipt: Record<string, unknown>): boolean | undefined => {
  const direct = receipt["success"];
  if (typeof direct === "boolean") {
    return direct;
  }

  return undefined;
};

const receiptFailure = (message: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message
  });

const classifySendFailure = (error: unknown): LiveStreakRuntimeError => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("paymaster") ||
    lower.includes("sponsor") ||
    lower.includes("validuntil") ||
    lower.includes("validafter")
  ) {
    return new LiveStreakRuntimeError({
      message: `Paymaster-side registration failure: ${message}`
    });
  }

  return toRuntimeError("registerMarket UserOperation send failed", error);
};

const toRuntimeError = (prefix: string, error: unknown): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `${prefix}: ${error instanceof Error ? error.message : String(error)}`
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
