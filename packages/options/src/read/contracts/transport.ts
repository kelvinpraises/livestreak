// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import {
  lvstTokenAbi,
  marketRegistryAbi,
  stewardRegistryAbi,
  vaultAbi,
  vaultFundingAbi
} from "@livestreak/contracts";

import { asMarketId, asVaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { OptionsFundingStream } from "../../model/funding.js";
import type { MarketId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsUserVaultPosition } from "../../model/position.js";
import type { OptionsVault, OptionsVaultSide } from "../../model/vault.js";
import type { OptionsReadTransport } from "../transport.js";
import type { LivestreakContractAddresses } from "./addresses.js";
import { contractsReadFailed, contractsReadNotFound } from "./errors.js";
import {
  bytes32ToHex,
  mapLvstAccount,
  mapFundingStream,
  mapMarket,
  mapProtocolSummary,
  mapUserVaultPosition,
  mapVault,
  mapVaultIds,
  type RawDisputeState,
  type RawHotState,
  type RawMarketData,
  type RawSidePosition,
  type RawVaultData
} from "./mapping.js";
import { sideToSolidityValue } from "./sides.js";
import {
  validateLivestreakContractAddresses,
  validateMarketIdForContracts,
  validateUserAddress,
  validateVaultIdForContracts
} from "./validation.js";

export type ContractReadRequest = {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

export type ContractReader = {
  readonly read: (request: ContractReadRequest) => Promise<unknown>;
};

export type LivestreakContractAbis = {
  readonly MarketRegistry: typeof marketRegistryAbi;
  readonly Vault: typeof vaultAbi;
  readonly VaultFunding: typeof vaultFundingAbi;
  readonly LvstToken: typeof lvstTokenAbi;
  readonly StewardRegistry: typeof stewardRegistryAbi;
};

const DEFAULT_ABIS: LivestreakContractAbis = {
  MarketRegistry: marketRegistryAbi,
  Vault: vaultAbi,
  VaultFunding: vaultFundingAbi,
  LvstToken: lvstTokenAbi,
  StewardRegistry: stewardRegistryAbi
};

export type ContractsOptionsReadTransportInput = {
  readonly reader: ContractReader;
  readonly addresses: LivestreakContractAddresses;
  readonly abis?: LivestreakContractAbis;
  readonly includeProtocolSummary?: boolean;
};

export const createContractsOptionsReadTransport = (
  input: ContractsOptionsReadTransportInput
): OptionsReadTransport => new ContractsOptionsReadTransport(input);

class ContractsOptionsReadTransport implements OptionsReadTransport {
  private readonly reader: ContractReader;
  private readonly addresses: LivestreakContractAddresses;
  private readonly abis: LivestreakContractAbis;
  readonly readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(input: ContractsOptionsReadTransportInput) {
    this.reader = input.reader;
    this.addresses = validateLivestreakContractAddresses(input.addresses);
    this.abis = input.abis ?? DEFAULT_ABIS;

    if (input.includeProtocolSummary === true) {
      this.readProtocolSummary = async () => this.loadProtocolSummary();
    }
  }

  async readMarket(marketId: MarketId): Promise<OptionsMarket> {
    const marketBytes = validateMarketIdForContracts(marketId);

    try {
      const exists = await this.call<boolean>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "marketExists",
        [marketBytes]
      );

      if (!exists) {
        throw contractsReadNotFound("market", marketId);
      }

      const market = await this.call<RawMarketData>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "getMarket",
        [marketBytes]
      );

      const vaultIdsRaw = await this.call<readonly `0x${string}`[]>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "getVaultIds",
        [marketBytes]
      );

      return mapMarket(asMarketId(bytes32ToHex(market.id)), market, mapVaultIds(vaultIdsRaw));
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("market", error);
    }
  }

  async listMarketVaults(marketId: MarketId): Promise<readonly VaultId[]> {
    const market = await this.readMarket(marketId);
    return market.vaultIds;
  }

  async readVault(vaultId: VaultId): Promise<OptionsVault> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      const data = await this.call<RawVaultData>(
        this.addresses.vault,
        this.abis.Vault,
        "getVault",
        [vaultBytes]
      );

      if (!data.exists) {
        throw contractsReadNotFound("vault", vaultId);
      }

      const hot = await this.call<RawHotState>(
        this.addresses.stewardRegistry,
        this.abis.StewardRegistry,
        "vaultHotState",
        [vaultBytes]
      );

      const dispute = await this.call<RawDisputeState>(
        this.addresses.stewardRegistry,
        this.abis.StewardRegistry,
        "disputeState",
        [vaultBytes]
      );

      return mapVault(data, hot, dispute);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("vault", error);
    }
  }

  async readUserVaultPosition(
    user: UserAddress,
    vaultId: VaultId
  ): Promise<OptionsUserVaultPosition> {
    const account = validateUserAddress(user);
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      await this.readVault(vaultId);

      const yes = await this.readRawPosition(account as `0x${string}`, vaultBytes, "yes");
      const no = await this.readRawPosition(account as `0x${string}`, vaultBytes, "no");

      return mapUserVaultPosition(account, asVaultId(vaultId), yes, no);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("user position", error);
    }
  }

  async readFundingStream(
    user: UserAddress,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<OptionsFundingStream> {
    const account = validateUserAddress(user);
    const vaultBytes = validateVaultIdForContracts(vaultId);
    const sideValue = sideToSolidityValue(side);

    try {
      await this.readVault(vaultId);

      const rate = await this.call<bigint>(
        this.addresses.vaultFunding,
        this.abis.VaultFunding,
        "fundingRate",
        [account as `0x${string}`, vaultBytes, sideValue]
      );

      const active = await this.call<boolean>(
        this.addresses.vaultFunding,
        this.abis.VaultFunding,
        "fundingActive",
        [account as `0x${string}`, vaultBytes, sideValue]
      );

      return mapFundingStream(account, asVaultId(vaultId), side, rate, active);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("funding stream", error);
    }
  }

  async readLvstAccount(user: UserAddress): Promise<LvstAccount> {
    const account = validateUserAddress(user);

    try {
      const balance = await this.call<bigint>(
        this.addresses.lvstToken,
        this.abis.LvstToken,
        "balanceOf",
        [account as `0x${string}`]
      );

      const staked = await this.call<bigint>(
        this.addresses.lvstToken,
        this.abis.LvstToken,
        "skeletonStaked",
        [account as `0x${string}`]
      );

      return mapLvstAccount(account, balance, staked);
    } catch (error) {
      throw contractsReadFailed("LVST account", error);
    }
  }

  private async loadProtocolSummary(): Promise<OptionsProtocolSummary> {
    try {
      const marketCount = await this.call<bigint>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "marketCount",
        []
      );

      let vaultCount = 0;
      const count = Number(marketCount);

      for (let index = 0; index < count; index += 1) {
        const marketId = await this.call<`0x${string}`>(
          this.addresses.marketRegistry,
          this.abis.MarketRegistry,
          "marketIdAt",
          [BigInt(index)]
        );
        const ids = await this.call<readonly `0x${string}`[]>(
          this.addresses.marketRegistry,
          this.abis.MarketRegistry,
          "getVaultIds",
          [marketId]
        );
        vaultCount += ids.length;
      }

      return mapProtocolSummary(marketCount, vaultCount);
    } catch (error) {
      throw contractsReadFailed("protocol summary", error);
    }
  }

  private async readRawPosition(
    user: `0x${string}`,
    vaultId: `0x${string}`,
    side: OptionsVaultSide
  ): Promise<RawSidePosition> {
    return this.call<RawSidePosition>(this.addresses.vault, this.abis.Vault, "position", [
      user,
      vaultId,
      sideToSolidityValue(side)
    ]);
  }

  private async call<T>(
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> {
    return (await this.reader.read({ address, abi, functionName, args })) as T;
  }
}
