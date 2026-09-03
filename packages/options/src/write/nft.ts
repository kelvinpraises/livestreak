// --- exports ---

import type { TokenId, UserAddress } from "../model/ids.js";
import { validateUserAddress } from "../read/contracts/validation.js";
import type { OptionsContractAddresses } from "../read/contracts/addresses.js";
import type { OptionsContractAbis } from "../read/contracts/transport.js";
import { validateTokenIdForContracts } from "../read/contracts/validation.js";
import type { ContractWriter } from "./transport.js";

export type TransferNftInput = {
  readonly from: UserAddress;
  readonly to: UserAddress;
  readonly tokenId: TokenId;
};

export type ApproveNftInput = {
  readonly operator: UserAddress;
  readonly tokenId: TokenId;
};

export type SetApprovalForAllInput = {
  readonly operator: UserAddress;
  readonly approved: boolean;
};

type NftWriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver">;
};

export const transferNft = async (deps: NftWriteDeps, input: TransferNftInput): Promise<unknown> => {
  const from = validateUserAddress(input.from, "from");
  const to = validateUserAddress(input.to, "to");
  const tokenId = validateTokenIdForContracts(input.tokenId);

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "transferFrom",
    args: [from as `0x${string}`, to as `0x${string}`, tokenId]
  });
};

export const approveNft = async (deps: NftWriteDeps, input: ApproveNftInput): Promise<unknown> => {
  const operator = validateUserAddress(input.operator, "operator");
  const tokenId = validateTokenIdForContracts(input.tokenId);

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "approve",
    args: [operator as `0x${string}`, tokenId]
  });
};

export const setApprovalForAll = async (
  deps: NftWriteDeps,
  input: SetApprovalForAllInput
): Promise<unknown> => {
  const operator = validateUserAddress(input.operator, "operator");

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "setApprovalForAll",
    args: [operator as `0x${string}`, input.approved]
  });
};
