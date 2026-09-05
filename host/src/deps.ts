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
import { createEvidenceStore } from "./services/media/evidence.js";
import { createManifestStore } from "./services/media/manifest.js";
import { createSessionStore } from "./services/media/session.js";
import { createContentStore } from "./services/walrus/content/content.js";
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

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes)
    },
    discovery: {
      store: createDiscoveryStore()
    },
    walrus,
    aa
  };
};

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly media: MediaRouteDeps;
  readonly discovery: DiscoveryRouteDeps;
  readonly walrus: WalrusRouteDeps;
  readonly aa: AaRouteDeps;
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
}

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {}
): HostRouteDeps => {
  const resolved = options.walrusResolved ?? config.resolvedWalrus;
  const ops = options.memoryOps ?? createMemWalAccountOperations();
  const walrus = buildWalrusDeps(config, resolved, ops);

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes)
    },
    discovery: {
      store: createDiscoveryStore()
    },
    walrus,
    aa: createAaRouteDeps(config, options)
  };
};

// --- helpers ---

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
      store: createContentStore({
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
