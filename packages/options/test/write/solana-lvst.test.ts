import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asTokenId } from "../../src/model/ids.js";
import { createOptionsChain } from "../../src/chains/index.js";
import { validateOptionsSolanaAddresses } from "../../src/chains/solana/addresses.js";
import { optionsSolanaAddressesFromInit } from "../../src/bridge/runtime/init.js";

// Valid base58 pubkeys used across the fixtures (system program, wSOL mint, SPL token program).
const PROGRAM_ID = "11111111111111111111111111111111";
const USDC_MINT = "So11111111111111111111111111111111111111112";
const LVST_MINT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const solanaChain = (addresses: Record<string, string>) =>
  createOptionsChain({
    walletInit: {
      chain: "solana",
      seedSource: "raw",
      config: { rpcUrl: "http://127.0.0.1:8899" }
    },
    seed: "test-seed",
    addresses
  } as never);

// The four LVST writer methods split cleanly: claimLossLvst IS implemented (vault-scoped, resolvable
// the same way withdraw is) but needs the optional lvstMint; stake/unstake/claimDividends are a
// genuine cross-chain seam mismatch (EVM stakes into a single protocol-global Treasury while Solana
// binds a PER-MARKET escrow, and the canonical input carries no market to scope to) — typed failure.
describe("Solana options LVST writer", () => {
  it("claimLossLvst fails typed when lvstMint is absent from the addresses config", async () => {
    const chain = solanaChain({ programId: PROGRAM_ID, usdcMint: USDC_MINT });
    await expect(
      chain.writer.claimLossLvst({
        tokenId: asTokenId(1n),
        vaultId:
          "0x00000000000000000000000000000000000000000000000000000000000000aa" as never,
        side: "yes",
        to: USDC_MINT as never
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("stakeLvst rejects: per-market escrow with no market context in the canonical input", async () => {
    const chain = solanaChain({ programId: PROGRAM_ID, usdcMint: USDC_MINT, lvstMint: LVST_MINT });
    await expect(chain.writer.stakeLvst({ amount: 1n })).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("unstakeLvst rejects: per-market escrow with no market context in the canonical input", async () => {
    const chain = solanaChain({ programId: PROGRAM_ID, usdcMint: USDC_MINT, lvstMint: LVST_MINT });
    await expect(chain.writer.unstakeLvst({ amount: 1n })).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("claimDividends rejects: per-market dividend escrow with no market context", async () => {
    const chain = solanaChain({ programId: PROGRAM_ID, usdcMint: USDC_MINT, lvstMint: LVST_MINT });
    await expect(chain.writer.claimDividends()).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});

// lvstMint is OPTIONAL end-to-end: config-shape validation and the bridge-init flattener both keep
// existing { programId, usdcMint } bags valid while carrying the mint through when a deployment has it.
describe("validateOptionsSolanaAddresses lvstMint", () => {
  it("accepts a config without lvstMint and leaves it undefined", () => {
    const out = validateOptionsSolanaAddresses({ programId: PROGRAM_ID, usdcMint: USDC_MINT });
    expect(out.lvstMint).toBeUndefined();
  });

  it("validates and returns lvstMint when present", () => {
    const out = validateOptionsSolanaAddresses({
      programId: PROGRAM_ID,
      usdcMint: USDC_MINT,
      lvstMint: LVST_MINT
    });
    expect(out.lvstMint).toBe(LVST_MINT);
  });

  it("rejects an lvstMint that is not a valid base58 pubkey", () => {
    expect(() =>
      validateOptionsSolanaAddresses({
        programId: PROGRAM_ID,
        usdcMint: USDC_MINT,
        lvstMint: "not-base58!"
      })
    ).toThrow(LiveStreakConfigError);
  });
});

describe("optionsSolanaAddressesFromInit lvstMint", () => {
  it("passes lvstMint through when the contracts bag carries it", () => {
    const out = optionsSolanaAddressesFromInit({
      programId: PROGRAM_ID,
      usdcMint: USDC_MINT,
      lvstMint: LVST_MINT
    });
    expect(out.lvstMint).toBe(LVST_MINT);
  });

  it("omits lvstMint when the contracts bag has none", () => {
    const out = optionsSolanaAddressesFromInit({ programId: PROGRAM_ID, usdcMint: USDC_MINT });
    expect(out.lvstMint).toBeUndefined();
  });
});
