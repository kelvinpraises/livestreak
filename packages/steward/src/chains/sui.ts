// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build PTBs VIA @livestreak/wallet (the single @mysten/sui v2 owner).
import { Transaction, bcs, createWalletManager, type SuiWalletConfig } from "@livestreak/wallet";
import { target } from "@livestreak/contracts/sui";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { validateStewardSuiObjectIds, type StewardChainConfig } from "./types.js";

const SUI_CLOCK_OBJECT_ID = "0x6";
const SUI_BYTES32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

const vaultIdBytes = (id: string): Uint8Array => {
  if (!SUI_BYTES32_RE.test(id)) {
    throw new LiveStreakConfigError({
      message: "Steward Sui resolve requires a bytes32 vaultId",
      metadata: { details: id }
    });
  }
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  const bytes = Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return bcs.vector(bcs.u8()).serialize(bytes).toBytes();
};

export const createSuiStewardExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({ message: "Sui steward executor requires walletInit.chain === sui" });
  }
  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const ids = validateStewardSuiObjectIds(config.addresses);
  // The VaultRegistry<T> type parameter is the USDC coin type.
  const coinType = `${ids.packageId}::mock_usdc::MOCK_USDC`;

  return {
    chain: "sui",
    executeContractCall: async (call: StewardContractCall): Promise<{ readonly txId: string }> => {
      if (call.contract !== "vault" || call.functionName !== "resolve") {
        throw new LiveStreakConfigError({
          message: `Steward Sui executor does not support ${call.contract}.${call.functionName} yet`
        });
      }
      const [vaultId, outcome] = call.args;

      const tx = new Transaction();
      tx.moveCall({
        target: target(ids.packageId, "steward_registry", "resolve_vault"),
        typeArguments: [coinType],
        arguments: [
          tx.object(ids.stewardRegistry),
          tx.object(ids.vaultRegistry),
          tx.pure(vaultIdBytes(vaultId)),
          tx.pure.u8(outcome),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      });

      const manager = createWalletManager("sui", config.seed, suiConfig);
      const account = (await manager.getAccount()) as {
        sendTransaction(tx: Transaction): Promise<{ hash: string }>;
      };
      tx.setGasBudgetIfNotSet(100_000_000);
      try {
        const result = await account.sendTransaction(tx);
        return { txId: result.hash };
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Steward Sui resolve_vault failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
  };
};
