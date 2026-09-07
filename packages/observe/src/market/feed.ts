import type { MarketStorageScheme, StreamId } from "./types.js";

/**
 * Per-stream feed resolution (issue 7).
 *
 * The app must show ITS feed for each stream rather than one global static
 * asset. A feed is keyed to the market/stream id end-to-end: while the stream is
 * live it is a WebRTC feed reached through the host relay slot for that id (the
 * `streamFileToWebRtc` sink posts its offer there); once ended it resolves to
 * the VOD pointer recorded on-chain by the lifecycle writer.
 *
 * observe owns the producer/publish path, so it owns the SHAPE the app resolves.
 * The app passes a `streamId` (+ the on-chain pointer if the stream has ended)
 * and gets back a discriminated feed it can render without guessing.
 */
export type StreamFeed = LiveStreamFeed | VodStreamFeed;

export interface LiveStreamFeed {
  readonly kind: "webrtc";
  readonly streamId: string;
  /**
   * Relay-relative signaling path keyed by the stream id. The browser fetches
   * the offer here and posts its answer (agent-2's `/webrtc/signal` relay).
   */
  readonly signalPath: string;
}

export interface VodStreamFeed {
  readonly kind: "vod";
  readonly streamId: string;
  readonly scheme: MarketStorageScheme;
  /** Storage pointer id (the same id the lifecycle writer recorded on-chain). */
  readonly pointer: string;
}

export interface VodPointer {
  readonly scheme: MarketStorageScheme;
  readonly pointer: string;
}

export interface ResolveStreamFeedInput {
  readonly streamId: StreamId | string;
  /** When present, the stream has ended and resolves to this VOD pointer. */
  readonly vod?: VodPointer;
}

/** Relay signaling path for a stream id — the single source of the key. */
export const streamFeedSignalPath = (streamId: string): string =>
  `/webrtc/signal/${encodeURIComponent(streamId)}`;

export const resolveStreamFeed = (input: ResolveStreamFeedInput): StreamFeed => {
  const streamId = String(input.streamId);
  if (input.vod !== undefined) {
    return {
      kind: "vod",
      streamId,
      scheme: input.vod.scheme,
      pointer: input.vod.pointer
    };
  }
  return {
    kind: "webrtc",
    streamId,
    signalPath: streamFeedSignalPath(streamId)
  };
};
