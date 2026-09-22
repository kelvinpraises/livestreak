// --- exports ---

// The Solana options writer. Maps the canonical writer surface onto the 24 deployed livestreak
// instructions. Staking/dividends stay typed-unsupported pending the global-treasury shard
// (the canonical API is protocol-global; the per-market treasury is a porting artifact). Multichain-
// hygiene: @livestreak/wallet is the single @solana/* owner — instruction builders, PDA derivation,
// the tx composer, the shared inclusion poller and kit primitives all come from its re-exports.
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  address,
  buildAdvanceIx,
  buildClaimLossLvstIx,
  buildCollectIx,
  buildCreateAtaIdempotentIx,
  buildFundIx,
  buildGrowProtocolIx,
  buildLivestreakTransaction,
  buildMintPositionIx,
  buildSetLanesIx,
  buildStopAllIx,
  buildStopFundingIx,
  buildTransferPositionIx,
  buildWithdrawIx,
  computePositionTokenId,
  createWalletManager,
  isSponsoredSolanaConfig,
  pollUntilUserOperationIncluded,
  type Address,
  type Hex32,
  type Instruction,
  type LaneArgInput,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";

import { validateOptionsVaultSide } from "../../model/vault.js";
import { asTokenId, type TokenId, type VaultId } from "../../model/ids.js";
import {
  asTxId,
  type AddFundsInput,
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
  readCurrentLanes,
  resolveMarketForToken,
  resolveMarketForTokenOrOwner,
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

  // Account rent (PositionOwner PDA, a fresh LVST ATA) must be paid by a signer holding SOL. In
  // sponsored (token-free) mode the user has zero SOL, so the paymaster — which co-signs as fee
  // payer — pays the rent too; self-pay falls back to the signer. Owner/identity stays the signer.
  const rentPayerFor = (signer: Address): Address =>
    isSponsoredSolanaConfig(solanaConfig) ? address(solanaConfig.paymasterAddress) : signer;

  // Compose instructions into one tx, send, and confirm inclusion via the shared poller (Solana
  // getSignatureStatuses is mapped onto the receipt contract by the wallet account).
  const send = async (instructions: Instruction[]): Promise<string> => {
    const { account } = await getWriter();
    const tx = buildLivestreakTransaction(instructions);
    let result: { hash: string };
    try {
      result = await account.sendTransaction(tx);
    } catch (error) {
      // Preflight logs live on the kit error's context, not its message — surface the program's
      // settlement line so the ready_at-aware retry can wait precisely instead of falling back.
      const logs = (error as { context?: { logs?: readonly string[] } }).context?.logs;
      const settlement = logs?.find((line) => line.includes("settlement pending"));
      // The two typed capacity faults (StateFull / VaultBoardBehind) name themselves only in those
      // preflight logs, which the wrap below drops. Fold the detected name into the thrown message
      // so the capacity-recovery wrapper can read it back off the (message-chain) LiveStreakRuntimeError.
      const capacity = detectSolanaCapacityError(error);
      const detail = error instanceof Error ? error.message : String(error);
      throw new LiveStreakRuntimeError({
        message: `Solana transaction failed: ${detail}${settlement === undefined ? "" : ` (${settlement})`}${capacity === undefined ? "" : ` (${capacity})`}`
      });
    }
    const readOnly = await account.toReadOnlyAccount();
    await pollUntilUserOperationIncluded(readOnly, result.hash);
    return result.hash;
  };

  // Settlement-granularity retry: the pot is board-truth at resolvedAt but the CASH arrives with
  // the next completed drips cycle (cycle_secs=10; EVM parity — its AA latency hides the same
  // window). A too-early withdraw fails the program's `SettlementPending` gate on preflight;
  // crossing `ready_at` makes it deliverable, so retry across ~one cycle before surfacing the
  // failure. When the program surfaced a precise `ready_at` in the error, wait exactly until then
  // (see settlementRetryWaitMs); otherwise fall back to the fixed one-cycle sleep.
  const sendWithCycleRetry = async (build: () => Promise<Instruction[]>): Promise<string> => {
    const CYCLE_MS = 11_000;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, settlementRetryWaitMs(lastError, Date.now(), CYCLE_MS)));
      }
      try {
        return await send(await build());
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };

  // One-shot capacity recovery. The engine emits two typed, permissionlessly-recoverable capacity
  // faults while a money-moving op loads+stores the engine-state blob:
  //   • StateFull        → the protocol blob is out of room; the fix is the permissionless
  //                        grow_protocol ix (payer = signer), which reallocs it one +10_240-byte rung.
  //   • VaultBoardBehind → the vault's board has more elapsed funder boundaries than the implicit
  //                        catch-up allows; the fix is to DRAIN it with the bounded advance ix.
  // Bounded: exactly one recovery + one retry. If the retry still fails we surface its (still-typed)
  // error. `vaultId` is undefined for token-scoped ops (stopAll / setLanes) that span many vaults —
  // there is no single board to advance, so VaultBoardBehind is NOT recoverable there and re-throws.
  const ADVANCE_RECOVERY_MAX_STEPS = 64n;
  const withCapacityRecovery = async (
    marketId: Hex32,
    vaultId: VaultId | undefined,
    attempt: () => Promise<string>
  ): Promise<string> => {
    try {
      return await attempt();
    } catch (error) {
      const capacity = detectSolanaCapacityError(error);
      if (capacity === "StateFull") {
        const { signer } = await getWriter();
        await send([await buildGrowProtocolIx({ programId: ctx.programId, marketId, payer: signer })]);
        return await attempt();
      }
      if (capacity === "VaultBoardBehind" && vaultId !== undefined) {
        // The fault names the vault but not which side is behind — drain BOTH (SIDE_YES=0, SIDE_NO=1).
        for (const side of [0, 1]) {
          await send([
            await buildAdvanceIx({
              programId: ctx.programId,
              marketId,
              vaultId: vaultIdHex(vaultId),
              side,
              maxSteps: ADVANCE_RECOVERY_MAX_STEPS
            })
          ]);
        }
        return await attempt();
      }
      throw error;
    }
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

  // The LVST mint is optional in the Solana addresses config (older bags omit it). The loss-mint
  // path is the only writer op that needs it, so it fails typed HERE rather than at construction.
  const requireLvstMint = (): Address => {
    if (ctx.lvstMint === undefined) {
      throw new LiveStreakConfigError({
        message: "Solana: claimLossLvst requires lvstMint in the options Solana addresses config"
      });
    }
    return ctx.lvstMint;
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

  // Like requireMarketForToken but resolves a LANELESS position via its PositionOwner PDA — addFunds
  // must work on a freshly minted position (park the deposit as budget) before any lane exists.
  const requireMarketForTokenOrOwner = async (tokenId: TokenId): Promise<Hex32> => {
    const marketId = await resolveMarketForTokenOrOwner(ctx, tokenId);
    if (marketId === undefined) {
      throw new LiveStreakConfigError({
        message: "Solana: could not resolve the market for this position (is it minted?)",
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
    // The PositionOwner rent payer must equal the tx fee payer (sponsored → paymaster, self-pay →
    // signer); minter stays the owner/identity either way.
    const rentPayer = rentPayerFor(signer);
    const ix = await buildMintPositionIx({
      programId: ctx.programId,
      marketId: marketId as unknown as Hex32,
      payer: rentPayer,
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
      // Vault-scoped funding: recover both StateFull (grow) and VaultBoardBehind (advance this vault).
      return asTxId(await withCapacityRecovery(marketId, input.vaultId, () => send([ix])));
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
      // Token-scoped: stopAll stops EVERY lane across many vaults, so there is no single board to
      // advance — VaultBoardBehind is skipped (re-thrown); only StateFull (grow) is recoverable here.
      return asTxId(await withCapacityRecovery(marketId, undefined, () => send([ix])));
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
      // cycle boundary only becomes payable after another collect pass. Vault-scoped, so wrap the
      // whole settlement-retry cycle in capacity recovery (both StateFull and VaultBoardBehind).
      return asTxId(
        await withCapacityRecovery(marketId, input.vaultId, () =>
          sendWithCycleRetry(async () => {
            await send([collect]);
            return [ix];
          })
        )
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
      // Multi-vault withdraw path: one shared market shard, but the tx spans several boards — no
      // single vault to advance, so VaultBoardBehind re-throws; StateFull (grow) stays recoverable.
      return asTxId(await withCapacityRecovery(marketId, undefined, () => send(ixs)));
    },

    // set_lanes: declarative full-set reshape of a position's lanes with an optional top-up. The
    // canonical lanes map 1:1 onto the on-chain LaneArg (vault id, side, positive rate). addDeposit
    // may be ZERO — a pure reshape moves no cash — so only NEGATIVE/invalid is rejected. Every lane
    // must live in ONE market (the program aborts WrongMarket on a mismatch); resolve the shard from
    // the first lane's vault rather than pre-scanning them all. An empty set (clear all lanes) has no
    // lane to resolve from, so fall back to the token's own market footprint.
    setLanes: async (input: SetLanesInput): Promise<TxId> => {
      const addDeposit = requireNonNegativeBigInt(input.addDeposit, "addDeposit");
      const lanes: LaneArgInput[] = input.lanes.map((lane) => ({
        vaultId: vaultIdHex(lane.vaultId),
        side: sideToSolana(validateOptionsVaultSide(lane.side)),
        rate: requirePositiveBigInt(lane.rate, "rate")
      }));
      const marketId =
        input.lanes.length > 0
          ? await requireMarketForVault(input.lanes[0]!.vaultId)
          : await requireMarketForToken(input.tokenId);
      const { signer } = await getWriter();
      const ix = await buildSetLanesIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        usdcMint: ctx.usdcMint,
        lanes,
        addDeposit
      });
      // A lane-set reshape touches every lane's vault board in the market — no single vault to
      // advance, so VaultBoardBehind re-throws; only StateFull (grow, from the addDeposit store) recovers.
      return asTxId(await withCapacityRecovery(marketId, undefined, () => send([ix])));
    },
    // addFunds: balance-first top-up. Read the position's current active lanes and re-send them via
    // set_lanes with the deposit as add_deposit — the deposit refills the shared Drips balance and
    // extends every live stream, matching the EVM/Sui composite (read-lanes + setLanes). With no lanes
    // it just parks the deposit as budget, so it works on a freshly-minted position (the first-bet
    // top-up); the market then resolves from the PositionOwner PDA rather than an engine footprint.
    addFunds: async (input: AddFundsInput): Promise<TxId> => {
      const deposit = requirePositiveBigInt(input.deposit, "deposit");
      const marketId = await requireMarketForTokenOrOwner(input.tokenId);
      const lanes: LaneArgInput[] = await readCurrentLanes(ctx, marketId, input.tokenId);
      const { signer } = await getWriter();
      const ix = await buildSetLanesIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        usdcMint: ctx.usdcMint,
        lanes,
        addDeposit: deposit
      });
      // Token-scoped (re-sends lanes across many vaults) — no single board to advance, so only
      // StateFull (grow, from the deposit store) recovers; VaultBoardBehind re-throws.
      return asTxId(await withCapacityRecovery(marketId, undefined, () => send([ix])));
    },
    // stop_funding: stop a SINGLE lane (one vault, one side) of a position; no cash moves. Market
    // resolves from the lane's vault exactly like advance/withdraw.
    stopFunding: async (input: StopFundingInput): Promise<TxId> => {
      const side = sideToSolana(validateOptionsVaultSide(input.side));
      const marketId = await requireMarketForVault(input.vaultId);
      const { signer } = await getWriter();
      const ix = await buildStopFundingIx({
        programId: ctx.programId,
        marketId,
        user: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        vaultId: vaultIdHex(input.vaultId),
        side
      });
      // Vault-scoped single-lane stop: recover both StateFull (grow) and VaultBoardBehind (this vault).
      return asTxId(await withCapacityRecovery(marketId, input.vaultId, () => send([ix])));
    },
    // A losing position mints LVST against its vault-read loss basis. Market-scoped on Solana
    // (protocol_state per market), so resolve the shard from the vault exactly like withdraw.
    // The program mints to the CLAIMER's own LVST ATA (no mint-to-third-party account), so the
    // recipient must be the wallet signer — mirror the mint guard. Prepend idempotent ATA creation
    // so the claimer's LVST ATA existing is never a launch-order precondition (claim CREDITS it).
    claimLossLvst: async (input: ClaimLossLvstInput): Promise<TxId> => {
      const side = sideToSolana(validateOptionsVaultSide(input.side));
      const recipient = validateSolanaUserAddress(input.to, "to");
      const lvstMint = requireLvstMint();
      const { signer } = await getWriter();
      if (String(recipient) !== String(signer)) {
        throw new LiveStreakConfigError({
          message: "Solana: claimLossLvst recipient must be the wallet signer (LVST is minted to the claimer's own ATA)"
        });
      }
      const marketId = await requireMarketForVault(input.vaultId);
      // The claimer's LVST ATA is created here (first LVST touch) — its rent follows the same
      // sponsored-payer rule as mint, so a zero-SOL user's claim doesn't fail funding the ATA.
      const ensureAta = await buildCreateAtaIdempotentIx({
        payer: rentPayerFor(signer),
        owner: signer,
        mint: lvstMint
      });
      const ix = await buildClaimLossLvstIx({
        programId: ctx.programId,
        marketId,
        claimer: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        lvstMint,
        vaultId: vaultIdHex(input.vaultId),
        side
      });
      return asTxId(await send([ensureAta, ix]));
    },
    // ── seam mismatch: LVST staking is protocol-GLOBAL on EVM (a single Treasury; the canonical
    // input carries only { amount }/no-input) but PER-MARKET on Solana (stake_lvst/unstake_lvst/
    // claim_dividends bind a specific protocol_state + lvst_escrow). There is no market context in
    // the canonical input to name a Solana market, and inventing one would silently stake into an
    // arbitrary shard — so these stay a typed failure until the canonical types gain a market seam.
    stakeLvst: async (_input: StakeLvstInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: stakeLvst not supported (per-market staking escrow, but the canonical input carries no market to scope it to)"
      });
    },
    unstakeLvst: async (_input: UnstakeLvstInput): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: unstakeLvst not supported (per-market staking escrow, but the canonical input carries no market to scope it to)"
      });
    },
    claimDividends: async (): Promise<never> => {
      throw new LiveStreakConfigError({
        message: "Solana: claimDividends not supported (per-market dividend escrow, but the canonical call carries no market to scope it to)"
      });
    },
    // transfer_position reassigns the PositionOwner PDA — the CURRENT owner signs, no SPL token moves.
    // The position PDA is derived from tokenId alone (findPositionPda), so no market resolution is
    // needed. Solana has no transfer-on-behalf path, so the sender (input.from) must be the wallet
    // signer — mirror the doMint recipient guard; the new owner is input.to (validated base58 pubkey).
    transferNft: async (input: TransferNftInput): Promise<TxId> => {
      const { signer } = await getWriter();
      const from = validateSolanaUserAddress(input.from, "from");
      if (String(from) !== String(signer)) {
        throw new LiveStreakConfigError({
          message: "Solana: transferNft sender must be the wallet signer (transfer_position is signed by the current owner)"
        });
      }
      const newOwner = validateSolanaUserAddress(input.to, "to");
      const ix = await buildTransferPositionIx({
        programId: ctx.programId,
        owner: signer,
        tokenId: tokenIdToHex32(input.tokenId),
        newOwner: address(String(newOwner))
      });
      return asTxId(await send([ix]));
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

// The program logs `settlement pending: ready_at=<unix seconds>` when a withdraw races ahead of the
// settlement boundary (protocol.rs `require_settled`). Pull that unix-seconds value out of an error
// text so the retry can wait exactly until the vault is deliverable. Pure + exported for unit tests.
export const parseSettlementReadyAt = (message: string): number | undefined => {
  const match = /ready_at=(\d+)/.exec(message);
  if (match === null) return undefined;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
};

// Flatten an error's message plus its `cause` chain into one searchable string: the Solana send
// error is wrapped by a LiveStreakRuntimeError, so a `ready_at` (if it ever reaches a message in the
// chain) can sit below the top-level message. Bounded depth guards against a cyclic cause.
const errorMessageChain = (error: unknown): string => {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let depth = 0; cur !== undefined && cur !== null && depth < 8; depth += 1) {
    if (typeof cur === "string") {
      parts.push(cur);
      break;
    }
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
      continue;
    }
    parts.push(String(cur));
    break;
  }
  return parts.join(" ");
};

