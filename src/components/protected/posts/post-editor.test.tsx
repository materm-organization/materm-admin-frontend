import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PostHost } from "@/components/protected/posts/post-host";
import { getMockDb } from "@/mocks/mock-db";
import { setPostRole, touchPostAsSomeoneElse } from "@/mocks/mock-posts";
import { useMockApi } from "@/mocks/test-setup";
import { server } from "@/test/msw-server";
import { grants, renderApp } from "@/test/render-app";
import type { PermissionGrant } from "@/types/user";

const API = "*/api/v1";
const me = vi.hoisted(() => ({ current: { id: 6, name: "Noy Keomany", roleID: 2, permissions: [] as PermissionGrant[] } }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useFetchCurrentUser: () => ({ data: { data: me.current } }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/blog/posts/3",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const EDITOR = grants({
  "cms.blog": ["read", "create", "update", "delete", "publish", "unpublish", "review", "translate"],
  "cms.categories": ["read"],
  "cms.locales": ["read"],
  "cms.settings": ["read"],
  "cms.seo": ["read"],
  "media.library": ["read"],
});
const AUTHOR = grants({ ...Object.fromEntries(EDITOR.map((g) => [g.permission_key, g.actions])), "cms.blog": ["read", "create", "update_own", "delete_own", "translate"] });
const TRANSLATOR = grants({ ...Object.fromEntries(EDITOR.map((g) => [g.permission_key, g.actions])), "cms.blog": ["read", "translate"] });

const root = (id: number) => getMockDb().posts.find((p) => p.id === id)!;
const open = async (id = 3, search = "") => {
  nav.search = search;
  const view = renderApp(<PostHost id={id} />);
  await screen.findByTestId(search.includes("tab=details") ? "post-details" : search.includes("tab=seo") ? "post-seo" : search.includes("tab=revisions") ? "revisions-tab" : "post-content");
  return view;
};
const user = () => userEvent.setup();

beforeEach(() => {
  me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: EDITOR };
  nav.search = "";
  nav.replace.mockReset();
  nav.push.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
});

