import type { Hex } from "viem";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { createAaRouteDeps } from "#deps.js";
import { createPaymasterSigner } from "#services/aa/paymaster.js";
import { createAaController } from "#api/controllers/aa.js";
import { readAaServerConfig } from "#services/aa/chains.js";
import { createDiscoveryStore } from "#services/discovery.js";
import { handleFindSimilar, handleIndexVault } from "#api/controllers/discovery.js";
import { defaultHostServerConfig } from "#config/host.js";

const TEST_EXECUTOR_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const TEST_PAYMASTER_ADDRESS = "0x1111111111111111111111111111111111111111" as Hex;

const captureRes = () => {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status: (code: number) => {
      out.status = code;
      return {
        json: (value: unknown) => {
          out.body = value;
        }
      };
    },
    json: (value: unknown) => {
      out.body = value;
    }
  };
  return { out, res };
};

const AA_ENV_KEYS = [
  "LIVESTREAK_AA_RPC_URL",
  "LIVESTREAK_AA_CHAIN_ID",
  "LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN"
] as const;

describe("H5 — per-chain paymasterPath", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of AA_ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.LIVESTREAK_AA_RPC_URL = "http://127.0.0.1:8545";
    process.env.LIVESTREAK_AA_CHAIN_ID = "31337";
  });

  afterEach(() => {
    for (const key of AA_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("emits chains[].paymasterPath scoped to the route key and keeps top-level", () => {
    const deps = createAaRouteDeps(defaultHostServerConfig());
    const controller = createAaController(deps);
    const { out, res } = captureRes();

    controller.descriptor({}, res);

    const descriptor = out.body as {
      paymasterPath: string;
      chains: ReadonlyArray<{ paymasterPath: string; bundlerPath: string }>;
    };
    expect(descriptor.paymasterPath).toBe("/aa/paymaster");
    expect(descriptor.chains).toHaveLength(1);
    expect(descriptor.chains[0]!.paymasterPath).toBe("/aa/paymaster/local");
    expect(descriptor.chains[0]!.bundlerPath).toBe("/aa/bundler/local");
  });
});

describe("H1 — loopback-gated dev_open sponsorship", () => {
  const saved = process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN;

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN;
    } else {
      process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN = saved;
    }
  });

  it("uses dev_open + no auth on a loopback bind", () => {
    delete process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN;
    const aa = readAaServerConfig({ ...defaultHostServerConfig(), bindHost: "127.0.0.1" });
    expect(aa.sponsorshipMode).toBe("dev_open");
    expect(aa.requirePaymasterAuth).toBe(false);
  });

  it("disables sponsorship on a public bind with no token", () => {
    delete process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN;
    const aa = readAaServerConfig({ ...defaultHostServerConfig(), bindHost: "0.0.0.0" });
    expect(aa.sponsorshipMode).toBe("none");
    expect(aa.requirePaymasterAuth).toBe(true);
  });

  it("requires a bearer token on a public bind and rejects when missing", async () => {
    process.env.LIVESTREAK_AA_PAYMASTER_AUTH_TOKEN = "secret-token";
    const config = { ...defaultHostServerConfig(), bindHost: "0.0.0.0" };
    const aa = readAaServerConfig(config);
    expect(aa.sponsorshipMode).toBe("paymaster_signed");
    expect(aa.requirePaymasterAuth).toBe(true);

    const signers = new Map([
      ["local", createPaymasterSigner(TEST_EXECUTOR_KEY, TEST_PAYMASTER_ADDRESS)]
    ]);
    const deps = createAaRouteDeps(config, { paymasterSigners: signers });
    const controller = createAaController(deps);

    const noAuth = captureRes();
    await controller.paymaster(
      { params: { chain: "local" }, body: { method: "pm_getPaymasterStubData", id: 1 } },
      noAuth.res
    );
    expect(noAuth.out.status).toBe(401);

    const withAuth = captureRes();
    await controller.paymaster(
      {
        params: { chain: "local" },
        body: { method: "pm_getPaymasterStubData", id: 2 },
        headers: { authorization: "Bearer secret-token" }
      },
      withAuth.res
    );
    expect(withAuth.out.status).toBe(200);
  });
});

