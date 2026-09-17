import { describe, expect, it } from "vitest";
import {
  decodeHostCacheReceiptRequest,
  decodeHostCreateSessionRequest,
  decodeHostDiscoveryIndexRequest,
  decodeHostDiscoveryRequest,
  decodeHostPolicyRequest,
  decodeMemoryRecordInput,
  validationErrorMessage
} from "#index.js";

describe("host validation", () => {
  it("rejects missing policy fields", () => {
    const decoded = decodeHostPolicyRequest({
      outputMode: "local"
    });

    expect(decoded._tag).toBe("Left");
    if (decoded._tag === "Left") {
      expect(validationErrorMessage(decoded.left).length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid policy request", () => {
    const decoded = decodeHostPolicyRequest({
      outputMode: "local",
      debug: false,
      contentId: "cnt_01",
      observer: "obs_01"
    });

    expect(decoded._tag).toBe("Right");
  });

  it("rejects missing discovery fields", () => {
    const decoded = decodeHostDiscoveryRequest({ marketId: "mkt_01" });
    expect(decoded._tag).toBe("Left");
    if (decoded._tag === "Left") {
      expect(validationErrorMessage(decoded.left).length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid discovery request", () => {
    const decoded = decodeHostDiscoveryRequest({
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
      outputMode: "local",
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
      outputMode: "local",
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

  it("accepts a valid memory record input", () => {
    const decoded = decodeMemoryRecordInput({
      subjectKind: "vault",
      subjectId: "0xvault1",
      marketId: "mkt_01",
      findingIds: ["f1"],
      decisionActions: ["resolve"],
      atMs: 1000
    });

    expect(decoded._tag).toBe("Right");
  });
});
