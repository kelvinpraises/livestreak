import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeForumMessageInput,
  validationErrorMessage,
  type ForumListResponse,
  type ForumMessageDto
} from "@livestreak/host";
import type { ForumRepository } from "../../infrastructure/database/forum-repository.js";

// --- exports ---

export interface ForumRouteDeps {
  readonly repo: ForumRepository;
}

export type ForumRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleForumPost = async (
  body: unknown,
  deps: ForumRouteDeps
): Promise<ForumRouteResponse<ForumMessageDto>> => {
  if (body === null || typeof body !== "object") {
    return forumFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeForumMessageInput(body);
  if (decoded._tag === "Left") {
    return forumFailure(400, validationErrorMessage(decoded.left));
  }

  const message = await deps.repo.post(decoded.right);
  return { ok: true, status: 201, result: message };
};

export const handleForumList = async (
  query: Record<string, unknown>,
  deps: ForumRouteDeps
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

  const messages = await deps.repo.list({
    subjectKind,
    subjectId,
    ...(limit === undefined ? {} : { limit })
  });
  return { ok: true, status: 200, result: { messages } };
};

// --- helpers ---

const readQueryString = (query: Record<string, unknown>, key: string): string | undefined => {
  const value = query[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const forumFailure = (
  status: number,
  message: string
): { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError } => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message })
});
