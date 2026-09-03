import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId } from "../src/model/ids.js";
import {
  DEFAULT_MEDIA_RESOLVERS,
  resolveStreamMedia,
  walrusAggregatorResolver,
  WALRUS_MAINNET_AGGREGATOR,
  WALRUS_TESTNET_AGGREGATOR,
  type OptionsStreamState
} from "../src/model/media.js";
import { getStreamMedia } from "../src/read/media.js";
import { createFakeOptionsReadTransport } from "./helpers/fake-transport.js";

const marketId = asMarketId("market_01");
const blobId = "blob_test_id";

const streamState = (
  status: OptionsStreamState["status"],
  scheme: OptionsStreamState["scheme"],
  id = blobId
): OptionsStreamState => ({
  status,
  scheme,
  id,
  updatedAtMs: 1_700_000_000_000,
  endedAtMs: status === "ended" ? 1_700_001_000_000 : 0
});

describe("walrusAggregatorResolver", () => {
  it("builds verbatim blob URLs from an injectable aggregator base", () => {
    const resolve = walrusAggregatorResolver("https://custom.aggregator.example");

    expect(resolve("blob_abc")).toBe("https://custom.aggregator.example/v1/blobs/blob_abc");
  });
});

describe("DEFAULT_MEDIA_RESOLVERS", () => {
  it("resolves walrus testnet and mainnet with default aggregator bases", () => {
    expect(DEFAULT_MEDIA_RESOLVERS["walrus-testnet"](blobId)).toBe(
      `${WALRUS_TESTNET_AGGREGATOR}/v1/blobs/${blobId}`
    );
    expect(DEFAULT_MEDIA_RESOLVERS["walrus-mainnet"]("main-blob")).toBe(
      `${WALRUS_MAINNET_AGGREGATOR}/v1/blobs/main-blob`
    );
  });

  it("uses stub resolvers for ipfs and arweave", () => {
    expect(() => DEFAULT_MEDIA_RESOLVERS.ipfs("QmExample")).toThrow(LiveStreakConfigError);
    expect(() => DEFAULT_MEDIA_RESOLVERS.arweave("tx-id")).toThrow(LiveStreakConfigError);

    try {
      DEFAULT_MEDIA_RESOLVERS.ipfs("QmExample");
    } catch (error) {
      expect(error).toBeInstanceOf(LiveStreakConfigError);
      expect((error as LiveStreakConfigError).message).toContain("ipfs resolver not configured");
    }
  });
});

describe("resolveStreamMedia", () => {
  it("returns ended vodUrl from the walrus default resolver", () => {
    const media = resolveStreamMedia(streamState("ended", "walrus-testnet"));

    expect(media).toEqual({
      status: "ended",
      vodUrl: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_test_id"
    });
  });

  it("returns live without vodUrl", () => {
    expect(resolveStreamMedia(streamState("live", "walrus-testnet"))).toEqual({
      status: "live"
    });
  });

  it("returns none without vodUrl", () => {
    expect(resolveStreamMedia(streamState("none", "walrus-testnet"))).toEqual({
      status: "none"
    });
  });

  it("throws when ended stream uses an unconfigured stub scheme", () => {
    expect(() => resolveStreamMedia(streamState("ended", "ipfs"))).toThrow(LiveStreakConfigError);
    expect(() => resolveStreamMedia(streamState("ended", "arweave"))).toThrow(LiveStreakConfigError);
  });

  it("allows per-scheme resolver overrides", () => {
    const media = resolveStreamMedia(streamState("ended", "ipfs", "QmExample"), {
      ipfs: (id) => `https://custom.gateway/ipfs/${id}`
    });

    expect(media.vodUrl).toBe("https://custom.gateway/ipfs/QmExample");

    const walrus = resolveStreamMedia(streamState("ended", "walrus-testnet"), {
      "walrus-testnet": walrusAggregatorResolver("https://my.walrus.aggregator")
    });

    expect(walrus.vodUrl).toBe("https://my.walrus.aggregator/v1/blobs/blob_test_id");
  });

  it("throws when a partial override removes the scheme resolver", () => {
    expect(() =>
      resolveStreamMedia(streamState("ended", "walrus-testnet"), {
        "walrus-testnet": undefined
      })
    ).toThrow(LiveStreakConfigError);
  });
});

describe("getStreamMedia", () => {
  it("reads stream state from transport then resolves media", async () => {
    const transport = createFakeOptionsReadTransport({
      streamStates: {
        market_01: streamState("ended", "walrus-testnet")
      }
    });

    const media = await getStreamMedia(transport, marketId);

    expect(media.status).toBe("ended");
    expect(media.vodUrl).toBe(
      "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_test_id"
    );
  });

  it("threads optional resolvers through to resolveStreamMedia", async () => {
    const transport = createFakeOptionsReadTransport({
      streamStates: {
        market_01: streamState("ended", "walrus-mainnet")
      }
    });

    const media = await getStreamMedia(transport, marketId, {
      "walrus-mainnet": walrusAggregatorResolver("https://edge.walrus.example")
    });

    expect(media.vodUrl).toBe("https://edge.walrus.example/v1/blobs/blob_test_id");
  });
});
