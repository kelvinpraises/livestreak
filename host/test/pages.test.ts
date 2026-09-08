import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import { createDatabase } from "#infrastructure/database/connection.js";
import {
  migrateSync,
  migrateToLatest
} from "#infrastructure/database/migrations/index.js";
import { createCatalogRepository } from "#infrastructure/database/repository.js";
import { createCatalogIndexer } from "#infrastructure/cron/catalog-sync.js";
import type { CatalogReaderProvider } from "#services/catalog/catalog.js";
import type { OptionsMarketSnapshot, OptionsReader } from "@livestreak/options";

const NOW = 1_000_000_000_000;

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

const fakeReader = (snap: OptionsMarketSnapshot): OptionsReader =>
  ({
    readMarket: async () => snap.market,
    listMarketVaults: async () => snap.market.vaultIds,
    readVault: async (id: string) =>
      snap.vaults.find((v) => String(v.vaultId) === String(id))!,
    readStreamState: async () => snap.streamState!
  }) as unknown as OptionsReader;

const providerFor = (snap: OptionsMarketSnapshot): CatalogReaderProvider => ({
  reader: (chain) => (chain === "evm" ? fakeReader(snap) : null),
  availableChains: ["evm"]
});

describe("discovery read-model: migration", () => {
  it("creates the markets/vaults/resolutions tables (sync + formal migrator)", async () => {
    const handle = createDatabase(":memory:");
    migrateSync(handle.sqlite);
    await migrateToLatest(handle.db);

    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["markets", "vaults", "resolutions"]));
    await handle.close();
  });
});

describe("discovery read-model: indexer", () => {
  it("maps a fake reader's market + vaults into DB rows", async () => {
    const handle = createDatabase(":memory:");
    migrateSync(handle.sqlite);
    const repo = createCatalogRepository(handle.db);
    const indexer = createCatalogIndexer({
      repo,
      readers: providerFor(snapshot("m1")),
      baseUrl: "http://host",
      knownMarkets: () => [{ chain: "evm", marketId: "m1" }],
      now: () => NOW
    });

    const result = await indexer.syncAll();
    expect(result).toEqual({ indexed: 1, failed: 0 });

    const markets = await repo.allMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({
      id: "m1",
      chain: "evm",
      is_live: 1,
      active_vaults: 1,
      total_pooled: 430
    });

    const live = await repo.liveVaults();
    expect(live).toHaveLength(1);
    expect(live[0].vault.id).toBe("v-open");
    expect(live[0].vault.yes_pool).toBe("100000000");

    const lifetime = await repo.lifetimeVaults();
    expect(lifetime).toHaveLength(1);
    expect(lifetime[0].resolution.outcome).toBe("yes");

    expect(await repo.protocolStats()).toEqual({
      totalVaults: 2,
      totalVolume: 430,
      activeStreams: 1
    });
    await handle.close();
  });
});

describe("discovery read-model: page endpoints", () => {
  it("serializes each @livestreak/host page shape from the DB", async () => {
    const deps = createHostRouteDeps(defaultHostServerConfig(), {
      catalogReaders: providerFor(snapshot("m9")),
      agents: [
        {
          id: "a1",
          name: "Book One",
          address: "0xa",
          role: "bookmaker",
          accuracy: 0.9,
          winRate: 0.7,
          vaultsCreated: 4,
          vaultsMonitored: 0,
          totalVolume: 1000,
          reputation: 88
        }
      ]
    });
    const app = createApp(deps);

    await request(app).post("/catalog/markets").send({ chain: "evm", marketId: "m9" }).expect(201);

    const home = await request(app).get("/homepage").expect(200);
    expect(home.body.streams).toHaveLength(1);
    expect(home.body.streams[0]).toMatchObject({ marketId: "m9", chain: "evm", isLive: true });
    expect(home.body.liveVaults).toHaveLength(1);
    expect(home.body.liveVaults[0]).toMatchObject({ id: "v-open", status: "open", chain: "evm" });
    expect(home.body.lifetimeVaults).toHaveLength(1);
    expect(home.body.lifetimeVaults[0]).toMatchObject({ id: "v-done", outcome: "yes" });
    expect(home.body.protocolStats).toEqual({
      totalVaults: 2,
      totalVolume: 430,
      activeStreams: 1
    });

    const stream = await request(app).get("/stream/m9").expect(200);
    expect(stream.body).toMatchObject({ marketId: "m9", chain: "evm", isLive: true });
    expect(stream.body.watchUrl).toContain("/content/blobs/ipfs/feedblob");

    const agents = await request(app).get("/agents").expect(200);
    expect(agents.body.agents).toHaveLength(1);
    expect(agents.body.agents[0]).toMatchObject({ id: "a1", role: "bookmaker" });

    await request(app).get("/stream/missing").expect(404);
  });
});
