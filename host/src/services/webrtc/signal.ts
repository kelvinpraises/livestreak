// SEAM-WEBRTC — host-mediated SDP signaling relay (issue 10).
//
// The CLI file->WebRTC sink (agent-4) is the OFFERER; the browser peer (agent-1) is the
// ANSWERER. They live in different processes, so they need a rendezvous to swap SDP. This
// host relays that swap and nothing else — media then flows peer-to-peer, all local. No
// TURN/SFU. Non-trickle ICE: candidates are bundled in the SDP, so a single offer + single
// answer completes the exchange.
//
// PUBLISHED WIRE SHAPE (agent-4 offerer + agent-1 answerer build to this):
//
//   POST /webrtc/signal/:streamId/offer    body: SignalPayload(type:"offer")   -> 201 {ok:true}
//   GET  /webrtc/signal/:streamId/offer                                        -> 200 SignalPayload | 404
//   POST /webrtc/signal/:streamId/answer   body: SignalPayload(type:"answer")  -> 201 {ok:true}
//   GET  /webrtc/signal/:streamId/answer                                       -> 200 SignalPayload | 404
//   DELETE /webrtc/signal/:streamId                                            -> 200 {ok:true}
//
// `:streamId` is the stream/market id the offer is keyed by. `sdp` is the full RTCSession-
// Description sdp string. `candidates` is optional (bundled trickle); omit for non-trickle.

export interface SignalPayload {
  readonly type: "offer" | "answer";
  readonly sdp: string;
  readonly candidates?: readonly unknown[];
  readonly createdAtMs?: number;
}

interface SignalSlot {
  offer?: SignalPayload;
  answer?: SignalPayload;
}

export interface SignalingStore {
  setOffer(streamId: string, payload: SignalPayload): void;
  getOffer(streamId: string): SignalPayload | null;
  setAnswer(streamId: string, payload: SignalPayload): void;
  getAnswer(streamId: string): SignalPayload | null;
  clear(streamId: string): void;
}

export const createSignalingStore = (): SignalingStore => {
  const slots = new Map<string, SignalSlot>();
  const slot = (streamId: string): SignalSlot => {
    let s = slots.get(streamId);
    if (s === undefined) {
      s = {};
      slots.set(streamId, s);
    }
    return s;
  };
  return {
    setOffer(streamId, payload) {
      // A fresh offer supersedes any prior session for this stream id.
      slots.set(streamId, { offer: { ...payload, createdAtMs: payload.createdAtMs ?? Date.now() } });
    },
    getOffer(streamId) {
      return slots.get(streamId)?.offer ?? null;
    },
    setAnswer(streamId, payload) {
      slot(streamId).answer = { ...payload, createdAtMs: payload.createdAtMs ?? Date.now() };
    },
    getAnswer(streamId) {
      return slots.get(streamId)?.answer ?? null;
    },
    clear(streamId) {
      slots.delete(streamId);
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
