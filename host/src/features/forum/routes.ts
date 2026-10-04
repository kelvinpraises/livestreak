import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeForumMessageInput,
  validationErrorMessage,
  type ForumListResponse,
  type ForumMessageDto,
} from "@livestreak/host";
import type { Kysely } from "kysely";
import type { DB } from "../../database/schema.js";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../../http/respond.js";

// --- exports ---

export interface ForumRouteDeps {
  readonly db: Kysely<DB>;
}

export type ForumRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleForumPost = async (
  body: unknown,
  deps: ForumRouteDeps,
): Promise<ForumRouteResponse<ForumMessageDto>> => {
  if (body === null || typeof body !== "object") {
    return forumFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeForumMessageInput(body);
  if (decoded._tag === "Left") {
    return forumFailure(400, validationErrorMessage(decoded.left));
  }

  const inserted = await deps.db
    .insertInto("forum_messages")
    .values({
      kind: decoded.right.kind,
      subject_kind: decoded.right.subjectKind,
      subject_id: decoded.right.subjectId,
      market_id: decoded.right.marketId ?? null,
      vault_id: decoded.right.vaultId ?? null,
      steward_id: decoded.right.stewardId ?? null,
      finding_id: decoded.right.findingId ?? null,
      title: decoded.right.title ?? null,
      message: decoded.right.message ?? null,
      at_ms: decoded.right.atMs,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { ok: true, status: 201, result: { id: Number(inserted.id), ...decoded.right } };
};

export const handleForumList = async (
  query: Record<string, unknown>,
  deps: ForumRouteDeps,
): Promise<ForumRouteResponse<ForumListResponse>> => {
  const subjectKind = readQueryString(query, "subjectKind");
  const subjectId = readQueryString(query, "subjectId");
  if (subjectKind === undefined || subjectId === undefined) {
    return forumFailure(400, "subjectKind and subjectId query params are required");
  }

  const rawLimit = readQueryString(query, "limit");
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
    return forumFailure(400, "limit must be an integer in 1..1000");
  }

  const rows = await deps.db
    .selectFrom("forum_messages")
    .selectAll()
    .where("subject_kind", "=", subjectKind)
    .where("subject_id", "=", subjectId)
    .orderBy("at_ms", "asc")
    .limit(limit ?? DEFAULT_LIST_LIMIT)
    .execute();
  const messages = rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind as ForumMessageDto["kind"],
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    ...(row.market_id === null ? {} : { marketId: row.market_id }),
    ...(row.vault_id === null ? {} : { vaultId: row.vault_id }),
    ...(row.steward_id === null ? {} : { stewardId: row.steward_id }),
    ...(row.finding_id === null ? {} : { findingId: row.finding_id }),
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.message === null ? {} : { message: row.message }),
    atMs: row.at_ms,
  }));
  return { ok: true, status: 200, result: { messages } };
};

const DEFAULT_LIST_LIMIT = 200;

// --- helpers ---

const readQueryString = (
  query: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = query[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const forumFailure = (
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


// --- exports ---

export const createForumRouter = (deps: Pick<HostRouteDeps, "forum">): Router => {
  const router = Router();
  const handlers = createForumHandlers(deps);

  router.post("/forum/messages", handlers.post);
  router.get("/forum/messages", handlers.list);

  return router;
};


// --- exports ---

export const createForumHandlers = (deps: Pick<HostRouteDeps, "forum">) => ({
  post: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, await handleForumPost(req.body, deps.forum), next);
  }),

  list: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleForumList(req.query as Record<string, unknown>, deps.forum),
      next
    );
  })
});
