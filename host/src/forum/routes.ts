import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeForumAppendMessageRequest,
  decodeForumCreateThreadRequest,
  type ForumCreateThreadRequest,
  type ForumThread,
  type ForumThreadRecord,
  validationErrorMessage
} from "@livestreak/host";
import { randomUUID } from "node:crypto";
import type { ForumStore } from "./store.js";

// --- exports ---

export interface ForumRouteDeps {
  readonly store: ForumStore;
}

export type ForumThreadRouteResponse =
  | { readonly ok: true; readonly result: ForumThreadRecord }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleCreateThread = (
  body: unknown,
  deps: ForumRouteDeps
): ForumThreadRouteResponse => {
  if (body === null || typeof body !== "object") {
    return forumFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeForumCreateThreadRequest(body);
  if (decoded._tag === "Left") {
    return forumFailure(400, validationErrorMessage(decoded.left));
  }

  const nowMs = Date.now();
  const threadId = `thr_${randomUUID()}`;
  const thread = buildThread(threadId, decoded.right, nowMs);
  const messages =
    decoded.right.initialMessage === undefined
      ? []
      : [
          {
            messageId: `msg_${randomUUID()}`,
            threadId,
            author: decoded.right.initialMessage.author,
            body: decoded.right.initialMessage.body,
            createdAtMs: nowMs
          }
        ];

  return {
    ok: true,
    result: deps.store.createThread(thread, messages)
  };
};

export const handleGetThread = (
  threadId: string | undefined,
  deps: ForumRouteDeps
): ForumThreadRouteResponse => {
  if (threadId === undefined || threadId.length === 0) {
    return forumFailure(400, "threadId path parameter is required");
  }

  const record = deps.store.getThread(threadId);
  if (record === undefined) {
    return forumFailure(404, "Forum thread not found");
  }

  return {
    ok: true,
    result: record
  };
};

export const handleAppendMessage = (
  threadId: string | undefined,
  body: unknown,
  deps: ForumRouteDeps
): ForumThreadRouteResponse => {
  if (threadId === undefined || threadId.length === 0) {
    return forumFailure(400, "threadId path parameter is required");
  }

  if (body === null || typeof body !== "object") {
    return forumFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeForumAppendMessageRequest(body);
  if (decoded._tag === "Left") {
    return forumFailure(400, validationErrorMessage(decoded.left));
  }

  const updated = deps.store.appendMessage({
    messageId: `msg_${randomUUID()}`,
    threadId,
    author: decoded.right.author,
    body: decoded.right.body,
    createdAtMs: Date.now()
  });

  if (updated === undefined) {
    return forumFailure(404, "Forum thread not found");
  }

  return {
    ok: true,
    result: updated
  };
};

// --- helpers ---

const buildThread = (
  threadId: string,
  request: ForumCreateThreadRequest,
  nowMs: number
): ForumThread => ({
  threadId,
  title: request.title,
  ...(request.stewardId === undefined ? {} : { stewardId: request.stewardId }),
  ...(request.observeRef === undefined ? {} : { observeRef: request.observeRef }),
  createdAtMs: nowMs,
  updatedAtMs: nowMs
});

const forumFailure = (status: number, message: string): ForumThreadRouteResponse => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({
    message,
    metadata: { retryable: false }
  })
});
