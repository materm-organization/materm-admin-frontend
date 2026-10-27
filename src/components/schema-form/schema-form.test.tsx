import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const intro = SECTION_TYPE_FIXTURES.intro_heading;
const BG = { media_id: 1, decorative: true };

function lastValue(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls.at(-1)?.[0];
}

describe("localized text and the language switch", () => {
  it("edits the chosen language and leaves the others alone", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(intro, { eyebrow: { la: "Hello", en: "Hi" }, title: {} }, { onChange });
    const eyebrow = screen.getByLabelText(/^Eyebrow/);
    expect(eyebrow).toHaveValue("Hello");
    await u.type(eyebrow, "!");
    expect(lastValue(onChange).eyebrow).toEqual({ la: "Hello!", en: "Hi" });

    await u.click(screen.getByRole("radio", { name: /English/ }));
    expect(screen.getByLabelText(/^Eyebrow/)).toHaveValue("Hi");
    await u.type(screen.getByLabelText(/^Eyebrow/), "!!");
    expect(lastValue(onChange).eyebrow).toEqual({ la: "Hello!", en: "Hi!!" });
  });

  it("removes the key of a cleared language (a required map stays {})", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(intro, { eyebrow: { la: "A" }, title: { la: "T" } }, { onChange });
    await u.clear(screen.getByLabelText(/^Eyebrow/));
    expect(lastValue(onChange)).toEqual({ eyebrow: {}, title: { la: "T" } });
    const description = screen.getByLabelText(/^Description/);
    await u.type(description, "x");
    expect(lastValue(onChange).description).toEqual({ la: "x" });
    await u.clear(description);
    expect(lastValue(onChange)).not.toHaveProperty("description");
  });

  it("shows 'Not translated', the fallback as placeholder and copies from the default language", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(intro, { eyebrow: { la: "Hello" }, title: { la: "T" } }, { onChange });
    await u.click(screen.getByRole("radio", { name: /English/ }));
    const eyebrow = screen.getByLabelText(/^Eyebrow/);
    expect(eyebrow).toHaveValue("");
    expect(eyebrow).toHaveAttribute("placeholder", "Hello");
    expect(screen.getAllByText("Not translated").length).toBeGreaterThan(0);
    const copyButtons = screen.getAllByRole("button", { name: "Copy from LA" });
    await u.click(copyButtons[0]);
    expect(lastValue(onChange).eyebrow).toEqual({ la: "Hello", en: "Hello" });
    expect(screen.getByLabelText(/^Eyebrow/)).toHaveValue("Hello");
  });

  it("compare mode shows the default language read-only above the edited one", async () => {
    const u = userEvent.setup();
    renderSchemaForm(intro, { eyebrow: { la: "Hello" }, title: { la: "T" } });
    await u.click(screen.getByRole("radio", { name: /English/ }));
    expect(document.querySelector('[data-slot="compare-default"]')).not.toBeInTheDocument();
    await u.click(screen.getByRole("switch", { name: "Compare with the default language" }));
    const shown = Array.from(document.querySelectorAll('[data-slot="compare-default"]')).map((e) => e.textContent);
    expect(shown.some((t) => t?.includes("Hello"))).toBe(true);
  });

  it("badges: complete / n missing per language, and the completeness line follows the chosen one", async () => {
    const u = userEvent.setup();
    renderSchemaForm(intro, { eyebrow: { la: "A", en: "A" }, title: { la: "T" } });
    expect(screen.getByRole("radio", { name: /Lao \(default\): complete/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /English: 1 required field missing/ })).toBeInTheDocument();
    expect(screen.getByText(/100% of the required fields are filled in LA \(2 of 2\)/)).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: /English/ }));
    expect(screen.getByText(/50% of the required fields are filled in EN \(1 of 2\)/)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/^Title/), "x");
    await waitFor(() => expect(screen.getByRole("radio", { name: /English: complete/ })).toBeInTheDocument());
  });

  it("offers only the active languages (the stored text of an inactive one is kept)", () => {
    renderSchemaForm(intro, { eyebrow: { la: "A", th: "ไทย" }, title: {} });
    expect(screen.queryByRole("radio", { name: /Thai/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("uses the controlled language and reports changes", async () => {
    const u = userEvent.setup();
    const onLocaleChange = vi.fn();
    renderSchemaForm(intro, { eyebrow: { la: "Hello", en: "Hi" }, title: {} }, { locale: "en", onLocaleChange });
    expect(screen.getByLabelText(/^Eyebrow/)).toHaveValue("Hi");
    await u.click(screen.getByRole("radio", { name: /Lao/ }));
    expect(onLocaleChange).toHaveBeenCalledWith("la");
  });

  it("counts characters and warns beyond the limit", async () => {
    const u = userEvent.setup();
    renderSchemaForm(hero, { title: { la: "x".repeat(80) }, background: BG });
    expect(screen.getByText("80/80")).toBeInTheDocument();
    await u.type(screen.getByLabelText(/^Title/), "y");
    expect(screen.getByText("81/80")).toBeInTheDocument();
    await waitFor(() => expect(issueTexts(document.body)).toContain("Too long: at most 80 allowed."));
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute("aria-invalid", "true");
  });
});

describe("scalar widgets", () => {
  it("a boolean shows its schema default but writes nothing until it is touched", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, { title: { la: "T" }, background: BG }, { onChange });
    const logo = screen.getByRole("switch", { name: /Show logo/ });
    expect(logo).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    await u.click(logo);
    expect(lastValue(onChange).show_logo).toBe(false);
  });

  it("a number writes a number and removes the key when cleared", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const gallery = SECTION_TYPE_FIXTURES.gallery_cards;
    renderSchemaForm(gallery, { eyebrow: { la: "E" }, title: { la: "T" }, source: "album", album_id: 1 }, { onChange });
    const limit = screen.getByLabelText(/^Limit/);
    expect(limit).toHaveAttribute("type", "number");
    await u.type(limit, "5");
    expect(lastValue(onChange).limit).toBe(5);
    await u.clear(limit);
    expect(lastValue(onChange)).not.toHaveProperty("limit");
    await u.type(limit, "12");
    await waitFor(() => expect(issueTexts(document.body)).toContain("The value is out of range."));
  });

  it("radio enums write the value; ui:showIf hides fields and keeps their data", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const gallery = SECTION_TYPE_FIXTURES.gallery_cards;
    renderSchemaForm(gallery, { eyebrow: { la: "E" }, title: { la: "T" }, source: "manual", album_id: 1, cards: [{ image: { media_id: 2, decorative: true } }] }, { onChange });
    expect(screen.queryByLabelText(/^Limit/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Cards/ })).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "Album" }));
    expect(lastValue(onChange).source).toBe("album");
    expect(screen.getByLabelText(/^Limit/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Cards/ })).not.toBeInTheDocument();
    // the hidden cards are still in the props
    expect(lastValue(onChange).cards).toHaveLength(1);
  });

  it("surfaces a problem inside a hidden section and can clear it", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    const gallery = SECTION_TYPE_FIXTURES.gallery_cards;
    renderSchemaForm(gallery, { eyebrow: { la: "E" }, title: { la: "T" }, source: "album", album_id: 1, cards: [{ image: { media_id: 0 } }] }, { onChange });
    const notice = await screen.findByText(/hidden section "Cards \(manual\)" has 1 problem/);
    expect(notice).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Clear this section" }));
    expect(lastValue(onChange)).not.toHaveProperty("cards");
    await waitFor(() => expect(screen.queryByText(/hidden section/)).not.toBeInTheDocument());
  });

  it("an optional group (CTA) is added and removed as a whole", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    renderSchemaForm(hero, { title: { la: "T" }, background: BG }, { onChange });
    await u.click(screen.getByRole("button", { name: "Add Button" }));
    expect(lastValue(onChange).cta).toEqual({});
    expect(screen.getByLabelText(/^Label/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Remove Button" }));
    expect(lastValue(onChange)).not.toHaveProperty("cta");
  });
});