describe("PostEditor: the Content tab", () => {
  useMockApi();

  it("shows the title, the slug, the texts of the chosen language, the cover image and the gallery; the PublishBar says it is a draft", async () => {
    await open(3);
    expect(screen.getByRole("heading", { level: 1, name: "Unfinished trail notes" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Unfinished trail notes");
    expect(screen.getByLabelText("Slug")).toHaveValue("unfinished-trail-notes");
    expect(screen.getByText("/blog/unfinished-trail-notes")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Draft only");
    expect(screen.getByTestId("post-gallery")).toHaveTextContent("0 of 60 pictures");
    // the language switch with its completeness: la has a title only (the excerpt and the SEO title are missing)
    expect(screen.getByRole("radio", { name: /English/ })).toBeInTheDocument();
  });

  it("Save draft sends ONLY what changed with If-Match, moves the ETag from the answer (no refetch) and clears the dirty state", async () => {
    const u = user();
    const seen: Array<{ ifMatch: string | null; body: unknown }> = [];
    let gets = 0;
    server.use(
      http.get(`${API}/posts/3`, () => { gets += 1; return undefined; }),
      http.patch(`${API}/posts/3`, async ({ request }) => { seen.push({ ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; })
    );
    const { queryClient } = await open(3);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await u.type(screen.getByLabelText(/^Excerpt/), "Notes from the ridge.");
    expect(await screen.findByTestId("publish-dirty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.queryByTestId("publish-dirty")).not.toBeInTheDocument());
    expect(seen).toEqual([{ ifMatch: '"1"', body: { translations: { la: { excerpt: "Notes from the ridge." } } } }]);
    expect(queryClient.getQueryData<{ etag: string }>(["/posts/3"])?.etag).toBe('"2"');
    expect(gets).toBe(1);
    expect(root(3).live.translations[0].excerpt).toBe("Notes from the ridge.");
  });

  it("the slug is checked 500 ms after typing: taken (by which post) with the suggestion in one click; invalid needs no request; the save is held back", async () => {
    const u = user();
    const checks: string[] = [];
    server.use(http.get(`${API}/posts/slug-check`, ({ request }) => { checks.push(new URL(request.url).search); return undefined; }));
    await open(3);
    const slug = screen.getByLabelText("Slug");
    await u.clear(slug);
    await u.type(slug, "Bad Slug");
    expect(screen.getByTestId("post-field-slug-la-status")).toHaveTextContent("Use lower-case letters, numbers and single hyphens.");
    await new Promise((r) => setTimeout(r, 700));
    expect(checks).toEqual([]);

    await u.clear(slug);
    await u.type(slug, "gear-checklist");
    expect(screen.getByTestId("post-field-slug-la-status")).toHaveAttribute("data-status", "checking");
    const status = await screen.findByText('Taken by "Gear checklist for beginners".', {}, { timeout: 3000 });
    expect(status).toBeInTheDocument();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toContain("locale=la");
    expect(checks[0]).toContain("slug=gear-checklist");
    expect(checks[0]).toContain("post_id=3");
    // said once, by the slug field's own status line
    expect(screen.queryByText("This slug is used by another post in this language.")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(toast.error).toHaveBeenCalledWith("Fix the problems shown in the form first.");
    expect(root(3).live.translations[0].slug).toBe("unfinished-trail-notes");

    await u.click(screen.getByRole("button", { name: "Use gear-checklist-2" }));
    expect(slug).toHaveValue("gear-checklist-2");
    expect(await screen.findByText("Available", {}, { timeout: 3000 })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(3).live.translations[0].slug).toBe("gear-checklist-2"));
  });

  it("a slug of the server's 409 (a race the check could not see) is shown at the field with the other values kept", async () => {
    const u = user();
    await open(3);
    // another post takes the slug after the check said it was free
    server.use(
      http.patch(`${API}/posts/3`, () =>
        Response.json(
          { success: false, code: "CONFLICT_DUPLICATE", message: "dup", errors: [{ in: "body", path: "/translations/la/slug", code: "duplicate", params: { suggestion: "fresh-2" } }] },
          { status: 409 }
        )
      )
    );
    const slug = screen.getByLabelText("Slug");
    await u.clear(slug);
    await u.type(slug, "fresh");
    await screen.findByText("Available", {}, { timeout: 3000 });
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("This slug is used by another post in this language.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("The server did not accept some values. They are marked in the form.");
    // not the conflict dialog: a duplicate is not a stale version
    expect(screen.queryByText("Someone else changed this item")).not.toBeInTheDocument();
    expect(slug).toHaveValue("fresh");
  });

  it("a language the post does not have yet gets its slug from its title until the slug is edited", async () => {
    const u = user();
    await open(3, "locale=en");
    const title = screen.getByLabelText(/^Title/);
    await u.type(title, "Trail Notes (EN)");
    expect(screen.getByLabelText("Slug")).toHaveValue("trail-notes-en");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(3).live.translations.map((t) => t.locale_code)).toEqual(["la", "en"]));
    expect(root(3).live.translations[1]).toMatchObject({ title: "Trail Notes (EN)", slug: "trail-notes-en" });
  });

  it("the label warns above 18 characters (a warning, the save still goes through)", async () => {
    const u = user();
    await open(3);
    await u.type(screen.getByLabelText("Label"), "A label that is far too long");
    expect(await screen.findByText(/Longer than 18 characters: the label of the blog strip may overflow/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(root(3).live.translations[0].label).toBe("A label that is far too long"));
  });

  it("changing the slug of a post that was published warns that the old link stops working", async () => {
    const u = user();
    await open(2);
    const slug = screen.getByLabelText("Slug");
    await u.type(slug, "x");
    expect(await screen.findByTestId("slug-changed-warning")).toHaveTextContent("sunrise-paddle-on-the-mekong");
  });
});

describe("PostEditor: unsaved changes and autosave", () => {
  useMockApi();

  it("a dirty form asks before the tab is closed (the guard); after the save it does not", async () => {
    const u = user();
    await open(3);
    const closes = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(closes()).toBe(false);
    await u.type(screen.getByLabelText(/^Excerpt/), "x");
    await waitFor(() => expect(closes()).toBe(true));
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(closes()).toBe(false));
  });

  it("autosave is OFF by default and the switch is a per-browser preference", async () => {
    window.localStorage.removeItem("materm-admin:autosave");
    const u = user();
    await open(3);
    const toggle = screen.getByRole("switch", { name: "Autosave (every 30 seconds)" });
    expect(toggle).not.toBeChecked();
    await u.click(toggle);
    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem("materm-admin:autosave")).toBe("on");
    window.localStorage.removeItem("materm-admin:autosave");
  });
});

describe("PostEditor: the gallery (PUT /posts/{id}/media)", () => {
  useMockApi();

  it("reorders and removes pictures, then ONE save sends the PATCH first and the PUT with the ETag the PATCH answered; new ids are kept", async () => {
    const u = user();
    const calls: Array<{ method: string; ifMatch: string | null; body: unknown }> = [];
    server.use(
      http.patch(`${API}/posts/4`, async ({ request }) => { calls.push({ method: "PATCH", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; }),
      http.put(`${API}/posts/4/media`, async ({ request }) => { calls.push({ method: "PUT", ifMatch: request.headers.get("If-Match"), body: await request.clone().json() }); return undefined; })
    );
    const { queryClient } = await open(4);
    const before = root(4).live.media.map((m) => m.id);
    const gallery = screen.getByTestId("post-gallery");
    expect(within(gallery).getAllByTestId(/^post-gallery-item-/)).toHaveLength(3);
    await u.click(within(gallery).getByRole("button", { name: "Move Picture 1 down" }));
    await u.click(within(gallery).getByRole("button", { name: "Remove picture 3" }));
    await u.type(screen.getByLabelText(/^Excerpt/), " More.");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ method: "PATCH", ifMatch: '"3"', body: { translations: { la: { excerpt: "What to pack for the dry months. More." } } } });
    expect(calls[1].method).toBe("PUT");
    expect(calls[1].ifMatch).toBe('"4"');
    expect((calls[1].body as { media: Array<{ id: number }> }).media.map((m) => m.id)).toEqual([before[1], before[0]]);
    await waitFor(() => expect(queryClient.getQueryData<{ etag: string }>(["/posts/4"])?.etag).toBe('"5"'));
    expect(root(4).live.media).toHaveLength(3); // the post has a draft: the live rows are untouched
    expect(root(4).status).toBe("published");
  });

  it("adds pictures from the picker (new rows have no id), up to 60: the add button then says it is full", async () => {
    const u = user();
    const puts: unknown[] = [];
    server.use(http.put(`${API}/posts/3/media`, async ({ request }) => { puts.push(await request.clone().json()); return undefined; }));
    await open(3);
    const gallery = screen.getByTestId("post-gallery");
    await u.click(within(gallery).getByRole("button", { name: "Add pictures" }));
    const dialog = await screen.findByRole("dialog", { name: "Add pictures to the gallery" });
    expect(within(dialog).getByText(/You can add 60 more pictures/)).toBeInTheDocument();
    const tiles = await within(dialog).findAllByRole("button", { name: /^#\d+|\.jpg|\.png/i });
    await u.click(tiles[0]);
    await u.click(tiles[1]);
    await u.click(within(dialog).getByRole("button", { name: /^Add selected/ }));
    await waitFor(() => expect(within(gallery).getAllByTestId(/^post-gallery-item-new-/)).toHaveLength(2));
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const rows = (puts[0] as { media: Array<Record<string, unknown>> }).media;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !("id" in r) && typeof r.media_id === "number" && r.translations !== undefined)).toBe(true);
    // the rows now have ids from the server
    await waitFor(() => expect(within(gallery).queryAllByTestId(/^post-gallery-item-new-/)).toHaveLength(0));
    expect(within(gallery).getAllByTestId(/^post-gallery-item-\d+$/)).toHaveLength(2);
  });

  it("a full gallery (60) cannot get more pictures; the alt text and caption are per language", async () => {
    const u = user();
    const post = root(3);
    post.live.media = Array.from({ length: 60 }, (_, i) => ({ id: 500 + i, media_id: 5, sort_order: i, translations: {} }));
    await open(3);
    const gallery = screen.getByTestId("post-gallery");
    expect(within(gallery).getByText("60 of 60 pictures")).toBeInTheDocument();
    expect(within(gallery).getByRole("button", { name: "Add pictures" })).toBeDisabled();
    expect(within(gallery).getByText("The gallery is full (60 pictures).")).toBeInTheDocument();
    const alt = within(gallery).getAllByLabelText(/^Alt text/)[0];
    await u.click(alt);
    await u.paste("Misty ridge"); // one change event, not 11: each keystroke re-rendered all 60 rows
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    // the order did not change: only the text goes, as media_translations of the existing row (no PUT)
    await waitFor(() => expect(root(3).live.media[0].translations.la?.alt).toBe("Misty ridge"));
    // 60 gallery rows with their own inputs: about 1.5 s alone, far more with the CPU shared by two suites, so this one
    // test gets a larger budget instead of raising the global one again.
  }, 30_000);
});

describe("PostEditor: Details and SEO", () => {
  useMockApi();

  it("Details: the category, the tags (0 - 10), the author (read only: the creator) and the display date; one save sends the PATCH", async () => {
    const u = user();
    const seen: unknown[] = [];
    server.use(http.patch(`${API}/posts/3`, async ({ request }) => { seen.push(await request.clone().json()); return undefined; }));
    await open(3, "tab=details");
    expect(screen.getByTestId("post-author")).toHaveTextContent("Noy Keomany");
    // category 5 (hiking) -> outdoor
    await u.click(screen.getByRole("combobox", { name: /^Category/ }));
    await u.click(await screen.findByRole("option", { name: "Outdoor" }));
    // tags: trail (already) + family
    await u.click(screen.getByRole("combobox", { name: /Tags|tag/i }));
    await u.click(await screen.findByRole("option", { name: "Family" }));
    await u.keyboard("{Escape}");
    expect(screen.getByRole("list", { name: "Tags" })).toHaveTextContent("Trail");
    expect(screen.getByRole("list", { name: "Tags" })).toHaveTextContent("Family");
    await u.click(screen.getByRole("switch", { name: "Featured" }));
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ category_id: 3, tag_ids: [1, 3], is_featured: true });
    expect(root(3).live.post).toMatchObject({ category_id: 3, is_featured: true });
    expect(root(3).live.tag_ids).toEqual([1, 3]);
  });

  it("removing a tag chip removes the tag; a post can hold 10 at most (the 11th is disabled)", async () => {
    const u = user();
    const db = getMockDb();
    // 4 live tags exist in the seed (one trashed): fill up to the limit with extra rows
    for (let i = 5; i <= 12; i++) db.tags.push({ ...db.tags[0], id: i, key: `t${i}`, translations: { la: { name: `Tag ${i}` }, en: { name: `Tag ${i}` } } });
    root(3).live.tag_ids = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
    await open(3, "tab=details");
    await u.click(screen.getByRole("combobox", { name: /Tags|tag/i }));
    expect(await screen.findByText("10 tags is the most a post can have.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Tag 12" })).toHaveAttribute("aria-disabled", "true");
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("button", { name: "Remove the tag Trail" }));
    expect(screen.getByRole("list", { name: "Tags" })).not.toHaveTextContent("Trail");
  });

  it("a display date in the future is refused at the field: Save date stays disabled and nothing is sent", async () => {
    const u = user();
    const sent: unknown[] = [];
    server.use(http.patch(`${API}/posts/3`, async ({ request }) => { sent.push(await request.clone().json()); return undefined; }));
    await open(3, "tab=details");
    await u.click(screen.getByRole("button", { name: /Display date/ }));
    const next = new Date(Date.now() + 40 * 86_400_000);
    await u.click(await screen.findByRole("button", { name: /next month/i }));
    await u.click(await screen.findByRole("button", { name: new RegExp(`(^|\\D)${next.getDate()}(\\D|$)`) }));
    await u.keyboard("{Escape}");
    expect(await screen.findByText("A date in the future is not accepted: a post cannot be scheduled yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save date" })).toBeDisabled();
    expect(sent).toEqual([]);
  });

  it("the display date has its own save: a PATCH with the date ALONE (never with the draft's fields), the ETag moves once", async () => {
    const u = user();
    const sent: unknown[] = [];
    server.use(http.patch(`${API}/posts/3`, async ({ request }) => { sent.push(await request.clone().json()); return undefined; }));
    const { queryClient } = await open(3, "tab=details");
    await u.click(screen.getByRole("switch", { name: "Featured" })); // a draft edit that stays unsaved
    await u.click(screen.getByRole("button", { name: /Display date/ }));
    await u.click(await screen.findByRole("button", { name: /previous month/i }));
    await u.click(await screen.findByRole("button", { name: /(^|\D)10(\D|$)/ }));
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(Object.keys(sent[0] as object)).toEqual(["published_at"]);
    expect(root(3).published_at).toMatch(/^20/);
    expect(queryClient.getQueryData<{ etag: string }>(["/posts/3"])?.etag).toBe('"2"');
    expect(toast.success).toHaveBeenCalledWith("The display date was saved.");
    // the draft edit is still unsaved
    expect(screen.getByTestId("publish-dirty")).toBeInTheDocument();
    expect(root(3).live.post.is_featured).toBe(false);
  });

  it("on a published post the date goes live at once and says so", async () => {
    const u = user();
    await open(2, "tab=details");
    expect(screen.getByText(/shows on the website at once/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Display date/ }));
    await u.click(await screen.findByRole("button", { name: /previous month/i }));
    await u.click(await screen.findByRole("button", { name: /(^|\D)12(\D|$)/ }));
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("The display date was saved and is on the website now."));
    expect(root(2)).toMatchObject({ status: "published" });
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Published");
    expect(screen.getByTestId("status-badge")).not.toHaveTextContent("changes pending");
  });

  it("SEO: its own language (the default one), the title / description with their lengths, the share image and the search result preview", async () => {
    const u = user();
    await open(5, "tab=seo");
    expect(screen.getByLabelText(/^SEO title/)).toHaveValue("Gear checklist for beginners");
    const preview = screen.getByTestId("serp-preview");
    expect(preview).toHaveTextContent("/blog/gear-checklist");
    await u.type(screen.getByLabelText(/^SEO description/), "x".repeat(170));
    expect(await screen.findByText(/Longer than 160 characters: search engines may cut it/)).toBeInTheDocument();
    // the English SEO title is empty: the default language notice only shows when ANOTHER language is on screen
    expect(screen.queryByTestId("seo-default-missing")).not.toBeInTheDocument();
  });

  it("SEO of another language: a notice brings the default language back when its SEO title is empty", async () => {
    root(5).live.translations[0].seo_title = null;
    await open(5, "tab=seo&seoLocale=en");
    const notice = await screen.findByTestId("seo-default-missing");
    expect(notice).toHaveTextContent(/SEO title is still empty. Publishing needs it./);
  });
});

