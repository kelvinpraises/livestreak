// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  createWalletManager,
  isPaymasterSideFailure,
  pollUntilUserOperationIncluded,
  type EvmErc4337WalletConfig
} from "@livestreak/wallet";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  maxUint256,
  zeroAddress,
  type Abi,
  type Log
} from "viem";

import { asTokenId, type TokenId } from "../../model/ids.js";
import { validateOptionsVaultSide } from "../../model/vault.js";
import {
  asTxId,
  type AddFundsInput,
  type AdvanceInput,
  type ApproveNftInput,
  type ClaimLossLvstInput,
  type FundStreamInput,
  type MintNftInput,
  type MintResult,
  type MintWithSaltInput,
  type OptionsChainConfig,
  type OptionsWriter,
  type SetApprovalForAllInput,
  type SetLanesInput,
  type StakeLvstInput,
  type StopAllFundingInput,
  type StopFundingInput,
  type TransferNftInput,
  type TxId,
  type UnstakeLvstInput,
  type WithdrawInput,
  type WithdrawManyInput
} from "../types.js";
import { DEFAULT_ABIS } from "./abis.js";
import { validateOptionsContractAddresses, type OptionsContractAddresses } from "./addresses.js";
import { tupleToObject, type RawLane } from "./decode.js";
import {
  sideToSolidityValue,
  validateMarketIdForContracts,
  validateTokenIdForContracts,
  validateUint64Salt,
  validateUserAddress,
  validateVaultIdForContracts
} from "./encode.js";

type ResolvedAccount = {
  // The signer account (Safe) and its read-only twin used to poll receipts.
  readonly account: {
    getAddress(): Promise<string>;
    sendTransaction(tx: { to: `0x${string}`; data: `0x${string}`; value: bigint }): Promise<{
      hash: string;
    }>;
    toReadOnlyAccount(): Promise<{ getUserOperationReceipt(hash: string): Promise<unknown> }>;
  };
  readonly readOnly: { getUserOperationReceipt(hash: string): Promise<unknown> };
};