// Wait before the next settlement retry: precise when the program surfaced a `ready_at` (sleep until
// ready_at + 500ms, clamped to [0, 15s]), else the fixed one-cycle fallback. Pure + exported so the
// branch is unit-testable without a live send.
export const settlementRetryWaitMs = (error: unknown, nowMs: number, fallbackMs: number): number => {
  const readyAt = parseSettlementReadyAt(errorMessageChain(error));
  if (readyAt === undefined) return fallbackMs;
  return Math.min(15_000, Math.max(0, readyAt * 1000 - nowMs + 500));
};

// The two typed, recoverable capacity faults the engine can raise on preflight. Anchor formats them
// as `Program log: AnchorError ... Error Code: <Name> ...` and the kit hangs those preflight lines on
// the error's `context.logs`; once send() wraps the error the name survives only in the message chain.
export type SolanaCapacityError = "StateFull" | "VaultBoardBehind";

// Detect a capacity fault from a caught send error by flattening BOTH the message/cause chain and any
// `context.logs` into one haystack and matching the anchor error NAME. Works on the raw kit error
// (name in logs) and on the wrapped LiveStreakRuntimeError (name folded into the message by send()).
// Pure + exported for unit tests.
export const detectSolanaCapacityError = (error: unknown): SolanaCapacityError | undefined => {
  const logs = (error as { context?: { logs?: readonly string[] } } | null)?.context?.logs ?? [];
  const haystack = [errorMessageChain(error), ...logs].join(" ");
  if (haystack.includes("StateFull")) return "StateFull";
  if (haystack.includes("VaultBoardBehind")) return "VaultBoardBehind";
  return undefined;
};

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Solana write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};

// Zero is legal (a pure lane reshape moves no cash); only reject negatives / non-bigints.
const requireNonNegativeBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new LiveStreakConfigError({
      message: `Solana write requires ${field} to be a bigint >= 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};
