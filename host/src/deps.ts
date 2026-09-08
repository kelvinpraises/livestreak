import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { SuiGasCoinRef } from "@livestreak/wallet";
import { defaultHostServerConfig, type HostServerConfig } from "./config/host.js";
import { readAaServerConfig, buildPaymasterSigners, type AaServerConfig } from "./services/aa/chains.js";
import type { PaymasterSigner } from "./services/aa/paymaster.js";
import {
  createSuiGasStation,
  type SuiGasStationService
} from "./services/aa/sui-gas-station.js";
import { readSuiGasStationRuntimeConfig } from "./services/aa/sui-sponsor.js";
import { createDiscoveryStore } from "./services/discovery.js";
import {
  createCatalogService,
  type CatalogReaderProvider,
  type CatalogService
} from "./services/catalog/catalog.js";
import {
  createEnvReaderProvider,
  parseSeedMarkets
} from "./services/catalog/readers.js";
import {
  createCatalogReadModel,
  parseAgentsSeed,
  type CatalogReadModel
} from "./services/catalog/read-model.js";
import {
  createDatabase,
  type DatabaseHandle
} from "./infrastructure/database/connection.js";
import { migrateSync, migrateToLatest } from "./infrastructure/database/migrations/index.js";
import {
  createCatalogRepository,
  type CatalogRepository
} from "./infrastructure/database/repository.js";
import {
  createCatalogIndexer,
  type CatalogIndexer
} from "./infrastructure/cron/catalog-sync.js";
import { registerCronJobs, type CronHandle } from "./infrastructure/cron/index.js";
import { createSignalingStore, type SignalingStore } from "./services/webrtc/signal.js";
import { createRemoteService, type RemoteService } from "./services/remote/index.js";
import { createEvidenceStore } from "./services/media/evidence.js";
import { createManifestStore } from "./services/media/manifest.js";
import { createSessionStore } from "./services/media/session.js";
import { createContentStore } from "./services/walrus/content/content.js";
import { createLocalContentStore } from "./services/walrus/content/local-store.js";
import { createMemoryBindingStore } from "./services/walrus/memory/binding.js";
import { createMemWalAccountOperations } from "./services/walrus/memory/memwal-ops.js";
import { resolveMemoryOwnerKey } from "./infrastructure/wallet/index.js";
import type { ResolvedWalrus } from "./infrastructure/walrus/network.js";

// --- exports ---

export interface AaRouteDeps {
  readonly config: HostServerConfig;
  readonly aa: AaServerConfig;
  readonly paymasterSigners: Map<string, PaymasterSigner>;
  readonly suiGasStation: SuiGasStationService;
}

export interface CreateAaRouteDepsOptions {
  readonly paymasterSigners?: Map<string, PaymasterSigner>;
  readonly suiGasStation?: SuiGasStationService;
  readonly suiClient?: SuiJsonRpcClient;
  readonly suiInitialCoins?: readonly SuiGasCoinRef[];
}

export const createAaRouteDeps = (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {}
): AaRouteDeps => ({
  config,
  aa: readAaServerConfig(config),
  paymasterSigners: options.paymasterSigners ?? buildPaymasterSigners(readAaServerConfig(config)),
  suiGasStation: options.suiGasStation ?? createSuiGasStation({ config: null })
});

export const bootstrapAaRouteDeps = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions = {}
): Promise<AaRouteDeps> => {
  const suiGasStation = await buildSuiGasStation(config, options);
  const deps = createAaRouteDeps(config, { ...options, suiGasStation });

  if (deps.suiGasStation.configured) {
    try {
      await deps.suiGasStation.bootstrap();
    } catch (error) {
      console.warn(`[aa]: Sui gas station bootstrap skipped: ${String(error)}`);
    }
  }

  return deps;
};

