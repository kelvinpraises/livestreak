import { describe, expect, it } from "vitest";
import { Effect, Fiber } from "effect";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";
import { createLocalSinkDriver } from "#pipeline/publish/sinks/local/driver.js";
import {
  createLocalSignalingHub,
  type RtcPeerConnectionLike,
  type SinkSignalingChannel
} from "#pipeline/publish/sinks/local/signaling.js";
import { resolveNodePeerConnectionFactory } from "#pipeline/publish/sinks/local/node-peer.js";

/**
 * Media-track delivery — the REAL-TIME path. Two @roamhq/wrtc peers exchange a live video track in one
 * process: the local sink adds an RTCVideoSource track and pushes I420 frames; the consumer receives them
 * through an RTCVideoSink. Proves frames traverse a native RTP media track (not a data channel) end-to-end.
 * Skips cleanly if native wrtc is unavailable (the loopback transport has no media support by design).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wrtc = any;

const loadWrtc = async (): Promise<Wrtc | undefined> => {
  try {
    const mod = (await import("@roamhq/wrtc")) as { default?: Wrtc };
    return mod.default ?? (mod as Wrtc);
  } catch {
    return undefined;
  }
};

const W = 320;
const H = 240;

const grayI420 = (): Uint8Array => {
  const y = W * H;
  const frame = new Uint8Array((W * H * 3) / 2);
  frame.fill(128, 0, y); // luma mid-gray
  frame.fill(128, y); // chroma neutral
  return frame;
};

const makeI420Item = (sequence: number, data: Uint8Array): SinkDeliveryItem => ({
  kind: "video",
  sinkId: "local-preview",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence,
  epoch: 0,
  mediaTimeMs: sequence * 33,
  wallTimeMs: Date.now(),
  payloadBytes: data.byteLength,
  payload: { data, width: W, height: H, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 }
});

const gatherIce = (peer: { iceGatheringState: string; localDescription: unknown }): Promise<void> =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (peer.iceGatheringState === "complete" || Date.now() - started > 3000) {
        resolve();
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });

describe("local sink media-track delivery", () => {
  it("streams I420 frames over a WebRTC video track to a consumer", async () => {
    const wrtc = await loadWrtc();
    if (wrtc === undefined) {
      return; // native wrtc absent — media track cannot be exercised in-process
    }
    const { RTCVideoSink } = wrtc.nonstandard as {
      RTCVideoSink: new (track: unknown) => { onframe: ((e: { frame: { width: number; height: number } }) => void) | null; stop: () => void };
    };

    const hub = createLocalSignalingHub();
    const received: { width: number; height: number }[] = [];

    // Consumer peer: answer the sink's offer and collect frames from the inbound track via RTCVideoSink.
    const consumerPeer = new wrtc.RTCPeerConnection({ iceServers: [] });
    let videoSink: { stop: () => void } | undefined;
    consumerPeer.ontrack = (event: { track: unknown }) => {
      const sink = new RTCVideoSink(event.track);
      videoSink = sink;
      sink.onframe = (e) => received.push({ width: e.frame.width, height: e.frame.height });
    };

    const runConsumer = Effect.gen(function* () {
      // Announce this viewer so the producer's accept loop mints an offer for it, then answer that offer.
      yield* hub.consumer.register;
      const offer = yield* hub.consumer.awaitOffer;
      yield* Effect.promise(() => consumerPeer.setRemoteDescription(offer));
      const answer = yield* Effect.promise(() => consumerPeer.createAnswer());
      yield* Effect.promise(() => consumerPeer.setLocalDescription(answer));
      yield* Effect.promise(() => gatherIce(consumerPeer));
      yield* hub.consumer.publishAnswer(consumerPeer.localDescription);
    });

    const program = Effect.scoped(
      Effect.gen(function* () {
        const factory = yield* resolveNodePeerConnectionFactory();
        const driver = createLocalSinkDriver();

        // Consumer must be awaiting the offer before the sink publishes it.
        const consumerFiber = yield* Effect.fork(runConsumer);

        const attachment = yield* driver.attach({
          signaling: hub.sink,
          streamId: "track-test",
          peerConnectionFactory: factory
        });
        yield* Fiber.join(consumerFiber);

        // Push frames until the consumer has received several (tolerating ICE connect latency) or we time out.
        const frame = grayI420();
        for (let i = 0; i < 200 && received.length < 3; i += 1) {
          yield* attachment.deliver(makeI420Item(i, frame));
          yield* Effect.sleep("33 millis");
        }
        yield* attachment.finalize;
      })
    );

    await Effect.runPromise(program);
    videoSink?.stop();
    consumerPeer.close();

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.width).toBe(W);
    expect(received[0]?.height).toBe(H);
  }, 20000);

  it("attach returns without blocking on a viewer's answer and mints a peer per registered viewer", async () => {
    // Regression + multi-viewer: a live producer streams continuously; the accept loop spins a peer per
    // registered viewer and applies each viewer's answer in the BACKGROUND. attach must NOT block on any
    // answer — the worker loop must start to hold the run open. Here two viewers register but never answer;
    // attach must still return, publish an offer for EACH, and fan a delivered frame out to both.
    const offersFor: string[] = [];
    const pushedWidths: number[] = [];
    const fakePeer = (): RtcPeerConnectionLike => ({
      createOffer: () => Promise.resolve({ type: "offer", sdp: "v=0\r\n" }),
      createAnswer: () => Promise.resolve({ type: "answer", sdp: "v=0\r\n" }),
      setLocalDescription: () => Promise.resolve(),
      setRemoteDescription: () => Promise.resolve(),
      localDescriptionWithCandidates: (offer) => Promise.resolve(offer),
      close: () => {},
      ontrack: null,
      addVideoTrack: () => ({ pushFrame: (frame) => pushedWidths.push(frame.width), stop: () => {} })
    });
    const signaling: SinkSignalingChannel = {
      listViewers: Effect.succeed(["v1", "v2"] as readonly string[]),
      publishOfferFor: (viewerId) =>
        Effect.sync(() => {
          offersFor.push(viewerId);
        }),
      // Neither viewer ever answers — attach must not hang on this.
      awaitAnswerFor: () => Effect.never
    };

    const program = Effect.scoped(
      Effect.gen(function* () {
        const attachment = yield* createLocalSinkDriver().attach({
          signaling,
          streamId: "no-answer",
          peerConnectionFactory: fakePeer
        });
        // attach returned without any answer. Give the forked accept loop a beat to bring both viewers online
        // (publish their offers), then deliver one frame — it must fan out to BOTH viewers' tracks.
        for (let i = 0; i < 100 && offersFor.length < 2; i += 1) yield* Effect.sleep("20 millis");
        yield* attachment.deliver(makeI420Item(0, grayI420()));
        yield* attachment.finalize;
      })
    );

    // A 5s test timeout: if attach blocked on awaitAnswerFor (Effect.never), this rejects instead of passing.
    await Effect.runPromise(program);
    expect(offersFor.sort()).toEqual(["v1", "v2"]);
    expect(pushedWidths).toEqual([W, W]); // one frame fanned out to two viewers
  }, 5000);
});
