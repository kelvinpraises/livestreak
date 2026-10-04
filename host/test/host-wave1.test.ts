import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { createAaRouteDeps } from "#deps.js";
import { createAaHandlers } from "#features/aa/routes.js";
import { readAaServerConfig } from "#config/aa.js";
import { createDiscoveryStore } from "#features/discovery/store.js";
import { handleFindSimilar, handleIndexVault } from "#features/discovery/routes.js";
import { defaultHostServerConfig } from "#config/host.js";

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
    const controller = createAaHandlers(deps);
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

    const deps = createAaRouteDeps(config);
    const controller = createAaHandlers(deps);

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
    expect(withAuth.out.status).toBe(503); // Auth succeeds, but no hosted provider is configured.
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
      enabledModules: ["media", "memory", "content", "discovery"] as const
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
