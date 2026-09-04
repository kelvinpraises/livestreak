import type { EndpointDescriptor } from "@livestreak/host";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, createHostRouteDeps } from "#api/server.js";
import { handleFindSimilar, handleIndexVault } from "#services/discovery-routes.js";
import { handleMemoryAccess } from "#services/walrus/memory/routes.js";
import { handlePolicyEvaluate } from "#services/media/policy-routes.js";
import {
  handleCacheReceipt,
  handleCreateSession,
  handleGetManifest
} from "#services/media/routes.js";
import { createEvidenceStore } from "#services/media/evidence.js";
import { createManifestStore } from "#services/media/manifest.js";
import { createSessionStore } from "#services/media/session.js";
import { defaultHostServerConfig } from "#config/host.js";

const validIndexVaultBody = {
  vaultId: "vlt_01",
  marketId: "mkt_a",
  title: "Premier League goals",
  summary: "Total goals scored in premier league football match",
  tags: ["football", "goals"]
} as const;

const validFindSimilarBody = {
  marketId: "mkt_a",
  vaultDraft: {
    title: "Premier League football goals",
    summary: "Goals in premier league match",
    tags: ["football"]
  }
} as const;

const validSessionBody = {
  outputMode: "local",
  debug: false,
  contentId: "cnt_01",
  observer: "obs_01",
  sessionId: "session_test_01"
} as const;

const validCacheReceiptBody = {
  sessionId: "session_test_01",
  contentId: "cnt_01",
  observer: "obs_01",
  evidence: {
    kind: "cache_receipt",
    ref: "evd_01"
  },
  bytesStored: 128
} as const;

const createTestHost = (config = defaultHostServerConfig()) => ({
  deps: createHostRouteDeps(config),
  app: createApp(createHostRouteDeps(config))
});

const mediaDeps = (host: ReturnType<typeof createTestHost>) => ({
  ...host.deps.media,
  config: host.deps.config
});

const createSession = async (
  host: ReturnType<typeof createTestHost>,
  body: Record<string, unknown> = { ...validSessionBody }
) => handleCreateSession(body, mediaDeps(host));

describe("host route handlers", () => {
  it("registers modular host routes and removes legacy paths", async () => {
    const { app } = createTestHost();
    await request(app).get("/health").expect(200);
    await request(app).get("/descriptor").expect(200);
    await request(app).post("/media/sessions").send(validSessionBody).expect(201);
    await request(app).get("/media/sessions/session_test_01/manifest").expect(200);
    await request(app)
      .post("/media/sessions/session_test_01/cache-receipts")
      .send(validCacheReceiptBody)
      .expect(200);
    await request(app).post("/media/policy/evaluate").send({}).expect(400);
    await request(app).post("/discovery/vaults").send(validIndexVaultBody).expect(201);
    await request(app).post("/discovery/find").send(validFindSimilarBody).expect(200);
    await request(app)
      .post("/memory/access")
      .send({ marketId: "mkt_01", suiDelegate: "a".repeat(64) })
      .expect(503);
    await request(app)
      .post("/content/blobs")
      .send({ bytesBase64: "", persistence: "ephemeral" })
      .expect(503);
    await request(app).get("/content/blobs/walrus-testnet/blob_01").expect(503);
    await request(app)
      .post("/aa/bundler/local")
      .send({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 })
      .expect(503);
    await request(app)
      .post("/aa/paymaster/local")
      .send({ jsonrpc: "2.0", method: "pm_getPaymasterStubData", params: [], id: 1 })
      .expect(503);
    await request(app).post("/sessions").expect(404);
    await request(app).post("/similarity/vaults").expect(404);
    await request(app).post("/forum/threads").expect(404);
    await request(app).post("/policy/evaluate").expect(404);
  });
});

