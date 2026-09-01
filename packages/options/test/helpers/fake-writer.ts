import type { ContractWriteRequest, ContractWriter } from "../../src/write/transport.js";

export type FakeWriter = ContractWriter & {
  readonly requests: readonly ContractWriteRequest[];
  readonly clear: () => void;
};

export const createFakeContractWriter = (): FakeWriter => {
  const requests: ContractWriteRequest[] = [];

  return {
    get requests() {
      return requests;
    },
    clear() {
      requests.length = 0;
    },
    write(request: ContractWriteRequest): Promise<unknown> {
      requests.push(request);
      return Promise.resolve("0xfake_tx");
    }
  };
};
