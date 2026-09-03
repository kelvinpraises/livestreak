// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import {
  dripsStreamingAbi,
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi
} from "@livestreak/contracts/evm/abis";

import { asMarketId, asTokenId, asVaultId } from "../../model/ids.js";
import type { LvstAccount } from "../../model/lvst.js";
import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsBoardState } from "../../model/accrual.js";
import type { OptionsStreamState } from "../../model/media.js";
import type { OptionsMarket } from "../../model/market.js";
import type { OptionsNft } from "../../model/nft.js";
import type { OptionsProtocolSummary } from "../../model/snapshot.js";
import type { OptionsVault } from "../../model/vault.js";
import type { OptionsVaultShareTotals, OptionsVaultSide } from "../../model/vault.js";
import type { OptionsReadTransport } from "../transport.js";
import type { OptionsContractAddresses } from "./addresses.js";
import { contractsReadFailed, contractsReadNotFound } from "./errors.js";
import {
  bytes32ToHex,
  enrichLane,
  mapBoard,
  mapLane,
  mapLvstAccount,
  mapMarket,
  mapNft,
  mapProtocolSummary,
  mapApprovedAddress,
  mapStreamState,
  mapStreamsStateBalance,
  type RawStreamsState,
  mapVault,
  mapVaultIds,
  mapVaultPools,
  mapVaultShareTotals,
  type RawBoard,
  type RawDisputeState,
  type RawHotState,
  type RawLane,
  type RawMarketData,
  type RawPosition,
  type RawStreamState,
  type RawVaultData,
  type RawVaultPools
} from "./mapping.js";
import { sideFromSolidityValue, sideToSolidityValue } from "./sides.js";
import {
  validateContractAddress,
  validateMarketIdForContracts,
  validateOptionsContractAddresses,
  validateTokenIdForContracts,
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

export type OptionsContractAbis = {
  readonly MarketRegistry: typeof marketRegistryAbi;
  readonly Vault: typeof vaultAbi;
  readonly MarketDriver: typeof marketDriverAbi;
  readonly StewardRegistry: typeof stewardRegistryAbi;
  readonly Treasury: typeof treasuryAbi;
  readonly LvstToken: typeof lvstTokenAbi;
  readonly DripsStreaming: typeof dripsStreamingAbi;
};

const DEFAULT_ABIS: OptionsContractAbis = {
  MarketRegistry: marketRegistryAbi,
  Vault: vaultAbi,
  MarketDriver: marketDriverAbi,
  StewardRegistry: stewardRegistryAbi,
  Treasury: treasuryAbi,
  LvstToken: lvstTokenAbi,
  DripsStreaming: dripsStreamingAbi
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type ContractsOptionsReadTransportInput = {
  readonly reader: ContractReader;
  readonly addresses: OptionsContractAddresses;
  readonly abis?: OptionsContractAbis;
  readonly includeProtocolSummary?: boolean;
  readonly transferOperator?: UserAddress;
};

export const createContractsOptionsReadTransport = (
  input: ContractsOptionsReadTransportInput
): OptionsReadTransport => new ContractsOptionsReadTransport(input);

class ContractsOptionsReadTransport implements OptionsReadTransport {
  private readonly reader: ContractReader;
  private readonly addresses: OptionsContractAddresses;
  private readonly abis: OptionsContractAbis;
  private readonly transferOperator?: UserAddress;
  private usdcAddress?: `0x${string}`;
  readonly readProtocolSummary?: () => Promise<OptionsProtocolSummary>;

  constructor(input: ContractsOptionsReadTransportInput) {
    this.reader = input.reader;
    this.addresses = validateOptionsContractAddresses(input.addresses);
    this.abis = input.abis ?? DEFAULT_ABIS;
    this.transferOperator =
      input.transferOperator === undefined
        ? undefined
        : validateUserAddress(input.transferOperator, "transferOperator");

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

  async readStreamState(marketId: MarketId): Promise<OptionsStreamState> {
    const marketBytes = validateMarketIdForContracts(marketId);

    try {
      const state = await this.call<RawStreamState>(
        this.addresses.marketRegistry,
        this.abis.MarketRegistry,
        "streamState",
        [marketBytes]
      );

      return mapStreamState(state);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("stream state", error);
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

      const pools = await this.call<RawVaultPools>(
        this.addresses.vault,
        this.abis.Vault,
        "getVaultPools",
        [vaultBytes]
      );

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

      return mapVault(data, pools, hot, dispute);
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("vault", error);
    }
  }

  async readVaultShareTotals(vaultId: VaultId): Promise<OptionsVaultShareTotals> {
    const poolsRaw = await this.readVaultPools(vaultId);
    return mapVaultShareTotals(poolsRaw);
  }

  private async readVaultPools(vaultId: VaultId): Promise<RawVaultPools> {
    const vaultBytes = validateVaultIdForContracts(vaultId);
    return this.call<RawVaultPools>(this.addresses.vault, this.abis.Vault, "getVaultPools", [
      vaultBytes
    ]);
  }

  async listOwnerTokens(owner: UserAddress): Promise<readonly TokenId[]> {
    const account = validateUserAddress(owner);

    try {
      const tokenIds = await this.call<readonly bigint[]>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "tokensOfOwner",
        [account as `0x${string}`]
      );

      return tokenIds.map((id) => asTokenId(id));
    } catch (error) {
      throw contractsReadFailed("owner tokens", error);
    }
  }

  async readNft(tokenId: TokenId, owner: UserAddress): Promise<OptionsNft> {
    const id = validateTokenIdForContracts(tokenId);
    const account = validateUserAddress(owner);

    try {
      const marketIdRaw = await this.call<`0x${string}`>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "marketIdOf",
        [id]
      );

      const laneCount = await this.call<bigint>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "laneCount",
        [id]
      );

      const count = Number(laneCount);
      const lanes = [];
      const winningSideByVault = new Map<string, OptionsVaultSide | undefined>();

      for (let index = 0; index < count; index += 1) {
        const lane = await this.call<RawLane>(
          this.addresses.marketDriver,
          this.abis.MarketDriver,
          "laneAt",
          [id, BigInt(index)]
        );

        const vaultBytes = lane.vaultId;
        const vaultId = asVaultId(bytes32ToHex(vaultBytes));
        const position = await this.call<RawPosition>(
          this.addresses.vault,
          this.abis.Vault,
          "getPosition",
          [vaultBytes, lane.side, id]
        );

        const mapped = mapLane(asTokenId(id), lane, position);
        let winningSide = winningSideByVault.get(vaultId);

        if (!winningSideByVault.has(vaultId)) {
          winningSide = await this.readWinningSide(vaultId);
          winningSideByVault.set(vaultId, winningSide);
        }

        const claimable = await this.readClaimable(asTokenId(id), vaultId, mapped.side);
        const lossClaimable = await this.readLossClaimable(asTokenId(id), vaultId, mapped.side);

        lanes.push(enrichLane(mapped, claimable, lossClaimable, winningSide));
      }

      return mapNft(
        asTokenId(id),
        account,
        asMarketId(bytes32ToHex(marketIdRaw)),
        count,
        lanes,
        await this.readTransferFlags(id)
      );
    } catch (error) {
      if (error instanceof LiveStreakConfigError) {
        throw error;
      }

      throw contractsReadFailed("nft", error);
    }
  }

  async readClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    const id = validateTokenIdForContracts(tokenId);
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      return await this.call<bigint>(this.addresses.vault, this.abis.Vault, "claimable", [
        id,
        vaultBytes,
        sideToSolidityValue(side)
      ]);
    } catch (error) {
      throw contractsReadFailed("claimable", error);
    }
  }

  async readLossClaimable(
    tokenId: TokenId,
    vaultId: VaultId,
    side: OptionsVaultSide
  ): Promise<bigint> {
    const id = validateTokenIdForContracts(tokenId);
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      return await this.call<bigint>(this.addresses.vault, this.abis.Vault, "lossClaimable", [
        id,
        vaultBytes,
        sideToSolidityValue(side)
      ]);
    } catch (error) {
      throw contractsReadFailed("loss claimable", error);
    }
  }

  async readPot(vaultId: VaultId): Promise<bigint> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      return await this.call<bigint>(this.addresses.vault, this.abis.Vault, "pot", [vaultBytes]);
    } catch (error) {
      throw contractsReadFailed("pot", error);
    }
  }

  async readCollected(vaultId: VaultId): Promise<boolean> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      return await this.call<boolean>(this.addresses.vault, this.abis.Vault, "collected", [
        vaultBytes
      ]);
    } catch (error) {
      throw contractsReadFailed("collected", error);
    }
  }

  async readAccountVaultIds(tokenId: TokenId): Promise<readonly VaultId[]> {
    const id = validateTokenIdForContracts(tokenId);

    try {
      const vaultIds = await this.call<readonly `0x${string}`[]>(
        this.addresses.vault,
        this.abis.Vault,
        "getAccountVaultIds",
        [id]
      );

      return mapVaultIds(vaultIds);
    } catch (error) {
      throw contractsReadFailed("account vault ids", error);
    }
  }

  async readWinningSide(vaultId: VaultId): Promise<OptionsVaultSide | undefined> {
    const vault = await this.readVault(vaultId);

    if (vault.status !== "resolved") {
      return undefined;
    }

    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      const side = await this.call<number>(this.addresses.vault, this.abis.Vault, "winningSide", [
        vaultBytes
      ]);

      return sideFromSolidityValue(side);
    } catch (error) {
      throw contractsReadFailed("winning side", error);
    }
  }

  async readBoard(vaultId: VaultId, side: OptionsVaultSide): Promise<OptionsBoardState> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      const board = await this.call<RawBoard>(this.addresses.vault, this.abis.Vault, "getBoard", [
        vaultBytes,
        sideToSolidityValue(side)
      ]);

      return mapBoard(board);
    } catch (error) {
      throw contractsReadFailed("board", error);
    }
  }

  async readSharePrice(vaultId: VaultId, side: OptionsVaultSide): Promise<bigint> {
    const vaultBytes = validateVaultIdForContracts(vaultId);

    try {
      return await this.call<bigint>(this.addresses.vault, this.abis.Vault, "getSharePrice", [
        vaultBytes,
        sideToSolidityValue(side)
      ]);
    } catch (error) {
      throw contractsReadFailed("share price", error);
    }
  }

  async readPendingShares(
    vaultId: VaultId,
    side: OptionsVaultSide,
    tokenId: TokenId
  ): Promise<bigint> {
    const vaultBytes = validateVaultIdForContracts(vaultId);
    const id = validateTokenIdForContracts(tokenId);

    try {
      return await this.call<bigint>(this.addresses.vault, this.abis.Vault, "pendingShares", [
        vaultBytes,
        sideToSolidityValue(side),
        id
      ]);
    } catch (error) {
      throw contractsReadFailed("pending shares", error);
    }
  }

  async readUsdcAddress(): Promise<`0x${string}`> {
    if (this.usdcAddress !== undefined) {
      return this.usdcAddress;
    }

    try {
      const address = await this.call<`0x${string}`>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "USDC",
        []
      );
      this.usdcAddress = validateContractAddress(address, "USDC");
      return this.usdcAddress;
    } catch (error) {
      throw contractsReadFailed("USDC address", error);
    }
  }

  async readNftBalance(tokenId: TokenId): Promise<bigint> {
    const id = validateTokenIdForContracts(tokenId);

    try {
      const usdc = await this.readUsdcAddress();
      const state = await this.call<RawStreamsState>(
        this.addresses.dripsStreaming,
        this.abis.DripsStreaming,
        "streamsState",
        [id, usdc]
      );

      return mapStreamsStateBalance(state);
    } catch (error) {
      throw contractsReadFailed("NFT balance", error);
    }
  }

  async readOwnerOf(tokenId: TokenId): Promise<UserAddress> {
    const id = validateTokenIdForContracts(tokenId);

    try {
      const owner = await this.call<`0x${string}`>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "ownerOf",
        [id]
      );

      return validateUserAddress(owner, "ownerOf");
    } catch (error) {
      throw contractsReadFailed("ownerOf", error);
    }
  }

  async readApproved(tokenId: TokenId): Promise<UserAddress | undefined> {
    const id = validateTokenIdForContracts(tokenId);

    try {
      const approved = await this.call<`0x${string}`>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "getApproved",
        [id]
      );

      return mapApprovedAddress(approved);
    } catch (error) {
      throw contractsReadFailed("getApproved", error);
    }
  }

  async readIsApprovedForAll(owner: UserAddress, operator: UserAddress): Promise<boolean> {
    const account = validateUserAddress(owner);
    const approvedOperator = validateUserAddress(operator, "operator");

    try {
      return await this.call<boolean>(
        this.addresses.marketDriver,
        this.abis.MarketDriver,
        "isApprovedForAll",
        [account as `0x${string}`, approvedOperator as `0x${string}`]
      );
    } catch (error) {
      throw contractsReadFailed("isApprovedForAll", error);
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
        this.addresses.treasury,
        this.abis.Treasury,
        "lvstStaked",
        [account as `0x${string}`]
      );

      const pendingDividends = await this.call<bigint>(
        this.addresses.treasury,
        this.abis.Treasury,
        "lvstPendingDividends",
        [account as `0x${string}`]
      );

      return mapLvstAccount(account, balance, staked, pendingDividends);
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

  private async call<T>(
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> {
    return (await this.reader.read({ address, abi, functionName, args })) as T;
  }

  private async readTransferFlags(
    tokenId: bigint
  ): Promise<{ readonly approved?: UserAddress; readonly isOperator?: boolean }> {
    const [approved, ownerOnChain] = await Promise.all([
      this.readApproved(asTokenId(tokenId)),
      this.readOwnerOf(asTokenId(tokenId))
    ]);

    const isOperator =
      this.transferOperator === undefined
        ? undefined
        : await this.readIsApprovedForAll(ownerOnChain, this.transferOperator);

    if (approved === undefined && isOperator === undefined) {
      return {};
    }

    return {
      ...(approved === undefined ? {} : { approved }),
      ...(isOperator === undefined ? {} : { isOperator })
    };
  }
}

export type { RawVaultPools };
export { mapVaultPools, mapVaultShareTotals };
