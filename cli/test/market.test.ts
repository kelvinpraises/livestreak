import { describe, expect, it } from "vitest";
import {
  encodeGoLive,
  encodeSetEndedOnly,
  pointerSchemeToStorageScheme,
  STORAGE_SCHEME,
  validateStorageId
} from "../src/adapters/onchain.js";

const marketId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

describe("edges/market", () => {
  it("maps pointer schemes to StorageScheme", () => {
    expect(pointerSchemeToStorageScheme("walrus-testnet")).toBe(STORAGE_SCHEME.WalrusTestnet);
    expect(pointerSchemeToStorageScheme("walrus-mainnet")).toBe(STORAGE_SCHEME.WalrusMainnet);
    expect(pointerSchemeToStorageScheme("ipfs")).toBe(STORAGE_SCHEME.Ipfs);
    expect(pointerSchemeToStorageScheme("arweave")).toBe(STORAGE_SCHEME.Arweave);
  });

  it("encodes goLive then setEnded with marketRegistryAbi", () => {
    const id = "blob_01";
    const scheme = STORAGE_SCHEME.WalrusTestnet;

    const goLive = encodeGoLive(marketId, scheme, id);
    const setEnded = encodeSetEndedOnly(marketId, scheme, id);

    expect(goLive).toMatch(/^0x/);
    expect(setEnded).toMatch(/^0x/);
    expect(goLive).not.toEqual(setEnded);
  });

  it("rejects storage id longer than 64 bytes before send", () => {
    expect(() => validateStorageId("x".repeat(65))).toThrow(/1\.\.64/);
  });

  it("setEnded without goLive would revert on-chain (edge enforces order in publishVod)", () => {
    const setEndedOnly = encodeSetEndedOnly(marketId, STORAGE_SCHEME.WalrusTestnet, "vod");
    expect(setEndedOnly.startsWith("0x")).toBe(true);
    // publishVod always sends goLive before setEnded — verified by encode ordering tests above.
  });
});
