import { readFileSync } from "node:fs";

// --- exports ---

const ANVIL_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface DeployScope {
  readonly contracts?: Record<string, string>;
}

interface DeploySnapshot {
  readonly chainId?: number | string;
  readonly rpc?: string;
  readonly scopes?: {
    readonly aa?: DeployScope;
    readonly paymaster?: DeployScope;
  };
}

export const applyDeploySnapshotEnv = (snapshotPath: string): void => {
  const raw = readFileSync(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw) as DeploySnapshot;
  const chainId = parseChainId(snapshot.chainId);
  const aa = snapshot.scopes?.aa?.contracts;
  const paymaster = snapshot.scopes?.paymaster?.contracts;

  setEnvIfUnset("LIVESTREAK_AA_CHAIN_ID", chainId === undefined ? undefined : String(chainId));
  setEnvIfUnset("LIVESTREAK_AA_RPC_URL", snapshot.rpc);
  setEnvIfUnset("LIVESTREAK_AA_ENTRY_POINT", aa?.entryPoint);
  setEnvIfUnset("LIVESTREAK_AA_SAFE_MODULE", aa?.safe4337Module);
  setEnvIfUnset("LIVESTREAK_AA_PAYMASTER_ADDRESS", paymaster?.verifyingPaymaster);

  if (chainId === 31337 && process.env.LIVESTREAK_AA_ALLOW_DEV_KEY === "1") {
    if (process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY === undefined) {
      console.warn(
        "[host]: LIVESTREAK_AA_ALLOW_DEV_KEY=1 — injecting world-known anvil dev executor key"
      );
      process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY = ANVIL_DEV_KEY;
    }
  }
};

// --- helpers ---

const setEnvIfUnset = (key: string, value: string | undefined): void => {
  if (value === undefined || value.length === 0) {
    return;
  }

  if (process.env[key] === undefined || process.env[key]?.length === 0) {
    process.env[key] = value;
  }
};

const parseChainId = (value: number | string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
