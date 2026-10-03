import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createUploadsRouter } from "../src/api/routes/uploads.js";
import { createContentStore } from "../src/services/content/content.js";
import { digest } from "../src/infrastructure/storage/object-store.js";
import { testObjectStore } from "./helpers/object-store.js";
describe("generic cloud content", () => {
  it("requires cloud storage, verifies readback, and rejects corruption", async () => {
    await expect(
      createContentStore(null).store(new Uint8Array([1]), "application/octet-stream", {
        persistence: "locked",
      }),
    ).rejects.toThrow("not configured");
    const objects = testObjectStore();
    const content = createContentStore(objects);
    const bytes = new Uint8Array([1, 2, 3]);
    const pointer = await content.store(bytes, "video/mp4", { persistence: "locked" });
    expect(pointer.scheme).toBe("host");
    expect(await content.resolve("host", pointer.id)).toEqual(bytes);
    objects.data.set(`content/${pointer.id}`, new Uint8Array([4]));
    await expect(content.resolve("host", pointer.id)).rejects.toThrow("integrity mismatch");
  });
  it("streams binary content above the JSON ceiling, enforces auth/digest, and removes temporary objects", async () => {
    const objects = testObjectStore();
    const app = express();
    app.use(
      createUploadsRouter({
        config: { contentWriteToken: "private" },
        content: { objects },
      }),
    );
    const bytes = Buffer.alloc(17 * 1024 * 1024, 42);
    const id = digest(bytes);
    await request(app)
      .post("/content/uploads")
      .set("content-type", "application/octet-stream")
      .send(Buffer.from([1]))
      .expect(401);
    const result = await request(app)
      .post("/content/uploads")
      .set("authorization", "Bearer private")
      .set("content-type", "application/octet-stream")
      .set("x-content-sha256", id)
      .send(bytes)
      .expect(201);
    expect(result.body).toEqual({
      scheme: "host",
      id,
      url: `https://storage.test/content/${id}`,
    });
    expect((await objects.get(`content/${id}`)).length).toBe(bytes.length);
    await request(app)
      .post("/content/uploads")
      .set("authorization", "Bearer private")
      .set("content-type", "application/octet-stream")
      .set("x-content-sha256", "b".repeat(64))
      .send(Buffer.from([1]))
      .expect(400);
    expect([...objects.data.keys()].filter((key) => key.startsWith("uploads/"))).toEqual(
      [],
    );
  });
});
