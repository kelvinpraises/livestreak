import { LiveStreakConfigError } from "@livestreak/core";

import {
  asMarketId,
  asTokenId,
  asUserAddress,
  asVaultId,
  type LvstAccount,
  type MarketId,
  type OptionsBoardState,
  type OptionsMarket,
  type OptionsNft,
  type OptionsProtocolSummary,
  type OptionsVault,
  type OptionsVaultShareTotals,
  type OptionsVaultSide,
  type OptionsStreamState,
  type TokenId,
  type UserAddress,
  type VaultId
} from "../../src/model/index.js";
import type { OptionsReadTransport } from "../../src/read/transport.js";

export interface FakeTransportSeed {
  readonly markets?: readonly OptionsMarket[];
  readonly vaults?: readonly OptionsVault[];
  readonly shareTotals?: Readonly<Record<string, OptionsVaultShareTotals>>;
  readonly nfts?: readonly OptionsNft[];
  readonly lvstAccounts?: readonly LvstAccount[];
  readonly protocol?: OptionsProtocolSummary;
  readonly claimable?: Readonly<Record<string, bigint>>;
  readonly lossClaimable?: Readonly<Record<string, bigint>>;
  readonly winningSide?: Readonly<Record<string, OptionsVaultSide>>;
  readonly pot?: Readonly<Record<string, bigint>>;
  readonly collected?: Readonly<Record<string, boolean>>;
  readonly boards?: Readonly<Record<string, OptionsBoardState>>;
  readonly sharePrices?: Readonly<Record<string, bigint>>;
  readonly pendingShares?: Readonly<Record<string, bigint>>;
  readonly accountVaultIds?: Readonly<Record<string, readonly VaultId[]>>;
  readonly nftBalances?: Readonly<Record<string, bigint>>;
  readonly usdcAddress?: `0x${string}`;
  readonly nftApproved?: Readonly<Record<string, UserAddress>>;
  readonly approvedForAll?: Readonly<Record<string, boolean>>;
  readonly streamStates?: Readonly<Record<string, OptionsStreamState>>;
}

export const createFakeOptionsReadTransport = (
  seed: FakeTransportSeed = {}
): FakeTransportInMemory => new FakeTransportInMemory(seed);

