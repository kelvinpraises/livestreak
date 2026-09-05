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
