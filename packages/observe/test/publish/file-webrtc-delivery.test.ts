import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  createHostMediatedSinkSignaling,
  createLoopbackNetwork,
  resolveStreamFeed,
  streamFeedSignalPath,
  streamFileToWebRtc,
  type RtcSessionDescription,
  type SignalingFetch
} from "#index.js";

/**
 * Proves the SEAM-WEBRTC path: a REAL file on disk → chunked over WebRTC →
 * reassembled byte-identical by a peer that signals through a host-mediated
 * relay (an out-of-process-style exchange — the sink never touches the consumer
 * directly, only the relay). No transforms: bytes in === bytes out.
 */

// In-memory stand-in for agent-2's `/webrtc/signal` relay slots, keyed by id.
interface RelaySlot {
  offer?: RtcSessionDescription;
  answer?: RtcSessionDescription;
}

const makeRelay = () => {
  const slots = new Map<string, RelaySlot>();
  const slotFor = (url: string): RelaySlot => {
    // .../webrtc/signal/<id>/<offer|answer>
    const parts = url.split("/webrtc/signal/")[1]!.split("/");
    const id = decodeURIComponent(parts[0]!);
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = {};
      slots.set(id, slot);
    }
    return slot;
  };
  const fetchImpl: SignalingFetch = async (url, init) => {
    const slot = slotFor(url);
    const isOffer = url.endsWith("/offer");
    if (init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as RtcSessionDescription;
      if (isOffer) {
        slot.offer = body;
      } else {
        slot.answer = body;
      }
      return { status: 200, ok: true, text: async () => "" };
    }
    const value = isOffer ? slot.offer : slot.answer;
    if (value === undefined) {
      return { status: 404, ok: false, text: async () => "" };
    }
    return { status: 200, ok: true, text: async () => JSON.stringify(value) };
  };
  return { fetchImpl };
};

describe("file → WebRTC delivery (host-mediated seam)", () => {
  it("delivers a real file byte-identical to a relay-signaled peer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "livestreak-webrtc-"));
    const filePath = path.join(dir, "clip.bin");
    // ~40 KiB so the 16 KiB chunker emits multiple chunks.
    const source = new Uint8Array(40_000);
    for (let i = 0; i < source.length; i += 1) {
      source[i] = (i * 7 + 13) & 0xff;
    }
    await writeFile(filePath, source);

    const streamId = "0xmarket-stream-A";
    const baseUrl = "http://relay.test";
    const relay = makeRelay();
    const network = createLoopbackNetwork();

    try {
      const received: Uint8Array[] = [];
      const expectedChunks = Math.ceil(source.length / (16 * 1024));
      let resolveAll!: () => void;
      const allReceived = new Promise<void>((resolve) => {
        resolveAll = resolve;
      });

      // Consumer "process": pull the offer from the relay, answer it, collect frames.
      const consumer = Effect.runPromise(
        Effect.gen(function* () {
          // The consumer reads the offer slot directly (mirrors a browser GET).
          const offerResp = yield* Effect.promise(() =>
            relay.fetchImpl(`${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/offer`, {
              method: "GET"
            })
          );
          // Poll until the offer is posted.
          let offer: RtcSessionDescription | undefined;
          if (offerResp.ok) {
            offer = JSON.parse(yield* Effect.promise(() => offerResp.text())) as RtcSessionDescription;
          }
          while (offer === undefined) {
            yield* Effect.sleep("5 millis");
            const r = yield* Effect.promise(() =>
              relay.fetchImpl(`${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/offer`, {
                method: "GET"
              })
            );
            if (r.ok) {
              offer = JSON.parse(yield* Effect.promise(() => r.text())) as RtcSessionDescription;
            }
          }

          const peer = network.factory();
          peer.ondatachannel = (event) => {
            event.channel.onmessage = (message) => {
              received.push(message.data);
              if (received.length === expectedChunks) {
                resolveAll();
              }
            };
          };
          yield* Effect.promise(() => peer.setRemoteDescription(offer!));
          const answer = yield* Effect.promise(() => peer.createAnswer());
          // Post the answer back to the relay (mirrors a browser POST).
          yield* Effect.promise(() =>
            relay.fetchImpl(`${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/answer`, {
              method: "POST",
              body: JSON.stringify(answer)
            })
          );
        })
      );

      const sinkSignaling = createHostMediatedSinkSignaling({
        baseUrl,
        streamId,
        fetch: relay.fetchImpl,
        pollIntervalMs: 5
      });

      const result = await Effect.runPromise(
        streamFileToWebRtc({
          filePath,
          streamId,
          signaling: sinkSignaling,
          peerConnectionFactory: network.factory
        })
      );

      await consumer;
      await allReceived;

      expect(result.streamId).toBe(streamId);
      expect(result.totalBytes).toBe(source.length);
      expect(result.deliveredChunks).toBe(expectedChunks);

      const reassembled = new Uint8Array(result.totalBytes);
      let offset = 0;
      for (const chunk of received) {
        reassembled.set(chunk, offset);
        offset += chunk.length;
      }
      expect(offset).toBe(source.length);
      expect(Array.from(reassembled)).toEqual(Array.from(source));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves a per-stream feed keyed to the stream id", () => {
    const live = resolveStreamFeed({ streamId: "0xabc" });
    expect(live.kind).toBe("webrtc");
    expect(live.streamId).toBe("0xabc");
    expect((live as { signalPath: string }).signalPath).toBe(streamFeedSignalPath("0xabc"));

    const vod = resolveStreamFeed({ streamId: "0xabc", vod: { scheme: 2, pointer: "cid-123" } });
    expect(vod.kind).toBe("vod");
    expect((vod as { pointer: string }).pointer).toBe("cid-123");

    // Distinct ids ⇒ distinct feeds (not one global static asset).
    expect(streamFeedSignalPath("0xabc")).not.toBe(streamFeedSignalPath("0xdef"));
  });
});
