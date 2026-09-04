import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSeedFromPassword, resolveOperator } from "../src/gateway/identity.js";

describe("gateway/identity", () => {
  it("derives a deterministic seed from password", () => {
    const first = deriveSeedFromPassword("demo-password");
    const second = deriveSeedFromPassword("demo-password");
    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
  });

  it("rejects missing password loudly", () => {
    expect(() => resolveOperator("")).toThrow(/password required/i);
  });
});

describe("prefs/init-doc", () => {
  it("round-trips and never serializes the seed", async () => {
    const { loadInitDoc, saveInitDoc } = await import("../src/prefs/init-doc.js");
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-"));
    const path = join(dir, "livestreak.json");

    const doc = {
      chain: {
        rpc: "http://127.0.0.1:8545",
        marketRegistry: "0x24599b53386dbe94dc7acb48dd5815ff51416683",
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
          bundlerUrl: "http://127.0.0.1:4337",
          isSponsored: true,
          useNativeCoins: false,
          entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
          safe4337ModuleAddress: "0x7240e794b12f848dea622a0da206d1b7d71d56bd",
          safeModulesSetupAddress: "0x71ebd4303657bf41f4b730f06536fd5b580dbdca",
          safeModulesVersion: "0.3.0",
          contractNetworks: {}
        }
      },
      options: {
        vault: "0x4b7ce2a2a0d73aec573ff7b559cf9f1cc942cc38",
        marketDriver: "0x84a89612fcd2f84edc6d2f19062c4a01988229d7",
        stewardRegistry: "0x45c4150c9ffed32abfc1e16869789d8602bc8f76",
        treasury: "0x001a43b7c95b500cff049d4f02f2544a40288d05",
        lvstToken: "0xce0d231abd2b16948124b2635acb3577fc595f1a",
        dripsStreaming: "0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5",
        vaultDriver: "0x5700bcfa34292645feb4749be2b922ebeffd5099"
      },
      run: {
        runId: "run_test",
        tokenId: "42",
        status: "ended" as const
      }
    };

    await saveInitDoc(path, doc);
    const raw = await readFile(path, "utf8");
    expect(raw).not.toMatch(/"seed"/);
    const loaded = await loadInitDoc(path);
    expect(loaded.options.marketRegistry).toBe(doc.chain.marketRegistry);
    expect(loaded.options.vaultDriver).toBe(doc.options.vaultDriver);
    expect(loaded.run?.tokenId).toBe("42");

    await rm(dir, { recursive: true, force: true });
  });
});
