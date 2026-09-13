// SEAM-WEBRTC — host-mediated SDP signaling relay, PER-VIEWER (multi-viewer).
//
// The CLI producer is the OFFERER; each browser viewer is an ANSWERER. One producer serves MANY viewers
// directly (a peer connection + encode per viewer — bounded by the producer's CPU/bandwidth, before any
// SFU). So signaling is keyed by (streamId, viewerId): a viewer registers, the producer discovers it,
// mints a per-viewer offer, and swaps SDP for that one viewer. Media then flows producer->viewer over the
// host's TURN relay (see turn.ts).
//
// PUBLISHED WIRE SHAPE:
//   POST /webrtc/signal/:streamId/viewers/:viewerId              -> 201  (viewer registers intent)
//   GET  /webrtc/signal/:streamId/viewers                        -> 200 { viewers: string[] }  (producer polls)
//   POST /webrtc/signal/:streamId/viewers/:viewerId/offer        -> 201  (producer posts that viewer's offer)
//   GET  /webrtc/signal/:streamId/viewers/:viewerId/offer        -> 200 SignalPayload | 404
//   POST /webrtc/signal/:streamId/viewers/:viewerId/answer       -> 201  (viewer posts its answer)
//   GET  /webrtc/signal/:streamId/viewers/:viewerId/answer       -> 200 SignalPayload | 404
//   DELETE /webrtc/signal/:streamId/viewers/:viewerId            -> 200  (viewer leaves / producer reaps)
//   DELETE /webrtc/signal/:streamId                              -> 200  (tear the whole stream down)

export interface SignalPayload {
  readonly type: "offer" | "answer";
  readonly sdp: string;
  readonly candidates?: readonly unknown[];
  readonly createdAtMs?: number;
}

interface ViewerSlot {
  offer?: SignalPayload;
  answer?: SignalPayload;
  createdAtMs: number;
}

export interface SignalingStore {
  /** A viewer announces intent to watch (idempotent) — the producer discovers it via listViewers. */
  registerViewer(streamId: string, viewerId: string, nowMs?: number): void;
  /** Viewer ids currently registered for a stream (the producer polls this to mint per-viewer offers). */
  listViewers(streamId: string): string[];
  setViewerOffer(streamId: string, viewerId: string, payload: SignalPayload): void;
  getViewerOffer(streamId: string, viewerId: string): SignalPayload | null;
  setViewerAnswer(streamId: string, viewerId: string, payload: SignalPayload): void;
  getViewerAnswer(streamId: string, viewerId: string): SignalPayload | null;
  /** Drop one viewer (left / reaped). */
  removeViewer(streamId: string, viewerId: string): void;
  /** Drop the whole stream and all its viewers. */
  clear(streamId: string): void;
}

export const createSignalingStore = (clock: () => number = () => Date.now()): SignalingStore => {
  const streams = new Map<string, Map<string, ViewerSlot>>();

  const viewers = (streamId: string): Map<string, ViewerSlot> => {
    let m = streams.get(streamId);
    if (m === undefined) {
      m = new Map();
      streams.set(streamId, m);
    }
    return m;
  };

  const slot = (streamId: string, viewerId: string): ViewerSlot => {
    const m = viewers(streamId);
    let s = m.get(viewerId);
    if (s === undefined) {
      s = { createdAtMs: clock() };
      m.set(viewerId, s);
    }
    return s;
  };

  return {
    registerViewer(streamId, viewerId) {
      slot(streamId, viewerId);
    },
    listViewers(streamId) {
      return [...(streams.get(streamId)?.keys() ?? [])];
    },
    setViewerOffer(streamId, viewerId, payload) {
      // A fresh offer supersedes any prior session for this viewer (clears the stale answer).
      viewers(streamId).set(viewerId, {
        offer: { ...payload, createdAtMs: payload.createdAtMs ?? clock() },
        createdAtMs: clock()
      });
    },
    getViewerOffer(streamId, viewerId) {
      return streams.get(streamId)?.get(viewerId)?.offer ?? null;
    },
    setViewerAnswer(streamId, viewerId, payload) {
      slot(streamId, viewerId).answer = { ...payload, createdAtMs: payload.createdAtMs ?? clock() };
    },
    getViewerAnswer(streamId, viewerId) {
      return streams.get(streamId)?.get(viewerId)?.answer ?? null;
    },
    removeViewer(streamId, viewerId) {
      streams.get(streamId)?.delete(viewerId);
    },
    clear(streamId) {
      streams.delete(streamId);
    }
  };
};

export const parseSignalPayload = (
  body: unknown,
  expected: "offer" | "answer"
): SignalPayload | null => {
  if (body === null || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.type !== expected || typeof b.sdp !== "string" || b.sdp.length === 0) return null;
  return {
    type: expected,
    sdp: b.sdp,
    ...(Array.isArray(b.candidates) ? { candidates: b.candidates } : {})
  };
};
