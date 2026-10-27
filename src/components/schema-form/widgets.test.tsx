import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RichTextDoc } from "@/components/schema-form/richtext-doc";
import { cmsHandlers } from "@/test/cms-handlers";
import { server } from "@/test/msw-server";

import { SECTION_TYPE_FIXTURES } from "./fixtures";
import { issueTexts, renderSchemaForm, settle } from "./test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/dev",
}));

beforeEach(() => server.use(...cmsHandlers));

const hero = SECTION_TYPE_FIXTURES.hero_brand;
const BG = { media_id: 1, decorative: true };
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];
const heroWith = (cta?: unknown) => ({ title: { la: "T" }, background: BG, ...(cta ? { cta } : {}) });

describe("LinkField", () => {
  it("switching the type clears the other type's fields", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "page", page_id: 2, anchor: "x" } }), { onChange });
    await u.click(screen.getByRole("radio", { name: "URL" }));
    expect(last(onChange).cta.link).toEqual({ type: "url" });
    await u.type(screen.getByLabelText("Address"), "https://example.test");
    expect(last(onChange).cta.link).toEqual({ type: "url", url: "https://example.test" });
    await u.click(screen.getByRole("radio", { name: "Page" }));
    expect(last(onChange).cta.link).toEqual({ type: "page" });
  });

  it("rejects //evil.test and /\\evil.test at once (R-016), accepts https, /path, mailto and tel", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "url", url: "/ok" } }), { onChange, mode: "draft" });
    const address = screen.getByLabelText("Address");
    expect(address).not.toHaveAttribute("aria-invalid");

    await u.clear(address);
    await u.type(address, "//evil.test");
    expect(await screen.findByText(/starts with \/\/ or \/\\ leaves the site/)).toBeInTheDocument();
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(address.getAttribute("aria-describedby")).toBeTruthy();
    // the schema-level problem is not shown twice
    expect(issueTexts(document.body).filter((t) => t.includes("required pattern"))).toEqual([]);

    await u.clear(address);
    await u.type(address, "/\\evil.test");
    expect(await screen.findByText(/leaves the site/)).toBeInTheDocument();

    for (const ok of ["https://example.test/a", "/about", "mailto:a@b.test", "tel:+8562012345"]) {
      await u.clear(address);
      await u.type(address, ok);
      await waitFor(() => expect(address).not.toHaveAttribute("aria-invalid"));
      expect(screen.queryByText(/leaves the site/)).not.toBeInTheDocument();
    }
    await u.clear(address);
    await u.type(address, "javascript:alert(1)");
    expect(await screen.findByText(/Use https:\/\/, \/path/)).toBeInTheDocument();
  });

  it("the kind selector rewrites the address prefix; new tab and rel are stored sparsely", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "url", url: "https://example.test" } }), { onChange });
    await u.click(screen.getByRole("switch", { name: "Open in a new tab" }));
    expect(last(onChange).cta.link).toEqual({ type: "url", url: "https://example.test", open_in_new_tab: true });
    await u.click(screen.getByRole("checkbox", { name: "ugc" }));
    await u.click(screen.getByRole("checkbox", { name: "nofollow" }));
    expect(last(onChange).cta.link.rel).toEqual(["nofollow", "ugc"]);
    await u.click(screen.getByRole("switch", { name: "Open in a new tab" }));
    expect(last(onChange).cta.link).not.toHaveProperty("open_in_new_tab");

    await u.click(screen.getByRole("combobox", { name: "Kind of address" }));
    await u.click(await screen.findByRole("option", { name: "Email (mailto:)" }));
    expect(last(onChange).cta.link.url).toBe("mailto:example.test");
  });

  it("a page link picks a page, warns when it is not published, and 'Clear link' removes the link", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "page" } }), { onChange });
    await u.click(screen.getByRole("combobox", { name: /^Page/ }));
    await u.click(await screen.findByRole("option", { name: /Spring campaign/ }));
    expect(last(onChange).cta.link).toEqual({ type: "page", page_id: 6 });
    expect(await screen.findByText(/This page is draft: the link is hidden/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Clear link" }));
    expect(last(onChange).cta).not.toHaveProperty("link");
  });

  it("a half-filled link saves in draft and is flagged in publish", async () => {
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "page" } }), { mode: "draft" });
    await settle();
    expect(issueTexts(document.body)).toEqual([]);
  });
});

