import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  createHostMediatedConsumerSignaling,
  createHostMediatedSinkSignaling,
  createLoopbackNetwork,
  streamFileToWebRtc,
  type RtcSessionDescription,
  type SignalingFetch
} from "#index.js";

/** In-memory host relay keyed by stream id (mirrors host/test/webrtc.test.ts). */
interface RelaySlot {
  offer?: RtcSessionDescription;
  answer?: RtcSessionDescription;
}

const makeRelay = () => {
  const slots = new Map<string, RelaySlot>();
  const slotFor = (url: string): RelaySlot => {
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
    const isAnswer = url.endsWith("/answer");
    if (init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as RtcSessionDescription;
      if (isOffer) {
        slot.offer = body;
      } else if (isAnswer) {
        slot.answer = body;
      }
      return { status: 201, ok: true, text: async () => "" };
    }
    const value = isOffer ? slot.offer : isAnswer ? slot.answer : undefined;
    if (value === undefined) {
      return { status: 404, ok: false, text: async () => "" };
    }
    return { status: 200, ok: true, text: async () => JSON.stringify(value) };
  };
  return { fetchImpl };
};

describe("browser consumer signaling (host-mediated seam)", () => {
  it("answers a sink offer and reassembles file bytes byte-identical", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "livestreak-webrtc-consumer-"));
    const filePath = path.join(dir, "clip.bin");
    const source = new Uint8Array(32_768);
    for (let i = 0; i < source.length; i += 1) {
      source[i] = (i * 3 + 5) & 0xff;
    }
    await writeFile(filePath, source);

    const streamId = "0xconsumer-stream";
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

      const consumerSignaling = createHostMediatedConsumerSignaling({
        baseUrl,
        streamId,
        fetch: relay.fetchImpl,
        pollIntervalMs: 5,
        offerTimeoutMs: 5_000
      });

      const consumer = Effect.runPromise(
        Effect.gen(function* () {
          const offer = yield* consumerSignaling.awaitOffer;
          const peer = network.factory();
          peer.ondatachannel = (event) => {
            event.channel.onmessage = (message) => {
              received.push(message.data);
              if (received.length === expectedChunks) {
                resolveAll();
              }
            };
          };
          yield* Effect.promise(() => peer.setRemoteDescription(offer));
          const answer = yield* Effect.promise(() => peer.createAnswer());
          yield* Effect.promise(() => peer.setLocalDescription(answer));
          yield* consumerSignaling.publishAnswer(answer);
        })
      );

      const sinkSignaling = createHostMediatedSinkSignaling({
        baseUrl,
        streamId,
        fetch: relay.fetchImpl,
        pollIntervalMs: 5
      });

      await streamFileToWebRtc({
        filePath,
        streamId,
        signaling: sinkSignaling,
        peerConnectionFactory: network.factory
      });
      await consumer;
      await allReceived;

      const reassembled = new Uint8Array(source.length);
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
});
