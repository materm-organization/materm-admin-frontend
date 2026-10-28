import { describe, expect, it } from "vitest";

import { buildCreate, buildPatch, draftFromItem, emptyDraft, isDraftChanged, validateDraft } from "@/components/protected/menus/menu-draft";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getMenu } from "@/mocks/mock-menus";

const item = (menu: string, index: number) => getMenu(getMockDb(), menu).menu.items[index];

describe("menu item draft", () => {
  it("a loaded item is unchanged and builds an empty patch", () => {
    resetMockDb();
    const saved = draftFromItem(item("main", 1));
    expect(isDraftChanged(saved, structuredClone(saved))).toBe(false);
    expect(buildPatch(saved, structuredClone(saved), "la")).toEqual({});
  });

  it("the patch holds only what changed; a cleared non-default label becomes null, the default one stays a (invalid) empty text", () => {
    resetMockDb();
    const saved = draftFromItem(item("main", 1));
    const d = structuredClone(saved);
    d.labels.en = "Our path";
    d.isVisible = false;
    expect(buildPatch(saved, d, "la")).toEqual({ is_visible: false, translations: { en: { label: "Our path", aria_label: null } } });
    const cleared = structuredClone(saved);
    cleared.labels.en = " ";
    expect(buildPatch(saved, cleared, "la").translations).toEqual({ en: null });
    expect(validateDraft("main", { ...saved, labels: { ...saved.labels, la: "" } }, "la").map((e) => e.path)).toEqual(["/translations/la/label"]);
  });

  it("translate-only never sends link / icon / flags", () => {
    resetMockDb();
    const saved = draftFromItem(item("main", 1));
    const d = { ...structuredClone(saved), isVisible: false, activeMatch: "exact" as const };
    d.labels.en = "Path";
    expect(buildPatch(saved, d, "la", { translateOnly: true })).toEqual({ translations: { en: { label: "Path", aria_label: null } } });
  });

  it("a link change sends the whole link; switching page -> url drops the page", () => {
    resetMockDb();
    const saved = draftFromItem(item("main", 0));
    const d = { ...structuredClone(saved), linkType: "url" as const, url: " https://example.org " };
    expect(buildPatch(saved, d, "la").link).toEqual({ type: "url", url: "https://example.org", open_in_new_tab: false });
  });

  it("create: only languages with a label are sent; social adds the icon", () => {
    const d = emptyDraft("social");
    d.linkType = "url";
    d.url = "https://mastodon.example/@m";
    d.icon = "";
    d.labels = { la: "Mastodon", en: "" };
    expect(validateDraft("social", d, "la").map((e) => e.path)).toEqual(["/icon"]);
    d.icon = "instagram";
    expect(buildCreate("social", d)).toMatchObject({ icon: "instagram", translations: { la: { label: "Mastodon" } }, link: { type: "url", url: "https://mastodon.example/@m", open_in_new_tab: true } });
    expect(Object.keys(buildCreate("social", d).translations)).toEqual(["la"]);
    expect(buildCreate("main", { ...emptyDraft("main"), pageId: 2, labels: { la: "X" } })).not.toHaveProperty("icon");
  });

  it("url rules: https / path / mailto / tel / # only; social https only; page needs a page", () => {
    const base = { ...emptyDraft("main"), linkType: "url" as const, labels: { la: "X" } };
    const code = (url: string, menu = "main") => validateDraft(menu, { ...base, url, icon: "youtube" }, "la").find((e) => e.path === "/link/url")?.code;
    expect(code("https://a.example")).toBeUndefined();
    for (const ok of ["/our-path", "mailto:a@b.example", "tel:+8562012345678", "#top"]) expect(code(ok)).toBeUndefined();
    for (const bad of ["http://a.example", "javascript:alert(1)", "//evil.example", "a b", ""]) expect(code(bad)).toBeTruthy();
    expect(code("/our-path", "social")).toBe("pattern_mismatch");
    expect(validateDraft("main", { ...emptyDraft("main"), labels: { la: "X" } }, "la").map((e) => `${e.path}:${e.code}`)).toEqual(["/link/page_id:required"]);
    expect(validateDraft("main", { ...emptyDraft("main"), labels: { la: "x".repeat(61) } }, "la")[0]).toMatchObject({ code: "too_long" });
  });
});
