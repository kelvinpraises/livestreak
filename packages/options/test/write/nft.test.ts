import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId, asTokenId, asUserAddress } from "../../src/model/ids.js";
import {
  validateTokenIdForContracts,
  validateUint64Salt,
  validateUserAddress
} from "../../src/chains/evm/encode.js";
import { createFakeChainWriter } from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const FROM = asUserAddress("0x0000000000000000000000000000000000000001");
const TO = asUserAddress("0x0000000000000000000000000000000000000002");
const OPERATOR = asUserAddress("0x0000000000000000000000000000000000000003");
const MARKET_ID = asMarketId(`0x${"ab".repeat(32)}`);
const SALT = 1234567890123456789n; // uint64 deterministic salt

describe("chain writer nft", () => {
  it("mint returns both the txId and the newly-minted tokenId", async () => {
    const writer = createFakeChainWriter();

    const result = await writer.mint({ marketId: MARKET_ID, to: TO });

    expect(result.txId).toBeTruthy();
    expect(result.tokenId).toBe(asTokenId(1n));
    expect(writer.requests[0]).toEqual({ action: "mint", args: { marketId: MARKET_ID, to: TO } });
  });

  it("mintWithSalt returns txId + tokenId and records the salt", async () => {
    const writer = createFakeChainWriter();

    const result = await writer.mintWithSalt({ marketId: MARKET_ID, salt: SALT, to: TO });

    expect(result.txId).toBeTruthy();
    expect(result.tokenId).toBe(asTokenId(1n));
    expect(writer.requests[0]).toEqual({
      action: "mintWithSalt",
      args: { marketId: MARKET_ID, salt: SALT, to: TO }
    });
  });

  it("transferNft records from, to, and tokenId", async () => {
    const writer = createFakeChainWriter();

    await writer.transferNft({ from: FROM, to: TO, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      action: "transferNft",
      args: { from: FROM, to: TO, tokenId: TOKEN_ID }
    });
  });

  it("approveNft records operator and tokenId", async () => {
    const writer = createFakeChainWriter();

    await writer.approveNft({ operator: OPERATOR, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      action: "approveNft",
      args: { operator: OPERATOR, tokenId: TOKEN_ID }
    });
  });

  it("setApprovalForAll records operator and approved flag", async () => {
    const writer = createFakeChainWriter();

    await writer.setApprovalForAll({ operator: OPERATOR, approved: true });

    expect(writer.requests[0]).toEqual({
      action: "setApprovalForAll",
      args: { operator: OPERATOR, approved: true }
    });
  });

  it("accepts a uint64 salt and rejects out-of-range / non-bigint salts", () => {
    expect(validateUint64Salt(0n)).toBe(0n);
    expect(validateUint64Salt((1n << 64n) - 1n)).toBe((1n << 64n) - 1n);
    expect(() => validateUint64Salt(-1n)).toThrow(LiveStreakConfigError);
    expect(() => validateUint64Salt(1n << 64n)).toThrow(LiveStreakConfigError);
    // a bytes32-hex string (the old broken shape) is no longer a valid salt.
    expect(() => validateUint64Salt(`0x${"cd".repeat(32)}` as unknown as bigint)).toThrow(
      LiveStreakConfigError
    );
  });

  it("rejects invalid tokenId at encode validation", () => {
    expect(() => validateTokenIdForContracts(asTokenId(-1n))).toThrow(LiveStreakConfigError);
  });

  it("rejects invalid operator at encode validation", () => {
    expect(() => validateUserAddress("bad", "operator")).toThrow(LiveStreakConfigError);
  });
});
