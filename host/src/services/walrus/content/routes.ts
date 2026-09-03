import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeContentBlobStoreRequest,
  type PointerScheme,
  type StorePointer,
  validationErrorMessage
} from "@livestreak/host";
import type { HostServerConfig } from "../../../config/host.js";
import { isWalrusBootstrapped, isWalrusEnabled } from "../../../config/host.js";
import type { ContentStore } from "./content.js";

// --- exports ---

export interface ContentRouteDeps {
  readonly config: HostServerConfig;
  readonly store: ContentStore;
}

export type ContentBlobStoreRouteResponse =
  | { readonly ok: true; readonly status: number; readonly result: StorePointer }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type ContentBlobResolveRouteResponse =
  | { readonly ok: true; readonly status: number; readonly result: { readonly bytesBase64: string } }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleContentBlobStore = async (
  body: unknown,
  deps: ContentRouteDeps
): Promise<ContentBlobStoreRouteResponse> => {
  if (!isWalrusEnabled(deps.config) || !isWalrusBootstrapped(deps.config)) {
    return contentFailure(503, "walrus_not_configured");
  }

  if (body === null || typeof body !== "object") {
    return contentFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeContentBlobStoreRequest(body);
  if (decoded._tag === "Left") {
    return contentFailure(400, validationErrorMessage(decoded.left));
  }

  const bytes = decodeBase64Bytes(decoded.right.bytesBase64);
  if (bytes === null) {
    return contentFailure(400, "bytesBase64 must be valid non-empty base64");
  }

  try {
    const pointer = await deps.store.store(bytes, decoded.right.contentType, {
      persistence: decoded.right.persistence ?? "ephemeral"
    });

    return { ok: true, status: 201, result: pointer };
  } catch (error) {
    return contentFailure(503, error instanceof Error ? error.message : "content_store_failed");
  }
};

export const handleContentBlobResolve = async (
  scheme: string,
  id: string,
  deps: ContentRouteDeps
): Promise<ContentBlobResolveRouteResponse> => {
  if (!isWalrusEnabled(deps.config) || !isWalrusBootstrapped(deps.config)) {
    return contentFailure(503, "walrus_not_configured");
  }

  if (!isPointerScheme(scheme) || id.trim().length === 0) {
    return contentFailure(400, "Invalid content pointer");
  }

  try {
    const bytes = await deps.store.resolve(scheme, id);
    return {
      ok: true,
      status: 200,
      result: { bytesBase64: Buffer.from(bytes).toString("base64") }
    };
  } catch (error) {
    return contentFailure(404, error instanceof Error ? error.message : "content_resolve_failed");
  }
};

// --- helpers ---

const contentFailure = <T extends ContentBlobStoreRouteResponse | ContentBlobResolveRouteResponse>(
  status: number,
  message: string
): T =>
  ({
    ok: false,
    status,
    error: new LiveStreakConfigError({
      message,
      metadata: { retryable: false }
    })
  }) as T;

const decodeBase64Bytes = (value: string): Uint8Array | null => {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 0 ? null : new Uint8Array(bytes);
  } catch {
    return null;
  }
};

const isPointerScheme = (value: string): value is PointerScheme =>
  value === "walrus-testnet" ||
  value === "walrus-mainnet" ||
  value === "ipfs" ||
  value === "arweave";
