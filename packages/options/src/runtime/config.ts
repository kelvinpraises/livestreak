// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { asMarketId, asUserAddress, type MarketId, type UserAddress } from "../model/ids.js";
import type { OptionsChain, OptionsChainConfig } from "../chains/types.js";
import type { OptionsPausedLane } from "../bridge/panel/project.js";

export interface OptionsRuntimeConfig {
  readonly runtimeId: string;
  readonly user?: UserAddress;
  readonly marketIds?: readonly MarketId[];
  readonly defaultMarketId?: MarketId;
  readonly refreshIntervalMs?: number;
}

/** Persistence port for the paused-lane registry the runtime owns. The runtime holds the lanes in memory
 *  (surviving the poll); the host app wires `initial`/`onChange` to sessionStorage so they survive a reload.
 *  Pause is session intent the chain can't express, so this is its canonical home — not the UI. */
export interface PausedLanesPort {
  readonly initial?: readonly OptionsPausedLane[];
  readonly onChange?: (lanes: readonly OptionsPausedLane[]) => void;
}

export interface OptionsRuntimeInput {
  readonly config: unknown;
  readonly chainConfig: OptionsChainConfig;
  readonly chain?: OptionsChain;
  readonly pausedLanes?: PausedLanesPort;
}

export const validateOptionsRuntimeConfig = (input: unknown): OptionsRuntimeConfig => {
  if (!isPlainObject(input)) {
    throw new LiveStreakConfigError({
      message: "Options runtime config must be a plain object",
      metadata: { details: describeValue(input) }
    });
  }

  const runtimeId = requireNonEmptyString(input.runtimeId, "runtimeId");
  const refreshIntervalMs = readOptionalPositiveFiniteNumber(input.refreshIntervalMs, "refreshIntervalMs");
  const user = readOptionalNonEmptyString(input.user, "user", asUserAddress);
  const marketIds = readOptionalStringArray(input.marketIds, "marketIds", asMarketId);
  const defaultMarketId = readOptionalNonEmptyString(input.defaultMarketId, "defaultMarketId", asMarketId);

  if (defaultMarketId !== undefined && marketIds !== undefined && !marketIds.includes(defaultMarketId)) {
    throw new LiveStreakConfigError({
      message: "defaultMarketId must be included in marketIds",
      metadata: { details: defaultMarketId }
    });
  }

  return {
    runtimeId,
    ...(user === undefined ? {} : { user }),
    ...(marketIds === undefined ? {} : { marketIds }),
    ...(defaultMarketId === undefined ? {} : { defaultMarketId }),
    ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs })
  };
};

// --- helpers ---

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const describeValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
};

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new LiveStreakConfigError({
      message: `Options runtime config requires ${field} to be a non-empty string`,
      metadata: { details: describeValue(value) }
    });
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new LiveStreakConfigError({
      message: `Options runtime config requires a non-empty ${field}`,
      metadata: { details: value }
    });
  }

  return trimmed;
};

const readOptionalNonEmptyString = <T extends string>(
  value: unknown,
  field: string,
  cast: (value: string) => T
): T | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return cast(requireNonEmptyString(value, field));
};

const readOptionalStringArray = <T extends string>(
  value: unknown,
  field: string,
  cast: (value: string) => T
): readonly T[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new LiveStreakConfigError({
      message: `Options runtime config requires ${field} to be an array of strings`,
      metadata: { details: describeValue(value) }
    });
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new LiveStreakConfigError({
        message: `Options runtime config requires ${field}[${index}] to be a non-empty string`,
        metadata: { details: describeValue(entry) }
      });
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new LiveStreakConfigError({
        message: `Options runtime config requires a non-empty ${field} entry`,
        metadata: { details: entry }
      });
    }

    return cast(trimmed);
  });
};

const readOptionalPositiveFiniteNumber = (
  value: unknown,
  field: string
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LiveStreakConfigError({
      message: `Options runtime ${field} must be a positive finite number`,
      metadata: { details: String(value) }
    });
  }

  return value;
};
