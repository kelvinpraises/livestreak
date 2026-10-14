import type { SuiGasCoinRef } from "@livestreak/wallet";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import {
  readAaServerConfig,
  type AaServerConfig,
} from "./config/aa.js";
import { loadDefaultDeploySnapshotConfig } from "./config/deployment.js";
import { defaultHostServerConfig, type HostServerConfig } from "./config/host.js";
import {
  createDatabase,
  type DatabaseHandle,
  type TestDatabaseHandle,
} from "./database/connection.js";
import type { DeploymentScopes } from "./database/schema.js";
import {
  migrateToLatest,
  migrateSync,
} from "./database/migrations/index.js";
import {
  createSolanaPaymaster,
  readSolanaPaymasterRuntimeConfig,
  type SolanaPaymasterService,
} from "./features/aa/solana.js";
import {
  createSuiGasStation,
  readSuiGasStationRuntimeConfig,
  type SuiGasStationService,
} from "./features/aa/sui.js";
import {
  createCatalogService,
  type CatalogReaderProvider,
  type CatalogService,
} from "./features/catalog/catalog.js";
import {
  createCatalogIndexer,
  type CatalogIndexer,
} from "./features/catalog/indexer.js";
import {
  createCatalogReadModel,
  type CatalogReadModel,
} from "./features/catalog/read-model.js";
import { createEnvReaderProvider, parseSeedMarkets } from "./features/catalog/readers.js";
import { registerCronJobs, type CronHandle } from "./features/catalog/scheduler.js";
import { createContentStore, type ContentStore } from "./features/content/content.js";
import { createDiscoveryStore } from "./features/discovery/store.js";
import type { ForumRouteDeps } from "./features/forum/routes.js";
import {
  createDirectAnnounceStore,
  type DirectAnnounceStore,
} from "./features/live/direct.js";
import { createLiveRingStore, type LiveRingStore } from "./features/live/ring.js";
import { createEvidenceStore } from "./features/media/evidence.js";
import { createManifestStore } from "./features/media/manifest.js";
import { createSessionStore } from "./features/media/session.js";
import type { MemoryRouteDeps } from "./features/memory/routes.js";
import {
  createRecordingService,
  type RecordingService,
} from "./features/recordings/service.js";
import { createRemoteService, type RemoteService } from "./features/remote/index.js";
import {
  createS3ObjectStore,
  type ObjectStore,
} from "./storage/object-store.js";

export type { ForumRouteDeps,MemoryRouteDeps };

// --- exports ---

export interface AaRouteDeps {
  readonly config: HostServerConfig;
  readonly aa: AaServerConfig;
  readonly suiGasStation: SuiGasStationService;
  readonly solanaPaymaster: SolanaPaymasterService;
}

export interface CreateAaRouteDepsOptions {
  readonly suiGasStation?: SuiGasStationService;
  readonly suiClient?: SuiJsonRpcClient;
  readonly suiInitialCoins?: readonly SuiGasCoinRef[];
  readonly solanaPaymaster?: SolanaPaymasterService;
}

export const createAaRouteDeps = (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {},
): AaRouteDeps => {
  const aa = readAaServerConfig(config, loadDefaultDeploySnapshotConfig());
  return {
    config,
    aa,
    suiGasStation: options.suiGasStation ?? createSuiGasStation({ config: null }),
    solanaPaymaster: options.solanaPaymaster ?? createSolanaPaymaster({ config: null }),
  };
};

export const bootstrapAaRouteDeps = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {},
): Promise<AaRouteDeps> => {
  const suiGasStation = await buildSuiGasStation(config, options);
  const solanaPaymaster = await buildSolanaPaymaster(config, options);
  const deps = createAaRouteDeps(config, { ...options, suiGasStation, solanaPaymaster });

  if (deps.suiGasStation.configured) {
    try {
      await deps.suiGasStation.bootstrap();
    } catch (error) {
      console.warn(`[aa]: Sui gas station bootstrap skipped: ${String(error)}`);
    }
  }

  if (deps.solanaPaymaster.configured) {
    try {
      await deps.solanaPaymaster.bootstrap();
    } catch (error) {
      console.warn(`[aa]: Solana paymaster bootstrap skipped: ${String(error)}`);
    }
  }

  return deps;
};