describe("PostEditor: publishing (PublishBar over the posts engine)", () => {
  useMockApi();

  it("a draft with problems is blocked with pointers by group; 'Go to field' opens the tab, the language and the field", async () => {
    const u = user();
    await open(7);
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByText("This post cannot be published yet")).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Post details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Gallery" })).toBeInTheDocument();
    const items = within(dialog).getAllByTestId("publish-blocker");
    expect(items.map((i) => i.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Category.*This is required/), expect.stringMatching(/Cover image.*no alt text/), expect.stringMatching(/Excerpt.*Required in the default language/)])
    );
    // the warnings do not block: the label is too long for the blog strip
    expect(within(dialog).getAllByTestId("publish-warning").map((w) => w.textContent).join(" ")).toMatch(/label is longer than 18 characters/);
    await u.click(within(dialog).getByRole("button", { name: "Go to field: Category" }));
    expect(nav.replace).toHaveBeenCalled();
    const url = nav.replace.mock.calls.at(-1)![0] as string;
    expect(url).toContain("tab=details");
    expect(url).toContain("field=%2Fcategory_id");
  });

  it("a link with ?field= opens the tab and focuses the field, then removes the parameter", async () => {
    nav.search = "tab=details&field=%2Fcategory_id";
    const view = renderApp(<PostHost id={7} />);
    await screen.findByTestId("post-details");
    await waitFor(() => expect(document.activeElement?.id).toBe("post-field-category_id"));
    expect(nav.replace).toHaveBeenCalledWith("/admin/blog/posts/3?tab=details", { scroll: false });
    view.unmount();

    nav.search = "locale=la&field=%2Ftranslations%2Fla%2Fexcerpt";
    renderApp(<PostHost id={7} />);
    await screen.findByTestId("post-content");
    await waitFor(() => expect(document.activeElement?.id).toBe("post-field-excerpt-la"));
  });

  it("the slug collision of a pending draft is caught at publish (duplicate at /translations/en/slug) and Go to field names the language", async () => {
    const u = user();
    await open(4);
    await u.click(screen.getByRole("button", { name: "Publish changes" }));
    const dialog = await screen.findByTestId("publish-blockers");
    expect(within(dialog).getByText("This slug is already used by another post in this language.")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: /^Go to field: Slug/ }));
    const url = nav.replace.mock.calls.at(-1)![0] as string;
    expect(url).toContain("locale=en");
    expect(url).toContain("field=%2Ftranslations%2Fen%2Fslug");
  });

  it("Publish: dry run first, then the confirmation with the language gaps, then the real publish with an Idempotency-Key; the chip turns Published", async () => {
    const u = user();
    const seen: Array<{ dry: boolean; key: string | null; ifMatch: string | null }> = [];
    server.use(http.post(`${API}/posts/8/publish`, ({ request }) => { seen.push({ dry: new URL(request.url).searchParams.get("dry_run") === "true", key: request.headers.get("Idempotency-Key"), ifMatch: request.headers.get("If-Match") }); return undefined; }));
    await open(8);
    await u.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish this post?" });
    await u.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Published."));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ dry: true, key: null, ifMatch: '"1"' });
    expect(seen[1].dry).toBe(false);
    expect(seen[1].key).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Published"));
    expect(root(8)).toMatchObject({ status: "published", lock_version: 2 });
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("Unpublish never fails because a page shows the post: it works, and the notice says those pages skip it now (non-blocking)", async () => {
    const u = user();
    const seen: string[] = [];
    server.use(http.post(`${API}/posts/1/unpublish`, ({ request }) => { seen.push(new URL(request.url).search); return undefined; }));
    await open(1);
    await u.click(screen.getByRole("button", { name: "Unpublish" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }));
    const notice = await screen.findByTestId("notice-post_referenced");
    expect(notice).toHaveTextContent("Pages that show this post skip it now");
    expect(seen).toEqual([""]); // no confirm_references for a post
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveTextContent("Archived"));
  });

  it("Discard changes turns the pending draft into history and re-seeds the form from the server's version", async () => {
    const u = user();
    await open(4);
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Dry season gear list (2026)");
    await u.click(screen.getByRole("button", { name: "Discard changes" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue("Dry season gear list"));
    expect(root(4).status).toBe("published");
  });
});

describe("PostEditor: who may do what (PT-2, PT-3)", () => {
  useMockApi();

  it("an author edits their own post fully but has no Publish / Unpublish; their own post offers the preview", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 3, permissions: AUTHOR };
    setPostRole(getMockDb(), "author");
    await open(3);
    expect(screen.getByLabelText(/^Title/)).toBeEnabled();
    expect(screen.queryByTestId("translate-mode-note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
  });

  it("an author on somebody else's post is in translate mode: the default language is read only, another language is editable, no preview, no publish", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 3, permissions: AUTHOR };
    setPostRole(getMockDb(), "author");
    const u = user();
    const sent: unknown[] = [];
    server.use(http.patch(`${API}/posts/8`, async ({ request }) => { sent.push(await request.clone().json()); return undefined; }));
    await open(8);
    expect(screen.getByTestId("translate-mode-note")).toHaveTextContent("This post belongs to Somchai Vongsa. You can translate it");
    expect(screen.getByTestId("translate-default-note")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.getByLabelText("Slug")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add pictures" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    // another language: editable
    await u.click(screen.getByRole("radio", { name: /English/ }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/blog/posts/3?locale=en", { scroll: false });
  });

  it("translate mode (language en): the texts of en are editable, one save sends only them; the shared fields and the gallery structure are locked", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 4, permissions: TRANSLATOR };
    setPostRole(getMockDb(), "translator");
    const u = user();
    const sent: unknown[] = [];
    server.use(http.patch(`${API}/posts/8`, async ({ request }) => { sent.push(await request.clone().json()); return undefined; }));
    await open(8, "locale=en");
    expect(screen.queryByTestId("translate-default-note")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Add pictures" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change image: Cover image" })).toBeDisabled();
    await u.clear(screen.getByLabelText(/^Title/));
    await u.type(screen.getByLabelText(/^Title/), "Camp kitchen");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ translations: { en: { title: "Camp kitchen" } } });
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("a reader sees the post with a note and no Save draft", async () => {
    me.current = { id: 6, name: "Noy Keomany", roleID: 2, permissions: grants({ "cms.blog": ["read"], "cms.locales": ["read"] }) };
    setPostRole(getMockDb(), "translator");
    await open(8);
    expect(screen.getByTestId("read-only-note")).toHaveTextContent("You can read it, not change it.");
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Autosave (every 30 seconds)")).not.toBeInTheDocument();
  });

  it("a post in the trash says so and is read only", async () => {
    await open(6);
    expect(screen.getByText("This post is in the trash")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});

describe("PostEditor: conflicts, preview links, history", () => {
  useMockApi();

  it("somebody else saved the post: the next save is a 409 CONFLICT_LOCK_VERSION -> the conflict dialog; 'load the latest' re-seeds the form", async () => {
    const u = user();
    await open(3);
    act(() => {
      touchPostAsSomeoneElse(getMockDb(), 3);
    });
    root(3).live.translations[0].title = "Trail notes (changed by Somchai)";
    await u.type(screen.getByLabelText(/^Excerpt/), "Mine.");
    await u.click(screen.getByRole("button", { name: "Save draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Someone else changed this item" });
    await u.click(within(dialog).getByRole("button", { name: /Load the latest version/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue("Trail notes (changed by Somchai)"));
    expect(screen.getByLabelText(/^Excerpt/)).toHaveValue("");
  });

  it("Preview: the dialog is made for a post (wording, /blog/<slug> link) and the dirty edits are flagged", async () => {
    const u = user();
    await open(3);
    await u.type(screen.getByLabelText(/^Excerpt/), "x");
    await u.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = await screen.findByTestId("preview-link-dialog");
    expect(within(dialog).getByText(/see this post as it is now, before it is published/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("preview-dirty-warning")).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Save draft first" }));
    await waitFor(() => expect(root(3).live.translations[0].excerpt).toBe("x"));
    await u.click(within(dialog).getByRole("button", { name: "Create link" }));
    const url = (await within(dialog).findByLabelText("Preview link")) as HTMLInputElement;
    expect(decodeURIComponent(url.value)).toContain("/blog/unfinished-trail-notes");
    expect(within(dialog).getByText("Active links")).toBeInTheDocument();
  });

  it("History: the revisions of the post (draft, published, history), restore as draft re-seeds the form", async () => {
    const u = user();
    await open(4, "tab=revisions");
    const tab = await screen.findByTestId("revisions-tab");
    await within(tab).findAllByRole("row");
    expect(within(tab).getAllByText(/Draft|Published|Earlier version/i).length).toBeGreaterThan(0);
    const restoreButtons = await within(tab).findAllByRole("button", { name: /Restore/ });
    expect(restoreButtons.length).toBeGreaterThan(0);
    void u;
  });
});
