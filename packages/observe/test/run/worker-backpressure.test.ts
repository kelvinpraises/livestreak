import { describe, expect, it } from "vitest";
import {
  appendTrackItem,
  CAPTURE_VIDEO_RAW_TRACK_ID,
  commitTrackCursor,
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  maxUnconsumedVideoFrames,
  nextTrackSequence,
  readLastMediaTimeMs,
  readTrackItem,
  type WorkerState
} from "#run/worker/state.js";
import { appendEosMarker } from "#run/worker/timeline.js";
import type { VideoTrackItem } from "#run/worker/timeline.js";

// Frame payloads are megabytes each in the real pipeline; the worker timeline must be bounded by
// construction: consumed frames are pruned, and a stalled consumer sheds the OLDEST backlog
// (latest-frame-wins) instead of queueing N-deep. Markers (eos/pause) are never dropped.
describe("worker timeline backpressure", () => {
  const trackId = CAPTURE_VIDEO_RAW_TRACK_ID;
  const cursorId = "sink:memory-test:publish.video.rendered";

  const makeState = (): WorkerState =>
    createEmptyWorkerState({
      runId: "run_backpressure",
      manifest: createPassthroughVideoManifest(),
      sinks: {}
    });

  const appendFrame = (state: WorkerState): VideoTrackItem => {
    const sequence = nextTrackSequence(state, trackId);
    const item: VideoTrackItem = {
      kind: "video",
      trackId,
      sequence,
      epoch: state.epoch,
      mediaTimeMs: sequence * 33,
      wallTimeMs: sequence * 33,
      payloadBytes: 4,
      payload: {
        width: 1,
        height: 1,
        byteFormat: "rgba",
        encoding: "raw",
        data: new Uint8Array(4)
      }
    };
    appendTrackItem(state, item);
    return item;
  };

  const retainedVideo = (state: WorkerState): readonly number[] =>
    (state.tracks[trackId]?.items ?? [])
      .filter((item) => item.kind === "video")
      .map((item) => item.sequence);

  it("is lossless and prunes consumed payloads when the consumer keeps up", () => {
    const state = makeState();
    const deliveredSequences: number[] = [];

    for (let index = 0; index < 100; index += 1) {
      appendFrame(state);
      const item = readTrackItem(state, trackId, cursorId);
      expect(item?.kind).toBe("video");
      if (item !== undefined) {
        deliveredSequences.push(item.sequence);
        commitTrackCursor(state, trackId, cursorId, item.sequence);
      }
    }

    // Every frame delivered in order — the bound never drops when nobody is behind.
    expect(deliveredSequences).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(state.tracks[trackId]?.droppedVideoItems).toBe(0);
    // ...and consumed payloads do not accumulate: the retained window is empty.
    expect(retainedVideo(state)).toEqual([]);
  });

  it("bounds a stalled consumer latest-frame-wins instead of queueing N-deep", () => {
    const state = makeState();

    // Consumer registers (cursor created) but never commits — a stalled viewer.
    expect(readTrackItem(state, trackId, cursorId)).toBeUndefined();

    const total = 100;
    for (let index = 0; index < total; index += 1) {
      appendFrame(state);
    }

    // Retention is bounded at the window, holding the NEWEST frames.
    const retained = retainedVideo(state);
    expect(retained).toHaveLength(maxUnconsumedVideoFrames);
    expect(retained[retained.length - 1]).toBe(total - 1);
    expect(state.tracks[trackId]?.droppedVideoItems).toBe(total - maxUnconsumedVideoFrames);

    // The stalled consumer resumes at the oldest RETAINED frame (skip-forward), then advances.
    const first = readTrackItem(state, trackId, cursorId);
    expect(first?.sequence).toBe(total - maxUnconsumedVideoFrames);
    if (first !== undefined) {
      commitTrackCursor(state, trackId, cursorId, first.sequence);
    }
    expect(readTrackItem(state, trackId, cursorId)?.sequence).toBe(
      total - maxUnconsumedVideoFrames + 1
    );
  });

  it("bounds frames buffered before any consumer registers", () => {
    const state = makeState();

    for (let index = 0; index < maxUnconsumedVideoFrames * 3; index += 1) {
      appendFrame(state);
    }

    expect(retainedVideo(state)).toHaveLength(maxUnconsumedVideoFrames);
  });

  it("never drops markers and keeps them ordered through frame drops", () => {
    const state = makeState();

    appendFrame(state);
    appendEosMarker(state, trackId);
    for (let index = 0; index < maxUnconsumedVideoFrames * 2; index += 1) {
      appendFrame(state);
    }

    const items = state.tracks[trackId]?.items ?? [];
    const markers = items.filter((item) => item.kind === "marker");
    expect(markers).toHaveLength(1);
    const marker = markers[0];
    expect(marker?.kind === "marker" ? marker.marker.kind : undefined).toBe("eos");

    // The marker is delivered in sequence order despite surrounding drops.
    const first = readTrackItem(state, trackId, cursorId);
    expect(first?.kind).toBe("marker");
    if (first !== undefined) {
      commitTrackCursor(state, trackId, cursorId, first.sequence);
    }
    expect(readTrackItem(state, trackId, cursorId)?.kind).toBe("video");
  });

  it("keeps marker media timestamps after all video was consumed and pruned", () => {
    const state = makeState();

    for (let index = 0; index < 4; index += 1) {
      appendFrame(state);
      const item = readTrackItem(state, trackId, cursorId);
      if (item !== undefined) {
        commitTrackCursor(state, trackId, cursorId, item.sequence);
      }
    }

    expect(retainedVideo(state)).toEqual([]);
    // Last video frame was sequence 3 at 3*33ms — its media time survives pruning for markers.
    expect(readLastMediaTimeMs(state, trackId)).toBe(99);

    appendEosMarker(state, trackId);
    const eos = readTrackItem(state, trackId, cursorId);
    expect(eos?.kind).toBe("marker");
    expect(eos?.mediaTimeMs).toBe(99);
  });
});
