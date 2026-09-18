// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import {
  createWalletManager,
  pollUntilUserOperationIncluded,
  type EvmErc4337WalletConfig
} from "@livestreak/wallet";
import { encodeFunctionData, keccak256, stringToHex, type Abi } from "viem";
import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import {
  severityToContractValue,
  validateStewardEvmAddresses,
  type StewardChainConfig
} from "./types.js";

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
      // resolve + triggerHot have on-chain StewardRegistry targets. The remaining kinds
      // (proposePenalty, veto, challenge…) have no settled on-chain target yet — surface
      // them clearly rather than silently no-op.
      const data = encodeStewardCall(call);

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
          message: `Steward ${call.functionName} send failed: ${error instanceof Error ? error.message : String(error)}`
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

// --- helpers ---

const encodeStewardCall = (call: StewardContractCall): `0x${string}` => {
  if (call.contract === "vault" && call.functionName === "resolve") {
    const [vaultId, outcome] = call.args;
    return encodeFunctionData({
      abi: stewardRegistryAbi as Abi,
      functionName: "resolveVault",
      args: [vaultId as `0x${string}`, outcome]
    });
  }

  if (call.contract === "vault" && call.functionName === "triggerHot") {
    const [vaultId, reason, severity] = call.args;
    // until = 0: no scheduled end — the hot flag is governed by `active` and cleared via endHot.
    return encodeFunctionData({
      abi: stewardRegistryAbi as Abi,
      functionName: "triggerHot",
      args: [vaultId as `0x${string}`, severityToContractValue(severity), 0n, keccak256(stringToHex(reason))]
    });
  }

  throw new LiveStreakConfigError({
    message: `Steward EVM executor does not support ${call.contract}.${call.functionName} yet`
  });
};