describe("media session routes", () => {
  it("creates a session via POST /media/sessions", async () => {
    const host = createTestHost();
    const response = await createSession(host);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toMatchObject({
        summary: {
          sessionId: "session_test_01",
          status: "active"
        }
      });
    }
  });

  it("rejects duplicate session creation with 409", async () => {
    const host = createTestHost();
    await createSession(host);

    const duplicate = await handleCreateSession(validSessionBody, mediaDeps(host));

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.status).toBe(409);
    }
  });

  it("does not overwrite manifest or summary on duplicate create", async () => {
    const host = createTestHost();
    await createSession(host);

    const originalManifest = host.deps.media.manifests.getBySessionId("session_test_01");
    const originalSummary = host.deps.media.sessions.getSummary("session_test_01");

    await handleCreateSession(
      {
        ...validSessionBody,
        contentId: "cnt_overwrite_attempt",
        observer: "obs_overwrite_attempt"
      },
      mediaDeps(host)
    );

    expect(host.deps.media.manifests.getBySessionId("session_test_01")).toEqual(originalManifest);
    expect(host.deps.media.sessions.getSummary("session_test_01")).toEqual(originalSummary);
  });

  it("rejects invalid POST /media/sessions bodies", async () => {
    const host = createTestHost();
    const response = await createSession(host, { outputMode: "local" });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
  });

  it("returns manifest for an existing session", async () => {
    const host = createTestHost();
    await createSession(host);

    const response = handleGetManifest("session_test_01", host.deps.media);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toMatchObject({
        sessionId: "session_test_01",
        manifestId: "manifest_session_test_01"
      });
    }
  });

  it("returns not-found for missing session manifest", () => {
    const host = createTestHost();
    const response = handleGetManifest("session_missing", host.deps.media);

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(404);
    }
  });

  it("rejects simulcast when LiveKit is not configured", async () => {
    const host = createTestHost({
      ...defaultHostServerConfig(),
      livekitApiKey: undefined
    });

    const response = await handleCreateSession(
      {
        ...validSessionBody,
        sessionId: "session_simulcast_01",
        outputMode: "simulcast"
      },
      mediaDeps(host)
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
      expect(response.error.message).toContain("simulcast_unavailable");
    }
  });
});

describe("cache receipt routes", () => {
  it("accepts a cache receipt and updates manifest refs with receipt id", async () => {
    const host = createTestHost();
    await createSession(host);

    const response = handleCacheReceipt("session_test_01", validCacheReceiptBody, mediaDeps(host));

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.status).toBe("accepted");
      expect(response.result.receipt?.receiptId).toMatch(/^receipt_/);

      const manifest = handleGetManifest("session_test_01", host.deps.media);

      expect(manifest.ok).toBe(true);
      if (manifest.ok) {
        expect(manifest.result.cacheReceiptRefs).toEqual([response.result.receipt!.receiptId]);
        expect(manifest.result.cacheReceiptRefs).not.toContain("evd_01");
      }
    }
  });

  it("rejects mismatched contentId without mutating quota, store, or manifest", async () => {
    const host = createTestHost();
    await createSession(host);

    const beforeQuota = host.deps.media.evidence.getQuotaRemainingBytes();
    const beforeManifest = host.deps.media.manifests.getBySessionId("session_test_01");
    const beforeReceipts = host.deps.media.evidence.getBySessionId("session_test_01");
    const beforeSubmissions = host.deps.media.evidence.listSubmissions().length;

    const response = handleCacheReceipt(
      "session_test_01",
      {
        ...validCacheReceiptBody,
        contentId: "cnt_wrong"
      },
      mediaDeps(host)
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
    expect(host.deps.media.evidence.getQuotaRemainingBytes()).toBe(beforeQuota);
    expect(host.deps.media.manifests.getBySessionId("session_test_01")).toEqual(beforeManifest);
    expect(host.deps.media.evidence.getBySessionId("session_test_01")).toEqual(beforeReceipts);
    expect(host.deps.media.evidence.listSubmissions()).toHaveLength(beforeSubmissions);
  });

  it("rejects mismatched observer without mutating quota", async () => {
    const host = createTestHost();
    await createSession(host);

    const beforeQuota = host.deps.media.evidence.getQuotaRemainingBytes();

    const response = handleCacheReceipt(
      "session_test_01",
      {
        ...validCacheReceiptBody,
        observer: "obs_wrong"
      },
      mediaDeps(host)
    );

    expect(response.ok).toBe(false);
    expect(host.deps.media.evidence.getQuotaRemainingBytes()).toBe(beforeQuota);
  });

  it("returns not-found for cache receipt on missing session", () => {
    const host = createTestHost();
    const response = handleCacheReceipt(
      "session_missing",
      {
        ...validCacheReceiptBody,
        sessionId: "session_missing"
      },
      mediaDeps(host)
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(404);
    }
  });
});

