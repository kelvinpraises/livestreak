import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readChainsFromFile } from "#config/aa/chains-file.js";
import type { DeploySnapshotConfig } from "#config/aa/deploy-env.js";
import { readAaServerConfig } from "#services/aa/chains.js";
import { defaultHostServerConfig } from "#config/host.js";

const localChain = (aa: ReturnType<typeof readAaServerConfig>) =>
  aa.chains.find((c) => c.routeKey === "local");

describe("aa chains file", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("rejects duplicate routeKey entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-chains-"));
    const filePath = join(dir, "chains.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        { routeKey: "a", chainId: 1, name: "a", entryPoint: "0x0000000000000000000000000000000000000001" },
        { routeKey: "a", chainId: 2, name: "b", entryPoint: "0x0000000000000000000000000000000000000002" }
      ])
    );

    expect(() => readChainsFromFile(filePath)).toThrow(/duplicate_routeKey/);
  });

  it("rejects malformed executor private keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-chains-"));
    const filePath = join(dir, "chains.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          routeKey: "local",
          chainId: 31337,
          name: "local",
          entryPoint: "0x0000000000000000000000000000000000000001",
          executorPrivateKey: "0xnot-a-key"
        }
      ])
    );

    expect(() => readChainsFromFile(filePath)).toThrow(/invalid_hex/);
  });

  it("resolves executorKeyEnv from process.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-chains-"));
    const filePath = join(dir, "chains.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          routeKey: "local",
          chainId: 31337,
          name: "local",
          entryPoint: "0x0000000000000000000000000000000000000001",
          executorKeyEnv: "TEST_EXECUTOR_ENV"
        }
      ])
    );

    process.env.TEST_EXECUTOR_ENV =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const chains = readChainsFromFile(filePath);
    expect(chains[0]?.executorPrivateKey).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
  });
});

describe("aa deploy env merge", () => {
  const envSnapshot = { ...process.env };
  const cleanAaEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("LIVESTREAK_AA_")) delete process.env[key];
    }
  };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  const snapshot: DeploySnapshotConfig = {
    chainId: 31337,
    rpcUrl: "http://snapshot-rpc.example",
    entryPoint: "0x00000000000000000000000000000000000000e1",
    safeModule: "0x00000000000000000000000000000000000000a1",
    paymasterAddress: "0x00000000000000000000000000000000000000b1"
  };

  it("fills gaps from the snapshot when the env is unset", () => {
    cleanAaEnv();
    const aa = readAaServerConfig(defaultHostServerConfig(), snapshot);
    const chain = localChain(aa);
    expect(chain?.rpcUrl).toBe(snapshot.rpcUrl);
    expect(chain?.entryPoint).toBe(snapshot.entryPoint);
    expect(chain?.safeModule).toBe(snapshot.safeModule);
    expect(chain?.paymasterAddress).toBe(snapshot.paymasterAddress);
    expect(chain?.chainId).toBe(31337);
  });

  it("lets env win over the snapshot", () => {
    cleanAaEnv();
    process.env.LIVESTREAK_AA_RPC_URL = "http://env-rpc.example";
    process.env.LIVESTREAK_AA_ENTRY_POINT = "0x00000000000000000000000000000000000000ff";
    const aa = readAaServerConfig(defaultHostServerConfig(), snapshot);
    const chain = localChain(aa);
    expect(chain?.rpcUrl).toBe("http://env-rpc.example");
    expect(chain?.entryPoint).toBe("0x00000000000000000000000000000000000000ff");
    // still fills the untouched fields from the snapshot
    expect(chain?.safeModule).toBe(snapshot.safeModule);
  });

  it("does not inject the dev executor key unless opted in", () => {
    cleanAaEnv();
    const aa = readAaServerConfig(defaultHostServerConfig(), snapshot);
    expect(localChain(aa)?.executorPrivateKey).toBeUndefined();
  });

  it("injects the dev executor key only when chainId 31337 and opt-in", () => {
    cleanAaEnv();
    process.env.LIVESTREAK_AA_ALLOW_DEV_KEY = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const aa = readAaServerConfig(defaultHostServerConfig(), snapshot);
    expect(localChain(aa)?.executorPrivateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not inject the dev key on a non-31337 chain even when opted in", () => {
    cleanAaEnv();
    process.env.LIVESTREAK_AA_ALLOW_DEV_KEY = "1";
    const aa = readAaServerConfig(defaultHostServerConfig(), { ...snapshot, chainId: 1 });
    expect(localChain(aa)?.executorPrivateKey).toBeUndefined();
  });
});

describe("aa chains merge", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("merges env local chain with file chains and warns on duplicate routeKey", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-chains-"));
    const filePath = join(dir, "chains.json");
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          routeKey: "local",
          chainId: 31337,
          name: "file-local",
          entryPoint: "0x0000000000000000000000000000000000000001",
          rpcUrl: "http://127.0.0.1:8545"
        },
        {
          routeKey: "other",
          chainId: 1,
          name: "other",
          entryPoint: "0x0000000000000000000000000000000000000002",
          rpcUrl: "http://127.0.0.1:8546"
        }
      ])
    );

    process.env.LIVESTREAK_AA_CHAINS_FILE = filePath;
    process.env.LIVESTREAK_AA_RPC_URL = "http://127.0.0.1:8545";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const aa = readAaServerConfig(defaultHostServerConfig());
    expect(aa.chains).toHaveLength(2);
    expect(aa.chains.find((c) => c.routeKey === "local")?.name).toBe("file-local");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
