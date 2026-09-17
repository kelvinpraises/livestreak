// Minimal in-memory options chain for the cli operator-flow guard. cli tests import package PUBLIC
// exports only (the package's own test/helpers/fake-chain.ts is not published), so this is a compact
// stand-in: one market + one vault + an LVST account + a USDC balance for the operator, NO NFTs (so
// mint stays enabled/visible). Reads that the mint scenario never exercises return sensible zero/empty
// defaults; the writer records every request and returns fake tx hashes.
import {
  asMarketId,
  asTokenId,
  asTxId,
  asUserAddress,
  asVaultId,
  type LvstAccount,
  type MarketId,
  type OptionsBoardState,
  type OptionsChain,
  type OptionsMarket,
  type OptionsReader,
  type OptionsStreamState,
  type OptionsVault,
  type OptionsVaultShareTotals,
  type OptionsVaultSide,
  type OptionsWriter,
  type TokenId,
  type TxId,
  type UserAddress,
  type VaultId
} from "@livestreak/options";

export const FAKE_MARKET_ID = asMarketId("0x00000000000000000000000000000000000000000000000000000000000000a1");
export const FAKE_VAULT_ID = asVaultId("0x00000000000000000000000000000000000000000000000000000000000000b1");

const market = (): OptionsMarket => ({
  marketId: FAKE_MARKET_ID,
  title: "operator-flow market",
  creator: asUserAddress("0xcreator"),
  streamId: "stream_01",
  category: "macro",
  status: "open",
  vaultIds: [FAKE_VAULT_ID],
  timing: { createdAtMs: 1_730_000_000_000, closesAtMs: 1_730_001_800_000 }
});

const vault = (): OptionsVault => ({
  vaultId: FAKE_VAULT_ID,
  marketId: FAKE_MARKET_ID,
  question: "Does the operator flow hold?",
  type: "timing",
  creator: "0xcreator",
  status: "open",
  outcome: "pending",
  pools: { yes: 94_000_000n, no: 185_000_000n },
  timing: { createdAtMs: 1_730_000_000_000, expiresAtMs: 1_730_001_800_000 },
  steward: { hot: false }
});

const lvstAccount = (user: UserAddress): LvstAccount => ({
  account: user,
  balance: 0n,
  staked: 0n,
  pendingDividends: 0n
});

const shareTotals = (): OptionsVaultShareTotals => ({ yes: 0n, no: 0n });

const streamState = (): OptionsStreamState => ({ status: "idle", scheme: "none", id: "stream_01", updatedAtMs: 0, endedAtMs: 0 });

export type RecordedOptionsWrite = { readonly action: string; readonly args: unknown };

export interface FakeOptionsChain {
  readonly chain: OptionsChain;
  readonly writes: readonly RecordedOptionsWrite[];
}

export const createFakeOptionsChain = (): FakeOptionsChain => {
  const writes: RecordedOptionsWrite[] = [];
  const record = (action: string, args: unknown): Promise<TxId> => {
    writes.push({ action, args });
    return Promise.resolve(asTxId("0xfake_user_op_hash"));
  };
  const recordMint = (action: string, args: unknown) => {
    writes.push({ action, args });
    return Promise.resolve({ txId: asTxId("0xfake_user_op_hash"), tokenId: asTokenId(1n) });
  };

  const reader: OptionsReader = {
    readMarket: async (id: MarketId) => {
      if (id !== FAKE_MARKET_ID) throw new Error(`market not found: ${id}`);
      return market();
    },
    readStreamState: async () => streamState(),
    listMarketVaults: async () => [FAKE_VAULT_ID],
    readVault: async (id: VaultId) => {
      if (id !== FAKE_VAULT_ID) throw new Error(`vault not found: ${id}`);
      return vault();
    },
    readVaultShareTotals: async () => shareTotals(),
    listOwnerTokens: async () => [],
    readNft: async (tokenId: TokenId) => {
      throw new Error(`nft not found: ${String(tokenId)}`);
    },
    readLvstAccount: async (u: UserAddress) => lvstAccount(u),
    readClaimable: async () => 0n,
    readLossClaimable: async () => 0n,
    readPot: async () => 0n,
    readCollected: async () => false,
    readAccountVaultIds: async () => [],
    readWinningSide: async () => undefined,
    readBoard: async (_vaultId: VaultId, side: OptionsVaultSide): Promise<OptionsBoardState> => ({
      pool: side === "yes" ? 94_000_000n : 185_000_000n,
      sideRate: 0n,
      g: 0n,
      lastAdvanceMs: 1_730_000_000_000
    }),
    readSharePrice: async () => 0n,
    readPendingBoundaries: async () => 0n,
    readPendingShares: async () => 0n,
    readUsdcAddress: async () => "0x00000000000000000000000000000000000000aa",
    readUsdcBalance: async () => 1_000_000_000n,
    readNftBalance: async () => 0n,
    readOwnerOf: async (tokenId: TokenId): Promise<UserAddress> => {
      throw new Error(`nft not found: ${String(tokenId)}`);
    },
    readApproved: async () => undefined,
    readIsApprovedForAll: async () => false,
    readBoundaries: async () => []
  };

  const writer: OptionsWriter = {
    mint: (input) => recordMint("mint", input),
    mintWithSalt: (input) => recordMint("mintWithSalt", input),
    fund: (input) => record("fund", input),
    advance: (input) => record("advance", input),
    setLanes: (input) => record("setLanes", input),
    addFunds: (input) => record("addFunds", input),
    stopFunding: (input) => record("stopFunding", input),
    stopAllFunding: (input) => record("stopAllFunding", input),
    withdraw: (input) => record("withdraw", input),
    withdrawMany: (input) => record("withdrawMany", input),
    claimLossLvst: (input) => record("claimLossLvst", input),
    stakeLvst: (input) => record("stakeLvst", input),
    unstakeLvst: (input) => record("unstakeLvst", input),
    claimDividends: () => record("claimDividends", {}),
    transferNft: (input) => record("transferNft", input),
    approveNft: (input) => record("approveNft", input),
    setApprovalForAll: (input) => record("setApprovalForAll", input)
  };

  return { chain: { reader, writer }, writes };
};
