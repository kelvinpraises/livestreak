import { describe, expect, it } from "vitest";
import { isLocalRpc, usdcToAtomic, USDC_DECIMALS } from "../src/adapters/faucet.js";
import { renderProduceResult } from "../src/render/output.js";

describe("faucet helpers", () => {
  it("converts whole USDC to 6-decimal atomic units", () => {
    expect(USDC_DECIMALS).toBe(6);
    expect(usdcToAtomic(1n)).toBe(1_000_000n);
    expect(usdcToAtomic(1000n)).toBe(1_000_000_000n);
  });

  it("recognizes local dev RPCs only", () => {
    expect(isLocalRpc("http://127.0.0.1:8545")).toBe(true);
    expect(isLocalRpc("http://localhost:8545")).toBe(true);
    expect(isLocalRpc("http://[::1]:8545")).toBe(true);
    expect(isLocalRpc("https://mainnet.infura.io/v3/key")).toBe(false);
    expect(isLocalRpc("https://rpc.ankr.com/eth")).toBe(false);
  });
});

describe("produce idempotent message (S10)", () => {
  const base = {
    title: "T",
    marketId: `0x${"ab".repeat(32)}` as `0x${string}`,
    streamId: `0x${"cd".repeat(32)}` as `0x${string}`,
    vodUrl: "",
    goLiveTx: "",
    setEndedTx: "",
    mp4Path: "",
    streamState: { status: 1, scheme: 2, id: "x", updatedAt: 0n, endedAt: 0n }
  };

  it("explains the operator↔market↔vault relationship on a no-op", () => {
    const out = renderProduceResult({ ...base, idempotent: true });
    expect(out).toMatch(/market already exists for this operator/i);
    expect(out).toMatch(/create\s+a vault on this market/i);
  });

  it("omits the note on a fresh produce", () => {
    const out = renderProduceResult({ ...base });
    expect(out).toMatch(/produce — complete/i);
    expect(out).not.toMatch(/already exists/i);
  });
});
