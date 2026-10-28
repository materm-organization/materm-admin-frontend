import { describe, expect, it } from "vitest";

import { buildPayload, changedFields, draftFromAsset } from "@/components/protected/media/asset-draft";
import { createMockDb } from "@/mocks/mock-db";

const base = () => createMockDb().assets.find((a) => a.id === 2)!;

describe("asset draft -> PATCH body", () => {
  it("an untouched draft is empty (nothing to save)", () => {
    const asset = base();
    const draft = draftFromAsset(asset, ["la", "en"]);
    expect(changedFields(asset, draft)).toEqual([]);
    expect(buildPayload(asset, draft)).toEqual({});
  });

  it("sends only what changed, per language and field", () => {
    const asset = base();
    const draft = draftFromAsset(asset, ["la", "en"]);
    draft.translations.en.alt = "New alt";
    draft.is_decorative = true;
    draft.folder_id = 3;
    expect(buildPayload(asset, draft)).toEqual({ folder_id: 3, is_decorative: true, translations: { en: { alt: "New alt" } } });
  });

  it("an emptied caption or credit is null (clears it); an emptied alt is the empty string", () => {
    const asset = base();
    asset.translations.en = { alt: "x", caption: "c", credit: "k" };
    const draft = draftFromAsset(asset, ["la", "en"]);
    draft.translations.en = { alt: "", caption: "  ", credit: "" };
    expect(buildPayload(asset, draft)).toEqual({ translations: { en: { alt: "", caption: null, credit: null } } });
  });

  it("the focal point is sent as a rounded pair, or null to clear both", () => {
    const asset = base();
    const draft = draftFromAsset(asset, ["la"]);
    draft.focal = { x: 0.12345, y: 0.9999 };
    expect(buildPayload(asset, draft)).toEqual({ focal: { x: 0.123, y: 1 } });
    asset.focal = { x: 0.5, y: 0.5 };
    const cleared = draftFromAsset(asset, ["la"]);
    cleared.focal = null;
    expect(buildPayload(asset, cleared)).toEqual({ focal: null });
  });

  it("a language that is not offered (inactive) is left out of the draft and never sent", () => {
    const asset = base();
    asset.translations.th = { alt: "ไทย", caption: null, credit: null };
    const draft = draftFromAsset(asset, ["la", "en"]);
    expect(Object.keys(draft.translations)).toEqual(["la", "en"]);
    expect(buildPayload(asset, draft)).toEqual({});
  });
});
