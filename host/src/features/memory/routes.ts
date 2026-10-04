import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeMemoryRecordInput,
  validationErrorMessage,
  type MemoryRecallResponse,
  type MemoryRecordDto,
} from "@livestreak/host";
import type { Kysely } from "kysely";
import type { DB } from "../../database/schema.js";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../../http/respond.js";

// --- exports ---

export interface MemoryRouteDeps {
  readonly db: Kysely<DB>;
}

export type MemoryRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleMemoryRemember = async (
  body: unknown,
  deps: MemoryRouteDeps,
): Promise<MemoryRouteResponse<MemoryRecordDto>> => {
  if (body === null || typeof body !== "object") {
    return memoryFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeMemoryRecordInput(body);
  if (decoded._tag === "Left") {
    return memoryFailure(400, validationErrorMessage(decoded.left));
  }

  const inserted = await deps.db
    .insertInto("steward_memory")
    .values({
      subject_kind: decoded.right.subjectKind,
      subject_id: decoded.right.subjectId,
      market_id: decoded.right.marketId ?? null,
      vault_id: decoded.right.vaultId ?? null,
      finding_ids: JSON.stringify(decoded.right.findingIds),
      decision_actions: JSON.stringify(decoded.right.decisionActions),
      evidence_refs:
        decoded.right.evidenceRefs === undefined
          ? null
          : JSON.stringify(decoded.right.evidenceRefs),
      at_ms: decoded.right.atMs,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { ok: true, status: 201, result: { id: Number(inserted.id), ...decoded.right } };
};

export const handleMemoryRecall = async (
  query: Record<string, unknown>,
  deps: MemoryRouteDeps,
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

  const rows = await deps.db
    .selectFrom("steward_memory")
    .selectAll()
    .where("subject_kind", "=", subjectKind)
    .where("subject_id", "=", subjectId)
    .orderBy("at_ms", "desc")
    .limit(limit ?? DEFAULT_RECALL_LIMIT)
    .execute();
  const records = rows.map((row) => ({
    id: Number(row.id),
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    ...(row.market_id === null ? {} : { marketId: row.market_id }),
    ...(row.vault_id === null ? {} : { vaultId: row.vault_id }),
    findingIds: parseJsonArray(row.finding_ids),
    decisionActions: parseJsonArray(row.decision_actions),
    ...(row.evidence_refs === null
      ? {}
      : { evidenceRefs: parseJsonArray(row.evidence_refs) }),
    atMs: row.at_ms,
  }));
  return { ok: true, status: 200, result: { records } };
};

const DEFAULT_RECALL_LIMIT = 100;

// --- helpers ---

const readQueryString = (
  query: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = query[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const memoryFailure = (
  status: number,
  message: string,
): {
  readonly ok: false;
  readonly status: number;
  readonly error: LiveStreakConfigError;
} => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message }),
});

const parseJsonArray = (raw: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
};


// --- exports ---

export const createMemoryRouter = (deps: Pick<HostRouteDeps, "memory">): Router => {
  const router = Router();
  const handlers = createMemoryHandlers(deps);

  router.post("/memory/records", handlers.remember);
  router.get("/memory/records", handlers.recall);

  return router;
};


// --- exports ---

export const createMemoryHandlers = (deps: Pick<HostRouteDeps, "memory">) => ({
  remember: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, await handleMemoryRemember(req.body, deps.memory), next);
  }),

  recall: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleMemoryRecall(req.query as Record<string, unknown>, deps.memory),
      next
    );
  })
});
