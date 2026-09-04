// --- exports ---

import type { WalletInit } from "@livestreak/schema";

import type { BookmakerContractAddresses } from "./addresses.js";

export type TxId = string & { readonly __brand: "TxId" };

export const asTxId = (hash: string): TxId => hash as TxId;

export type VaultId = string & { readonly __brand: "VaultId" };

export const asVaultId = (value: string): VaultId => value as VaultId;

export type CreateVaultInput = {
  readonly marketId: string;
  readonly question: string;
  readonly creatorSide: "yes" | "no";
  readonly creatorStake: bigint;
  readonly seedRate: bigint;
};

export type CreateVaultResult = {
  readonly txId: TxId;
  readonly vaultId: VaultId;
};

export interface BookmakerChainReader {
  readonly marketExists: (marketId: string) => Promise<boolean>;
}

export interface BookmakerChainWriter {
  readonly createVault: (input: CreateVaultInput) => Promise<CreateVaultResult>;
}

export interface BookmakerChain {
  readonly reader: BookmakerChainReader;
  readonly writer: BookmakerChainWriter;
}

export interface BookmakerChainConfig {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: BookmakerContractAddresses;
  readonly readRpcUrl?: string;
}
