import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { createWalletManager } from "@livestreak/wallet";
import { marketRegistryAbi } from "@livestreak/contracts";
import { decodeEventLog, encodeFunctionData, type Log } from "viem";
import type { ObserveRunMarketConfig } from "../types.js";
import type { MarketRegisterInput, MarketRegisterResult, MarketRegistrar } from "../types.js";
import { decodeMarketRegisteredPayload, verifyMarketRegistration } from "../verify.js";

/** UserOp receipt path (a): wallet read-only account exposes getUserOperationReceipt(userOpHash). */
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

      const sender = yield* Effect.tryPromise({
        try: () => readOnly.getAddress(),
        catch: (error) => toRuntimeError("Failed to read wallet address", error)
      });

      const data = encodeFunctionData({
        abi: marketRegistryAbi,
        functionName: "registerMarket",
        args: [input.title, input.streamId]
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

      const userOpReceipt = yield* pollUserOperationReceipt(readOnly, sendResult.hash);
      const decoded = yield* decodeMarketRegisteredFromLogs(userOpReceipt.logs);
      const verified = yield* verifyMarketRegistration({
        decoded,
        expectedStreamId: input.streamId,
        sender: sender as `0x${string}`,
        expectedSender: sender as `0x${string}`,
        userOpHash: sendResult.hash
      });

      return {
        userOpHash: verified.userOpHash,
        sender: verified.sender,
        decoded: {
          marketId: verified.marketId,
          streamId: verified.streamId,
          title: verified.title
        }
      } satisfies MarketRegisterResult;
    })
});

export interface UserOperationReceiptPayload {
  readonly sender: `0x${string}`;
  readonly logs: readonly Log[];
}

export const extractUserOperationReceiptPayload = (
  receipt: unknown
): Effect.Effect<UserOperationReceiptPayload, LiveStreakConfigError> => {
  if (!isRecord(receipt)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "UserOperation receipt payload is not an object"
      })
    );
  }

  const sender = readSender(receipt);
  const logs = readLogs(receipt);

  if (sender === undefined) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "UserOperation receipt is missing sender"
      })
    );
  }

  if (logs.length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "UserOperation receipt is missing logs"
      })
    );
  }

  return Effect.succeed({ sender, logs });
};

// --- helpers ---

const pollUserOperationReceipt = (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Effect.Effect<UserOperationReceiptPayload, LiveStreakRuntimeError> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const receipt = yield* Effect.tryPromise({
        try: () => readOnly.getUserOperationReceipt(userOpHash),
        catch: (error) => toRuntimeError("getUserOperationReceipt failed", error)
      });

      if (receipt !== null && receipt !== undefined) {
        return yield* extractUserOperationReceiptPayload(receipt).pipe(
          Effect.mapError(
            (error) =>
              new LiveStreakRuntimeError({
                message: error.message
              })
          )
        );
      }

      yield* Effect.sleep(`${delayMs} millis`);
    }

    return yield* Effect.fail(
      new LiveStreakRuntimeError({
        message: `Timed out waiting for UserOperation receipt for ${userOpHash}`
      })
    );
  });

const decodeMarketRegisteredFromLogs = (
  logs: readonly Log[]
): Effect.Effect<ReturnType<typeof decodeMarketRegisteredPayload>, LiveStreakConfigError> => {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: marketRegistryAbi,
        eventName: "MarketRegistered",
        data: log.data,
        topics: log.topics
      });

      return Effect.succeed(
        decodeMarketRegisteredPayload({
          marketId: String(decoded.args.marketId),
          streamId: String(decoded.args.streamId),
          title: decoded.args.title
        })
      );
    } catch {
      continue;
    }
  }

  return Effect.fail(
    new LiveStreakConfigError({
      message: "MarketRegistered event not found in UserOperation receipt logs"
    })
  );
};

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

const readSender = (receipt: Record<string, unknown>): `0x${string}` | undefined => {
  const direct = receipt["sender"];
  if (typeof direct === "string" && direct.startsWith("0x")) {
    return direct as `0x${string}`;
  }

  const nestedReceipt = receipt["receipt"];
  if (isRecord(nestedReceipt)) {
    const from = nestedReceipt["from"];
    if (typeof from === "string" && from.startsWith("0x")) {
      return from as `0x${string}`;
    }
  }

  return undefined;
};

const readLogs = (receipt: Record<string, unknown>): readonly Log[] => {
  const direct = receipt["logs"];
  if (Array.isArray(direct)) {
    return direct as Log[];
  }

  const nestedReceipt = receipt["receipt"];
  if (isRecord(nestedReceipt) && Array.isArray(nestedReceipt["logs"])) {
    return nestedReceipt["logs"] as Log[];
  }

  return [];
};