describe("H2 — userOp validation + chainId anti-replay", () => {
  const buildController = () => {
    const config = { ...defaultHostServerConfig(), bindHost: "127.0.0.1" };
    process.env.LIVESTREAK_AA_RPC_URL = "http://127.0.0.1:8545";
    process.env.LIVESTREAK_AA_CHAIN_ID = "31337";
    const signers = new Map([
      ["local", createPaymasterSigner(TEST_EXECUTOR_KEY, TEST_PAYMASTER_ADDRESS)]
    ]);
    const deps = createAaRouteDeps(config, { paymasterSigners: signers });
    return createAaController(deps);
  };

  afterEach(() => {
    delete process.env.LIVESTREAK_AA_RPC_URL;
    delete process.env.LIVESTREAK_AA_CHAIN_ID;
  });

  const validUserOp = {
    sender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    nonce: "0x0",
    callData: "0x",
    callGasLimit: "0x5208",
    verificationGasLimit: "0x100000",
    preVerificationGas: "0x5208",
    maxFeePerGas: "0x3b9aca00",
    maxPriorityFeePerGas: "0x3b9aca00",
    signature: "0x"
  };

  it("rejects a malformed userOp with -32602", async () => {
    const controller = buildController();
    const { out, res } = captureRes();
    await controller.paymaster(
      {
        params: { chain: "local" },
        body: { method: "pm_getPaymasterData", params: [{ sender: "nope" }, "0x", "0x7a69"], id: 5 }
      },
      res
    );
    expect((out.body as { error: { code: number } }).error.code).toBe(-32602);
  });

  it("rejects a chainId that does not match the route chain with -32602", async () => {
    const controller = buildController();
    const { out, res } = captureRes();
    await controller.paymaster(
      {
        params: { chain: "local" },
        // route chain is 31337 (0x7a69); send 0x1 (mainnet) → replay guard fires
        body: { method: "pm_getPaymasterData", params: [validUserOp, "0x" + "11".repeat(20), "0x1"], id: 6 }
      },
      res
    );
    const body = out.body as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain("chainId");
  });

  it("signs a matching chainId", async () => {
    const controller = buildController();
    const { out, res } = captureRes();
    await controller.paymaster(
      {
        params: { chain: "local" },
        body: { method: "pm_getPaymasterData", params: [validUserOp, "0x" + "11".repeat(20), "0x7a69"], id: 7 }
      },
      res
    );
    expect(out.status).toBe(200);
    expect((out.body as { result: { paymaster: string } }).result.paymaster).toBe(
      TEST_PAYMASTER_ADDRESS
    );
  });
});

describe("H6 — body-size cap + typed 413", () => {
  it("returns typed 413 for an oversized body on a default-limit route", async () => {
    const app = createApp(createHostRouteDeps(defaultHostServerConfig()));
    const oversized = { blob: "x".repeat(200 * 1024) }; // ~200kb > 100kb default
    const response = await request(app).post("/discovery/vaults").send(oversized).expect(413);
    expect(response.body.error.shortName).toBe("config");
  });
});

describe("Part C — module gating returns typed 503", () => {
  it("returns 503 module_disabled at the prefix when a module is off", async () => {
    const config = {
      ...defaultHostServerConfig(),
      enabledModules: ["media", "walrus_memory", "walrus_content", "discovery"] as const
    };
    const app = createApp(createHostRouteDeps(config));
    const response = await request(app)
      .post("/aa/paymaster/local")
      .send({ method: "pm_getPaymasterStubData", id: 1 })
      .expect(503);
    expect(response.body.error.message).toContain("aa");
  });
});

describe("discovery vaultKey round-trip", () => {
  it("stores and echoes vaultKey on index + candidate", () => {
    const store = createDiscoveryStore();
    const deps = { store };

    const indexResult = handleIndexVault(
      {
        vaultId: "vault_1",
        vaultKey: "key_abc",
        marketId: "market_1",
        title: "Will it rain tomorrow",
        summary: "weather market about rain",
        tags: ["weather", "rain"]
      },
      deps
    );
    expect(indexResult.ok).toBe(true);
    if (indexResult.ok) {
      expect(indexResult.result.vaultKey).toBe("key_abc");
    }

    const findResult = handleFindSimilar(
      {
        marketId: "market_1",
        vaultDraft: {
          title: "Will it rain tomorrow",
          summary: "weather market about rain",
          tags: ["weather", "rain"]
        }
      },
      deps
    );
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.result.candidates).toHaveLength(1);
      expect(findResult.result.candidates[0]!.vaultKey).toBe("key_abc");
    }
  });
});
