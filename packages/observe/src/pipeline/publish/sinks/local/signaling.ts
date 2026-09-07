import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";

/**
 * Minimal WebRTC abstractions for the local sink.
 *
 * These mirror the subset of the browser `RTCPeerConnection` / `RTCDataChannel`
 * surface the sink relies on, expressed as plain structural types so that:
 *  - production code can wrap a real `RTCPeerConnection` (browser / runtime), and
 *  - tests can drive a fully in-process loopback peer with no native modules.
 *
 * Signaling is intentionally the SIMPLEST a test peer can drive: a local SDP
 * exchange where the sink emits an offer and a consumer answers (see
 * `LocalSignalingHub`). Host-mediated signaling is a later option.
 */

export type RtcSdpType = "offer" | "answer";

export interface RtcSessionDescription {
  readonly type: RtcSdpType;
  readonly sdp: string;
}

export type RtcDataChannelState = "connecting" | "open" | "closing" | "closed";

export interface RtcMessageEvent {
  readonly data: Uint8Array;
}

export interface RtcDataChannelLike {
  readonly label: string;
  readonly readyState: RtcDataChannelState;
  send: (data: Uint8Array) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: RtcMessageEvent) => void) | null;
}

export interface RtcDataChannelEvent {
  readonly channel: RtcDataChannelLike;
}

export interface RtcPeerConnectionLike {
  createDataChannel: (label: string) => RtcDataChannelLike;
  createOffer: () => Promise<RtcSessionDescription>;
  createAnswer: () => Promise<RtcSessionDescription>;
  setLocalDescription: (description: RtcSessionDescription) => Promise<void>;
  setRemoteDescription: (description: RtcSessionDescription) => Promise<void>;
  close: () => void;
  ondatachannel: ((event: RtcDataChannelEvent) => void) | null;
}

export type RtcPeerConnectionFactory = () => RtcPeerConnectionLike;

/**
 * Sink-side signaling: publish the local offer, await the consumer's answer.
 */
export interface SinkSignalingChannel {
  readonly publishOffer: (offer: RtcSessionDescription) => Effect.Effect<void, LiveStreakError>;
  readonly awaitAnswer: Effect.Effect<RtcSessionDescription, LiveStreakError>;
}

/**
 * Consumer-side signaling: await the sink's offer, publish an answer.
 */
export interface ConsumerSignalingChannel {
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

  readonly sink: SinkSignalingChannel = {
    publishOffer: (offer) =>
      Effect.sync(() => {
        this.offerSlot.resolve(offer);
      }),
    awaitAnswer: Effect.promise(() => this.answerSlot.promise)
  };

  readonly consumer: ConsumerSignalingChannel = {
    awaitOffer: Effect.promise(() => this.offerSlot.promise),
    publishAnswer: (answer) =>
      Effect.sync(() => {
        this.answerSlot.resolve(answer);
      })
  };
}

export const createLocalSignalingHub = (): LocalSignalingHub => new LocalSignalingHub();

// --- in-process loopback peers (verify path, zero native deps) ---

class LoopbackDataChannel implements RtcDataChannelLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: RtcMessageEvent) => void) | null = null;
  private state: RtcDataChannelState = "connecting";
  partner: LoopbackDataChannel | undefined;

  constructor(readonly label: string) {}

  get readyState(): RtcDataChannelState {
    return this.state;
  }

  open(): void {
    if (this.state === "open") {
      return;
    }
    this.state = "open";
    this.onopen?.();
  }

  send(data: Uint8Array): void {
    if (this.state !== "open") {
      throw new Error("loopback data channel is not open");
    }
    const partner = this.partner;
    if (partner === undefined) {
      return;
    }
    // Copy to avoid aliasing the caller's buffer, mirroring real transport.
    const copy = data.slice();
    queueMicrotask(() => partner.onmessage?.({ data: copy }));
  }

  close(): void {
    if (this.state === "closed") {
      return;
    }
    this.state = "closed";
    this.onclose?.();
  }
}

interface LoopbackLink {
  offererChannel?: LoopbackDataChannel;
}

class LoopbackPeerConnection implements RtcPeerConnectionLike {
  ondatachannel: ((event: RtcDataChannelEvent) => void) | null = null;
  private readonly channels: LoopbackDataChannel[] = [];

