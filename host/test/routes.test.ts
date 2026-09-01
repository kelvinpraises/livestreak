import type { EndpointDescriptor } from "@livestreak/host";
import { describe, expect, it } from "vitest";
import { createHostRouteDeps, createHostRoutes } from "#server/routes.js";
import { matchRoute } from "#server/http.js";
import { handlePolicyEvaluate } from "#policy/routes.js";
import { handleCacheReceipt } from "#cache/routes.js";
import { handleCreateSession, handleGetManifest } from "#sessions/routes.js";
import { createCacheStore } from "#cache/store.js";
import { createManifestStore } from "#manifests/store.js";
import { createSessionStore } from "#sessions/store.js";
import { defaultHostServerConfig } from "../src/descriptor/config.js";

const validCreateThreadBody = {
  title: "Steward discussion",
  stewardId: "stw_01",
  initialMessage: {
    author: { kind: "steward", ref: "stw_01" },
    body: "Opening the thread"
  }
} as const;

const validAppendMessageBody = {
  author: { kind: "observer", ref: "obs_01" },
  body: "Follow-up observation"
} as const;

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
  outputMode: "forwarder",
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
  routes: createHostRoutes()
});

const createSession = async (
  host: ReturnType<typeof createTestHost>,
  body: Record<string, unknown> = { ...validSessionBody }
) => {
  const matched = matchRoute("POST", "/sessions", host.routes);
  return matched!.route.handler({
    params: {},
    body,
    deps: host.deps
  });
};

describe("host route handlers", () => {
  it("registers slice-1 through slice-4b AA routes", () => {
    const { routes } = createTestHost();
    expect(routes).toHaveLength(14);
    expect(matchRoute("POST", "/sessions", routes)).toBeDefined();
    expect(matchRoute("GET", "/sessions/session_test_01/manifest", routes)).toBeDefined();
    expect(
      matchRoute("POST", "/sessions/session_test_01/cache-receipts", routes)
    ).toBeDefined();
    expect(matchRoute("POST", "/similarity/vaults", routes)).toBeDefined();
    expect(matchRoute("POST", "/similarity/find", routes)).toBeDefined();
    expect(matchRoute("POST", "/forum/threads", routes)).toBeDefined();
    expect(matchRoute("GET", "/forum/threads/thr_01", routes)).toBeDefined();
    expect(matchRoute("POST", "/forum/threads/thr_01/messages", routes)).toBeDefined();
    expect(matchRoute("POST", "/aa/bundler/local", routes)).toBeDefined();
    expect(matchRoute("POST", "/aa/paymaster/local", routes)).toBeDefined();
  });
});

describe("session routes", () => {
  it("creates a session via POST /sessions", async () => {
    const host = createTestHost();
    const response = await createSession(host);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
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

    const duplicate = handleCreateSession(validSessionBody, {
      config: host.deps.config,
      sessions: host.deps.sessions,
      manifests: host.deps.manifests,
      cache: host.deps.cache
    });

    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.status).toBe(409);
    }
  });

  it("does not overwrite manifest or summary on duplicate create", async () => {
    const host = createTestHost();
    await createSession(host);

    const originalManifest = host.deps.manifests.getBySessionId("session_test_01");
    const originalSummary = host.deps.sessions.getSummary("session_test_01");

    handleCreateSession(
      {
        ...validSessionBody,
        contentId: "cnt_overwrite_attempt",
        observer: "obs_overwrite_attempt"
      },
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
    );

    expect(host.deps.manifests.getBySessionId("session_test_01")).toEqual(originalManifest);
    expect(host.deps.sessions.getSummary("session_test_01")).toEqual(originalSummary);
  });

  it("rejects invalid POST /sessions bodies", async () => {
    const host = createTestHost();
    const response = await createSession(host, { outputMode: "forwarder" });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
  });

  it("returns manifest for an existing session", async () => {
    const host = createTestHost();
    await createSession(host);

    const response = handleGetManifest("session_test_01", {
      sessions: host.deps.sessions,
      manifests: host.deps.manifests
    });

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
    const response = handleGetManifest("session_missing", {
      sessions: host.deps.sessions,
      manifests: host.deps.manifests
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(404);
    }
  });
});

