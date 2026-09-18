import { describe, expect, it } from "vitest";

import { validateStewardChainConfig } from "../src/chains/index.js";
import { severityToContractValue } from "../src/chains/types.js";

describe("steward chain config", () => {
  it("names the honest gap for solana (wallet live, contracts pending)", () => {
    expect(() =>
      validateStewardChainConfig({
        walletInit: { chain: "solana", seedSource: "raw", config: { rpcUrl: "http://x" } } as never,
        seed: "test-seed",
        addresses: { stewardRegistry: "0x0000000000000000000000000000000000000001" }
      })
    ).toThrow(/contracts are not deployed yet/);
  });

  it("maps finding severity onto the on-chain enum (Warm/Hot/Critical)", () => {
    expect(severityToContractValue("info")).toBe(0);
    expect(severityToContractValue("warning")).toBe(1);
    expect(severityToContractValue("critical")).toBe(2);
  });
});
