// --- exports ---

import { marketDriverAbi, treasuryAbi } from "@livestreak/contracts/evm/abis";

import type { OptionsContractAddresses } from "../read/contracts/addresses.js";
import type { OptionsContractAbis } from "../read/contracts/transport.js";
import { validateOptionsContractAddresses } from "../read/contracts/validation.js";
import type { ApproveNftInput, SetApprovalForAllInput, TransferNftInput } from "./nft.js";
import { approveNft, setApprovalForAll, transferNft } from "./nft.js";
import type { ClaimLossLvstInput, WithdrawInput, WithdrawManyInput } from "./claim.js";
import { claimLossLvst, withdraw, withdrawMany } from "./claim.js";
import type {
  FundStreamInput,
  SetLanesInput,
  StopAllFundingInput,
  StopFundingInput
} from "./funding.js";
import { fundStream, setLanes, stopAllFunding, stopFunding } from "./funding.js";
import type { StakeLvstInput, UnstakeLvstInput } from "./lvst.js";
import { claimDividends, stakeLvst, unstakeLvst } from "./lvst.js";

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
  readonly fundStream: (input: FundStreamInput) => Promise<unknown>;
  readonly setLanes: (input: SetLanesInput) => Promise<unknown>;
  readonly stopFunding: (input: StopFundingInput) => Promise<unknown>;
  readonly stopAllFunding: (input: StopAllFundingInput) => Promise<unknown>;
  readonly withdraw: (input: WithdrawInput) => Promise<unknown>;
  readonly withdrawMany: (input: WithdrawManyInput) => Promise<unknown>;
  readonly claimLossLvst: (input: ClaimLossLvstInput) => Promise<unknown>;
  readonly stakeLvst: (input: StakeLvstInput) => Promise<unknown>;
  readonly unstakeLvst: (input: UnstakeLvstInput) => Promise<unknown>;
  readonly claimDividends: () => Promise<unknown>;
  readonly transferNft: (input: TransferNftInput) => Promise<unknown>;
  readonly approveNft: (input: ApproveNftInput) => Promise<unknown>;
  readonly setApprovalForAll: (input: SetApprovalForAllInput) => Promise<unknown>;
};

export type ContractsOptionsWriteTransportInput = {
  readonly writer: ContractWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis?: Pick<OptionsContractAbis, "MarketDriver" | "Treasury">;
};

export const createContractsOptionsWriteTransport = (
  input: ContractsOptionsWriteTransportInput
): OptionsWriteTransport => new ContractsOptionsWriteTransport(input);

type WriteDeps = {
  readonly writer: ContractWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver" | "Treasury">;
};

class ContractsOptionsWriteTransport implements OptionsWriteTransport {
  private readonly deps: WriteDeps;

  constructor(input: ContractsOptionsWriteTransportInput) {
    this.deps = {
      writer: input.writer,
      addresses: validateOptionsContractAddresses(input.addresses),
      abis: input.abis ?? {
        MarketDriver: marketDriverAbi,
        Treasury: treasuryAbi
      }
    };
  }

  fundStream(input: FundStreamInput): Promise<unknown> {
    return fundStream(this.deps, input);
  }

  setLanes(input: SetLanesInput): Promise<unknown> {
    return setLanes(this.deps, input);
  }

  stopFunding(input: StopFundingInput): Promise<unknown> {
    return stopFunding(this.deps, input);
  }

  stopAllFunding(input: StopAllFundingInput): Promise<unknown> {
    return stopAllFunding(this.deps, input);
  }

  withdraw(input: WithdrawInput): Promise<unknown> {
    return withdraw(this.deps, input);
  }

  withdrawMany(input: WithdrawManyInput): Promise<unknown> {
    return withdrawMany(this.deps, input);
  }

  claimLossLvst(input: ClaimLossLvstInput): Promise<unknown> {
    return claimLossLvst(this.deps, input);
  }

  stakeLvst(input: StakeLvstInput): Promise<unknown> {
    return stakeLvst(this.deps, input);
  }

  unstakeLvst(input: UnstakeLvstInput): Promise<unknown> {
    return unstakeLvst(this.deps, input);
  }

  claimDividends(): Promise<unknown> {
    return claimDividends(this.deps);
  }

  transferNft(input: TransferNftInput): Promise<unknown> {
    return transferNft(this.deps, input);
  }

  approveNft(input: ApproveNftInput): Promise<unknown> {
    return approveNft(this.deps, input);
  }

  setApprovalForAll(input: SetApprovalForAllInput): Promise<unknown> {
    return setApprovalForAll(this.deps, input);
  }
}
