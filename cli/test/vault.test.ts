import { describe, expect, it } from "vitest";
import { encodeCreateVaultCall, sideToSeedEnum } from "../src/edges/vault.js";
import { encodeFunctionData } from "viem";
import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";

const marketId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

describe("edges/vault", () => {
  it("maps side to the VaultDriver Side enum", () => {
    expect(sideToSeedEnum("yes")).toBe(0);
    expect(sideToSeedEnum("no")).toBe(1);
  });

  it("encodes createVault with vaultDriverAbi and correct args", () => {
    const args = encodeCreateVaultCall(marketId, "Will it rain?", "yes", 10n, 1_000_000n);
    const data = encodeFunctionData({
      abi: vaultDriverAbi,
      functionName: "createVault",
      args: [args.marketId, args.question, args.seedSide, args.rate, args.deposit]
    });

    expect(data.startsWith("0x")).toBe(true);
    expect(args.seedSide).toBe(0);
  });
});
