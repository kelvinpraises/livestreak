import { describe, expect, it } from "vitest";
import { createFmp4Chunker } from "#pipeline/publish/encoder/fmp4-boxes.js";

/**
 * fMP4 box scanner on SYNTHETIC bytes — no ffmpeg. Builds top-level ISO-BMFF boxes by hand and asserts the
 * scanner splits them into init (ftyp+moov) and media fragments (moof+mdat), that it holds partial boxes
 * across chunk boundaries, and that a leading styp/sidx rides with the next fragment.
 */

// One top-level box: [size:u32 big-endian][type:4 ascii][body]. size includes the 8-byte header.
const box = (type: string, body: Uint8Array = new Uint8Array(0)): Uint8Array => {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(body, 8);
  return out;
};

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("fMP4 box chunker", () => {
  it("splits ftyp+moov into one init and each moof+mdat into a fragment", () => {
    const ftyp = box("ftyp", bytes(1, 2, 3, 4));
    const moov = box("moov", bytes(5, 6, 7, 8, 9));
    const moof1 = box("moof", bytes(10, 11));
    const mdat1 = box("mdat", bytes(12, 13, 14));
    const moof2 = box("moof", bytes(20));
    const mdat2 = box("mdat", bytes(21, 22));

    const chunker = createFmp4Chunker();
    const out = chunker.push(concat(ftyp, moov, moof1, mdat1, moof2, mdat2));

    expect(out.map((c) => c.kind)).toEqual(["init", "fragment", "fragment"]);
    expect(out[0]!.data).toEqual(concat(ftyp, moov));
    expect(out[1]!.data).toEqual(concat(moof1, mdat1));
    expect(out[2]!.data).toEqual(concat(moof2, mdat2));
  });

  it("emits init exactly once, before the first fragment", () => {
    const chunker = createFmp4Chunker();
    const first = chunker.push(concat(box("ftyp"), box("moov"), box("moof"), box("mdat")));
    expect(first.filter((c) => c.kind === "init")).toHaveLength(1);
    const second = chunker.push(concat(box("moof"), box("mdat")));
    expect(second.filter((c) => c.kind === "init")).toHaveLength(0);
    expect(second.map((c) => c.kind)).toEqual(["fragment"]);
  });

  it("holds a box split across chunk boundaries until the rest arrives", () => {
    const ftyp = box("ftyp");
    const moov = box("moov", bytes(1, 2, 3, 4, 5, 6, 7, 8));
    const stream = concat(ftyp, moov, box("moof"), box("mdat", bytes(9, 9, 9)));

    const chunker = createFmp4Chunker();
    // Feed the stream one byte at a time — nothing must emit until each box is whole, and the final
    // sequence must be identical to a single push.
    const collected: string[] = [];
    for (const b of stream) {
      for (const c of chunker.push(new Uint8Array([b]))) collected.push(c.kind);
    }
    expect(collected).toEqual(["init", "fragment"]);
  });

  it("folds a leading styp/sidx into the fragment it precedes", () => {
    const styp = box("styp", bytes(1));
    const sidx = box("sidx", bytes(2, 3));
    const moof = box("moof", bytes(4));
    const mdat = box("mdat", bytes(5, 6));

    const chunker = createFmp4Chunker();
    const out = chunker.push(concat(box("ftyp"), box("moov"), styp, sidx, moof, mdat));
    const fragment = out.find((c) => c.kind === "fragment");
    expect(fragment).toBeDefined();
    // styp + sidx + moof + mdat, contiguous, in order.
    expect(fragment!.data).toEqual(concat(styp, sidx, moof, mdat));
  });

  it("drops a dangling partial fragment on flush", () => {
    const chunker = createFmp4Chunker();
    chunker.push(concat(box("ftyp"), box("moov")));
    // A moof with no mdat is an incomplete fragment; flush must not emit it.
    chunker.push(box("moof", bytes(1, 2, 3)));
    expect(chunker.flush()).toEqual([]);
  });

  it("parses a 64-bit largesize box header", () => {
    // size===1 → the real size is a u64 after the type. Body is 4 bytes → total 16 (8 header + 8 largesize) + 4.
    const body = bytes(7, 7, 7, 7);
    const total = 20;
    const largeMoov = new Uint8Array(total);
    const view = new DataView(largeMoov.buffer);
    view.setUint32(0, 1); // largesize flag
    largeMoov[4] = "m".charCodeAt(0);
    largeMoov[5] = "o".charCodeAt(0);
    largeMoov[6] = "o".charCodeAt(0);
    largeMoov[7] = "v".charCodeAt(0);
    view.setUint32(8, 0); // hi
    view.setUint32(12, total); // lo
    largeMoov.set(body, 16);

    const chunker = createFmp4Chunker();
    const out = chunker.push(concat(box("ftyp"), largeMoov, box("moof"), box("mdat")));
    expect(out[0]!.kind).toBe("init");
    expect(out[0]!.data.length).toBe(box("ftyp").length + total);
  });
});
