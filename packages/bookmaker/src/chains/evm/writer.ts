// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  assertUserOperationSucceeded as assertUserOperationSucceededShared,
  createWalletManager,
  isPaymasterSideFailure,
  pollUntilUserOperationIncluded as pollUntilUserOperationIncludedShared,
  UserOperationPollTimeoutError,
  type EvmErc4337WalletConfig
} from "@livestreak/wallet";
import { encodeFunctionData, type Abi } from "viem";

import { receiptTimeoutError } from "./create-vault-recovery.js";
import type {
  BookmakerChainConfig,
  BookmakerChainWriter,
  CreateVaultInput,
  CreateVaultResult,
  TxId
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

  // OPT.rederive: derive the wallet account ONCE per writer (deterministic Safe), reuse across writes.
  let accountPromise: Promise<{ account: WritableAccount; readOnly: ReadOnlyAccount }> | undefined;
  const getAccount = (): Promise<{ account: WritableAccount; readOnly: ReadOnlyAccount }> => {
    if (accountPromise === undefined) {
      accountPromise = (async () => {
        const manager = createWalletManager("evm", config.seed, evmConfig);
        const account: WritableAccount = await manager.getAccount();
        const readOnly = await account.toReadOnlyAccount();
        return { account, readOnly };
      })();
    }
    return accountPromise;
  };

  return {
    createVault: async (input: CreateVaultInput) => {
      const marketIdBytes = validateMarketIdForContracts(input.marketId);
      const side = sideToSolidityValue(input.creatorSide);
      const rate = validateSeedRate(input.seedRate);
      const deposit = validateDepositBounds(input.creatorStake);

      const { account, readOnly } = await getAccount();

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

      // The poller already fetched + asserted the userOp receipt; pass it through so the resolve step
      // parses the vault log from the SAME receipt instead of re-fetching it.
      const userOpReceipt = await pollUntilUserOperationIncluded(readOnly, sendResult.hash);

      const resolved = await resolveCreateVaultFromUserOp(readOnly, sendResult.hash, userOpReceipt);
      if (resolved === undefined) {
        throw receiptFailure(`Transaction receipt missing for ${sendResult.hash}`);
      }

      return resolved;
    },

    confirmCreateVault: async (userOpHash: TxId) => {
      const { readOnly } = await getAccount();
      return resolveCreateVaultFromUserOp(readOnly, userOpHash);
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

// `polledReceipt` is the userOp receipt already fetched + success-asserted by the poller (createVault
// path). When omitted (confirmCreateVault's independent recovery) we fetch + assert it ourselves.
const resolveCreateVaultFromUserOp = async (
  readOnly: ReadOnlyAccount,
  userOpHash: string,
  polledReceipt?: unknown
): Promise<CreateVaultResult | undefined> => {
  const userOpReceipt =
    polledReceipt !== undefined ? polledReceipt : await readOnly.getUserOperationReceipt(userOpHash);

  if (userOpReceipt === null || userOpReceipt === undefined) {
    return undefined;
  }

  assertUserOperationSucceeded(userOpReceipt);

  const receipt = await readOnly.getTransactionReceipt(userOpHash);
  if (receipt === null || receipt === undefined) {
    return undefined;
  }

  const vaultId = parseVaultCreatedFromLogs(receipt.logs);

  return {
    txId: asTxId(userOpHash),
    vaultId
  };
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

// B3/B4: delegate inclusion polling + success reading to the single shared
// helper (`@livestreak/wallet`): ≥60s budget with backoff (the old 40×50ms=2s
// timed out on real bundlers) and success read as boolean|hex|number|string.
// The shared poller throws a plain Error; we re-map its TIMEOUT to the
// `receiptTimeoutError` shape so the pending-recovery path
// (`readReceiptTimeoutUserOpHash` → markPending) still fires, and any other
// failure (revert/missing-success) to the local `receiptFailure` runtime error.
const pollUntilUserOperationIncluded = async (
  readOnly: ReadOnlyAccount,
  userOpHash: string
): Promise<unknown> => {
  try {
    return await pollUntilUserOperationIncludedShared(readOnly, userOpHash, { timeoutMs: 60_000 });
  } catch (error) {
    if (error instanceof UserOperationPollTimeoutError) {
      throw receiptTimeoutError(userOpHash);
    }
    throw receiptFailure(error instanceof Error ? error.message : String(error));
  }
};

// Delegate to the canonical wallet assert (handles boolean|hex|number|string success), re-wrapping its
// plain Error as our LiveStreakRuntimeError so callers keep the bookmaker error type.
const assertUserOperationSucceeded = (receipt: unknown): void => {
  try {
    assertUserOperationSucceededShared(receipt);
  } catch (error) {
    throw receiptFailure(error instanceof Error ? error.message : String(error));
  }
};

const receiptFailure = (message: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message
  });

const classifySendFailure = (error: unknown): LiveStreakRuntimeError => {
  const message = error instanceof Error ? error.message : String(error);

  if (isPaymasterSideFailure(error)) {
    return new LiveStreakRuntimeError({
      message: `Paymaster-side write failure: ${message}`
    });
  }

  return new LiveStreakRuntimeError({
    message: `UserOperation send failed: ${message}`
  });
};
