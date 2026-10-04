import {
  readDeploymentOutputFromPath
} from "@livestreak/contracts/evm/node";

// --- exports ---

// The AA facts an EVM deploy snapshot can supply. Env is READ-ONLY INPUT: the loader NEVER mutates
// process.env — it returns a plain partial-config object that the AA config assembly merges with
// precedence ENV > snapshot > defaults.
export interface DeploySnapshotConfig {
  readonly chainId?: number;
  readonly rpcUrl?: string;
  readonly entryPoint?: string;
  readonly safeModule?: string;
}

// Resolve + load the deploy snapshot for the AA config assembly, degrading to an empty object (so
// the operator can still supply AA env manually) when the snapshot is absent/unparseable — mirrors
// the previous main.ts try/catch, but without mutating process.env. Honors LIVESTREAK_AA_FROM_DEPLOY=0.
export const loadDefaultDeploySnapshotConfig = (): DeploySnapshotConfig => {
  if (process.env.LIVESTREAK_AA_FROM_DEPLOY === "0" || !process.env.LIVESTREAK_DEPLOY_SNAPSHOT) {
    return {};
  }
  const snapshotPath = process.env.LIVESTREAK_DEPLOY_SNAPSHOT;
  try {
    const loaded = loadDeploySnapshotConfig(snapshotPath);
    console.log(`[host]: AA config from deploy snapshot ${snapshotPath}`);
    return loaded;
  } catch (error) {
    console.warn(`[host]: deploy snapshot not loaded (${String(error)}) — set AA env manually`);
    return {};
  }
};

// Load the AA-relevant fields from a deploy snapshot on disk. Parses through the single contracts
// EVM parser (readDeploymentOutputFromPath) so host never hand-rolls its own JSON.parse.
export const loadDeploySnapshotConfig = (snapshotPath: string): DeploySnapshotConfig => {
  const snapshot = readDeploymentOutputFromPath(snapshotPath);
  const chainId = parseChainId(snapshot.chainId);
  const aa = snapshot.scopes?.aa?.contracts;

  return {
    ...(chainId === undefined ? {} : { chainId }),
    ...(nonEmpty(snapshot.rpc) ? { rpcUrl: snapshot.rpc } : {}),
    ...(nonEmpty(aa?.entryPoint) ? { entryPoint: aa?.entryPoint } : {}),
    ...(nonEmpty(aa?.safe4337Module) ? { safeModule: aa?.safe4337Module } : {})
  };
};

// --- helpers ---

const nonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

const parseChainId = (value: number | string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