export const bootstrapHostRouteDeps = async (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {},
): Promise<HostRouteDeps> => {
  const objects = options.objectStore === undefined
    ? (config.storage === null ? null : createS3ObjectStore(config.storage))
    : options.objectStore;
  await objects?.check?.();
  const aa = options.aa ?? await bootstrapAaRouteDeps(config, options);
  const deps = createHostRouteDeps(config, { ...options, objectStore: objects, aa, cronEnabled: false });
  try {
    await migrateToLatest(deps.catalogDb.db);
    return { ...deps, catalogCron: registerCronJobs({
      indexer: deps.catalogIndexer,
      ...(options.cronEnabled === undefined ? {} : { enabled: options.cronEnabled }),
    }) };
  } catch (error) {
    if (options.catalogDb === undefined) await deps.catalogDb.close();
    throw error;
  }
};

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly media: MediaRouteDeps;
  readonly discovery: DiscoveryRouteDeps;
  readonly content: { readonly store: ContentStore; readonly objects: ObjectStore | null };
  readonly recordings: RecordingService;
  readonly memory: MemoryRouteDeps;
  readonly forum: ForumRouteDeps;
  readonly aa: AaRouteDeps;
  readonly remote: RemoteService;
  readonly catalog: CatalogService;
  // Discovery read-model (DB projection + lazy/cron indexer) powering the page endpoints.
  readonly catalogDb: DatabaseHandle;
  readonly catalogReadModel: CatalogReadModel;
  readonly catalogIndexer: CatalogIndexer;
  readonly catalogCron: CronHandle;
  readonly live: LiveRingStore;
  // Direct-stream signaling (announce/lookup); media bytes never transit the host on this lane.
  readonly direct: DirectAnnounceStore;
}

export interface CatalogStack {
  readonly deploymentScopes?: DeploymentScopes;
  readonly catalog: CatalogService;
  readonly catalogDb: DatabaseHandle;
  readonly catalogReadModel: CatalogReadModel;
  readonly catalogIndexer: CatalogIndexer;
  readonly catalogCron: CronHandle;
}

export interface MediaRouteDeps {
  readonly sessions: ReturnType<typeof createSessionStore>;
  readonly manifests: ReturnType<typeof createManifestStore>;
  readonly evidence: ReturnType<typeof createEvidenceStore>;
}

export interface DiscoveryRouteDeps {
  readonly store: ReturnType<typeof createDiscoveryStore>;
}

export interface ContentRouteDeps {
  readonly store: ReturnType<typeof createContentStore>;
}

export interface CreateHostRouteDepsOptions extends CreateAaRouteDepsOptions {
  readonly aa?: AaRouteDeps;
  readonly objectStore?: ObjectStore | null;
  // Inject a reader provider in tests; defaults to the env/deploy-snapshot provider.
  readonly catalogReaders?: CatalogReaderProvider;
  // Inject a DB handle in tests (e.g. createDatabase(":memory:")); defaults to the
  // DATABASE_URL/named-file handle.
  readonly catalogDb?: DatabaseHandle;
  // Force-enable/disable the cron loop; defaults to env-guarded (off in tests/CI).
  readonly cronEnabled?: boolean;
  // Explicit directory entries for embedding/tests. Production has no measured agent index.
  readonly agents?: readonly import("@livestreak/host").Agent[];
}

