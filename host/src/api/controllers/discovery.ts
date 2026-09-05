import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeHostDiscoveryIndexRequest,
  decodeHostDiscoveryRequest,
  validationErrorMessage
} from "@livestreak/host";
import type { NextFunction, Request, Response } from "express";
import type { DiscoveryRouteDeps, HostRouteDeps } from "../../deps.js";
import type { HostSimilarityResultWithKeys, IndexedVault } from "../../services/discovery.js";
import { asyncHandler, sendRouteResult } from "../middleware/respond.js";

// --- exports ---

export type DiscoveryRouteResponse =
  | { readonly ok: true; readonly result: HostSimilarityResultWithKeys }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type DiscoveryIndexRouteResponse =
  | { readonly ok: true; readonly result: IndexedVault }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleIndexVault = (
  body: unknown,
  deps: DiscoveryRouteDeps
): DiscoveryIndexRouteResponse => {
  if (body === null || typeof body !== "object") {
    return discoveryIndexFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostDiscoveryIndexRequest(body);
  if (decoded._tag === "Left") {
    return discoveryIndexFailure(validationErrorMessage(decoded.left));
  }

  // The canonical decoder strips unknown fields, so read the optional `vaultKey`
  // straight off the raw body and thread it through the store + the echo.
  const vaultKey = readVaultKey(body);
  const indexed: IndexedVault = {
    ...decoded.right,
    ...(vaultKey === undefined ? {} : { vaultKey })
  };

  deps.store.indexVault(indexed);

  return {
    ok: true,
    result: indexed
  };
}

const readVaultKey = (body: object): string | undefined => {
  const value = (body as { vaultKey?: unknown }).vaultKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};;

export const handleFindSimilar = (
  body: unknown,
  deps: DiscoveryRouteDeps
): DiscoveryRouteResponse => {
  if (body === null || typeof body !== "object") {
    return discoveryFindFailure("Request body must be a JSON object");
  }

  const decoded = decodeHostDiscoveryRequest(body);
  if (decoded._tag === "Left") {
    return discoveryFindFailure(validationErrorMessage(decoded.left));
  }

  return {
    ok: true,
    result: deps.store.findSimilar(decoded.right)
  };
};

export const createDiscoveryController = (deps: HostRouteDeps) => ({
  indexVault: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleIndexVault(req.body, deps.discovery), next, 201);
  }),

  findSimilar: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleFindSimilar(req.body, deps.discovery), next);
  })
});

// --- helpers ---

const discoveryFindFailure = (message: string): DiscoveryRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});

const discoveryIndexFailure = (message: string): DiscoveryIndexRouteResponse => ({
  ok: false,
  status: 400,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});
