import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
// Multichain-hygiene: build PTBs VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import { createWalletManager, Transaction, bcs, type SuiWalletConfig } from "@livestreak/wallet";
import { MODULES, target } from "@livestreak/contracts/sui";
import { keccak256 } from "viem";
import type {
  MarketLifecycleInput,
  MarketLifecycleTxResult,
  MarketRegisterInput,
  MarketRegisterResult,
  MarketRegistrar,
  ObserveRunMarketConfig,
  StreamId
} from "#market/types.js";
import { validateMarketRunId } from "#market/validate.js";

// Sui clock is always the same system shared object (mirrors options' Sui writer).
const SUI_CLOCK_OBJECT_ID = "0x6";

/** 32-byte array from a 0x-prefixed (or bare) hex string. */
const hex32ToByteArray = (id: string): number[] => {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2) || "0", 16));
};

const bytes32Vector = (id: string): Uint8Array =>
  bcs.vector(bcs.u8()).serialize(hex32ToByteArray(id)).toBytes();

const utf8Vector = (value: string): Uint8Array =>
  bcs.vector(bcs.u8()).serialize(Array.from(new TextEncoder().encode(value))).toBytes();

const toRuntimeError = (prefix: string, error: unknown): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `${prefix}: ${error instanceof Error ? error.message : String(error)}`
  });

const validateLifecycleInput = (
  input: MarketLifecycleInput
): Effect.Effect<MarketLifecycleInput, LiveStreakConfigError> => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.marketId)) {
    return Effect.fail(
      new LiveStreakConfigError({ message: "goLive/setEnded marketId must be a 0x-prefixed bytes32" })
    );
  }
  if (input.scheme !== 0 && input.scheme !== 1 && input.scheme !== 2 && input.scheme !== 3) {
    return Effect.fail(
      new LiveStreakConfigError({ message: `Invalid StorageScheme ${String(input.scheme)} (expected 0..3)` })
    );
  }
  if (input.id.length === 0 || input.id.length > 64) {
    return Effect.fail(
      new LiveStreakConfigError({ message: `Storage id length must be 1..64 bytes, got ${input.id.length}` })
    );
  }
  return Effect.succeed(input);
};

/**
 * Sui MarketRegistrar — wired to the REAL `livestreak::market_registry` Move
 * module (register_market / go_live / set_ended). Object ids and package id are
 * resolved from `config.suiRegistry` (deployment), never hardcoded — the
 * multichain invariant. Mirrors `packages/options` Sui writer structure.
 */
export const createSuiMarketRegistrar = (config: ObserveRunMarketConfig): MarketRegistrar => {
  const requireSuiConfig = (): Effect.Effect<
    { readonly suiConfig: SuiWalletConfig; readonly packageId: string; readonly registryId: string },
    LiveStreakConfigError
  > => {
    if (config.walletInit.chain !== "sui") {
      return Effect.fail(
        new LiveStreakConfigError({ message: "Sui market registrar requires walletInit.chain === sui" })
      );
    }
    if (config.suiRegistry === undefined) {
      // BLOCKER: the deployed Sui MarketRegistry shared-object id + package id
      // must be supplied via config (contracts/host deployment ASK).
      return Effect.fail(
        new LiveStreakConfigError({
          message:
            "Sui market registrar requires config.suiRegistry { packageId, marketRegistryObjectId } (deployed registry id)"
        })
      );
    }
    return Effect.succeed({
      suiConfig: config.walletInit.config as SuiWalletConfig,
      packageId: config.suiRegistry.packageId,
      registryId: config.suiRegistry.marketRegistryObjectId
    });
  };

  const send = (tx: Transaction, suiConfig: SuiWalletConfig): Effect.Effect<string, LiveStreakError> =>
    Effect.gen(function* () {
      const manager = createWalletManager("sui", config.seed, suiConfig);
      const account = yield* Effect.tryPromise({
        try: () => manager.getAccount(),
        catch: (error) => toRuntimeError("Failed to open Sui wallet account", error)
      });
      tx.setGasBudgetIfNotSet(100_000_000);
      const result = yield* Effect.tryPromise({
        try: () => account.sendTransaction(tx),
        catch: (error) => toRuntimeError("Sui transaction failed", error)
      });
      return result.hash;
    });

  const sendLifecycle = (
    fn: "go_live" | "set_ended",
    input: MarketLifecycleInput
  ): Effect.Effect<MarketLifecycleTxResult, LiveStreakError> =>
    Effect.gen(function* () {
      const validated = yield* validateLifecycleInput(input);
      const { suiConfig, packageId, registryId } = yield* requireSuiConfig();

      const tx = new Transaction();
      tx.moveCall({
        target: target(packageId, MODULES.marketRegistry, fn),
        arguments: [
          tx.object(registryId),
          tx.pure(bytes32Vector(validated.marketId)),
          tx.pure.u8(validated.scheme),
          tx.pure(utf8Vector(validated.id)),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });

      const hash = yield* send(tx, suiConfig);
      return { userOpHash: hash } satisfies MarketLifecycleTxResult;
    });

  return {
    registerMarket: (input: MarketRegisterInput) =>
      Effect.gen(function* () {
        const runId = yield* validateMarketRunId(input.runId);
        const { suiConfig, packageId, registryId } = yield* requireSuiConfig();

        const manager = createWalletManager("sui", config.seed, suiConfig);
        const account = yield* Effect.tryPromise({
          try: () => manager.getAccount(),
          catch: (error) => toRuntimeError("Failed to open Sui wallet account", error)
        });
        const observer = yield* Effect.tryPromise({
          try: () => account.getAddress(),
          catch: (error) => toRuntimeError("Failed to read Sui wallet address", error)
        });

        // streamId / marketId derivation mirrors the Move `compute_market_id`:
        // market_id = keccak256( bcs(observer-address) ++ stream_id ). The
        // stream_id is keccak256(observer-bytes ++ utf8(runId)). (Golden-vector
        // parity with contracts is an open ASK — see reply.)
        const observerBytes = hex32ToByteArray(observer);
        const observerHex = `0x${observerBytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
        const streamId = keccak256(
          new Uint8Array([...observerBytes, ...new TextEncoder().encode(runId)])
        ) as StreamId;
        const streamIdBytes = hex32ToByteArray(streamId);
        const marketId = keccak256(
          new Uint8Array([...observerBytes, ...streamIdBytes])
        ) as StreamId;

        const tx = new Transaction();
        tx.moveCall({
          target: target(packageId, MODULES.marketRegistry, "register_market"),
          arguments: [
            tx.object(registryId),
            tx.pure(utf8Vector(input.title)),
            tx.pure(bytes32Vector(streamId)),
            tx.object(SUI_CLOCK_OBJECT_ID)
          ]
        });

        const hash = yield* send(tx, suiConfig);
        void observerHex;

        return {
          userOpHash: hash,
          marketId,
          streamId,
          title: input.title
        } satisfies MarketRegisterResult;
      }),
    goLive: (input) => sendLifecycle("go_live", input),
    setEnded: (input) => sendLifecycle("set_ended", input)
  };
};
