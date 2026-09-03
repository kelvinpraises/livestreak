import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  asMarketId,
  asTokenId,
  asUserAddress,
  asVaultId
} from "../src/model/index.js";
import {
  readMarketSnapshot,
  readUserOptionsSnapshot,
  readVaultSnapshot
} from "../src/read/snapshot.js";
import {
  createFakeOptionsReadTransport,
  fixtureMarket,
  fixtureNft,
  fixtureOtherMarketNft,
  fixtureSeed,
  fixtureSeedWithoutProtocol,
  fixtureShareTotals,
  fixtureUser,
  fixtureVault
} from "./helpers/fake-transport.js";

describe("options read snapshots", () => {
  it("readMarketSnapshot returns market plus vaults", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const snapshot = await readMarketSnapshot(transport, asMarketId("market_01"));

    expect(snapshot.market.title).toBe("Regulation hearing");
    expect(snapshot.market.creator).toBe("0xcreator");
    expect(snapshot.vaults).toHaveLength(1);
    expect(snapshot.vaults[0]?.question).toContain("regulation");
  });

  it("readVaultSnapshot returns pools and share totals", async () => {
    const transport = createFakeOptionsReadTransport(fixtureSeed());
    const snapshot = await readVaultSnapshot(transport, asVaultId("vault_01"));

    expect(snapshot.vault.pools.yes).toBe(94_000_000n);
    expect(snapshot.shareTotals.yes).toBe(34_000_000n);
    expect(snapshot.shareTotals.no).toBe(6_000_000n);
    expect(snapshot.hot.hot).toBe(false);
  });

  it("readUserOptionsSnapshot includes NFTs scoped to marketId", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport({
      ...fixtureSeed(user),
      markets: [
        fixtureMarket(),
        {
          ...fixtureMarket(),
          marketId: asMarketId("market_02"),
          vaultIds: [asVaultId("vault_02")]
        }
      ],
      vaults: [
        fixtureVault(),
        fixtureVault({
          vaultId: asVaultId("vault_02"),
          marketId: asMarketId("market_02")
        })
      ],
      shareTotals: {
        vault_01: fixtureShareTotals(),
        vault_02: { yes: 1_000_000n, no: 0n }
      },
      nfts: [fixtureNft(user), fixtureOtherMarketNft(user)]
    });

    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));

    expect(snapshot.nfts).toHaveLength(1);
    expect(snapshot.nfts[0]?.nft.tokenId).toBe(asTokenId(1n));
    expect(snapshot.nfts[0]?.nft.marketId).toBe(asMarketId("market_01"));
  });

  it("readUserOptionsSnapshot includes vaults from market and NFT lanes", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));

    expect(snapshot.lvstAccount.balance).toBeGreaterThan(0n);
    expect(snapshot.markets).toHaveLength(1);
    expect(snapshot.vaults).toHaveLength(1);
    expect(snapshot.nfts).toHaveLength(1);
    expect(snapshot.protocol?.marketCount).toBe(1);
  });

  it("readUserOptionsSnapshot without marketId returns empty collections", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user);

    expect(snapshot.marketId).toBeUndefined();
    expect(snapshot.markets).toHaveLength(0);
    expect(snapshot.vaults).toHaveLength(0);
    expect(snapshot.nfts).toHaveLength(0);
    expect(snapshot.lvstAccount.balance).toBeGreaterThan(0n);
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

  it("fails with LiveStreakConfigError when share totals are missing", async () => {
    const transport = createFakeOptionsReadTransport({
      markets: [fixtureMarket()],
      vaults: [fixtureVault()],
      nfts: [fixtureNft()],
      lvstAccounts: []
    });

    await expect(readVaultSnapshot(transport, asVaultId("vault_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
  });

  it("fails with LiveStreakConfigError when NFT is missing", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport({
      ...fixtureSeed(user),
      nfts: []
    });

    await expect(
      readUserOptionsSnapshot(transport, user, asMarketId("market_01"))
    ).resolves.toMatchObject({ nfts: [] });
  });

  it("fails with LiveStreakConfigError when LVST account is missing", async () => {
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
