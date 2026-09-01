// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { VaultId } from "../model/ids.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { validateOptionsVaultSide } from "../model/vault.js";
import type { LivestreakContractAddresses } from "../read/contracts/addresses.js";
import { sideToSolidityValue } from "../read/contracts/sides.js";
import type { LivestreakContractAbis } from "../read/contracts/transport.js";
import { validateVaultIdForContracts } from "../read/contracts/validation.js";
import type { ContractWriter } from "./transport.js";

export type ClaimLossFlowInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
};

export type StakeFlowInput = {
  readonly amount: bigint;
};

export type UnstakeFlowInput = {
  readonly amount: bigint;
};

type FlowWriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: LivestreakContractAddresses;
  readonly abis: Pick<LivestreakContractAbis, "FlowToken">;
};

export const claimLossFlow = async (
  deps: FlowWriteDeps,
  input: ClaimLossFlowInput
): Promise<unknown> => {
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));

  return deps.writer.write({
    address: deps.addresses.flowToken,
    abi: deps.abis.FlowToken,
    functionName: "claimLossFlow",
    args: [vaultBytes, side]
  });
};

export const stakeFlow = async (deps: FlowWriteDeps, input: StakeFlowInput): Promise<unknown> => {
  const amount = requirePositiveBigInt(input.amount, "amount");

  return deps.writer.write({
    address: deps.addresses.flowToken,
    abi: deps.abis.FlowToken,
    functionName: "skeletonStake",
    args: [amount]
  });
};

export const unstakeFlow = async (deps: FlowWriteDeps, input: UnstakeFlowInput): Promise<unknown> => {
  const amount = requirePositiveBigInt(input.amount, "amount");

  return deps.writer.write({
    address: deps.addresses.flowToken,
    abi: deps.abis.FlowToken,
    functionName: "skeletonUnstake",
    args: [amount]
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
