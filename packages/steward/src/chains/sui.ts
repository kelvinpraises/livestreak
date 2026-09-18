// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build PTBs VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import { Transaction, bcs, createWalletManager, type SuiWalletConfig } from "@livestreak/wallet";
import { isSuiBytes32Id, suiBytes32IdBytes, target } from "@livestreak/contracts/sui";
import { keccak256, stringToHex } from "viem";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import {
  severityToContractValue,
  validateStewardSuiObjectIds,
  type StewardChainConfig
} from "./types.js";

const SUI_CLOCK_OBJECT_ID = "0x6";

// Canonical bytes32 handling lives in @livestreak/contracts/sui; steward only adds its typed error.
const bytes32Bcs = (id: string, label: string): Uint8Array => {
  if (!isSuiBytes32Id(id)) {
    throw new LiveStreakConfigError({
      message: `Steward Sui executor requires a bytes32 ${label}`,
      metadata: { details: id }
    });
  }
  return bcs.vector(bcs.u8()).serialize(suiBytes32IdBytes(id)).toBytes();
};

export const createSuiStewardExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({ message: "Sui steward executor requires walletInit.chain === sui" });
  }
  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const ids = validateStewardSuiObjectIds(config.addresses);
  // The VaultRegistry<T> type parameter is the USDC coin type.
  const coinType = `${ids.packageId}::mock_usdc::MOCK_USDC`;

  // OPT.rederive: derive the wallet account ONCE per executor (deterministic), reuse across calls.
  let accountPromise:
    | Promise<{ sendTransaction(tx: Transaction): Promise<{ hash: string }> }>
    | undefined;
  const getAccount = () =>
    (accountPromise ??= createWalletManager("sui", config.seed, suiConfig).getAccount() as Promise<{
      sendTransaction(tx: Transaction): Promise<{ hash: string }>;
    }>);

  return {
    chain: "sui",
    executeContractCall: async (call: StewardContractCall): Promise<{ readonly txId: string }> => {
      const tx = new Transaction();

      if (call.contract === "vault" && call.functionName === "resolve") {
        const [vaultId, outcome] = call.args;
        tx.moveCall({
          target: target(ids.packageId, "steward_registry", "resolve_vault"),
          typeArguments: [coinType],
          arguments: [
            tx.object(ids.stewardRegistry),
            tx.object(ids.vaultRegistry),
            tx.pure(bytes32Bcs(vaultId, "vaultId")),
            tx.pure.u8(outcome),
            tx.object(SUI_CLOCK_OBJECT_ID)
          ]
        });
      } else if (call.contract === "vault" && call.functionName === "triggerHot") {
        const [vaultId, reason, severity] = call.args;
        // until = 0: no scheduled end — hot is governed by `active`, cleared via end_hot.
        // reason_hash mirrors EVM: keccak256 over the utf8 reason bytes.
        tx.moveCall({
          target: target(ids.packageId, "steward_registry", "trigger_hot"),
          typeArguments: [coinType],
          arguments: [
            tx.object(ids.stewardRegistry),
            tx.object(ids.vaultRegistry),
            tx.pure(bytes32Bcs(vaultId, "vaultId")),
            tx.pure.u8(severityToContractValue(severity)),
            tx.pure.u64(0n),
            tx.pure(bytes32Bcs(keccak256(stringToHex(reason)), "reasonHash"))
          ]
        });
      } else {
        throw new LiveStreakConfigError({
          message: `Steward Sui executor does not support ${call.contract}.${call.functionName} yet`
        });
      }

      const account = await getAccount();
      tx.setGasBudgetIfNotSet(100_000_000);
      try {
        const result = await account.sendTransaction(tx);
        return { txId: result.hash };
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Steward Sui ${call.functionName} failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
  };
};
