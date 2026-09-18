import { describe, expect, it } from "vitest";
import {
  ANNOUNCE_TTL_MS,
  createDirectAnnounceStore,
  handleDirectAnnounce,
  handleDirectLookup,
  handleDirectWithdraw,
  handleReachabilityEcho,
  type TcpDialer
} from "../src/services/live/direct.js";

const announcedKey = (result: ReturnType<typeof handleDirectAnnounce>): string => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("announce failed");
  return result.result.key;
};

describe("direct announce store", () => {
  it("announces, looks up, withdraws with the ownership key", () => {
    const store = createDirectAnnounceStore();

    const announced = handleDirectAnnounce("m1", { watchUrl: "ws://84.12.9.3:48700/live/watch/m1" }, store);
    expect(announced.ok).toBe(true);
    if (announced.ok) expect(announced.status).toBe(201);
    const key = announcedKey(announced);

    const found = handleDirectLookup("m1", store);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.result.watchUrl).toBe("ws://84.12.9.3:48700/live/watch/m1");
      // The key is the announcer's receipt — lookups must never expose it.
      expect("key" in found.result).toBe(false);
    }

    const withdrawn = handleDirectWithdraw("m1", { key }, store);
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) expect(withdrawn.result.withdrawn).toBe(true);

    expect(handleDirectLookup("m1", store).ok).toBe(false);
  });

  it("rejects a non-ws watch URL and a blank stream id", () => {
    const store = createDirectAnnounceStore();
    const badUrl = handleDirectAnnounce("m1", { watchUrl: "http://84.12.9.3/x" }, store);
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.status).toBe(400);

    const blank = handleDirectAnnounce("  ", { watchUrl: "ws://a/b" }, store);
    expect(blank.ok).toBe(false);
  });

  it("re-announce with the key refreshes; without it, 409 — one curl cannot hijack a live door", () => {
    const store = createDirectAnnounceStore();
    const key = announcedKey(handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1" }, store));

    const hijack = handleDirectAnnounce("m1", { watchUrl: "ws://evil:9/live/watch/m1" }, store);
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.status).toBe(409);

    const refreshed = handleDirectAnnounce("m1", { watchUrl: "ws://b:2/live/watch/m1", key }, store);
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(refreshed.status).toBe(200);

    const found = handleDirectLookup("m1", store);
    if (found.ok) expect(found.result.watchUrl).toBe("ws://b:2/live/watch/m1");
  });

  it("withdraw without the key is denied while the record is fresh", () => {
    const store = createDirectAnnounceStore();
    announcedKey(handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1" }, store));

    const denied = handleDirectWithdraw("m1", {}, store);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);
    expect(handleDirectLookup("m1", store).ok).toBe(true);
  });

  it("expires an unrefreshed announce (a crashed broadcaster's dead door disappears)", () => {
    let nowMs = 1_000_000;
    const store = createDirectAnnounceStore(() => nowMs);
    announcedKey(handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1" }, store));

    nowMs += ANNOUNCE_TTL_MS - 1;
    expect(handleDirectLookup("m1", store).ok).toBe(true);

    nowMs += 2;
    expect(handleDirectLookup("m1", store).ok).toBe(false);
    // Expired ⇒ the stream id is claimable again (fresh 201, new key).
    const reclaimed = handleDirectAnnounce("m1", { watchUrl: "ws://b:2/live/watch/m1" }, store);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) expect(reclaimed.status).toBe(201);
  });

  it("heartbeat refreshes push the expiry forward", () => {
    let nowMs = 1_000_000;
    const store = createDirectAnnounceStore(() => nowMs);
    const key = announcedKey(handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1" }, store));

    nowMs += ANNOUNCE_TTL_MS - 10_000;
    handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1", key }, store);
    nowMs += ANNOUNCE_TTL_MS - 10_000;
    expect(handleDirectLookup("m1", store).ok).toBe(true);
  });

  it("404s an unknown stream", () => {
    const result = handleDirectLookup("nope", createDirectAnnounceStore());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("reachability echo", () => {
  const dialerRecording = (): { dialed: Array<{ ip: string; port: number }>; dial: TcpDialer } => {
    const dialed: Array<{ ip: string; port: number }> = [];
    return {
      dialed,
      dial: async (ip, port) => {
        dialed.push({ ip, port });
        return true;
      }
    };
  };

  it("dials ONLY the caller's own observed address (no SSRF surface)", async () => {
    const { dialed, dial } = dialerRecording();
    const result = await handleReachabilityEcho({ port: 48700 }, "84.12.9.3", dial);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ reachable: true, dialedIp: "84.12.9.3", dialedPort: 48700 });
    expect(dialed).toEqual([{ ip: "84.12.9.3", port: 48700 }]);
  });

  it("unwraps IPv6-mapped IPv4 callers", async () => {
    const { dialed, dial } = dialerRecording();
    await handleReachabilityEcho({ port: 48700 }, "::ffff:84.12.9.3", dial);
    expect(dialed[0]?.ip).toBe("84.12.9.3");
  });

  it("reports an unreachable door honestly", async () => {
    const result = await handleReachabilityEcho({ port: 48700 }, "84.12.9.3", async () => false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.reachable).toBe(false);
  });

  it("rejects a bad port and a missing caller address", async () => {
    expect((await handleReachabilityEcho({ port: 0 }, "1.2.3.4")).ok).toBe(false);
    expect((await handleReachabilityEcho({ port: 70000 }, "1.2.3.4")).ok).toBe(false);
    expect((await handleReachabilityEcho({ port: 48700 }, undefined)).ok).toBe(false);
  });
});