describe("draft vs publish display", () => {
  it("draft hides what is only missing; publish shows it", async () => {
    const { rerender } = (() => {
      const r = renderSchemaForm(hero, { title: {} }, { mode: "draft" });
      return { rerender: r.rerender };
    })();
    void rerender;
    await settle();
    expect(issueTexts(document.body)).toEqual([]);
    expect(document.querySelector('[data-slot="issue-summary"]')).not.toBeInTheDocument();
  });

  it("publish mode lists required fields and the empty default language", async () => {
    renderSchemaForm(hero, { title: {} }, { mode: "publish" });
    await settle();
    const texts = issueTexts(document.body);
    expect(texts.filter((t) => t === "This field is required.").length).toBe(2);
    expect(screen.getByText("2 problems need your attention")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("radio", { name: /Lao \(default\).*1 problem/ })).toBeInTheDocument();
  });

  it("'Go to the first problem' moves focus to the first invalid field", async () => {
    const u = userEvent.setup();
    const { formRef } = renderSchemaForm(hero, { title: {} }, { mode: "publish" });
    await settle();
    await u.click(screen.getByRole("button", { name: "Go to the first problem" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Title/)));
    expect(formRef.current?.getIssues().length).toBe(2);
  });
});

describe("a11y smoke", () => {
  it("every control of every field has an accessible name, and errors are described", async () => {
    renderSchemaForm(SECTION_TYPE_FIXTURES.about_blocks, {
      items: [{ title: { la: "T" }, body: { la: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] } }, image: { media_id: 1, decorative: true }, image_side: "left", layout: "standard" }],
    }, { mode: "publish" });
    await settle();
    const controls = within(document.body).queryAllByRole("textbox");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control, control.outerHTML.slice(0, 80)).toHaveAccessibleName();
    }
    for (const control of [...screen.queryAllByRole("switch"), ...screen.queryAllByRole("radio"), ...screen.queryAllByRole("combobox")]) {
      expect(control, control.outerHTML.slice(0, 80)).toHaveAccessibleName();
    }
    for (const invalid of document.querySelectorAll('[aria-invalid="true"]')) {
      expect(invalid.getAttribute("aria-describedby"), invalid.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });
});

