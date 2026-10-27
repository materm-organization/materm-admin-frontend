import { http, HttpResponse } from "msw";

import {
  ALBUM_FIXTURES,
  ALBUM_ITEM_FIXTURES,
  CATEGORY_FIXTURES,
  FAQ_GROUP_FIXTURES,
  FORM_FIXTURES,
  LOCALE_FIXTURES,
  MEDIA_FIXTURES,
  PAGE_FIXTURES,
  POST_FIXTURES,
} from "@/components/schema-form/fixtures/lookup";
import { SECTION_TYPE_FIXTURES } from "@/components/schema-form/fixtures";
import type { EntityOption } from "@/types/cms";

const API = "http://localhost:3000/api/v1";

const ok = (data: unknown) => HttpResponse.json({ success: true, data });

// Rows as the pickers' tolerant adapter reads them: `id` / `key` / `slug`, `title` or `name`, `status`.
function list(path: string, rows: EntityOption[], valueField: "id" | "key" | "slug", labelField: "title" | "name") {
  const toRow = (r: EntityOption) => ({
    [valueField]: r.value,
    [labelField]: r.label,
    ...(valueField === "id" ? { slug: r.hint, path: r.hint } : { key: r.value }),
    status: r.status,
  });
  return [
    http.get(`${API}${path}`, ({ request }) => {
      const keyword = new URL(request.url).searchParams.get("keyword")?.toLowerCase();
      const filtered = rows.filter((r) => !keyword || r.label.toLowerCase().includes(keyword));
      return ok(filtered.map(toRow));
    }),
    ...(valueField === "id"
      ? [
          http.get(`${API}${path}/:id`, ({ params }) => {
            const row = rows.find((r) => String(r.value) === params.id);
            return row ? ok(toRow(row)) : HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 });
          }),
        ]
      : []),
  ];
}

// The CMS endpoints the schema form engine reads, over the seed fixtures (doc/05 section 10.6 for the types;
// the list shapes of 05 section 6 are not final, see components/schema-form/data/api-data.ts).
export const cmsHandlers = [
  http.get(`${API}/section-types/:key`, ({ params }) => {
    const type = SECTION_TYPE_FIXTURES[String(params.key)];
    return type ? ok(type) : HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 });
  }),
  http.get(`${API}/section-types`, () => ok(Object.values(SECTION_TYPE_FIXTURES))),
  http.get(`${API}/media/assets/:id`, ({ params }) => {
    const row = MEDIA_FIXTURES.find((m) => String(m.id) === params.id);
    return row ? ok(row) : HttpResponse.json({ success: false, code: "NOT_FOUND" }, { status: 404 });
  }),
  http.get(`${API}/media/assets`, ({ request }) => {
    const keyword = new URL(request.url).searchParams.get("keyword")?.toLowerCase();
    return ok(MEDIA_FIXTURES.filter((m) => !keyword || m.filename.toLowerCase().includes(keyword)));
  }),
  http.get(`${API}/albums/:id/items`, ({ params }) => {
    const rows = ALBUM_ITEM_FIXTURES[Number(params.id)] ?? [];
    return ok(rows.map((r) => ({ id: r.value, title: r.label })));
  }),
  ...list("/pages", PAGE_FIXTURES, "id", "title"),
  ...list("/posts", POST_FIXTURES, "id", "title"),
  ...list("/albums", ALBUM_FIXTURES, "id", "title"),
  ...list("/categories", CATEGORY_FIXTURES, "id", "name"),
  ...list("/faq-groups", FAQ_GROUP_FIXTURES, "key", "name"),
  ...list("/forms", FORM_FIXTURES, "slug", "name"),
  http.get(`${API}/locales`, () => ok(LOCALE_FIXTURES.map((l) => ({ text_direction: "ltr", flag: null, search_config: "simple", date_formats: null, created_at: "", updated_at: "", ...l })))),
];
