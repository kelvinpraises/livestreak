
interface Box {
  type: string;
  body: DataView;
  bytes: Uint8Array;
}
const boxes = (bytes: Uint8Array): Box[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  for (let at = 0; at < bytes.length; ) {
    if (bytes.length - at < 8) throw new Error("Truncated MP4 box");
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (bytes.length - at < 16) throw new Error("Truncated large box");
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    }
    if (size === 0) size = bytes.length - at;
    if (!Number.isSafeInteger(size) || size < header || at + size > bytes.length)
      throw new Error("Invalid MP4 box length");
    const body = bytes.subarray(at + header, at + size);
    out.push({
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      bytes: body,
      body: new DataView(body.buffer, body.byteOffset, body.length),
    });
    at += size;
  }
  return out;
};
const need = (list: Box[], type: string): Box => {
  const b = list.find((x) => x.type === type);
  if (!b) throw new Error(`MP4 missing ${type}`);
  return b;
};
export interface VideoClock {
  trackId: number;
  timescale: number;
  defaultDuration: number;
}
export const readVideoClock = (init: Uint8Array): VideoClock => {
  const top = boxes(init);
  if (
    top.filter((box) => box.type === "ftyp").length !== 1 ||
    top.filter((box) => box.type === "moov").length !== 1
  )
    throw new Error("Recording initialization must contain one epoch");
  need(top, "ftyp");
  const moov = boxes(need(top, "moov").bytes);
  const tracks = moov.filter((b) => b.type === "trak");
  // The current relay encoder emits a video-only stream. Reject rather than silently omit an audio track.
  if (tracks.length !== 1)
    throw new Error("Replay currently requires the relay's single video track");
  const track = boxes(tracks[0]!.bytes);
  const mdia = boxes(need(track, "mdia").bytes);
  const handler = need(mdia, "hdlr").bytes;
  if (String.fromCharCode(...handler.subarray(8, 12)) !== "vide")
    throw new Error("Recording has no video track");
  const tkhd = need(track, "tkhd").body;
  const mdhd = need(mdia, "mdhd").body;
  const trackId = tkhd.getUint32(tkhd.getUint8(0) === 1 ? 20 : 12);
  const timescale = mdhd.getUint32(mdhd.getUint8(0) === 1 ? 20 : 12);
  const trex = boxes(need(moov, "mvex").bytes).find(
    (b) => b.type === "trex" && b.body.getUint32(4) === trackId,
  );
  if (!timescale || !trex) throw new Error("Invalid video clock");
  return { trackId, timescale, defaultDuration: trex.body.getUint32(12) };
};
export const readFragmentTime = (
  bytes: Uint8Array,
  clock: VideoClock,
): { start: number; duration: number } => {
  const top = boxes(bytes);
  if (
    top.filter((box) => box.type === "moof").length !== 1 ||
    top.filter((box) => box.type === "mdat").length !== 1
  )
    throw new Error("Recording fragment must contain one media fragment");
  need(top, "mdat");
  const moof = boxes(need(top, "moof").bytes);
  const traf = moof
    .filter((b) => b.type === "traf")
    .map((b) => boxes(b.bytes))
    .find((bs) => need(bs, "tfhd").body.getUint32(4) === clock.trackId);
  if (!traf) throw new Error("Fragment missing video track");
  const tfhd = need(traf, "tfhd").body;
  const flags = tfhd.getUint32(0) & 0xffffff;
  let offset = 8;
  if (flags & 1) offset += 8;
  if (flags & 2) offset += 4;
  const defaultDuration = flags & 8 ? tfhd.getUint32(offset) : clock.defaultDuration;
  const tfdt = need(traf, "tfdt").body;
  const ticks = tfdt.getUint8(0) === 1 ? Number(tfdt.getBigUint64(4)) : tfdt.getUint32(4);
  let total = 0;
  for (const box of traf.filter((b) => b.type === "trun")) {
    const v = box.body;
    const f = v.getUint32(0) & 0xffffff;
    const count = v.getUint32(4);
    let at = 8;
    if (count > 100000) throw new Error("Invalid sample count");
    if (f & 1) at += 4;
    if (f & 4) at += 4;
    for (let n = 0; n < count; n++) {
      total += f & 0x100 ? v.getUint32(at) : defaultDuration;
      if (f & 0x100) at += 4;
      if (f & 0x200) at += 4;
      if (f & 0x400) at += 4;
      if (f & 0x800) at += 4;
    }
  }
  if (!Number.isSafeInteger(ticks) || total <= 0 || total / clock.timescale > 30)
    throw new Error("Invalid fragment duration");
  return { start: ticks / clock.timescale, duration: total / clock.timescale };
};