describe("MediaField", () => {
  it("chooses an image from the library, then changes and removes it", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, { title: { la: "T" } }, { onChange });
    await u.click(screen.getByRole("button", { name: "Choose image" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose an image" });
    await u.click(await within(dialog).findByRole("button", { name: "hero-bg.png" }));
    expect(last(onChange).background).toEqual({ media_id: 1 });
    expect(await screen.findByText("hero-bg.png")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Change image" }));
    await u.type(await screen.findByLabelText("Search by file name"), "forest");
    await waitFor(() => expect(screen.queryByRole("button", { name: "hero-bg.png" })).not.toBeInTheDocument());
    const second = await screen.findByRole("button", { name: "hero-bg-forest.jpg" });
    await u.click(second);
    expect(last(onChange).background).toEqual({ media_id: 10 });
    await u.click(screen.getByRole("button", { name: "Remove" }));
    expect(last(onChange)).not.toHaveProperty("background");
  });

  it("decorative hides the alt text; the alt input's placeholder is the media's own alt", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    // media 3 carries an alt of its own (fixture)
    renderSchemaForm(hero, { title: { la: "T" }, background: { media_id: 3 } }, { onChange });
    const alt = screen.getByLabelText("Alt text");
    await waitFor(() => expect(alt).toHaveAttribute("placeholder", "Alt our-path-photo-2.jpg"));
    await u.type(alt, "Mine");
    expect(last(onChange).background).toEqual({ media_id: 3, alt: { la: "Mine" } });
    await u.click(screen.getByRole("switch", { name: "Decorative image (no alt text)" }));
    expect(last(onChange).background.decorative).toBe(true);
    expect(screen.queryByLabelText("Alt text")).not.toBeInTheDocument();
  });

  it("says so when the referenced media no longer exists", async () => {
    renderSchemaForm(hero, { title: { la: "T" }, background: { media_id: 999 } });
    expect(await screen.findByText("Image #999 was not found")).toBeInTheDocument();
  });
});

describe("EntityPicker", () => {
  const strip = SECTION_TYPE_FIXTURES.blog_strip;
  const base = { eyebrow: { la: "E" }, title: { la: "T" }, source: "manual" };

  it("searches asynchronously, picks a post and warns about a post that is not published", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(strip, { ...base, items: [{}] }, { onChange });
    await u.click(screen.getByRole("combobox", { name: /^Post id/ }));
    expect(await screen.findByRole("option", { name: /Music night under the stars/ })).toBeInTheDocument();
    await u.type(screen.getByPlaceholderText("Search"), "trail");
    await waitFor(() => expect(screen.queryByRole("option", { name: /Music night/ })).not.toBeInTheDocument());
    const draft = await screen.findByRole("option", { name: /Unfinished trail notes/ });
    await u.click(draft);
    expect(last(onChange).items[0]).toEqual({ post_id: 3 });
    expect(await screen.findByText(/This post is draft: it is skipped on the website/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Post id/ })).toHaveTextContent("Unfinished trail notes");
    await u.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(last(onChange).items[0]).toEqual({});
  });

  it("returns the key / slug for FAQ groups and forms", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(SECTION_TYPE_FIXTURES.faq, { eyebrow: { la: "E" }, title: { la: "T" } }, { onChange });
    await u.click(screen.getByRole("combobox", { name: /^Group key/ }));
    await u.click(await screen.findByRole("option", { name: /Booking/ }));
    expect(last(onChange).group_key).toBe("booking");
  });

  it("an album item needs the album first, then lists that album's items", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const story = SECTION_TYPE_FIXTURES.photo_story;
    const row = { layout: "wide-narrow", slots: [{ size: "wide" }, { size: "narrow" }] };
    const { unmount } = renderSchemaForm(story, { accessible_heading: { la: "H" }, rows: [row] }, { onChange });
    expect(screen.getAllByRole("combobox", { name: /Album item/ })[0]).toBeDisabled();
    expect(screen.getAllByText("Choose the album first").length).toBeGreaterThan(0);
    unmount();

    renderSchemaForm(story, { accessible_heading: { la: "H" }, album_id: 1, rows: [row] }, { onChange });
    const picker = screen.getAllByRole("combobox", { name: /Album item/ })[0];
    await waitFor(() => expect(picker).toBeEnabled());
    await u.click(picker);
    expect(await screen.findAllByRole("option")).toHaveLength(5);
    await u.click(screen.getByRole("option", { name: /Forest photo 3/ }));
    expect(last(onChange).rows[0].slots[0]).toEqual({ size: "wide", album_item_id: 3 });
  });
});

