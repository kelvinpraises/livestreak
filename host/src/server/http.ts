import {
  LiveStreakConfigError,
  isLiveStreakError,
  serializeLiveStreakError,
  serializeUnknownError,
  type SerializedError
} from "@livestreak/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HostRouteDeps, MatchedRoute, RouteDefinition } from "./routes.js";

// --- exports ---

export interface JsonSuccess<T> {
  readonly ok: true;
  readonly status: number;
  readonly body: T;
}

export interface JsonFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: SerializedError;
}

export type JsonResponse<T> = JsonSuccess<T> | JsonFailure;

export const jsonSuccess = <T>(status: number, body: T): JsonSuccess<T> => ({
  ok: true,
  status,
  body
});

export const jsonFailure = (status: number, error: unknown): JsonFailure => ({
  ok: false,
  status,
  error: isLiveStreakError(error)
    ? serializeLiveStreakError(error)
    : serializeUnknownError(error)
});

export const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new LiveStreakConfigError({
      message: "Malformed JSON request body",
      metadata: { retryable: false }
    });
  }
};

export const writeJsonResponse = (response: ServerResponse, payload: JsonResponse<unknown>): void => {
  const body = payload.ok
    ? payload.body
    : {
        error: payload.error
      };

  response.statusCode = payload.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

export const matchRoute = (
  method: string,
  pathname: string,
  routes: readonly RouteDefinition[]
): MatchedRoute | undefined => {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    const match = route.pattern.exec(pathname);
    if (match === null) {
      continue;
    }

    return {
      route,
      params: match.groups ?? {}
    };
  }

  return undefined;
};

export const routeNotFound = (method: string, pathname: string): JsonResponse<unknown> =>
  jsonFailure(
    404,
    new LiveStreakConfigError({
      message: `No route for ${method} ${pathname}`,
      metadata: { retryable: false }
    })
  );

export const dispatchHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  routes: readonly RouteDefinition[],
  deps: HostRouteDeps
): Promise<void> => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const matched = matchRoute(method, url.pathname, routes);

  if (matched === undefined) {
    writeJsonResponse(response, routeNotFound(method, url.pathname));
    return;
  }

  try {
    const body =
      method === "POST" || method === "PUT" || method === "PATCH"
        ? await readJsonBody(request)
        : undefined;
    const result = await matched.route.handler({
      params: matched.params,
      body,
      deps
    });
    writeJsonResponse(response, result);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      writeJsonResponse(response, jsonFailure(400, error));
      return;
    }

    writeJsonResponse(response, jsonFailure(500, error));
  }
};