export const createEvmOptionsWriter = (config: OptionsChainConfig): OptionsWriter => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM options writer requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const addresses = validateOptionsContractAddresses(config.addresses as OptionsContractAddresses);
  const abis = DEFAULT_ABIS;

  // OPT.rederive: derive the wallet account ONCE per writer (deterministic Safe), reuse across writes.
  let accountPromise: Promise<ResolvedAccount> | undefined;
  const getAccount = (): Promise<ResolvedAccount> => {
    if (accountPromise === undefined) {
      accountPromise = (async () => {
        const manager = createWalletManager("evm", config.seed, evmConfig);
        const account = (await manager.getAccount()) as ResolvedAccount["account"];
        const readOnly = await account.toReadOnlyAccount();
        return { account, readOnly };
      })();
    }
    return accountPromise;
  };

  // Read-only public client for allowance / USDC-address lookups (G4). Lazily constructed.
  const rpcUrl =
    config.readRpcUrl ?? String((config.walletInit.config as { provider?: string }).provider ?? "");
  let publicClient: ReturnType<typeof createPublicClient> | undefined;
  const getPublicClient = () => {
    if (publicClient === undefined) {
      publicClient = createPublicClient({ transport: http(rpcUrl) });
    }
    return publicClient;
  };

  const readContract = async <T>(
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<T> =>
    getPublicClient().readContract({
      address,
      abi: abi as Abi,
      functionName,
      args: args as readonly unknown[] | undefined
    }) as Promise<T>;

  let usdcAddress: `0x${string}` | undefined;
  const getUsdcAddress = async (): Promise<`0x${string}`> => {
    if (usdcAddress === undefined) {
      usdcAddress = await readContract<`0x${string}`>(
        addresses.marketDriver,
        abis.MarketDriver,
        "USDC",
        []
      );
    }
    return usdcAddress;
  };

  // G4: approve the MarketDriver to pull USDC if the current allowance is insufficient. Approves
  // MaxUint256 once (check-then-approve) so subsequent funds need no further approval.
  const ensureUsdcApproval = async (required: bigint): Promise<void> => {
    if (required <= 0n) {
      return;
    }
    const { account } = await getAccount();
    const owner = (await account.getAddress()) as `0x${string}`;
    const usdc = await getUsdcAddress();
    const allowance = await readContract<bigint>(usdc, abis.LvstToken, "allowance", [
      owner,
      addresses.marketDriver
    ]);
    if (allowance >= required) {
      return;
    }
    await send(usdc, abis.LvstToken, "approve", [addresses.marketDriver, maxUint256]);
  };

  // Raw current lanes from MarketDriver bookkeeping (incl. dried ones, which the reader zeroes for display
  // but addFunds re-sends at their original rate to revive). Empty set ⇒ deposit just parks as balance.
  const readCurrentLanes = async (
    tokenId: bigint
  ): Promise<ReadonlyArray<{ vaultId: `0x${string}`; side: number; rate: bigint }>> => {
    const count = await readContract<bigint>(
      addresses.marketDriver,
      abis.MarketDriver,
      "laneCount",
      [tokenId]
    );
    const lanes: Array<{ vaultId: `0x${string}`; side: number; rate: bigint }> = [];
    for (let index = 0n; index < count; index += 1n) {
      const raw = await readContract<unknown>(addresses.marketDriver, abis.MarketDriver, "laneAt", [
        tokenId,
        index
      ]);
      const lane = tupleToObject<RawLane>(raw, ["vaultId", "side", "rate"]);
      lanes.push({ vaultId: lane.vaultId, side: lane.side, rate: lane.rate });
    }
    return lanes;
  };

  const sendForReceipt = async (
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<{ txId: TxId; receipt: unknown }> => {
    const { account, readOnly } = await getAccount();
    const data = encodeFunctionData({
      abi: abi as Abi,
      functionName,
      args: args as readonly unknown[] | undefined
    });

    let sendResult: { hash: string };
    try {
      sendResult = await account.sendTransaction({ to: address, data, value: 0n });
    } catch (error) {
      throw classifySendFailure(error);
    }

    // Shared, canonical poller (≥60s + backoff, success accepts boolean|hex|number); returns the receipt.
    const receipt = await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
    return { txId: asTxId(sendResult.hash), receipt };
  };

  const send = async (
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = []
  ): Promise<TxId> => {
    const { txId } = await sendForReceipt(address, abi, functionName, args);
    return txId;
  };

  const decodeMintedTokenId = (receipt: unknown): TokenId => {
    for (const log of extractLogs(receipt)) {
      try {
        const decoded = decodeEventLog({
          abi: abis.MarketDriver as Abi,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "MarketNftMinted") {
          const tokenId = (decoded.args as { tokenId?: bigint }).tokenId;
          if (typeof tokenId === "bigint") {
            return asTokenId(tokenId);
          }
        }
      } catch {
        // Not a MarketDriver event (or not decodable with this ABI) — skip.
      }
    }

    throw new LiveStreakRuntimeError({
      message: "Mint receipt did not contain a decodable MarketNftMinted event"
    });
  };

  return {
    mint: async (input: MintNftInput): Promise<MintResult> => {
      const marketBytes = validateMarketIdForContracts(input.marketId);
      const to = validateUserAddress(input.to, "to");

      const { txId, receipt } = await sendForReceipt(
        addresses.marketDriver,
        abis.MarketDriver,
        "mint",
        [marketBytes, to as `0x${string}`]
      );
      return { txId, tokenId: decodeMintedTokenId(receipt) };
    },

    mintWithSalt: async (input: MintWithSaltInput): Promise<MintResult> => {
      const marketBytes = validateMarketIdForContracts(input.marketId);
      const salt = validateUint64Salt(input.salt, "salt");
      const to = validateUserAddress(input.to, "to");

      const { txId, receipt } = await sendForReceipt(
        addresses.marketDriver,
        abis.MarketDriver,
        "mintWithSalt",
        [marketBytes, salt, to as `0x${string}`]
      );
      return { txId, tokenId: decodeMintedTokenId(receipt) };
    },

    fund: async (input: FundStreamInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const side = sideToSolidityValue(validateOptionsVaultSide(input.side));
      const rate = requirePositiveBigInt(input.rate, "rate");
      const deposit = requirePositiveBigInt(input.deposit, "deposit");

      await ensureUsdcApproval(deposit);

      return send(addresses.marketDriver, abis.MarketDriver, "fund", [
        tokenId,
        vaultBytes,
        side,
        rate,
        deposit
      ]);
    },

    advance: async (input: AdvanceInput) => {
      const vaultBytes = validateVaultIdForContracts(input.vaultId);
      const side = sideToSolidityValue(validateOptionsVaultSide(input.side));

      return send(addresses.vault, abis.Vault, "advance", [
        vaultBytes,
        side,
        input.maxSteps ?? 0n
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

      await ensureUsdcApproval(addDeposit);

      return send(addresses.marketDriver, abis.MarketDriver, "setLanes", [
        tokenId,
        lanes,
        addDeposit
      ]);
    },

    addFunds: async (input: AddFundsInput) => {
      const tokenId = validateTokenIdForContracts(input.tokenId);
      const deposit = requirePositiveBigInt(input.deposit, "deposit");

      await ensureUsdcApproval(deposit);

      const lanes = await readCurrentLanes(tokenId);
      return send(addresses.marketDriver, abis.MarketDriver, "setLanes", [tokenId, lanes, deposit]);
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
      // Owner by default (zero ⇒ owner in `_payee`); only the owner may redirect the swept refund.
      const to = input.to ? validateUserAddress(input.to, "to") : zeroAddress;
      return send(addresses.marketDriver, abis.MarketDriver, "stopAll", [tokenId, to]);
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

const extractLogs = (receipt: unknown): readonly Log[] => {
  if (!isRecord(receipt)) {
    return [];
  }
  if (Array.isArray(receipt["logs"])) {
    return receipt["logs"] as Log[];
  }
  const inner = receipt["receipt"];
  if (isRecord(inner) && Array.isArray(inner["logs"])) {
    return inner["logs"] as Log[];
  }
  return [];
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
