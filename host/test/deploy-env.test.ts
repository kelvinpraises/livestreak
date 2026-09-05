import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyDeploySnapshotEnv } from "#config/aa/deploy-env.js";

const HOST_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const LOCALHOST_SNAPSHOT = resolve(
  HOST_ROOT,
  "../packages/contracts/chains/evm/deployments/localhost.json"
);

const ENV_KEYS = [
  "LIVESTREAK_AA_CHAIN_ID",
  "LIVESTREAK_AA_RPC_URL",
  "LIVESTREAK_AA_ENTRY_POINT",
  "LIVESTREAK_AA_SAFE_MODULE",
  "LIVESTREAK_AA_PAYMASTER_ADDRESS",
  "LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY"
] as const;

const snapshot = () => JSON.parse(readFileSync(LOCALHOST_SNAPSHOT, "utf8")) as {
  chainId: number;
  rpc: string;
  scopes: {
    aa: { contracts: { entryPoint: string; safe4337Module: string } };
    paymaster: { contracts: { verifyingPaymaster: string } };
  };
};

describe("applyDeploySnapshotEnv", () => {
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("reads nested deploy snapshot scopes into AA env vars", () => {
    for (const key of ENV_KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }

    applyDeploySnapshotEnv(LOCALHOST_SNAPSHOT);

    const data = snapshot();
    expect(process.env.LIVESTREAK_AA_CHAIN_ID).toBe(String(data.chainId));
    expect(process.env.LIVESTREAK_AA_RPC_URL).toBe(data.rpc);
    expect(process.env.LIVESTREAK_AA_ENTRY_POINT).toBe(data.scopes.aa.contracts.entryPoint);
    expect(process.env.LIVESTREAK_AA_SAFE_MODULE).toBe(data.scopes.aa.contracts.safe4337Module);
    expect(process.env.LIVESTREAK_AA_PAYMASTER_ADDRESS).toBe(
      data.scopes.paymaster.contracts.verifyingPaymaster
    );
  });

  it("does not overwrite env vars that are already set", () => {
    for (const key of ENV_KEYS) {
      previous.set(key, process.env[key]);
    }

    process.env.LIVESTREAK_AA_RPC_URL = "http://custom-rpc.example";
    applyDeploySnapshotEnv(LOCALHOST_SNAPSHOT);

    expect(process.env.LIVESTREAK_AA_RPC_URL).toBe("http://custom-rpc.example");
    expect(process.env.LIVESTREAK_AA_ENTRY_POINT).toBe(snapshot().scopes.aa.contracts.entryPoint);
  });
});
