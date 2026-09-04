import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";
import {
  asVaultId,
  validateOptionsVaultSide,
  type MarketId,
  type OptionsVaultSide,
  type VaultId
} from "@livestreak/options";
import type { WalletAccountEvmErc4337 } from "@livestreak/wallet";
import { parseEventLogs, type PublicClient } from "viem";
import {
  ensureErc20Approval,
  readUserOpTransactionHash,
  sendContractCall
} from "../chains/evm-tx.js";

/** Temporary operator-seed until bookmaker ships a vault-creation edge. */
export interface OperatorCreateVaultInput {
  readonly account: WalletAccountEvmErc4337;
  readonly publicClient: PublicClient;
  readonly vaultDriverAddress: `0x${string}`;
  readonly usdcAddress: `0x${string}`;
  readonly marketId: MarketId;
  readonly question: string;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly deposit: bigint;
}

export interface OperatorCreateVaultResult {
  readonly vaultId: VaultId;
  readonly approveTx?: string;
  readonly createTx: string;
}

export const sideToSeedEnum = (side: OptionsVaultSide): 0 | 1 =>
  validateOptionsVaultSide(side) === "yes" ? 0 : 1;

export const encodeCreateVaultCall = (
  marketId: `0x${string}`,
  question: string,
  side: OptionsVaultSide,
  rate: bigint,
  deposit: bigint
) => ({
  marketId,
  question,
  seedSide: sideToSeedEnum(side),
  rate,
  deposit
});

export const parseVaultCreatedId = (
  logs: readonly unknown[],
  vaultDriverAddress: `0x${string}`
): VaultId => {
  const events = parseEventLogs({
    abi: vaultDriverAbi,
    logs: logs as never,
    eventName: "VaultCreated"
  }).filter((event) => event.address.toLowerCase() === vaultDriverAddress.toLowerCase());

  if (events.length === 0) {
    throw new Error("VaultCreated event not found in transaction receipt");
  }

  const vaultId = events[0]?.args.vaultId;
  if (typeof vaultId !== "string") {
    throw new Error("VaultCreated event is missing vaultId");
  }

  return asVaultId(vaultId);
};

export const operatorCreateVault = async (
  input: OperatorCreateVaultInput
): Promise<OperatorCreateVaultResult> => {
  if (input.question.trim().length === 0) {
    throw new Error("Vault question must be non-empty");
  }

  if (input.rate <= 0n) {
    throw new Error("Vault seed rate must be > 0");
  }

  if (input.deposit <= 0n) {
    throw new Error("Vault seed deposit must be > 0");
  }

  const side = validateOptionsVaultSide(input.side);
  const approveTx = await ensureErc20Approval(
    input.account,
    input.publicClient,
    input.usdcAddress,
    input.vaultDriverAddress,
    input.deposit
  );

  const { userOpHash, userOpReceipt } = await sendContractCall(
    input.account,
    input.vaultDriverAddress,
    vaultDriverAbi,
    "createVault",
    [
      input.marketId,
      input.question,
      sideToSeedEnum(side),
      input.rate,
      input.deposit
    ]
  );

  const txHash = readUserOpTransactionHash(userOpReceipt);
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
  const vaultId = parseVaultCreatedId(receipt.logs, input.vaultDriverAddress);

  return {
    vaultId,
    ...(approveTx === undefined ? {} : { approveTx }),
    createTx: userOpHash
  };
};
