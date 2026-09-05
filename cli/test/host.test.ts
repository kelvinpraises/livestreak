import { describe, expect, it } from "vitest";
import { createHostClient } from "../src/adapters/host.js";

describe("edges/host", () => {
  it("maps POST /content/blobs to StorePointer", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];

    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, init });

      if (path === "/content/blobs") {
        return new Response(
          JSON.stringify({
            scheme: "walrus-testnet",
            id: "blob_01",
            url: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_01"
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    };

    const host = createHostClient("http://127.0.0.1:4848", { fetchImpl });
    const pointer = await host.uploadBlob(new Uint8Array([1, 2, 3]), "video/mp4", "locked");

    expect(pointer).toEqual({
      scheme: "walrus-testnet",
      id: "blob_01",
      url: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_01"
    });

    expect(calls[0]?.path).toBe("/content/blobs");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.persistence).toBe("locked");
    expect(body.contentType).toBe("video/mp4");
  });
});
