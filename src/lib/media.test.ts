import { describe, expect, it } from "vitest";

import { focalPosition, formatBytes, isMissingAlt, roundFocal, usageHref } from "@/lib/media";

describe("formatBytes", () => {
  it("uses binary units with one decimal from KB up", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(3126522)).toBe("3.0 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(-1)).toBe("");
  });
});

describe("focal helpers", () => {
  it("rounds to 3 decimals and clamps to 0..1 (more decimals would be a 422 out_of_range)", () => {
    expect(roundFocal(0.4219)).toBe(0.422);
    expect(roundFocal(-0.2)).toBe(0);
    expect(roundFocal(1.7)).toBe(1);
  });
  it("object-position keeps the point in view", () => {
    expect(focalPosition({ x: 0.5, y: 0.25 })).toBe("50% 25%");
    expect(focalPosition(null)).toBeUndefined();
  });
});

describe("isMissingAlt (the API's definition)", () => {
  it("not decorative and the default language's alt empty", () => {
    expect(isMissingAlt({ is_decorative: false, translations: {} }, "la")).toBe(true);
    expect(isMissingAlt({ is_decorative: false, translations: { la: { alt: "  " } } }, "la")).toBe(true);
    expect(isMissingAlt({ is_decorative: false, translations: { en: { alt: "x" } } }, "la")).toBe(true);
    expect(isMissingAlt({ is_decorative: false, translations: { la: { alt: "x" } } }, "la")).toBe(false);
    expect(isMissingAlt({ is_decorative: true, translations: {} }, "la")).toBe(false);
  });
});

describe("usageHref", () => {
  it("links the owners whose editors are in the route map, and invents nothing for the others", () => {
    expect(usageHref({ entity_type: "cms.page", id: 3 })).toBe("/admin/pages/3");
    expect(usageHref({ entity_type: "cms.post", id: 1 })).toBe("/admin/blog/posts/1");
    expect(usageHref({ entity_type: "cms.album", id: 2 })).toBe("/admin/galleries/2");
    expect(usageHref({ entity_type: "cms.site_settings", id: 1 })).toBe("/admin/settings");
    expect(usageHref({ entity_type: "cms.something_new", id: 9 })).toBeNull();
  });
});
