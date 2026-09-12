import { describe, expect, it } from "vitest";

import { createEvmOptionsReaderFromCall } from "../../src/chains/evm/reader.js";
import type { EvmContractCall } from "../../src/chains/evm/reader.js";
import { tupleToObject } from "../../src/chains/evm/decode.js";
import { readMarketSnapshot } from "../../src/flows/snapshot.js";
import { projectOptionsPanel } from "../../src/bridge/panel/project.js";
import { asMarketId } from "../../src/model/ids.js";
import type { OptionsUserOptionsSnapshot } from "../../src/model/snapshot.js";

const B32 = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const ADDRESSES = {
  marketRegistry: `0x${"1".repeat(40)}`,
  vault: `0x${"2".repeat(40)}`,
  marketDriver: `0x${"3".repeat(40)}`,
  stewardRegistry: `0x${"4".repeat(40)}`,
  treasury: `0x${"5".repeat(40)}`,
  lvstToken: `0x${"6".repeat(40)}`,
  dripsStreaming: `0x${"7".repeat(40)}`
} as const;

const MARKET = B32(0xa11ce);
const VAULT_OK = B32(0x1);
const VAULT_BAD = B32(0x2);

// Mirror viem's readContract decode: a function with MULTIPLE outputs comes back as a POSITIONAL
// ARRAY (names dropped); a single `tuple` comes back as a named object. The reader must survive both.
const makeCall = (vaultIds: readonly `0x${string}`[]): EvmContractCall =>
  async (_address, _abi, fn, args) => {
    switch (fn) {
      case "marketExists":
        return true;
      case "getMarket":
        // single tuple → named object (viem behavior)
        return {
          id: MARKET,
          title: "Tuple decode market",
          streamId: B32(0),
          creator: `0x${"a".repeat(40)}`,
          createdAt: 1_700_000_000n,
          exists: true
        };
      case "getVaultIds":
        return vaultIds;
      case "getVault": {
        const id = (args?.[0] as `0x${string}`) ?? VAULT_OK;
        if (id === VAULT_BAD) {
          // simulate a vault present in the index but not readable → reader must skip, not crash
          return {
            id,
            marketId: MARKET,
            question: "",
            creator: `0x${"0".repeat(40)}`,
            status: 0,
            outcome: 0,
            resolvedAt: 0,
            exists: false
          };
        }
        return {
          id,
          marketId: MARKET,
          question: "Will it resolve?",
          creator: `0x${"b".repeat(40)}`,
          status: 0,
          outcome: 0,
          resolvedAt: 0,
          exists: true
        };
      }
      // multi-output getters → POSITIONAL ARRAYS
      case "getVaultPools":
        return [5_000_000n, 1_000_000n, 49_000_000n, 9_000_000n];
      case "vaultHotState":
        return [false, 0n, 0, B32(0)];
      case "disputeState":
        return [false, 0n, B32(0)];
      case "streamState":
        return [0, 0, "", 0n, 0n];
      default:
        throw new Error(`unexpected call: ${fn}`);
    }
  };

describe("evm positional-array tuple decode", () => {
  it("tupleToObject zips arrays by key and passes objects through", () => {
    expect(tupleToObject([1n, 2n], ["a", "b"])).toEqual({ a: 1n, b: 2n });
    expect(tupleToObject({ a: 1n, b: 2n }, ["a", "b"])).toEqual({ a: 1n, b: 2n });
  });

  it("readMarketSnapshot populates vaults from positional-array reads (the live-board fix)", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, makeCall([VAULT_OK]));
    const snapshot = await readMarketSnapshot(reader, asMarketId(MARKET));

    expect(snapshot.vaults).toHaveLength(1);
    // pools/shares came back as a positional array; named decode must still work (was undefined → crash)
    expect(snapshot.vaults[0]?.pools.yes).toBe(5_000_000n);
    expect(snapshot.vaults[0]?.pools.no).toBe(1_000_000n);

    // and the panel projection the board consumes must carry the vault through
    const userSnapshot: OptionsUserOptionsSnapshot = {
      account: `0x${"a".repeat(40)}` as never,
      marketId: asMarketId(MARKET),
      markets: [snapshot],
      vaults: [],
      nfts: [],
      lvstAccount: { account: `0x${"a".repeat(40)}` as never, balance: 0n, staked: 0n, pendingDividends: 0n },
      usdcBalance: 997_000_000n
    };
    const panel = projectOptionsPanel(userSnapshot);
    expect(panel.markets[0]?.vaults).toHaveLength(1);
    expect(panel.markets[0]?.vaults[0]?.pools.yesUSDC).toBe(5);
    expect(panel.user.usdcBalanceUSDC).toBe(997);
  });

  it("drops an unreadable vault instead of zeroing the whole market (resilience permutation)", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, makeCall([VAULT_OK, VAULT_BAD]));
    const snapshot = await readMarketSnapshot(reader, asMarketId(MARKET));

    // 2 indexed, 1 readable → board still surfaces the good one
    expect(snapshot.market.vaultIds).toHaveLength(2);
    expect(snapshot.vaults).toHaveLength(1);
    expect(snapshot.vaults[0]?.pools.yes).toBe(5_000_000n);
  });
});
