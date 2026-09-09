import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { RtcDataChannelState, RtcPeerConnectionFactory, RtcPeerConnectionLike } from "./signaling.js";
import { resolveDefaultPeerFactory } from "./signaling.js";

/**
 * Node.js RTCPeerConnection factory for the CLI file→WebRTC producer.
 *
 * Tries `@roamhq/wrtc` when installed (optional dependency). Plain Node without
 * WebRTC fails with a clear message — inject a factory in tests via loopback.
 */

type WrtcModule = {
  readonly RTCPeerConnection: new (config?: unknown) => NodeRtcPeer;
};

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

interface NodeRtcDataChannel {
  readonly label: string;
  readonly readyState: string;
  send: (data: Uint8Array) => void;
  close: () => void;
  addEventListener: (type: string, listener: (...args: unknown[]) => void) => void;
  binaryType?: string;
}

interface NodeRtcPeer {
  createDataChannel: (label: string) => NodeRtcDataChannel;
  createOffer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  createAnswer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  setLocalDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  setRemoteDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  close: () => void;
  addEventListener: (type: string, listener: (event: { channel: NodeRtcDataChannel }) => void) => void;
}

const adaptNodeChannel = (channel: NodeRtcDataChannel) => {
  channel.binaryType = "arraybuffer";
  const adapter = {
    label: channel.label,
    get readyState(): RtcDataChannelState {
      return channel.readyState as RtcDataChannelState;
    },
    send: (data: Uint8Array) => channel.send(data),
    close: () => channel.close(),
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    onmessage: null as ((event: { data: Uint8Array }) => void) | null
  };
  channel.addEventListener("open", () => adapter.onopen?.());
  channel.addEventListener("close", () => adapter.onclose?.());
  channel.addEventListener("message", (event: unknown) => {
    const data = (event as { data?: unknown }).data;
    const bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(0);
    adapter.onmessage?.({ data: bytes });
  });
  return adapter;
};

const adaptNodePeer = (peer: NodeRtcPeer): RtcPeerConnectionLike => {
  const adapter: RtcPeerConnectionLike = {
    createDataChannel: (label) => adaptNodeChannel(peer.createDataChannel(label)),
    createOffer: () => peer.createOffer(),
    createAnswer: () => peer.createAnswer(),
    setLocalDescription: (d) => peer.setLocalDescription(d),
    setRemoteDescription: (d) => peer.setRemoteDescription(d),
    close: () => peer.close(),
    ondatachannel: null
  };
  peer.addEventListener("datachannel", (event) => {
    adapter.ondatachannel?.({ channel: adaptNodeChannel(event.channel) });
  });
  return adapter;
};

export const resolveNodePeerConnectionFactory = (): Effect.Effect<
  RtcPeerConnectionFactory,
  LiveStreakError
> =>
  Effect.gen(function* () {
    if ((globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection !== undefined) {
      return yield* resolveDefaultPeerFactory();
    }

    let wrtc: WrtcModule | undefined;
    try {
      wrtc = (yield* Effect.promise(() => importNode("@roamhq/wrtc"))) as WrtcModule;
    } catch {
      wrtc = undefined;
    }

    if (wrtc?.RTCPeerConnection === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message:
            "Node file→WebRTC requires @roamhq/wrtc (optional dep) or a peerConnectionFactory injection"
        })
      );
    }

    const Ctor = wrtc.RTCPeerConnection;
    return () => adaptNodePeer(new Ctor({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }));
  });
