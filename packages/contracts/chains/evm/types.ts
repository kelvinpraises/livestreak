import type { Address } from "viem";

/** Protocol contracts with both a wagmi ABI and a deploy address. */
export type EvmContract =
  | "protocol"
  | "marketRegistry"
  | "stewardRegistry"
  | "vault"
  | "dripsStreaming"
  | "caller"
  | "marketDriver"
  | "vaultDriver"
  | "treasury"
  | "lvstToken"
  | "paymaster";

/** Known committed deployment snapshots under `chains/evm/deployments/`. */
export type DeploymentName = "localhost";

export type EvmDeployScope = {
  readonly status: string;
  readonly deployedAt?: string;
  readonly contracts?: Readonly<Record<string, Address>>;
};

export type EvmDeployOutput = {
  readonly chain: string;
  readonly chainId: number;
  readonly rpc: string;
  readonly deployedAt?: string;
  readonly deployer?: Address;
  readonly scopes: Readonly<Record<string, EvmDeployScope>>;
};

/** Callable addresses keyed by `EvmContract` (partial when not yet deployed). */
export type EvmDeploymentAddresses = Partial<Record<EvmContract, Address>>;

export type EvmAddresses = Record<DeploymentName, EvmDeploymentAddresses>;
