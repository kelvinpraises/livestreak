// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { VaultId } from "../model/ids.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { validateOptionsVaultSide } from "../model/vault.js";
import { sideToSolidityValue } from "../read/contracts/sides.js";
import type { ContractWriter } from "./transport.js";
import type { LivestreakContractAddresses } from "../read/contracts/addresses.js";
import type { LivestreakContractAbis } from "../read/contracts/transport.js";
import { validateVaultIdForContracts } from "../read/contracts/validation.js";

export type SetFundingRateInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly ratePerSecond: bigint;
};

export type StopFundingStreamInput = {
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
};

type FundingWriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: LivestreakContractAddresses;
  readonly abis: Pick<LivestreakContractAbis, "VaultFunding">;
};

export const setFundingRate = async (
  deps: FundingWriteDeps,
  input: SetFundingRateInput
): Promise<unknown> => {
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
  const ratePerSecond = requireNonNegativeBigInt(input.ratePerSecond, "ratePerSecond");

  return deps.writer.write({
    address: deps.addresses.vaultFunding,
    abi: deps.abis.VaultFunding,
    functionName: "setFundingRate",
    args: [vaultBytes, side, ratePerSecond]
  });
};

export const stopFundingStream = async (
  deps: FundingWriteDeps,
  input: StopFundingStreamInput
): Promise<unknown> => {
  const vaultBytes = validateVaultIdForContracts(input.vaultId);
  const side = sideToSolidityValue(validateOptionsVaultSide(input.side));

  return deps.writer.write({
    address: deps.addresses.vaultFunding,
    abi: deps.abis.VaultFunding,
    functionName: "stopFundingStream",
    args: [vaultBytes, side]
  });
};

// --- helpers ---

const requireNonNegativeBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint >= 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};
