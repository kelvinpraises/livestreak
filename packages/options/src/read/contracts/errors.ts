// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";

export type ContractsReadEntity =
  | "market"
  | "vault"
  | "vault share totals"
  | "owner tokens"
  | "nft"
  | "LVST account"
  | "protocol summary"
  | "claimable"
  | "loss claimable"
  | "pot"
  | "collected"
  | "account vault ids"
  | "winning side"
  | "board"
  | "share price"
  | "pending shares"
  | "USDC address"
  | "NFT balance"
  | "ownerOf"
  | "getApproved"
  | "isApprovedForAll"
  | "stream state";

export const contractsReadNotFound = (
  entity: ContractsReadEntity,
  id: string
): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${entity} not found`,
    metadata: { details: id }
  });

export const contractsReadFailed = (
  entity: ContractsReadEntity,
  cause: unknown
): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `Failed to read ${entity} from contracts`,
    metadata: { cause, retryable: true }
  });
