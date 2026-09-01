import { LiveStreakConfigError } from "@livestreak/core";

import {
  asMarketId,
  asUserAddress,
  asVaultId,
  emptySidePosition,
  type LvstAccount,
  type MarketId,
  type OptionsFundingStream,
  type OptionsMarket,
  type OptionsProtocolSummary,
  type OptionsUserVaultPosition,
  type OptionsVault,
  type OptionsVaultSide,
  type UserAddress,
  type VaultId
} from "../../src/model/index.js";
import type { OptionsReadTransport } from "../../src/read/transport.js";

export interface FakeTransportSeed {
  readonly markets?: readonly OptionsMarket[];
  readonly vaults?: readonly OptionsVault[];
  readonly positions?: readonly OptionsUserVaultPosition[];
  readonly funding?: readonly OptionsFundingStream[];
  readonly lvstAccounts?: readonly LvstAccount[];
  readonly protocol?: OptionsProtocolSummary;
}

export const createFakeOptionsReadTransport = (
  seed: FakeTransportSeed = {}
): FakeTransportInMemory => new FakeTransportInMemory(seed);

export class FakeTransportInMemory implements OptionsReadTransport {
  private readonly markets = new Map<string, OptionsMarket>();
  private readonly vaults = new Map<string, OptionsVault>();
  private readonly positions = new Map<string, OptionsUserVaultPosition>();
  private readonly funding = new Map<string, OptionsFundingStream>();
  private readonly lvstAccounts = new Map<string, LvstAccount>();
  readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(seed: FakeTransportSeed) {
    for (const market of seed.markets ?? []) {
      this.markets.set(market.marketId, market);
    }

    for (const vault of seed.vaults ?? []) {
      this.vaults.set(vault.vaultId, vault);
    }

    for (const position of seed.positions ?? []) {
      this.positions.set(positionKey(position.account, position.vaultId), position);
    }

    for (const stream of seed.funding ?? []) {
      this.funding.set(fundingKey(stream.account, stream.vaultId, stream.side), stream);
    }

    for (const account of seed.lvstAccounts ?? []) {
      this.lvstAccounts.set(account.account, account);
    }

    if (seed.protocol !== undefined) {
      const summary = seed.protocol;
      this.readProtocolSummary = async () => summary;
    }
  }

