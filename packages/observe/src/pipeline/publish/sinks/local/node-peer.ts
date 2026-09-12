import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { RtcDataChannelState, RtcPeerConnectionFactory, RtcPeerConnectionLike } from "./signaling.js";
import { gatheredLocalDescription, resolveDefaultPeerFactory } from "./signaling.js";

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
  readonly bufferedAmount?: number;
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
  readonly iceGatheringState: string;
  readonly localDescription: { type: "offer" | "answer"; sdp: string } | null;
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
    get bufferedAmount(): number {
      return channel.bufferedAmount ?? 0;
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
    localDescriptionWithCandidates: (fallback) => gatheredLocalDescription(peer, fallback),
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
      // @roamhq/wrtc is CJS — under ESM `import()` its exports land on `.default`, so unwrap it.
      const mod = (yield* Effect.promise(() => importNode("@roamhq/wrtc"))) as
        | WrtcModule
        | { readonly default?: WrtcModule };
      wrtc = (mod as { default?: WrtcModule }).default ?? (mod as WrtcModule);
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
    // ICE servers are env-overridable (LIVESTREAK_ICE_SERVERS = JSON array) so a
    // Dockerized/remote producer can point at a TURN relay; default stays STUN-only.
    const iceServers: { urls: string; username?: string; credential?: string }[] = (() => {
      const raw = process.env.LIVESTREAK_ICE_SERVERS;
      if (raw !== undefined && raw.trim() !== "") {
        try {
          return JSON.parse(raw) as { urls: string; username?: string; credential?: string }[];
        } catch {
          /* malformed → STUN default */
        }
      }
      return [{ urls: "stun:stun.l.google.com:19302" }];
    })();
    // Relay-only (LIVESTREAK_ICE_RELAY_ONLY=1) forces TURN. A Dockerized producer's
    // host candidates are container-private (unreachable from the viewer), so without
    // this ICE stalls on them instead of using the reachable TURN relay.
    const relayOnly = process.env.LIVESTREAK_ICE_RELAY_ONLY === "1";
    return () =>
      adaptNodePeer(new Ctor(relayOnly ? { iceServers, iceTransportPolicy: "relay" } : { iceServers }));
  });
