import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { loadInitDoc } from "../src/prefs/init-doc.js";

// A minimal deploy file matching packages/contracts/chains/evm/deployments/localhost.json shape.
const SAMPLE_DEPLOY = {
  chain: "localhost",
  chainId: 31337,
  rpc: "http://127.0.0.1:8545",
  scopes: {
    aa: {
      status: "completed",
      contracts: {
        entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032",
        safeSingleton: "0x31ea225b4289bcf8d16764b86af6a699faa31c45",
        safeProxyFactory: "0x8e5df391a248073b244270bdb99599abe51834d6",
        safeModuleSetup: "0x71ebd4303657bf41f4b730f06536fd5b580dbdca",
        safe4337Module: "0x7240e794b12f848dea622a0da206d1b7d71d56bd",
        multiSend: "0x0a1e9f157d53f156a4dc0479fa2af500ba7d5f87",
        multiSendCallOnly: "0x90fe1a52c5e6d204e1ec36c48dbe79cbc209d3aa",
        fallbackHandler: "0x9dbfb7147d46e23d6db4ebedd41c22005d376a0b",
        signMessageLib: "0x030dcedf7dcb4238db145e4bc3d8707c90c317eb",
        createCall: "0x9c25750c3f274facf6eeec33d5d1e0bf9b6a3da3",
        simulateTxAccessor: "0x06041007e4f2e33aa5c42f4cb2a062bb8dbd398c"
      }
    },
    streaming: {
      status: "completed",
      contracts: {
        dripsStreaming: "0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5"
      }
    },
    protocol: {
      status: "completed",
      contracts: {
        marketRegistry: "0x24599b53386dbe94dc7acb48dd5815ff51416683",
        vault: "0x58a0f06e4454e163d92b7b8bdc968d344a0b4a69",
        lvstToken: "0xce0d231abd2b16948124b2635acb3577fc595f1a",
        treasury: "0x001a43b7c95b500cff049d4f02f2544a40288d05",
        stewardRegistry: "0xd38a41fa1268bca1a7f57034d0669bd2ea1c8736"
      }
    },
    wire: {
      status: "completed",
      contracts: {
        vaultDriver: "0x5d10a013887b7bfccbd571a56b11307d0c323703",
        marketDriverLogic: "0xfceff8892bf6f25aba4e53b1c25cb149239deb2c",
        marketDriverProxy: "0x1d70e0d9339ff84b77ea8c26feaa0947094ae2f0"
      }
    }
  }
};

// /aa/descriptor advertises the bundler path under the host's routeKey ("local"), not the chainId.
// Mirrors what the host actually emits (HOST.H5): a BARE top-level `paymasterPath`
// for back-compat AND a per-chain `chains[].paymasterPath` scoped to the routeKey.
// The CLI must build paymasterUrl from the per-chain field, not the bare top-level one.
const aaDescriptorBody = {
  version: "0.1.0",
  hostId: "host_dev",
  sponsorshipMode: "sponsored",
  supportedOperations: [],
  paymasterPath: "/aa/paymaster",
  chains: [
    {
      chainId: 31337,
      name: "localhost",
      entryPoint: "0x0000000071727de22e5e9d8baf0edac6f37da032",
      safeModule: "0x7240e794b12f848dea622a0da206d1b7d71d56bd",
      bundlerPath: "/aa/bundler/local",
      paymasterPath: "/aa/paymaster/local",
      rpcUrl: "http://127.0.0.1:8545"
    }
  ]
};

