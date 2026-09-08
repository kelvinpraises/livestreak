import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asMarketId,
  createOptionsChain,
  createOptionsSuiConfig,
  readMarketSnapshot,
  type OptionsContractAddresses,
  type OptionsMarketSnapshot,
  type OptionsReader
} from "@livestreak/options";
import type { WalletInit } from "@livestreak/schema";
import type { CatalogChain } from "./types.js";
import type { CatalogReaderProvider } from "./catalog.js";

// host/src/services/catalog -> host root is three levels up.
const CATALOG_DIR = resolve(fileURLToPath(import.meta.url), "..");
const HOST_ROOT = resolve(CATALOG_DIR, "..", "..", "..");

const DEFAULT_EVM_SNAPSHOT = resolve(
  HOST_ROOT,
  "../packages/contracts/chains/evm/deployments/localhost.json"
);
const DEFAULT_SUI_DEPLOYMENT = resolve(
  HOST_ROOT,
  "../packages/contracts/chains/sui/deployments/localnet.json"
);

// World-known anvil dev key. Reads never sign — the options reader only ever issues
// `eth_call` against `readRpcUrl`; the seed is required by the chain-config validator but
// the wallet account is derived lazily and only for writes (which the catalog never does).
const READONLY_EVM_SEED =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface EvmDeploySnapshot {
  readonly rpc?: string;
  readonly chainId?: number | string;
  readonly scopes?: {
    readonly protocol?: { readonly contracts?: Record<string, string> };
    readonly streaming?: { readonly contracts?: Record<string, string> };
    readonly wire?: { readonly contracts?: Record<string, string> };
  };
}

const readJsonFile = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};

// Map the EVM deploy snapshot scopes onto the options contract address set.
const evmAddressesFromSnapshot = (
  snap: EvmDeploySnapshot
): OptionsContractAddresses | null => {
  const protocol = snap.scopes?.protocol?.contracts;
  const streaming = snap.scopes?.streaming?.contracts;
  const wire = snap.scopes?.wire?.contracts;
  const marketRegistry = protocol?.marketRegistry;
  const vault = protocol?.vault;
  const marketDriver = wire?.marketDriverProxy ?? wire?.marketDriverLogic;
  const stewardRegistry = protocol?.stewardRegistry;
  const treasury = protocol?.treasury;
  const lvstToken = protocol?.lvstToken;
  const dripsStreaming = streaming?.dripsStreaming;
  if (
    marketRegistry === undefined ||
    vault === undefined ||
    marketDriver === undefined ||
    stewardRegistry === undefined ||
    treasury === undefined ||
    lvstToken === undefined ||
    dripsStreaming === undefined
  ) {
    return null;
  }
  return {
    marketRegistry: marketRegistry as `0x${string}`,
    vault: vault as `0x${string}`,
    marketDriver: marketDriver as `0x${string}`,
    stewardRegistry: stewardRegistry as `0x${string}`,
    treasury: treasury as `0x${string}`,
    lvstToken: lvstToken as `0x${string}`,
    dripsStreaming: dripsStreaming as `0x${string}`
  };
};

const buildEvmReader = (): OptionsReader | null => {
  const snapshotPath = process.env.LIVESTREAK_DEPLOY_SNAPSHOT ?? DEFAULT_EVM_SNAPSHOT;
  const snap = readJsonFile<EvmDeploySnapshot>(snapshotPath);
  if (snap === null) return null;
  const addresses = evmAddressesFromSnapshot(snap);
  if (addresses === null) return null;
  const rpcUrl = process.env.LIVESTREAK_AA_RPC_URL ?? snap.rpc;
  if (rpcUrl === undefined || rpcUrl.length === 0) return null;
  const chainId = Number.parseInt(String(snap.chainId ?? 31337), 10);
  const walletInit = {
    chain: "evm",
    seedSource: "raw",
    config: { provider: rpcUrl, chainId }
  } as unknown as WalletInit;
  try {
    return createOptionsChain({
      walletInit,
      seed: READONLY_EVM_SEED,
      addresses,
      readRpcUrl: rpcUrl,
      includeProtocolSummary: true
    }).reader;
  } catch (error) {
    console.warn(`[catalog]: EVM reader unavailable — ${String(error)}`);
    return null;
  }
};

const buildSuiReader = (): OptionsReader | null => {
  const deploymentPath =
    process.env.LIVESTREAK_SUI_DEPLOYMENT ?? DEFAULT_SUI_DEPLOYMENT;
  const deployment = readJsonFile<Parameters<typeof createOptionsSuiConfig>[0]["deployment"]>(
    deploymentPath
  );
  if (deployment === null) return null;
  const rpcUrl = process.env.LIVESTREAK_SUI_RPC_URL ?? deployment.rpc;
  if (rpcUrl === undefined || rpcUrl.length === 0) return null;
  // The sponsor mnemonic is env-only (never baked); falls back to the localnet dev
  // mnemonic for reads only. Reads never sign.
  const seed =
    process.env.LIVESTREAK_SUI_SPONSOR_MNEMONIC ??
    "cargo town galaxy wonder animal digital buddy member object detect home chapter";
  try {
    const config = createOptionsSuiConfig({ deployment, seed, rpcUrl });
    return createOptionsChain(config).reader;
  } catch (error) {
    console.warn(`[catalog]: Sui reader unavailable — ${String(error)}`);
    return null;
  }
};

// Build a reader provider from the environment + deploy snapshots. Each chain reader is
// constructed once and cached; a chain with no deployment/RPC resolves to null so the
// catalog simply omits it.
export const createEnvReaderProvider = (): CatalogReaderProvider => {
  const cache = new Map<CatalogChain, OptionsReader | null>();
  const get = (chain: CatalogChain): OptionsReader | null => {
    if (!cache.has(chain)) {
      cache.set(chain, chain === "evm" ? buildEvmReader() : buildSuiReader());
    }
    return cache.get(chain) ?? null;
  };
  return {
    reader: get,
    get availableChains() {
      return (["evm", "sui"] as const).filter((c) => get(c) !== null);
    }
  };
};

// Enumerate a market's full on-chain graph for the indexer: the market shell PLUS every
// vault (via `reader.listMarketVaults` -> per-vault snapshot) PLUS the stream pointer.
// `readMarketSnapshot` already does this fan-out, so the indexer reads one market's whole
// projection in a single call; this thin export names the seam the cron depends on.
export const readMarketGraph = async (
  reader: OptionsReader,
  marketId: string
): Promise<OptionsMarketSnapshot> =>
  readMarketSnapshot(reader, asMarketId(marketId));

// Parse LIVESTREAK_CATALOG_MARKETS="evm:0x..,sui:0x.." into seed refs.
export const parseSeedMarkets = (
  raw: string | undefined
): readonly { chain: CatalogChain; marketId: string }[] => {
  if (raw === undefined || raw.trim().length === 0) return [];
  const out: { chain: CatalogChain; marketId: string }[] = [];
  for (const entry of raw.split(",")) {
    const [chainPart, marketId] = entry.split(":");
    const chain = chainPart?.trim();
    const id = marketId?.trim();
    if ((chain === "evm" || chain === "sui") && id !== undefined && id.length > 0) {
      out.push({ chain, marketId: id });
    }
  }
  return out;
};
