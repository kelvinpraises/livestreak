import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { parseUint64Salt } from "../src/commands/nft.js";

const marketId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const to = "0x0000000000000000000000000000000000000001" as const;

describe("nft mint salt (uint64, via options bridge)", () => {
  it("encodes mintWithSalt with a uint64 salt against the live MarketDriver ABI", () => {
    const salt = 1234567890123456789n; // uint64
    // The contract ABI is mintWithSalt(bytes32, uint64, address) — encoding a bigint salt succeeds;
    // a bytes32-hex string (the old broken shape) would throw at encode time.
    const data = encodeFunctionData({
      abi: marketDriverAbi,
      functionName: "mintWithSalt",
      args: [marketId, salt, to]
    });
    expect(data.startsWith("0x")).toBe(true);
    expect(() =>
      encodeFunctionData({
        abi: marketDriverAbi,
        functionName: "mintWithSalt",
        // a 32-byte hex string is NOT a valid uint64 arg.
        args: [marketId, `0x${"cd".repeat(32)}` as unknown as bigint, to]
      })
    ).toThrow();
  });

  it("parseUint64Salt accepts decimal/hex in range and rejects out-of-range", () => {
    expect(parseUint64Salt("0")).toBe(0n);
    expect(parseUint64Salt("18446744073709551615")).toBe(18446744073709551615n);
    expect(parseUint64Salt("0xff")).toBe(255n);
    expect(() => parseUint64Salt("-1")).toThrow(/non-negative|uint64/);
    expect(() => parseUint64Salt("18446744073709551616")).toThrow(/uint64/);
    expect(() => parseUint64Salt("not-a-number")).toThrow(/non-negative integer/);
  });
});
