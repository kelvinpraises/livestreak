import type { EndpointManifest, HostSessionDraft } from "@livestreak/host";
import type { HostServerConfig } from "../../config/host.js";

// --- exports ---

export interface ManifestStore {
  readonly save: (manifest: EndpointManifest) => void;
  readonly getBySessionId: (sessionId: string) => EndpointManifest | undefined;
}

export const createManifestStore = (): ManifestStore => {
  const manifests = new Map<string, EndpointManifest>();

  return {
    save(manifest) {
      manifests.set(manifest.sessionId, manifest);
    },
    getBySessionId(sessionId) {
      const manifest = manifests.get(sessionId);
      return manifest === undefined ? undefined : copyManifest(manifest);
    }
  };
};

export const buildDevManifest = (
  config: HostServerConfig,
  draft: HostSessionDraft,
  nowMs = Date.now()
): EndpointManifest => {
  const manifestId = `manifest_${draft.sessionId}`;
  const expiresAtMs = nowMs + 60 * 60 * 1000;

  return {
    version: "0.1.0",
    manifestId,
    sessionId: draft.sessionId,
    observer: draft.manifestDraft.observer,
    contentId: draft.manifestDraft.contentId,
    hostId: config.hostId,
    endpoints: [
      {
        kind: "watch",
        url: `${config.baseUrl}/dev/watch/${draft.sessionId}`,
        expiresAtMs
      },
      {
        kind: "webrtc",
        url: `${config.baseUrl}/dev/webrtc/${draft.sessionId}`,
        expiresAtMs
      }
    ],
    hostPolicyStatus: draft.policy.descriptor.evaluation.status,
    cacheReceiptRefs: [],
    issuedAtMs: nowMs,
    expiresAtMs,
    signature: `dev-stub-signature:${config.hostId}:${manifestId}`
  };
};

export const appendManifestCacheReceiptRef = (
  store: ManifestStore,
  sessionId: string,
  receiptId: string
): EndpointManifest | undefined => {
  const manifest = store.getBySessionId(sessionId);
  if (manifest === undefined) {
    return undefined;
  }

  const updated: EndpointManifest = {
    ...manifest,
    cacheReceiptRefs: [...manifest.cacheReceiptRefs, receiptId]
  };
  store.save(updated);
  return updated;
};

// --- helpers ---

const copyManifest = (manifest: EndpointManifest): EndpointManifest => ({
  ...manifest,
  endpoints: manifest.endpoints.map((endpoint) => ({ ...endpoint })),
  cacheReceiptRefs: [...manifest.cacheReceiptRefs]
});
