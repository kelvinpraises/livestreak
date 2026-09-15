import {
  localhostDeploymentPath,
  readDeploymentOutputFromPath
} from "@livestreak/contracts/evm/node";

// --- exports ---

// THE single default EVM deploy-snapshot path (the committed contracts localhost.json). Both the AA
// config assembly and the catalog readers resolve their default through here so there is one source
// of truth for "where the localhost deployment lives".
export const DEFAULT_DEPLOY_SNAPSHOT = localhostDeploymentPath();

// Resolve the snapshot path: an explicit override wins, else the committed localhost snapshot.
export const resolveDeploySnapshotPath = (): string =>
  process.env.LIVESTREAK_DEPLOY_SNAPSHOT ?? DEFAULT_DEPLOY_SNAPSHOT;

// The AA facts an EVM deploy snapshot can supply. Env is READ-ONLY INPUT: the loader NEVER mutates
// process.env — it returns a plain partial-config object that the AA config assembly merges with
// precedence ENV > snapshot > defaults.
export interface DeploySnapshotConfig {
  readonly chainId?: number;
  readonly rpcUrl?: string;
  readonly entryPoint?: string;
  readonly safeModule?: string;
  readonly paymasterAddress?: string;
}

// Resolve + load the deploy snapshot for the AA config assembly, degrading to an empty object (so
// the operator can still supply AA env manually) when the snapshot is absent/unparseable — mirrors
// the previous main.ts try/catch, but without mutating process.env. Honors LIVESTREAK_AA_FROM_DEPLOY=0.
// Memoized: the snapshot + env are stable at boot, so repeated calls across the boot paths reuse the
// same result (one log line, one disk read).
let cachedDefaultSnapshot: DeploySnapshotConfig | undefined;

export const loadDefaultDeploySnapshotConfig = (): DeploySnapshotConfig => {
  if (cachedDefaultSnapshot !== undefined) {
    return cachedDefaultSnapshot;
  }
  cachedDefaultSnapshot = computeDefaultSnapshot();
  return cachedDefaultSnapshot;
};

const computeDefaultSnapshot = (): DeploySnapshotConfig => {
  if (process.env.LIVESTREAK_AA_FROM_DEPLOY === "0") {
    return {};
  }
  const snapshotPath = resolveDeploySnapshotPath();
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
  const paymaster = snapshot.scopes?.paymaster?.contracts;

  return {
    ...(chainId === undefined ? {} : { chainId }),
    ...(nonEmpty(snapshot.rpc) ? { rpcUrl: snapshot.rpc } : {}),
    ...(nonEmpty(aa?.entryPoint) ? { entryPoint: aa?.entryPoint } : {}),
    ...(nonEmpty(aa?.safe4337Module) ? { safeModule: aa?.safe4337Module } : {}),
    ...(nonEmpty(paymaster?.verifyingPaymaster)
      ? { paymasterAddress: paymaster?.verifyingPaymaster }
      : {})
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
