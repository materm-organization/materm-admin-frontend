import { describe, expect, it } from "vitest";

import { buildCreatePayload, emptyCreateDraft, pathFromTitle, pathProblem, slugify, validateCreate } from "@/components/protected/pages/page-draft";
import type { PageTemplate } from "@/types/pages";

const template = (key: string, is_default = false) => ({ key, is_default }) as PageTemplate;

describe("slugify / pathFromTitle", () => {
  it("makes an ASCII slug from a title", () => {
    expect(slugify("Summer trek!")).toBe("summer-trek");
    expect(slugify("  Café  Du  Monde ")).toBe("cafe-du-monde");
    expect(pathFromTitle("Our Path")).toBe("/our-path");
  });

  it("gives nothing for text with no ASCII letters (the author types the address)", () => {
    expect(slugify("ກິດຈະກຳ")).toBe("");
    expect(pathFromTitle("ກິດຈະກຳ")).toBe("");
  });
});

describe("pathProblem (05 12.3.2, BR-03)", () => {
  it("accepts nested lower-case paths", () => {
    expect(pathProblem("/events")).toBeNull();
    expect(pathProblem("/events/2027-spring")).toBeNull();
  });

  it("names the rule that is broken", () => {
    expect(pathProblem("")).toBe("required");
    expect(pathProblem("/")).toBe("root");
    expect(pathProblem("events")).toBe("format");
    expect(pathProblem("/Events")).toBe("format");
    expect(pathProblem("/a b")).toBe("format");
    expect(pathProblem("/events/")).toBe("format");
    expect(pathProblem("/sitemap.xml")).toBe("format");
    expect(pathProblem("/robots.txt")).toBe("format");
    for (const p of ["/api", "/api/v1", "/_next/x", "/admin", "/admin/pages", "/preview"]) expect(pathProblem(p)).toBe("reserved");
    expect(pathProblem("/apiary")).toBeNull();
    expect(pathProblem("/blog/hello")).toBe("blog_child");
    expect(pathProblem("/blog")).toBeNull();
    expect(pathProblem("/" + "a".repeat(200))).toBe("too_long");
  });
});

describe("create draft", () => {
  it("starts on the default template", () => {
    expect(emptyCreateDraft([template("home"), template("standard", true)]).template).toBe("standard");
    expect(emptyCreateDraft([]).template).toBe("");
  });

  it("validates title, path and template", () => {
    expect(validateCreate({ template: "", title: "", path: "", pathEdited: false })).toEqual({ template: "required", title: "required", path: "required" });
    expect(validateCreate({ template: "standard", title: "x".repeat(121), path: "/x", pathEdited: true })).toEqual({ title: "too_long" });
    expect(validateCreate({ template: "standard", title: "Events", path: "/events", pathEdited: false })).toEqual({});
  });

  it("builds the request: the title goes under the default language", () => {
    expect(buildCreatePayload({ template: "standard", title: " Events ", path: " /events ", pathEdited: true }, "la")).toEqual({
      template: "standard",
      path: "/events",
      translations: { la: { title: "Events" } },
    });
  });
});
