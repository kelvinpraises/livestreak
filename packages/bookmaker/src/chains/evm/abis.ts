// --- exports ---

import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";
import { erc20Abi } from "viem";

export type BookmakerContractAbis = {
  readonly VaultDriver: typeof vaultDriverAbi;
  readonly Erc20: typeof erc20Abi;
};

export const DEFAULT_ABIS: BookmakerContractAbis = {
  VaultDriver: vaultDriverAbi,
  Erc20: erc20Abi
};