  async readMarket(marketId: MarketId): Promise<OptionsMarket> {
    const market = this.markets.get(marketId);
    if (market === undefined) {
      throw notFound("market", marketId);
    }

    return market;
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

  async readUserVaultPosition(
    user: UserAddress,
    vaultId: VaultId
  ): Promise<OptionsUserVaultPosition> {
    const position = this.positions.get(positionKey(user, vaultId));
    if (position === undefined) {
      throw notFound("user position", `${user}:${vaultId}`);
    }

    return position;
  }

  async readFundingStream(
    user: UserAddress,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<OptionsFundingStream> {
    const stream = this.funding.get(fundingKey(user, vaultId, side));
    if (stream === undefined) {
      throw notFound("funding stream", `${user}:${vaultId}:${side}`);
    }

    return stream;
  }

  async readLvstAccount(user: UserAddress): Promise<LvstAccount> {
    const account = this.lvstAccounts.get(user);
    if (account === undefined) {
      throw notFound("LVST account", user);
    }

    return account;
  }

  setMarket(market: OptionsMarket): void {
    this.markets.set(market.marketId, market);
  }

  setVault(vault: OptionsVault): void {
    this.vaults.set(vault.vaultId, vault);
  }

  setPosition(position: OptionsUserVaultPosition): void {
    this.positions.set(positionKey(position.account, position.vaultId), position);
  }

  setFunding(stream: OptionsFundingStream): void {
    this.funding.set(fundingKey(stream.account, stream.vaultId, stream.side), stream);
  }

  setLvstAccount(account: LvstAccount): void {
    this.lvstAccounts.set(account.account, account);
  }
}

export const fixtureMarket = (): OptionsMarket => ({
  marketId: asMarketId("market_01"),
  title: "Regulation hearing",
  streamId: "stream_01",
  category: "macro",
  status: "open",
  vaultIds: [asVaultId("vault_01")],
  timing: {
    createdAtMs: 1_730_000_000_000,
    closesAtMs: 1_730_001_800_000
  }
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

export const fixtureResolvedVault = (): OptionsVault =>
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
    }
  });

export const fixtureUser = (): UserAddress => asUserAddress("0xuser");

export const fixturePositionBothSides = (
  user: UserAddress = fixtureUser()
): OptionsUserVaultPosition => ({
  account: user,
  vaultId: asVaultId("vault_01"),
  positions: {
    yes: {
      side: "yes",
      streamed: 25_000_000n,
      shares: 34_000_000n,
      currentValue: 28_500_000n,
      claimable: 0n,
      released: false,
      lossClaimable: 0n
    },
    no: {
      side: "no",
      streamed: 5_000_000n,
      shares: 6_000_000n,
      currentValue: 4_800_000n,
      claimable: 0n,
      released: false,
      lossClaimable: 0n
    }
  }
});

export const fixtureResolvedPosition = (
  user: UserAddress = fixtureUser()
): OptionsUserVaultPosition => ({
  account: user,
  vaultId: asVaultId("vault_01"),
  positions: {
    yes: {
      side: "yes",
      streamed: 25_000_000n,
      shares: 34_000_000n,
      currentValue: 58_000_000n,
      claimable: 58_000_000n,
      released: false,
      lossClaimable: 0n
    },
    no: {
      side: "no",
      streamed: 5_000_000n,
      shares: 6_000_000n,
      currentValue: 0n,
      claimable: 0n,
      released: false,
      lossClaimable: 2_500_000n
    }
  }
});

export const fixtureFundingYes = (user: UserAddress = fixtureUser()): OptionsFundingStream => ({
  account: user,
  vaultId: asVaultId("vault_01"),
  side: "yes",
  ratePerSecond: 13_333n,
  ratePerMinute: 800_000n,
  active: true,
  updatedAtMs: 1_730_000_100_000
});

export const fixtureFundingNoPaused = (
  user: UserAddress = fixtureUser()
): OptionsFundingStream => ({
  account: user,
  vaultId: asVaultId("vault_01"),
  side: "no",
  ratePerSecond: 0n,
  ratePerMinute: 0n,
  active: false,
  updatedAtMs: 1_730_000_100_000
});

export const fixtureLvstAccount = (user: UserAddress = fixtureUser()): LvstAccount => ({
  account: user,
  balance: 1_000_000_000_000_000_000n,
  staked: 250_000_000_000_000_000n,
  pendingDividends: 12_500_000n,
  totalEarned: 3_000_000_000_000_000_000n,
  lossClaims: {
    claimable: 500_000_000_000_000_000n,
    claimed: 100_000_000_000_000_000n,
    stakedFromClaims: 50_000_000_000_000_000n
  }
});

export const fixtureSeed = (user: UserAddress = fixtureUser()): FakeTransportSeed => ({
  markets: [fixtureMarket()],
  vaults: [fixtureVault()],
  positions: [fixturePositionBothSides(user)],
  funding: [fixtureFundingYes(user), fixtureFundingNoPaused(user)],
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
  positions: [fixturePositionBothSides(user)],
  funding: [fixtureFundingYes(user), fixtureFundingNoPaused(user)],
  lvstAccounts: [fixtureLvstAccount(user)]
});

const positionKey = (user: UserAddress, vaultId: VaultId): string => `${user}:${vaultId}`;

const fundingKey = (user: UserAddress, vaultId: VaultId, side: OptionsVaultSide): string =>
  `${user}:${vaultId}:${side}`;

const notFound = (entity: string, id: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${entity} not found`,
    metadata: { details: id }
  });

export const emptyPosition = (
  user: UserAddress,
  vaultId: VaultId
): OptionsUserVaultPosition => ({
  account: user,
  vaultId,
  positions: {
    yes: emptySidePosition("yes"),
    no: emptySidePosition("no")
  }
});
