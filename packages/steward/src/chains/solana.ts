// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build + send Solana txns VIA @livestreak/wallet (the single @solana/* owner).
import {
  address,
  buildLivestreakTransaction,
  buildResolveIx,
  createSolanaRpc,
  createWalletManager,
  decodeMarketIndexAccount,
  decodeRegistryAccount,
  findMarketIndexPda,
  findMarketStewardPda,
  findProtocolStatePda,
  findRegistryPda,
  getBase64Encoder,
  pollUntilUserOperationIncluded,
  type Address,
  type Hex32,
  type Instruction,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";
import { decodeProtocolState } from "@livestreak/contracts/solana";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { validateStewardSolanaAddresses, type StewardChainConfig } from "./types.js";

// The steward domain outcome enum (YES = 1, NO = 2) maps onto the engine's side enum
// (SIDE_YES = 0, SIDE_NO = 1) — a simple `outcome - 1`, validated so a bad outcome aborts
// at the boundary instead of tripping the on-chain `valid_side` guard.
const outcomeToWinningSide = (outcome: number): number => {
  if (outcome !== 1 && outcome !== 2) {
    throw new LiveStreakConfigError({
      message: `Steward Solana resolve requires outcome YES(1) or NO(2)`,
      metadata: { details: String(outcome) }
    });
  }
  return outcome - 1;
};

type SolanaAccount = {
  getAddress(): Promise<string>;
  sendTransaction(tx: ReturnType<typeof buildLivestreakTransaction>): Promise<{ hash: string }>;
  toReadOnlyAccount(): Promise<{ getUserOperationReceipt(hash: string): Promise<unknown> }>;
};

export const createSolanaStewardExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana steward executor requires walletInit.chain === solana"
    });
  }
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const addresses = validateStewardSolanaAddresses(config.addresses);
  const programId = address(addresses.programId);

  const rpcTarget = pickRpcTarget(solanaConfig);
  if (rpcTarget === undefined) {
    throw new LiveStreakConfigError({
      message: "Solana steward executor requires walletInit.config.provider (RPC url) for market reads"
    });
  }
  const rpc = createSolanaRpc(rpcTarget);

  // OPT.rederive: derive the wallet account ONCE per executor (deterministic), reuse across calls.
  let accountPromise: Promise<SolanaAccount> | undefined;
  const getAccount = () =>
    (accountPromise ??= createWalletManager("solana", config.seed, solanaConfig).getAccount() as Promise<SolanaAccount>);

  return {
    chain: "solana",
    executeContractCall: async (call: StewardContractCall): Promise<{ readonly txId: string }> => {
      // Only `resolve` has an on-chain Solana target. `triggerHot` has no counterpart — the program
      // has no hot-governance instruction — so it is surfaced clearly rather than silently no-op'd,
      // mirroring the Sui/EVM taxonomy for kinds without a settled target.
      if (!(call.contract === "vault" && call.functionName === "resolve")) {
        throw new LiveStreakConfigError({
          message: `Steward Solana executor does not support ${call.contract}.${call.functionName} yet`
        });
      }

      const [vaultId, outcome] = call.args;
      // The engine is market-partitioned while the domain call carries only the vaultId — resolve
      // the owning market from the on-chain ledger (options-leg parity), keeping the executor
      // market-agnostic like EVM/Sui.
      const marketId = await resolveMarketForVault(rpc, programId, vaultId);
      if (marketId === undefined) {
        throw new LiveStreakRuntimeError({
          message: "Steward Solana resolve: no market owns this vault",
          metadata: { details: vaultId }
        });
      }

      const account = await getAccount();
      const steward = address(await account.getAddress());
      const marketSteward = await resolveMarketStewardOverride(rpc, programId, marketId);

      const ix: Instruction = await buildResolveIx({
        programId,
        marketId,
        steward,
        vaultId,
        winningSide: outcomeToWinningSide(outcome),
        ...(marketSteward === undefined ? {} : { marketSteward })
      });

      try {
        const { hash } = await account.sendTransaction(buildLivestreakTransaction([ix]));
        // Await INCLUSION, not just submission — the drive's withdraw follows immediately and its
        // preflight must see the resolved state (races surfaced as phantom VaultNotResolved).
        await pollUntilUserOperationIncluded(await account.toReadOnlyAccount(), hash);
        return { txId: hash };
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Steward Solana ${call.functionName} failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
  };
};

// --- helpers ---

type SolanaRpc = ReturnType<typeof createSolanaRpc>;

// The vendored account reads its RPC from `provider` (preferred) or the `rpcUrl` alias; either may
// be a failover list — the first entry is enough for a read.
const pickRpcTarget = (config: LiveStreakSolanaWalletConfig): string | undefined => {
  const raw = (config as { provider?: string | string[]; rpcUrl?: string | string[] });
  const target = raw.provider ?? raw.rpcUrl;
  return Array.isArray(target) ? target[0] : target;
};

const fetchAccountBytes = async (rpc: SolanaRpc, account: Address): Promise<Uint8Array | undefined> => {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  if (value === null) return undefined;
  const [data] = value.data as [string, string];
  return new Uint8Array(getBase64Encoder().encode(data));
};

// Scan the append-only market ledger (registry.market_count + market_idx PDAs) and find the
// shard whose engine state owns the vault. Dev-scale linear scan; Option E sharding revisits.
const resolveMarketForVault = async (
  rpc: SolanaRpc,
  programId: Address,
  vaultId: string
): Promise<Hex32 | undefined> => {
  const target = vaultId.toLowerCase();
  const [registryPda] = await findRegistryPda(programId);
  const registryBytes = await fetchAccountBytes(rpc, registryPda);
  if (registryBytes === undefined) return undefined;
  const count = Number(decodeRegistryAccount(registryBytes).marketCount);
  for (let index = 0; index < count; index += 1) {
    const [indexPda] = await findMarketIndexPda(programId, BigInt(index));
    const indexBytes = await fetchAccountBytes(rpc, indexPda);
    if (indexBytes === undefined) continue;
    const marketId = decodeMarketIndexAccount(indexBytes).marketId;
    const [protocolPda] = await findProtocolStatePda(programId, marketId);
    const stateBytes = await fetchAccountBytes(rpc, protocolPda);
    if (stateBytes === undefined) continue;
    const view = await decodeProtocolState(stateBytes);
    try {
      if (view.listVaultIds().some((id) => id.toLowerCase() === target)) return marketId;
    } finally {
      view.free();
    }
  }
  return undefined;
};

// Anchor's optional-account convention: pass the override PDA only when it EXISTS on-chain,
// otherwise omit it (the builder fills the slot with the program id = `None`, and the program
// falls back to the registry default steward).
const resolveMarketStewardOverride = async (
  rpc: SolanaRpc,
  programId: Address,
  marketId: Hex32
): Promise<Address | undefined> => {
  const [pda] = await findMarketStewardPda(programId, marketId);
  const bytes = await fetchAccountBytes(rpc, pda);
  return bytes === undefined ? undefined : pda;
};
