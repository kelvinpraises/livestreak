// fMP4 box scanner — split an ffmpeg fragmented-MP4 byte stream into an init segment and media fragments.
//
// ffmpeg with `-movflags empty_moov+default_base_moof+frag_keyframe -f mp4 pipe:1` emits a stream of
// top-level ISO-BMFF boxes. This scanner buffers raw stdout and yields:
//   - INIT  = the leading `ftyp` + `moov` boxes (the codec/track init the browser MSE needs first)
//   - FRAGMENT = each `moof` + its following `mdat` (one GOP-aligned media fragment); a leading `styp`
//     or `sidx` (present in some fMP4 profiles) is folded into the fragment it precedes.
//
// A top-level box is `[size:u32][type:4ascii][...body]`. size===1 means a 64-bit size follows the type
// (largesize); size===0 means "to end of file" (never emitted mid-stream by ffmpeg fragmented output, so
// treated as incomplete). We parse box-by-box only once the full box is buffered — no accumulate-then-send
// beyond one box boundary, which is the smallest safe unit.

export type Fmp4Chunk =
  | { readonly kind: "init"; readonly data: Uint8Array }
  | { readonly kind: "fragment"; readonly data: Uint8Array };

const BOX_HEADER_BYTES = 8;

const boxType = (buf: Uint8Array, offset: number): string =>
  String.fromCharCode(buf[offset + 4]!, buf[offset + 5]!, buf[offset + 6]!, buf[offset + 7]!);

// Total byte length of the box starting at `offset`, or undefined when the buffer does not yet hold the
// full header/largesize (caller waits for more bytes).
const boxLength = (buf: Uint8Array, offset: number): number | undefined => {
  if (buf.length - offset < BOX_HEADER_BYTES) return undefined;
  const view = new DataView(buf.buffer, buf.byteOffset + offset, buf.length - offset);
  const size = view.getUint32(0);
  if (size === 1) {
    // 64-bit largesize sits right after the 8-byte header.
    if (buf.length - offset < BOX_HEADER_BYTES + 8) return undefined;
    const hi = view.getUint32(8);
    const lo = view.getUint32(12);
    return hi * 2 ** 32 + lo;
  }
  // size===0 ("until EOF") never appears in a live fragmented stream — treat as not-yet-complete.
  if (size === 0) return undefined;
  return size;
};

/**
 * Stateful, streaming fMP4 chunker. Feed raw ffmpeg stdout with {@link push}; it returns the completed
 * chunks (init and/or fragments) whose bytes are now fully buffered, holding partial boxes until the rest
 * arrives. {@link flush} returns any trailing whole fragment still buffered at EOS (a dangling partial box
 * is dropped — an incomplete final fragment is not playable).
 */
export interface Fmp4Chunker {
  readonly push: (bytes: Uint8Array) => readonly Fmp4Chunk[];
  readonly flush: () => readonly Fmp4Chunk[];
}

export const createFmp4Chunker = (): Fmp4Chunker => {
  let pending: Uint8Array = new Uint8Array(0);
  // Init boxes accumulate until the first media box (`moof`) proves the init segment is complete.
  let initBoxes: Uint8Array[] = [];
  let initEmitted = false;
  // Boxes buffered for the fragment currently being assembled (styp?/sidx? + moof + mdat).
  let fragmentBoxes: Uint8Array[] = [];

  const append = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };

  const concat = (parts: readonly Uint8Array[]): Uint8Array => {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  const push = (bytes: Uint8Array): readonly Fmp4Chunk[] => {
    pending = pending.length === 0 ? bytes : append(pending, bytes);
    const out: Fmp4Chunk[] = [];
    let offset = 0;

    for (;;) {
      const len = boxLength(pending, offset);
      if (len === undefined || pending.length - offset < len) break; // wait for the rest of this box
      const box = pending.subarray(offset, offset + len);
      const type = boxType(pending, offset);
      offset += len;

      if (type === "ftyp" || type === "moov") {
        // Copy out of `pending` (which we compact below) so the emitted init keeps its own bytes.
        initBoxes.push(box.slice());
        continue;
      }

      if (type === "moof") {
        // The first media box closes the init segment — emit it once, in order, before any fragment.
        if (!initEmitted && initBoxes.length > 0) {
          out.push({ kind: "init", data: concat(initBoxes) });
          initBoxes = [];
          initEmitted = true;
        }
        // A new moof starts a new fragment; any styp/sidx already buffered belongs with it (kept below).
        fragmentBoxes.push(box.slice());
        continue;
      }

      if (type === "mdat") {
        fragmentBoxes.push(box.slice());
        // moof+mdat is a complete media fragment — emit it as one contiguous chunk.
        out.push({ kind: "fragment", data: concat(fragmentBoxes) });
        fragmentBoxes = [];
        continue;
      }

      // styp / sidx / anything else preceding a moof: hold it so it rides with the coming fragment.
      fragmentBoxes.push(box.slice());
    }

    // Compact `pending` to the unparsed tail.
    pending = offset === 0 ? pending : pending.subarray(offset);
    return out;
  };

  const flush = (): readonly Fmp4Chunk[] => {
    const out: Fmp4Chunk[] = [];
    // A fragment fully buffered but never closed by a fresh moof is complete iff it ended on an mdat — the
    // push loop already emits on mdat, so anything left here is a dangling partial fragment; drop it.
    fragmentBoxes = [];
    pending = new Uint8Array(0);
    return out;
  };

  return { push, flush };
};
