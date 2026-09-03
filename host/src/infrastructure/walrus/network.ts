import type { WalrusNetwork } from "@livestreak/host";
import type { HostServerConfig } from "../../config/host.js";

// --- exports ---

export interface WalrusNetworkProfile {
  readonly network: WalrusNetwork;
  readonly memory: {
    readonly relayerUrl: string;
    readonly registryId: string;
  };
  readonly blob: {
    readonly publisherUrl: string;
    readonly aggregatorUrl: string;
  };
}

export interface ResolvedWalrus {
  readonly network: WalrusNetwork;
  readonly sui: {
    readonly rpcUrl: string;
    readonly packageId: string;
    readonly registryId: string;
  };
  readonly memory: {
    readonly relayerUrl: string;
  };
  readonly blob: {
    readonly publisherUrl: string;
    readonly aggregatorUrl: string;
  };
}

export interface RelayerConfigResponse {
  readonly packageId: string;
  readonly network: WalrusNetwork;
  readonly suiRpcUrl: string;
  readonly registryId?: string;
}

export class WalrusNetworkMismatchError extends Error {
  readonly code = "memory_network_mismatch" as const;

  constructor(
    readonly selectedNetwork: WalrusNetwork,
    readonly relayerNetwork: WalrusNetwork,
    readonly relayerUrl: string
  ) {
    super(
      `memory_network_mismatch: selector=${selectedNetwork} relayer=${relayerNetwork} url=${relayerUrl}`
    );
    this.name = "WalrusNetworkMismatchError";
  }
}

export const walrusNetworkProfiles: Readonly<Record<WalrusNetwork, WalrusNetworkProfile>> = {
  mainnet: {
    network: "mainnet",
    memory: {
      relayerUrl: "https://relayer.memory.walrus.xyz",
      registryId: "0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd"
    },
    blob: {
      publisherUrl: "https://publisher.walrus-mainnet.walrus.space",
      aggregatorUrl: "https://aggregator.walrus-mainnet.walrus.space"
    }
  },
  testnet: {
    network: "testnet",
    memory: {
      relayerUrl: "https://relayer-staging.memory.walrus.xyz",
      registryId: "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437"
    },
    blob: {
      publisherUrl: "https://publisher.walrus-testnet.walrus.space",
      aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space"
    }
  }
};

export const parseWalrusNetwork = (value: string | null): WalrusNetwork | null => {
  if (value === "mainnet" || value === "testnet") {
    return value;
  }

  return null;
};

export const profileMemoryRelayerUrl = (config: HostServerConfig): string | null => {
  if (config.walrusNetwork === null) {
    return null;
  }

  const profile = walrusNetworkProfiles[config.walrusNetwork];
  return config.walrusMemoryRelayerUrlOverride ?? profile.memory.relayerUrl;
};

export const profileBlobEndpoints = (
  config: HostServerConfig
): WalrusNetworkProfile["blob"] | null => {
  if (config.walrusNetwork === null) {
    return null;
  }

  return walrusNetworkProfiles[config.walrusNetwork].blob;
};

export const fetchRelayerConfig = async (
  relayerUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<RelayerConfigResponse> => {
  const base = relayerUrl.replace(/\/$/u, "");
  const response = await fetchImpl(`${base}/config`);

  if (!response.ok) {
    throw new Error(`MemWal relayer config fetch failed (${response.status})`);
  }

  const body = (await response.json()) as {
    packageId?: string;
    network?: string;
    suiRpcUrl?: string;
    registryId?: string;
  };

  if (
    body.packageId === undefined ||
    body.network === undefined ||
    body.suiRpcUrl === undefined
  ) {
    throw new Error("MemWal relayer /config missing packageId, network, or suiRpcUrl");
  }

  if (body.network !== "testnet" && body.network !== "mainnet") {
    throw new Error(`Unsupported MemWal relayer network: ${body.network}`);
  }

  return {
    packageId: body.packageId,
    network: body.network,
    suiRpcUrl: body.suiRpcUrl,
    ...(body.registryId === undefined ? {} : { registryId: body.registryId })
  };
};

export const resolveWalrus = async (
  config: HostServerConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedWalrus> => {
  if (config.walrusNetwork === null) {
    throw new Error("walrus_network_not_selected");
  }

  const profile = walrusNetworkProfiles[config.walrusNetwork];
  const relayerUrl = config.walrusMemoryRelayerUrlOverride ?? profile.memory.relayerUrl;
  const relayerConfig = await fetchRelayerConfig(relayerUrl, fetchImpl);

  if (relayerConfig.network !== config.walrusNetwork) {
    throw new WalrusNetworkMismatchError(
      config.walrusNetwork,
      relayerConfig.network,
      relayerUrl
    );
  }

  const registryId =
    config.walrusRegistryIdOverride ??
    relayerConfig.registryId ??
    profile.memory.registryId;

  return {
    network: config.walrusNetwork,
    sui: {
      rpcUrl: relayerConfig.suiRpcUrl,
      packageId: relayerConfig.packageId,
      registryId
    },
    memory: {
      relayerUrl
    },
    blob: {
      publisherUrl: profile.blob.publisherUrl,
      aggregatorUrl: profile.blob.aggregatorUrl
    }
  };
};

export const bootstrapWalrus = async (
  config: HostServerConfig,
  fetchImpl: typeof fetch = fetch
): Promise<HostServerConfig> => {
  if (config.walrusNetwork === null) {
    return { ...config, resolvedWalrus: null };
  }

  const resolved = await resolveWalrus(config, fetchImpl);
  return { ...config, resolvedWalrus: resolved };
};

export type MemWalNetworkContext = {
  readonly network: WalrusNetwork;
  readonly packageId: string;
  readonly registryId: string;
  readonly suiRpcUrl: string;
};

export const memwalContextFromResolved = (resolved: ResolvedWalrus): MemWalNetworkContext => ({
  network: resolved.network,
  packageId: resolved.sui.packageId,
  registryId: resolved.sui.registryId,
  suiRpcUrl: resolved.sui.rpcUrl
});
