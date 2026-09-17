import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeMemoryRecordInput,
  validationErrorMessage,
  type MemoryRecallResponse,
  type MemoryRecordDto
} from "@livestreak/host";
import type { MemoryRepository } from "../../infrastructure/database/memory-repository.js";

// --- exports ---

export interface MemoryRouteDeps {
  readonly repo: MemoryRepository;
}

export type MemoryRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleMemoryRemember = async (
  body: unknown,
  deps: MemoryRouteDeps
): Promise<MemoryRouteResponse<MemoryRecordDto>> => {
  if (body === null || typeof body !== "object") {
    return memoryFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeMemoryRecordInput(body);
  if (decoded._tag === "Left") {
    return memoryFailure(400, validationErrorMessage(decoded.left));
  }

  const record = await deps.repo.remember(decoded.right);
  return { ok: true, status: 201, result: record };
};

export const handleMemoryRecall = async (
  query: Record<string, unknown>,
  deps: MemoryRouteDeps
): Promise<MemoryRouteResponse<MemoryRecallResponse>> => {
  const subjectKind = readQueryString(query, "subjectKind");
  const subjectId = readQueryString(query, "subjectId");
  if (subjectKind === undefined || subjectId === undefined) {
    return memoryFailure(400, "subjectKind and subjectId query params are required");
  }

  const rawLimit = readQueryString(query, "limit");
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
    return memoryFailure(400, "limit must be an integer in 1..1000");
  }

  const records = await deps.repo.recall({
    subjectKind,
    subjectId,
    ...(limit === undefined ? {} : { limit })
  });
  return { ok: true, status: 200, result: { records } };
};

// --- helpers ---

const readQueryString = (query: Record<string, unknown>, key: string): string | undefined => {
  const value = query[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const memoryFailure = (
  status: number,
  message: string
): { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError } => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message })
});
