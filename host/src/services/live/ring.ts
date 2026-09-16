// SEAM-LIVE — fMP4 ingest ring buffer + viewer fan-out.
//
// The producer encodes ONE fragmented-MP4 stream and pushes init + fragments over a single ingest socket
// (see observe's live sink). The host holds a bounded ring per stream key — the init segment plus the last
// N media fragments (byte-capped) — and fans the SAME bytes out to every viewer. A late joiner gets the
// init + the current keyframe-led backlog, then live-tails. This is the encode-once byte fan-out that
// replaces the per-viewer WebRTC mesh: the producer's cost is linear bandwidth, not a per-viewer encode.
//
// Slow-viewer policy (mirrors observe's timeline latest-wins at segment granularity): each viewer has a
// bounded send queue; when it overflows we drop the OLDEST buffered fragments and skip forward, so one slow
// viewer never stalls the producer or other viewers. A viewer that falls too far behind resyncs from the
// next fragment — live means live.

export interface LiveFragment {
  readonly seq: number;
  readonly data: Uint8Array;
}

export type ViewerFrame =
  | { readonly kind: "init"; readonly data: Uint8Array }
  | { readonly kind: "fragment"; readonly data: Uint8Array }
  | { readonly kind: "end"; readonly reason?: string };

export type ViewerSink = (frame: ViewerFrame) => void;

// Keep the last N fragments so a late joiner has a keyframe-led backlog to prime MSE, byte-capped so a
// high-bitrate stream cannot balloon host memory. Defaults chosen per the migration brief (N≈8–16).
export const DEFAULT_RING_FRAGMENTS = 12;
export const DEFAULT_RING_BYTES = 24 * 1024 * 1024; // 24 MiB per stream
// Per-viewer outbound backlog cap: a viewer slower than this many fragments is skipped forward.
export const DEFAULT_VIEWER_QUEUE = 8;

export interface LiveRingConfig {
  readonly maxFragments: number;
  readonly maxBytes: number;
  readonly viewerQueue: number;
}

const defaultConfig: LiveRingConfig = {
  maxFragments: DEFAULT_RING_FRAGMENTS,
  maxBytes: DEFAULT_RING_BYTES,
  viewerQueue: DEFAULT_VIEWER_QUEUE
};

interface StreamState {
  init?: Uint8Array;
  fragments: LiveFragment[];
  bytes: number;
  seq: number;
  ended: boolean;
  endReason?: string;
  viewers: Map<string, ViewerState>;
}

interface ViewerState {
  readonly sink: ViewerSink;
  // Highest fragment seq this viewer has been sent (its live cursor). -1 = only primed with backlog head.
  lastSeq: number;
}

export interface LiveRingStore {
  /** Producer sets/replaces the init segment (re-sent on reconnect). Resets any prior end state. */
  setInit(streamId: string, data: Uint8Array): void;
  /** Producer appends a media fragment; fanned out live, added to the ring, oldest evicted past caps. */
  pushFragment(streamId: string, data: Uint8Array): void;
  /** Producer signals a clean end; viewers get an end frame, the stream is marked ended. */
  end(streamId: string, reason?: string): void;
  /** Fully drop a stream (producer socket closed with no end, or reaped). */
  clear(streamId: string): void;
  /**
   * Attach a viewer: immediately primed with init + the current backlog (or an end frame if already ended),
   * then live-tailed by subsequent pushFragment calls. Returns a detach fn.
   */
  addViewer(streamId: string, viewerId: string, sink: ViewerSink): () => void;
  /** Viewer count for a stream (diagnostics/tests). */
  viewerCount(streamId: string): number;
  /** True once a producer has sent an init for this stream and it has not ended. */
  isLive(streamId: string): boolean;
}

export const createLiveRingStore = (config: LiveRingConfig = defaultConfig): LiveRingStore => {
  const streams = new Map<string, StreamState>();

  const stream = (streamId: string): StreamState => {
    let s = streams.get(streamId);
    if (s === undefined) {
      s = { fragments: [], bytes: 0, seq: 0, ended: false, viewers: new Map() };
      streams.set(streamId, s);
    }
    return s;
  };

  // Send a frame to one viewer; a throwing sink (dead socket) is swallowed so it never breaks fan-out.
  const emit = (v: ViewerState, frame: ViewerFrame): void => {
    try {
      v.sink(frame);
    } catch {
      /* dead viewer sink — the ws close handler will detach it */
    }
  };

  // Evict oldest fragments until within both caps. Init is never evicted (it primes every late joiner).
  const trim = (s: StreamState): void => {
    while (s.fragments.length > config.maxFragments || (s.bytes > config.maxBytes && s.fragments.length > 1)) {
      const dropped = s.fragments.shift();
      if (dropped === undefined) break;
      s.bytes -= dropped.data.byteLength;
    }
  };

  return {
    setInit(streamId, data) {
      const s = stream(streamId);
      s.init = data;
      // A fresh init (reconnect) reopens the stream and re-primes existing viewers so MSE re-inits.
      s.ended = false;
      s.endReason = undefined;
      for (const v of s.viewers.values()) emit(v, { kind: "init", data });
    },

    pushFragment(streamId, data) {
      const s = stream(streamId);
      s.seq += 1;
      const fragment: LiveFragment = { seq: s.seq, data };
      s.fragments.push(fragment);
      s.bytes += data.byteLength;
      trim(s);
      // Live-tail every viewer. A viewer whose cursor has fallen more than the queue cap behind the ring
      // head is skipped forward (drop-oldest): it resumes from THIS fragment rather than stalling.
      const oldestSeq = s.fragments[0]?.seq ?? s.seq;
      for (const v of s.viewers.values()) {
        if (s.seq - v.lastSeq > config.viewerQueue) {
          v.lastSeq = Math.max(v.lastSeq, oldestSeq - 1); // skip forward; next send is the head
        }
        emit(v, { kind: "fragment", data });
        v.lastSeq = s.seq;
      }
    },

    end(streamId, reason) {
      const s = streams.get(streamId);
      if (s === undefined) return;
      s.ended = true;
      s.endReason = reason;
      for (const v of s.viewers.values()) emit(v, { kind: "end", reason });
    },

    clear(streamId) {
      const s = streams.get(streamId);
      if (s !== undefined) {
        for (const v of s.viewers.values()) emit(v, { kind: "end", reason: s.endReason ?? "stream_closed" });
      }
      streams.delete(streamId);
    },

    addViewer(streamId, viewerId, sink) {
      const s = stream(streamId);
      const state: ViewerState = { sink, lastSeq: s.seq };
      s.viewers.set(viewerId, state);

      // Prime: init first (MSE needs it before any fragment), then the current backlog so playback can
      // start on a keyframe. If the stream already ended, still deliver what we have then the end signal.
      if (s.init !== undefined) emit(state, { kind: "init", data: s.init });
      for (const f of s.fragments) emit(state, { kind: "fragment", data: f.data });
      if (s.ended) emit(state, { kind: "end", reason: s.endReason });

      return () => {
        s.viewers.delete(viewerId);
      };
    },

    viewerCount(streamId) {
      return streams.get(streamId)?.viewers.size ?? 0;
    },

    isLive(streamId) {
      const s = streams.get(streamId);
      return s !== undefined && s.init !== undefined && !s.ended;
    }
  };
};
