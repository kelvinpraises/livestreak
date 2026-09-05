export type SuiDeploymentName = "localnet" | "testnet" | "mainnet";

export type SuiObjectIds = {
  packageId: string;
  protocol: string;
  marketRegistry: string;
  vaultRegistry: string;
  stewardRegistry: string;
  treasuryRegistry: string;
  dripsRegistry: string;
  streamsRegistry: string;
  vaultDriverRegistry: string;
  marketDriverRegistry: string;
  driverRegistry: string;
  lvstTreasuryCap: string;
  usdcMintCap: string;
};

export type SuiDeployment = {
  chain: SuiDeploymentName;
  rpc: string;
  deployedAt: string;
  deployer: string;
  packageId: string;
  objects: SuiObjectIds;
};

export type SuiDeployOutput = {
  chain: SuiDeploymentName;
  rpc: string;
  deployedAt: string;
  deployer: string;
  packageId: string;
  objects: Partial<SuiObjectIds>;
  status: "completed" | "failed";
  error?: string;
};

export const SUI_CLOCK_OBJECT_ID = "0x6";

export const SIDE_YES = 0;
export const SIDE_NO = 1;
export const OUTCOME_YES = 1;
export const OUTCOME_NO = 2;

export const RATE = 1_000_000n;
export const USDC_ONE = 1_000_000n;
export const CYCLE_SECS = 10;
