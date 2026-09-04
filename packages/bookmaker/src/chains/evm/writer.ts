// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";
import { encodeFunctionData, type Abi } from "viem";

import type {
  BookmakerChainConfig,
  BookmakerChainWriter,
  CreateVaultInput
} from "../types.js";
import { asTxId } from "../types.js";
import { DEFAULT_ABIS } from "./abis.js";
import { validateBookmakerContractAddresses } from "./addresses.js";
import { parseVaultCreatedFromLogs } from "./decode.js";
import {
  sideToSolidityValue,
  validateDepositBounds,
  validateMarketIdForContracts,
  validateSeedRate
} from "./encode.js";

export const createEvmBookmakerWriter = (config: BookmakerChainConfig): BookmakerChainWriter => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM bookmaker writer requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const addresses = validateBookmakerContractAddresses(config.addresses);
  const abis = DEFAULT_ABIS;

  return {
    createVault: async (input: CreateVaultInput) => {
      const marketIdBytes = validateMarketIdForContracts(input.marketId);
      const side = sideToSolidityValue(input.creatorSide);
      const rate = validateSeedRate(input.seedRate);
      const deposit = validateDepositBounds(input.creatorStake);

      const manager = createWalletManager("evm", config.seed, evmConfig);
      const account = await manager.getAccount();
      const readOnly = await account.toReadOnlyAccount();

      await ensureUsdcAllowance(readOnly, account, addresses.usdc, addresses.vaultDriver, deposit);

      const data = encodeFunctionData({
        abi: abis.VaultDriver as Abi,
        functionName: "createVault",
        args: [marketIdBytes, input.question, side, rate, deposit]
      });

      let sendResult: { hash: string };
      try {
        sendResult = await account.sendTransaction({
          to: addresses.vaultDriver,
          data,
          value: 0n
        });
      } catch (error) {
        throw classifySendFailure(error);
      }

      await pollUntilUserOperationIncluded(readOnly, sendResult.hash);

      const receipt = await readOnly.getTransactionReceipt(sendResult.hash);
      if (receipt === null || receipt === undefined) {
        throw receiptFailure(`Transaction receipt missing for ${sendResult.hash}`);
      }

      const vaultId = parseVaultCreatedFromLogs(receipt.logs);

      return {
        txId: asTxId(sendResult.hash),
        vaultId
      };
    }
  };
};

// --- helpers ---

type ReadOnlyAccount = {
  readonly getUserOperationReceipt: (hash: string) => Promise<unknown>;
  readonly getTransactionReceipt: (hash: string) => Promise<{ readonly logs: readonly unknown[] } | null>;
  readonly getAllowance: (token: string, spender: string) => Promise<bigint>;
  readonly getAddress: () => Promise<string>;
};

type WritableAccount = {
  readonly sendTransaction: (input: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value: bigint;
  }) => Promise<{ hash: string }>;
  readonly toReadOnlyAccount: () => Promise<ReadOnlyAccount>;
};

const ensureUsdcAllowance = async (
  readOnly: ReadOnlyAccount,
  account: WritableAccount,
  usdc: `0x${string}`,
  spender: `0x${string}`,
  required: bigint
): Promise<void> => {
  const allowance = await readOnly.getAllowance(usdc, spender);

  if (allowance >= required) {
    return;
  }

  const approveData = encodeFunctionData({
    abi: DEFAULT_ABIS.Erc20 as Abi,
    functionName: "approve",
    args: [spender, required]
  });

  let approveResult: { hash: string };
  try {
    approveResult = await account.sendTransaction({
      to: usdc,
      data: approveData,
      value: 0n
    });
  } catch (error) {
    throw classifySendFailure(error);
  }

  await pollUntilUserOperationIncluded(readOnly, approveResult.hash);
};

const pollUntilUserOperationIncluded = async (
  readOnly: ReadOnlyAccount,
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await readOnly.getUserOperationReceipt(userOpHash);

    if (receipt !== null && receipt !== undefined) {
      assertUserOperationSucceeded(receipt);
      return;
    }

    await sleep(delayMs);
  }

  throw receiptFailure(`Timed out waiting for UserOperation receipt for ${userOpHash}`);
};

const assertUserOperationSucceeded = (receipt: unknown): void => {
  if (!isRecord(receipt)) {
    throw receiptFailure("UserOperation receipt payload is not an object");
  }

  const success = readUserOperationSuccess(receipt);
  if (success === undefined) {
    throw receiptFailure("UserOperation receipt is missing success");
  }

  if (success === false) {
    throw receiptFailure("UserOperation included but reverted");
  }
};

const readUserOperationSuccess = (receipt: Record<string, unknown>): boolean | undefined => {
  const direct = receipt["success"];
  if (typeof direct === "boolean") {
    return direct;
  }

  return undefined;
};

const receiptFailure = (message: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message
  });

const classifySendFailure = (error: unknown): LiveStreakRuntimeError => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("paymaster") ||
    lower.includes("sponsor") ||
    lower.includes("validuntil") ||
    lower.includes("validafter")
  ) {
    return new LiveStreakRuntimeError({
      message: `Paymaster-side write failure: ${message}`
    });
  }

  return new LiveStreakRuntimeError({
    message: `UserOperation send failed: ${message}`
  });
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
