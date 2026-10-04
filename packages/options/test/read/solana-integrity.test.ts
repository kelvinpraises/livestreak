import { expect, it } from "vitest";
import { address } from "@livestreak/wallet";
import { asMarketId } from "../../src/model/ids.js";
import { createSolanaOptionsReader } from "../../src/chains/solana/reader.js";
import type { SolanaOptionsContext } from "../../src/chains/solana/config.js";

const context = (send: () => Promise<unknown>) =>
  ({
    programId: address("11111111111111111111111111111111"),
    rpc: { getAccountInfo: () => ({ send }) },
  }) as unknown as SolanaOptionsContext;
const market = asMarketId(`0x${"01".repeat(32)}`);

it("distinguishes an unallocated Solana shard from a failed RPC or corrupt account", async () => {
  const absent = createSolanaOptionsReader(context(async () => ({ value: null })));
  expect(await absent.listMarketVaults(market)).toEqual([]);
  const offline = createSolanaOptionsReader(
    context(async () => {
      throw new Error("RPC offline");
    }),
  );
  await expect(offline.listMarketVaults(market)).rejects.toThrow("RPC offline");
  const corrupt = createSolanaOptionsReader(
    context(async () => ({ value: { data: ["AAAA", "base64"] } })),
  );
  await expect(corrupt.listMarketVaults(market)).rejects.toThrow();
});
