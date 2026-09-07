import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import type { WalletInit } from "@livestreak/schema";
import { writeMarketLifecycle } from "#index.js";
import type { EvmAddress, StreamId } from "#index.js";

const evmWalletInit = {
  chain: "evm",
  seedSource: "signature-derived",
  config: {}
} as unknown as WalletInit;

const marketId = `0x${"a".repeat(64)}` as StreamId;
const marketRegistryAddress = `0x${"b".repeat(40)}` as EvmAddress;

describe("writeMarketLifecycle (SEAM-LIFECYCLE)", () => {
  it("rejects an empty storage pointer before touching the wallet", async () => {
    const exit = await Effect.runPromiseExit(
      writeMarketLifecycle({
        seed: "seed",
        walletInit: evmWalletInit,
        marketRegistryAddress,
        marketId,
        pointer: "",
        scheme: 2
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects an over-long storage pointer (>64 bytes)", async () => {
    const exit = await Effect.runPromiseExit(
      writeMarketLifecycle({
        seed: "seed",
        walletInit: evmWalletInit,
        marketRegistryAddress,
        marketId,
        pointer: "x".repeat(65),
        scheme: 0
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("fails clearly for an unsupported wallet chain", async () => {
    const exit = await Effect.runPromiseExit(
      writeMarketLifecycle({
        seed: "seed",
        walletInit: { chain: "doge" } as unknown as WalletInit,
        marketRegistryAddress,
        marketId,
        pointer: "cid-1",
        scheme: 2
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
