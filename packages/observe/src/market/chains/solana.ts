import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
// Multichain-hygiene: @livestreak/wallet is the single @solana/* owner. The shared livestreak
// program layer (PDAs + typed instruction builders + account decoders + tx composer) and the kit
// primitives we need to address ids / read raw account bytes all come from these re-exports —
// observe never declares a direct @solana/* dependency.
import {
  address,
  buildLivestreakTransaction,
  buildGoLiveIx,
  buildInitProtocolIx,
  buildRegisterMarketIx,
  buildSetEndedIx,
  bytesFromHex32,
  computeMarketId,
  createSolanaRpc,
  createWalletManager,
  decodeRegistryAccount,
  findMarketPda,
  findRegistryPda,
  getBase64Encoder,
  pollUntilUserOperationIncluded as pollUntilUserOperationIncludedShared,
  type Address,
  type LiveStreakSolanaWalletConfig,
  type SolanaTransaction
} from "@livestreak/wallet";
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

const ZERO_SIG = `0x${"0".repeat(64)}`;
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
// Engine-blob capacity provisioned with the market (bytes of postcard payload). Registration
// provisions the engine ATOMICALLY (same tx) so a market can never exist without its
// protocol_state/escrow — design-out of the init ordering hazard. 10_000 is the practical
// ceiling: CPI-created accounts cap at 10240 bytes; growing past this needs the Phase-4
// realloc ladder + state compaction.
const PROTOCOL_CAPACITY = 10_000;

const toRuntimeError = (prefix: string, error: unknown): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `${prefix}: ${error instanceof Error ? error.message : String(error)}`
  });

// Shared with the EVM/Sui legs: the storage pointer guards the on-chain `validate_pointer` mirrors
// (scheme 0..3, id 1..64 bytes). marketId is the 0x-bytes32 the market PDA is derived from.
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
 * Solana MarketRegistrar — wired to the REAL `livestreak` Anchor program
 * (register_market / go_live / set_ended). The program id + USDC mint come from
 * `config.solanaRegistry` (deployment), never hardcoded — the multichain invariant.
 * Mirrors the Sui leg; instruction assembly, PDA derivation and account decoding are
 * delegated to @livestreak/wallet's shared livestreak layer.
 */
