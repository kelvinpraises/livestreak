// R13 — Position-console reads: NFT shared balance + runway, market stream pointer.
// Covers: model → snapshot → copy → panel projection, and the copy.ts gotcha.

import { describe, expect, it } from "vitest";

import {
  asMarketId,
  asTokenId,
  asVaultId,
  type OptionsStreamState
} from "../src/model/index.js";
import { readMarketSnapshot, readUserOptionsSnapshot } from "../src/flows/snapshot.js";
import { projectOptionsPanel } from "../src/bridge/panel/project.js";
import { copyNftSnapshot, copyMarketSnapshot } from "../src/runtime/copy.js";
import {
  createFakeOptionsReader,
  fixtureSeed,
  fixtureNft,
  fixtureUser,
  fixtureMarket,
  fixtureVault,
  fixtureShareTotals
} from "./helpers/fake-chain.js";

// --- Part A: NFT shared balance + runway ---

describe("OptionsNftPanel — balanceUSDC + runwayEndMs (Part A)", () => {
  it("projects balanceUSDC from nft.balance when present", async () => {
    const user = fixtureUser();
    const nft = fixtureNft(user, {
      balance: 5_000_000n,
      runwayEndMs: 1_800_000_000_000
    });
    const reader = createFakeOptionsReader({
      ...fixtureSeed(user),
      nfts: [nft]
    });
    const snapshot = await readUserOptionsSnapshot(reader, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.nfts[0]?.account.balanceUSDC).toBe(5);
    expect(panel.nfts[0]?.account.endsAtMs).toBe(1_800_000_000_000);
  });

  it("omits balanceUSDC and runwayEndMs when nft.balance is absent (Sui graceful path)", async () => {
    const user = fixtureUser();
    const nft = fixtureNft(user); // no balance / runwayEndMs
    const reader = createFakeOptionsReader({
      ...fixtureSeed(user),
      nfts: [nft]
    });
    const snapshot = await readUserOptionsSnapshot(reader, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.nfts[0]?.account).not.toHaveProperty("balanceUSDC");
    expect(panel.nfts[0]?.account).not.toHaveProperty("endsAtMs");
  });

  it("projects only balanceUSDC when runwayEndMs is absent", async () => {
    const user = fixtureUser();
    const nft = fixtureNft(user, { balance: 1_000_000n });
    const reader = createFakeOptionsReader({
      ...fixtureSeed(user),
      nfts: [nft]
    });
    const snapshot = await readUserOptionsSnapshot(reader, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.nfts[0]?.account.balanceUSDC).toBe(1);
    expect(panel.nfts[0]?.account).not.toHaveProperty("endsAtMs");
  });

  it("copy.ts gotcha — balance and runwayEndMs survive copyNftSnapshot round-trip", () => {
    const user = fixtureUser();
    const nft = fixtureNft(user, {
      balance: 9_876_543n,
      runwayEndMs: 1_900_000_000_000
    });
    const snapshot = { nft };
    const copied = copyNftSnapshot(snapshot);

    expect(copied.nft.balance).toBe(9_876_543n);
    expect(copied.nft.runwayEndMs).toBe(1_900_000_000_000);
  });

  it("copy.ts gotcha — absent balance/runwayEndMs stay absent after copy", () => {
    const user = fixtureUser();
    const snapshot = { nft: fixtureNft(user) };
    const copied = copyNftSnapshot(snapshot);

    expect(copied.nft).not.toHaveProperty("balance");
    expect(copied.nft).not.toHaveProperty("runwayEndMs");
  });
});

// --- Part B: per-market stream pointer ---

const fixtureStreamState = (
  status: OptionsStreamState["status"] = "live"
): OptionsStreamState => ({
  status,
  scheme: "walrus-testnet",
  id: "test-blob-id",
  updatedAtMs: 1_700_000_000_000,
  endedAtMs: status === "ended" ? 1_700_001_000_000 : 0
});

