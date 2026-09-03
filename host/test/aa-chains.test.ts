import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readChainsFromFile } from "#config/aa/chains-file.js";
import { applyDeploySnapshotEnv } from "#config/aa/deploy-env.js";
import { readAaServerConfig } from "#services/aa/chains.js";
import { defaultHostServerConfig } from "#config/host.js";

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

describe("aa deploy env", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("does not inject dev executor key unless opt-in", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-deploy-"));
    const snapshotPath = join(dir, "localhost.json");
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545",
        entryPoint: "0x0000000000000000000000000000000000000001"
      })
    );

    delete process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY;
    delete process.env.LIVESTREAK_AA_ALLOW_DEV_KEY;
    applyDeploySnapshotEnv(snapshotPath);
    expect(process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY).toBeUndefined();
  });

  it("injects dev executor key only when chainId 31337 and opt-in", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-deploy-"));
    const snapshotPath = join(dir, "localhost.json");
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        chainId: 31337,
        rpcUrl: "http://127.0.0.1:8545"
      })
    );

    delete process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY;
    process.env.LIVESTREAK_AA_ALLOW_DEV_KEY = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    applyDeploySnapshotEnv(snapshotPath);
    expect(process.env.LIVESTREAK_AA_EXECUTOR_PRIVATE_KEY).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
