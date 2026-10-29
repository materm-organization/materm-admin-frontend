// Reads the page editor needs next to the pages model (T1.4.8): the section-type registry (05 10.6 / 12.6) and the
// lookups of the pickers inside a section's props (posts, albums with their photos, FAQ groups, forms). The
// registry is the 12 fixtures of `doc/content-schemas`; the rest are the picker fixtures, plus the model's own albums
// and posts. INVENTED: nothing but the usage counts (not shown by the editor).
import { SECTION_TYPE_FIXTURES } from "@/components/schema-form/fixtures";
import { ALBUM_ITEM_FIXTURES, FAQ_GROUP_FIXTURES, FORM_FIXTURES } from "@/components/schema-form/fixtures/lookup";
import { MockHttpError, fail, notFound, paginate, rejectUnknown, validationFailed, type MockDb, type Params } from "@/mocks/mock-core";
import { listTemplates } from "@/mocks/mock-pages";
import type { SectionType } from "@/types/cms";

const summary = (type: SectionType, withSchema: boolean) => ({
  id: 100 + Object.keys(SECTION_TYPE_FIXTURES).indexOf(type.key) + 1,
  key: type.key,
  version: type.version,
  name: type.name,
  description: type.description,
  variants: type.variants,
  allowed_scopes: type.allowed_scopes,
  is_current: true,
  is_active: type.is_active !== false,
  code_registered: true,
  schema_hash: `mock-${type.key}-${type.version}`,
  usage: { sections: 0, shared_sections: 0 },
  ...(withSchema ? { json_schema: type.json_schema, ui_schema: type.ui_schema, default_props: type.default_props } : {}),
});

// `GET /section-types`: not paginated; `template` keeps the types that template allows.
export function listSectionTypes(db: MockDb, params: Params) {
  rejectUnknown(params, ["include", "is_active", "scope", "template", "keyword"]);
  const include = params.get("include");
  if (include !== null && include !== "schema") throw validationFailed([{ in: "query", path: "/include", code: "not_in_enum", params: { expected: ["schema"] } }]);
  const template = params.get("template");
  const allowed = template ? listTemplates(db).find((t) => t.key === template)?.allowed_sections.map((s) => s.section_type_key) : undefined;
  if (template && !allowed) throw validationFailed([{ in: "query", path: "/template", code: "not_in_enum" }]);
  const active = params.get("is_active");
  const keyword = params.get("keyword")?.toLowerCase();
  return Object.values(SECTION_TYPE_FIXTURES)
    .filter((t) => (!allowed || allowed.includes(t.key)) && (active === null || String(t.is_active !== false) === active) && (!keyword || t.name.toLowerCase().includes(keyword) || t.key.includes(keyword)))
    .map((t) => summary(t, include === "schema"));
}

export function getSectionType(key: string) {
  const type = SECTION_TYPE_FIXTURES[key];
  if (!type) throw notFound();
  return summary(type, true);
}

type Row = Record<string, unknown>;
function filtered(rows: Row[], params: Params, fields: string[]) {
  const keyword = params.get("keyword")?.toLowerCase();
  return rows.filter((r) => !keyword || fields.some((f) => String(r[f] ?? "").toLowerCase().includes(keyword)));
}

// The post picker reads the real `GET /posts` (mock-posts.ts).
export function listLookup(db: MockDb, kind: "albums" | "faq-groups" | "forms", params: Params) {
  let rows: Row[];
  if (kind === "albums") rows = db.albums.map((a) => ({ id: a.id, title: a.title, slug: `album-${a.id}`, status: a.status }));
  else if (kind === "faq-groups") rows = FAQ_GROUP_FIXTURES.map((o) => ({ key: o.value, name: o.label, status: o.status }));
  else rows = FORM_FIXTURES.map((o) => ({ slug: o.value, name: o.label, status: o.status }));
  return paginate(filtered(rows, params, ["title", "name", "slug", "key"]), params, 20);
}

export function listAlbumItems(db: MockDb, albumId: string) {
  if (!db.albums.some((a) => String(a.id) === albumId)) throw notFound();
  return (ALBUM_ITEM_FIXTURES[Number(albumId)] ?? []).map((o) => ({ id: o.value, title: o.label }));
}

export const unknownLookup = (): MockHttpError => fail(404, "NOT_FOUND", "The requested resource was not found.");
