import { beforeEach, describe, expect, it } from "vitest";

import { MockHttpError, SEED_VIDEO_ID, addSeedVideo, getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getPage, listSections, patchSection, publishPage } from "@/mocks/mock-pages";

// The media kind rule of the mock backend (the real one: materm-admin-backend pkg/content/mediakind.go): a media_id at a node annotated
// `x-media-kind: video` takes only a video, every other media slot refuses a video; 422 `kind_mismatch` at the field pointer with
// params { expected_kind, actual_kind }, at save and as a PUBLISH_BLOCKED blocker.
const fails = (fn: () => unknown, status: number, code?: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MockHttpError);
    expect((error as MockHttpError).status).toBe(status);
    if (code) expect((error as MockHttpError).body.code).toBe(code);
    return error as MockHttpError;
  }
  throw new Error("expected the call to fail");
};
type Err = { in: string; path: string; code: string; params?: Record<string, unknown> };
const errorsOf = (e: MockHttpError) => e.body.errors as Err[];
const q = (s = "") => new URLSearchParams(s);
const etag = (id: number) => getPage(getMockDb(), String(id)).etag;
const hero = () => listSections(getMockDb(), "8", q("include=props")).data[0];

beforeEach(() => {
  resetMockDb();
  addSeedVideo(getMockDb());
});

describe("mock backend: kind_mismatch", () => {
  it("has a seeded video and images", () => {
    const { assets } = getMockDb();
    expect(assets.find((a) => a.id === SEED_VIDEO_ID)).toMatchObject({ kind: "video", mime_type: "video/mp4", duration_ms: 12_500 });
    expect(assets.filter((a) => a.kind === "image").length).toBeGreaterThan(5);
  });

  it("save: a video in the video slot is accepted, and removing the member works", () => {
    const h = hero();
    const done = patchSection(getMockDb(), "8", String(h.id), { props: { ...h.props, background_video: { media_id: SEED_VIDEO_ID } } }, etag(8));
    expect(done.data.section.props).toMatchObject({ background_video: { media_id: SEED_VIDEO_ID } });
    const { background_video: _drop, ...rest } = done.data.section.props as Record<string, unknown>;
    void _drop;
    const back = patchSection(getMockDb(), "8", String(h.id), { props: rest }, done.etag);
    expect(back.data.section.props).not.toHaveProperty("background_video");
  });

  it("save: an image in the video slot -> kind_mismatch at /props/background_video/media_id (expected video, actual image)", () => {
    const h = hero();
    const e = fails(() => patchSection(getMockDb(), "8", String(h.id), { props: { ...h.props, background_video: { media_id: 1 } } }, etag(8)), 422);
    expect(errorsOf(e)).toEqual([{ in: "body", path: "/props/background_video/media_id", code: "kind_mismatch", params: { expected_kind: "video", actual_kind: "image" } }]);
  });

  it("save: a video in the image slot -> kind_mismatch at /props/background/media_id (expected image, actual video)", () => {
    const h = hero();
    const e = fails(() => patchSection(getMockDb(), "8", String(h.id), { props: { ...h.props, background: { media_id: SEED_VIDEO_ID, decorative: true } } }, etag(8)), 422);
    expect(errorsOf(e)).toEqual([{ in: "body", path: "/props/background/media_id", code: "kind_mismatch", params: { expected_kind: "image", actual_kind: "video" } }]);
  });

  it("publish dry run: a draft whose video row became an image is a PUBLISH_BLOCKED blocker at the section pointer", () => {
    const db = getMockDb();
    const h = hero();
    const saved = patchSection(db, "8", String(h.id), { props: { ...h.props, background_video: { media_id: SEED_VIDEO_ID } } }, etag(8));
    // the row is changed behind the draft's back (the real backend can see the same after a file replace / restore)
    const row = db.assets.find((a) => a.id === SEED_VIDEO_ID)!;
    row.kind = "image";
    row.mime_type = "image/png";
    const e = fails(() => publishPage(db, "8", q("dry_run=true"), undefined, saved.etag), 422, "PUBLISH_BLOCKED");
    const blocker = errorsOf(e).find((x) => x.code === "kind_mismatch");
    expect(blocker).toMatchObject({
      in: "entity",
      path: `/sections/${h.public_id}/props/background_video/media_id`,
      params: { expected_kind: "video", actual_kind: "image", section_key: "hero_brand" },
    });
  });

  it("publish dry run: a valid video produces no kind_mismatch", () => {
    const db = getMockDb();
    const h = hero();
    const saved = patchSection(db, "8", String(h.id), { props: { ...h.props, background_video: { media_id: SEED_VIDEO_ID } } }, etag(8));
    try {
      publishPage(db, "8", q("dry_run=true"), undefined, saved.etag);
    } catch (error) {
      expect(JSON.stringify((error as MockHttpError).body)).not.toContain("kind_mismatch");
    }
  });
});
