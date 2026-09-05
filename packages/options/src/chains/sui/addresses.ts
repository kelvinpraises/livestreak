// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

// 0x + 64 hex chars — Sui object IDs are 32-byte hashes, unlike EVM's 20-byte addresses.
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;

// bytes32 market/vault id — 32 bytes of hex, with or without the 0x prefix.
const SUI_BYTES32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

// OPT.sui-validate: guard market/vault ids before turning them into 32-byte vectors. Mirrors the EVM
// `validateBytes32Id`; without it `parseInt(... || "0")` silently zero-pads malformed/short ids.
export const validateSuiBytes32Id = (value: string, field: string): string => {
  if (!SUI_BYTES32_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid bytes32 id for ${field}`,
      metadata: { details: value }
    });
  }

  return value;
};

export type OptionsSuiObjectIds = {
  readonly packageId: `0x${string}`;
  readonly protocol: `0x${string}`;
  readonly marketRegistry: `0x${string}`;
  readonly vaultRegistry: `0x${string}`;
  readonly stewardRegistry: `0x${string}`;
  readonly treasuryRegistry: `0x${string}`;
  readonly dripsRegistry: `0x${string}`;
  readonly streamsRegistry: `0x${string}`;
  readonly vaultDriverRegistry: `0x${string}`;
  readonly marketDriverRegistry: `0x${string}`;
  readonly driverRegistry: `0x${string}`;
  // lvstTreasuryCap is needed for claim_loss_lvst writes.
  readonly lvstTreasuryCap?: `0x${string}`;
};

export const validateSuiObjectId = (value: string, field: string): `0x${string}` => {
  if (!SUI_OBJECT_ID_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid Sui object ID for ${field}`,
      metadata: { details: value }
    });
  }

  return value as `0x${string}`;
};

export const validateOptionsSuiObjectIds = (
  ids: OptionsSuiObjectIds
): OptionsSuiObjectIds => ({
  packageId: validateSuiObjectId(ids.packageId, "packageId"),
  protocol: validateSuiObjectId(ids.protocol, "protocol"),
  marketRegistry: validateSuiObjectId(ids.marketRegistry, "marketRegistry"),
  vaultRegistry: validateSuiObjectId(ids.vaultRegistry, "vaultRegistry"),
  stewardRegistry: validateSuiObjectId(ids.stewardRegistry, "stewardRegistry"),
  treasuryRegistry: validateSuiObjectId(ids.treasuryRegistry, "treasuryRegistry"),
  dripsRegistry: validateSuiObjectId(ids.dripsRegistry, "dripsRegistry"),
  streamsRegistry: validateSuiObjectId(ids.streamsRegistry, "streamsRegistry"),
  vaultDriverRegistry: validateSuiObjectId(ids.vaultDriverRegistry, "vaultDriverRegistry"),
  marketDriverRegistry: validateSuiObjectId(ids.marketDriverRegistry, "marketDriverRegistry"),
  driverRegistry: validateSuiObjectId(ids.driverRegistry, "driverRegistry"),
  // O2: validate-and-preserve the optional lvstTreasuryCap (the validator used to DROP it, which made
  // claim_loss_lvst always throw "requires lvstTreasuryCap in addresses config").
  ...(ids.lvstTreasuryCap === undefined
    ? {}
    : { lvstTreasuryCap: validateSuiObjectId(ids.lvstTreasuryCap, "lvstTreasuryCap") })
});
