import { createHostGrantSigner, type HostGrantSigner } from "./grant.js";
import { createRemoteRelay, type RemoteRelay } from "./relay.js";
import { createRemoteSessionStore, type RemoteSessionStore } from "./session-store.js";

// --- Remote Bridge Console service bundle (P4) ---
// One place that wires the session store, the host grant signer, and the
// verifying relay together so deps/controllers consume a single object.

export interface RemoteServiceConfig {
  readonly gatewayToken: string | null;
  readonly remoteBaseUrl: string;
  readonly grantKeyHex: string | null;
  readonly grantKeyId: string;
}

export interface RemoteService {
  readonly store: RemoteSessionStore;
  readonly signer: HostGrantSigner;
  readonly relay: RemoteRelay;
  readonly config: RemoteServiceConfig;
}

export const createRemoteService = (config: RemoteServiceConfig): RemoteService => {
  const store = createRemoteSessionStore();
  const signer = createHostGrantSigner({
    privateKeyHex: config.grantKeyHex,
    keyId: config.grantKeyId
  });
  const relay = createRemoteRelay(store, signer, {
    gatewayToken: config.gatewayToken,
    remoteBaseUrl: config.remoteBaseUrl
  });
  return { store, signer, relay, config };
};

export * from "./grant.js";
export * from "./session-store.js";
export * from "./relay.js";
export * from "./protocol.js";
