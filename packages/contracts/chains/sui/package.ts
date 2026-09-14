export const MODULES = {
  protocol: "protocol",
  marketRegistry: "market_registry",
  vault: "vault",
  stewardRegistry: "steward_registry",
  treasury: "treasury",
  drips: "drips",
  streams: "streams",
  vaultDriver: "vault_driver",
  marketDriver: "market_driver",
  driverRegistry: "driver_registry",
  mockUsdc: "mock_usdc",
  lvst: "lvst",
  resolutionReads: "resolution_reads",
  bootstrap: "bootstrap",
} as const;

export type LiveStreakModule = (typeof MODULES)[keyof typeof MODULES];

export function target(packageId: string, module: LiveStreakModule, fn: string): `${string}::${string}::${string}` {
  return `${packageId}::${module}::${fn}`;
}

// bytes32 market/vault id — 32 bytes of hex, with or without the 0x prefix.
const SUI_BYTES32_RE = /^(0x)?[0-9a-fA-F]{64}$/;

export function isSuiBytes32Id(value: string): boolean {
  return SUI_BYTES32_RE.test(value);
}

// Canonical raw 32-byte array for a hex market/vault id. Callers pre-validate with isSuiBytes32Id to
// raise their own typed config errors; the throw here is a backstop (a malformed/short id used to
// silently zero-pad via parseInt).
export function suiBytes32IdBytes(value: string): number[] {
  if (!isSuiBytes32Id(value)) {
    throw new Error(`Invalid bytes32 id: ${value}`);
  }
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}
