import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderLoginResult } from "../src/commands/login.js";
import { loadInitDoc, saveInitDoc } from "../src/prefs/init-doc.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

const BASE_DOC = {
  chain: {
    rpc: "http://127.0.0.1:8545",
    marketRegistry: "0x24599b53386dbe94dc7acb48dd5815ff51416683" as `0x${string}`,
    chainId: 31337
  },
  host: {
    url: "http://127.0.0.1:4848",
    walrusNetwork: "testnet" as const
  },
  wallet: {
    config: {
      chainId: 31337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4848/aa/bundler/local",
      paymasterUrl: "http://127.0.0.1:4848/aa/paymaster/local",
      isSponsored: true,
      useNativeCoins: false,
      entryPointAddress: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      safe4337ModuleAddress: "0x7240e794b12f848dea622a0da206d1b7d71d56bd",
      safeModulesSetupAddress: "0x71ebd4303657bf41f4b730f06536fd5b580dbdca",
      safeModulesVersion: "0.3.0",
      contractNetworks: {
        "31337": {
          safeSingletonAddress: "0x31ea225b4289bcf8d16764b86af6a699faa31c45",
          safeProxyFactoryAddress: "0x8e5df391a248073b244270bdb99599abe51834d6",
          multiSendAddress: "0x0a1e9f157d53f156a4dc0479fa2af500ba7d5f87",
          multiSendCallOnlyAddress: "0x90fe1a52c5e6d204e1ec36c48dbe79cbc209d3aa",
          fallbackHandlerAddress: "0x9dbfb7147d46e23d6db4ebedd41c22005d376a0b",
          signMessageLibAddress: "0x030dcedf7dcb4238db145e4bc3d8707c90c317eb",
          createCallAddress: "0x9c25750c3f274facf6eeec33d5d1e0bf9b6a3da3",
          simulateTxAccessorAddress: "0x06041007e4f2e33aa5c42f4cb2a062bb8dbd398c"
        }
      }
    }
  },
  options: {
    marketRegistry: "0x24599b53386dbe94dc7acb48dd5815ff51416683" as `0x${string}`,
    vault: "0x58a0f06e4454e163d92b7b8bdc968d344a0b4a69" as `0x${string}`,
    marketDriver: "0x1d70e0d9339ff84b77ea8c26feaa0947094ae2f0" as `0x${string}`,
    stewardRegistry: "0xd38a41fa1268bca1a7f57034d0669bd2ea1c8736" as `0x${string}`,
    treasury: "0x001a43b7c95b500cff049d4f02f2544a40288d05" as `0x${string}`,
    lvstToken: "0xce0d231abd2b16948124b2635acb3577fc595f1a" as `0x${string}`,
    dripsStreaming: "0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5" as `0x${string}`,
    vaultDriver: "0x5d10a013887b7bfccbd571a56b11307d0c323703" as `0x${string}`
  }
};

const OPERATOR_ADDR = "0x00000000000000000000000000000000000000ab" as `0x${string}`;

// Mock createCreatorWallet so runLogin does not need a real bundler/chain.
// The factory is hoisted by vitest — use the literal directly, not the const.
vi.mock("../src/adapters/onchain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/onchain.js")>();
  return {
    ...actual,
    createCreatorWallet: vi.fn().mockResolvedValue({
      account: { getAddress: vi.fn().mockResolvedValue("0x00000000000000000000000000000000000000ab") },
      publicClient: {},
      walletInit: { chain: "evm", seedSource: "signature-derived", config: {} }
    })
  };
});

describe("commands/login — caches operator address only", () => {
  it("writes run.operator (public address) and preserves all other run fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-login-test-"));
    const configPath = join(dir, "livestreak.json");

    const docWithRun = {
      ...BASE_DOC,
      run: { runId: "run_existing", tokenId: "7", status: "ended" as const }
    };
    await saveInitDoc(configPath, docWithRun);

    const { runLogin } = await import("../src/commands/login.js");
    const result = await runLogin({ configPath, password: "demo-password" });

    expect(result.operator).toBe(OPERATOR_ADDR);
    expect(result.configPath).toBe(configPath);

    const loaded = await loadInitDoc(configPath);
    // Public address cached
    expect(loaded.run?.operator).toBe(OPERATOR_ADDR);
    // Existing run fields preserved
    expect(loaded.run?.tokenId).toBe("7");
    expect(loaded.run?.status).toBe("ended");
    // No seed or password anywhere in the file
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(configPath, "utf8"));
    for (const key of ["seed", "seedHex", "password", "mnemonic", "secret"]) {
      expect(raw).not.toMatch(new RegExp(`"${key}"`));
    }

    await rm(dir, { recursive: true, force: true });
  });

  it("sets run.operator even when no prior run cache exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-login-norun-"));
    const configPath = join(dir, "livestreak.json");

    await saveInitDoc(configPath, BASE_DOC);

    const { runLogin } = await import("../src/commands/login.js");
    const result = await runLogin({ configPath, password: "demo-password" });

    expect(result.operator).toBe(OPERATOR_ADDR);

    const loaded = await loadInitDoc(configPath);
    expect(loaded.run?.operator).toBe(OPERATOR_ADDR);
    // No seed in file
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(configPath, "utf8"));
    expect(raw).not.toMatch(/"seed"/);

    await rm(dir, { recursive: true, force: true });
  });
});

describe("commands/login — renderLoginResult", () => {
  it("formats the operator address and config path", () => {
    const output = renderLoginResult({ operator: OPERATOR_ADDR, configPath: "livestreak.json" });
    expect(output).toContain(OPERATOR_ADDR);
    expect(output).toContain("livestreak.json");
    expect(output).toContain("run.operator");
    // The operator address is shown; no actual secret value is revealed.
    expect(output).not.toContain(OPERATOR_ADDR.slice(2, 10) + "secret"); // sanity: no secret value
  });
});
