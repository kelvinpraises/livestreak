import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { nowTimePoint } from "@livestreak/schema";
import type { RawFrame } from "#pipeline/capture/index.js";
import { createCaptureFramePull } from "#run/worker/capture-pull.js";

describe("capture frame pull", () => {
  it("advances a single stream consumer without re-subscribing", async () => {
    let produced = 0;
    const frames = Stream.range(0, 3).pipe(
      Stream.map((index) => {
        produced += 1;
        return makeFrame(index);
      }),
    );

    const pull = await Effect.runPromise(Effect.scoped(createCaptureFramePull(frames)));

    const first = await Effect.runPromise(pull.pullNext());
    const second = await Effect.runPromise(pull.pullNext());
    const third = await Effect.runPromise(pull.pullNext());
    const fourth = await Effect.runPromise(pull.pullNext());
    const end = await Effect.runPromise(pull.pullNext());

    expect(first?.id).toBe("frame:0");
    expect(second?.id).toBe("frame:1");
    expect(third?.id).toBe("frame:2");
    expect(fourth?.id).toBe("frame:3");
    expect(end).toBeUndefined();
    expect(produced).toBe(4);
  });

  it("buffers frames when the source emits chunks larger than one", async () => {
    const frames = Stream.fromIterable([0, 1, 2, 3]).pipe(
      Stream.rechunk(2),
      Stream.map((index) => makeFrame(index)),
    );
    const pull = await Effect.runPromise(Effect.scoped(createCaptureFramePull(frames)));

    const values: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const frame = await Effect.runPromise(pull.pullNext());
      if (frame === undefined) {
        values.push("end");
        break;
      }
      values.push(frame.id);
    }

    expect(values).toEqual(["frame:0", "frame:1", "frame:2", "frame:3", "end"]);
  });
});

// --- helpers ---

const makeFrame = (index: number): RawFrame => ({
  id: `frame:${index}`,
  sourceId: "test",
  time: nowTimePoint(index),
  cadence: {
    mode: "synthetic",
    sequence: index,
    droppedFrames: 0,
  },
  payload: {
    width: 1,
    height: 1,
    byteFormat: "rgba",
    encoding: "raw",
    data: new Uint8Array(4),
  },
});
