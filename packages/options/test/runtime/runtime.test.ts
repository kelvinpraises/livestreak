import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it, vi } from "vitest";

import { asMarketId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import {
  createContractsOptionsReadTransport,
  type LivestreakContractAddresses
} from "../../src/read/contracts/index.js";
import {
  createOptionsRuntime,
  validateOptionsRuntimeConfig,
  type OptionsRuntimeInput
} from "../../src/runtime/index.js";
import {
  createFakeOptionsReadTransport,
  fixtureSeed,
  fixtureUser
} from "../helpers/fake-transport.js";
import type { OptionsReadTransport } from "../../src/read/transport.js";

const HEX_MARKET_ID = asMarketId(
  "0x0000000000000000000000000000000000000000000000000000000000000001"
);

const CONTRACT_ADDRESSES: LivestreakContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  bookmakerRegistry: "0x0000000000000000000000000000000000000012",
  vaultFactory: "0x0000000000000000000000000000000000000013",
  vault: "0x0000000000000000000000000000000000000014",
  vaultFunding: "0x0000000000000000000000000000000000000015",
  flowToken: "0x0000000000000000000000000000000000000016",
  stewardRegistry: "0x0000000000000000000000000000000000000017"
};

const baseInput = (transport: OptionsReadTransport): OptionsRuntimeInput => ({
  config: {
    runtimeId: "runtime_01",
    user: fixtureUser(),
    marketIds: [asMarketId("market_01")],
    defaultMarketId: asMarketId("market_01")
  },
  transport
});

