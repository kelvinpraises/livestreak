// --- exports ---

import { flowTokenAbi, vaultFundingAbi } from "@flowstream/contracts";

import type { LivestreakContractAddresses } from "../read/contracts/addresses.js";
import type { LivestreakContractAbis } from "../read/contracts/transport.js";
import { validateLivestreakContractAddresses } from "../read/contracts/validation.js";
import type { ClaimLossFlowInput, StakeFlowInput, UnstakeFlowInput } from "./lvst.js";
import { claimLossFlow, stakeFlow, unstakeFlow } from "./lvst.js";
import type { SetFundingRateInput, StopFundingStreamInput } from "./funding.js";
import { setFundingRate, stopFundingStream } from "./funding.js";

export type ContractWriteRequest = {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

export type ContractWriter = {
  readonly write: (request: ContractWriteRequest) => Promise<unknown>;
};

export type OptionsWriteTransport = {
  readonly setFundingRate: (input: SetFundingRateInput) => Promise<unknown>;
  readonly stopFundingStream: (input: StopFundingStreamInput) => Promise<unknown>;
  readonly claimLossFlow: (input: ClaimLossFlowInput) => Promise<unknown>;
  readonly stakeFlow: (input: StakeFlowInput) => Promise<unknown>;
  readonly unstakeFlow: (input: UnstakeFlowInput) => Promise<unknown>;
};

export type ContractsOptionsWriteTransportInput = {
  readonly writer: ContractWriter;
  readonly addresses: LivestreakContractAddresses;
  readonly abis?: Pick<LivestreakContractAbis, "VaultFunding" | "FlowToken">;
};

export const createContractsOptionsWriteTransport = (
  input: ContractsOptionsWriteTransportInput
): OptionsWriteTransport => new ContractsOptionsWriteTransport(input);

type WriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: LivestreakContractAddresses;
  readonly abis: Pick<LivestreakContractAbis, "VaultFunding" | "FlowToken">;
};

class ContractsOptionsWriteTransport implements OptionsWriteTransport {
  private readonly deps: WriteDeps;

  constructor(input: ContractsOptionsWriteTransportInput) {
    this.deps = {
      writer: input.writer,
      addresses: validateLivestreakContractAddresses(input.addresses),
      abis: input.abis ?? {
        VaultFunding: vaultFundingAbi,
        FlowToken: flowTokenAbi
      }
    };
  }

  setFundingRate(input: SetFundingRateInput): Promise<unknown> {
    return setFundingRate(this.deps, input);
  }

  stopFundingStream(input: StopFundingStreamInput): Promise<unknown> {
    return stopFundingStream(this.deps, input);
  }

  claimLossFlow(input: ClaimLossFlowInput): Promise<unknown> {
    return claimLossFlow(this.deps, input);
  }

  stakeFlow(input: StakeFlowInput): Promise<unknown> {
    return stakeFlow(this.deps, input);
  }

  unstakeFlow(input: UnstakeFlowInput): Promise<unknown> {
    return unstakeFlow(this.deps, input);
  }
}
