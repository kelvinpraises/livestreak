import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";
import type { OptionsMarketSnapshot, OptionsReader } from "@livestreak/options";
import { createDatabase } from "#database/connection.js";
import { migrateSync, migrateToLatest } from "#database/migrations/index.js";
import { SCHEMA_DDL } from "#database/migrations/2026-10-04T08:00:00+0000.js";
import { createCatalogIndexer } from "#features/catalog/indexer.js";
import { createCatalogReadModel } from "#features/catalog/read-model.js";
import type { Kysely } from "kysely";
import type { DB, ChainTag } from "#database/schema.js";

const NOW = 1000000;
const handles: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});
function database() {
  const handle = createDatabase(":memory:");
  handles.push(handle);
  migrateSync(handle.sqlite);
  return { handle, db: handle.db };
}
function snapshot(status = "open"): OptionsMarketSnapshot {
  return {
    market: {
      marketId: "m",
      title: "Show",
      vaultIds: ["v"],
      timing: { createdAtMs: NOW - 10000 },
    },
    streamState: {
      status: "live",
      id: "m",
      scheme: "host",
      updatedAtMs: NOW - 5000,
      endedAtMs: 0,
    },
    vaults: [
      {
        vaultId: "v",
        marketId: "m",
        question: "Happens?",
        status,
        outcome: status === "resolved" ? "yes" : "pending",
        pools: { yes: 1000000n, no: 2000000n },
        timing: {
          expiresAtMs: NOW + 10000,
          resolvedAtMs: status === "resolved" ? NOW - 1 : undefined,
        },
        steward: { hot: false },
      },
    ],
  } as unknown as OptionsMarketSnapshot;
}
function reader(snap: OptionsMarketSnapshot): OptionsReader {
  return {
    listMarketIds: async () => ["m"],
    readMarket: async () => snap.market,
    listMarketVaults: async () => ["v"],
    readStreamState: async () => snap.streamState,
    readVault: async () => snap.vaults[0],
    readVaultShareTotals: async () => ({ yes: 0n, no: 0n }),
    readBoard: async (_id: string, side: string) => ({
      pool: side === "yes" ? 1000000n : 2000000n,
      sideRate: 0n,
      g: 0n,
      lastAdvanceMs: NOW,
    }),
    readPendingBoundaries: async () => 0n,
    readBoundaries: async () => [],
  } as unknown as OptionsReader;
}

async function storedRows(db: Kysely<DB>) {
  return db.transaction().execute(async (tx) => ({
    markets: await tx
      .selectFrom("markets")
      .selectAll()
      .orderBy("updated_at", "desc")
      .execute(),
    vaults: await tx.selectFrom("vaults").selectAll().execute(),
    resolutions: await tx.selectFrom("resolutions").selectAll().execute(),
  }));
}
async function seed(
  db: Kysely<DB>,
  chain: ChainTag,
  snap: OptionsMarketSnapshot,
  at: number,
  live?: boolean,
) {
  const indexer = createCatalogIndexer({
    db,
    readers: { availableChains: [chain], reader: () => reader(snap) },
    baseUrl: "http://host",
    knownMarkets: () => [],
    now: () => at,
    ...(live === undefined ? {} : { isStreamLive: () => live }),
  });
  expect(await indexer.syncMarket({ chain, marketId: "m" })).toBe(true);
}

