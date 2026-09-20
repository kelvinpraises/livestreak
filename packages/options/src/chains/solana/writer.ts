// --- exports ---

// The Solana options writer. Maps the canonical writer surface onto the 16 deployed livestreak
// instructions (money-complete LVST/treasury + NFT-transfer ops land a later phase). Multichain-
// hygiene: @livestreak/wallet is the single @solana/* owner — instruction builders, PDA derivation,
// the tx composer, the shared inclusion poller and kit primitives all come from its re-exports.
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  address,
  buildAdvanceIx,
  buildCollectIx,
  buildFundIx,
  buildLivestreakTransaction,
  buildMintPositionIx,
  buildStopAllIx,
  buildWithdrawIx,
  computePositionTokenId,
  createWalletManager,
  pollUntilUserOperationIncluded,
  type Address,
  type Hex32,
  type Instruction,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";

import { validateOptionsVaultSide } from "../../model/vault.js";
import { asTokenId, type TokenId } from "../../model/ids.js";
import {
  asTxId,
  type AdvanceInput,
  type ApproveNftInput,
  type ClaimLossLvstInput,
  type FundStreamInput,
  type MintNftInput,
  type MintResult,
  type MintWithSaltInput,
  type OptionsChainConfig,
  type OptionsWriter,
  type SetApprovalForAllInput,
  type SetLanesInput,
  type StakeLvstInput,
  type StopAllFundingInput,
  type StopFundingInput,
  type TransferNftInput,
  type TxId,
  type UnstakeLvstInput,
  type WithdrawInput,
  type WithdrawManyInput
} from "../types.js";
import { validateSolanaUserAddress } from "./account.js";
import {
  resolveMarketForToken,
  resolveMarketForVault,
  resolveSolanaContext,
  tokenIdToHex32,
  vaultIdHex,
  type SolanaOptionsContext
} from "./config.js";
import { sideToSolana } from "./decode.js";

type SolanaWriteAccount = {
  sendTransaction(tx: unknown): Promise<{ hash: string }>;
  getAddress(): Promise<string>;
  toReadOnlyAccount(): Promise<{ getUserOperationReceipt(hash: string): Promise<unknown> }>;
};