export const bootstrapHostRouteDeps = async (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {}
): Promise<HostRouteDeps> => {
  const aa = await bootstrapAaRouteDeps(config, options);
  const resolved = options.walrusResolved ?? config.resolvedWalrus;
  const ops = options.memoryOps ?? createMemWalAccountOperations();
  const walrus = buildWalrusDeps(config, resolved, ops);
  const discoveryStore = createDiscoveryStore();
  const catalogStack = buildCatalogStack(config, discoveryStore, options);
  // Boot path: also run the formal migrator (records the migration as applied on top of the
  // idempotent sync DDL) so the bookkeeping table reflects reality.
  await migrateToLatest(catalogStack.db.db);

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes)
    },
    discovery: {
      store: discoveryStore
    },
    walrus,
    aa,
    remote: buildRemoteService(config),
    ...stackToDeps(catalogStack),
    signaling: createSignalingStore()
  };
};

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly media: MediaRouteDeps;
  readonly discovery: DiscoveryRouteDeps;
  readonly walrus: WalrusRouteDeps;
  readonly aa: AaRouteDeps;
  readonly remote: RemoteService;
  readonly catalog: CatalogService;
  // Discovery read-model (DB projection + lazy/cron indexer) powering the page endpoints.
  readonly catalogDb: DatabaseHandle;
  readonly catalogRepo: CatalogRepository;
  readonly catalogReadModel: CatalogReadModel;
  readonly catalogIndexer: CatalogIndexer;
  readonly catalogCron: CronHandle;
  readonly signaling: SignalingStore;
}

export interface CatalogStack {
  readonly service: CatalogService;
  readonly db: DatabaseHandle;
  readonly repo: CatalogRepository;
  readonly readModel: CatalogReadModel;
  readonly indexer: CatalogIndexer;
  readonly cron: CronHandle;
}

export interface MediaRouteDeps {
  readonly sessions: ReturnType<typeof createSessionStore>;
  readonly manifests: ReturnType<typeof createManifestStore>;
  readonly evidence: ReturnType<typeof createEvidenceStore>;
}

export interface DiscoveryRouteDeps {
  readonly store: ReturnType<typeof createDiscoveryStore>;
}

export interface WalrusRouteDeps {
  readonly memory: MemoryRouteDeps;
  readonly content: ContentRouteDeps;
}

export interface MemoryRouteDeps {
  readonly bindings: ReturnType<typeof createMemoryBindingStore>;
}

export interface ContentRouteDeps {
  readonly store: ReturnType<typeof createContentStore>;
}

export interface CreateHostRouteDepsOptions extends CreateAaRouteDepsOptions {
  readonly walrusResolved?: ResolvedWalrus;
  readonly memoryOps?: ReturnType<typeof createMemWalAccountOperations>;
  // Inject a reader provider in tests; defaults to the env/deploy-snapshot provider.
  readonly catalogReaders?: CatalogReaderProvider;
  // Inject a DB handle in tests (e.g. createDatabase(":memory:")); defaults to the
  // DATABASE_URL/named-file handle.
  readonly catalogDb?: DatabaseHandle;
  // Force-enable/disable the cron loop; defaults to env-guarded (off in tests/CI).
  readonly cronEnabled?: boolean;
  // Seed agents for /agents; defaults to LIVESTREAK_AGENTS_JSON.
  readonly agents?: readonly import("./services/catalog/types.js").Agent[];
}

// Build the whole discovery read-model stack: the live `CatalogService` (registrations +
// known-market set), the DB handle (schema applied synchronously), the repository, the
// read-model the page endpoints serve from, the indexer (cron body + lazy path), and the
// registered cron handle. The reader provider + known-market set are SHARED between the
// live service and the indexer so a `POST /catalog/markets` registration feeds both.
const buildCatalogStack = (
  config: HostServerConfig,
  store: ReturnType<typeof createDiscoveryStore>,
  options: CreateHostRouteDepsOptions
): CatalogStack => {
  const readers = options.catalogReaders ?? createEnvReaderProvider();
  const service = createCatalogService({
    readers,
    baseUrl: config.baseUrl,
    defaultChain:
      (process.env.LIVESTREAK_CATALOG_DEFAULT_CHAIN as "evm" | "sui" | undefined) ?? "evm",
    listDiscoveryMarketIds: () => store.listMarketIds(),
    seedMarkets: parseSeedMarkets(process.env.LIVESTREAK_CATALOG_MARKETS)
  });

  // Under vitest/CI default to an isolated in-memory db (no file artifacts, no cross-test
  // bleed) unless a handle is explicitly injected.
  const inTest =
    process.env.VITEST !== undefined || process.env.NODE_ENV === "test";
  const db = options.catalogDb ?? createDatabase(inTest ? ":memory:" : undefined);
  migrateSync(db.sqlite);

  const repo = createCatalogRepository(db.db);
  const indexer = createCatalogIndexer({
    repo,
    readers,
    baseUrl: config.baseUrl,
    knownMarkets: () => service.knownMarkets()
  });
  const readModel = createCatalogReadModel({
    repo,
    agents: options.agents ?? parseAgentsSeed(process.env.LIVESTREAK_AGENTS_JSON)
  });
  const cron = registerCronJobs({
    indexer,
    ...(options.cronEnabled === undefined ? {} : { enabled: options.cronEnabled })
  });

  return { service, db, repo, readModel, indexer, cron };
};

