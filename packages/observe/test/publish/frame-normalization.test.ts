import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  normalizeToI420,
  readI420Frame
} from "#pipeline/publish/sinks/i420.js";

const rgba = (pixels: ReadonlyArray<readonly [number, number, number, number]>): Uint8Array => {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
};

const payload = (data: Uint8Array, width: number, height: number, extra: Record<string, unknown> = {}) => ({
  data,
  width,
  height,
  byteFormat: "rgba",
  encoding: "raw",
  expectedFps: 30,
  ...extra
});

const normalize = (data: Uint8Array, width: number, height: number, extra: Record<string, unknown> = {}) =>
  Effect.runPromise(normalizeToI420(payload(data, width, height, extra), "Test"));

describe("shared streaming-frame normalization", () => {
  it("maps black to Y16 and neutral chroma", async () => {
    const out = await normalize(rgba([[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]), 2, 2);
    expect([...out.data]).toEqual([16, 16, 16, 16, 128, 128]);
  });

  it("maps white to Y235 and neutral chroma", async () => {
    const px = [255, 255, 255, 255] as const;
    const out = await normalize(rgba([px, px, px, px]), 2, 2);
    expect([...out.data]).toEqual([235, 235, 235, 235, 128, 128]);
  });

  it("converts primaries with pinned BT.601-style values", async () => {
    const red = await normalize(
      rgba([[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]]), 2, 2
    );
    expect([...red.data]).toEqual([82, 82, 82, 82, 90, 240]);
    const green = await normalize(
      rgba([[0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255], [0, 255, 0, 255]]), 2, 2
    );
    expect([...green.data]).toEqual([144, 144, 144, 144, 54, 34]);
    const blue = await normalize(
      rgba([[0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255]]), 2, 2
    );
    expect([...blue.data]).toEqual([41, 41, 41, 41, 240, 110]);
  });

  it("averages chroma over each 2x2 block and lays out Y/U/V planes in order", async () => {
    // One red, one green, one blue, one white pixel: per-pixel luma, block chroma.
    const out = await normalize(
      rgba([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]]),
      2, 2
    );
    expect([...out.data.slice(0, 4)]).toEqual([82, 144, 41, 235]);
    expect(out.data[4]).toBe(128);
    expect(out.data[5]).toBe(128);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.fps).toBe(30);
  });

  it("ignores alpha", async () => {
    const opaque = await normalize(
      rgba([[200, 100, 50, 255], [200, 100, 50, 255], [200, 100, 50, 255], [200, 100, 50, 255]]), 2, 2
    );
    const transparent = await normalize(
      rgba([[200, 100, 50, 0], [200, 100, 50, 0], [200, 100, 50, 0], [200, 100, 50, 0]]), 2, 2
    );
    expect([...transparent.data]).toEqual([...opaque.data]);
  });

  it("never mutates the input buffer", async () => {
    const data = rgba([[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255], [100, 110, 120, 255]]);
    const before = [...data];
    await normalize(data, 2, 2);
    expect([...data]).toEqual(before);
  });

  it("passes YUV through without range remapping", async () => {
    const yuv = new Uint8Array([16, 16, 16, 16, 128, 128]);
    const out = await Effect.runPromise(
      normalizeToI420(
        { data: yuv, width: 2, height: 2, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 },
        "Test"
      )
    );
    expect(out.data).toBe(yuv);
  });

  it("rejects odd dimensions, bad lengths, bad fps, non-raw encoding and unknown formats", async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["odd width", { data: new Uint8Array(3 * 2 * 4), width: 3, height: 2 }],
      ["odd height", { data: new Uint8Array(2 * 3 * 4), width: 2, height: 3 }],
      ["short body", { data: new Uint8Array(10), width: 2, height: 2 }],
      ["zero fps", { data: new Uint8Array(16), width: 2, height: 2, expectedFps: 0 }],
      ["nan fps", { data: new Uint8Array(16), width: 2, height: 2, expectedFps: Number.NaN }],
      ["jpeg bytes", { data: new Uint8Array(16), width: 2, height: 2, encoding: "jpeg" }],
      ["rgb label", { data: new Uint8Array(16), width: 2, height: 2, byteFormat: "rgb" }]
    ];
    for (const [name, over] of bad) {
      const exit = await Effect.runPromiseExit(
        normalizeToI420(
          { data: new Uint8Array(16), width: 2, height: 2, byteFormat: "rgba", encoding: "raw", expectedFps: 30, ...over },
          "Test"
        )
      );
      expect(exit._tag, name).toBe("Failure");
    }
  });

  it("rejects dimensions that overflow exact byte arithmetic", async () => {
    // G14-B05: 2**1023 is even and positive, but w*h*4 is Infinity — fail before any bound.
    for (const dims of [
      { width: 2 ** 1023, height: 2 },
      { width: 2 ** 53, height: 2 }
    ]) {
      const exit = await Effect.runPromiseExit(
        normalizeToI420(
          { data: new Uint8Array(16), ...dims, byteFormat: "rgba", encoding: "raw", expectedFps: 30 },
          "Test"
        )
      );
      expect(exit._tag).toBe("Failure");
    }
  });

  it("the strict reader still demands I420 raw", async () => {
    const ok = await Effect.runPromise(
      readI420Frame(
        { data: new Uint8Array(6), width: 2, height: 2, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 },
        "Test"
      )
    );
    expect(ok.data.byteLength).toBe(6);
    const rgbaExit = await Effect.runPromiseExit(
      readI420Frame(
        { data: new Uint8Array(16), width: 2, height: 2, byteFormat: "rgba", encoding: "raw", expectedFps: 30 },
        "Test"
      )
    );
    expect(rgbaExit._tag).toBe("Failure");
  });
});