  constructor(
    private readonly link: LoopbackLink,
    private readonly role: "offerer" | "answerer"
  ) {}

  createDataChannel(label: string): RtcDataChannelLike {
    const channel = new LoopbackDataChannel(label);
    this.channels.push(channel);
    if (this.role === "offerer") {
      this.link.offererChannel = channel;
    }
    return channel;
  }

  async createOffer(): Promise<RtcSessionDescription> {
    return { type: "offer", sdp: "loopback-offer" };
  }

  async createAnswer(): Promise<RtcSessionDescription> {
    return { type: "answer", sdp: "loopback-answer" };
  }

  async setLocalDescription(): Promise<void> {
    // No-op for the loopback transport.
  }

  async setRemoteDescription(description: RtcSessionDescription): Promise<void> {
    if (this.role !== "answerer" || description.type !== "offer") {
      return;
    }
    const offererChannel = this.link.offererChannel;
    const answererChannel = new LoopbackDataChannel(offererChannel?.label ?? "loopback");
    this.channels.push(answererChannel);
    if (offererChannel !== undefined) {
      offererChannel.partner = answererChannel;
      answererChannel.partner = offererChannel;
    }
    this.ondatachannel?.({ channel: answererChannel });
    answererChannel.open();
    offererChannel?.open();
  }

  close(): void {
    for (const channel of this.channels) {
      channel.close();
    }
  }
}

/**
 * A loopback "network": the first peer it mints is the offerer (the sink), the
 * second is the answerer (the consumer). Their data channels are cross-wired so
 * frames sent by the sink arrive at the consumer in-process.
 */
export interface LoopbackNetwork {
  readonly factory: RtcPeerConnectionFactory;
}

export const createLoopbackNetwork = (): LoopbackNetwork => {
  const link: LoopbackLink = {};
  let minted = 0;
  const factory: RtcPeerConnectionFactory = () => {
    const role = minted === 0 ? "offerer" : "answerer";
    minted += 1;
    return new LoopbackPeerConnection(link, role);
  };
  return { factory };
};

// --- default factory backed by a real RTCPeerConnection when available ---

interface BrowserRtcDataChannel {
  readonly label: string;
  readyState: string;
  binaryType: string;
  send: (data: ArrayBufferView) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
}

interface BrowserRtcPeerConnection {
  createDataChannel: (label: string) => BrowserRtcDataChannel;
  createOffer: () => Promise<RtcSessionDescription>;
  createAnswer: () => Promise<RtcSessionDescription>;
  setLocalDescription: (description: RtcSessionDescription) => Promise<void>;
  setRemoteDescription: (description: RtcSessionDescription) => Promise<void>;
  close: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
}

type BrowserRtcConstructor = new () => BrowserRtcPeerConnection;

const toUint8Array = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(0);
};

const adaptBrowserChannel = (channel: BrowserRtcDataChannel): RtcDataChannelLike => {
  channel.binaryType = "arraybuffer";
  const adapter: RtcDataChannelLike = {
    label: channel.label,
    get readyState(): RtcDataChannelState {
      return channel.readyState as RtcDataChannelState;
    },
    send: (data) => channel.send(data),
    close: () => channel.close(),
    onopen: null,
    onclose: null,
    onmessage: null
  };
  channel.addEventListener("open", () => adapter.onopen?.());
  channel.addEventListener("close", () => adapter.onclose?.());
  channel.addEventListener("message", (event) => {
    const data = toUint8Array((event as { data?: unknown }).data);
    adapter.onmessage?.({ data });
  });
  return adapter;
};

const adaptBrowserPeer = (peer: BrowserRtcPeerConnection): RtcPeerConnectionLike => {
  const adapter: RtcPeerConnectionLike = {
    createDataChannel: (label) => adaptBrowserChannel(peer.createDataChannel(label)),
    createOffer: () => peer.createOffer(),
    createAnswer: () => peer.createAnswer(),
    setLocalDescription: (description) => peer.setLocalDescription(description),
    setRemoteDescription: (description) => peer.setRemoteDescription(description),
    close: () => peer.close(),
    ondatachannel: null
  };
  peer.addEventListener("datachannel", (event) => {
    const channel = (event as { channel: BrowserRtcDataChannel }).channel;
    adapter.ondatachannel?.({ channel: adaptBrowserChannel(channel) });
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
