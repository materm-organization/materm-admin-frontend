import { describe, expect, it } from "vitest";

import {
  buildPutPayload,
  changedKeys,
  draftFromGroup,
  localeCompleteness,
  previewCopyright,
  previewTitle,
  truncateForSerp,
  validateDraft,
} from "@/components/protected/settings/settings-draft";
import { getMockDb, resetMockDb } from "@/mocks/mock-db";
import { getSettingsGroup } from "@/mocks/mock-settings";

const group = (name: string) => getSettingsGroup(getMockDb(), name).data;
const paths = (errors: Array<{ path: string; code: string }>) => errors.map((e) => `${e.path}:${e.code}`);

describe("settings draft", () => {
  it("starts from the loaded group, so nothing is changed", () => {
    resetMockDb();
    const g = group("brand");
    expect(changedKeys(g, draftFromGroup(g))).toEqual([]);
  });

  it("an edit marks only its key; a language cleared to blank counts as absent; whitespace is not a change", () => {
    resetMockDb();
    const g = group("brand");
    const d = draftFromGroup(g);
    d.name = " MATERM ";
    expect(changedKeys(g, d)).toEqual([]);
    d.statement = { ...(d.statement as Record<string, string>), en: "New" };
    d.logo_alt = { la: "MATERM logo", en: "   " };
    expect(changedKeys(g, d).sort()).toEqual(["logo_alt", "statement"]);
  });

  it("the payload has every key (empty -> null, blank language left out, media id or null)", () => {
    resetMockDb();
    const g = group("brand");
    const d = draftFromGroup(g);
    d.logo_alt = { la: "Logo", en: "" };
    d.favicon_media_id = null;
    const { values } = buildPutPayload(g, d, { changeNote: "x" });
    expect(Object.keys(values)).toEqual(g.fields.map((f) => f.key));
    expect(values.logo_alt).toEqual({ la: "Logo" });
    expect(values.logo_media_id).toBe(23);
    expect(values.favicon_media_id).toBeNull();
    expect(buildPutPayload(g, d, { changeNote: "x" }).change_note).toBe("x");
  });

  it("translate-only sends the localized keys only", () => {
    resetMockDb();
    const g = group("brand");
    const { values } = buildPutPayload(g, draftFromGroup(g), { translateOnly: true });
    expect(Object.keys(values)).toEqual(["logo_alt", "emblem_alt", "statement"]);
  });

  it("validates like the server, with its paths", () => {
    resetMockDb();
    const c = group("contact");
    const d = draftFromGroup(c);
    d.phone = "020123";
    d.email = "nope";
    d.map_url = "http://m.example";
    d.address = { la: "x".repeat(501), en: "" };
    expect(paths(validateDraft(c, d, "la"))).toEqual([
      "/values/address/la:too_long",
      "/values/phone:pattern_mismatch",
      "/values/email:invalid_format",
      "/values/map_url:pattern_mismatch",
    ]);
    const b = group("brand");
    const bd = draftFromGroup(b);
    bd.name = "";
    bd.statement = { en: "only" };
    expect(paths(validateDraft(b, bd, "la"))).toEqual(["/values/name:required", "/values/statement/la:required"]);
    expect(validateDraft(b, bd, "la", { translateOnly: true }).map((e) => e.path)).toEqual(["/values/statement/la"]);
    const s = group("seo");
    const sd = draftFromGroup(s);
    sd.title_template = "%s | %s";
    expect(paths(validateDraft(s, sd, "la"))).toEqual(["/values/title_template:pattern_mismatch"]);
    const f = group("footer");
    const fd = draftFromGroup(f);
    fd.copyright = { la: "(c) {name}", en: "(c) {year}" };
    expect(paths(validateDraft(f, fd, "la"))).toEqual(["/values/copyright/la:pattern_mismatch"]);
    const site = group("site");
    const sited = draftFromGroup(site);
    sited.base_url = "https://x.example/?a=1";
    expect(paths(validateDraft(site, sited, "la"))).toEqual(["/values/base_url:pattern_mismatch"]);
  });

  it("language badges count the required localized keys that are empty", () => {
    resetMockDb();
    const g = group("brand");
    const d = draftFromGroup(g);
    expect(localeCompleteness(g, d, ["la", "en"])).toEqual({ la: { missing: 0, total: 1, status: "complete" }, en: { missing: 0, total: 1, status: "complete" } });
    d.statement = { la: "x" };
    d.logo_alt = { la: "x" };
    d.emblem_alt = { la: "x" };
    expect(localeCompleteness(g, d, ["en"]).en).toEqual({ missing: 1, total: 1, status: "missing" });
  });

  it("live previews: {year}, the title template with exactly one %s, the search snippet", () => {
    expect(previewCopyright("(c) {year} Materm", 2027)).toBe("(c) 2027 Materm");
    expect(previewTitle("%s | Materm", "Our Path")).toBe("Our Path | Materm");
    expect(previewTitle("no placeholder", "x")).toBeNull();
    expect(previewTitle("%s %s", "x")).toBeNull();
    expect(truncateForSerp("a".repeat(200))).toHaveLength(160);
    expect(truncateForSerp("short")).toBe("short");
  });
});
