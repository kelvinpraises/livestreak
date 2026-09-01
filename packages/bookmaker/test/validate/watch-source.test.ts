import { describe, expect, it } from "vitest";
import { validateBookmakerWatchSource } from "../../src/validate/watch-source.js";

describe("validateBookmakerWatchSource", () => {
  it("rejects missing marketId", () => {
    const result = validateBookmakerWatchSource({
      watchUrl: "https://example.com/watch"
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("marketId must be a non-empty string");
    }
  });

  it("rejects invalid optional stream fields", () => {
    const result = validateBookmakerWatchSource({
      marketId: "market-1",
      watchUrl: "  ",
      cacheReceiptRefs: ["ok", ""]
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "watchUrl must be a non-empty string when provided",
          "cacheReceiptRefs[1] must be a non-empty string"
        ])
      );
    }
  });

  it("accepts a valid watch source", () => {
    const result = validateBookmakerWatchSource({
      marketId: "market-1",
      webrtcUrl: "whep://example.com/market-1"
    });

    expect(result).toEqual({
      ok: true,
      value: {
        marketId: "market-1",
        webrtcUrl: "whep://example.com/market-1"
      }
    });
  });
});
