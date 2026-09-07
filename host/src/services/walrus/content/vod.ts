import { LiveStreakConfigError } from "@livestreak/core";
import type { PointerScheme, StorePointer } from "@livestreak/host";
import type { ContentStore } from "./content.js";

// --- exports ---

// Local VOD/stream metadata. Approach (issue 10): store this as a normal content blob via
// the EXISTING content store and record the returned StorePointer (scheme/id) on-chain via
// the normal goLive/VOD path. Resolving reads the blob back through the host and parses it.
// This exercises the REAL pointer plumbing with ZERO new infra and no external IPFS.
export interface VodMetadata {
  readonly title: string;
  readonly category: string;
  readonly poster?: string;
  // The media feed this metadata describes: a kind ("hls" | "webrtc" | "file" | ...) and a
  // pointer the player resolves (a URL, a content pointer id, or a webrtc stream key).
  readonly feed: {
    readonly kind: string;
    readonly pointer: string;
  };
  readonly durationSec?: number;
}

export interface VodMetadataDeps {
  readonly store: ContentStore;
}

export type VodStoreResponse =
  | { readonly ok: true; readonly status: number; readonly result: StorePointer }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type VodResolveResponse =
  | { readonly ok: true; readonly status: number; readonly result: VodMetadata }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

const fail = (status: number, message: string): { ok: false; status: number; error: LiveStreakConfigError } => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message, metadata: { retryable: false } })
});

const parseMetadata = (body: unknown): VodMetadata | null => {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const feed = b.feed as Record<string, unknown> | undefined;
  if (
    typeof b.title !== "string" ||
    typeof b.category !== "string" ||
    feed === undefined ||
    typeof feed.kind !== "string" ||
    typeof feed.pointer !== "string"
  ) {
    return null;
  }
  return {
    title: b.title,
    category: b.category,
    feed: { kind: feed.kind, pointer: feed.pointer },
    ...(typeof b.poster === "string" ? { poster: b.poster } : {}),
    ...(typeof b.durationSec === "number" ? { durationSec: b.durationSec } : {})
  };
};

export const handleVodMetadataStore = async (
  body: unknown,
  deps: VodMetadataDeps
): Promise<VodStoreResponse> => {
  const metadata = parseMetadata(body);
  if (metadata === null) {
    return fail(400, "vod metadata requires { title, category, feed: { kind, pointer } }");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  try {
    // Metadata is small + long-lived for the VOD's lifetime -> "locked" persistence.
    const pointer = await deps.store.store(bytes, "application/json", {
      persistence: "locked"
    });
    return { ok: true, status: 201, result: pointer };
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "vod_store_failed");
  }
};

const isPointerScheme = (value: string): value is PointerScheme =>
  value === "walrus-testnet" ||
  value === "walrus-mainnet" ||
  value === "ipfs" ||
  value === "arweave";

export const handleVodMetadataResolve = async (
  scheme: string,
  id: string,
  deps: VodMetadataDeps
): Promise<VodResolveResponse> => {
  if (!isPointerScheme(scheme) || id.trim().length === 0) {
    return fail(400, "Invalid VOD metadata pointer");
  }
  try {
    const bytes = await deps.store.resolve(scheme, id);
    const parsed = parseMetadata(JSON.parse(new TextDecoder().decode(bytes)));
    if (parsed === null) {
      return fail(422, "stored blob is not valid VOD metadata");
    }
    return { ok: true, status: 200, result: parsed };
  } catch (error) {
    return fail(404, error instanceof Error ? error.message : "vod_resolve_failed");
  }
};
