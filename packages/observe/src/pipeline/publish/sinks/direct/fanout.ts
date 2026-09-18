// Broadcaster-side fMP4 fan-out: the init segment + a bounded fragment ring, copied to N viewer
// sinks with per-viewer bounded queues (drop-oldest, skip-forward — one slow viewer never stalls
// the encoder or other viewers). Same policy the host ring proved out, relocated to the node so
// the broadcaster serves viewers DIRECTLY; capped at maxViewers (bandwidth is the only scarcity).

export interface DirectFragment {
  readonly seq: number;
  readonly data: Uint8Array;
}

export type DirectViewerFrame =
  | { readonly kind: "init"; readonly data: Uint8Array }
  | { readonly kind: "fragment"; readonly seq: number; readonly data: Uint8Array }
  | { readonly kind: "end"; readonly reason?: string };

export interface DirectViewer {
  readonly id: string;
  /** Backpressure-aware write; resolves when the frame is handed to the transport. */
  readonly write: (frame: DirectViewerFrame) => Promise<void>;
  readonly close: () => void;
}

export interface DirectFanoutConfig {
  readonly maxViewers: number;
  readonly ringFragments: number;
  readonly ringBytes: number;
  /** Per-viewer queued-fragment cap before we drop-oldest and skip forward. */
  readonly viewerBacklog: number;
}

export const DEFAULT_DIRECT_FANOUT: DirectFanoutConfig = {
  maxViewers: 20,
  ringFragments: 12,
  ringBytes: 24 * 1024 * 1024,
  viewerBacklog: 8
};

export type AdmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "at_capacity" | "ended" };

export interface DirectFanout {
  setInit(data: Uint8Array): void;
  push(fragment: DirectFragment): void;
  admit(viewer: DirectViewer): AdmitResult;
  remove(viewerId: string): void;
  end(reason?: string): void;
  /** Resolves once end() was called AND every viewer pipeline finished (queue + end signal shipped). */
  drained(): Promise<void>;
  viewerCount(): number;
}

interface ViewerState {
  readonly viewer: DirectViewer;
  queue: DirectFragment[];
  writing: boolean;
  /** MSE needs the init segment before any fragment; fragments hold until it has shipped. */
  needsInit: boolean;
  dropped: number;
}

export const createDirectFanout = (
  config: DirectFanoutConfig = DEFAULT_DIRECT_FANOUT
): DirectFanout => {
  const viewers = new Map<string, ViewerState>();
  const ring: DirectFragment[] = [];
  let ringBytes = 0;
  let init: Uint8Array | undefined;
  let ended = false;
  let endReason: string | undefined;
  let drainWaiters: (() => void)[] = [];

  const maybeDrained = (): void => {
    if (!ended || viewers.size > 0) {
      return;
    }
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const trimRing = (): void => {
    while (ring.length > config.ringFragments || ringBytes > config.ringBytes) {
      const removed = ring.shift();
      if (removed === undefined) {
        break;
      }
      ringBytes -= removed.data.byteLength;
    }
  };

  const drop = (state: ViewerState): void => {
    viewers.delete(state.viewer.id);
    state.viewer.close();
    maybeDrained();
  };

  // The end signal rides the same per-viewer pipeline so it can never overtake queued fragments.
  const shipEnd = (state: ViewerState): void => {
    state.writing = true;
    void state.viewer
      .write({ kind: "end", ...(endReason === undefined ? {} : { reason: endReason }) })
      .catch(() => {})
      .then(() => drop(state));
  };

  // One write pipeline per viewer: init first (whenever it becomes available — a viewer may connect
  // BEFORE the encoder has produced it), then queued fragments in order. Fragments never precede init.
  const pump = (state: ViewerState): void => {
    if (state.writing) {
      return;
    }
    if (state.needsInit) {
      if (init === undefined) {
        // No init yet: an ended stream releases the viewer; a live one holds until the encoder ships it.
        if (ended) shipEnd(state);
        return;
      }
      state.writing = true;
      state.viewer
        .write({ kind: "init", data: init })
        .then(() => {
          state.writing = false;
          state.needsInit = false;
          pump(state);
        })
        .catch(() => drop(state));
      return;
    }
    const next = state.queue.shift();
    if (next === undefined) {
      if (ended) shipEnd(state);
      return;
    }
    state.writing = true;
    state.viewer
      .write({ kind: "fragment", seq: next.seq, data: next.data })
      .then(() => {
        state.writing = false;
        pump(state);
      })
      .catch(() => drop(state));
  };

  return {
    setInit: (data) => {
      init = data;
      // Wake every viewer that connected before the encoder produced init.
      for (const state of viewers.values()) {
        pump(state);
      }
    },

    push: (fragment) => {
      if (ended) {
        return;
      }
      ring.push(fragment);
      ringBytes += fragment.data.byteLength;
      trimRing();

      for (const state of viewers.values()) {
        state.queue.push(fragment);
        if (state.queue.length > config.viewerBacklog) {
          // Slow viewer: drop the oldest backlog and skip forward — live means live.
          state.dropped += state.queue.length - 1;
          state.queue = [state.queue[state.queue.length - 1]!];
        }
        pump(state);
      }
    },

    admit: (viewer) => {
      if (ended) {
        return { ok: false, reason: "ended" };
      }
      if (viewers.size >= config.maxViewers) {
        return { ok: false, reason: "at_capacity" };
      }
      // The keyframe-led ring backlog primes MSE (after init), then the live tail follows.
      const state: ViewerState = {
        viewer,
        queue: [...ring],
        writing: false,
        needsInit: true,
        dropped: 0
      };
      viewers.set(viewer.id, state);
      pump(state);
      return { ok: true };
    },

    remove: (viewerId) => {
      viewers.delete(viewerId);
      maybeDrained();
    },

    end: (reason) => {
      if (ended) {
        return;
      }
      ended = true;
      endReason = reason;
      // Each viewer's pipeline drains its remaining queue, then ships the end signal and closes.
      for (const state of viewers.values()) {
        pump(state);
      }
      maybeDrained();
    },

    drained: () =>
      new Promise<void>((resolve) => {
        if (ended && viewers.size === 0) {
          resolve();
          return;
        }
        drainWaiters.push(resolve);
      }),

    viewerCount: () => viewers.size
  };
};