export const createSolanaMarketRegistrar = (config: ObserveRunMarketConfig): MarketRegistrar => {
  const requireSolanaConfig = (): Effect.Effect<
    { readonly solanaConfig: LiveStreakSolanaWalletConfig; readonly programId: Address; readonly rpcUrl: string },
    LiveStreakConfigError
  > => {
    if (config.walletInit.chain !== "solana") {
      return Effect.fail(
        new LiveStreakConfigError({ message: "Solana market registrar requires walletInit.chain === solana" })
      );
    }
    if (config.solanaRegistry === undefined) {
      // BLOCKER: the deployed program id + USDC mint must be supplied via config
      // (contracts/host deployment ASK — mirrors the Sui `suiRegistry` seam).
      return Effect.fail(
        new LiveStreakConfigError({
          message:
            "Solana market registrar requires config.solanaRegistry { programId, usdcMint } (deployed program id)"
        })
      );
    }
    const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
    const provider = solanaConfig.provider ?? solanaConfig.rpcUrl;
    const rpcUrl = Array.isArray(provider) ? provider[0] : provider;
    if (typeof rpcUrl !== "string" || rpcUrl.length === 0) {
      return Effect.fail(
        new LiveStreakConfigError({
          message: "Solana market registrar requires walletInit.config.provider (RPC url) for account reads"
        })
      );
    }
    return Effect.succeed({
      solanaConfig,
      programId: address(config.solanaRegistry.programId),
      rpcUrl
    });
  };

  // Raw account bytes over RPC (reads stay off the wallet-account write path, mirroring how the
  // EVM leg reads marketExists via a public client). Returns null when the account does not exist.
  const fetchAccount = (rpcUrl: string, account: Address): Effect.Effect<Uint8Array | null, LiveStreakError> =>
    Effect.tryPromise({
      try: async () => {
        const rpc = createSolanaRpc(rpcUrl);
        const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
        if (value === null) return null;
        const [data] = value.data as [string, string];
        return new Uint8Array(getBase64Encoder().encode(data));
      },
      catch: (error) => toRuntimeError("Failed to read Solana account", error)
    });

  // deterministic Ed25519 keypair → same signer for register/goLive/setEnded, so the program's
  // `has_one = creator` (NotCreator) gate lines up across the lifecycle, exactly like the EVM Safe.
  const openAccount = (solanaConfig: LiveStreakSolanaWalletConfig) =>
    Effect.gen(function* () {
      const manager = createWalletManager("solana", config.seed, solanaConfig);
      const account = yield* Effect.tryPromise({
        try: () => manager.getAccount(),
        catch: (error) => toRuntimeError("Failed to open Solana wallet account", error)
      });
      const creator = yield* Effect.tryPromise({
        try: () => account.getAddress(),
        catch: (error) => toRuntimeError("Failed to read Solana wallet address", error)
      });
      return { account, creator: address(creator) };
    });

  const send = (
    account: {
      sendTransaction: (tx: SolanaTransaction) => Promise<{ hash: string }>;
      toReadOnlyAccount: () => Promise<unknown>;
    },
    instructions: import("@livestreak/wallet").Instruction | import("@livestreak/wallet").Instruction[]
  ): Effect.Effect<string, LiveStreakError> =>
    Effect.gen(function* () {
      // feePayer omitted: the account attaches its own (paymaster under gasless, creator direct).
      const tx = buildLivestreakTransaction(Array.isArray(instructions) ? instructions : [instructions]);
      const result = yield* Effect.tryPromise({
        try: () => account.sendTransaction(tx),
        catch: (error) => toRuntimeError("Solana transaction failed", error)
      });
      // Confirm inclusion via the shared poller (Solana getSignatureStatuses is mapped onto the
      // receipt contract by the wallet account), matching the EVM leg's inclusion wait.
      const readOnly = (yield* Effect.tryPromise({
        try: () => account.toReadOnlyAccount(),
        catch: (error) => toRuntimeError("Failed to derive read-only Solana account", error)
      })) as { getUserOperationReceipt: (hash: string) => Promise<unknown> };
      yield* Effect.tryPromise({
        try: () => pollUntilUserOperationIncludedShared(readOnly, result.hash),
        catch: (error) => toRuntimeError("Solana signature confirmation failed", error)
      });
      return result.hash;
    });

  const sendLifecycle = (
    fn: "go_live" | "set_ended",
    input: MarketLifecycleInput
  ): Effect.Effect<MarketLifecycleTxResult, LiveStreakError> =>
    Effect.gen(function* () {
      const validated = yield* validateLifecycleInput(input);
      const { solanaConfig, programId } = yield* requireSolanaConfig();
      const { account, creator } = yield* openAccount(solanaConfig);

      const build = fn === "go_live" ? buildGoLiveIx : buildSetEndedIx;
      const instruction = yield* Effect.tryPromise({
        try: () =>
          build({ programId, marketId: validated.marketId, creator, scheme: validated.scheme, pointer: utf8(validated.id) }),
        catch: (error) => toRuntimeError(`Failed to build ${fn} instruction`, error)
      });

      const hash = yield* send(account, instruction);
      return { userOpHash: hash } satisfies MarketLifecycleTxResult;
    });

  return {
    registerMarket: (input: MarketRegisterInput) =>
      Effect.gen(function* () {
        const runId = yield* validateMarketRunId(input.runId);
        const { solanaConfig, programId, rpcUrl } = yield* requireSolanaConfig();
        const { account, creator } = yield* openAccount(solanaConfig);

        // streamId is client-chosen opaque bytes bound to (creator, runId); market_id =
        // keccak256(creator_pubkey ++ stream_id) via the shared computeMarketId (byte-parity with
        // the program's compute_market_id, so the derived marketId matches the market PDA).
        // DIVERGENCE from the Sui/EVM legs: those hash the observer's ADDRESS BYTES into streamId;
        // here streamId = keccak256(utf8(`${creatorBase58}:${runId}`)) because the raw pubkey-byte
        // encoder is not re-exported. streamId is observe-internal (never re-derived cross-package),
        // so any deterministic binding is sound — only the marketId derivation must match on-chain.
        const streamId = keccak256(utf8(`${creator}:${runId}`)) as StreamId;
        const marketId = computeMarketId(creator, bytesFromHex32(streamId)) as StreamId;

        // Idempotency: the program uses `init` (not init_if_needed), so a duplicate registration
        // hard-fails. Detect an existing market PDA first and short-circuit (EVM marketExists parity).
        const [marketPda] = yield* Effect.tryPromise({
          try: () => findMarketPda(programId, marketId),
          catch: (error) => toRuntimeError("Failed to derive market PDA", error)
        });
        const existing = yield* fetchAccount(rpcUrl, marketPda);
        if (existing !== null) {
          return {
            userOpHash: ZERO_SIG,
            marketId,
            streamId,
            title: input.title,
            alreadyRegistered: true
          } satisfies MarketRegisterResult;
        }

        // register_market seeds the enumeration-index PDA from registry.market_count — read it live.
        const [registryPda] = yield* Effect.tryPromise({
          try: () => findRegistryPda(programId),
          catch: (error) => toRuntimeError("Failed to derive registry PDA", error)
        });
        const registryBytes = yield* fetchAccount(rpcUrl, registryPda);
        if (registryBytes === null) {
          return yield* Effect.fail(
            toRuntimeError(
              "Solana registry account not found",
              new Error("program not initialized — run `initialize` before registering markets")
            )
          );
        }
        const registry = decodeRegistryAccount(registryBytes);

        const instructions = yield* Effect.tryPromise({
          try: async () => {
            if (config.solanaRegistry === undefined) throw new Error("solanaRegistry required");
            const register = await buildRegisterMarketIx({
              programId,
              creator,
              title: utf8(input.title),
              streamId: bytesFromHex32(streamId),
              marketCount: registry.marketCount,
              marketId
            });
            const initProtocol = await buildInitProtocolIx({
              programId,
              marketId,
              payer: creator,
              usdcMint: address(config.solanaRegistry.usdcMint),
              capacity: PROTOCOL_CAPACITY
            });
            return [register, initProtocol];
          },
          catch: (error) => toRuntimeError("Failed to build register_market instructions", error)
        });

        const hash = yield* send(account, instructions);
        return { userOpHash: hash, marketId, streamId, title: input.title } satisfies MarketRegisterResult;
      }),
    goLive: (input) => sendLifecycle("go_live", input),
    setEnded: (input) => sendLifecycle("set_ended", input)
  };
};