// Fake host: /descriptor (walrus.network) + /aa/descriptor (bundler/paymaster paths).
const mockFetch = async (url: string | URL | Request): Promise<Response> => {
  const path = new URL(String(url)).pathname;
  if (path === "/descriptor") {
    return new Response(
      JSON.stringify({
        baseUrl: "http://127.0.0.1:4848",
        walrus: { network: "testnet" }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (path === "/aa/descriptor") {
    return new Response(JSON.stringify(aaDescriptorBody), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return new Response("not found", { status: 404 });
};

// runInit uses createHostClient internally, which uses the global `fetch`.
// We patch it onto globalThis for the duration of these tests.
const withMockFetch = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
};

describe("commands/init — deploy file → init-doc mapping", () => {
  it("maps all fields correctly from a sample deploy file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-test-"));
    const deployPath = join(dir, "deploy.json");
    const outPath = join(dir, "livestreak.json");

    await writeFile(deployPath, JSON.stringify(SAMPLE_DEPLOY), "utf8");

    const doc = await withMockFetch(() =>
      runInit({ deploymentPath: deployPath, hostUrl: "http://127.0.0.1:4848", outPath })
    );

    // Chain
    expect(doc.chain.rpc).toBe("http://127.0.0.1:8545");
    expect(doc.chain.chainId).toBe(31337);
    expect(doc.chain.marketRegistry).toBe("0x24599b53386dbe94dc7acb48dd5815ff51416683");

    // Options — proxy not logic
    expect(doc.options.marketDriver).toBe("0x1d70e0d9339ff84b77ea8c26feaa0947094ae2f0");
    expect(doc.options.vaultDriver).toBe("0x5d10a013887b7bfccbd571a56b11307d0c323703");
    expect(doc.options.dripsStreaming).toBe("0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5");
    expect(doc.options.vault).toBe("0x58a0f06e4454e163d92b7b8bdc968d344a0b4a69");
    expect(doc.options.stewardRegistry).toBe("0xd38a41fa1268bca1a7f57034d0669bd2ea1c8736");
    expect(doc.options.treasury).toBe("0x001a43b7c95b500cff049d4f02f2544a40288d05");
    expect(doc.options.lvstToken).toBe("0xce0d231abd2b16948124b2635acb3577fc595f1a");

    // Wallet config — AA addresses from scopes.aa.contracts
    expect(doc.wallet.config.entryPointAddress).toBe("0x0000000071727de22e5e9d8baf0edac6f37da032");
    expect(doc.wallet.config.safe4337ModuleAddress).toBe("0x7240e794b12f848dea622a0da206d1b7d71d56bd");
    expect(doc.wallet.config.safeModulesSetupAddress).toBe("0x71ebd4303657bf41f4b730f06536fd5b580dbdca");
    // bundler/paymaster come from /aa/descriptor (routeKey "local"), NOT the chainId
    expect(doc.wallet.config.bundlerUrl).toBe("http://127.0.0.1:4848/aa/bundler/local");
    expect(doc.wallet.config.paymasterUrl).toBe("http://127.0.0.1:4848/aa/paymaster/local");

    // contractNetworks keyed by chainId string
    const net = doc.wallet.config.contractNetworks?.["31337"];
    expect(net).toBeDefined();
    expect((net as Record<string, unknown>)["safeSingletonAddress"]).toBe(
      "0x31ea225b4289bcf8d16764b86af6a699faa31c45"
    );
    expect((net as Record<string, unknown>)["safeProxyFactoryAddress"]).toBe(
      "0x8e5df391a248073b244270bdb99599abe51834d6"
    );

    // Host — walrus.network from /descriptor since no --network flag
    expect(doc.host.walrusNetwork).toBe("testnet");
    expect(doc.host.url).toBe("http://127.0.0.1:4848");

    await rm(dir, { recursive: true, force: true });
  });

  it("--network overrides walrus.network but /aa/descriptor is still read for bundler paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-net-"));
    const deployPath = join(dir, "deploy.json");
    const outPath = join(dir, "livestreak.json");

    await writeFile(deployPath, JSON.stringify(SAMPLE_DEPLOY), "utf8");

    const doc = await withMockFetch(() =>
      runInit({
        deploymentPath: deployPath,
        hostUrl: "http://127.0.0.1:4848",
        network: "mainnet",
        outPath
      })
    );

    expect(doc.host.walrusNetwork).toBe("mainnet");
    expect(doc.wallet.config.bundlerUrl).toBe("http://127.0.0.1:4848/aa/bundler/local");

    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips: saved file loads back as identical LivestreakInitDoc", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-rt-"));
    const deployPath = join(dir, "deploy.json");
    const outPath = join(dir, "livestreak.json");

    await writeFile(deployPath, JSON.stringify(SAMPLE_DEPLOY), "utf8");

    const written = await withMockFetch(() =>
      runInit({ deploymentPath: deployPath, hostUrl: "http://127.0.0.1:4848", outPath })
    );

    const loaded = await loadInitDoc(outPath);
    expect(loaded.chain.chainId).toBe(written.chain.chainId);
    expect(loaded.options.marketDriver).toBe(written.options.marketDriver);
    expect(loaded.wallet.config.entryPointAddress).toBe(written.wallet.config.entryPointAddress);

    await rm(dir, { recursive: true, force: true });
  });

  it("refuses to persist forbidden keys in the output file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-sec-"));
    const deployPath = join(dir, "deploy.json");
    const outPath = join(dir, "livestreak.json");

    await writeFile(deployPath, JSON.stringify(SAMPLE_DEPLOY), "utf8");

    await withMockFetch(() =>
      runInit({ deploymentPath: deployPath, hostUrl: "http://127.0.0.1:4848", outPath })
    );

    const raw = await readFile(outPath, "utf8");
    for (const key of ["seed", "seedHex", "password", "mnemonic", "secret"]) {
      expect(raw).not.toMatch(new RegExp(`"${key}"`));
    }

    await rm(dir, { recursive: true, force: true });
  });

  it("throws a clear error on malformed JSON in the deploy file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-bad-"));
    const deployPath = join(dir, "bad.json");
    const outPath = join(dir, "livestreak.json");

    await writeFile(deployPath, "{ not json {{", "utf8");

    await expect(
      runInit({ deploymentPath: deployPath, hostUrl: "http://127.0.0.1:4848", outPath })
    ).rejects.toThrow(/malformed json/i);

    await rm(dir, { recursive: true, force: true });
  });

  it("throws a clear error when a required scope is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-init-missing-"));
    const deployPath = join(dir, "missing.json");
    const outPath = join(dir, "livestreak.json");

    const broken = { ...SAMPLE_DEPLOY, scopes: { ...SAMPLE_DEPLOY.scopes, wire: undefined } };
    await writeFile(deployPath, JSON.stringify(broken), "utf8");

    await expect(
      runInit({
        deploymentPath: deployPath,
        hostUrl: "http://127.0.0.1:4848",
        network: "testnet",
        outPath
      })
    ).rejects.toThrow(/scopes\.wire/i);

    await rm(dir, { recursive: true, force: true });
  });
});
