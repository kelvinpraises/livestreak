import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import { mapMarket } from "#services/catalog/mapper.js";
import { createCatalogService, type CatalogReaderProvider } from "#services/catalog/catalog.js";
import type { OptionsMarketSnapshot, OptionsReader } from "@livestreak/options";

const NOW = 1_000_000_000_000;

// Snapshot with one open vault + one resolved vault.
const snapshot = (marketId: string): OptionsMarketSnapshot =>
  ({
    market: {
      marketId,
      title: "AI Panel",
      creator: "0xcreator",
      category: "Tech",
      status: "open",
      vaultIds: ["v-open", "v-done"],
      timing: { createdAtMs: NOW - 60_000 }
    },
    streamState: {
      status: "live",
      scheme: "ipfs",
      id: "feedblob",
      updatedAtMs: NOW - 120_000,
      endedAtMs: 0
    },
    vaults: [
      {
        vaultId: "v-open",
        marketId,
        question: "Regulation next?",
        type: "momentum",
        creator: "0xc",
        status: "open",
        outcome: "pending",
        pools: { yes: 100_000_000n, no: 50_000_000n },
        timing: { createdAtMs: NOW - 60_000, expiresAtMs: NOW + 180_000 },
        steward: { hot: false }
      },
      {
        vaultId: "v-done",
        marketId,
        question: "Consensus reached?",
        type: "threshold",
        creator: "0xc",
        status: "resolved",
        outcome: "yes",
        pools: { yes: 200_000_000n, no: 80_000_000n },
        timing: {
          createdAtMs: NOW - 600_000,
          expiresAtMs: NOW - 60_000,
          resolvedAtMs: NOW - 30_000
        },
        steward: { hot: false }
      }
    ]
  }) as unknown as OptionsMarketSnapshot;

// Minimal reader: readMarketGraph touches readVaultSnapshot board reads.
const fakeReader = (snap: OptionsMarketSnapshot): OptionsReader =>
  ({
    readMarket: async () => snap.market,
    listMarketVaults: async () => snap.market.vaultIds,
    readVault: async (id: string) => snap.vaults.find((v) => String(v.vaultId) === String(id))!,
    readStreamState: async () => snap.streamState!,
    readVaultShareTotals: async () => ({ yes: 0n, no: 0n }),
    readBoard: async (id: string, side: "yes" | "no") => {
      const vault = snap.vaults.find((v) => String(v.vaultId) === String(id));
      const yes = vault?.pools.yes ?? 0n;
      const no = vault?.pools.no ?? 0n;
      return {
        pool: side === "yes" ? yes : no,
        sideRate: 0n,
        g: 0n,
        lastAdvanceMs: NOW
      };
    },
    readPendingBoundaries: async () => 0n,
    readBoundaries: async () => []
  }) as unknown as OptionsReader;

describe("catalog mapper", () => {
  it("maps a market snapshot into the app's catalog + homepage shapes, chain-tagged", () => {
    const mapped = mapMarket("evm", snapshot("m1"), NOW, "http://host");

    expect(mapped.stream).toMatchObject({
      routeId: "m1",
      marketId: "m1",
      title: "AI Panel",
      category: "Tech",
      isLive: true,
      activeVaults: 1,
      totalPooled: 430,
      chain: "evm"
    });
    expect(mapped.detail.watchUrl).toBe("http://host/content/blobs/ipfs/feedblob");

    expect(mapped.liveVaults).toHaveLength(1);
    expect(mapped.liveVaults[0]).toMatchObject({
      id: "v-open",
      streamId: "m1",
      option: "Regulation next?",
      status: "open",
      totalPool: 150,
      expiresIn: 180,
      chain: "evm"
    });

    expect(mapped.lifetimeVaults).toHaveLength(1);
    expect(mapped.lifetimeVaults[0]).toMatchObject({
      id: "v-done",
      outcome: "yes",
      totalPool: 280,
      yesTotal: 200,
      noTotal: 80,
      resolvedAgoMs: 30_000,
      chain: "evm"
    });
  });
});

describe("catalog service", () => {
  const providerFor = (snap: OptionsMarketSnapshot): CatalogReaderProvider => ({
    reader: (chain) => (chain === "evm" ? fakeReader(snap) : null),
    availableChains: ["evm"]
  });

  it("aggregates registered markets across the catalog + homepage", async () => {
    const service = createCatalogService({
      readers: providerFor(snapshot("m1")),
      baseUrl: "http://host",
      seedMarkets: [{ chain: "evm", marketId: "m1" }],
      now: () => NOW
    });

    const full = await service.buildFull();
    expect(full.catalog.streams).toHaveLength(1);
    expect(full.streams.m1.marketId).toBe("m1");
    expect(full.homepage.liveVaults).toHaveLength(1);
    expect(full.homepage.lifetimeVaults).toHaveLength(1);
    expect(full.homepage.protocolStats).toEqual({
      totalVaults: 2,
      totalVolume: 430,
      activeStreams: 1
    });

    const detail = await service.buildStream("m1");
    expect(detail?.marketId).toBe("m1");
    expect(await service.buildStream("missing")).toBeNull();
  });

  it("skips chains with no reader instead of failing", async () => {
    const service = createCatalogService({
      readers: { reader: () => null, availableChains: [] },
      baseUrl: "http://host",
      seedMarkets: [{ chain: "sui", marketId: "s1" }],
      now: () => NOW
    });
    const catalog = await service.buildCatalog();
    expect(catalog.streams).toEqual([]);
  });
});

describe("catalog routes", () => {
  it("serves an empty-but-valid live catalog when no markets are registered", async () => {
    const deps = createHostRouteDeps(defaultHostServerConfig(), {
      catalogReaders: { reader: () => null, availableChains: [] }
    });
    const app = createApp(deps);

    const catalog = await request(app).get("/catalog").expect(200);
    expect(catalog.body).toEqual({ streams: [] });

    const full = await request(app).get("/catalog/full").expect(200);
    expect(full.body.homepage.protocolStats.totalVaults).toBe(0);

    await request(app).get("/catalog/streams/none").expect(404);
  });

  it("registers a market then reads it live through the route", async () => {
    const provider: CatalogReaderProvider = {
      reader: (chain) => (chain === "evm" ? fakeReader(snapshot("m9")) : null),
      availableChains: ["evm"]
    };
    const app = createApp(
      createHostRouteDeps(defaultHostServerConfig(), { catalogReaders: provider })
    );

    await request(app)
      .post("/catalog/markets")
      .send({ chain: "evm", marketId: "m9" })
      .expect(201);

    const catalog = await request(app).get("/catalog").expect(200);
    expect(catalog.body.streams).toHaveLength(1);
    expect(catalog.body.streams[0].marketId).toBe("m9");

    await request(app).post("/catalog/markets").send({ chain: "x" }).expect(400);
  });
});
