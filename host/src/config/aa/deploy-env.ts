import { readFileSync } from "node:fs";

// --- exports ---

const ANVIL_DEV_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

interface DeploySnapshot {
  readonly chainId?: number | string;
  readonly rpcUrl?: string;
  readonly entryPoint?: string;
  readonly safeModule?: string;
  readonly paymaster?: string;
  readonly paymasterAddress?: string;
}

export const applyDeploySnapshotEnv = (snapshotPath: string): void => {
  const raw = readFileSync(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw) as DeploySnapshot;
  const chainId = parseChainId(snapshot.chainId);

  setEnvIfUnset("LIVESTREAK_AA_CHAIN_ID", chainId === undefined ? undefined : String(chainId));
  setEnvIfUnset("LIVESTREAK_AA_RPC_URL", snapshot.rpcUrl);
  setEnvIfUnset("LIVESTREAK_AA_ENTRY_POINT", snapshot.entryPoint);
  setEnvIfUnset("LIVESTREAK_AA_SAFE_MODULE", snapshot.safeModule);
  setEnvIfUnset(
    "LIVESTREAK_AA_PAYMASTER_ADDRESS",
    snapshot.paymasterAddress ?? snapshot.paymaster
  );

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