export class FakeTransportInMemory implements OptionsReadTransport {
  private readonly markets = new Map<string, OptionsMarket>();
  private readonly vaults = new Map<string, OptionsVault>();
  private readonly shareTotals = new Map<string, OptionsVaultShareTotals>();
  private readonly nfts = new Map<string, OptionsNft>();
  private readonly lvstAccounts = new Map<string, LvstAccount>();
  private readonly claimable = new Map<string, bigint>();
  private readonly lossClaimable = new Map<string, bigint>();
  private readonly winningSide = new Map<string, OptionsVaultSide>();
  private readonly pot = new Map<string, bigint>();
  private readonly collected = new Map<string, boolean>();
  private readonly boards = new Map<string, OptionsBoardState>();
  private readonly sharePrices = new Map<string, bigint>();
  private readonly pendingShares = new Map<string, bigint>();
  private readonly accountVaultIds = new Map<string, readonly VaultId[]>();
  private readonly nftBalances = new Map<string, bigint>();
  private usdcAddress: `0x${string}` = "0x00000000000000000000000000000000000000aa";
  private readonly nftApproved = new Map<string, UserAddress>();
  private readonly approvedForAll = new Map<string, boolean>();
  private readonly streamStates = new Map<string, OptionsStreamState>();
  readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(seed: FakeTransportSeed) {
    for (const market of seed.markets ?? []) {
      this.markets.set(market.marketId, market);
    }

    for (const vault of seed.vaults ?? []) {
      this.vaults.set(vault.vaultId, vault);
    }

    for (const [vaultId, totals] of Object.entries(seed.shareTotals ?? {})) {
      this.shareTotals.set(vaultId, totals);
    }

    for (const nft of seed.nfts ?? []) {
      this.nfts.set(nft.tokenId.toString(), nft);
    }

    for (const account of seed.lvstAccounts ?? []) {
      this.lvstAccounts.set(account.account, account);
    }

    if (seed.protocol !== undefined) {
      const summary = seed.protocol;
      this.readProtocolSummary = async () => summary;
    }

    for (const [key, value] of Object.entries(seed.claimable ?? {})) {
      this.claimable.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.lossClaimable ?? {})) {
      this.lossClaimable.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.winningSide ?? {})) {
      this.winningSide.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.pot ?? {})) {
      this.pot.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.collected ?? {})) {
      this.collected.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.boards ?? {})) {
      this.boards.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.sharePrices ?? {})) {
      this.sharePrices.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.pendingShares ?? {})) {
      this.pendingShares.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.accountVaultIds ?? {})) {
      this.accountVaultIds.set(key, value);
    }

    if (seed.usdcAddress !== undefined) {
      this.usdcAddress = seed.usdcAddress;
    }

    for (const [key, value] of Object.entries(seed.nftBalances ?? {})) {
      this.nftBalances.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.nftApproved ?? {})) {
      this.nftApproved.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.approvedForAll ?? {})) {
      this.approvedForAll.set(key, value);
    }

    for (const [key, value] of Object.entries(seed.streamStates ?? {})) {
      this.streamStates.set(key, value);
    }
  }

  async readMarket(marketId: MarketId): Promise<OptionsMarket> {
    const market = this.markets.get(marketId);
    if (market === undefined) {
      throw notFound("market", marketId);
    }

    return market;
  }

  async readStreamState(marketId: MarketId): Promise<OptionsStreamState> {
    const state = this.streamStates.get(marketId);
    if (state === undefined) {
      throw notFound("stream state", marketId);
    }

    return state;
  }

  async listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]> {
    const market = await this.readMarket(marketId);
    return market.vaultIds;
  }

  async readVault(vaultId: VaultId): Promise<OptionsVault> {
    const vault = this.vaults.get(vaultId);
    if (vault === undefined) {
      throw notFound("vault", vaultId);
    }

    return vault;
  }

  async readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals> {
    const totals = this.shareTotals.get(vaultId);
    if (totals === undefined) {
      throw notFound("vault share totals", vaultId);
    }

    return totals;
  }

  async listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]> {
    const tokenIds: TokenId[] = [];

    for (const nft of this.nfts.values()) {
      if (nft.owner === owner) {
        tokenIds.push(nft.tokenId);
      }
    }

    return tokenIds;
  }

  async readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft> {
    const nft = this.nfts.get(tokenId.toString());
    if (nft === undefined) {
      throw notFound("nft", String(tokenId));
    }

    if (nft.owner !== owner) {
      throw notFound("nft", `${owner}:${String(tokenId)}`);
    }

    return nft;
  }

  async readLvstAccount(user: UserAddress): Promise<LvstAccount> {
    const account = this.lvstAccounts.get(user);
    if (account === undefined) {
      throw notFound("LVST account", user);
    }

    return account;
  }

  async readClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    return this.claimable.get(claimKey(tokenId, vaultId, side)) ?? 0n;
  }

  async readLossClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    return this.lossClaimable.get(claimKey(tokenId, vaultId, side)) ?? 0n;
  }

  async readPot(vaultId: VaultId): Promise<bigint> {
    return this.pot.get(vaultId) ?? 0n;
  }

  async readCollected(vaultId: VaultId): Promise<boolean> {
    return this.collected.get(vaultId) ?? false;
  }

  async readAccountVaultIds(tokenId: TokenId): Promise<readonly VaultId[]> {
    return this.accountVaultIds.get(tokenId.toString()) ?? [];
  }

  async readWinningSide(vaultId: VaultId): Promise<OptionsVaultSide | undefined> {
    const vault = await this.readVault(vaultId);

    if (vault.status !== "resolved") {
      return undefined;
    }

    return this.winningSide.get(vaultId);
  }

  async readBoard(vaultId: VaultId, side: OptionsVaultSide): Promise<OptionsBoardState> {
    const board = this.boards.get(boardKey(vaultId, side));
    if (board === undefined) {
      throw notFound("board", boardKey(vaultId, side));
    }

    return board;
  }

  async readSharePrice(vaultId: VaultId, side: OptionsVaultSide): Promise<bigint> {
    return this.sharePrices.get(boardKey(vaultId, side)) ?? 0n;
  }

  async readPendingShares(
    vaultId: VaultId,
    side: OptionsVaultSide,
    tokenId: TokenId
  ): Promise<bigint> {
    return this.pendingShares.get(claimKey(tokenId, vaultId, side)) ?? 0n;
  }

  async readUsdcAddress(): Promise<`0x${string}`> {
    return this.usdcAddress;
  }

  async readNftBalance(tokenId: TokenId): Promise<bigint> {
    return this.nftBalances.get(tokenId.toString()) ?? 0n;
  }

  async readOwnerOf(tokenId: TokenId): Promise<UserAddress> {
    const nft = this.nfts.get(tokenId.toString());
    if (nft === undefined) {
      throw notFound("nft", String(tokenId));
    }

    return nft.owner;
  }

  async readApproved(tokenId: TokenId): Promise<UserAddress | undefined> {
    return this.nftApproved.get(tokenId.toString());
  }

  async readIsApprovedForAll(owner: UserAddress, operator: UserAddress): Promise<boolean> {
    return this.approvedForAll.get(`${owner}:${operator}`) ?? false;
  }

  setMarket(market: OptionsMarket): void {
    this.markets.set(market.marketId, market);
  }

  setVault(vault: OptionsVault): void {
    this.vaults.set(vault.vaultId, vault);
  }

  setShareTotals(vaultId: VaultId, totals: OptionsVaultShareTotals): void {
    this.shareTotals.set(vaultId, totals);
  }

  setNft(nft: OptionsNft): void {
    this.nfts.set(nft.tokenId.toString(), nft);
  }

  setLvstAccount(account: LvstAccount): void {
    this.lvstAccounts.set(account.account, account);
  }
}

