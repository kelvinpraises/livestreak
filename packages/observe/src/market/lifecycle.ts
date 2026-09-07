import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";
import { createMarketRegistrar } from "./chains/index.js";
import type {
  EvmAddress,
  MarketLifecycleTxResult,
  MarketStorageScheme,
  StreamId,
  SuiMarketRegistryConfig
} from "./types.js";

/**
 * SEAM-LIFECYCLE — observe owns the market-lifecycle chain writes.
 *
 * The CLI used to sign goLive/setEnded from its own AA wallet (the
 * `cli/src/adapters/onchain.ts` TEMP edge), which violated the "packages own
 * wallets" rule. This writer takes a seed + walletInit and builds its OWN
 * wallet inside the chain registrar (the wallet manager lives in
 * `market/chains/**`, exactly like registerMarket), then performs
 * goLive + setEnded.
 *
 * MULTICHAIN: nothing chain-specific is hardcoded — `createMarketRegistrar`
 * dispatches on `walletInit.chain` (EVM today, Sui seam preserved). The numeric
 * `scheme` matches the on-chain `StorageScheme` enum byte-for-byte; the
 * host's `PointerScheme` → number mapping stays at the CLI edge (observe never
 * imports the host package).
 */
export interface MarketLifecycleWriteInput {
  /** Decrypted keystore seed (the package builds the wallet, not the CLI). */
  readonly seed: string | Uint8Array;
  /** Chain-tagged wallet init; selects the registrar implementation. */
  readonly walletInit: WalletInit;
  /** Deployed EVM MarketRegistry address (the `to` for the lifecycle calls). */
  readonly marketRegistryAddress: EvmAddress;
  /** Market the lifecycle transition targets (bytes32, 0x-prefixed). */
  readonly marketId: StreamId;
  /** Storage pointer id recorded on-chain (1..64 bytes). */
  readonly pointer: string;
  /** Numeric StorageScheme: 0=WalrusTestnet, 1=WalrusMainnet, 2=Ipfs, 3=Arweave. */
  readonly scheme: MarketStorageScheme;
  /** Sui registry coordinates — required only for Sui runs, resolved from deployment. */
  readonly suiRegistry?: SuiMarketRegistryConfig;
}

export interface MarketLifecycleWriteResult {
  readonly goLive: MarketLifecycleTxResult;
  readonly setEnded: MarketLifecycleTxResult;
}

/**
 * Build a wallet from the seed and submit goLive then setEnded for `marketId`,
 * pointing the stream at the supplied storage pointer (scheme + id). Ordering is
 * enforced by the contract (goLive before setEnded); we mirror that order here.
 */
export const writeMarketLifecycle = (
  input: MarketLifecycleWriteInput
): Effect.Effect<MarketLifecycleWriteResult, LiveStreakError> =>
  Effect.gen(function* () {
    if (input.pointer.length === 0 || input.pointer.length > 64) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Storage pointer id length must be 1..64 bytes, got ${input.pointer.length}`
        })
      );
    }

    const registrar = yield* createMarketRegistrar({
      walletInit: input.walletInit,
      seed: input.seed,
      marketRegistryAddress: input.marketRegistryAddress,
      // title is only consumed by registerMarket; lifecycle writes never use it.
      title: "",
      suiRegistry: input.suiRegistry
    });

    const lifecycleInput = {
      marketId: input.marketId,
      scheme: input.scheme,
      id: input.pointer
    };

    const goLive = yield* registrar.goLive(lifecycleInput);
    const setEnded = yield* registrar.setEnded(lifecycleInput);

    return { goLive, setEnded } satisfies MarketLifecycleWriteResult;
  });
