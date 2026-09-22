import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readOptionalEnv } from "./env.js";

// --- exports ---

// The committed localnet deploy snapshot the host reads to learn the mock USDC mint (the honest
// advertised fee token) and the mint-authority address (the deployer). Mirrors the path convention
// in services/catalog/readers.ts so both readers point at the same artifact.
const CONFIG_DIR = resolve(fileURLToPath(import.meta.url), "..");
const HOST_ROOT = resolve(CONFIG_DIR, "..", "..");

const DEFAULT_SOLANA_DEPLOYMENT = resolve(
  HOST_ROOT,
  "../packages/contracts/chains/solana/deployments/localnet.json"
);

export interface SolanaDeployment {
  /** RPC recorded at deploy time (localnet: http://127.0.0.1:8899). */
  readonly rpc: string;
  /** Mock USDC SPL mint — the honest fee token under the free-price in-process signer. */
  readonly usdcMint: string;
  /** Mint authority for the mock USDC mint (deploy/main.ts sets authority = deployer). */
  readonly deployer: string;
  readonly programId: string;
}

interface RawSolanaDeployment {
  readonly rpc?: string;
  readonly deployer?: string;
  readonly programId?: string;
  readonly accounts?: { readonly usdcMint?: string };
}

export const readSolanaDeployment = (): SolanaDeployment | null => {
  const path = readOptionalEnv("LIVESTREAK_SOLANA_DEPLOYMENT") ?? DEFAULT_SOLANA_DEPLOYMENT;
  let raw: RawSolanaDeployment;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as RawSolanaDeployment;
  } catch {
    return null;
  }

  const rpc = raw.rpc;
  const usdcMint = raw.accounts?.usdcMint;
  const deployer = raw.deployer;
  const programId = raw.programId;
  if (
    rpc === undefined ||
    usdcMint === undefined ||
    deployer === undefined ||
    programId === undefined
  ) {
    return null;
  }

  return { rpc, usdcMint, deployer, programId };
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);

// Localnet = the solana RPC points at a loopback host. The faucet mints/airdrops freely, so it is
// hard-gated on this: a non-loopback RPC (devnet/mainnet) has no mock mint and no free airdrop and
// must never be mintable through the host.
export const isLocalnetSolanaRpc = (rpcUrl: string): boolean => {
  try {
    const { hostname } = new URL(rpcUrl);
    const host = hostname.trim().toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
  } catch {
    return false;
  }
};
