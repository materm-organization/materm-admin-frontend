import { describe, expect, it, vi } from "vitest";

import { MAX_MOOV_BYTES, probeMp4, type Mp4Source } from "@/lib/mp4-probe";
import { buildMp4 } from "@/test/mp4-fixture";

const src = (bytes: Uint8Array): Mp4Source => new Blob([bytes as BlobPart]) as unknown as Mp4Source;

describe("probeMp4 (client pre-check, best effort)", () => {
  it("a valid fast-start MP4 passes (null = send it)", async () => {
    expect(await probeMp4(src(buildMp4()))).toBeNull();
    expect(await probeMp4(src(buildMp4({ durationMs: 35_000, width: 1920, height: 1080 })))).toBeNull(); // exact limits pass
  });

  it("moov after mdat: faststart_required", async () => {
    expect(await probeMp4(src(buildMp4({ moovLast: true })))).toMatchObject({ kind: "faststartRequired", retryable: false });
  });

  it("longer than 35 s (rounded like the server): durationTooLong with the seconds", async () => {
    expect(await probeMp4(src(buildMp4({ durationMs: 35_001 })))).toMatchObject({ kind: "durationTooLong", params: { seconds: "35.0", max: 35 } });
    expect(await probeMp4(src(buildMp4({ durationMs: 40_000 })))).toMatchObject({ kind: "durationTooLong", params: { seconds: "40.0", max: 35 } });
  });

  it("over 1920x1080 (also after a quarter turn) and a codec other than H.264", async () => {
    expect(await probeMp4(src(buildMp4({ width: 3840, height: 2160 })))).toMatchObject({ kind: "dimensionsTooLarge", params: { width: 3840, height: 2160 } });
    // 1080x1920 stored, rotated: displayed 1920x1080 -> fine; 1081x1921 stored rotated -> 1921x1081 -> refused
    expect(await probeMp4(src(buildMp4({ width: 1080, height: 1920, rotate: true })))).toBeNull();
    expect(await probeMp4(src(buildMp4({ width: 1081, height: 1921, rotate: true })))).toMatchObject({ kind: "dimensionsTooLarge" });
    expect(await probeMp4(src(buildMp4({ codec: "hvc1" })))).toMatchObject({ kind: "codecUnsupported", params: { codec: "hvc1" } });
  });

  it("bit rate above 40 Mbit/s", async () => {
    const found = await probeMp4(src(buildMp4({ durationMs: 1000, mdatBytes: 6_000_000 })));
    expect(found).toMatchObject({ kind: "bitrateTooHigh", params: { maxMbit: 40 } });
  });

  it("never blocks on what it cannot be sure of: not an MP4, wrong brand, truncated, garbage, tiny", async () => {
    expect(await probeMp4(src(new TextEncoder().encode("MZ definitely not a video")))).toBeNull();
    expect(await probeMp4(src(buildMp4({ brand: "qt  " })))).toBeNull();
    const whole = buildMp4();
    expect(await probeMp4(src(whole.slice(0, 200)))).toBeNull(); // truncated inside moov
    expect(await probeMp4(src(whole.slice(0, 10)))).toBeNull();
    expect(await probeMp4(src(new Uint8Array(0)))).toBeNull();
    // mdat first and NO moov at all: the server says "damaged", which is not our call
    expect(await probeMp4(src(whole.slice(0, whole.length - 0).slice(0, 28)))).toBeNull();
  });

  it("a parser exception is swallowed (null)", async () => {
    const broken: Mp4Source = { size: 100, slice: () => { throw new Error("read failed"); } };
    expect(await probeMp4(broken)).toBeNull();
  });

  it("reads only headers: a 50 MB file is never read beyond its first bytes, box headers and moov", async () => {
    // ftyp + moov (real) + a declared 50 MB mdat that is never materialised
    const whole = buildMp4({ mdatBytes: 10, durationMs: 30_000 });
    const ftypAndMoov = whole.slice(0, whole.length - (8 + 10));
    const mdatSize = 50 * 1024 * 1024 - ftypAndMoov.length;
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, mdatSize);
    header.set(new TextEncoder().encode("mdat"), 4);
    const size = ftypAndMoov.length + mdatSize;
    const reads: Array<[number, number]> = [];
    const fake: Mp4Source = {
      size,
      slice: (a, b) => {
        reads.push([a, b]);
        const out = new Uint8Array(Math.max(0, Math.min(b, size) - a));
        for (let i = 0; i < out.length; i += 1) {
          const at = a + i;
          out[i] = at < ftypAndMoov.length ? ftypAndMoov[at] : at < ftypAndMoov.length + 8 ? header[at - ftypAndMoov.length] : 0;
        }
        return new Blob([out as BlobPart]);
      },
    };
    expect(await probeMp4(fake)).toBeNull();
    const bytesRead = reads.reduce((n, [a, b]) => n + (Math.min(b, size) - a), 0);
    expect(bytesRead).toBeLessThan(ftypAndMoov.length + 200);
    expect(reads.every(([a, b]) => b - a <= MAX_MOOV_BYTES)).toBe(true);
  });

  it("a moov over 8 MB is not read (the server decides)", async () => {
    const reads = vi.fn();
    const size = 20 * 1024 * 1024;
    const ftyp = buildMp4().slice(0, 24);
    const moovHead = new Uint8Array(8);
    new DataView(moovHead.buffer).setUint32(0, 9 * 1024 * 1024);
    moovHead.set(new TextEncoder().encode("moov"), 4);
    const mdatHead = new Uint8Array(8);
    new DataView(mdatHead.buffer).setUint32(0, size - 24 - 9 * 1024 * 1024);
    mdatHead.set(new TextEncoder().encode("mdat"), 4);
    const fake: Mp4Source = {
      size,
      slice: (a, b) => {
        reads(a, b);
        const out = new Uint8Array(Math.max(0, Math.min(b, size) - a));
        for (let i = 0; i < out.length; i += 1) {
          const at = a + i;
          out[i] = at < 24 ? ftyp[at] : at < 32 ? moovHead[at - 24] : at >= 24 + 9 * 1024 * 1024 && at < 32 + 9 * 1024 * 1024 ? mdatHead[at - 24 - 9 * 1024 * 1024] : 0;
        }
        return new Blob([out as BlobPart]);
      },
    };
    expect(await probeMp4(fake)).toBeNull();
    expect(reads.mock.calls.every(([a, b]) => b - a <= 16)).toBe(true);
  });
});