describe("cache quota source of truth", () => {
  it("shows initial quota before receipt and reduced quota after", async () => {
    const host = createTestHost({
      ...defaultHostServerConfig(),
      cacheQuotaBytes: 1_000
    });
    await createSession(host, { ...validSessionBody, sessionId: "session_quota_01" });

    expect(host.deps.media.evidence.getQuotaRemainingBytes()).toBe(1_000);

    const beforePolicy = handlePolicyEvaluate(
      {
        outputMode: "local",
        debug: false,
        contentId: "cnt_01",
        observer: "obs_01",
        expectedCacheBytes: 900
      },
      {
        config: host.deps.config,
        state: { quotaRemainingBytes: host.deps.media.evidence.getQuotaRemainingBytes() }
      }
    );

    expect(beforePolicy.ok).toBe(true);
    if (beforePolicy.ok) {
      expect(beforePolicy.result.descriptor.cache.quotaRemainingBytes).toBe(1_000);
      expect(beforePolicy.result.blockReasons).toEqual([]);
    }

    handleCacheReceipt(
      "session_quota_01",
      {
        ...validCacheReceiptBody,
        sessionId: "session_quota_01",
        bytesStored: 800
      },
      mediaDeps(host)
    );

    expect(host.deps.media.evidence.getQuotaRemainingBytes()).toBe(200);

    const afterPolicy = handlePolicyEvaluate(
      {
        outputMode: "local",
        debug: false,
        contentId: "cnt_01",
        observer: "obs_01",
        expectedCacheBytes: 300
      },
      {
        config: host.deps.config,
        state: { quotaRemainingBytes: host.deps.media.evidence.getQuotaRemainingBytes() }
      }
    );

    expect(afterPolicy.ok).toBe(true);
    if (afterPolicy.ok) {
      expect(afterPolicy.result.descriptor.cache.quotaRemainingBytes).toBe(200);
      expect(afterPolicy.result.blockReasons).toContain("cache_quota_exceeded");
    }
  });

  it("blocks session create when expectedCacheBytes exceeds remaining quota", async () => {
    const host = createTestHost({
      ...defaultHostServerConfig(),
      cacheQuotaBytes: 500
    });
    await createSession(host, { ...validSessionBody, sessionId: "session_quota_a" });

    handleCacheReceipt(
      "session_quota_a",
      {
        ...validCacheReceiptBody,
        sessionId: "session_quota_a",
        bytesStored: 400
      },
      mediaDeps(host)
    );

    const response = await handleCreateSession(
      {
        ...validSessionBody,
        sessionId: "session_quota_b",
        expectedCacheBytes: 200
      },
      mediaDeps(host)
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
      expect(response.error.message).toContain("cache_quota_exceeded");
    }
  });
});

