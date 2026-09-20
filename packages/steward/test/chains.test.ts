import { describe, expect, it } from "vitest";

import { validateStewardChainConfig } from "../src/chains/index.js";
import { severityToContractValue } from "../src/chains/types.js";

describe("steward chain config", () => {
  it("validates a solana steward config (program deployed — resolve is live)", () => {
    // No marketId in the bag: the executor resolves the vault's market at call time
    // from the on-chain ledger, so the config stays market-agnostic like EVM/Sui.
    const validated = validateStewardChainConfig({
      walletInit: { chain: "solana", seedSource: "raw", config: { rpcUrl: "http://x" } } as never,
      seed: "test-seed",
      addresses: {
        programId: "So11111111111111111111111111111111111111112",
        usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      }
    });
    expect(validated.addresses).toEqual({
      programId: "So11111111111111111111111111111111111111112",
      usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    });
  });

  it("rejects a solana steward config with a non-base58 programId", () => {
    expect(() =>
      validateStewardChainConfig({
        walletInit: { chain: "solana", seedSource: "raw", config: { rpcUrl: "http://x" } } as never,
        seed: "test-seed",
        addresses: { programId: "0xnot-base58", usdcMint: "0xnope" }
      })
    ).toThrow(/valid base58 programId/);
  });

  it("maps finding severity onto the on-chain enum (Warm/Hot/Critical)", () => {
    expect(severityToContractValue("info")).toBe(0);
    expect(severityToContractValue("warning")).toBe(1);
    expect(severityToContractValue("critical")).toBe(2);
  });
});
