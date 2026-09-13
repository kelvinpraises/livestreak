import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type {
  RtcPeerConnectionFactory,
  RtcPeerConnectionLike,
  RtcVideoTrackHandle
} from "./signaling.js";
import { gatheredLocalDescription, resolveDefaultPeerFactory } from "./signaling.js";

/**
 * Node.js RTCPeerConnection factory for the CLI file→WebRTC producer.
 *
 * Tries `@roamhq/wrtc` when installed (optional dependency). Plain Node without
 * WebRTC fails with a clear message — inject a factory in tests via loopback.
 */

interface NodeVideoTrack {
  stop: () => void;
}

interface NodeRtcVideoSource {
  createTrack: () => NodeVideoTrack;
  onFrame: (frame: { width: number; height: number; data: Uint8ClampedArray }) => void;
}

type WrtcModule = {
  readonly RTCPeerConnection: new (config?: unknown) => NodeRtcPeer;
  readonly nonstandard?: {
    readonly RTCVideoSource: new () => NodeRtcVideoSource;
  };
};

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

interface NodeRtcPeer {
  addTrack: (track: NodeVideoTrack) => unknown;
  createOffer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  createAnswer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  setLocalDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  setRemoteDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  readonly iceGatheringState: string;
  readonly localDescription: { type: "offer" | "answer"; sdp: string } | null;
  close: () => void;
}

const adaptNodeVideoTrack = (
  peer: NodeRtcPeer,
  VideoSource: new () => NodeRtcVideoSource
): RtcVideoTrackHandle => {
  const source = new VideoSource();
  const track = source.createTrack();
  peer.addTrack(track);
  return {
    // RTCVideoSource wants an I420 buffer as Uint8ClampedArray; wrap the frame bytes without copying.
    pushFrame: (frame) =>
      source.onFrame({
        width: frame.width,
        height: frame.height,
        data:
          frame.data instanceof Uint8ClampedArray
            ? frame.data
            : new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
      }),
    stop: () => track.stop()
  };
};

const adaptNodePeer = (
  peer: NodeRtcPeer,
  VideoSource: (new () => NodeRtcVideoSource) | undefined
): RtcPeerConnectionLike => {
  const adapter: RtcPeerConnectionLike = {
    createOffer: () => peer.createOffer(),
    createAnswer: () => peer.createAnswer(),
    setLocalDescription: (d) => peer.setLocalDescription(d),
    setRemoteDescription: (d) => peer.setRemoteDescription(d),
    localDescriptionWithCandidates: (fallback) => gatheredLocalDescription(peer, fallback),
    close: () => peer.close(),
    ontrack: null,
    ...(VideoSource === undefined ? {} : { addVideoTrack: () => adaptNodeVideoTrack(peer, VideoSource) })
  };
  return adapter;
};

export type NodeIceConfig = {
  readonly iceServers?: readonly { urls: string; username?: string; credential?: string }[];
  readonly relayOnly?: boolean;
};

// Discover the host's self-described ICE (GET /webrtc/ice → bare {iceServers, relayOnly}) so the
// producer streams over a reachable relay with zero manual env — turnkey go-live. Best-effort: any
// failure (network, non-OK status, malformed JSON) yields undefined and the caller falls back to
// env/STUN in resolveNodeIceOptions; prepare is never broken by it.
export const fetchHostIceConfig = (
  hostBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): Effect.Effect<NodeIceConfig | undefined> =>
  Effect.tryPromise(async () => {
    const res = await fetchImpl(`${hostBaseUrl.replace(/\/$/, "")}/webrtc/ice`);
    if (!res.ok) return undefined;
    return (await res.json()) as NodeIceConfig;
  }).pipe(Effect.orElseSucceed(() => undefined));

export interface NodeIceOptions {
  readonly iceServers: { urls: string; username?: string; credential?: string }[];
  readonly relayOnly: boolean;
}

// Precedence: explicit env (operator override) → host-described ICE → STUN-only default. relayOnly can
// be forced on by env (LIVESTREAK_ICE_RELAY_ONLY=1); the host advises it whenever its embedded TURN is
// up — dev peers (Docker container, Chromium mDNS host candidates) can't do direct, so the reachable
// path is the relay.
export const resolveNodeIceOptions = (
  iceConfig?: NodeIceConfig,
  env: { readonly iceServersJson?: string; readonly relayOnly?: string } = {
    ...(process.env.LIVESTREAK_ICE_SERVERS === undefined
      ? {}
      : { iceServersJson: process.env.LIVESTREAK_ICE_SERVERS }),
    ...(process.env.LIVESTREAK_ICE_RELAY_ONLY === undefined
      ? {}
      : { relayOnly: process.env.LIVESTREAK_ICE_RELAY_ONLY })
  }
): NodeIceOptions => {
  const iceServers = (() => {
    if (env.iceServersJson !== undefined && env.iceServersJson.trim() !== "") {
      try {
        return JSON.parse(env.iceServersJson) as NodeIceOptions["iceServers"];
      } catch {
        /* malformed → fall through */
      }
    }
    if (iceConfig?.iceServers && iceConfig.iceServers.length > 0) {
      return [...iceConfig.iceServers];
    }
    return [{ urls: "stun:stun.l.google.com:19302" }];
  })();

  return { iceServers, relayOnly: env.relayOnly === "1" || (iceConfig?.relayOnly ?? false) };
};

export const resolveNodePeerConnectionFactory = (
  iceConfig?: NodeIceConfig
): Effect.Effect<RtcPeerConnectionFactory, LiveStreakError> =>
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
    const VideoSource = wrtc.nonstandard?.RTCVideoSource;
    const { iceServers, relayOnly } = resolveNodeIceOptions(iceConfig);
    return () =>
      adaptNodePeer(
        new Ctor(relayOnly ? { iceServers, iceTransportPolicy: "relay" } : { iceServers }),
        VideoSource
      );
  });
