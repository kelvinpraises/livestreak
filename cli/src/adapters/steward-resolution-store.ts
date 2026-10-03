import { createHash } from "node:crypto";
import {
  stateFilePath,
  readStateFile,
  writeStateFile,
} from "../gateway/state/file-store.js";
import type { ResolutionAttempt } from "@livestreak/steward";
export const createStewardResolutionStore = (chainId: string, stewardId: string) => {
  const path = (vaultId: string) =>
    stateFilePath(
      `resolution-${createHash("sha256")
        .update(JSON.stringify([chainId, stewardId, vaultId]))
        .digest("hex")}.json`,
    );
  return {
    load: async (vaultId: string) => {
      const value = await readStateFile<ResolutionAttempt>(path(vaultId));
      if (!value) return null;
      if (
        value.vaultId !== vaultId ||
        !/^0x[0-9a-f]{64}$/.test(value.recordDigest) ||
        !["yes", "no"].includes(value.outcome) ||
        !["prepared", "unknown", "confirmed"].includes(value.status) ||
        (value.txId !== undefined && (typeof value.txId !== "string" || !value.txId))
      )
        throw new Error("Corrupted resolution recovery journal");
      return value;
    },
    save: async (attempt: ResolutionAttempt) =>
      writeStateFile(path(attempt.vaultId), attempt),
  };
};
