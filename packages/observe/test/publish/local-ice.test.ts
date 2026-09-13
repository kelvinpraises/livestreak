import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  fetchHostIceConfig,
  resolveNodeIceOptions,
  type NodeIceConfig
} from "#pipeline/publish/sinks/local/node-peer.js";

// Turnkey ICE — the producer discovers the host's embedded STUN/TURN via GET /webrtc/ice. The host's
// wire contract (host/src/api/controllers/webrtc.ts getIce via sendRouteResult) is the BARE payload
// {iceServers: [{urls, username?, credential?}...], relayOnly: boolean} — no envelope.

const HOST_ICE: NodeIceConfig = {
  iceServers: [
    { urls: "stun:192.168.1.7:3478" },
    { urls: "turn:192.168.1.7:3478?transport=udp", username: "livestreak", credential: "streampass" }
  ],
  relayOnly: true
};

const okJson = (body: unknown): Response =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe("fetchHostIceConfig", () => {
  it("parses the host's bare {iceServers, relayOnly} payload from GET {base}/webrtc/ice", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url));
      return okJson(HOST_ICE);
    }) as typeof fetch;

    const config = await Effect.runPromise(fetchHostIceConfig("http://127.0.0.1:8787/", fetchImpl));

    // Trailing slash normalized; the exact host route is hit.
    expect(urls).toEqual(["http://127.0.0.1:8787/webrtc/ice"]);
    expect(config).toEqual(HOST_ICE);
  });

  it("degrades to undefined on a non-OK status (prepare must not break)", async () => {
    const fetchImpl = (async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as typeof fetch;
    expect(await Effect.runPromise(fetchHostIceConfig("http://h", fetchImpl))).toBeUndefined();
  });

  it("degrades to undefined on malformed JSON", async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        }
      }) as unknown as Response) as typeof fetch;
    expect(await Effect.runPromise(fetchHostIceConfig("http://h", fetchImpl))).toBeUndefined();
  });

  it("degrades to undefined on a network failure", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await Effect.runPromise(fetchHostIceConfig("http://h", fetchImpl))).toBeUndefined();
  });
});

describe("resolveNodeIceOptions precedence", () => {
  it("uses the host-described ICE (servers + advised relayOnly) when no env is set", () => {
    expect(resolveNodeIceOptions(HOST_ICE, {})).toEqual({
      iceServers: [...HOST_ICE.iceServers!],
      relayOnly: true
    });
  });

  it("falls back to the STUN default when the host fetch degraded (undefined)", () => {
    expect(resolveNodeIceOptions(undefined, {})).toEqual({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      relayOnly: false
    });
  });

  it("explicit env (LIVESTREAK_ICE_SERVERS) wins over the host's ICE", () => {
    const envServers = [{ urls: "turn:relay.example:3478", username: "u", credential: "c" }];
    expect(
      resolveNodeIceOptions(HOST_ICE, { iceServersJson: JSON.stringify(envServers) }).iceServers
    ).toEqual(envServers);
  });

  it("malformed env JSON falls through to the host's ICE", () => {
    expect(resolveNodeIceOptions(HOST_ICE, { iceServersJson: "{nope" }).iceServers).toEqual([
      ...HOST_ICE.iceServers!
    ]);
  });

  it("env LIVESTREAK_ICE_RELAY_ONLY=1 forces relay even when the host does not advise it", () => {
    expect(resolveNodeIceOptions({ iceServers: [], relayOnly: false }, { relayOnly: "1" }).relayOnly).toBe(
      true
    );
    expect(resolveNodeIceOptions(undefined, { relayOnly: "0" }).relayOnly).toBe(false);
  });
});