const stackToDeps = (stack: CatalogStack): Pick<
  HostRouteDeps,
  | "catalog"
  | "catalogDb"
  | "catalogRepo"
  | "catalogReadModel"
  | "catalogIndexer"
  | "catalogCron"
> => ({
  catalog: stack.service,
  catalogDb: stack.db,
  catalogRepo: stack.repo,
  catalogReadModel: stack.readModel,
  catalogIndexer: stack.indexer,
  catalogCron: stack.cron
});

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {}
): HostRouteDeps => {
  const resolved = options.walrusResolved ?? config.resolvedWalrus;
  const ops = options.memoryOps ?? createMemWalAccountOperations();
  const walrus = buildWalrusDeps(config, resolved, ops);
  const discoveryStore = createDiscoveryStore();

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes)
    },
    discovery: {
      store: discoveryStore
    },
    walrus,
    aa: createAaRouteDeps(config, options),
    remote: buildRemoteService(config),
    ...stackToDeps(buildCatalogStack(config, discoveryStore, options)),
    signaling: createSignalingStore()
  };
};

// --- helpers ---

const buildRemoteService = (config: HostServerConfig): RemoteService =>
  createRemoteService({
    gatewayToken: config.remoteGatewayToken,
    remoteBaseUrl: config.remoteAppOrigin ?? config.baseUrl,
    grantKeyHex: config.remoteGrantKeyHex,
    grantKeyId: `${config.hostId}_grant`
  });

const buildSuiGasStation = async (
  config: HostServerConfig,
  options: CreateAaRouteDepsOptions
): Promise<SuiGasStationService> => {
  if (options.suiGasStation !== undefined) {
    return options.suiGasStation;
  }

  const runtime = await readSuiGasStationRuntimeConfig(config).catch(() => null);
  if (runtime === null) {
    return createSuiGasStation({ config: null });
  }

  const client = options.suiClient ?? new SuiJsonRpcClient({
    url: runtime.rpcUrl,
    network: readSuiNetwork()
  });
  return createSuiGasStation({
    config: runtime,
    client,
    ...(options.suiInitialCoins === undefined ? {} : { initialCoins: options.suiInitialCoins })
  });
};

const buildWalrusDeps = (
  config: HostServerConfig,
  resolved: ResolvedWalrus | null,
  ops: ReturnType<typeof createMemWalAccountOperations>
): WalrusRouteDeps => {
  const disabledWalrus: ResolvedWalrus = {
    network: "mainnet",
    sui: {
      rpcUrl: "https://fullnode.mainnet.sui.io:443",
      packageId: "0x0",
      registryId: "0x0"
    },
    memory: { relayerUrl: "http://walrus-disabled.invalid" },
    blob: {
      publisherUrl: "http://walrus-disabled.invalid",
      aggregatorUrl: "http://walrus-disabled.invalid"
    }
  };

  const active = resolved ?? disabledWalrus;

  return {
    memory: {
      bindings:
        resolved === null
          ? createMemoryBindingStore({
              resolved: active,
              resolveOwnerKey: async () => {
                throw new Error("walrus_not_bootstrapped");
              },
              ops
            })
          : createMemoryBindingStore({
              resolved: active,
              resolveOwnerKey: async () => resolveMemoryOwnerKey(config, active.sui.rpcUrl),
              ops
            })
    },
    content: {
      // When Walrus is not configured (local EVM dev stack), fall back to an in-process,
      // content-addressed store served by this host so produce/publish/resolve still work.
      store:
        resolved === null
          ? createLocalContentStore({ baseUrl: config.baseUrl })
          : createContentStore({
              resolved: active,
              ephemeralEpochs: config.walrusContentEphemeralEpochs,
              lockedEpochs: config.walrusContentLockedEpochs
            })
    }
  };
};

const readSuiNetwork = (): "mainnet" | "testnet" | "devnet" | "localnet" => {
  const value = process.env.LIVESTREAK_SUI_NETWORK ?? process.env.SUI_NETWORK ?? "localnet";
  if (value === "mainnet" || value === "testnet" || value === "devnet" || value === "localnet") {
    return value;
  }

  return "localnet";
};
