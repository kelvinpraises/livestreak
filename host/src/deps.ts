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
    catalog: buildCatalogService(config, discoveryStore, options),
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
  readonly signaling: SignalingStore;
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
}

const buildCatalogService = (
  config: HostServerConfig,
  store: ReturnType<typeof createDiscoveryStore>,
  options: CreateHostRouteDepsOptions
): CatalogService =>
  createCatalogService({
    readers: options.catalogReaders ?? createEnvReaderProvider(),
    baseUrl: config.baseUrl,
    defaultChain:
      (process.env.LIVESTREAK_CATALOG_DEFAULT_CHAIN as "evm" | "sui" | undefined) ?? "evm",
    listDiscoveryMarketIds: () => store.listMarketIds(),
    seedMarkets: parseSeedMarkets(process.env.LIVESTREAK_CATALOG_MARKETS)
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
    catalog: buildCatalogService(config, discoveryStore, options),
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
