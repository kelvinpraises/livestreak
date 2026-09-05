import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { asMarketId } from "@livestreak/options";
import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeFunctionData } from "viem";
import {
  encodeMintCall,
  encodeMintWithSaltCall,
  parseMarketNftMintedTokenId,
  parseMintSalt
} from "../src/adapters/onchain.js";

const marketDriver = "0x84a89612fcd2f84edc6d2f19062c4a01988229d7" as const;
const marketId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const to = "0x0000000000000000000000000000000000000001" as const;

describe("edges/nft-mint", () => {
  it("encodes mint with marketDriverAbi", () => {
    const data = encodeMintCall(asMarketId(marketId), to);
    const expected = encodeFunctionData({
      abi: marketDriverAbi,
      functionName: "mint",
      args: [marketId, to]
    });
    expect(data).toBe(expected);
  });

  it("encodes mintWithSalt with marketDriverAbi", () => {
    const salt = 42n;
    const data = encodeMintWithSaltCall(asMarketId(marketId), salt, to);
    const expected = encodeFunctionData({
      abi: marketDriverAbi,
      functionName: "mintWithSalt",
      args: [marketId, salt, to]
    });
    expect(data).toBe(expected);
  });

  it("parses MarketNftMinted from receipt logs", () => {
    const topics = encodeEventTopics({
      abi: marketDriverAbi,
      eventName: "MarketNftMinted",
      args: {
        tokenId: 7n,
        marketId,
        to
      }
    });

    const log = {
      address: marketDriver,
      topics,
      data: "0x" as `0x${string}`,
      blockNumber: 1n,
      transactionHash: `0x${"11".repeat(32)}`,
      logIndex: 0,
      transactionIndex: 0,
      blockHash: `0x${"22".repeat(32)}`,
      removed: false
    };

    expect(parseMarketNftMintedTokenId([log], marketDriver)).toBe(7n);
  });

  it("rejects invalid salt values", () => {
    expect(() => parseMintSalt("-1")).toThrow(/>= 0/);
    expect(() => parseMintSalt("not-a-number")).toThrow(/non-negative integer/);
    expect(() => parseMintSalt("18446744073709551616")).toThrow(/uint64/);
  });

  it("accepts uint64 salt bounds", () => {
    expect(parseMintSalt("0")).toBe(0n);
    expect(parseMintSalt("18446744073709551615")).toBe(18446744073709551615n);
  });
});