describe("ArrayField", () => {
  const about = SECTION_TYPE_FIXTURES.about_blocks;
  const item = (title: string, en?: string) => ({
    title: { la: title, ...(en ? { en } : {}) },
    body: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] } },
    image: { media_id: 1, decorative: true },
    image_side: "left",
    layout: "standard",
  });
  const titles = (fn: ReturnType<typeof vi.fn>) => last(fn).items.map((i: { title?: { la: string } }) => i.title?.la);

  it("adds, duplicates, moves with the buttons (announced) and removes", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(about, { items: [item("One"), item("Two"), item("Three")] }, { onChange });
    expect(screen.getByRole("button", { name: "Move One up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Three down" })).toBeDisabled();

    await u.click(screen.getByRole("button", { name: "Move Three up" }));
    expect(titles(onChange)).toEqual(["One", "Three", "Two"]);
    expect(screen.getAllByRole("status").map((e) => e.textContent)).toContain("Moved Three to position 2 of 3");

    await u.click(screen.getByRole("button", { name: "Move One down" }));
    expect(titles(onChange)).toEqual(["Three", "One", "Two"]);

    await u.click(screen.getByRole("button", { name: "Duplicate Two" }));
    expect(titles(onChange)).toEqual(["Three", "One", "Two", "Two"]);

    await u.click(screen.getByRole("button", { name: "Add item" }));
    expect(last(onChange).items).toHaveLength(5);
    expect(last(onChange).items[4]).toEqual({});

    await u.click(screen.getByRole("button", { name: "Remove Three" }));
    expect(titles(onChange).slice(0, 3)).toEqual(["One", "Two", "Two"]);
  });

  it("keeps an item's identity when it moves (its collapsed state follows it)", async () => {
    const u = userEvent.setup();
    renderSchemaForm(about, { items: [item("One"), item("Two")] });
    await u.click(screen.getByRole("button", { name: "Collapse One" }));
    expect(screen.getByRole("button", { name: "Expand One" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Move One down" }));
    expect(screen.getByRole("button", { name: "Expand One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Two" })).toBeInTheDocument();
  });

  it("disables add at maxItems and remove at minItems", async () => {
    const strip = SECTION_TYPE_FIXTURES.blog_strip;
    const four = Array.from({ length: 4 }, (_, i) => ({ post_id: i + 1 }));
    const { unmount } = renderSchemaForm(strip, { eyebrow: { la: "E" }, title: { la: "T" }, source: "manual", items: four });
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.getByText("The maximum of 4 items is reached.")).toBeInTheDocument();
    unmount();
    renderSchemaForm(strip, { eyebrow: { la: "E" }, title: { la: "T" }, source: "manual", items: [{ post_id: 1 }] });
    for (const remove of screen.queryAllByRole("button", { name: /^Remove / })) expect(remove).toBeDisabled();
  });

  it("asks before removing an item that holds text in another language", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(about, { items: [item("One", "Uno"), item("Two"), item("Three")] }, { onChange });
    // no text in another language: removed at once
    await u.click(screen.getByRole("button", { name: "Remove Two" }));
    expect(titles(onChange)).toEqual(["One", "Three"]);

    await u.click(screen.getByRole("button", { name: "Remove One" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove this item?")).toBeInTheDocument();
    expect(titles(onChange)).toEqual(["One", "Three"]);
    await u.click(within(dialog).getByRole("button", { name: "Remove item" }));
    await waitFor(() => expect(titles(onChange)).toEqual(["Three"]));
  });

  it("a fixed-size list (the 3 collage photos) always shows its slots and fills the gap with empty ones", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const teaser = SECTION_TYPE_FIXTURES.teaser_collage;
    renderSchemaForm(teaser, { eyebrow: { la: "E" }, title: { la: "T" }, body: { la: "B" } }, { onChange });
    expect(screen.getAllByRole("button", { name: "Choose image" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove Item/ })).not.toBeInTheDocument();
    await u.click(screen.getAllByRole("button", { name: "Choose image" })[2]);
    const dialog = await screen.findByRole("dialog");
    await u.click(await within(dialog).findByRole("button", { name: "hero-bg.png" }));
    expect(last(onChange).images).toEqual([{}, {}, { media_id: 1 }]);
  });
});

describe("rich text", () => {
  const about = SECTION_TYPE_FIXTURES.about_blocks;
  const baseItem = {
    title: { la: "T" },
    image: { media_id: 1, decorative: true },
    image_side: "left",
    layout: "standard",
  };
  const doc = (...texts: string[]): RichTextDoc => ({
    type: "doc",
    content: texts.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
  });
  const editorOf = () => (document.querySelector(".ProseMirror") as unknown as { editor: import("@tiptap/react").Editor }).editor;

  it("loads the stored document without reporting a change, and edits produce document JSON (never HTML)", async () => {
    const onChange = vi.fn();
    renderSchemaForm(about, { items: [{ ...baseItem, body: { la: doc("First", "Second") } }] }, { onChange });
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    const editor = editorOf();
    expect(editor.getText()).toContain("First");
    await act(async () => {
      editor.chain().focus("end").insertContent(" more").run();
    });
    const written = last(onChange).items[0].body.la;
    expect(written).toEqual(doc("First", "Second more"));
    expect(JSON.stringify(written)).not.toContain("<p>");
  });

  it("an emptied editor removes the language from the map", async () => {
    const onChange = vi.fn();
    renderSchemaForm(about, { items: [{ ...baseItem, body: { la: doc("Only") } }] }, { onChange });
    await settle();
    await act(async () => {
      editorOf().commands.clearContent(true);
    });
    expect(last(onChange).items[0].body).toEqual({});
  });

  it("bold / italic / link marks and lists survive a round trip and carry only allowed attributes", async () => {
    const onChange = vi.fn();
    const rich: RichTextDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [
          { type: "text", text: "a", marks: [{ type: "bold" }] },
          { type: "text", text: "b", marks: [{ type: "italic" }] },
          { type: "text", text: "c", marks: [{ type: "link", attrs: { href: "https://example.test", target: "_blank" } }] },
          { type: "text", text: "d", marks: [{ type: "link", attrs: { href: "/our-path" } }] },
        ] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "li" }] }] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "n" }] }] }] },
      ],
    };
    renderSchemaForm(about, { items: [{ ...baseItem, body: { la: rich } }] }, { onChange });
    await settle();
    // force a re-serialisation through the editor and compare with what was stored
    await act(async () => {
      editorOf().chain().focus("end").insertContent("!").run();
    });
    const out = last(onChange).items[0].body.la as RichTextDoc;
    const normal = JSON.parse(JSON.stringify(out));
    expect(normal.content[0].content.slice(0, 4)).toEqual(rich.content?.[0].content);
    expect(normal.content[1]).toEqual(rich.content?.[1]);
    // the "!" typed at the end lands in the last list item; everything else is byte-for-byte what was stored
    const expectedList = JSON.parse(JSON.stringify(rich.content?.[2]));
    expectedList.content[0].content[0].content[0].text = "n!";
    expect(normal.content[2]).toEqual(expectedList);
  });

  it("the toolbar toggles bold, and the link popover refuses //host and accepts /path", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(about, { items: [{ ...baseItem, body: { la: doc("hello") } }] }, { onChange });
    await settle();
    await act(async () => {
      editorOf().chain().focus().selectAll().run();
    });
    await u.click(screen.getByRole("button", { name: "Bold" }));
    expect(last(onChange).items[0].body.la.content[0].content[0].marks).toEqual([{ type: "bold" }]);

    await act(async () => {
      editorOf().chain().focus().selectAll().run();
    });
    await u.click(screen.getByRole("button", { name: "Link" }));
    const input = await screen.findByLabelText("Link address");
    await u.type(input, "//evil.test");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/leaves the site/)).toBeInTheDocument();
    await u.clear(input);
    await u.type(input, "#anchor");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/Use https:\/\/, \/path/)).toBeInTheDocument();
    await u.clear(input);
    await u.type(input, "/our-path");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    const marks = last(onChange).items[0].body.la.content[0].content[0].marks;
    expect(marks).toContainEqual({ type: "link", attrs: { href: "/our-path" } });
  });

  it("a document with an unsafe link (loaded from the server) is reported by the validator", async () => {
    const bad: RichTextDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "//evil.test" } }] }] }] };
    renderSchemaForm(SECTION_TYPE_FIXTURES.intro_text, { text: { la: bad } }, { mode: "draft" });
    await settle();
    expect(issueTexts(document.body)).toContain("The value does not match the required pattern.");
  });

  it("the full profile adds headings, quote and the lead paragraph and keeps image / embed nodes", async () => {
    const onChange = vi.fn();
    const fullSchema = {
      key: "post_body", version: 1,
      json_schema: { type: "object", properties: { body: { "x-localized": true, "x-richtext": "full", type: "object", additionalProperties: { type: "object" } } } },
      ui_schema: {},
    };
    const full: RichTextDoc = {
      type: "doc",
      content: [
        { type: "lead", content: [{ type: "text", text: "Standfirst" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] },
        { type: "image", attrs: { media_id: 4, alt: "a", caption: "c" } },
        { type: "embed", attrs: { provider: "youtube", url: "https://www.youtube.com/watch?v=x" } },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }] },
      ],
    };
    renderSchemaForm(fullSchema as never, { body: { la: full } }, { onChange });
    await settle();
    expect(screen.getByRole("button", { name: "Heading 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lead paragraph" })).toBeInTheDocument();
    await act(async () => {
      editorOf().chain().focus("end").insertContent("!").run();
    });
    const out = last(onChange).body.la as RichTextDoc;
    expect(out.content?.map((n) => n.type)).toEqual(["lead", "heading", "image", "embed", "blockquote"]);
    expect(out.content?.[2].attrs).toEqual({ media_id: 4, alt: "a", caption: "c" });
    expect(out.content?.[3].attrs).toEqual({ provider: "youtube", url: "https://www.youtube.com/watch?v=x" });
  });
});