// Build the whole discovery read-model stack: the live `CatalogService` (registrations +
// known-market set), the DB handle (schema applied synchronously), the
// read-model the page endpoints serve from, the indexer (cron body + lazy path), and the
// registered cron handle. The reader provider + known-market set are SHARED between the
// live service and the indexer so a `POST /catalog/markets` registration feeds both.
const buildCatalogStack = (
  config: HostServerConfig,
  store: ReturnType<typeof createDiscoveryStore>,
  options: CreateHostRouteDepsOptions,
  isStreamLive?: (marketId: string) => boolean,
): CatalogStack => {
  const readers = options.catalogReaders ?? createEnvReaderProvider();
  const service = createCatalogService({
    readers,
    defaultChain:
      (process.env.LIVESTREAK_CATALOG_DEFAULT_CHAIN as
        | "evm"
        | "sui"
        | "solana"
        | undefined) ?? "evm",
    listDiscoveryMarketIds: () => store.listMarketIds(),
    seedMarkets: parseSeedMarkets(process.env.LIVESTREAK_CATALOG_MARKETS),
  });

  // Under vitest/CI default to an isolated in-memory db (no file artifacts, no cross-test
  // bleed) unless a handle is explicitly injected.
  const inTest = process.env.VITEST !== undefined || process.env.NODE_ENV === "test";
  const db = options.catalogDb ?? (inTest ? createDatabase(":memory:") : createDatabase());
  if ("sqlite" in db) migrateSync((db as TestDatabaseHandle).sqlite);

  const indexer = createCatalogIndexer({
    db: db.db,
    readers,
    baseUrl: config.baseUrl,
    knownMarkets: () => service.knownMarkets(),
    ...(isStreamLive === undefined ? {} : { isStreamLive }),
  });
  const readModel = createCatalogReadModel({
    db: db.db,
    deploymentScopes: readers.deploymentScopes,
    agents: options.agents,
    health: indexer.health,
  });
  const cron = registerCronJobs({
    indexer,
    ...(options.cronEnabled === undefined ? {} : { enabled: options.cronEnabled }),
  });

  return { deploymentScopes: readers.deploymentScopes, catalog: service, catalogDb: db, catalogReadModel: readModel, catalogIndexer: indexer, catalogCron: cron };
};

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {},
): HostRouteDeps => {
  const objects =
    options.objectStore === undefined
      ? (config.storage === null ? null : createS3ObjectStore(config.storage))
      : options.objectStore;
  const content = { store: createContentStore(objects), objects };
  const discoveryStore = createDiscoveryStore();
  const live = createLiveRingStore();
  const direct = createDirectAnnounceStore();
  const catalogStack = buildCatalogStack(config, discoveryStore, options,
    (marketId) => live.isLive(marketId) || direct.lookup(marketId) !== undefined);
  const recordings = createRecordingService(objects, config.contentWriteToken, catalogStack.catalogDb.db,
    catalogStack.deploymentScopes);

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes),
    },
    discovery: {
      store: discoveryStore,
    },
    content,
    recordings,
    memory: { db: catalogStack.catalogDb.db },
    forum: { db: catalogStack.catalogDb.db },
    aa: options.aa ?? createAaRouteDeps(config, options),
    remote: buildRemoteService(config),
    ...catalogStack,
    live,
    direct,
  };
};

// --- helpers ---

const buildRemoteService = (config: HostServerConfig): RemoteService =>
  createRemoteService({
    gatewayToken: config.remoteGatewayToken,
    remoteBaseUrl: config.remoteAppOrigin ?? config.baseUrl,
    grantKeyHex: config.remoteGrantKeyHex,
    grantKeyId: `${config.hostId}_grant`,
  });

const buildSolanaPaymaster = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions,
): Promise<SolanaPaymasterService> => {
  if (options.solanaPaymaster !== undefined) {
    return options.solanaPaymaster;
  }

  const runtime = await readSolanaPaymasterRuntimeConfig(config).catch(() => null);
  if (runtime === null) {
    return createSolanaPaymaster({ config: null });
  }

  return createSolanaPaymaster({ config: runtime });
};

const buildSuiGasStation = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions,
): Promise<SuiGasStationService> => {
  if (options.suiGasStation !== undefined) {
    return options.suiGasStation;
  }

  const runtime = await readSuiGasStationRuntimeConfig(config).catch(() => null);
  if (runtime === null) {
    return createSuiGasStation({ config: null });
  }

  const client =
    options.suiClient ??
    new SuiJsonRpcClient({
      url: runtime.rpcUrl,
      network: readSuiNetwork(),
    });
  return createSuiGasStation({
    config: runtime,
    client,
    ...(options.suiInitialCoins === undefined
      ? {}
      : { initialCoins: options.suiInitialCoins }),
  });
};

const readSuiNetwork = (): "mainnet" | "testnet" | "devnet" | "localnet" => {
  const value = process.env.LIVESTREAK_SUI_NETWORK ?? "testnet";
  if (
    value === "mainnet" ||
    value === "testnet" ||
    value === "devnet" ||
    value === "localnet"
  ) {
    return value;
  }

  throw new Error("Invalid LIVESTREAK_SUI_NETWORK");
};