export const fixtureMarket = (
  overrides: Partial<OptionsMarket> = {}
): OptionsMarket => ({
  marketId: asMarketId("market_01"),
  title: "Regulation hearing",
  creator: asUserAddress("0xcreator"),
  streamId: "stream_01",
  category: "macro",
  status: "open",
  vaultIds: [asVaultId("vault_01")],
  timing: {
    createdAtMs: 1_730_000_000_000,
    closesAtMs: 1_730_001_800_000
  },
  ...overrides
});

export const fixtureVault = (
  overrides: Partial<OptionsVault> = {}
): OptionsVault => ({
  vaultId: asVaultId("vault_01"),
  marketId: asMarketId("market_01"),
  question: "Speaker addresses regulation next",
  type: "timing",
  creator: "0xcreator",
  status: "open",
  outcome: "pending",
  pools: {
    yes: 94_000_000n,
    no: 185_000_000n
  },
  timing: {
    createdAtMs: 1_730_000_000_000,
    expiresAtMs: 1_730_001_800_000
  },
  steward: {
    hot: false
  },
  ...overrides
});

export const fixtureResolvedVault = (
  overrides: Partial<OptionsVault> = {}
): OptionsVault =>
  fixtureVault({
    status: "resolved",
    outcome: "yes",
    pools: {
      yes: 412_000_000n,
      no: 185_000_000n
    },
    timing: {
      createdAtMs: 1_730_000_000_000,
      expiresAtMs: 1_730_001_800_000,
      resolvedAtMs: 1_730_001_750_000
    },
    ...overrides
  });

export const fixtureShareTotals = (): OptionsVaultShareTotals => ({
  yes: 34_000_000n,
  no: 6_000_000n
});

export const fixtureUser = (): UserAddress => asUserAddress("0xuser");

export const fixtureNft = (
  user: UserAddress = fixtureUser(),
  overrides: Partial<OptionsNft> = {}
): OptionsNft => {
  const tokenId = overrides.tokenId ?? asTokenId(1n);

  return {
    tokenId,
    owner: user,
    marketId: asMarketId("market_01"),
    laneCount: 2,
    lanes: [
      {
        tokenId,
        vaultId: asVaultId("vault_01"),
        side: "yes",
        rate: 800_000n,
        gPaid: 0n,
        sharesAccrued: 34_000_000n,
        depleted: false
      },
      {
        tokenId,
        vaultId: asVaultId("vault_01"),
        side: "no",
        rate: 0n,
        gPaid: 0n,
        sharesAccrued: 6_000_000n,
        depleted: false
      }
    ],
    ...overrides
  };
};

export const fixtureOtherMarketNft = (user: UserAddress = fixtureUser()): OptionsNft =>
  fixtureNft(user, {
    tokenId: asTokenId(2n),
    marketId: asMarketId("market_02"),
    laneCount: 1,
    lanes: [
      {
        tokenId: asTokenId(2n),
        vaultId: asVaultId("vault_02"),
        side: "yes",
        rate: 100_000n,
        gPaid: 0n,
        sharesAccrued: 1_000_000n,
        depleted: false
      }
    ]
  });

export const fixtureLvstAccount = (user: UserAddress = fixtureUser()): LvstAccount => ({
  account: user,
  balance: 1_000_000_000_000_000_000n,
  staked: 250_000_000_000_000_000n,
  pendingDividends: 12_500_000n,
  totalEarned: 3_000_000_000_000_000_000n
});

export const fixtureSeed = (user: UserAddress = fixtureUser()): FakeTransportSeed => ({
  markets: [fixtureMarket()],
  vaults: [fixtureVault()],
  shareTotals: {
    vault_01: fixtureShareTotals()
  },
  nfts: [fixtureNft(user)],
  lvstAccounts: [fixtureLvstAccount(user)],
  protocol: {
    marketCount: 1,
    vaultCount: 1
  }
});

export const fixtureSeedWithoutProtocol = (
  user: UserAddress = fixtureUser()
): FakeTransportSeed => ({
  markets: [fixtureMarket()],
  vaults: [fixtureVault()],
  shareTotals: {
    vault_01: fixtureShareTotals()
  },
  nfts: [fixtureNft(user)],
  lvstAccounts: [fixtureLvstAccount(user)]
});

const notFound = (entity: string, id: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${entity} not found`,
    metadata: { details: id }
  });

const claimKey = (tokenId: TokenId, vaultId: VaultId, side: OptionsVaultSide): string =>
  `${tokenId.toString()}:${vaultId}:${side}`;

const boardKey = (vaultId: VaultId, side: OptionsVaultSide): string => `${vaultId}:${side}`;
