import { describe, expect, it } from "vitest";
import {
  decodeHostCacheReceiptRequest,
  decodeHostCreateSessionRequest,
  decodeHostPolicyRequest,
  decodeHostSimilarityRequest,
  validationErrorMessage
} from "#index.js";

describe("host validation", () => {
  it("rejects missing policy fields", () => {
    const decoded = decodeHostPolicyRequest({
      outputMode: "forwarder"
    });

    expect(decoded._tag).toBe("Left");
    if (decoded._tag === "Left") {
      expect(validationErrorMessage(decoded.left).length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid policy request", () => {
    const decoded = decodeHostPolicyRequest({
      outputMode: "forwarder",
      debug: false,
      contentId: "cnt_01",
      observer: "obs_01"
    });

    expect(decoded._tag).toBe("Right");
  });

  it("rejects missing similarity fields", () => {
    const decoded = decodeHostSimilarityRequest({ marketId: "mkt_01" });
    expect(decoded._tag).toBe("Left");
    if (decoded._tag === "Left") {
      expect(validationErrorMessage(decoded.left).length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid similarity request", () => {
    const decoded = decodeHostSimilarityRequest({
      marketId: "mkt_01",
      vaultDraft: {
        title: "Example vault",
        summary: "A draft summary",
        tags: ["football"]
      }
    });

    expect(decoded._tag).toBe("Right");
  });

  it("rejects missing create-session fields", () => {
    const decoded = decodeHostCreateSessionRequest({
      outputMode: "forwarder",
      debug: false,
      contentId: "cnt_01"
    });

    expect(decoded._tag).toBe("Left");
    if (decoded._tag === "Left") {
      expect(validationErrorMessage(decoded.left).length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid create-session request", () => {
    const decoded = decodeHostCreateSessionRequest({
      outputMode: "forwarder",
      debug: false,
      contentId: "cnt_01",
      observer: "obs_01",
      sessionId: "session_test_01"
    });

    expect(decoded._tag).toBe("Right");
  });

  it("rejects missing cache receipt fields", () => {
    const decoded = decodeHostCacheReceiptRequest({
      sessionId: "session_test_01",
      contentId: "cnt_01"
    });

    expect(decoded._tag).toBe("Left");
  });

  it("accepts a valid cache receipt request", () => {
    const decoded = decodeHostCacheReceiptRequest({
      sessionId: "session_test_01",
      contentId: "cnt_01",
      observer: "obs_01",
      evidence: {
        kind: "cache_receipt",
        ref: "evd_01"
      }
    });

    expect(decoded._tag).toBe("Right");
  });
});
