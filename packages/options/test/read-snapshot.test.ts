import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId, asUserAddress, asVaultId } from "../src/model/index.js";
import {
  readMarketSnapshot,
  readUserOptionsSnapshot,
  readVaultSnapshot
} from "../src/read/snapshot.js";
import {
  createFakeOptionsReadTransport,
  fixtureSeed,
  fixtureSeedWithoutProtocol,
  fixtureUser
} from "./helpers/fake-transport.js";

describe("options read snapshots", () => {
  it("readMarketSnapshot returns market plus vaults", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const snapshot = await readMarketSnapshot(transport, asMarketId("market_01"));

    expect(snapshot.market.title).toBe("Regulation hearing");
    expect(snapshot.vaults).toHaveLength(1);
    expect(snapshot.vaults[0]?.question).toContain("regulation");
  });

  it("readVaultSnapshot returns pools and user position when user is provided", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readVaultSnapshot(transport, asVaultId("vault_01"), user);

    expect(snapshot.vault.pools.yes).toBe(94_000_000n);
    expect(snapshot.userPosition?.positions.yes.streamed).toBe(25_000_000n);
    expect(snapshot.userPosition?.positions.no.streamed).toBe(5_000_000n);
    expect(snapshot.funding?.yes.ratePerMinute).toBe(800_000n);
  });

  it("readUserOptionsSnapshot includes FLOW account", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));

    expect(snapshot.lvstAccount.balance).toBeGreaterThan(0n);
    expect(snapshot.markets).toHaveLength(1);
    expect(snapshot.vaults).toHaveLength(1);
    expect(snapshot.protocol?.marketCount).toBe(1);
  });

  it("readUserOptionsSnapshot omits protocol when transport has no readProtocolSummary", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeedWithoutProtocol(user));

    expect(transport.readProtocolSummary).toBeUndefined();

    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));

    expect(snapshot.protocol).toBeUndefined();
    expect(snapshot.lvstAccount.balance).toBeGreaterThan(0n);
  });

  it("fails with LiveStreakConfigError when market is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());

    await expect(readMarketSnapshot(transport, asMarketId("missing"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });

  it("fails with LiveStreakConfigError when vault is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());

    await expect(readVaultSnapshot(transport, asVaultId("missing"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });

  it("fails with LiveStreakConfigError when FLOW account is missing", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());

    await expect(
      readUserOptionsSnapshot(transport, asUserAddress("0xmissing"), asMarketId("market_01"))
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("keeps fake transport data isolated between instances", async () => {
    const left = createFakeOptionsReadTransport(fixtureSeed());
    const right = createFakeOptionsReadTransport();

    await expect(readMarketSnapshot(left, asMarketId("market_01"))).resolves.toBeDefined();
    await expect(readMarketSnapshot(right, asMarketId("market_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });
});