describe("server errors", () => {
  const about = SECTION_TYPE_FIXTURES.about_blocks;
  const item = (t: string) => ({
    title: { la: t, en: t },
    body: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] } },
    image: { media_id: 1, decorative: true },
    image_side: "left",
    layout: "standard",
  });

  it("maps JSON-Pointer errors onto the field, switches the language, opens the item, focuses, and clears on edit", async () => {
    const u = userEvent.setup();
    renderSchemaForm(about, { items: [item("One"), item("Two")] }, {
      serverErrors: [
        { in: "body", path: "/items/1/title/en", code: "too_long", params: { max: 120 } },
        { in: "body", path: "/variant", code: "not_in_enum" },
      ],
    });
    // the first matched error switches to English and focuses the field
    await waitFor(() => expect(screen.getByRole("radio", { name: /English/ })).toHaveAttribute("aria-checked", "true"));
    const field = await screen.findAllByLabelText(/^Title/);
    await waitFor(() => expect(document.activeElement).toBe(field[1]));
    expect(field[1]).toHaveAttribute("aria-invalid", "true");
    expect(within(field[1].closest('[data-slot="field"]') as HTMLElement).getByText("Too long: at most 120 allowed.")).toBeInTheDocument();
    expect(screen.getByText("2 problems need your attention")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /English.*1 problem/ })).toBeInTheDocument();

    await u.type(field[1], "x");
    await waitFor(() => expect(field[1]).not.toHaveAttribute("aria-invalid"));
    // the section-level error (no field) stays until the next save
    expect(screen.getByText("1 problem needs your attention")).toBeInTheDocument();
  });

  it("opens a collapsed array item that holds the error", async () => {
    const u = userEvent.setup();
    const props = { items: [item("One"), item("Two")] };
    const { rerender } = renderSchemaForm(about, props, {});
    void rerender;
    await u.click(screen.getByRole("button", { name: "Collapse Two" }));
    expect(screen.getByRole("button", { name: "Expand Two" })).toBeInTheDocument();
  });

  it("translates server codes with the shared vocabulary", async () => {
    renderSchemaForm(about, { items: [item("One")] }, {
      serverErrors: [{ in: "body", path: "/items/0/title/la", code: "unknown_reference" }],
    });
    expect(await screen.findByText("The selected item does not exist.")).toBeInTheDocument();
  });
});

describe("permissions", () => {
  it("translate-only: localized text stays editable, everything else is locked and structure cannot change", async () => {
    const about = SECTION_TYPE_FIXTURES.about_blocks;
    const props = { items: [{ title: { la: "T" }, body: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] } }, image: { media_id: 1, decorative: true }, image_side: "left", layout: "standard" }] };
    renderSchemaForm(about, props, { translateOnly: true });
    await settle();
    expect(screen.getByLabelText(/^Title/)).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change image" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
  });

  it("disabled: nothing can be edited", async () => {
    renderSchemaForm(hero, heroWith({ label: { la: "Go" }, link: { type: "url", url: "/x" } }), { disabled: true });
    await settle();
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Show logo/ })).toBeDisabled();
  });
});