describe("catalog correctness under failure and identity permutations", () => {
  it("times out a stalled market, permits retry and prevents late reads overwriting recovery", async () => {
    const { db } = database();
    const old = snapshot();
    let release!: (value: OptionsMarketSnapshot["market"]) => void;
    const r = reader(old);
    const marketRead = vi.spyOn(r, "readMarket").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const indexer = createCatalogIndexer({
      db,
      readers: { availableChains: ["evm"], reader: () => r },
      baseUrl: "http://host",
      knownMarkets: () => [],
      readTimeoutMs: 20,
      now: () => NOW,
    });
    expect(await indexer.syncAll()).toEqual({ indexed: 0, failed: 1 });
    expect(await db.selectFrom("markets").selectAll().execute()).toEqual([]);
    expect(await indexer.syncAll()).toEqual({ indexed: 1, failed: 0 });
    release({ ...old.market, title: "Late obsolete title" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await db.selectFrom("markets").selectAll().execute())[0]?.title).toBe("Show");
    expect(marketRead).toHaveBeenCalledTimes(2);
  });
  it("serves every discovery endpoint from the same projection with chain-qualified detail routes", async () => {
    const evm = reader(snapshot("resolved"));
    const sui = reader(snapshot());
    const { handle } = database();
    const deps = createHostRouteDeps(defaultHostServerConfig(), {
      catalogDb: handle,
      catalogReaders: {
        availableChains: ["evm", "sui"],
        reader: (chain) => (chain === "evm" ? evm : chain === "sui" ? sui : null),
      },
    });
    const app = createApp(deps);
    const home = (await request(app).get("/homepage").expect(200)).body;
    const catalog = (await request(app).get("/catalog").expect(200)).body;
    const full = (await request(app).get("/catalog/full").expect(200)).body;
    expect(catalog.streams).toEqual(home.streams);
    expect(full.catalog.streams).toEqual(home.streams);
    expect(full.homepage.protocolStats).toEqual(home.protocolStats);
    expect(home.indexing.status).toBe("fresh");
    expect(home.protocolStats).toEqual({
      totalVaults: 2,
      totalVolume: 6,
      activeStreams: 0,
    });
    expect(Object.keys(full.streams).sort()).toEqual(["evm:m", "sui:m"]);
    await request(app).get("/stream/m").expect(409);
    await request(app).get("/catalog/streams/m").expect(409);
    const stream = (await request(app).get("/stream/m?chain=sui").expect(200)).body;
    const alias = (await request(app).get("/catalog/streams/m?chain=sui").expect(200)).body;
    expect(alias).toEqual(stream);
    expect(stream).toEqual(full.streams["sui:m"]);
    await request(app).get("/homepage?chain=unknown").expect(400);
    await request(app).get("/stream/m?chain=unknown").expect(400);
    const scoped = (await request(app).get("/homepage?chain=solana").expect(200)).body;
    expect(scoped.indexing.status).toBe("unavailable");
    expect(scoped.streams).toEqual([]);
  });
  it("scopes totals to verified graphs through a second-chain outage and recovery", async () => {
    const { db } = database();
    const evm = reader(snapshot("resolved"));
    const sui = reader(snapshot("resolved"));
    const indexer = createCatalogIndexer({
      db,
      readers: {
        availableChains: ["evm", "sui"],
        reader: (c) => (c === "evm" ? evm : sui),
      },
      baseUrl: "http://host",
      knownMarkets: () => [],
      now: () => NOW,
    });
    const model = createCatalogReadModel({ db, health: indexer.health, now: () => NOW });
    await indexer.syncAll();
    expect((await model.homepage()).protocolStats.totalVolume).toBe(6);
    const failure = vi.spyOn(sui, "readVault").mockRejectedValue(new Error("Sui offline"));
    await indexer.syncAll();
    const partial = await model.homepage();
    expect(partial.indexing).toMatchObject({
      status: "partial",
      statsScope: "verified-subset",
      verifiedChains: ["evm"],
    });
    expect(partial.protocolStats).toEqual({
      totalVaults: 1,
      totalVolume: 3,
      activeStreams: 1,
    });
    expect(partial.lifetimeVaults.filter((v) => !v.stale).map((v) => v.chain)).toEqual([
      "evm",
    ]);
    expect(partial.streams.find((s) => s.chain === "sui")).toMatchObject({
      stale: true,
      isLive: false,
    });
    failure.mockRestore();
    await indexer.syncAll();
    const recovered = await model.homepage();
    expect(recovered.indexing).toMatchObject({
      status: "fresh",
      statsScope: "complete",
      verifiedChains: ["evm", "sui"],
    });
    expect(recovered.protocolStats.totalVolume).toBe(6);
    expect(recovered.lifetimeVaults.every((v) => !v.stale)).toBe(true);
  });
  it("excludes disabled-chain cache and treats a successfully enumerated empty chain as verified", async () => {
    const { db } = database();
    await seed(db, "sui", snapshot("resolved"), NOW);
    const model = createCatalogReadModel({
      db,
      health: () => ({ availableChains: ["evm"], failedChains: [], failedMarketKeys: [] }),
      now: () => NOW,
    });
    const home = await model.homepage();
    expect(home.indexing).toMatchObject({
      status: "fresh",
      statsScope: "complete",
      verifiedChains: ["evm"],
    });
    expect(home.streams).toEqual([]);
    expect(home.lifetimeVaults).toEqual([]);
    expect(home.protocolStats).toEqual({
      totalVaults: 0,
      totalVolume: 0,
      activeStreams: 0,
    });
    expect(await model.stream("m", "sui")).toBeNull();
    expect((await model.homepage("sui")).indexing?.statsScope).toBe("unavailable");
    expect((await db.selectFrom("markets").selectAll().execute()).length).toBe(1);
  });
  it("rolls back a failed replacement without losing the old market and resolution", async () => {
    const { db } = database();
    await seed(db, "evm", snapshot("resolved"), NOW);
    const before = await storedRows(db);
    const next = snapshot();
    (next.market as { title: string }).title = "Must roll back";
    const r = reader(next);
    vi.spyOn(r, "listMarketVaults").mockResolvedValue(["v", "v"] as never);
    const indexer = createCatalogIndexer({
      db,
      readers: { availableChains: ["evm"], reader: () => r },
      baseUrl: "http://host",
      knownMarkets: () => [],
      now: () => NOW + 1,
    });
    expect(await indexer.syncMarket({ chain: "evm", marketId: "m" })).toBe(false);
    expect(await storedRows(db)).toEqual(before);
  });
  it("rejects corrupted aggregate and outcome data, and does not invent a resolution timestamp", async () => {
    const { db, handle } = database();
    const unknownTime = snapshot("resolved");
    delete (unknownTime.vaults[0]!.timing as { resolvedAtMs?: number }).resolvedAtMs;
    await seed(db, "evm", unknownTime, NOW);
    const model = createCatalogReadModel({ db, now: () => NOW });
    expect((await model.homepage()).lifetimeVaults[0]).toMatchObject({
      resolutionTimeKnown: false,
      resolvedAgoMs: 0,
    });
    handle.sqlite.prepare("UPDATE resolutions SET outcome = 'corrupt'").run();
    await expect(model.homepage()).rejects.toThrow("disagrees");
    await seed(db, "evm", snapshot(), NOW);
    handle.sqlite.prepare("UPDATE markets SET total_pooled = 42").run();
    await expect(model.homepage()).rejects.toThrow("totals disagree");
  });
  it("preserves a complete snapshot when any child, stream or board read fails", async () => {
    const { db } = database();
    const r = reader(snapshot());
    let at = NOW;
    const indexer = createCatalogIndexer({
      db,
      readers: { availableChains: ["evm"], reader: () => r },
      baseUrl: "http://host",
      knownMarkets: () => [],
      now: () => at,
    });
    expect(await indexer.syncAll()).toEqual({ indexed: 1, failed: 0 });
    const previous = await storedRows(db);
    at += 1000;
    for (const method of ["readVault", "readStreamState", "readBoard"] as const) {
      const spy = vi.spyOn(r, method).mockRejectedValue(new Error("RPC offline"));
      expect(await indexer.syncAll()).toEqual({ indexed: 0, failed: 1 });
      expect(await storedRows(db)).toEqual(previous);
      const home = await createCatalogReadModel({
        db,
        health: indexer.health,
        now: () => at,
      }).homepage();
      expect(home.indexing?.status).toBe("unavailable");
      expect(home.protocolStats).toEqual({
        totalVaults: 0,
        totalVolume: 0,
        activeStreams: 0,
      });
      expect(home.streams[0]?.stale).toBe(true);
      expect(home.protocolStats.activeStreams).toBe(0);
      spy.mockRestore();
    }
    expect(await indexer.syncAll()).toEqual({ indexed: 1, failed: 0 });
    expect(indexer.health().failedMarkets).toBe(0);
  });
  it("shares overlapping cron and lazy reads instead of racing writes", async () => {
    const { db } = database();
    const r = reader(snapshot());
    const spy = vi.spyOn(r, "readMarket");
    const indexer = createCatalogIndexer({
      db,
      readers: { availableChains: ["evm"], reader: () => r },
      baseUrl: "http://host",
      knownMarkets: () => [],
      now: () => NOW,
    });
    await Promise.all([indexer.syncAll(), indexer.ensureAll(), indexer.ensureFresh("m")]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("keeps identical IDs on different chains independent and rejects ambiguous routes", async () => {
    const { db } = database();
    await seed(db, "evm", snapshot("resolved"), NOW);
    await seed(db, "sui", snapshot(), NOW);
    expect((await db.selectFrom("markets").selectAll().execute()).length).toBe(2);
    expect(
      (
        await db
          .selectFrom("vaults")
          .selectAll()
          .where("status", "in", ["open", "hot"])
          .execute()
      ).length,
    ).toBe(1);
    expect((await db.selectFrom("resolutions").selectAll().execute()).length).toBe(1);
    await expect(
      createCatalogReadModel({ db, now: () => NOW }).stream("m"),
    ).rejects.toThrow("ambiguous");
    expect(
      (
        await db
          .selectFrom("markets")
          .selectAll()
          .where("id", "=", "m")
          .where("chain", "=", "sui")
          .executeTakeFirst()
      )?.chain,
    ).toBe("sui");
    const home = await createCatalogReadModel({ db, now: () => NOW }).homepage();
    expect(home.protocolStats.totalVaults).toBe(2);
    expect(home.protocolStats.totalVolume).toBe(6);
    expect(home.lifetimeVaults[0]?.chain).toBe("evm");
    await seed(db, "evm", snapshot(), NOW + 1);
    expect(await db.selectFrom("resolutions").selectAll().execute()).toEqual([]); // Fresh chain observation removed the previous outcome.
  });
  it("exposes stale indexing and never presents an aged live cache as current", async () => {
    const { db } = database();
    await seed(db, "solana", snapshot(), NOW);
    const home = await createCatalogReadModel({ db, now: () => NOW + 50000 }).homepage();
    expect(home.indexing?.status).toBe("unavailable");
    expect(home.streams[0]?.isLive).toBe(false);
    expect(home.streams[0]?.stale).toBe(true);
    expect(home.protocolStats.activeStreams).toBe(0);
  });
  it("requires observed video liveness when a signaling observation is available", async () => {
    const { db } = database();
    await seed(db, "evm", snapshot(), NOW, false);
    expect(
      (
        await db
          .selectFrom("markets")
          .selectAll()
          .where("id", "=", "m")
          .where("chain", "=", "evm")
          .executeTakeFirst()
      )?.is_live,
    ).toBe(0);
    const ended = snapshot();
    (ended.streamState as { status: string }).status = "ended";
    await seed(db, "evm", ended, NOW, true);
    const home = await createCatalogReadModel({ db, now: () => NOW }).homepage();
    expect(home.streams[0]?.isLive).toBe(false);
    expect(home.streams[0]?.elapsed).toBe("");
    expect(home.streams[0]?.category).toBe("Uncategorized");
  });
  it("does not turn invalid stored amounts into valid zero balances", async () => {
    const { db, handle } = database();
    await seed(db, "evm", snapshot(), NOW);
    handle.sqlite.prepare("UPDATE vaults SET live_yes_pool = 'corrupt'").run();
    await expect(createCatalogReadModel({ db, now: () => NOW }).homepage()).rejects.toThrow(
      "Invalid indexed pool",
    );
  });
  it("exposes failed enumeration even when a seeded market can still be read", async () => {
    const { db } = database();
    const r = reader(snapshot());
    vi.spyOn(r, "listMarketIds").mockRejectedValue(new Error("Registry unavailable"));
    const indexer = createCatalogIndexer({
      db,
      readers: { availableChains: ["evm"], reader: () => r },
      baseUrl: "http://host",
      knownMarkets: () => [{ chain: "evm", marketId: "m" }],
      now: () => NOW,
    });
    await indexer.ensureAll();
    const home = await createCatalogReadModel({
      db,
      health: indexer.health,
      now: () => NOW,
    }).homepage();
    expect(home.streams.length).toBe(1);
    expect(home.indexing?.status).toBe("partial");
    expect(home.indexing?.failedChains).toEqual(["evm"]);
    expect(home.indexing?.statsScope).toBe("verified-subset");
    expect(home.streams[0]?.stale).toBe(false);
    expect(home.protocolStats.totalVolume).toBe(3);
  });
  it.each(["sync", "formal"])(
    "upgrades legacy keys and appended columns without losing records (%s)",
    async (mode) => {
      const handle = createDatabase(":memory:");
      handles.push(handle);
      const legacy = SCHEMA_DDL.replaceAll("  deployment_scope TEXT NOT NULL DEFAULT '',\n", "")
        .replaceAll("deployment_scope, ", "")
        .replace(
        "id            TEXT NOT NULL,",
        "id            TEXT PRIMARY KEY,",
      )
        .replace("id               TEXT NOT NULL,", "id               TEXT PRIMARY KEY,")
        .replace("vault_id    TEXT NOT NULL,", "vault_id    TEXT PRIMARY KEY,")
        .replace(/,\n {2}PRIMARY KEY \(chain, (id|vault_id)\)/g, "")
        .replace(
          "  stream_scheme TEXT NOT NULL DEFAULT '',\n  ended_at_ms   INTEGER,\n",
          "",
        );
      handle.sqlite.exec(
        legacy.replace(
          "  live_yes_pool    TEXT NOT NULL DEFAULT '0',\n  live_no_pool     TEXT NOT NULL DEFAULT '0',\n",
          "",
        ),
      );
      handle.sqlite.exec(
        "ALTER TABLE vaults ADD COLUMN live_yes_pool TEXT NOT NULL DEFAULT '0'; ALTER TABLE vaults ADD COLUMN live_no_pool TEXT NOT NULL DEFAULT '0'",
      );
      handle.sqlite
        .prepare(
          "INSERT INTO markets(id,chain,route_id,title,category) VALUES('m','evm','m','Preserved','Tech')",
        )
        .run();
      handle.sqlite
        .prepare(
          "INSERT INTO vaults(id,market_id,chain,question,status,yes_pool,no_pool,live_yes_pool,live_no_pool,expires_at_ms,resolved_at_ms) VALUES('v','m','evm','Question','resolved','123','456','789','999',500,600)",
        )
        .run();
      handle.sqlite
        .prepare(
          "INSERT INTO resolutions(vault_id,market_id,chain,outcome,yes_total,no_total,resolved_at) VALUES('v','m','evm','yes','123','456',600)",
        )
        .run();
      if (mode === "sync") {
        migrateSync(handle.sqlite);
        migrateSync(handle.sqlite);
      } else {
        await migrateToLatest(handle.db);
        await migrateToLatest(handle.db);
      }
      expect(
        handle.sqlite
          .prepare("SELECT title, stream_scheme, ended_at_ms FROM markets")
          .get(),
      ).toEqual({ title: "Preserved", stream_scheme: "", ended_at_ms: null });
      expect(
        (
          handle.sqlite.prepare("PRAGMA table_info(markets)").all() as {
            name: string;
            pk: number;
          }[]
        ).find((c) => c.name === "chain")?.pk,
      ).toBeGreaterThan(0);
      expect(
        handle.sqlite
          .prepare(
            "SELECT yes_pool,no_pool,live_yes_pool,live_no_pool,expires_at_ms,resolved_at_ms FROM vaults",
          )
          .get(),
      ).toEqual({
        yes_pool: "123",
        no_pool: "456",
        live_yes_pool: "789",
        live_no_pool: "999",
        expires_at_ms: 500,
        resolved_at_ms: 600,
      });
      expect(
        handle.sqlite
          .prepare("SELECT outcome,yes_total,no_total,resolved_at FROM resolutions")
          .get(),
      ).toEqual({ outcome: "yes", yes_total: "123", no_total: "456", resolved_at: 600 });
    },
  );
});
