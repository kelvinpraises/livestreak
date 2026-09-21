// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build instructions/txs + read VIA @livestreak/wallet (the single @solana/* owner).
import {
  address,
  buildCreateAtaIdempotentIx,
  buildCreateVaultSeededIx,
  buildGrowProtocolIx,
  buildLivestreakTransaction,
  createSolanaRpc,
  createWalletManager,
  getBase64Encoder,
  hex32FromBytes,
  pollUntilUserOperationIncluded as pollUntilUserOperationIncludedShared,
  UserOperationPollTimeoutError,
  type Address,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";

import type {
  BookmakerChainConfig,
  BookmakerChainWriter,
  CreateVaultInput,
  CreateVaultResult,
  TxId,
  VaultId
} from "../types.js";
import { asTxId, asVaultId } from "../types.js";
import type { BookmakerSolanaAddresses } from "../addresses.js";
import { resolveSolanaRpcUrl } from "./index.js";

const SOLANA_HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

// yes/no -> engine seed_side u8 (SIDE_YES = 0, SIDE_NO = 1 — livestreak-engine vault.rs).
const sideToSolana = (side: "yes" | "no"): number => (side === "yes" ? 0 : 1);

const base64Encoder = getBase64Encoder();

// The bookmaker's Solana RPC is untyped at the wallet boundary; pin only the two methods we call.
type SolanaReadRpc = {
  getTransaction: (
    signature: string,
    config: { commitment: string; maxSupportedTransactionVersion: number }
  ) => { send: () => Promise<SolanaTransactionResult | null> };
};

type SolanaTransactionResult = {
  meta?: {
    err?: unknown;
    returnData?: { data: readonly [string, string] } | null;
  } | null;
};

export const createSolanaBookmakerWriter = (config: BookmakerChainConfig): BookmakerChainWriter => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana bookmaker writer requires walletInit.chain === solana"
    });
  }

  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const addresses = config.addresses as BookmakerSolanaAddresses;
  const programId = address(addresses.programId);
  const usdcMint = address(addresses.usdcMint);
  const rpcUrl = resolveSolanaRpcUrl(config);

  // OPT.rederive: derive the account (deterministic keypair) ONCE per writer, reuse across writes —
  // mirrors the evm/sui legs.
  type SolanaContext = {
    account: { sendTransaction(tx: unknown): Promise<{ hash: string }> };
    readOnly: { getUserOperationReceipt(hash: string): Promise<unknown> };
    owner: Address;
    rpc: SolanaReadRpc;
  };
  let contextPromise: Promise<SolanaContext> | undefined;
  const getSolana = (): Promise<SolanaContext> => {
    if (contextPromise === undefined) {
      contextPromise = (async () => {
        const manager = createWalletManager("solana", config.seed, solanaConfig);
        const account = (await manager.getAccount()) as SolanaContext["account"] & {
          getAddress(): Promise<string>;
          toReadOnlyAccount(): Promise<SolanaContext["readOnly"]>;
        };
        const owner = address(await account.getAddress());
        const readOnly = await account.toReadOnlyAccount();
        const rpc = createSolanaRpc(rpcUrl) as unknown as SolanaReadRpc;
        return { account, readOnly, owner, rpc };
      })();
    }
    return contextPromise;
  };

  return {
    createVault: async (input: CreateVaultInput): Promise<CreateVaultResult> => {
      const marketId = requireHex32(input.marketId, "marketId");
      const question = new TextEncoder().encode(requireNonEmptyQuestion(input.question));
      const seedSide = sideToSolana(input.creatorSide);
      const rate = requirePositiveBigInt(input.seedRate, "seedRate");
      const deposit = requirePositiveBigInt(input.creatorStake, "creatorStake");

      const { account, readOnly, owner, rpc } = await getSolana();

      // The creator seeds the vault from its OWN USDC ATA (create_vault_seeded pulls `deposit`
      // from user_usdc -> escrow). CreateIdempotent first so the ATA existing is never a
      // launch-order precondition; the creator pays its own rent (gasless fee payer owes none).
      const ensureAta = await buildCreateAtaIdempotentIx({ payer: owner, owner, mint: usdcMint });
      const ix = await buildCreateVaultSeededIx({
        programId,
        marketId,
        user: owner,
        usdcMint,
        question,
        seedSide,
        rate,
        deposit
      });
      const buildTx = (): unknown => buildLivestreakTransaction([ensureAta, ix]);

      // One-shot StateFull recovery: a full protocol blob rejects a new vault with the typed,
      // permissionlessly-recoverable `StateFull` fault. The fix is the permissionless grow_protocol
      // ix (payer = creator), which reallocs the market's engine-state blob one +10_240-byte rung;
      // then retry the createVault ONCE. Bounded — surface the original error if the retry still
      // fails. (VaultBoardBehind is a per-vault-board fault that createVault cannot raise: it seeds
      // a brand-new board, there are no elapsed funder boundaries to catch up on.)
      let sendResult: { hash: string };
      try {
        sendResult = await account.sendTransaction(buildTx());
      } catch (error) {
        if (detectSolanaCapacityError(error) !== "StateFull") {
          throw new LiveStreakRuntimeError({
            message: `Solana createVault failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
        try {
          const grow = await buildGrowProtocolIx({ programId, marketId, payer: owner });
          const growResult = await account.sendTransaction(buildLivestreakTransaction([grow]));
          await pollUntilUserOperationIncluded(readOnly, growResult.hash);
          sendResult = await account.sendTransaction(buildTx());
        } catch (retryError) {
          throw new LiveStreakRuntimeError({
            message: `Solana createVault failed after grow_protocol recovery: ${retryError instanceof Error ? retryError.message : String(retryError)}`
          });
        }
      }

      await pollUntilUserOperationIncluded(readOnly, sendResult.hash);

      const vaultId = await recoverVaultId(rpc, sendResult.hash);
      if (vaultId === undefined) {
        throw new LiveStreakRuntimeError({
          message: `Solana createVault did not return a decodable vault id for ${sendResult.hash}`
        });
      }
      return { txId: asTxId(sendResult.hash), vaultId };
    },

    // Solana confirms signatures directly (no pending-userOp recovery like EVM). Best-effort re-fetch
    // the transaction by signature and re-read the program return data (the deterministic vault id).
    confirmCreateVault: async (signature: TxId): Promise<CreateVaultResult | undefined> => {
      const { rpc } = await getSolana();
      try {
        const vaultId = await recoverVaultId(rpc, signature);
        return vaultId === undefined ? undefined : { txId: signature, vaultId };
      } catch {
        return undefined;
      }
    }
  };
};

// --- helpers ---

// vault_id is engine-derived (keccak(market_id ++ question ++ nonce ++ ts)) — NOT reproducible
// client-side, so recover it from the program return data: handle_create_vault_seeded returns
// `Vec<u8>`, which Anchor borsh-serializes as a 4-byte LE length prefix + the 32 raw bytes.
const recoverVaultId = async (rpc: SolanaReadRpc, signature: string): Promise<VaultId | undefined> => {
  const tx = await rpc
    .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .send();
  if (tx === null || tx.meta === null || tx.meta === undefined) {
    return undefined;
  }
  if (tx.meta.err !== null && tx.meta.err !== undefined) {
    return undefined;
  }
  const encoded = tx.meta.returnData?.data?.[0];
  if (encoded === undefined) {
    return undefined;
  }
  const bytes = new Uint8Array(base64Encoder.encode(encoded));
  // 36 bytes = borsh Vec<u8> (4-byte len + 32 payload); 32 bytes = bare payload (defensive).
  const payload = bytes.length === 36 ? bytes.subarray(4) : bytes;
  if (payload.length !== 32) {
    return undefined;
  }
  return asVaultId(hex32FromBytes(new Uint8Array(payload)));
};

// B3/B4: delegate inclusion polling + success reading to the shared wallet helper (≥60s budget,
// success read as boolean|hex|number|string). Re-map its errors to the bookmaker runtime type.
const pollUntilUserOperationIncluded = async (
  readOnly: { getUserOperationReceipt(hash: string): Promise<unknown> },
  signature: string
): Promise<unknown> => {
  try {
    return await pollUntilUserOperationIncludedShared(readOnly, signature, { timeoutMs: 60_000 });
  } catch (error) {
    if (error instanceof UserOperationPollTimeoutError) {
      throw new LiveStreakRuntimeError({
        message: `Solana createVault confirmation timed out for ${signature}`
      });
    }
    throw new LiveStreakRuntimeError({
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

// The engine's typed, recoverable capacity fault for vault origination: a full protocol blob rejects
// a new vault as `StateFull`. Anchor formats it as `Program log: AnchorError ... Error Code: StateFull
// ...` and the kit hangs those preflight lines on the error's `context.logs`. Flatten the message/cause
// chain PLUS any context.logs into one haystack and match the anchor error NAME. (VaultBoardBehind is
// listed for symmetry with the options writer but createVault seeds a fresh board and cannot raise it.)
// Pure + exported for unit tests. Self-contained per package — the writers share no module.
export type SolanaCapacityError = "StateFull" | "VaultBoardBehind";

export const detectSolanaCapacityError = (error: unknown): SolanaCapacityError | undefined => {
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
  const logs = (error as { context?: { logs?: readonly string[] } } | null)?.context?.logs ?? [];
  const haystack = [...parts, ...logs].join(" ");
  if (haystack.includes("StateFull")) return "StateFull";
  if (haystack.includes("VaultBoardBehind")) return "VaultBoardBehind";
  return undefined;
};

const requireHex32 = (id: string, field: string): string => {
  if (!SOLANA_HEX32_RE.test(id)) {
    throw new LiveStreakConfigError({
      message: `Bookmaker Solana write requires a bytes32 ${field}`,
      metadata: { details: id }
    });
  }
  return id;
};

const requireNonEmptyQuestion = (question: string): string => {
  if (typeof question !== "string" || question.length === 0) {
    throw new LiveStreakConfigError({
      message: "Solana createVault requires a non-empty question"
    });
  }
  return question;
};

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Solana createVault requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }
  return value;
};
