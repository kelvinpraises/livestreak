import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createHostRouteDeps, createHostRoutes } from "#api/server.js";
import { dispatchHttpRequest } from "#api/server.js";
import { defaultHostServerConfig } from "#config/host.js";

// --- helpers ---

const createMockRequest = (options: {
  readonly method?: string;
  readonly url?: string;
  readonly body?: string;
}): IncomingMessage => {
  const request = Readable.from(options.body === undefined ? [] : [options.body]) as IncomingMessage;
  request.method = options.method ?? "GET";
  request.url = options.url ?? "/";
  return request;
};

const createMockResponse = (): ServerResponse & {
  statusCode?: number;
  body?: string;
} => {
  const response = new EventEmitter() as ServerResponse & {
    statusCode?: number;
    body?: string;
  };
  response.setHeader = () => response;
  response.end = ((body?: string) => {
    if (typeof body === "string") {
      response.body = body;
    }
    return response;
  }) as ServerResponse["end"];
  return response;
};

const parseErrorBody = (response: ServerResponse & { body?: string }) => {
  expect(response.body).toBeDefined();
  return JSON.parse(response.body!) as {
    error: { shortName: string; message: string };
  };
};

describe("dispatchHttpRequest", () => {
  const createTestHost = () => ({
    deps: createHostRouteDeps(defaultHostServerConfig()),
    routes: createHostRoutes()
  });

  it("returns typed 404 for unknown routes", async () => {
    const { deps, routes } = createTestHost();
    const response = createMockResponse();

    await dispatchHttpRequest(
      createMockRequest({ method: "GET", url: "/missing-route" }),
      response,
      routes,
      deps
    );

    expect(response.statusCode).toBe(404);
    const payload = parseErrorBody(response);
    expect(payload.error.shortName).toBe("config");
    expect(payload.error.message).toContain("GET");
    expect(payload.error.message).toContain("/missing-route");
  });

  it("returns typed 400 for malformed JSON bodies", async () => {
    const { deps, routes } = createTestHost();
    const response = createMockResponse();

    await dispatchHttpRequest(
      createMockRequest({
        method: "POST",
        url: "/media/sessions",
        body: "{not-json"
      }),
      response,
      routes,
      deps
    );

    expect(response.statusCode).toBe(400);
    const payload = parseErrorBody(response);
    expect(payload.error.shortName).toBe("config");
    expect(payload.error.message).toBe("Malformed JSON request body");
  });

  it("returns typed 400 for empty POST bodies on POST /media/sessions", async () => {
    const { deps, routes } = createTestHost();
    const response = createMockResponse();

    await dispatchHttpRequest(
      createMockRequest({
        method: "POST",
        url: "/media/sessions"
      }),
      response,
      routes,
      deps
    );

    expect(response.statusCode).toBe(400);
    const payload = parseErrorBody(response);
    expect(payload.error.shortName).toBe("config");
  });

  it("returns typed 400 for invalid object bodies on POST /media/sessions", async () => {
    const { deps, routes } = createTestHost();
    const response = createMockResponse();

    await dispatchHttpRequest(
      createMockRequest({
        method: "POST",
        url: "/media/sessions",
        body: JSON.stringify({ outputMode: "local" })
      }),
      response,
      routes,
      deps
    );

    expect(response.statusCode).toBe(400);
    const payload = parseErrorBody(response);
    expect(payload.error.shortName).toBe("config");
  });
});
