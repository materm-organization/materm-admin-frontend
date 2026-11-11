// Client-side PRE-CHECK of an MP4 before 50 MB are sent (video support, release 1). Pure (no React), best effort:
// the server (`pkg/mediafile/video.go` of the admin backend) is the authority and this file mirrors only its
// numbers. A `null` answer means "nothing certain found": the file is sent and the server decides. A parser failure
// of any kind (unknown brand, truncated box, odd layout) is also `null`, never a block.
//
// What is read: only box HEADERS of the top level (a few small `slice()` reads, the 50 MB `mdat` is skipped) and the
// `moov` box itself when it is at most MAX_MOOV_BYTES. Nothing of the media data is read.
//
// Certain findings (same order and numbers as the server):
//   faststart_required   `mdat` comes before `moov` (and a `moov` exists)
//   codec_unsupported    a video sample entry that is not avc1 / avc3
//   dimensions_too_large the displayed size of the first video track is over 1920x1080 (after a quarter-turn matrix)
//   duration_too_long    the movie duration is over 35 s (rounded up like the server: any clip over 35 000 ms fails)
//   bitrate_too_high     file bytes * 8 / duration is over 40 Mbit/s
import type { UploadError } from "@/lib/media-upload";

export const MAX_VIDEO_MS = 35_000;
export const MAX_VIDEO_WIDTH = 1920;
export const MAX_VIDEO_HEIGHT = 1080;
export const MAX_VIDEO_BITS_PER_SECOND = 40_000_000;
// A `moov` box above this is not read (a 35 s clip has a few hundred kB): the server decides.
export const MAX_MOOV_BYTES = 8 * 1024 * 1024;
// Top-level boxes looked at before giving up (a normal MP4 has 3-6).
const MAX_TOP_BOXES = 64;

// The brands the server accepts as a major brand (`videoBrands` in video.go).
const VIDEO_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "M4V "]);

// What the probe needs of a File: its size and a slice it can read. A fake of the same shape lets a test describe a
// 50 MB file without allocating it.
export type Mp4Source = {
  size: number;
  slice(start: number, end: number): Pick<Blob, "arrayBuffer"> | Blob;
};

async function readBytes(source: Mp4Source, start: number, end: number): Promise<Uint8Array> {
  const part = source.slice(start, Math.min(end, source.size)) as Blob;
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  // Older engines (and some test DOMs) have no Blob.arrayBuffer.
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(part);
  });
}

const B0 = BigInt(0);
const B1 = BigInt(1);
const B1000 = BigInt(1000);
const B_1M = BigInt(1_000_000);
const U32_MAX = BigInt(0xffffffff);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

type TopBox = { type: string; offset: number; size: number; headerSize: number };

// Reads the header at `offset`; `null` = cannot be read as a box (the walk stops, nothing is certain).
async function topBoxAt(source: Mp4Source, offset: number): Promise<TopBox | null> {
  const head = await readBytes(source, offset, offset + 16);
  if (head.length < 8) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let size = BigInt(view.getUint32(0));
  let headerSize = 8;
  const type = type4(head, 4);
  if (size === B1) {
    if (head.length < 16) return null;
    size = view.getBigUint64(8);
    headerSize = 16;
  } else if (size === B0) {
    size = BigInt(source.size - offset); // runs to the end of the file
  }
  const rest = BigInt(source.size - offset);
  if (size < BigInt(headerSize) || size > rest) return null;
  return { type, offset, size: Number(size), headerSize };
}

type Child = { type: string; start: number; end: number };

// The children of a run of boxes inside `b` (`moov` and below). Stops quietly at the first bad size.
function children(b: Uint8Array, from: number, to: number): Child[] {
  const out: Child[] = [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = from;
  while (off + 8 <= to) {
    let size = view.getUint32(off);
    let header = 8;
    if (size === 1) {
      if (off + 16 > to) break;
      const big = view.getBigUint64(off + 8);
      if (big > BigInt(to - off)) break;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      break; // only a top-level mdat may do this; not inside moov
    }
    if (size < header || off + size > to) break;
    out.push({ type: type4(b, off + 4), start: off + header, end: off + size });
    off += size;
  }
  return out;
}

type Movie = { durationMs: number | null; unknownLong: boolean };

// mvhd -> milliseconds rounded UP (movieDurationMS in video.go). `null` duration = unreadable / zero (server: damaged).
function movieDuration(b: Uint8Array, c: Child): Movie | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const p = c.start;
  const len = c.end - c.start;
  if (len < 4) return null;
  let ts: bigint;
  let dur: bigint;
  let unknown: bigint;
  if (b[p] === 0) {
    if (len < 20) return null;
    ts = BigInt(view.getUint32(p + 12));
    dur = BigInt(view.getUint32(p + 16));
    unknown = U32_MAX;
  } else if (b[p] === 1) {
    if (len < 32) return null;
    ts = BigInt(view.getUint32(p + 20));
    dur = view.getBigUint64(p + 24);
    unknown = U64_MAX;
  } else {
    return null;
  }
  if (ts === B0 || dur === B0) return null;
  const sec = dur / ts;
  if (dur === unknown || sec > B_1M) return { durationMs: null, unknownLong: true };
  let ms = sec * B1000 + ((dur % ts) * B1000 + ts - B1) / ts;
  if (ms === B0) ms = B1;
  return { durationMs: Number(ms), unknownLong: false };
}

type Track = { video: boolean; width: number; height: number; codec?: string };

