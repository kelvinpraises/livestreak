import { retainMarketSubmission } from "#market/submission.js";
import { confirmMarketEnd } from "#market/end.js";
import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import {
  createWalletManager,
  isPaymasterSideFailure,
  pollUntilUserOperationIncluded as pollUntilUserOperationIncludedShared
} from "@livestreak/wallet";
import { evm } from "@livestreak/contracts";
import { encodeAbiParameters, encodeFunctionData, http, keccak256, custom, createPublicClient } from "viem";
import type {
  EvmAddress,
  MarketLifecycleInput,
  MarketLifecycleTxResult,
  MarketStreamState,
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

/** Validate the storage pointer shared by goLive/setEnded (matches the on-chain guards). */
const validateLifecycleInput = (
  input: MarketLifecycleInput,
  ending = false
): Effect.Effect<MarketLifecycleInput, LiveStreakConfigError> => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.marketId)) {
    return Effect.fail(
      new LiveStreakConfigError({ message: "goLive/setEnded marketId must be a 0x-prefixed bytes32" })
    );
  }
  if (input.scheme !== 0 && input.scheme !== 1 && input.scheme !== 2 && input.scheme !== 3 && input.scheme !== 4) {
    return Effect.fail(
      new LiveStreakConfigError({ message: `Invalid StorageScheme ${String(input.scheme)} (expected 0..4)` })
    );
  }
  if (new TextEncoder().encode(input.id).length > 64 ||
      (input.id.length === 0 && (!ending || input.scheme !== 0))) {
    return Effect.fail(
      new LiveStreakConfigError({ message: `Storage id length must be 1..64 bytes, got ${input.id.length}` })
    );
  }
  return Effect.succeed(input);
};

