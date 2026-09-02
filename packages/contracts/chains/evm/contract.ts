import type { Address } from "viem";

import { evmAbis, type EvmContractAbi } from "./abis.js";
import { addresses } from "./addresses.js";
import type { DeploymentName, EvmContract } from "./types.js";

export const DEFAULT_DEPLOYMENT: DeploymentName = "localhost";

export type EvmContractDescriptor<N extends EvmContract> = {
  readonly abi: EvmContractAbi<N>;
  readonly address: Address;
};

export const contract = <N extends EvmContract>(
  name: N,
  deployment: DeploymentName = DEFAULT_DEPLOYMENT
): EvmContractDescriptor<N> => {
  const address = addresses[deployment]?.[name];
  if (address === undefined) {
    throw new Error(`contract '${name}' not deployed on '${deployment}'`);
  }

  return {
    abi: evmAbis[name],
    address
  };
};