// trak: hdlr must say `vide`; then tkhd size (rotation applied) and the stsd sample entries.
function inspectTrack(b: Uint8Array, trak: Child): Track | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kids = children(b, trak.start, trak.end);
  const tkhd = kids.find((k) => k.type === "tkhd");
  const mdia = kids.find((k) => k.type === "mdia");
  if (!mdia) return { video: false, width: 0, height: 0 };
  const mk = children(b, mdia.start, mdia.end);
  const hdlr = mk.find((k) => k.type === "hdlr");
  const minf = mk.find((k) => k.type === "minf");
  if (!hdlr || hdlr.end - hdlr.start < 12 || type4(b, hdlr.start + 8) !== "vide") return { video: false, width: 0, height: 0 };

  if (!tkhd || tkhd.end - tkhd.start < 4) return null;
  const v = b[tkhd.start];
  if (v !== 0 && v !== 1) return null;
  const matrix = v === 0 ? 40 : 52;
  const size = v === 0 ? 76 : 88;
  if (tkhd.end - tkhd.start < size + 8) return null;
  const m = (i: number) => view.getUint32(tkhd.start + matrix + 4 * i);
  let width = view.getUint32(tkhd.start + size) >>> 16;
  let height = view.getUint32(tkhd.start + size + 4) >>> 16;
  if (m(0) === 0 && m(4) === 0 && m(1) !== 0 && m(3) !== 0) [width, height] = [height, width];

  let codec: string | undefined;
  const stbl = minf ? children(b, minf.start, minf.end).find((k) => k.type === "stbl") : undefined;
  const stsd = stbl ? children(b, stbl.start, stbl.end).find((k) => k.type === "stsd") : undefined;
  if (stsd && stsd.end - stsd.start >= 8) {
    let n = Math.min(view.getUint32(stsd.start + 4), 32);
    let at = stsd.start + 8;
    while (n > 0 && at + 8 <= stsd.end) {
      const esize = view.getUint32(at);
      if (esize < 8 || at + esize > stsd.end) break;
      const cc = type4(b, at + 4);
      if (cc !== "avc1" && cc !== "avc3") {
        codec = cc;
        break;
      }
      at += esize;
      n -= 1;
    }
  }
  return { video: true, width, height, codec };
}

// The pre-check. `null` = nothing certain (send it); an UploadError (never retryable) = the server would refuse it.
export async function probeMp4(source: Mp4Source): Promise<UploadError | null> {
  try {
    return await probe(source);
  } catch {
    return null; // best effort: never block on a parser failure
  }
}

async function probe(source: Mp4Source): Promise<UploadError | null> {
  const head = await readBytes(source, 0, 16);
  if (head.length < 16 || type4(head, 4) !== "ftyp" || !VIDEO_BRANDS.has(type4(head, 8))) return null; // not (certainly) an MP4

  let offset = 0;
  let moov: TopBox | null = null;
  let mdatBeforeMoov = false;
  let mdatSeen = false;
  for (let i = 0; i < MAX_TOP_BOXES && offset < source.size; i += 1) {
    const box = await topBoxAt(source, offset);
    if (!box) return null;
    if (box.type === "moov") {
      if (moov) return null; // two moov boxes: the server says "damaged"; not our call
      moov = box;
      if (mdatSeen) mdatBeforeMoov = true;
    } else if (box.type === "mdat") {
      mdatSeen = true;
    }
    offset += box.size;
  }
  if (!moov) return null;
  if (mdatBeforeMoov) return { kind: "faststartRequired", retryable: false };
  if (!mdatSeen) return null;
  const payloadSize = moov.size - moov.headerSize;
  if (payloadSize > MAX_MOOV_BYTES) return null;

  const b = await readBytes(source, moov.offset + moov.headerSize, moov.offset + moov.size);
  if (b.length !== payloadSize) return null;
  const kids = children(b, 0, b.length);

  let durationMs: number | null = null;
  let firstVideo: Track | null = null;
  for (const k of kids) {
    if (k.type === "mvhd") {
      const movie = movieDuration(b, k);
      if (!movie) return null;
      if (movie.unknownLong) return { kind: "durationLimit", retryable: false, params: { max: MAX_VIDEO_MS / 1000 } };
      durationMs = movie.durationMs;
      if (durationMs !== null && durationMs > MAX_VIDEO_MS) return durationTooLong(durationMs);
    } else if (k.type === "trak") {
      const track = inspectTrack(b, k);
      if (!track) return null;
      if (track.video && !firstVideo) {
        if (track.codec) return { kind: "codecUnsupported", retryable: false, params: { codec: track.codec } };
        firstVideo = track;
      }
    }
  }
  if (!firstVideo || durationMs === null) return null;
  if (firstVideo.width > MAX_VIDEO_WIDTH || firstVideo.height > MAX_VIDEO_HEIGHT) {
    return {
      kind: "dimensionsTooLarge",
      retryable: false,
      params: { width: firstVideo.width, height: firstVideo.height, maxWidth: MAX_VIDEO_WIDTH, maxHeight: MAX_VIDEO_HEIGHT },
    };
  }
  if (source.size * 8000 > MAX_VIDEO_BITS_PER_SECOND * durationMs) {
    return { kind: "bitrateTooHigh", retryable: false, params: { maxMbit: MAX_VIDEO_BITS_PER_SECOND / 1_000_000 } };
  }
  return null;
}

export function durationTooLong(durationMs: number): UploadError {
  return {
    kind: "durationTooLong",
    retryable: false,
    params: { seconds: (durationMs / 1000).toFixed(1), max: MAX_VIDEO_MS / 1000 },
  };
}
