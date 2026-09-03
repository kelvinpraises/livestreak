// --- exports ---

import type { TokenId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { validateOptionsVaultSide } from "../model/vault.js";
import { sideToSolidityValue } from "../read/contracts/sides.js";
import type { OptionsContractAddresses } from "../read/contracts/addresses.js";
import { validateUserAddress } from "../read/contracts/validation.js";
import type { OptionsContractAbis } from "../read/contracts/transport.js";
import {
  validateTokenIdForContracts,
  validateVaultIdForContracts
} from "../read/contracts/validation.js";
import type { ContractWriter } from "./transport.js";

export type WithdrawInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly to: UserAddress;
};

export type WithdrawManyInput = {
  readonly tokenId: TokenId;
  readonly vaultIds: readonly VaultId[];
  readonly to: UserAddress;
};

export type ClaimLossLvstInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly to: UserAddress;
};

type ClaimWriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver">;
};

export const withdraw = async (deps: ClaimWriteDeps, input: WithdrawInput): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const to = validateUserAddress(input.to, "to");

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "withdraw",
    args: [tokenId, vaultBytes, to as `0x${string}`]
  });
};

export const withdrawMany = async (
  deps: ClaimWriteDeps,
  input: WithdrawManyInput
): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const to = validateUserAddress(input.to, "to");
  const vaultIds = input.vaultIds.map((vaultId) => validateVaultIdForContracts(vaultId));

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "withdraw",
    args: [tokenId, vaultIds, to as `0x${string}`]
  });
};

export const claimLossLvst = async (
  deps: ClaimWriteDeps,
  input: ClaimLossLvstInput
): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
  const to = validateUserAddress(input.to, "to");

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "claimLossLvst",
    args: [tokenId, vaultBytes, side, to as `0x${string}`]
  });
};