describe("store mutation safety", () => {
  it("does not let callers mutate internal cache receipt arrays", () => {
    const evidence = createEvidenceStore(1_000);
    evidence.save({
      receiptId: "receipt_test",
      hostId: "host_dev",
      sessionId: "session_test_01",
      evidence: { kind: "cache_receipt", ref: "evd_01" },
      status: "accepted",
      issuedAtMs: 1,
      signature: "sig"
    });

    const receipts = [...evidence.getBySessionId("session_test_01")];
    receipts.push({
      receiptId: "receipt_mutated",
      hostId: "host_dev",
      sessionId: "session_test_01",
      evidence: { kind: "cache_receipt", ref: "evd_mutated" },
      status: "accepted",
      issuedAtMs: 2,
      signature: "sig2"
    });

    expect(evidence.getBySessionId("session_test_01")).toHaveLength(1);
  });

  it("does not let callers mutate internal manifest cacheReceiptRefs", () => {
    const manifests = createManifestStore();
    manifests.save({
      version: "0.1.0",
      manifestId: "manifest_session_test_01",
      sessionId: "session_test_01",
      observer: "obs_01",
      contentId: "cnt_01",
      hostId: "host_dev",
      endpoints: [],
      hostPolicyStatus: "pass",
      cacheReceiptRefs: ["receipt_a"],
      issuedAtMs: 1,
      expiresAtMs: 2,
      signature: "sig"
    });

    const manifest = manifests.getBySessionId("session_test_01");
    (manifest!.cacheReceiptRefs as string[]).push("receipt_mutated");

    expect(manifests.getBySessionId("session_test_01")?.cacheReceiptRefs).toEqual(["receipt_a"]);
  });

  it("does not let callers mutate internal session drafts via get", () => {
    const sessions = createSessionStore();
    sessions.create(
      {
        sessionId: "session_test_01",
        endpoints: [{ kind: "watch", url: "http://example.com", expiresAtMs: null }],
        manifestDraft: {
          version: "0.1.0",
          manifestId: "manifest_session_test_01",
          sessionId: "session_test_01",
          observer: "obs_01",
          contentId: "cnt_01",
          hostId: "host_dev",
          endpoints: [],
          hostPolicyStatus: "pass",
          cacheReceiptRefs: [],
          issuedAtMs: 1,
          expiresAtMs: 2,
          signature: "sig"
        },
        policy: {
          descriptor: {
            hostId: "host_dev",
            accountTier: "dev",
            supportedOutputs: ["local"],
            debug: false,
            cache: {
              available: true,
              quotaRemainingBytes: 1_000,
              retentionDays: 7,
              receipts: "required"
            },
            live: { minDurationSeconds: 0, maxDurationSeconds: 3600 },
            evaluation: { ruleSet: "livestreak-host-policy", status: "pass", warnings: [] }
          },
          outputMode: "local",
          cache: {
            intent: "required",
            required: true,
            maySkip: false,
            available: true,
            expectedBytes: 0,
            quotaRemainingBytes: 1_000
          },
          live: { required: true, available: true, expectedDurationSeconds: 0 },
          blockReasons: [],
          constraints: []
        }
      },
      {
        sessionId: "session_test_01",
        hostId: "host_dev",
        observer: "obs_01",
        contentId: "cnt_01",
        outputMode: "local",
        status: "active",
        createdAtMs: 1
      }
    );

    const draft = sessions.get("session_test_01");
    (draft!.endpoints as EndpointDescriptor[]).push({
      kind: "control",
      url: "http://example.com/control",
      expiresAtMs: null
    });

    expect(sessions.get("session_test_01")?.endpoints).toHaveLength(1);
  });
});

describe("discovery routes", () => {
  it("indexes a vault then finds overlapping candidates in the same market", async () => {
    const host = createTestHost();

    const indexResponse = handleIndexVault(validIndexVaultBody, host.deps.discovery);

    expect(indexResponse.ok).toBe(true);

    const findResponse = handleFindSimilar(validFindSimilarBody, host.deps.discovery);

    expect(findResponse.ok).toBe(true);
    if (findResponse.ok) {
      expect(findResponse.result).toMatchObject({
        marketId: "mkt_a",
        duplicateRisk: expect.any(String)
      });
      const body = findResponse.result as unknown as { candidates: Array<{ marketId: string }> };
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.candidates[0]?.marketId).toBe("mkt_a");
    }
  });

  it("scopes find results to the requested marketId", async () => {
    const host = createTestHost();

    handleIndexVault(validIndexVaultBody, host.deps.discovery);

    const findResponse = handleFindSimilar(
      {
        marketId: "mkt_b",
        vaultDraft: validFindSimilarBody.vaultDraft
      },
      host.deps.discovery
    );

    expect(findResponse.ok).toBe(true);
    if (findResponse.ok) {
      expect(findResponse.result).toMatchObject({
        marketId: "mkt_b",
        candidates: [],
        duplicateRisk: "low"
      });
    }
  });

  it("rejects invalid index and find bodies with 400", async () => {
    const host = createTestHost();

    const indexResponse = handleIndexVault({ vaultId: "vlt_01" }, host.deps.discovery);
    expect(indexResponse.ok).toBe(false);
    if (!indexResponse.ok) {
      expect(indexResponse.status).toBe(400);
    }

    const findResponse = handleFindSimilar({ marketId: "mkt_a" }, host.deps.discovery);
    expect(findResponse.ok).toBe(false);
    if (!findResponse.ok) {
      expect(findResponse.status).toBe(400);
    }
  });
});

