import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PublishBlockersDialog, issueMessage } from "@/components/global/publishing/publish-blockers-dialog";
import { cmsHandlers } from "@/test/cms-handlers";
import { server } from "@/test/msw-server";
import { renderApp } from "@/test/render-app";
import { useTranslations } from "next-intl";
import type { MediaAssetOption } from "@/types/cms";

import { schemaHash } from "../../../../scripts/generate-schema-validators.mjs";
import { computeCompleteness } from "../completeness";
import { compileFieldTree } from "../compile-field-tree";
import { memorySchemaFormData } from "../data/memory-data";
import { SchemaFormDataProvider } from "../data/provider";
import type { MediaQuery, SchemaFormData } from "../data/types";
import { SECTION_TYPE_FIXTURES } from "../fixtures";
import { MEDIA_FIXTURES } from "../fixtures/lookup";
import { locateIssue, serverErrorsToIssues } from "../issues";
import { Host, LOCALES, issueTexts, settle } from "../test-utils";
import { createSchemaValidator } from "../validate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/dev",
}));

beforeEach(() => server.use(...cmsHandlers));

const hero = SECTION_TYPE_FIXTURES.hero_brand;
const BG = { media_id: 1, decorative: true };
const VIDEO: MediaAssetOption = {
  id: 25,
  filename: "forest-loop.mp4",
  url: "data:image/svg+xml;utf8,x",
  thumbnail_url: "data:image/svg+xml;utf8,x",
  mime_type: "video/mp4",
  kind: "video",
  status: "ready",
  bytes: 4_820_113,
  duration_ms: 12_500,
  width: 1280,
  height: 720,
};
const LIBRARY: MediaAssetOption[] = [...MEDIA_FIXTURES, VIDEO];
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];

// A library that records the queries and, when `honorMime` is false, ignores the `mime` filter (a server that returned videos for
// an image query): the picker must still not offer a video to an image field.
function library(honorMime: boolean, queries: MediaQuery[]): SchemaFormData {
  return {
    ...memorySchemaFormData,
    getMedia: async (id) => LIBRARY.find((m) => m.id === id),
    listMedia: async (query) => {
      queries.push(query);
      const mimes = query.mime?.split(",") ?? [];
      const items = LIBRARY.filter((m) => {
        if (query.ids) return query.ids.includes(m.id);
        if (!honorMime || mimes.length === 0) return true;
        return mimes.some((x) => (x.endsWith("/*") ? (m.mime_type ?? "").startsWith(x.slice(0, -1)) : m.mime_type === x));
      });
      return { items, total: items.length, page: 1, totalPages: 1 };
    },
  };
}

function setup(initial: Record<string, unknown>, options: Record<string, unknown> = {}, honorMime = true) {
  const queries: MediaQuery[] = [];
  const onChange = vi.fn();
  renderApp(
    <SchemaFormDataProvider data={library(honorMime, queries)}>
      <Host type={hero} initial={initial} options={{ onChange, ...options }} />
    </SchemaFormDataProvider>
  );
  return { queries, onChange };
}

