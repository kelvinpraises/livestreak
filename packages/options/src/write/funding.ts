// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { TokenId, VaultId } from "../model/ids.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { validateOptionsVaultSide } from "../model/vault.js";
import { sideToSolidityValue } from "../read/contracts/sides.js";
import type { OptionsContractAddresses } from "../read/contracts/addresses.js";
import type { OptionsContractAbis } from "../read/contracts/transport.js";
import {
  validateTokenIdForContracts,
  validateVaultIdForContracts
} from "../read/contracts/validation.js";
import type { ContractWriter } from "./transport.js";

export type FundStreamInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly deposit: bigint;
};

export type LaneWriteInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
};

export type SetLanesInput = {
  readonly tokenId: TokenId;
  readonly lanes: readonly LaneWriteInput[];
  readonly addDeposit: bigint;
};

export type StopFundingInput = {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
};

export type StopAllFundingInput = {
  readonly tokenId: TokenId;
};

type FundingWriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver">;
};

export const fundStream = async (
  deps: FundingWriteDeps,
  input: FundStreamInput
): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
  const rate = requirePositiveBigInt(input.rate, "rate");
  const deposit = requirePositiveBigInt(input.deposit, "deposit");

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "fund",
    args: [tokenId, vaultBytes, side, rate, deposit]
  });
};

export const setLanes = async (deps: FundingWriteDeps, input: SetLanesInput): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const addDeposit = requireNonNegativeBigInt(input.addDeposit, "addDeposit");
  const lanes = input.lanes.map((lane) => ({
    vaultId: validateVaultIdForContracts(lane.vaultId),
    side: sideToSolidityValue(validateOptionsVaultSide(lane.side)),
    rate: requirePositiveBigInt(lane.rate, "rate")
  }));

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "setLanes",
    args: [tokenId, lanes, addDeposit]
  });
};

export const stopFunding = async (
  deps: FundingWriteDeps,
  input: StopFundingInput
): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "stop",
    args: [tokenId, vaultBytes, side]
  });
};

export const stopAllFunding = async (
  deps: FundingWriteDeps,
  input: StopAllFundingInput
): Promise<unknown> => {
  const tokenId = validateTokenIdForContracts(input.tokenId);

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "stopAll",
    args: [tokenId]
  });
};

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};

const requireNonNegativeBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint >= 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};
