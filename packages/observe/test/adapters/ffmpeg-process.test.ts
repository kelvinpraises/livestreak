import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeStdinWithBackpressure, type NodeWritable } from "#adapters/ffmpeg/index.js";

describe("writeStdinWithBackpressure", () => {
  it("waits for drain when stdin write returns false", async () => {
    const written: Uint8Array[] = [];
    let drainListener: (() => void) | undefined;
    const chunk = new Uint8Array([1, 2, 3]);

    const stdin: NodeWritable = {
      write: (data) => {
        written.push(data);
        return false;
      },
      end: () => {
        return;
      },
      on: (event, listener) => {
        if (event === "drain") {
          drainListener = listener as () => void;
        }
      },
      removeListener: (event) => {
        if (event === "drain") {
          drainListener = undefined;
        }
      }
    };

    const write = Effect.runPromise(writeStdinWithBackpressure(stdin, chunk, "test encoder"));
    expect(written).toHaveLength(1);
    expect(drainListener).toBeDefined();

    drainListener?.();
    await write;
  });

  it("resolves immediately when stdin accepts the chunk", async () => {
    const stdin: NodeWritable = {
      write: () => true,
      end: () => {
        return;
      },
      on: () => {
        return;
      },
      removeListener: () => {
        return;
      }
    };

    await Effect.runPromise(
      writeStdinWithBackpressure(stdin, new Uint8Array([9]), "test encoder")
    );
  });
});