export const createEvmMarketRegistrar = (
  config: ObserveRunMarketConfig
): MarketRegistrar => {
  // The registry ref is optional on the shared config (absent on Solana) but load-bearing here.
  const marketRegistryAddress = config.marketRegistryAddress;
  if (marketRegistryAddress === undefined) {
    throw new LiveStreakConfigError({
      message: "EVM market registrar requires marketRegistryAddress"
    });
  }
  // Shared wallet/account plumbing for the creator-gated lifecycle writes. The
  // registrar derives the SAME operator Safe as registerMarket, so the on-chain
  // `onlyMarketCreator` gate lines up (golden-vector / keccak invariant protected).
  //
  // OPT.rederive: derive account + read-only ONCE per registrar (deterministic Safe) and reuse across
  // registerMarket / goLive / setEnded. Memoize the underlying promise; each Effect call awaits it.
  const deriveAccount = async () => {
    const manager = createWalletManager(
      "evm",
      config.seed,
      config.walletInit.config as import("@livestreak/wallet").EvmErc4337WalletConfig
    );
    const account = await manager.getAccount();
    const readOnly = await account.toReadOnlyAccount();
    return { account, readOnly };
  };
  let accountPromise: ReturnType<typeof deriveAccount> | undefined;
  const openAccount = () =>
    Effect.tryPromise({
      try: () => (accountPromise ??= deriveAccount()),
      catch: (error) => toRuntimeError("Failed to open wallet account", error)
    });

  const sendLifecycleCall = (
    functionName: "goLive" | "setEnded",
    input: MarketLifecycleInput
  ): Effect.Effect<MarketLifecycleTxResult, LiveStreakError> =>
    Effect.gen(function* () {
      if (config.walletInit.chain !== "evm") {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "EVM market registrar requires walletInit.chain === evm"
          })
        );
      }

      const validated = yield* validateLifecycleInput(input, functionName === "setEnded");

      const { account, readOnly } = yield* openAccount();

      const data = encodeFunctionData({
        abi: marketRegistryAbi,
        functionName,
        args: [validated.marketId, validated.scheme, validated.id]
      });

      const sendResult = yield* retainMarketSubmission(functionName === "setEnded" ? validated : undefined, Effect.tryPromise({
        try: () => account.sendTransaction({ to: marketRegistryAddress, data, value: 0n }),
        catch: (error) => classifySendFailure(error)
      }));
      yield* pollUntilUserOperationIncluded(readOnly, sendResult.hash);

      return { userOpHash: sendResult.hash } satisfies MarketLifecycleTxResult;
    });

  const readStream = (marketId: StreamId): Effect.Effect<MarketStreamState, LiveStreakError> =>
    Effect.tryPromise({
      try: async () => {
        const walletConfig = config.walletInit.config as import("@livestreak/wallet").EvmErc4337WalletConfig;
        const client = createPublicClient({ transport: typeof walletConfig.provider === "string" ? http(walletConfig.provider) : custom(walletConfig.provider) });
        const market = await client.readContract({ address: marketRegistryAddress, abi: marketRegistryAbi, functionName: "getMarket", args: [marketId] });
        const { readOnly } = await (accountPromise ??= deriveAccount());
        if (market.creator.toLowerCase() !== (await readOnly.getAddress()).toLowerCase()) throw new Error("MarketRegistry: not creator");
        const [status, scheme, id, , endedAt] = await client.readContract({
          address: marketRegistryAddress, abi: marketRegistryAbi, functionName: "streamState", args: [marketId]
        });
        return { status: status === 2 ? "ended" : status === 1 ? "live" : "none", scheme: scheme as MarketStreamState["scheme"], id, endedAtMs: Number(endedAt) * 1000 };
      },
      catch: (error) => toRuntimeError("Failed to read stream state", error)
    });

  return {
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

      const { account, readOnly } = yield* openAccount();

      const observer = yield* Effect.tryPromise({
        try: () => readOnly.getAddress(),
        catch: (error) => toRuntimeError("Failed to read wallet address", error)
      });

      const streamId = observeRunStreamId(observer as EvmAddress, runId);
      const marketId = computeMarketId(observer as EvmAddress, streamId);

      const evmConfig = config.walletInit.config as import("@livestreak/wallet").EvmErc4337WalletConfig;
      const rpcUrl = typeof evmConfig.provider === "string" ? evmConfig.provider : undefined;
      if (rpcUrl !== undefined) {
        const publicClient = createPublicClient({ transport: http(rpcUrl) });
        const alreadyRegistered = yield* Effect.tryPromise({
          try: () =>
            publicClient.readContract({
              address: marketRegistryAddress,
              abi: marketRegistryAbi,
              functionName: "marketExists",
              args: [marketId]
            }),
          catch: (error) => toRuntimeError("Failed to read marketExists", error)
        });

        if (alreadyRegistered) {
          return {
            userOpHash: `0x${"0".repeat(64)}`,
            marketId,
            streamId,
            title: input.title,
            alreadyRegistered: true
          } satisfies MarketRegisterResult;
        }
      }

      const data = encodeFunctionData({
        abi: marketRegistryAbi,
        functionName: "registerMarket",
        args: [input.title, streamId]
      });

      const sendResult = yield* Effect.tryPromise({
        try: () =>
          account.sendTransaction({
            to: marketRegistryAddress,
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
    }),
  goLive: (input) => sendLifecycleCall("goLive", input),
  setEnded: (input) => validateLifecycleInput(input, true).pipe(Effect.flatMap(() =>
    confirmMarketEnd(input, readStream(input.marketId), sendLifecycleCall("setEnded", input))))
  };
};

// --- helpers ---

// Delegate to the shared wallet poller (60s budget + exponential backoff, and the canonical
// success reader that accepts boolean | number | hex). The previous local copy polled for only
// maxAttempts=40 × 50ms = 2s, which always timed out against a real bundler on a 5s-block chain
// since relay-kit returns the hash WITHOUT awaiting inclusion. The shared poller throws plain
// Error on revert/timeout; wrap it back into the Effect failure channel here.
const pollUntilUserOperationIncluded = (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string
): Effect.Effect<void, LiveStreakRuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      await pollUntilUserOperationIncludedShared(readOnly, userOpHash);
    },
    catch: (error) => new LiveStreakRuntimeError({
      message: `UserOperation inclusion failed: ${String(error)}`,
      ...(String(error).includes("UserOperation included but reverted") ? { metadata: { retryable: false } } : {})
    })
  });

const classifySendFailure = (error: unknown): LiveStreakRuntimeError => {
  if (isPaymasterSideFailure(error)) {
    const message = error instanceof Error ? error.message : String(error);
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
