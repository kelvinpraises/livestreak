// --- exports ---

import { LiveStreakRuntimeError } from "@livestreak/core";
import { parseEventLogs, type Abi, type Log } from "viem";

import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";

import { asVaultId, type VaultId } from "../types.js";

export const parseVaultCreatedFromLogs = (logs: readonly unknown[]): VaultId => {
  const decoded = parseEventLogs({
    abi: vaultDriverAbi as Abi,
    logs: logs as Log[],
    eventName: "VaultCreated"
  });

  const event = decoded[0] as { readonly args: { readonly vaultId: string } } | undefined;
  if (event === undefined) {
    throw new LiveStreakRuntimeError({
      message: "VaultCreated event not found in transaction receipt logs"
    });
  }

  const vaultId = event.args.vaultId;

  return asVaultId(vaultId);
};