describe("cache receipt routes", () => {
  it("accepts a cache receipt and updates manifest refs with receipt id", async () => {
    const host = createTestHost();
    await createSession(host);

    const response = handleCacheReceipt("session_test_01", validCacheReceiptBody, {
      config: host.deps.config,
      sessions: host.deps.sessions,
      manifests: host.deps.manifests,
      cache: host.deps.cache
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.status).toBe("accepted");
      expect(response.result.receipt?.receiptId).toMatch(/^receipt_/);

      const manifest = handleGetManifest("session_test_01", {
        sessions: host.deps.sessions,
        manifests: host.deps.manifests
      });

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

    const beforeQuota = host.deps.cache.getQuotaRemainingBytes();
    const beforeManifest = host.deps.manifests.getBySessionId("session_test_01");
    const beforeReceipts = host.deps.cache.getBySessionId("session_test_01");
    const beforeSubmissions = host.deps.cache.listSubmissions().length;

    const response = handleCacheReceipt(
      "session_test_01",
      {
        ...validCacheReceiptBody,
        contentId: "cnt_wrong"
      },
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.status).toBe(400);
    }
    expect(host.deps.cache.getQuotaRemainingBytes()).toBe(beforeQuota);
    expect(host.deps.manifests.getBySessionId("session_test_01")).toEqual(beforeManifest);
    expect(host.deps.cache.getBySessionId("session_test_01")).toEqual(beforeReceipts);
    expect(host.deps.cache.listSubmissions()).toHaveLength(beforeSubmissions);
  });

  it("rejects mismatched observer without mutating quota, store, or manifest", async () => {
    const host = createTestHost();
    await createSession(host);

    const beforeQuota = host.deps.cache.getQuotaRemainingBytes();

    const response = handleCacheReceipt(
      "session_test_01",
      {
        ...validCacheReceiptBody,
        observer: "obs_wrong"
      },
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
    );

    expect(response.ok).toBe(false);
    expect(host.deps.cache.getQuotaRemainingBytes()).toBe(beforeQuota);
  });

  it("returns not-found for cache receipt on missing session", () => {
    const host = createTestHost();
    const response = handleCacheReceipt(
      "session_missing",
      {
        ...validCacheReceiptBody,
        sessionId: "session_missing"
      },
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
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

    expect(host.deps.cache.getQuotaRemainingBytes()).toBe(1_000);

    const beforePolicy = handlePolicyEvaluate(
      {
        outputMode: "forwarder",
        debug: false,
        contentId: "cnt_01",
        observer: "obs_01",
        expectedCacheBytes: 900
      },
      {
        config: host.deps.config,
        state: { quotaRemainingBytes: host.deps.cache.getQuotaRemainingBytes() }
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
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
    );

    expect(host.deps.cache.getQuotaRemainingBytes()).toBe(200);

    const afterPolicy = handlePolicyEvaluate(
      {
        outputMode: "forwarder",
        debug: false,
        contentId: "cnt_01",
        observer: "obs_01",
        expectedCacheBytes: 300
      },
      {
        config: host.deps.config,
        state: { quotaRemainingBytes: host.deps.cache.getQuotaRemainingBytes() }
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
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
    );

    const response = handleCreateSession(
      {
        ...validSessionBody,
        sessionId: "session_quota_b",
        expectedCacheBytes: 200
      },
      {
        config: host.deps.config,
        sessions: host.deps.sessions,
        manifests: host.deps.manifests,
        cache: host.deps.cache
      }
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
    const cache = createCacheStore(1_000);
    cache.save({
      receiptId: "receipt_test",
      hostId: "host_dev",
      sessionId: "session_test_01",
      evidence: { kind: "cache_receipt", ref: "evd_01" },
      status: "accepted",
      issuedAtMs: 1,
      signature: "sig"
    });

    const receipts = [...cache.getBySessionId("session_test_01")];
    receipts.push({
      receiptId: "receipt_mutated",
      hostId: "host_dev",
      sessionId: "session_test_01",
      evidence: { kind: "cache_receipt", ref: "evd_mutated" },
      status: "accepted",
      issuedAtMs: 2,
      signature: "sig2"
    });

    expect(cache.getBySessionId("session_test_01")).toHaveLength(1);
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
            supportedOutputs: ["forwarder"],
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
          outputMode: "forwarder",
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
        outputMode: "forwarder",
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

describe("similarity routes", () => {
  it("indexes a vault then finds overlapping candidates in the same market", async () => {
    const host = createTestHost();

    const indexResponse = await matchRoute("POST", "/similarity/vaults", host.routes)!.route.handler({
      params: {},
      body: validIndexVaultBody,
      deps: host.deps
    });

    expect(indexResponse.ok).toBe(true);
    if (indexResponse.ok) {
      expect(indexResponse.status).toBe(201);
    }

    const findResponse = await matchRoute("POST", "/similarity/find", host.routes)!.route.handler({
      params: {},
      body: validFindSimilarBody,
      deps: host.deps
    });

    expect(findResponse.ok).toBe(true);
    if (findResponse.ok) {
      expect(findResponse.body).toMatchObject({
        marketId: "mkt_a",
        duplicateRisk: expect.any(String)
      });
      const body = findResponse.body as { candidates: Array<{ marketId: string }> };
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.candidates[0]?.marketId).toBe("mkt_a");
    }
  });

  it("scopes find results to the requested marketId", async () => {
    const host = createTestHost();

    await matchRoute("POST", "/similarity/vaults", host.routes)!.route.handler({
      params: {},
      body: validIndexVaultBody,
      deps: host.deps
    });

    const findResponse = await matchRoute("POST", "/similarity/find", host.routes)!.route.handler({
      params: {},
      body: {
        marketId: "mkt_b",
        vaultDraft: validFindSimilarBody.vaultDraft
      },
      deps: host.deps
    });

    expect(findResponse.ok).toBe(true);
    if (findResponse.ok) {
      expect(findResponse.body).toMatchObject({
        marketId: "mkt_b",
        candidates: [],
        duplicateRisk: "low"
      });
    }
  });

  it("returns empty candidates when the index has no overlap", async () => {
    const host = createTestHost();

    const findResponse = await matchRoute("POST", "/similarity/find", host.routes)!.route.handler({
      params: {},
      body: {
        marketId: "mkt_a",
        vaultDraft: {
          title: "Unrelated topic",
          summary: "Something completely different",
          tags: ["widgets"]
        }
      },
      deps: host.deps
    });

    expect(findResponse.ok).toBe(true);
    if (findResponse.ok) {
      expect(findResponse.body).toMatchObject({
        marketId: "mkt_a",
        candidates: [],
        duplicateRisk: "low"
      });
    }
  });

  it("rejects invalid index and find bodies with 400", async () => {
    const host = createTestHost();

    const indexResponse = await matchRoute("POST", "/similarity/vaults", host.routes)!.route.handler({
      params: {},
      body: { vaultId: "vlt_01" },
      deps: host.deps
    });
    expect(indexResponse.ok).toBe(false);
    if (!indexResponse.ok) {
      expect(indexResponse.status).toBe(400);
    }

    const findResponse = await matchRoute("POST", "/similarity/find", host.routes)!.route.handler({
      params: {},
      body: { marketId: "mkt_a" },
      deps: host.deps
    });
    expect(findResponse.ok).toBe(false);
    if (!findResponse.ok) {
      expect(findResponse.status).toBe(400);
    }
  });
});

describe("forum routes", () => {
  it("creates a thread, reads it back, and appends a message", async () => {
    const host = createTestHost();

    const createResponse = await matchRoute("POST", "/forum/threads", host.routes)!.route.handler({
      params: {},
      body: validCreateThreadBody,
      deps: host.deps
    });

    expect(createResponse.ok).toBe(true);
    if (!createResponse.ok) {
      return;
    }

    expect(createResponse.status).toBe(201);
    const created = createResponse.body as {
      thread: { threadId: string; title: string };
      messages: Array<{ body: string; author: { kind: string; ref: string } }>;
    };
    expect(created.thread.title).toBe("Steward discussion");
    expect(created.messages).toHaveLength(1);
    expect(created.messages[0]?.body).toBe("Opening the thread");

    const threadId = created.thread.threadId;

    const getResponse = await matchRoute("GET", `/forum/threads/${threadId}`, host.routes)!.route.handler({
      params: { threadId },
      body: undefined,
      deps: host.deps
    });

    expect(getResponse.ok).toBe(true);
    if (getResponse.ok) {
      const record = getResponse.body as typeof created;
      expect(record.thread.threadId).toBe(threadId);
      expect(record.messages).toHaveLength(1);
    }

    const appendResponse = await matchRoute(
      "POST",
      `/forum/threads/${threadId}/messages`,
      host.routes
    )!.route.handler({
      params: { threadId },
      body: validAppendMessageBody,
      deps: host.deps
    });

    expect(appendResponse.ok).toBe(true);
    if (appendResponse.ok) {
      const record = appendResponse.body as {
        messages: Array<{ body: string; author: { kind: string; ref: string } }>;
      };
      expect(record.messages).toHaveLength(2);
      expect(record.messages[1]?.body).toBe("Follow-up observation");
      expect(record.messages[1]?.author).toMatchObject({ kind: "observer", ref: "obs_01" });
    }
  });

  it("returns 404 for missing thread get and append", async () => {
    const host = createTestHost();

    const getResponse = await matchRoute("GET", "/forum/threads/thr_missing", host.routes)!.route.handler({
      params: { threadId: "thr_missing" },
      body: undefined,
      deps: host.deps
    });
    expect(getResponse.ok).toBe(false);
    if (!getResponse.ok) {
      expect(getResponse.status).toBe(404);
    }

    const appendResponse = await matchRoute(
      "POST",
      "/forum/threads/thr_missing/messages",
      host.routes
    )!.route.handler({
      params: { threadId: "thr_missing" },
      body: validAppendMessageBody,
      deps: host.deps
    });
    expect(appendResponse.ok).toBe(false);
    if (!appendResponse.ok) {
      expect(appendResponse.status).toBe(404);
    }
  });

  it("rejects invalid create and append bodies with 400", async () => {
    const host = createTestHost();

    const createResponse = await matchRoute("POST", "/forum/threads", host.routes)!.route.handler({
      params: {},
      body: {},
      deps: host.deps
    });
    expect(createResponse.ok).toBe(false);
    if (!createResponse.ok) {
      expect(createResponse.status).toBe(400);
    }

    const appendResponse = await matchRoute(
      "POST",
      "/forum/threads/thr_01/messages",
      host.routes
    )!.route.handler({
      params: { threadId: "thr_01" },
      body: {},
      deps: host.deps
    });
    expect(appendResponse.ok).toBe(false);
    if (!appendResponse.ok) {
      expect(appendResponse.status).toBe(400);
    }
  });
});
