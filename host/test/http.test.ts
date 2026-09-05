import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, createHostRouteDeps } from "#server.js";
import { defaultHostServerConfig } from "#config/host.js";

describe("express api", () => {
  const createTestApp = () => createApp(createHostRouteDeps(defaultHostServerConfig()));

  it("returns typed 404 for unknown routes", async () => {
    const response = await request(createTestApp()).get("/missing-route").expect(404);

    expect(response.body.error.shortName).toBe("config");
    expect(response.body.error.message).toContain("GET");
    expect(response.body.error.message).toContain("/missing-route");
  });

  it("returns typed 400 for malformed JSON bodies", async () => {
    const response = await request(createTestApp())
      .post("/media/sessions")
      .set("Content-Type", "application/json")
      .send("{not-json")
      .expect(400);

    expect(response.body.error.shortName).toBe("config");
    expect(response.body.error.message).toBe("Malformed JSON request body");
  });

  it("returns typed 400 for empty POST bodies on POST /media/sessions", async () => {
    const response = await request(createTestApp()).post("/media/sessions").expect(400);

    expect(response.body.error.shortName).toBe("config");
  });

  it("returns typed 400 for invalid object bodies on POST /media/sessions", async () => {
    const response = await request(createTestApp())
      .post("/media/sessions")
      .send({ outputMode: "local" })
      .expect(400);

    expect(response.body.error.shortName).toBe("config");
  });
});
