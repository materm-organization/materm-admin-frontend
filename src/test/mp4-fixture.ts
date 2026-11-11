// Synthetic MP4 files for tests (same structure as materm-admin-backend/pkg/testutil/mp4fixture): the right box STRUCTURE
// (ftyp, moov with a video and an audio track, mdat filler), not decodable video.
export type Mp4Spec = {
  brand?: string;
  codec?: string; // sample entry of the video track, default avc1
  width?: number;
  height?: number;
  durationMs?: number;
  mdatBytes?: number;
  moovLast?: boolean; // mdat before moov = not fast-start
  seed?: number;
  rotate?: boolean; // quarter-turn matrix
  tail?: Uint8Array;
};

const u32 = (v: number) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const text = (s: string) => new TextEncoder().encode(s);
const box = (type: string, ...parts: Uint8Array[]) => {
  const payload = cat(...parts);
  return cat(u32(8 + payload.length), text(type), payload);
};

function track(kind: string, w: number, h: number, codec: string, rotate: boolean) {
  const m = rotate ? [0, 0x10000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000] : [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
  const tkhd = cat(new Uint8Array([0, 0, 0, 3]), new Uint8Array(36), ...m.map((v) => u32(v >>> 0)), u32((w & 0xffff) << 16), u32((h & 0xffff) << 16));
  const hdlr = box("hdlr", new Uint8Array(8), text(kind), new Uint8Array(13));
  const stsd = box("stsd", new Uint8Array(4), u32(1), box(codec, new Uint8Array(78)));
  return box("trak", box("tkhd", tkhd), box("mdia", hdlr, box("minf", box("stbl", stsd))));
}

export function buildMp4(spec: Mp4Spec = {}): Uint8Array {
  const { brand = "isom", codec = "avc1", width = 1280, height = 720, durationMs = 5000, mdatBytes = 100_000, moovLast = false, seed = 0, rotate = false, tail } = spec;
  const ftyp = box("ftyp", text(brand), u32(512), text("isom"), text("mp42"));
  const mvhd = box("mvhd", new Uint8Array(4), u32(0), u32(0), u32(1000), u32(durationMs), new Uint8Array(80));
  const moov = box("moov", mvhd, track("vide", width, height, codec, rotate), track("soun", 0, 0, "mp4a", false));
  const mdat = box("mdat", new Uint8Array(mdatBytes).fill(seed));
  const body = moovLast ? cat(ftyp, mdat, moov) : cat(ftyp, moov, mdat);
  return tail ? cat(body, tail) : body;
}

export function mp4File(name = "clip.mp4", spec: Mp4Spec = {}): File {
  return new File([buildMp4(spec) as BlobPart], name, { type: "video/mp4" });
}
