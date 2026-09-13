import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";

/**
 * Minimal WebRTC abstractions for the local sink.
 *
 * These mirror the subset of the browser `RTCPeerConnection` surface the sink relies on, expressed as plain
 * structural types so production code can wrap a real `RTCPeerConnection` (browser / @roamhq/wrtc) while
 * tests drive an in-process fake. Video rides a real media TRACK (RTCVideoSource → RTP), not a data channel.
 *
 * Signaling is intentionally the SIMPLEST a test peer can drive: a local SDP exchange where the sink emits
 * an offer and a consumer answers (see `LocalSignalingHub`). Host-mediated signaling relays the same SDP.
 */

export type RtcSdpType = "offer" | "answer";

export interface RtcSessionDescription {
  readonly type: RtcSdpType;
  readonly sdp: string;
}

/** One I420 (yuv420p) video frame pushed into an outbound track. `data` is width*height*3/2 bytes. */
export interface RtcVideoFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * Producer-side handle to an outbound WebRTC VIDEO TRACK — real RTP media, not a data channel. The sink
 * pushes each decoded frame with {@link pushFrame} and the transport (RTCVideoSource → RTP) sends it live
 * to the viewer, who receives it as a normal `MediaStreamTrack`. This is what makes streaming real-time.
 */
export interface RtcVideoTrackHandle {
  readonly pushFrame: (frame: RtcVideoFrame) => void;
  readonly stop: () => void;
}

/**
 * Consumer-side inbound track event. `streams[0]` is the real browser `MediaStream` the app assigns to
 * `<video>.srcObject` (opaque here — observe never touches the DOM); `track` is the raw `MediaStreamTrack`,
 * used to synthesize a stream when the producer added the track without a stream. Mirrors `RTCTrackEvent`.
 */
export interface RtcTrackEvent {
  readonly streams: readonly unknown[];
  readonly track?: unknown;
}

export interface RtcPeerConnectionLike {
  createOffer: () => Promise<RtcSessionDescription>;
  createAnswer: () => Promise<RtcSessionDescription>;
  setLocalDescription: (description: RtcSessionDescription) => Promise<void>;
  setRemoteDescription: (description: RtcSessionDescription) => Promise<void>;
  /** Non-trickle ICE: wait for ICE gathering, then return the local description with its candidates
   *  embedded. The host signaling relays only the offer/answer SDP (no separate candidate channel), so the
   *  candidates must ride inside it or the peers never connect. `fallback` is the just-set description,
   *  returned when the impl exposes no gathered description (the loopback test peer). */
  localDescriptionWithCandidates: (fallback: RtcSessionDescription) => Promise<RtcSessionDescription>;
  close: () => void;
  /**
   * Add an outbound video track (PRODUCER). Must be called BEFORE `createOffer` so the offer carries the
   * video m-line. Present only on transports with media support (the Node @roamhq/wrtc producer); undefined
   * on the signaling-only loopback test transport.
   */
  addVideoTrack?: () => RtcVideoTrackHandle;
  /** Inbound remote track handler (CONSUMER): fires with the remote `MediaStream` once media negotiates. */
  ontrack?: ((event: RtcTrackEvent) => void) | null;
}

/**
 * Poll until ICE gathering completes (host/LAN candidates land in a few ms), then hand back the
 * candidate-rich local description. Falls back to the passed description if gathering stalls or the impl
 * never populates `localDescription`. Shared by the browser + Node ( @roamhq/wrtc ) adapters.
 */
