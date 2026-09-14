// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  createWalletManager,
  pollUntilUserOperationIncluded,
  type EvmErc4337WalletConfig
} from "@livestreak/wallet";
import { encodeFunctionData, type Abi } from "viem";
import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { validateStewardEvmAddresses, type StewardChainConfig } from "./types.js";

export const createEvmStewardExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({ message: "EVM steward executor requires walletInit.chain === evm" });
  }
  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const addresses = validateStewardEvmAddresses(config.addresses);

  // OPT.rederive: derive the wallet account ONCE per executor (deterministic Safe), reuse across calls.
  const deriveAccount = async () => {
    const manager = createWalletManager("evm", config.seed, evmConfig);
    const account = await manager.getAccount();
    const readOnly = await account.toReadOnlyAccount();
    return { account, readOnly };
  };
  let accountPromise: ReturnType<typeof deriveAccount> | undefined;
  const getAccount = () => (accountPromise ??= deriveAccount());

  return {
    chain: "evm",
    executeContractCall: async (call: StewardContractCall): Promise<{ readonly txId: string }> => {
      // Resolve is the demo-critical governance write. Other StewardContractCall kinds (triggerHot,
      // proposePenalty, veto, challenge…) have no settled on-chain target yet — surface them clearly
      // rather than silently no-op.
      if (call.contract !== "vault" || call.functionName !== "resolve") {
        throw new LiveStreakConfigError({
          message: `Steward EVM executor does not support ${call.contract}.${call.functionName} yet`
        });
      }
      const [vaultId, outcome] = call.args;
      const data = encodeFunctionData({
        abi: stewardRegistryAbi as Abi,
        functionName: "resolveVault",
        args: [vaultId as `0x${string}`, outcome]
      });

      const { account, readOnly } = await getAccount();

      let sendResult: { hash: string };
      try {
        sendResult = await account.sendTransaction({
          to: addresses.stewardRegistry as `0x${string}`,
          data,
          value: 0n
        });
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Steward resolveVault send failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }

      // The shared poller returns the included receipt and THROWS on revert/missing-success, so a
      // post-poll re-fetch would be dead code (the false branch is unreachable; a missing receipt
      // passed silently). Trust the poller.
      await pollUntilUserOperationIncluded(readOnly, sendResult.hash, { timeoutMs: 60_000 });
      return { txId: sendResult.hash };
    }
  };
};