describe("MediaVideoField", () => {
  it("is compiled for any {media_id} object annotated x-media-kind: video", () => {
    const node = compileFieldTree(hero.json_schema, hero.ui_schema).root.children.find((c) => c.name === "background_video");
    expect(node?.kind).toBe("media-video");
    expect(compileFieldTree(hero.json_schema, hero.ui_schema).root.children.find((c) => c.name === "background")?.kind).toBe("image");
  });

  it("empty state: label, 'No background video', Choose video and the help text; no Remove", async () => {
    setup({ title: { la: "T" }, background: BG });
    expect((await screen.findAllByText("Background video (optional)")).length).toBeGreaterThan(0);
    expect(screen.getByText("No background video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose video" })).toBeEnabled();
    expect(screen.getByText(/Plays muted on a loop behind the title\. The background photo above is shown first and is used as the poster and when the video cannot play\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change video" })).not.toBeInTheDocument();
    // the image control keeps the neighbouring label
    expect(screen.getAllByText("Background photo").length).toBeGreaterThan(0);
  });

  it("the picker takes video/mp4 only, lists the video and not the images, and a pick writes {media_id}", async () => {
    const u = userEvent.setup();
    const { queries, onChange } = setup({ title: { la: "T" }, background: BG });
    await u.click(screen.getByRole("button", { name: "Choose video" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a video" });
    expect(await within(dialog).findByRole("button", { name: "forest-loop.mp4" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "hero-bg.png" })).not.toBeInTheDocument();
    expect(queries.some((q) => q.mime === "video/mp4")).toBe(true);
    expect(queries.every((q) => q.mime === "video/mp4" || q.ids)).toBe(true);
    await u.click(within(dialog).getByRole("button", { name: "forest-loop.mp4" }));
    expect(last(onChange).background_video).toEqual({ media_id: 25 });
    expect(last(onChange).background).toEqual(BG);
    // chosen state: file name, duration m:ss, size, Change + Remove
    expect(await screen.findByText("forest-loop.mp4")).toBeInTheDocument();
    expect(screen.getByText("0:13 · 4.6 MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change video" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove video" })).toBeEnabled();
  });

  it("Remove deletes the member (no null, no {}); a form that never had one equals its initial value again", async () => {
    const u = userEvent.setup();
    const initial = { title: { la: "T" }, background: BG };
    const { onChange } = setup(initial);
    await u.click(screen.getByRole("button", { name: "Choose video" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a video" });
    await u.click(await within(dialog).findByRole("button", { name: "forest-loop.mp4" }));
    await u.click(await screen.findByRole("button", { name: "Remove video" }));
    const after = last(onChange);
    expect(after).not.toHaveProperty("background_video");
    expect(JSON.stringify(after)).not.toContain("null");
    expect(after).toEqual(initial);
    expect(screen.getByText("No background video")).toBeInTheDocument();
  });

  it("Change replaces the video", async () => {
    const u = userEvent.setup();
    const { onChange } = setup({ title: { la: "T" }, background: BG, background_video: { media_id: 25 } });
    expect(await screen.findByText("forest-loop.mp4")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Change video" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a video" });
    await u.click(await within(dialog).findByRole("button", { name: "forest-loop.mp4" }));
    expect(last(onChange).background_video).toEqual({ media_id: 25 });
  });

  it.each([
    ["read-only form", { disabled: true }],
    ["translate-only form", { translateOnly: true }],
  ])("%s: Choose / Change / Remove are disabled and no picker opens", async (_name, options) => {
    const u = userEvent.setup();
    setup({ title: { la: "T" }, background: BG, background_video: { media_id: 25 } }, options);
    expect(await screen.findByText("forest-loop.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove video" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Change video" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("read-only empty field: Choose video is disabled", () => {
    setup({ title: { la: "T" }, background: BG }, { disabled: true });
    expect(screen.getByRole("button", { name: "Choose video" })).toBeDisabled();
  });

  it("says so when the referenced media no longer exists", async () => {
    setup({ title: { la: "T" }, background: BG, background_video: { media_id: 999 } });
    expect(await screen.findByText("Video #999 was not found")).toBeInTheDocument();
  });
});

describe("the image field next to a video", () => {
  it("never offers a video, even when the server ignores the mime filter", async () => {
    const u = userEvent.setup();
    const { queries } = setup({ title: { la: "T" } }, {}, false);
    await u.click(screen.getByRole("button", { name: "Choose image" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose an image" });
    expect(await within(dialog).findByRole("button", { name: "hero-bg.png" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "forest-loop.mp4" })).not.toBeInTheDocument();
    expect(queries.some((q) => q.mime === "image/*")).toBe(true);
    // and the kind filter has no Video option
    expect(within(dialog).queryByRole("option", { name: "Video" })).not.toBeInTheDocument();
  });

  it("no poster hint without a background video", async () => {
    setup({ title: { la: "T" }, background: BG });
    expect(document.querySelector('[data-slot="poster-hint"]')).toBeNull();
  });

  it("shows the poster hint under the image when background_video is present", async () => {
    setup({ title: { la: "T" }, background: BG, background_video: { media_id: 25 } });
    const hint = await waitFor(() => {
      const el = document.querySelector('[data-slot="poster-hint"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(hint.textContent).toBe("A background video is set. This photo is shown first and is used as the poster and when the video cannot play.");
  });

  it("choosing a video in the empty form makes the hint appear, removing it makes it go", async () => {
    const u = userEvent.setup();
    setup({ title: { la: "T" }, background: BG });
    await u.click(screen.getByRole("button", { name: "Choose video" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a video" });
    await u.click(await within(dialog).findByRole("button", { name: "forest-loop.mp4" }));
    await waitFor(() => expect(document.querySelector('[data-slot="poster-hint"]')).not.toBeNull());
    await u.click(screen.getByRole("button", { name: "Remove video" }));
    await waitFor(() => expect(document.querySelector('[data-slot="poster-hint"]')).toBeNull());
  });
});

describe("validation", () => {
  const validator = createSchemaValidator(hero.json_schema, schemaHash(hero.json_schema));

  it("uses the precompiled validator (no Ajv, no new Function)", () => {
    expect(validator.precompiled).toBe(true);
  });

  it.each(["draft", "publish"] as const)("%s: {media_id: 5} is valid; 0 and extra members are not; {} is refused at publish (draft skips `required` by design)", (mode) => {
    const base = { title: { la: "T" }, background: BG };
    const opts = { mode, defaultLocale: "la" } as const;
    expect(validator.validate({ ...base, background_video: { media_id: 5 } }, opts)).toEqual([]);
    const empty = validator.validate({ ...base, background_video: {} }, opts).map((i) => i.path);
    if (mode === "publish") expect(empty).toContain("/background_video/media_id");
    else expect(empty).toEqual([]);
    expect(validator.validate({ ...base, background_video: { media_id: 0 } }, opts)).not.toEqual([]);
    expect(validator.validate({ ...base, background_video: { media_id: 5, extra: 1 } }, opts)).not.toEqual([]);
    expect(validator.validate(base, opts)).toEqual([]);
  });

  it("completeness is unaffected by the video", () => {
    const without = computeCompleteness(hero.json_schema, { title: { la: "A" }, background: BG }, ["la"]);
    const withVideo = computeCompleteness(hero.json_schema, { title: { la: "A" }, background: BG, background_video: { media_id: 25 } }, ["la"]);
    expect(withVideo).toEqual(without);
  });
});

describe("kind_mismatch", () => {
  const tree = compileFieldTree(hero.json_schema, hero.ui_schema);

  it("locates both pointers on their own field", () => {
    expect(locateIssue(tree, "/background_video/media_id")).toMatchObject({ fieldPointer: "/background_video/media_id", matched: true });
    expect(locateIssue(tree, "/background/media_id")).toMatchObject({ matched: true });
    const issues = serverErrorsToIssues([{ in: "body", path: "/props/background_video/media_id", code: "kind_mismatch", params: { expected_kind: "video", actual_kind: "image" } }], "/props");
    expect(issues[0].path).toBe("/background_video/media_id");
  });

  async function withErrors(path: string, params?: Record<string, string>) {
    const errors = [{ in: "body" as const, path, code: "kind_mismatch", ...(params ? { params } : {}) }];
    setup({ title: { la: "T" }, background: BG, background_video: { media_id: 25 } }, { serverErrors: errors, serverErrorPrefix: "/props" });
    await settle();
  }

  it("save 422 at the video field: readable message there, the control is flagged and focused", async () => {
    await withErrors("/props/background_video/media_id", { expected_kind: "video", actual_kind: "image" });
    expect(issueTexts(document.body)).toEqual(["This file is a photo; pick a video here."]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Change video" })).toHaveAttribute("aria-invalid", "true"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Change video" })).toHaveFocus());
  });

  it("save 422 at the image field: 'This file is a video; pick a photo here.'", async () => {
    await withErrors("/props/background/media_id", { expected_kind: "image", actual_kind: "video" });
    expect(issueTexts(document.body)).toEqual(["This file is a video; pick a photo here."]);
  });

  it("a video slot given a non-image, non-video file says 'not a video'", async () => {
    await withErrors("/props/background_video/media_id", { expected_kind: "video", actual_kind: "document" });
    expect(issueTexts(document.body)).toEqual(["This file is not a video; pick a video here."]);
  });

  it("without params (a 'Go to field' jump carries only the code) the generic wording is used", async () => {
    await withErrors("/props/background_video/media_id");
    expect(issueTexts(document.body)).toEqual(["This file is not the right kind for this field."]);
  });

  it("publish blocker: message, field label and 'Go to field' hands over the pointer", async () => {
    const u = userEvent.setup();
    const onGoToField = vi.fn();
    const pid = "0192d3a4-7c1e-7b52-9d0a-000000000001";
    const blocker = {
      path: `/sections/${pid}/props/background_video/media_id`,
      code: "kind_mismatch",
      params: { section_key: "hero_brand", section_index: 0, expected_kind: "video", actual_kind: "image" },
    };
    renderApp(<PublishBlockersDialog open onOpenChange={() => undefined} blockers={[blocker]} noun="page" onGoToField={onGoToField} />);
    const row = await screen.findByTestId("publish-blocker");
    expect(within(row).getByText("This file is a photo; pick a video here.")).toBeInTheDocument();
    expect(within(row).getByText(/Background video/)).toBeInTheDocument();
    await u.click(within(row).getByRole("button", { name: /Go to field/ }));
    expect(onGoToField).toHaveBeenCalledWith(expect.objectContaining({ pointer: blocker.path, sectionPublicId: pid, code: "kind_mismatch" }));
  });

  it("issueMessage picks the wording by expected_kind", () => {
    function Probe({ expected, actual }: { expected: string; actual: string }) {
      const t = useTranslations("publishing");
      return <p data-testid="msg">{issueMessage(t, { path: "/sections/x/props/background/media_id", code: "kind_mismatch", params: { expected_kind: expected, actual_kind: actual } })}</p>;
    }
    renderApp(<Probe expected="image" actual="video" />);
    expect(screen.getByTestId("msg")).toHaveTextContent("This file is a video; pick a photo here.");
  });
});

describe("a picker that did not opt into video (post cover, og image, avatar ...)", () => {
  it("asks the API for every kind except video and drops a video row the server returned anyway", async () => {
    const { MediaPicker } = await import("@/components/protected/media/media-picker");
    const queries: MediaQuery[] = [];
    const u = userEvent.setup();
    void u;
    renderApp(
      <SchemaFormDataProvider data={library(false, queries)}>
        <MediaPicker open onOpenChange={() => undefined} onSelect={() => undefined} />
      </SchemaFormDataProvider>
    );
    expect(await screen.findByRole("button", { name: "hero-bg.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "forest-loop.mp4" })).not.toBeInTheDocument();
    expect(queries.some((q) => q.kind && !q.kind.split(",").includes("video") && q.kind.includes("image"))).toBe(true);
  });
});