describe("props whose identity changes on every render", () => {
  it("an inline `media` lookup and setState inside onValidationChange do not loop", async () => {
    const { Host, LOCALES } = await import("./test-utils");
    const { render } = await import("@testing-library/react");
    const { NextIntlClientProvider } = await import("next-intl");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const en = (await import("../../../i18n/en.json")).default;
    const { useState } = await import("react");
    const calls = vi.fn();
    void LOCALES;

    function Page() {
      const [, setValidation] = useState<unknown>(null);
      return (
        <Host
          type={hero}
          initial={{ title: { la: "T" }, background: { media_id: 1 } }}
          options={{
            mode: "publish",
            // new function and new setState on every render: both used to be able to loop
            media: (id) => (id === 1 ? { status: "ready", alt: { la: "x" } } : undefined),
            mediaAlt: (id) => (id === 1 ? { alt: {} } : undefined),
            onValidationChange: (v) => {
              calls(v);
              setValidation(v);
            },
          }}
        />
      );
    }
    const client = new QueryClient();
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Vientiane">
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    await settle();
    await settle();
    expect(calls.mock.calls.length).toBeLessThanOrEqual(2);
    expect(calls.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not render a form (or write a `\"\"` locale key) before the languages are loaded", async () => {
    const { renderApp } = await import("@/test/render-app");
    const { SchemaForm } = await import("./schema-form");
    const onChange = vi.fn();
    const { container } = renderApp(<SchemaForm sectionType={intro} value={{}} onChange={onChange} locales={[]} />);
    expect(container.querySelector('[data-slot="schema-form"]')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
