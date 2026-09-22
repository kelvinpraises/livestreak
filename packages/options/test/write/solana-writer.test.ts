import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asTokenId } from "../../src/model/ids.js";
import { createOptionsChain } from "../../src/chains/index.js";

// Valid base58 pubkeys reused across the fixtures (system program, wSOL mint). PROGRAM_ID doubles as
// a definitely-not-the-signer address for the ownership guards — the signer is derived from the seed.
const PROGRAM_ID = "11111111111111111111111111111111";
const USDC_MINT = "So11111111111111111111111111111111111111112";
const VAULT_ID =
  "0x00000000000000000000000000000000000000000000000000000000000000aa" as never;

const solanaChain = (addresses: Record<string, string> = { programId: PROGRAM_ID, usdcMint: USDC_MINT }) =>
  createOptionsChain({
    walletInit: {
      chain: "solana",
      seedSource: "raw",
      config: { rpcUrl: "http://127.0.0.1:8899" }
    },
    // The BIP-39 reference mnemonic derives a real (non-signer-arbitrary) Solana signer, so the
    // ownership guards can compare input.from against it without a live RPC.
    seed: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    addresses
  } as never);

// transfer_position reassigns the PositionOwner PDA and is signed by the CURRENT owner; Solana has no
// transfer-on-behalf path, so the writer requires input.from to be the wallet signer (mirrors the mint
// recipient guard). These map/validation-level checks fail before any RPC round-trip.
describe("Solana options transferNft writer", () => {
  it("rejects when input.from is not the wallet signer", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.transferNft({
        from: PROGRAM_ID as never, // valid base58, but not the seed-derived signer
        to: USDC_MINT as never,
        tokenId: asTokenId(1n)
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("rejects a malformed base58 `from`", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.transferNft({
        from: "not-base58!" as never,
        to: USDC_MINT as never,
        tokenId: asTokenId(1n)
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});

// set_lanes maps the canonical lane set onto the on-chain LaneArg (vault id, side, positive rate) with
// an optional top-up. Side/rate/addDeposit are validated synchronously (before market resolution or any
// RPC), so bad inputs fail typed without a live shard.
describe("Solana options setLanes writer", () => {
  it("rejects an invalid side", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.setLanes({
        tokenId: asTokenId(1n),
        lanes: [{ vaultId: VAULT_ID, side: "maybe" as never, rate: 5n }],
        addDeposit: 0n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("rejects a non-positive rate", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.setLanes({
        tokenId: asTokenId(1n),
        lanes: [{ vaultId: VAULT_ID, side: "yes", rate: 0n }],
        addDeposit: 0n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("rejects a negative addDeposit (zero is legal for a pure reshape)", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.setLanes({
        tokenId: asTokenId(1n),
        lanes: [{ vaultId: VAULT_ID, side: "yes", rate: 5n }],
        addDeposit: -1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});

// stop_funding stops a single lane (one vault, one side); the side is validated before the market shard
// is resolved, so a bad side fails typed without touching the RPC.
describe("Solana options stopFunding writer", () => {
  it("rejects an invalid side", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.stopFunding({
        tokenId: asTokenId(1n),
        vaultId: VAULT_ID,
        side: "maybe" as never
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});

// addFunds is the balance-first top-up (read current lanes → set_lanes with the deposit). Previously
// unimplemented on Solana (the bridge rejected it as "not supported on this chain"); now present, so a
// fresh position can be topped up. The deposit is validated synchronously (before market resolution or
// any RPC), so a non-positive deposit fails typed without a live shard.
describe("Solana options addFunds writer", () => {
  it("is implemented (parity with EVM/Sui — no longer unsupported on this chain)", () => {
    const chain = solanaChain();
    expect(chain.writer.addFunds).toBeTypeOf("function");
  });

  it("rejects a non-positive deposit", async () => {
    const chain = solanaChain();
    await expect(
      chain.writer.addFunds!({ tokenId: asTokenId(1n), deposit: 0n })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});
