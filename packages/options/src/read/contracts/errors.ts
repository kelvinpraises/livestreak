// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";

export type ContractsReadEntity =
  | "market"
  | "vault"
  | "user position"
  | "funding stream"
  | "LVST account"
  | "protocol summary";

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