describe("options runtime config", () => {
  it("accepts valid config", () => {
    const config = validateOptionsRuntimeConfig({
      runtimeId: "runtime_01",
      user: fixtureUser(),
      marketIds: [asMarketId("market_01")],
      defaultMarketId: asMarketId("market_01"),
      refreshIntervalMs: 5_000
    });

    expect(config.runtimeId).toBe("runtime_01");
    expect(config.refreshIntervalMs).toBe(5_000);
  });

  it("rejects empty runtime id", () => {
    expect(() =>
      validateOptionsRuntimeConfig({
        runtimeId: "   "
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects invalid refresh interval", () => {
    expect(() =>
      validateOptionsRuntimeConfig({
        runtimeId: "runtime_01",
        refreshIntervalMs: 0
      })
    ).toThrow(LiveStreakConfigError);

    expect(() =>
      validateOptionsRuntimeConfig({
        runtimeId: "runtime_01",
        refreshIntervalMs: Number.NaN
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects defaultMarketId outside marketIds", () => {
    expect(() =>
      validateOptionsRuntimeConfig({
        runtimeId: "runtime_01",
        marketIds: [asMarketId("market_01")],
        defaultMarketId: asMarketId("market_02")
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects non-object config shapes", () => {
    for (const input of [null, "runtime", [], 123]) {
      expect(() => validateOptionsRuntimeConfig(input)).toThrow(LiveStreakConfigError);
    }
  });

  it("rejects invalid field shapes", () => {
    expect(() => validateOptionsRuntimeConfig({ runtimeId: 123 })).toThrow(LiveStreakConfigError);
    expect(() =>
      validateOptionsRuntimeConfig({ runtimeId: "runtime_01", marketIds: "market_01" })
    ).toThrow(LiveStreakConfigError);
    expect(() =>
      validateOptionsRuntimeConfig({ runtimeId: "runtime_01", marketIds: [""] })
    ).toThrow(LiveStreakConfigError);
    expect(() =>
      validateOptionsRuntimeConfig({ runtimeId: "runtime_01", refreshIntervalMs: Infinity })
    ).toThrow(LiveStreakConfigError);
  });

  it("trims string fields on valid object input", () => {
    const config = validateOptionsRuntimeConfig({
      runtimeId: "  runtime_01  ",
      user: "  0xuser  ",
      marketIds: ["  market_01  "],
      defaultMarketId: "  market_01  "
    });

    expect(config.runtimeId).toBe("runtime_01");
    expect(config.user).toBe("0xuser");
    expect(config.marketIds?.[0]).toBe("market_01");
    expect(config.defaultMarketId).toBe("market_01");
  });
});

describe("options runtime store and refresh", () => {
  it("refreshMarket stores market snapshot", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    const state = await runtime.refreshMarket(asMarketId("market_01"));

    expect(state.markets).toHaveLength(1);
    expect(state.markets[0]?.market.title).toBe("Regulation hearing");
    expect(state.vaults.length).toBeGreaterThan(0);
  });

  it("refreshVault stores vault snapshot with user position when user supplied", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const runtime = createOptionsRuntime(baseInput(transport));

    const state = await runtime.refreshVault(asVaultId("vault_01"), user);

    expect(state.vaults).toHaveLength(1);
    expect(state.vaults[0]?.userPosition?.positions.yes.streamed).toBe(25_000_000n);
  });

  it("refreshUser stores user/options/FLOW snapshot", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const runtime = createOptionsRuntime(baseInput(transport));

    const state = await runtime.refreshUser(user, asMarketId("market_01"));

    expect(state.userSnapshot?.lvstAccount.balance).toBeGreaterThan(0n);
    expect(state.userSnapshot?.markets).toHaveLength(1);
    expect(state.userSnapshot?.vaults).toHaveLength(1);
  });

  it("readPanel projects from stored data without calling transport again", async () => {
    const user = fixtureUser();
    let transportCalls = 0;
    const transport = wrapTransport(createFakeOptionsReadTransport(fixtureSeed(user)), () => {
      transportCalls += 1;
    });
    const runtime = createOptionsRuntime(baseInput(transport));

    await runtime.refreshUser(user, asMarketId("market_01"));
    const callsAfterRefresh = transportCalls;

    const panel = runtime.readPanel();

    expect(panel.lvst.balanceLVST).toBeTruthy();
    expect(panel.markets[0]?.title).toBe("Regulation hearing");
    expect(transportCalls).toBe(callsAfterRefresh);
  });

  it("fails with LiveStreakConfigError when market is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    await expect(runtime.refreshMarket(asMarketId("missing"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });

  it("fails with LiveStreakConfigError when vault is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    await expect(runtime.refreshVault(asVaultId("missing"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });

  it("fails with LiveStreakConfigError when FLOW account is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    await expect(
      runtime.refreshUser(asUserAddress("0xmissing"), asMarketId("market_01"))
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("isolates two runtimes with two fake transports", async () => {
    const transportA = createFakeOptionsReadTransport(fixtureSeed());
    const transportB = createFakeOptionsReadTransport(fixtureSeed());

    const runtimeA = createOptionsRuntime({
      config: { runtimeId: "runtime_a", user: fixtureUser() },
      transport: transportA
    });
    const runtimeB = createOptionsRuntime({
      config: { runtimeId: "runtime_b", user: fixtureUser() },
      transport: transportB
    });

    transportB.setMarket({
      ...(await transportB.readMarket(asMarketId("market_01"))),
      title: "Other market"
    });

    await runtimeA.refreshUser(fixtureUser(), asMarketId("market_01"));
    await runtimeB.refreshUser(fixtureUser(), asMarketId("market_01"));

    expect(runtimeA.readSnapshot().userSnapshot?.markets[0]?.market.title).toBe(
      "Regulation hearing"
    );
    expect(runtimeB.readSnapshot().userSnapshot?.markets[0]?.market.title).toBe("Other market");
  });

  it("subscription receives snapshot update and unsubscribe works", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const runtime = createOptionsRuntime(baseInput(transport));

    const seen: number[] = [];
    const unsubscribe = runtime.subscribeSnapshots((state) => {
      seen.push(state.revision);
    });

    await runtime.refreshUser(user, asMarketId("market_01"));
    unsubscribe();
    await runtime.refreshVault(asVaultId("vault_01"), user);

    expect(seen).toEqual([1]);
  });

  it("does not export writes or bridge from runtime module", async () => {
    const runtimeModule = await import("../../src/runtime/index.js");

    expect("createOptionsBridge" in runtimeModule).toBe(false);
    expect("setFundingRate" in runtimeModule).toBe(false);
    expect("claimVault" in runtimeModule).toBe(false);
  });

  it("notifies subscribers when refreshMarket fails and clears lastError on success", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    const revisions: number[] = [];
    const errors: Array<string | undefined> = [];
    runtime.subscribeSnapshots((state) => {
      revisions.push(state.revision);
      errors.push(state.lastError?.message);
    });

    await expect(runtime.refreshMarket(asMarketId("missing"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    expect(revisions.at(-1)).toBeGreaterThan(0);
    expect(errors.at(-1)).toBeTruthy();

    await runtime.refreshMarket(asMarketId("market_01"));
    expect(runtime.readSnapshot().lastError).toBeUndefined();
    expect(errors.at(-1)).toBeUndefined();
  });

  it("does not let returned snapshot mutation affect the store", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const runtime = createOptionsRuntime(baseInput(transport));

    await runtime.refreshMarket(asMarketId("market_01"));
    const first = runtime.readSnapshot();
    const mutableMarkets = [...first.markets] as Array<(typeof first.markets)[number]>;
    mutableMarkets.push({
      market: {
        marketId: asMarketId("mutated"),
        title: "mutated",
        status: "open",
        vaultIds: []
      },
      vaults: []
    });
    const mutableMarket = { ...mutableMarkets[0]!.market, vaultIds: [...mutableMarkets[0]!.market.vaultIds] };
    mutableMarket.title = "mutated title";
    mutableMarket.vaultIds.push(asVaultId("vault_mutated"));

    const second = runtime.readSnapshot();
    expect(second.markets).toHaveLength(1);
    expect(second.markets[0]?.market.title).toBe("Regulation hearing");
    expect(second.markets[0]?.market.vaultIds).not.toContain(asVaultId("vault_mutated"));
  });

  it("polling records failures without unhandled rejections and stop is idempotent", async () => {
    vi.useFakeTimers();

    try {
      let readerCalls = 0;
      const transport = createContractsOptionsReadTransport({
        reader: {
          read: async () => {
            readerCalls += 1;
            throw new LiveStreakConfigError({
              message: "polling read failed",
              metadata: { details: "test" }
            });
          }
        },
        addresses: CONTRACT_ADDRESSES
      });

      const runtime = createOptionsRuntime({
        config: {
          runtimeId: "runtime_poll",
          marketIds: [HEX_MARKET_ID],
          refreshIntervalMs: 1_000
        },
        transport
      });

      const revisions: number[] = [];
      const errors: string[] = [];
      runtime.subscribeSnapshots((state) => {
        revisions.push(state.revision);
        if (state.lastError !== undefined) {
          errors.push(state.lastError.message);
        }
      });

      const handle = runtime.startPolling();
      expect(() => runtime.startPolling()).toThrow(LiveStreakConfigError);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readerCalls).toBeGreaterThan(0);
      expect(revisions.length).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThan(0);

      handle.stop();
      handle.stop();
      const countAfterStop = revisions.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(revisions.length).toBe(countAfterStop);
    } finally {
      vi.useRealTimers();
    }
  });
});

const wrapTransport = (
  transport: OptionsReadTransport,
  onCall: () => void
): OptionsReadTransport => ({
  readMarket: async (marketId) => {
    onCall();
    return transport.readMarket(marketId);
  },
  listMarketVaults: async (marketId) => {
    onCall();
    return transport.listMarketVaults(marketId);
  },
  readVault: async (vaultId) => {
    onCall();
    return transport.readVault(vaultId);
  },
  readUserVaultPosition: async (user, vaultId) => {
    onCall();
    return transport.readUserVaultPosition(user, vaultId);
  },
  readFundingStream: async (user, vaultId, side) => {
    onCall();
    return transport.readFundingStream(user, vaultId, side);
  },
  readLvstAccount: async (user) => {
    onCall();
    return transport.readLvstAccount(user);
  },
  ...(transport.readProtocolSummary === undefined
    ? {}
    : {
        readProtocolSummary: async () => {
          onCall();
          return transport.readProtocolSummary!();
        }
      })
});
