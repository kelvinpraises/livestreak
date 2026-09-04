// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";
import { encodeFunctionData, type Abi } from "viem";

import { validateOptionsVaultSide } from "../../model/vault.js";
import {
  asTxId,
  type ApproveNftInput,
  type ClaimLossLvstInput,
  type FundStreamInput,
  type MintNftInput,
  type OptionsChainConfig,
  type OptionsWriter,
  type SetApprovalForAllInput,
  type SetLanesInput,
  type StakeLvstInput,
  type StopAllFundingInput,
  type StopFundingInput,
  type TransferNftInput,
  type UnstakeLvstInput,
  type WithdrawInput,
  type WithdrawManyInput
} from "../types.js";
import { DEFAULT_ABIS } from "./abis.js";
import { validateOptionsContractAddresses } from "./addresses.js";
import {
  sideToSolidityValue,
  validateMarketIdForContracts,
  validateTokenIdForContracts,
  validateUserAddress,
  validateVaultIdForContracts
} from "./encode.js";

export const createEvmOptionsWriter = (config: OptionsChainConfig): OptionsWriter => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM options writer requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const addresses = validateOptionsContractAddresses(config.addresses);
  const abis = DEFAULT_ABIS;

  const send = async (
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ) => {
    const manager = createWalletManager("evm", config.seed, evmConfig);
    const account = await manager.getAccount();
    const data = encodeFunctionData({
      abi: abi as Abi,
      functionName,
      args: args as readonly unknown[] | undefined
    });

    let sendResult: { hash: string };
    try {
      sendResult = await account.sendTransaction({
        to: address,
        data,
        value: 0n
      });
    } catch (error) {
      throw classifySendFailure(error);
    }

    const readOnly = await account.toReadOnlyAccount();
    await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
    return asTxId(sendResult.hash);
  };

  return {
    mint: async (input: MintNftInput) => {
      const marketBytes = validateMarketIdForContracts(input.marketId);
      const to = validateUserAddress(input.to, "to");

      return send(addresses.marketDriver, abis.MarketDriver, "mint", [
        marketBytes,
        to as `0x${string}`
      ]);
    },

    fund: async (input: FundStreamInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
      const rate = requirePositiveBigInt(input.rate, "rate");
      const deposit = requirePositiveBigInt(input.deposit, "deposit");

      return send(addresses.marketDriver, abis.MarketDriver, "fund", [
        tokenId,
        vaultBytes,
        side,
        rate,
        deposit
      ]);
    },

    setLanes: async (input: SetLanesInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const addDeposit = requireNonNegativeBigInt(input.addDeposit, "addDeposit");
      const lanes = input.lanes.map((lane) => ({
        vaultId: validateVaultIdForContracts(lane.vaultId),
        side: sideToSolidityValue(validateOptionsVaultSide(lane.side)),
        rate: requirePositiveBigInt(lane.rate, "rate")
      }));

      return send(addresses.marketDriver, abis.MarketDriver, "setLanes", [
        tokenId,
        lanes,
        addDeposit
      ]);
    },

    stopFunding: async (input: StopFundingInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const side = sideToSolidityValue(validateOptionsVaultSide(input.side));

      return send(addresses.marketDriver, abis.MarketDriver, "stop", [
        tokenId,
        vaultBytes,
        side
      ]);
    },

    stopAllFunding: async (input: StopAllFundingInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      return send(addresses.marketDriver, abis.MarketDriver, "stopAll", [tokenId]);
    },

    withdraw: async (input: WithdrawInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const to = validateUserAddress(input.to, "to");

      return send(addresses.marketDriver, abis.MarketDriver, "withdraw", [
        tokenId,
        vaultBytes,
        to as `0x${string}`
      ]);
    },

    withdrawMany: async (input: WithdrawManyInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const to = validateUserAddress(input.to, "to");
      const vaultIds = input.vaultIds.map((vaultId) => validateVaultIdForContracts(vaultId));

      return send(addresses.marketDriver, abis.MarketDriver, "withdraw", [
        tokenId,
        vaultIds,
        to as `0x${string}`
      ]);
    },

    claimLossLvst: async (input: ClaimLossLvstInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
      const to = validateUserAddress(input.to, "to");

      return send(addresses.marketDriver, abis.MarketDriver, "claimLossLvst", [
        tokenId,
        vaultBytes,
        side,
        to as `0x${string}`
      ]);
    },

    stakeLvst: async (input: StakeLvstInput) => {
      const amount = requirePositiveBigInt(input.amount, "amount");
      return send(addresses.treasury, abis.Treasury, "stakeLvst", [amount]);
    },

    unstakeLvst: async (input: UnstakeLvstInput) => {
      const amount = requirePositiveBigInt(input.amount, "amount");
      return send(addresses.treasury, abis.Treasury, "unstakeLvst", [amount]);
    },

    claimDividends: async () => send(addresses.treasury, abis.Treasury, "claimDividends", []),

    transferNft: async (input: TransferNftInput) => {
      const from = validateUserAddress(input.from, "from");
      const to = validateUserAddress(input.to, "to");
      const tokenId = validateTokenIdForContracts(input.tokenId);

      return send(addresses.marketDriver, abis.MarketDriver, "transferFrom", [
        from as `0x${string}`,
        to as `0x${string}`,
        tokenId
      ]);
    },

    approveNft: async (input: ApproveNftInput) => {
      const operator = validateUserAddress(input.operator, "operator");
      const tokenId = validateTokenIdForContracts(input.tokenId);

      return send(addresses.marketDriver, abis.MarketDriver, "approve", [
        operator as `0x${string}`,
        tokenId
      ]);
    },

    setApprovalForAll: async (input: SetApprovalForAllInput) => {
      const operator = validateUserAddress(input.operator, "operator");

      return send(addresses.marketDriver, abis.MarketDriver, "setApprovalForAll", [
        operator as `0x${string}`,
        input.approved
      ]);
    }
  };
};

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};

const requireNonNegativeBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint >= 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};

const pollUntilUserOperationIncluded = async (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
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
