import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { apiSchemaFormData, toEntityOption, toMediaOption } from "@/components/schema-form/data/api-data";
import { server } from "@/test/msw-server";

const API = "http://localhost:3000/api/v1";

describe("toMediaOption reads the media rows of doc/05 11.6 (and the older shapes)", () => {
  it("the contract row: original_filename, url, translations as a map, focal, counts", () => {
    expect(
      toMediaOption({
        id: 7, original_filename: "hero.jpg", url: "http://x/hero.jpg", mime_type: "image/jpeg", status: "ready", width: 100, height: 50, kind: "image",
        bytes: 10, folder_id: 3, is_decorative: false, usage_count: 2, focal: { x: 0.2, y: 0.3 },
        translations: { la: { alt: "ຮູບ", caption: null, credit: null }, en: { alt: "Pic" } },
      })
    ).toMatchObject({
      id: 7, filename: "hero.jpg", url: "http://x/hero.jpg", thumbnail_url: "http://x/hero.jpg", kind: "image", folder_id: 3, usage_count: 2,
      focal: { x: 0.2, y: 0.3 }, alt: { la: "ຮູບ", en: "Pic" },
    });
  });

  it("a null url stays null (the UI shows a placeholder); the older adapter shapes still work", () => {
    expect(toMediaOption({ id: 1, original_filename: "a.png", url: null })).toMatchObject({ url: null, thumbnail_url: null, focal: null });
    expect(toMediaOption({ id: 2, filename: "b.png", thumbnail_url: "t", url: "u", alt: { la: "x" } })).toMatchObject({ filename: "b.png", thumbnail_url: "t", alt: { la: "x" } });
    expect(toMediaOption({ id: 3, original_name: "c.png", translations: [{ locale: "la", alt: "y" }] })).toMatchObject({ filename: "c.png", alt: { la: "y" } });
    expect(toMediaOption({ original_filename: "no-id" })).toBeUndefined();
  });
});

describe("apiSchemaFormData.listMedia / listMediaFolders", () => {
  it("maps the query to the API's parameters and the page meta to the result", async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ success: true, data: [{ id: 1, original_filename: "a.png" }], meta: { total: 49, page: 2, limit: 24, total_page: 3 } });
      })
    );
    const res = await apiSchemaFormData.listMedia({ keyword: "k", page: 2, limit: 24, folderId: 4, includeSubfolders: true, kind: "image", mime: "image/*" });
    expect(Object.fromEntries(q!.entries())).toEqual({ page: "2", limit: "24", keyword: "k", folder_id: "4", include_subfolders: "true", kind: "image", mime: "image/*" });
    expect(res).toMatchObject({ total: 49, page: 2, totalPages: 3, items: [{ id: 1, filename: "a.png" }] });
  });

  it("'root' is passed as is and never with sub-folders; a list without meta still works (older shape)", async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ success: true, data: [{ id: 1, filename: "a.png" }, { id: 2, filename: "b.png" }] });
      })
    );
    const res = await apiSchemaFormData.listMedia({ folderId: "root", includeSubfolders: true });
    expect(q?.get("folder_id")).toBe("root");
    expect(q?.has("include_subfolders")).toBe(false);
    expect(res).toMatchObject({ total: 2, totalPages: 1 });
  });

  it("`ids` resolves exactly those rows: sent alone (the API refuses it with any other filter), capped at 50", async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/media/assets`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ success: true, data: [{ id: 9, original_filename: "z.png" }], meta: { total: 1, page: 1, limit: 3, total_page: 1 } });
      })
    );
    await apiSchemaFormData.listMedia({ ids: [9, 4, 7], keyword: "ignored", folderId: 2, kind: "image", mime: "image/*", page: 3 });
    expect(Object.fromEntries(q!.entries())).toEqual({ ids: "9,4,7", page: "1", limit: "3" });
    await apiSchemaFormData.listMedia({ ids: Array.from({ length: 80 }, (_, i) => i + 1) });
    expect(q!.get("ids")!.split(",")).toHaveLength(50);
    expect(q!.get("limit")).toBe("50");
  });

  it("folders keep path, depth, parent and asset count", async () => {
    server.use(
      http.get(`${API}/media/folders`, () =>
        HttpResponse.json({ success: true, data: [{ id: 6, name: "Logos", path: "Brand/Logos", depth: 2, parent_id: 5, asset_count: 2 }, { id: "bad" }] })
      )
    );
    expect(await apiSchemaFormData.listMediaFolders()).toEqual([{ id: 6, name: "Logos", path: "Brand/Logos", depth: 2, parentId: 5, assetCount: 2 }]);
  });
});

describe("toEntityOption reads a picture of an album (05 13.4.1 AlbumItem) and an album with its key", () => {
  it("the label of a picture is its caption title in the first language that has one, else the file name", () => {
    expect(toEntityOption("albumItem", { id: 4, media: { original_filename: "a.jpg" }, translations: { la: { caption_title: null }, en: { caption_title: "Canopy" } } })).toMatchObject({ value: 4, label: "Canopy" });
    expect(toEntityOption("albumItem", { id: 5, media: { original_filename: "b.jpg" }, translations: {} })).toMatchObject({ value: 5, label: "b.jpg" });
    expect(toEntityOption("albumItem", { id: 6 })).toMatchObject({ value: 6, label: "6" });
  });
  it("an album shows its key as the hint", () => {
    expect(toEntityOption("album", { id: 1, key: "forest", title: "Forest", status: "published" })).toMatchObject({ value: 1, label: "Forest", hint: "forest", status: "published" });
  });
});

describe("apiSchemaFormData.getEntity for key-referenced kinds", () => {
  it("lists with limit 100, the largest page the real API accepts (200 was a 422 out_of_range)", async () => {
    let q: URLSearchParams | undefined;
    server.use(
      http.get(`${API}/forms`, ({ request }) => {
        q = new URL(request.url).searchParams;
        const limit = Number(q.get("limit"));
        if (limit > 100) return HttpResponse.json({ success: false, code: "VALIDATION_FAILED", errors: [{ in: "query", path: "/limit", code: "out_of_range", params: { min: 1, max: 100 } }] }, { status: 422 });
        return HttpResponse.json({ success: true, data: [{ id: 1, slug: "contact", name: "Contact form" }], meta: { total: 1, page: 1, limit, total_page: 1 } });
      })
    );
    const found = await apiSchemaFormData.getEntity("form", "contact");
    expect(q?.get("limit")).toBe("100");
    expect(found).toMatchObject({ value: "contact" });
  });
});
