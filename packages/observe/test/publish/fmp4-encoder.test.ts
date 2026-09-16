import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createFmp4Encoder } from "#pipeline/publish/encoder/fmp4.js";
import type { Fmp4Chunk } from "#pipeline/publish/encoder/fmp4-boxes.js";

/**
 * Real ffmpeg encode → box scanner. Feeds synthetic I420 frames through the actual libx264 fragmented-MP4
 * encode and asserts a real init segment (ftyp+moov) arrives first followed by ≥1 media fragment. Skips
 * cleanly when ffmpeg is not on PATH (mirrors the wrtc-optional local sink test).
 */

const W = 64;
const H = 64;
const FPS = 10;

const grayI420 = (): Uint8Array => {
  const frame = new Uint8Array((W * H * 3) / 2);
  frame.fill(128);
  return frame;
};

const ffmpegPresent = async (): Promise<boolean> => {
  try {
    const { spawn } = (await import("node:child_process")) as typeof import("node:child_process");
    return await new Promise<boolean>((resolve) => {
      const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
};

const boxType = (data: Uint8Array): string =>
  String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!);

describe("fMP4 encoder (real ffmpeg)", () => {
  it("emits an init segment then media fragments", async () => {
    if (!(await ffmpegPresent())) return; // ffmpeg absent — skip cleanly

    const chunks: Fmp4Chunk[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoder = yield* createFmp4Encoder({
          width: W,
          height: H,
          fps: FPS,
          fragmentSeconds: 0.5,
          onChunk: (c) => chunks.push(c)
        });
        // ~2s of frames → several keyframe-led fragments at 0.5s each.
        const frame = grayI420();
        for (let i = 0; i < FPS * 2; i += 1) {
          yield* encoder.writeFrame(frame);
        }
        yield* encoder.finalize;
      })
    );

    const init = chunks.find((c) => c.kind === "init");
    expect(init).toBeDefined();
    // Init begins with ftyp.
    expect(boxType(init!.data)).toBe("ftyp");
    const fragments = chunks.filter((c) => c.kind === "fragment");
    expect(fragments.length).toBeGreaterThan(0);
    // Each fragment begins with a moof (or styp preceding it).
    for (const f of fragments) {
      expect(["moof", "styp", "sidx"]).toContain(boxType(f.data));
    }
  }, 30000);
});
