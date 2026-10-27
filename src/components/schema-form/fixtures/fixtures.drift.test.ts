import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SECTION_TYPE_FIXTURES, SECTION_TYPE_KEYS } from "./index";

// The fixtures are copies of doc/content-schemas (a separate repo, absent in a CI clone). When the folder is
// there, they must be byte-for-byte the same data; when the content schemas change, copy them again.
const docDir = resolve(process.cwd(), "../doc/content-schemas");

describe.skipIf(!existsSync(docDir))("fixtures follow doc/content-schemas", () => {
  it("has all 12 section types, equal to the doc copies", () => {
    const files = readdirSync(docDir).filter((f) => f.endsWith(".json"));
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...SECTION_TYPE_KEYS].sort());
    for (const file of files) {
      const doc = JSON.parse(readFileSync(resolve(docDir, file), "utf8"));
      expect(SECTION_TYPE_FIXTURES[doc.key], file).toEqual(doc);
    }
  });

  it("has the example pages and the media manifest", () => {
    for (const file of ["page.home.json", "page.our-path.json", "page.blog.json", "page.gallery.json", "page.contact.json", "media-manifest.json", "post.music-night-under-the-stars.json"]) {
      const doc = JSON.parse(readFileSync(resolve(docDir, "examples", file), "utf8"));
      const mine = JSON.parse(readFileSync(resolve(process.cwd(), "src/components/schema-form/fixtures/examples", file), "utf8"));
      expect(mine, file).toEqual(doc);
    }
  });
});

describe("fixtures", () => {
  it("12 section types, each with the fields of GET /section-types/{key}", () => {
    expect(SECTION_TYPE_KEYS).toHaveLength(12);
    for (const type of Object.values(SECTION_TYPE_FIXTURES)) {
      expect(type).toMatchObject({ key: expect.any(String), version: 1, variants: expect.any(Array) });
      expect(type.json_schema.type).toBe("object");
      expect(type.ui_schema).toBeDefined();
      expect(type.default_props).toBeDefined();
    }
  });
});