export const createSolanaOptionsWriter = (config: OptionsChainConfig): OptionsWriter => {
  const ctx: SolanaOptionsContext = resolveSolanaContext(config);
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;

  // OPT.rederive: open the wallet account ONCE per writer (deterministic Ed25519 signer) and reuse
  // it + the cached signer address across every send, instead of re-deriving per call.
  type WriterCtx = { account: SolanaWriteAccount; signer: Address };
  let ctxPromise: Promise<WriterCtx> | undefined;
  const getWriter = (): Promise<WriterCtx> => {
    if (ctxPromise === undefined) {
      ctxPromise = (async () => {
        const manager = createWalletManager("solana", config.seed, solanaConfig);
        const account = (await manager.getAccount()) as unknown as SolanaWriteAccount;
        const signer = address(await account.getAddress());
        return { account, signer };
      })();
    }
    return ctxPromise;
  };

  // Compose instructions into one tx, send, and confirm inclusion via the shared poller (Solana
  // getSignatureStatuses is mapped onto the receipt contract by the wallet account).
  const send = async (instructions: Instruction[]): Promise<string> => {
    const { account } = await getWriter();
    const tx = buildLivestreakTransaction(instructions);
    let result: { hash: string };
    try {
      result = await account.sendTransaction(tx);
    } catch (error) {
      throw new LiveStreakRuntimeError({
        message: `Solana transaction failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    const readOnly = await account.toReadOnlyAccount();
    await pollUntilUserOperationIncluded(readOnly, result.hash);
    return result.hash;
  };

  // Settlement-granularity retry: the pot is board-truth at resolvedAt but the CASH arrives with
  // the next completed drips cycle (cycle_secs=10; EVM parity — its AA latency hides the same
  // window). A too-early withdraw fails VaultInsufficientUsdc on preflight; crossing one boundary
  // makes it deliverable, so retry across ~one cycle before surfacing the failure.
  const sendWithCycleRetry = async (build: () => Promise<Instruction[]>): Promise<string> => {
    const CYCLE_MS = 11_000;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, CYCLE_MS));
      try {
        return await send(await build());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  const requireMarketForVault = async (vaultId: string): Promise<Hex32> => {
    const marketId = await resolveMarketForVault(ctx, vaultId as never);
    if (marketId === undefined) {
      throw new LiveStreakConfigError({
        message: "Solana: could not resolve the market shard owning this vault",
        metadata: { details: vaultId }
      });
    }
    return marketId;
  };

  const requireMarketForToken = async (tokenId: TokenId): Promise<Hex32> => {
    const marketId = await resolveMarketForToken(ctx, tokenId);
    if (marketId === undefined) {
      throw new LiveStreakConfigError({
        message: "Solana: could not resolve the market shard for this position (no funded lanes yet)",
        metadata: { details: tokenId.toString() }
      });
    }
    return marketId;
  };

  const doMint = async (marketId: string, to: string, salt: bigint): Promise<MintResult> => {
    const { account, signer } = await getWriter();
    const recipient = validateSolanaUserAddress(to, "to");
    // mint_position mints to the SIGNER (PositionOwner PDA owner = minter). Solana has no mint-to-
    // third-party path this phase; require the recipient to be the wallet signer.
    if (String(recipient) !== String(signer)) {
      throw new LiveStreakConfigError({
        message: "Solana: mint recipient must be the wallet signer (no mint-to-third-party instruction)"
      });
    }
    const ix = await buildMintPositionIx({
      programId: ctx.programId,
      marketId: marketId as unknown as Hex32,
      minter: signer,
      salt
    });
    const tokenHex = computePositionTokenId(signer, salt);
    void account;
    const hash = await send([ix]);
    return { txId: asTxId(hash), tokenId: asTokenId(BigInt(tokenHex)) };
  };

  return {
    mint: async (input: MintNftInput): Promise<MintResult> => {
      // Plain mint: pick a random 64-bit salt for a fresh, non-colliding token id.
      const buf = new BigUint64Array(1);
      globalThis.crypto.getRandomValues(buf);
      return doMint(input.marketId, input.to, buf[0]!);
    },

    mintWithSalt: async (input: MintWithSaltInput): Promise<MintResult> =>
      doMint(input.marketId, input.to, input.salt),

    fund: async (input: FundStreamInput): Promise<TxId> => {
      const side = sideToSolana(validateOptionsVaultSide(input.side));
      const rate = requirePositiveBigInt(input.rate, "rate");
      const deposit = requirePositiveBigInt(input.deposit, "deposit");
      const marketId = await requireMarketForVault(input.vaultId);
      const { signer } = await getWriter();
      const ix = await buildFundIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        usdcMint: ctx.usdcMint,
        vaultId: vaultIdHex(input.vaultId),
        side,
        rate,
        deposit
      });
      return asTxId(await send([ix]));
    },

    advance: async (input: AdvanceInput): Promise<TxId> => {
      const side = sideToSolana(validateOptionsVaultSide(input.side));
      const marketId = await requireMarketForVault(input.vaultId);
      const ix = await buildAdvanceIx({
        programId: ctx.programId,
        marketId,
        vaultId: vaultIdHex(input.vaultId),
        side,
        maxSteps: input.maxSteps ?? 0n
      });
      return asTxId(await send([ix]));
    },

    stopAllFunding: async (input: StopAllFundingInput): Promise<TxId> => {
      const marketId = await requireMarketForToken(input.tokenId);
      const { signer } = await getWriter();
      const ix = await buildStopAllIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        usdcMint: ctx.usdcMint
      });
      return asTxId(await send([ix]));
    },

    withdraw: async (input: WithdrawInput): Promise<TxId> => {
      const marketId = await requireMarketForVault(input.vaultId);
      const { signer } = await getWriter();
      // Engine withdraw pays 0 until the pot is finalized — collect first (permissionless,
      // idempotent post-resolve). SEPARATE txs, not one: the SBF bump allocator never frees, so
      // two engine ops in one tx double the heap and blow even the 256KB ceiling.
      const collect = await buildCollectIx({
        programId: ctx.programId,
        marketId,
        vaultId: vaultIdHex(input.vaultId)
      });
      const ix = await buildWithdrawIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        usdcMint: ctx.usdcMint,
        vaultId: vaultIdHex(input.vaultId)
      });
      // Each attempt re-runs collect: the HARVEST lives in collect, so cash delivered by a new
      // cycle boundary only becomes payable after another collect pass.
      return asTxId(
        await sendWithCycleRetry(async () => {
          await send([collect]);
          return [ix];
        })
      );
    },

    withdrawMany: async (input: WithdrawManyInput): Promise<TxId> => {
      if (input.vaultIds.length === 0) {
        throw new LiveStreakConfigError({ message: "Solana: withdrawMany requires at least one vaultId" });
      }
      // A position is single-market, so all its vaults share one shard — resolve once from the first.
      const marketId = await requireMarketForVault(input.vaultIds[0]!);
      const { signer } = await getWriter();
      const collects: Instruction[] = [];
      for (const vaultId of input.vaultIds) {
        collects.push(
          await buildCollectIx({ programId: ctx.programId, marketId, vaultId: vaultIdHex(vaultId) })
        );
      }
      const ixs: Instruction[] = [];
      for (const vaultId of input.vaultIds) {
        ixs.push(
          await buildWithdrawIx({
            programId: ctx.programId,
            marketId,
            user: signer,
            tokenId: tokenIdToHex32(input.tokenId),
            usdcMint: ctx.usdcMint,
            vaultId: vaultIdHex(vaultId)
          })
        );
      }
      return asTxId(await send(ixs));
    },

    // ── not available this phase ──────────────────────────────────────────────────────
    // setLanes: no atomic multi-lane set instruction (only per-vault `fund` + position-wide
    // `stop_all`). Rebuilding "set" semantics from those would risk mis-stopping lanes — surface it.
    setLanes: async (_input: SetLanesInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: setLanes not supported (no atomic set_lanes instruction; use fund/stopAllFunding)"
      });
    },
    // stopFunding: no per-lane bettor stop instruction (only position-wide stop_all).
    stopFunding: async (_input: StopFundingInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: stopFunding not supported (no per-lane stop instruction; use stopAllFunding)"
      });
    },
    claimLossLvst: async (_input: ClaimLossLvstInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: claimLossLvst not supported yet (LVST/treasury instructions land a later phase)"
      });
    },
    stakeLvst: async (_input: StakeLvstInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: stakeLvst not supported yet (LVST/treasury instructions land a later phase)"
      });
    },
    unstakeLvst: async (_input: UnstakeLvstInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: unstakeLvst not supported yet (LVST/treasury instructions land a later phase)"
      });
    },
    claimDividends: async (): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: claimDividends not supported yet (LVST/treasury instructions land a later phase)"
      });
    },
    transferNft: async (_input: TransferNftInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: transferNft not supported (no NFT-transfer instruction; PositionOwner PDA is bound to its minter)"
      });
    },
    approveNft: async (_input: ApproveNftInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: approveNft not supported (PositionOwner PDA model, no approvals)"
      });
    },
    setApprovalForAll: async (input: SetApprovalForAllInput): Promise<TxId> => {
      // Protocol-operator approval (operator omitted) is TRUE BY CONSTRUCTION on Solana: the
      // program's authority over positions is PDA-structural, so the postcondition already holds
      // and this is a correct no-op (zero-sig sentinel, observe alreadyRegistered parity).
      // Arbitrary operators have no on-chain counterpart — honest throw.
      if (input.operator !== undefined) {
        throw new LiveStreakConfigError({
          message: "Solana: setApprovalForAll for an arbitrary operator not supported (program authority is PDA-structural)"
        });
      }
      return asTxId(`0x${"0".repeat(64)}`);
    }
  };
};

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Solana write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};
