// --- exports ---

// Shared Solana read/context plumbing for the options leg: resolve the wallet/program/RPC context
// once, fetch raw account bytes over RPC, and decode the per-market ProtocolState engine blob into a
// byte-exact EngineView. The engine state is SHARDED PER MARKET (one ProtocolState PDA per market),
// so vault/token reads first resolve which market shard holds the id — see resolveMarketForVault.
import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  address,
  createSolanaRpc,
  decodeMarketIndexAccount,
  decodeRegistryAccount,
  findMarketIndexPda,
  findProtocolStatePda,
  findRegistryPda,
  getBase64Encoder,
  type Address,
  type Hex32,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";
import { decodeProtocolState, type EngineView } from "@livestreak/contracts/solana";

import type { TokenId, VaultId } from "../../model/ids.js";
import type { OptionsChainConfig } from "../types.js";
import { validateOptionsSolanaAddresses, type OptionsSolanaAddresses } from "./addresses.js";

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export type SolanaOptionsContext = {
  readonly rpc: SolanaRpc;
  readonly rpcUrl: string;
  readonly programId: Address;
  readonly usdcMint: Address;
  readonly solanaConfig: LiveStreakSolanaWalletConfig;
};

export const resolveSolanaContext = (config: OptionsChainConfig): SolanaOptionsContext => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana options chain requires walletInit.chain === solana"
    });
  }
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const provider = config.readRpcUrl ?? solanaConfig.provider ?? solanaConfig.rpcUrl;
  const rpcUrl = (Array.isArray(provider) ? provider[0] : provider) ?? "http://127.0.0.1:8899";
  const ids = validateOptionsSolanaAddresses(config.addresses as OptionsSolanaAddresses);
  return {
    rpc: createSolanaRpc(rpcUrl),
    rpcUrl,
    programId: address(ids.programId),
    usdcMint: address(ids.usdcMint),
    solanaConfig
  };
};

// 32-byte id plumbing. The engine stores/looks up ids as [u8; 32] rendered 0x-hex big-endian; the
// model TokenId is the same value as a bigint. These two are exact inverses.
export const tokenIdToHex32 = (tokenId: TokenId): Hex32 =>
  `0x${tokenId.toString(16).padStart(64, "0")}`;

export const vaultIdHex = (vaultId: VaultId): Hex32 =>
  (vaultId.startsWith("0x") ? vaultId : `0x${vaultId}`).toLowerCase();

// Raw account bytes over RPC; undefined when the account does not exist (reads stay off the wallet
// write path, mirroring the observe registrar + the EVM leg's public-client reads).
export const fetchAccountBytes = async (
  rpc: SolanaRpc,
  account: Address
): Promise<Uint8Array | undefined> => {
  try {
    const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
    if (value === null) return undefined;
    const [data] = value.data as [string, string];
    return new Uint8Array(getBase64Encoder().encode(data));
  } catch (error) {
    throw new LiveStreakRuntimeError({
      message: `Failed to read Solana account: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { retryable: true }
    });
  }
};

// Append-only market ledger: registry.market_count + the ["market_idx", i] enumeration PDAs, exactly
// like register_market seeds them (parity with EVM marketCount/marketIdAt).
export const listMarketIds = async (ctx: SolanaOptionsContext): Promise<Hex32[]> => {
  const [registryPda] = await findRegistryPda(ctx.programId);
  const registryBytes = await fetchAccountBytes(ctx.rpc, registryPda);
  if (registryBytes === undefined) return [];
  const registry = decodeRegistryAccount(registryBytes);
  const count = Number(registry.marketCount);
  const ids: Hex32[] = [];
  for (let index = 0; index < count; index += 1) {
    const [indexPda] = await findMarketIndexPda(ctx.programId, BigInt(index));
    const bytes = await fetchAccountBytes(ctx.rpc, indexPda);
    if (bytes === undefined) continue;
    ids.push(decodeMarketIndexAccount(bytes).marketId);
  }
  return ids;
};

// Fetch + decode the per-market engine blob, run `fn` against the view, and ALWAYS free() the wasm
// memory. Throws when the market's ProtocolState PDA is absent (market registered but init_protocol
// not yet run) — callers that tolerate that (e.g. readMarket's vault list) catch it.
export const withProtocolView = async <T>(
  ctx: SolanaOptionsContext,
  marketId: Hex32,
  fn: (view: EngineView) => T
): Promise<T> => {
  const [protocolPda] = await findProtocolStatePda(ctx.programId, marketId);
  const bytes = await fetchAccountBytes(ctx.rpc, protocolPda);
  if (bytes === undefined) {
    throw new LiveStreakConfigError({
      message: "Solana ProtocolState not found for market",
      metadata: { details: marketId }
    });
  }
  const view = await decodeProtocolState(bytes);
  try {
    return fn(view);
  } finally {
    view.free();
  }
};

// Resolve which market shard holds a vault by scanning the market ledger (the engine is per-market;
// vault ids are keccak-derived and don't encode their market). Returns undefined if no market owns it.
export const resolveMarketForVault = async (
  ctx: SolanaOptionsContext,
  vaultId: VaultId
): Promise<Hex32 | undefined> => {
  const target = vaultIdHex(vaultId);
  for (const marketId of await listMarketIds(ctx)) {
    try {
      const found = await withProtocolView(ctx, marketId, (view) =>
        view.listVaultIds().some((id) => id.toLowerCase() === target)
      );
      if (found) return marketId;
    } catch {
      // ProtocolState missing for this market — skip; another market may own the vault.
    }
  }
  return undefined;
};

// Resolve the market shard for a position token via its accrued account-vault ledger. A laneless
// (freshly minted, never funded) token has no engine footprint and resolves to undefined.
export const resolveMarketForToken = async (
  ctx: SolanaOptionsContext,
  tokenId: TokenId
): Promise<Hex32 | undefined> => {
  const tokenHex = tokenIdToHex32(tokenId);
  for (const marketId of await listMarketIds(ctx)) {
    try {
      const owned = await withProtocolView(
        ctx,
        marketId,
        (view) => view.accountVaultIds(tokenHex).length > 0 || view.laneCount(tokenHex) > 0
      );
      if (owned) return marketId;
    } catch {
      // ProtocolState missing — skip.
    }
  }
  return undefined;
};