export const gatheredLocalDescription = async (
  peer: { readonly iceGatheringState: string; readonly localDescription: RtcSessionDescription | null },
  fallback: RtcSessionDescription,
  timeoutMs = 3000
): Promise<RtcSessionDescription> => {
  const deadline = Date.now() + timeoutMs;
  while (peer.iceGatheringState !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return peer.localDescription ?? fallback;
};

export type RtcPeerConnectionFactory = () => RtcPeerConnectionLike;

/**
 * Sink-side (producer) signaling — MULTI-VIEWER. One producer serves many viewers: it polls for viewers
 * that want in, mints a per-viewer offer, and awaits that viewer's answer. Each viewer id ⇒ its own peer +
 * encode on the producer (bounded by the producer's CPU/bandwidth, before any SFU).
 */
export interface SinkSignalingChannel {
  /** Viewer ids currently wanting to watch (the producer polls this and spins a peer per new id). */
  readonly listViewers: Effect.Effect<readonly string[], LiveStreakError>;
  readonly publishOfferFor: (
    viewerId: string,
    offer: RtcSessionDescription
  ) => Effect.Effect<void, LiveStreakError>;
  readonly awaitAnswerFor: (viewerId: string) => Effect.Effect<RtcSessionDescription, LiveStreakError>;
}

/**
 * Consumer-side (viewer) signaling: announce intent (register), await THIS viewer's offer, publish an answer.
 * The viewer id is baked into the channel instance.
 */
export interface ConsumerSignalingChannel {
  readonly register: Effect.Effect<void, LiveStreakError>;
  readonly awaitOffer: Effect.Effect<RtcSessionDescription, LiveStreakError>;
  readonly publishAnswer: (answer: RtcSessionDescription) => Effect.Effect<void, LiveStreakError>;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/**
 * In-process local SDP rendezvous. The same hub exposes a sink side and a
 * consumer side; they exchange descriptions through shared promises. This keeps
 * the whole exchange self-contained — no network, no external signaling server.
 */
export class LocalSignalingHub {
  private readonly offerSlot = deferred<RtcSessionDescription>();
  private readonly answerSlot = deferred<RtcSessionDescription>();
  private readonly registeredSlot = deferred<void>();
  private registered = false;
  // A loopback hub carries exactly one viewer (the in-process consumer) — enough to exercise the SDP
  // rendezvous and media path in tests. Multi-viewer fan-out is exercised by the host relay + live tests.
  static readonly viewerId = "loopback-viewer";

  readonly sink: SinkSignalingChannel = {
    // Blocks until the consumer registers, then reports the one viewer on every poll (the accept loop dedupes).
    listViewers: Effect.promise(() =>
      this.registeredSlot.promise.then(() => [LocalSignalingHub.viewerId] as readonly string[])
    ),
    publishOfferFor: (_viewerId, offer) =>
      Effect.sync(() => {
        this.offerSlot.resolve(offer);
      }),
    awaitAnswerFor: (_viewerId) => Effect.promise(() => this.answerSlot.promise)
  };

  readonly consumer: ConsumerSignalingChannel = {
    register: Effect.sync(() => {
      if (!this.registered) {
        this.registered = true;
        this.registeredSlot.resolve();
      }
    }),
    awaitOffer: Effect.promise(() => this.offerSlot.promise),
    publishAnswer: (answer) =>
      Effect.sync(() => {
        this.answerSlot.resolve(answer);
      })
  };
}

export const createLocalSignalingHub = (): LocalSignalingHub => new LocalSignalingHub();

// --- in-process signaling-only loopback peer (drives the SDP exchange in tests, zero native deps) ---

class LoopbackPeerConnection implements RtcPeerConnectionLike {
  ontrack: ((event: RtcTrackEvent) => void) | null = null;

  constructor(private readonly role: "offerer" | "answerer") {}

  async createOffer(): Promise<RtcSessionDescription> {
    return { type: "offer", sdp: "loopback-offer" };
  }

  async createAnswer(): Promise<RtcSessionDescription> {
    return { type: "answer", sdp: "loopback-answer" };
  }

  async setLocalDescription(): Promise<void> {
    // No-op for the loopback transport.
  }

  async setRemoteDescription(): Promise<void> {
    // No media exchange in the loopback — this transport only exercises the SDP rendezvous.
    void this.role;
  }

  async localDescriptionWithCandidates(fallback: RtcSessionDescription): Promise<RtcSessionDescription> {
    return fallback; // loopback has no ICE — the description is already complete
  }

  close(): void {
    // Nothing to tear down.
  }
}

/** A loopback "network": the first peer it mints is the offerer (the sink), the second the answerer. */
export interface LoopbackNetwork {
  readonly factory: RtcPeerConnectionFactory;
}

export const createLoopbackNetwork = (): LoopbackNetwork => {
  let minted = 0;
  const factory: RtcPeerConnectionFactory = () => {
    const role = minted === 0 ? "offerer" : "answerer";
    minted += 1;
    return new LoopbackPeerConnection(role);
  };
  return { factory };
};

// --- default factory backed by a real RTCPeerConnection when available ---

interface BrowserRtcPeerConnection {
  createOffer: () => Promise<RtcSessionDescription>;
  createAnswer: () => Promise<RtcSessionDescription>;
  setLocalDescription: (description: RtcSessionDescription) => Promise<void>;
  setRemoteDescription: (description: RtcSessionDescription) => Promise<void>;
  readonly iceGatheringState: string;
  readonly localDescription: RtcSessionDescription | null;
  close: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
}

type BrowserRtcConstructor = new () => BrowserRtcPeerConnection;

const adaptBrowserPeer = (peer: BrowserRtcPeerConnection): RtcPeerConnectionLike => {
  const adapter: RtcPeerConnectionLike = {
    createOffer: () => peer.createOffer(),
    createAnswer: () => peer.createAnswer(),
    setLocalDescription: (description) => peer.setLocalDescription(description),
    setRemoteDescription: (description) => peer.setRemoteDescription(description),
    localDescriptionWithCandidates: (fallback) => gatheredLocalDescription(peer, fallback),
    close: () => peer.close(),
    ontrack: null
  };
  // Inbound video track (consumer): surface the remote MediaStream for `<video>.srcObject`.
  peer.addEventListener("track", (event) => {
    const typed = event as { streams?: readonly unknown[]; track?: unknown };
    adapter.ontrack?.({ streams: typed.streams ?? [], track: typed.track });
  });
  return adapter;
};

/**
 * Default peer factory. Uses a real `RTCPeerConnection` when one is present on
 * the global scope (browser or a runtime that polyfills WebRTC). In a plain
 * Node process without WebRTC it fails with a clear error directing callers to
 * inject a `peerConnectionFactory` (e.g. the loopback network for tests).
 */
export const resolveDefaultPeerFactory = (): Effect.Effect<RtcPeerConnectionFactory, LiveStreakError> =>
  Effect.sync(() => {
    const ctor = (globalThis as { RTCPeerConnection?: BrowserRtcConstructor }).RTCPeerConnection;
    if (ctor === undefined) {
      return undefined;
    }
    return () => adaptBrowserPeer(new ctor());
  }).pipe(
    Effect.flatMap((factory) =>
      factory === undefined
        ? Effect.fail(
            new LiveStreakRuntimeError({
              message:
                "Local WebRTC sink requires a peerConnectionFactory: no global RTCPeerConnection is available"
            })
          )
        : Effect.succeed(factory)
    )
  );