describe("OptionsMarketPanel.stream (Part B)", () => {
  it("projects stream pointer from readStreamState result", async () => {
    const reader = createFakeOptionsReader({
      ...fixtureSeed(),
      streamStates: {
        market_01: fixtureStreamState("live")
      }
    });
    const snapshot = await readMarketSnapshot(reader, asMarketId("market_01"));
    const userSnapshot = await readUserOptionsSnapshot(
      reader,
      fixtureUser(),
      asMarketId("market_01")
    );
    const panel = projectOptionsPanel(userSnapshot);

    // Panel from full user snapshot also carries stream.
    expect(panel.markets[0]?.stream?.status).toBe("live");
    expect(panel.markets[0]?.stream?.scheme).toBe("walrus-testnet");
    expect(panel.markets[0]?.stream?.id).toBe("test-blob-id");
  });

  it("stream pointer is absent when readStreamState throws (no stream on-chain)", async () => {
    // No streamStates in seed → FakeReader throws → should be caught gracefully.
    const reader = createFakeOptionsReader(fixtureSeed());
    const snapshot = await readMarketSnapshot(reader, asMarketId("market_01"));

    expect(snapshot.streamState).toBeUndefined();

    const userSnapshot = await readUserOptionsSnapshot(
      reader,
      fixtureUser(),
      asMarketId("market_01")
    );
    const panel = projectOptionsPanel(userSnapshot);
    expect(panel.markets[0]).not.toHaveProperty("stream");
  });

  it("stream pointer carries ended status and endedAtMs", async () => {
    const reader = createFakeOptionsReader({
      ...fixtureSeed(),
      streamStates: {
        market_01: fixtureStreamState("ended")
      }
    });
    const snapshot = await readMarketSnapshot(reader, asMarketId("market_01"));

    expect(snapshot.streamState?.status).toBe("ended");
    expect(snapshot.streamState?.endedAtMs).toBe(1_700_001_000_000);

    const userSnapshot = await readUserOptionsSnapshot(
      reader,
      fixtureUser(),
      asMarketId("market_01")
    );
    const panel = projectOptionsPanel(userSnapshot);
    expect(panel.markets[0]?.stream?.status).toBe("ended");
    expect(panel.markets[0]?.stream?.endedAtMs).toBe(1_700_001_000_000);
  });

  it("stream.updatedAtMs is omitted when zero", async () => {
    const reader = createFakeOptionsReader({
      ...fixtureSeed(),
      streamStates: {
        market_01: {
          status: "none",
          scheme: "walrus-testnet",
          id: "",
          updatedAtMs: 0,
          endedAtMs: 0
        }
      }
    });
    const userSnapshot = await readUserOptionsSnapshot(
      reader,
      fixtureUser(),
      asMarketId("market_01")
    );
    const panel = projectOptionsPanel(userSnapshot);

    expect(panel.markets[0]?.stream).not.toHaveProperty("updatedAtMs");
    expect(panel.markets[0]?.stream).not.toHaveProperty("endedAtMs");
  });

  it("stream pointer does NOT include VOD manifest body", async () => {
    const reader = createFakeOptionsReader({
      ...fixtureSeed(),
      streamStates: {
        market_01: fixtureStreamState("ended")
      }
    });
    const userSnapshot = await readUserOptionsSnapshot(
      reader,
      fixtureUser(),
      asMarketId("market_01")
    );
    const panel = projectOptionsPanel(userSnapshot);
    const stream = panel.markets[0]?.stream;

    expect(stream).not.toHaveProperty("vodUrl");
    expect(stream).not.toHaveProperty("manifest");
    expect(stream).not.toHaveProperty("playbackUrl");
  });

  it("copy.ts gotcha — streamState survives copyMarketSnapshot round-trip", () => {
    const market = fixtureMarket();
    const vault = fixtureVault();
    const streamState = fixtureStreamState("live");
    const snapshot = { market, vaults: [vault], streamState };

    const copied = copyMarketSnapshot(snapshot);

    expect(copied.streamState?.status).toBe("live");
    expect(copied.streamState?.scheme).toBe("walrus-testnet");
    expect(copied.streamState?.id).toBe("test-blob-id");
    expect(copied.streamState?.updatedAtMs).toBe(1_700_000_000_000);
  });

  it("copy.ts gotcha — absent streamState stays absent after copy", () => {
    const market = fixtureMarket();
    const snapshot = { market, vaults: [] };

    const copied = copyMarketSnapshot(snapshot);

    expect(copied).not.toHaveProperty("streamState");
  });
});

// --- Combined: refresh round-trip proves both sets of fields survive copy.ts ---

describe("refresh round-trip — new fields survive copy layer", () => {
  it("NFT balance + market stream both visible on panel after full readUserOptionsSnapshot", async () => {
    const user = fixtureUser();
    const nft = fixtureNft(user, {
      balance: 2_500_000n,
      runwayEndMs: 1_750_000_000_000
    });
    const reader = createFakeOptionsReader({
      markets: [fixtureMarket()],
      vaults: [fixtureVault()],
      shareTotals: { vault_01: fixtureShareTotals() },
      nfts: [nft],
      lvstAccounts: [
        {
          account: user,
          balance: 1_000_000_000_000_000_000n,
          staked: 0n,
          pendingDividends: 0n
        }
      ],
      streamStates: {
        market_01: fixtureStreamState("live")
      }
    });

    const snapshot = await readUserOptionsSnapshot(reader, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    // NFT balance panel fields
    expect(panel.nfts[0]?.account.balanceUSDC).toBe(2.5);
    expect(panel.nfts[0]?.account.endsAtMs).toBe(1_750_000_000_000);

    // Market stream pointer
    expect(panel.markets[0]?.stream?.status).toBe("live");
    expect(panel.markets[0]?.stream?.id).toBe("test-blob-id");
  });
});