describe("memory access route", () => {
  const configuredMemory = () => ({
    ...defaultHostServerConfig(),
    walrusNetwork: "mainnet" as const,
    memorySuiOwnerPrivateKey: "suiprivkey1qqtest",
    memoryOwnerSeed: null,
    walletSeed: null,
    resolvedWalrus: {
      network: "mainnet" as const,
      sui: {
        rpcUrl: "https://fullnode.mainnet.sui.io:443",
        packageId: "0xpackage",
        registryId: "0xregistry"
      },
      memory: {
        relayerUrl: "https://memwal.example"
      },
      blob: {
        publisherUrl: "https://publisher.example",
        aggregatorUrl: "https://aggregator.example"
      }
    }
  });

  const validDelegateKey = "a".repeat(64);

  it("returns scoped credentials including accountId for a granted delegate", async () => {
    const bindings = {
      get: vi.fn(),
      provision: vi.fn(async (marketId: string) => ({
        marketId,
        memWalAccountId: "0xaccount_scoped",
        namespace: `market:${marketId}`
      })),
      grantDelegate: vi.fn(async () => undefined),
      hasDelegate: vi.fn(() => true)
    };

    const response = await handleMemoryAccess(
      { marketId: "mkt_01", suiDelegate: validDelegateKey },
      {
        config: configuredMemory(),
        bindings
      }
    );

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result).toEqual({
        relayerUrl: "https://memwal.example",
        namespace: "market:mkt_01",
        accountId: "0xaccount_scoped"
      });
      expect(JSON.stringify(response.result)).not.toContain("memWalAccountId");
    }
  });

  it("returns 503 when walrus network selector is absent", async () => {
    const host = createTestHost({
      ...defaultHostServerConfig(),
      walrusNetwork: null,
      memorySuiOwnerPrivateKey: null,
      memoryOwnerSeed: null,
      resolvedWalrus: null
    });

    const response = await handleMemoryAccess(
      { marketId: "mkt_01", suiDelegate: validDelegateKey },
      {
        config: host.deps.config,
        bindings: host.deps.walrus.memory.bindings
      }
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(503);
    }
  });

  it("returns 503 when memory is configured but walrus is not bootstrapped", async () => {
    const host = createTestHost({
      ...defaultHostServerConfig(),
      walrusNetwork: "mainnet",
      memorySuiOwnerPrivateKey: "suiprivkey1qqtest",
      memoryOwnerSeed: null,
      resolvedWalrus: null
    });

    const response = await handleMemoryAccess(
      { marketId: "mkt_01", suiDelegate: validDelegateKey },
      {
        config: host.deps.config,
        bindings: host.deps.walrus.memory.bindings
      }
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(503);
    }
  });

  it("returns 400 when suiDelegate is missing", async () => {
    const response = await handleMemoryAccess(
      { marketId: "mkt_01" },
      {
        config: configuredMemory(),
        bindings: {
          get: vi.fn(),
          provision: vi.fn(),
          grantDelegate: vi.fn(),
          hasDelegate: vi.fn()
        }
      }
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
  });

  it("returns 400 when suiDelegate is not a valid delegate public key", async () => {
    const response = await handleMemoryAccess(
      { marketId: "mkt_01", suiDelegate: "0xabc" },
      {
        config: configuredMemory(),
        bindings: {
          get: vi.fn(),
          provision: vi.fn(),
          grantDelegate: vi.fn(),
          hasDelegate: vi.fn()
        }
      }
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
  });
});
