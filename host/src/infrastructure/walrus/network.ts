import type { WalrusNetwork } from "@livestreak/host";
import type { HostServerConfig } from "../../config/host.js";

// --- exports ---

export interface WalrusNetworkProfile {
  readonly network: WalrusNetwork;
  readonly blob: {
    readonly publisherUrl: string;
    readonly aggregatorUrl: string;
  };
}

export interface ResolvedWalrus {
  readonly network: WalrusNetwork;
  readonly blob: {
    readonly publisherUrl: string;
    readonly aggregatorUrl: string;
  };
}

export const walrusNetworkProfiles: Readonly<Record<WalrusNetwork, WalrusNetworkProfile>> = {
  mainnet: {
    network: "mainnet",
    blob: {
      publisherUrl: "https://publisher.walrus-mainnet.walrus.space",
      aggregatorUrl: "https://aggregator.walrus-mainnet.walrus.space"
    }
  },
  testnet: {
    network: "testnet",
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

export const profileBlobEndpoints = (
  config: HostServerConfig
): WalrusNetworkProfile["blob"] | null => {
  if (config.walrusNetwork === null) {
    return null;
  }

  return walrusNetworkProfiles[config.walrusNetwork].blob;
};

// Blob endpoints are static per network — no relayer round-trip (that was the MemWal leg,
// removed in favour of host-DB steward memory).
export const resolveWalrus = (config: HostServerConfig): ResolvedWalrus => {
  if (config.walrusNetwork === null) {
    throw new Error("walrus_network_not_selected");
  }

  const profile = walrusNetworkProfiles[config.walrusNetwork];
  return { network: config.walrusNetwork, blob: profile.blob };
};

export const bootstrapWalrus = async (config: HostServerConfig): Promise<HostServerConfig> => {
  if (config.walrusNetwork === null) {
    return { ...config, resolvedWalrus: null };
  }

  return { ...config, resolvedWalrus: resolveWalrus(config) };
};
