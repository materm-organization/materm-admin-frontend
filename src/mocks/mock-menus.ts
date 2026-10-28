// In-memory model of the menus endpoints (doc/05 section 11.2; shapes: doc/api/openapi-admin.yaml MenuSummary,
// MenuDetail, MenuItem, Create/UpdateMenuItemRequest, ReorderMenuItemsRequest, MenuStamp). Seeded with the three
// system menus of the admin backend seed (`migrations/seeds/0050_reference_content.sql`): main (5 page links),
// footer (4) and social (4 external links with registry icons), and the five pages they point at.
// Strict like the real API: unknown fields -> 422, no `If-Match` -> 428, stale -> 409 `CONFLICT_LOCK_VERSION`, the
// flat-menu / url / icon / default-language rules of 11.2, the translate-only 403 rule (11.1.3) for a model whose
// `translateOnly` list contains "menus".
import {
  DEFAULT_LOCALE_CODE,
  MOCK_ACTIVE_LOCALE_CODES,
  MOCK_LOCALE_CODES,
  MOCK_USER,
  badRequest,
  etagOf,
  forbidden,
  invalidState,
  keyOf,
  micros,
  notFound,
  pushRevision,
  requireIfMatch,
  tick,
  validationFailed,
  type MockDb,
  type MockMenu,
  type MockPageRoot,
} from "@/mocks/mock-core";
import { isTrashed, pageName, pagePath } from "@/mocks/mock-pages";
import type { ApiFieldError } from "@/types/api";
import type { SaveLiveWarning, UserRef } from "@/types/media";
import type {
  MenuDetail,
  MenuItem,
  MenuLink,
  MenuStamp,
  MenuSummary,
} from "@/types/menus";

export const SOCIAL_ICONS = ["instagram", "youtube", "facebook", "twitter"] as const;
const MAX_ITEMS = 30;
const RECOMMENDED_MAIN = 7;
const URL_PATTERN = /^(https:\/\/|\/(?!\/)|mailto:|tel:|#)\S*$/;
const ICON_PATTERN = /^[a-z0-9_-]{1,40}$/;

const SEED_AT = micros(Date.UTC(2026, 9, 26, 9, 0, 0), 150);

// ---------------------------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------------------------
function seedItem(
  id: number,
  sort: number,
  link: MenuLink,
  label: string,
  opts: { icon?: string; match?: "exact" | "prefix" } = {}
): MenuItem {
  return {
    id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000${String(id).padStart(2, "0")}`,
    parent_id: null,
    sort_order: sort,
    link,
    icon: opts.icon ?? null,
    active_match: opts.match ?? "prefix",
    is_visible: true,
    // The seed writes the English copy in both languages (doc 02 header).
    translations: { la: { label, aria_label: null }, en: { label, aria_label: null } },
    missing_locales: [],
    page: null,
    link_state: "ok",
    created_by: null,
    updated_by: null,
    created_at: SEED_AT,
    updated_at: SEED_AT,
  };
}

const pageLink = (page_id: number): MenuLink => ({ type: "page", page_id, url: null, open_in_new_tab: false });
const urlLink = (url: string, tab = true): MenuLink => ({ type: "url", page_id: null, url, open_in_new_tab: tab });

export function seedMenus(): MockMenu[] {
  const base = {
    public_id: "",
    item_count: 0,
    visible_item_count: 0,
    updated_at: SEED_AT,
    updated_by: null as UserRef,
    etag: etagOf(SEED_AT),
  };
  return [
    {
      ...base,
      id: 1,
      public_id: "0192d3a4-7c1e-7b52-9d0a-0000000000b1",
      key: "main",
      name: "Main navigation",
      description: "Header navigation",
      is_system: true,
      items: [
        seedItem(1, 0, pageLink(1), "Home", { match: "exact" }),
        seedItem(2, 1, pageLink(2), "Our Path"),
        seedItem(3, 2, pageLink(3), "The Blog"),
        seedItem(4, 3, pageLink(4), "Gallery"),
        seedItem(5, 4, pageLink(5), "Contact"),
      ],
    },
    {
      ...base,
      id: 2,
      public_id: "0192d3a4-7c1e-7b52-9d0a-0000000000b2",
      key: "footer",
      name: "Footer navigation",
      description: "Footer links",
      is_system: true,
      items: [
        seedItem(6, 0, pageLink(1), "Home", { match: "exact" }),
        seedItem(7, 1, pageLink(2), "Our Path"),
        seedItem(8, 2, pageLink(3), "Blog"),
        seedItem(9, 3, pageLink(5), "Contact"),
      ],
    },
    {
      ...base,
      id: 3,
      public_id: "0192d3a4-7c1e-7b52-9d0a-0000000000b3",
      key: "social",
      name: "Social links",
      description: "Footer social icons",
      is_system: true,
      items: [
        seedItem(10, 0, urlLink("https://www.instagram.com/"), "Instagram", { icon: "instagram" }),
        seedItem(11, 1, urlLink("https://www.youtube.com/"), "YouTube", { icon: "youtube" }),
        seedItem(12, 2, urlLink("https://www.facebook.com/"), "Facebook", { icon: "facebook" }),
        seedItem(13, 3, urlLink("https://twitter.com/"), "Twitter", { icon: "twitter" }),
      ],
    },
  ];
}

export const MENU_NEXT_ITEM_ID = 14;

// ---------------------------------------------------------------------------------------------------------------
// Derived fields
// ---------------------------------------------------------------------------------------------------------------
function pageOfLink(db: MockDb, link: MenuLink): MockPageRoot | undefined {
  return link.type === "page" ? db.pages.find((p) => p.id === link.page_id) : undefined;
}

function decorate(db: MockDb, menu: MockMenu, item: MenuItem): MenuItem {
  const page = pageOfLink(db, item.link);
  const linkState: MenuItem["link_state"] = page
    ? isTrashed(page)
      ? "page_trashed"
      : page.status !== "published"
        ? "page_unpublished"
        : "ok"
    : menu.key === "social" && item.icon && !(SOCIAL_ICONS as readonly string[]).includes(item.icon)
      ? "icon_unknown"
      : "ok";
  return {
    ...item,
    missing_locales: MOCK_ACTIVE_LOCALE_CODES.filter((code) => !item.translations[code]?.label),
    page: page ? { id: page.id, name: pageName(page), path: pagePath(page), status: page.status, is_trashed: isTrashed(page) } : null,
    link_state: linkState,
  };
}

function sortedItems(menu: MockMenu): MenuItem[] {
  return [...menu.items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}

function summaryOf(db: MockDb, menu: MockMenu): MenuSummary {
  const items = menu.items.map((i) => decorate(db, menu, i));
  return {
    id: menu.id,
    public_id: menu.public_id,
    key: menu.key,
    name: menu.name,
    description: menu.description,
    is_system: menu.is_system,
    item_count: items.length,
    visible_item_count: items.filter((i) => i.is_visible && i.link_state === "ok").length,
    updated_at: menu.updated_at,
    updated_by: menu.updated_by,
    etag: etagOf(menu.updated_at),
  };
}

function detailOf(db: MockDb, menu: MockMenu): MenuDetail {
  return {
    ...summaryOf(db, menu),
    items: sortedItems(menu).map((i) => decorate(db, menu, i)),
    limits: { max_depth: 1, max_items: MAX_ITEMS, recommended_max_items: menu.key === "main" ? RECOMMENDED_MAIN : null },
    options: {
      link_types: ["page", "url"],
      active_match: ["exact", "prefix"],
      icons: menu.key === "social" ? [...SOCIAL_ICONS] : [],
    },
  };
}

function stampOf(menu: MockMenu): MenuStamp {
  return { id: menu.id, key: menu.key, etag: etagOf(menu.updated_at), updated_at: menu.updated_at, item_count: menu.items.length };
}

function findMenu(db: MockDb, key: string): MockMenu {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) throw notFound();
  const menu = db.menus.find((m) => m.key === key);
  if (!menu) throw notFound();
  return menu;
}

function findItem(menu: MockMenu, id: string): MenuItem {
  const item = menu.items.find((i) => String(i.id) === id);
  if (!item) throw notFound();
  return item;
}

// 05 11.7 item 3: the snapshot of a menu.
export function menuSnapshot(menu: MockMenu): Record<string, unknown> {
  return {
    key: menu.key,
    items: sortedItems(menu).map((i) => ({
      public_id: i.public_id,
      parent_id: null,
      sort_order: i.sort_order,
      link_type: i.link.type,
      page_id: i.link.type === "page" ? (i.link.page_id ?? null) : null,
      url: i.link.type === "url" ? (i.link.url ?? null) : null,
      open_in_new_tab: i.link.open_in_new_tab ?? false,
      icon: i.icon,
      active_match: i.active_match,
      is_visible: i.is_visible,
      translations: Object.entries(i.translations).map(([locale_code, t]) => ({ locale_code, label: t.label, aria_label: t.aria_label ?? null })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------
export function listMenus(db: MockDb) {
  return db.menus.map((m) => summaryOf(db, m));
}

export function getMenu(db: MockDb, key: string) {
  const menu = findMenu(db, key);
  return { menu: detailOf(db, menu), etag: etagOf(menu.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const CREATE_FIELDS = ["link", "translations", "icon", "active_match", "is_visible", "parent_id", "position"] as const;
const LINK_FIELDS = ["type", "page_id", "url", "open_in_new_tab"] as const;

function unknownFields(input: Record<string, unknown>, allowed: readonly string[], prefix = ""): ApiFieldError[] {
  return Object.keys(input)
    .filter((k) => !allowed.includes(k))
    .map((k) => ({ in: "body" as const, path: `${prefix}/${k}`, code: "unknown_field" }));
}

function checkLink(db: MockDb, menu: MockMenu, link: unknown, errors: ApiFieldError[]) {
  if (!isObject(link)) {
    errors.push({ in: "body", path: "/link", code: link === undefined ? "required" : "invalid_type" });
    return;
  }
  errors.push(...unknownFields(link, LINK_FIELDS, "/link"));
  if (link.type !== "page" && link.type !== "url") {
    errors.push({ in: "body", path: "/link/type", code: link.type === undefined ? "required" : "not_in_enum", params: { expected: ["page", "url"] } });
    return;
  }
  if ("open_in_new_tab" in link && typeof link.open_in_new_tab !== "boolean") {
    errors.push({ in: "body", path: "/link/open_in_new_tab", code: "invalid_type" });
  }
  if (link.type === "page") {
    if (menu.key === "social") errors.push({ in: "body", path: "/link/type", code: "not_applicable" });
    if (link.url !== undefined && link.url !== null) errors.push({ in: "body", path: "/link/url", code: "not_applicable" });
    const page = typeof link.page_id === "number" ? db.pages.find((p) => p.id === link.page_id) : undefined;
    if (link.page_id === undefined || link.page_id === null) errors.push({ in: "body", path: "/link/page_id", code: "required" });
    else if (!page || isTrashed(page)) errors.push({ in: "body", path: "/link/page_id", code: "unknown_reference" });
  } else {
    if (link.page_id !== undefined && link.page_id !== null) errors.push({ in: "body", path: "/link/page_id", code: "not_applicable" });
    const url = link.url;
    if (typeof url !== "string" || url === "") errors.push({ in: "body", path: "/link/url", code: "required" });
    else if (url.length > 2000) errors.push({ in: "body", path: "/link/url", code: "too_long", params: { max: 2000 } });
    else if (!URL_PATTERN.test(url) || (menu.key === "social" && !url.startsWith("https://"))) {
      errors.push({ in: "body", path: "/link/url", code: "pattern_mismatch" });
    }
  }
}

function checkTranslations(translations: unknown, errors: ApiFieldError[], mode: "create" | "patch", current?: MenuItem) {
  if (!isObject(translations)) {
    errors.push({ in: "body", path: "/translations", code: translations === undefined ? "required" : "invalid_type" });
    return;
  }
  for (const [code, value] of Object.entries(translations)) {
    const base = `/translations/${code}`;
    if (!(MOCK_LOCALE_CODES as readonly string[]).includes(code)) {
      errors.push({ in: "body", path: base, code: "unknown_reference" });
      continue;
    }
    if (value === null) {
      if (mode === "create") errors.push({ in: "body", path: base, code: "invalid_type" });
      else if (code === DEFAULT_LOCALE_CODE) errors.push({ in: "body", path: `${base}`, code: "required" });
      continue;
    }
    if (!isObject(value)) {
      errors.push({ in: "body", path: base, code: "invalid_type" });
      continue;
    }
    errors.push(...unknownFields(value, ["label", "aria_label"], base));
    const label = value.label;
    if (typeof label !== "string" || label.trim() === "") errors.push({ in: "body", path: `${base}/label`, code: label === undefined ? "required" : "too_short", params: { min: 1 } });
    else if ([...label].length > 60) errors.push({ in: "body", path: `${base}/label`, code: "too_long", params: { max: 60 } });
    const aria = value.aria_label;
    if (aria !== undefined && aria !== null) {
      if (typeof aria !== "string" || aria === "") errors.push({ in: "body", path: `${base}/aria_label`, code: "too_short", params: { min: 1 } });
      else if ([...aria].length > 120) errors.push({ in: "body", path: `${base}/aria_label`, code: "too_long", params: { max: 120 } });
    }
  }
  if (mode === "create" && !isObject(translations[DEFAULT_LOCALE_CODE])) {
    errors.push({ in: "body", path: `/translations/${DEFAULT_LOCALE_CODE}/label`, code: "required" });
  }
  void current;
}

function checkIconAndFlags(menu: MockMenu, input: Record<string, unknown>, errors: ApiFieldError[], mode: "create" | "patch") {
  if (menu.key === "social") {
    if ("icon" in input || mode === "create") {
      const icon = input.icon;
      if (icon === undefined || icon === null || icon === "") errors.push({ in: "body", path: "/icon", code: "required" });
      else if (typeof icon !== "string" || !ICON_PATTERN.test(icon)) errors.push({ in: "body", path: "/icon", code: "pattern_mismatch" });
      else if (!(SOCIAL_ICONS as readonly string[]).includes(icon)) errors.push({ in: "body", path: "/icon", code: "not_in_enum", params: { expected: [...SOCIAL_ICONS] } });
    }
  } else if (input.icon !== undefined && input.icon !== null) {
    errors.push({ in: "body", path: "/icon", code: "not_applicable" });
  }
  if ("active_match" in input && input.active_match !== "exact" && input.active_match !== "prefix") {
    errors.push({ in: "body", path: "/active_match", code: "not_in_enum", params: { expected: ["exact", "prefix"] } });
  }
  if ("is_visible" in input && typeof input.is_visible !== "boolean") errors.push({ in: "body", path: "/is_visible", code: "invalid_type" });
  if ("parent_id" in input && input.parent_id !== null) errors.push({ in: "body", path: "/parent_id", code: "max_depth_exceeded", params: { max_depth: 1 } });
}

function touch(db: MockDb, menu: MockMenu) {
  menu.updated_at = tick(db);
  menu.updated_by = MOCK_USER;
}

function writeRevision(db: MockDb, menu: MockMenu, before: Record<string, unknown>, at: string) {
  pushRevision(db, "menus", menu.key, "cms.menus", "history", before, null, at, MOCK_USER, 1, menu.id);
}

function warningsFor(db: MockDb, menu: MockMenu, item?: MenuItem): SaveLiveWarning[] {
  const warnings: SaveLiveWarning[] = [];
  if (menu.key === "main" && menu.items.length > RECOMMENDED_MAIN) {
    warnings.push({ path: "", code: "too_many_items", message: "More than 7 items in the main menu.", params: { count: menu.items.length, recommended: RECOMMENDED_MAIN } });
  }
  if (item) {
    const page = pageOfLink(db, item.link);
    if (page && page.status !== "published") {
      warnings.push({ path: "/link/page_id", code: "link_page_not_published", message: "This page is not published: the item is hidden on the website.", params: { page_id: page.id } });
    }
  }
  return warnings;
}

// `menu.items` is already in the wanted order: number it 0..n-1 (what the server does on create / move).
function renumber(menu: MockMenu) {
  menu.items.forEach((item, index) => {
    item.sort_order = index;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------------------
export function createMenuItem(db: MockDb, key: string, body: unknown, ifMatch: string | null) {
  const menu = findMenu(db, key);
  if (!isObject(body)) throw badRequest();
  const structural = unknownFields(body, CREATE_FIELDS);
  if (structural.length) throw validationFailed(structural);
  requireIfMatch(ifMatch, etagOf(menu.updated_at));
  if (db.translateOnly.includes("menus")) throw forbidden("create");

  const errors: ApiFieldError[] = [];
  checkLink(db, menu, body.link, errors);
  checkTranslations(body.translations, errors, "create");
  checkIconAndFlags(menu, body, errors, "create");
  const count = menu.items.length;
  if (count >= MAX_ITEMS) errors.push({ in: "body", path: "", code: "limit_exceeded", params: { max: MAX_ITEMS } });
  if ("position" in body) {
    const p = body.position;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0) errors.push({ in: "body", path: "/position", code: "out_of_range" });
    else if (p > count) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { max: count } });
  }
  if (errors.length) throw validationFailed(errors);

  const before = menuSnapshot(menu);
  const at = tick(db);
  const link = body.link as MenuLink;
  const id = db.nextMenuItemId++;
  const translations = Object.fromEntries(
    Object.entries(body.translations as Record<string, { label: string; aria_label?: string | null }>).map(([code, t]) => [
      code,
      { label: t.label.trim(), aria_label: t.aria_label ?? null },
    ])
  );
  const item: MenuItem = {
    id,
    public_id: `0192d3a4-7c1e-7b52-9d0a-0000000000${String(id).padStart(2, "0")}`,
    parent_id: null,
    sort_order: 0,
    link: link.type === "page"
      ? { type: "page", page_id: link.page_id, url: null, open_in_new_tab: link.open_in_new_tab ?? false }
      : { type: "url", page_id: null, url: link.url, open_in_new_tab: link.open_in_new_tab ?? false },
    icon: menu.key === "social" ? ((body.icon as string) ?? null) : null,
    active_match: (body.active_match as "exact" | "prefix" | undefined) ?? "prefix",
    is_visible: (body.is_visible as boolean | undefined) ?? true,
    translations,
    missing_locales: [],
    page: null,
    link_state: "ok",
    created_by: MOCK_USER,
    updated_by: MOCK_USER,
    created_at: at,
    updated_at: at,
  };
  const position = typeof body.position === "number" ? body.position : count;
  const ordered = sortedItems(menu);
  ordered.splice(position, 0, item);
  menu.items = ordered;
  renumber(menu);
  writeRevision(db, menu, before, at);
  touch(db, menu);
  return { data: { item: decorate(db, menu, item), menu: stampOf(menu), warnings: warningsFor(db, menu, item) }, etag: etagOf(menu.updated_at) };
}

const PATCH_NON_TRANSLATABLE = ["link", "icon", "active_match", "is_visible", "parent_id", "position"] as const;

export function patchMenuItem(db: MockDb, key: string, id: string, body: unknown, ifMatch: string | null) {
  const menu = findMenu(db, key);
  const item = findItem(menu, id);
  if (!isObject(body)) throw badRequest();
  const structural = unknownFields(body, CREATE_FIELDS);
  if (Object.keys(body).length === 0) structural.push({ in: "body", path: "", code: "min_properties" });
  if (structural.length) throw validationFailed(structural);
  requireIfMatch(ifMatch, etagOf(menu.updated_at));

  const errors: ApiFieldError[] = [];
  if ("link" in body) checkLink(db, menu, body.link, errors);
  if ("translations" in body) checkTranslations(body.translations, errors, "patch", item);
  checkIconAndFlags(menu, body, errors, "patch");
  if ("position" in body) {
    const p = body.position;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p >= menu.items.length) errors.push({ in: "body", path: "/position", code: "out_of_range", params: { max: menu.items.length - 1 } });
  }
  if (errors.length) throw validationFailed(errors);

  // The new state, without touching the stored item yet.
  const next: MenuItem = structuredClone(item);
  if (isObject(body.link)) {
    const link = body.link as MenuLink;
    next.link = link.type === "page"
      ? { type: "page", page_id: link.page_id, url: null, open_in_new_tab: link.open_in_new_tab ?? false }
      : { type: "url", page_id: null, url: link.url, open_in_new_tab: link.open_in_new_tab ?? false };
  }
  if ("icon" in body) next.icon = (body.icon as string | null) ?? null;
  if ("active_match" in body) next.active_match = body.active_match as "exact" | "prefix";
  if ("is_visible" in body) next.is_visible = body.is_visible as boolean;
  if (isObject(body.translations)) {
    for (const [code, t] of Object.entries(body.translations as Record<string, { label: string; aria_label?: string | null } | null>)) {
      if (t === null) delete next.translations[code];
      else next.translations[code] = { label: t.label.trim(), aria_label: t.aria_label === undefined ? (next.translations[code]?.aria_label ?? null) : t.aria_label };
    }
  }

  const changedFields = (): string[] => {
    const out: string[] = [];
    if (JSON.stringify(next.link) !== JSON.stringify(item.link)) out.push("link");
    if (next.icon !== item.icon) out.push("icon");
    if (next.active_match !== item.active_match) out.push("active_match");
    if (next.is_visible !== item.is_visible) out.push("is_visible");
    if (JSON.stringify(next.translations) !== JSON.stringify(item.translations)) out.push("translations");
    if ("position" in body && body.position !== sortedItems(menu).findIndex((i) => i.id === item.id)) out.push("position");
    return out;
  };
  const changed = changedFields();
  if (db.translateOnly.includes("menus")) {
    const bad = changed.find((f) => (PATCH_NON_TRANSLATABLE as readonly string[]).includes(f));
    if (bad) throw forbidden(`/${bad}`);
  }
  if (changed.length === 0) {
    return { data: { item: decorate(db, menu, item), menu: stampOf(menu), warnings: warningsFor(db, menu, item) }, etag: etagOf(menu.updated_at) };
  }

  const before = menuSnapshot(menu);
  const at = tick(db);
  Object.assign(item, next, { updated_at: at, updated_by: MOCK_USER });
  if (changed.includes("position")) {
    const ordered = sortedItems(menu).filter((i) => i.id !== item.id);
    ordered.splice(body.position as number, 0, item);
    menu.items = ordered;
    renumber(menu);
  }
  writeRevision(db, menu, before, at);
  touch(db, menu);
  return { data: { item: decorate(db, menu, item), menu: stampOf(menu), warnings: warningsFor(db, menu, item) }, etag: etagOf(menu.updated_at) };
}

export function reorderMenuItems(db: MockDb, key: string, body: unknown, ifMatch: string | null) {
  const menu = findMenu(db, key);
  if (!isObject(body)) throw badRequest();
  const structural = unknownFields(body, ["items"]);
  if (structural.length) throw validationFailed(structural);
  requireIfMatch(ifMatch, etagOf(menu.updated_at));
  if (db.translateOnly.includes("menus")) throw forbidden("/items");

  const errors: ApiFieldError[] = [];
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw validationFailed([{ in: "body", path: "/items", code: items === undefined ? "required" : "too_short", params: { min: 1 } }]);
  }
  if (items.length > MAX_ITEMS) errors.push({ in: "body", path: "/items", code: "too_many_items", params: { max: MAX_ITEMS } });
  const seen = new Set<number>();
  items.forEach((entry, i) => {
    if (!isObject(entry) || typeof entry.id !== "number") {
      errors.push({ in: "body", path: `/items/${i}/id`, code: "required" });
      return;
    }
    errors.push(...unknownFields(entry, ["id", "parent_id"], `/items/${i}`));
    if (seen.has(entry.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "duplicate" });
    seen.add(entry.id);
    if (!menu.items.some((m) => m.id === entry.id)) errors.push({ in: "body", path: `/items/${i}/id`, code: "unknown_reference" });
    if ("parent_id" in entry && entry.parent_id !== null && entry.parent_id !== undefined) {
      errors.push({ in: "body", path: `/items/${i}/parent_id`, code: "max_depth_exceeded", params: { max_depth: 1 } });
    }
  });
  const missing = menu.items.filter((m) => !seen.has(m.id)).map((m) => m.id);
  if (missing.length && !errors.some((e) => e.code === "unknown_reference")) {
    errors.push({ in: "body", path: "", code: "required", params: { missing: missing.map(String) } });
  }
  if (errors.length) throw validationFailed(errors);

  const order = (items as Array<{ id: number }>).map((e) => e.id);
  const current = sortedItems(menu).map((i) => i.id);
  if (JSON.stringify(order) !== JSON.stringify(current)) {
    const before = menuSnapshot(menu);
    const at = tick(db);
    order.forEach((itemId, index) => {
      menu.items.find((i) => i.id === itemId)!.sort_order = index;
    });
    writeRevision(db, menu, before, at);
    touch(db, menu);
  }
  return {
    data: {
      items: sortedItems(menu).map((i) => ({ id: i.id, public_id: i.public_id, parent_id: null, sort_order: i.sort_order })),
      menu: stampOf(menu),
      warnings: warningsFor(db, menu),
    },
    etag: etagOf(menu.updated_at),
  };
}

export function deleteMenuItem(db: MockDb, key: string, id: string, ifMatch: string | null) {
  const menu = findMenu(db, key);
  const item = findItem(menu, id);
  requireIfMatch(ifMatch, etagOf(menu.updated_at));
  if (db.translateOnly.includes("menus")) throw forbidden("delete");
  const before = menuSnapshot(menu);
  const at = tick(db);
  // A hard delete: the other items keep their `sort_order` (a gap is allowed).
  menu.items = menu.items.filter((i) => i.id !== item.id);
  writeRevision(db, menu, before, at);
  touch(db, menu);
  return { data: { menu: stampOf(menu), warnings: warningsFor(db, menu) }, etag: etagOf(menu.updated_at) };
}

// ---------------------------------------------------------------------------------------------------------------
// Revisions (11.7)
// ---------------------------------------------------------------------------------------------------------------
type SnapshotItem = {
  public_id: string;
  sort_order: number;
  link_type: "page" | "url";
  page_id: number | null;
  url: string | null;
  open_in_new_tab: boolean;
  icon: string | null;
  active_match: "exact" | "prefix";
  is_visible: boolean;
  translations: Array<{ locale_code: string; label: string; aria_label: string | null }>;
};

export function restoreMenu(db: MockDb, key: string, rev: { id: number; version: number; schema_version: number; snapshot: Record<string, unknown> }, note: string, ifMatch: string | null) {
  const menu = findMenu(db, key);
  requireIfMatch(ifMatch, etagOf(menu.updated_at));
  if (rev.schema_version > 1) throw invalidState("snapshot_incompatible");
  const snap = rev.snapshot as { items?: SnapshotItem[] };
  const items = Array.isArray(snap.items) ? snap.items : [];
  const errors: ApiFieldError[] = [];
  items.forEach((it, i) => {
    if (it.link_type === "page") {
      const page = db.pages.find((p) => p.id === it.page_id);
      if (!page || isTrashed(page)) errors.push({ in: "entity", path: `/items/${i}/page_id`, code: "unknown_reference" });
    }
    for (const t of it.translations) {
      if (!(MOCK_LOCALE_CODES as readonly string[]).includes(t.locale_code)) {
        errors.push({ in: "entity", path: `/items/${i}/translations/${t.locale_code}`, code: "unknown_reference" });
      }
    }
  });
  if (errors.length) throw validationFailed(errors);

  const restoredFrom = { revision_id: rev.id, version: rev.version };
  const target = JSON.stringify({ key: menu.key, items: items.map((i) => ({ ...i, parent_id: null })) });
  if (target === JSON.stringify(menuSnapshot(menu))) {
    return { data: { ...detailOf(db, menu), restored_from: restoredFrom }, etag: etagOf(menu.updated_at) };
  }
  const before = menuSnapshot(menu);
  const at = tick(db);
  pushRevision(db, "menus", menu.key, "cms.menus", "restore", before, note, at, MOCK_USER, 1, menu.id);
  // Match by `public_id`: update, insert with a NEW id, delete the rest.
  const byPublic = new Map(menu.items.map((i) => [i.public_id, i]));
  menu.items = items.map((it) => {
    const existing = byPublic.get(it.public_id);
    const link: MenuLink = it.link_type === "page"
      ? { type: "page", page_id: it.page_id, url: null, open_in_new_tab: it.open_in_new_tab }
      : { type: "url", page_id: null, url: it.url, open_in_new_tab: it.open_in_new_tab };
    return {
      ...(existing ?? {
        id: db.nextMenuItemId++,
        public_id: it.public_id,
        parent_id: null,
        created_by: MOCK_USER,
        created_at: at,
        missing_locales: [],
        page: null,
        link_state: "ok" as const,
      }),
      sort_order: it.sort_order,
      link,
      icon: it.icon,
      active_match: it.active_match,
      is_visible: it.is_visible,
      translations: Object.fromEntries(it.translations.map((t) => [t.locale_code, { label: t.label, aria_label: t.aria_label }])),
      updated_by: MOCK_USER,
      updated_at: at,
    } as MenuItem;
  });
  touch(db, menu);
  return { data: { ...detailOf(db, menu), restored_from: restoredFrom }, etag: etagOf(menu.updated_at) };
}

// History of the seeded main menu (the state BEFORE two edits): the menu playground and the tests need something
// to browse and restore. INVENTED: the people and the older labels; the current state is the real seed.
export function seedMenuRevisions(db: MockDb) {
  const base = Date.UTC(2026, 9, 20, 8, 0, 0);
  const menu = db.menus.find((m) => m.key === "main")!;
  const snap = menuSnapshot(menu) as { key: string; items: SnapshotItem[] };
  const edit = (fn: (items: SnapshotItem[]) => SnapshotItem[]) => ({ key: "main", items: fn(structuredClone(snap.items)) });
  const v1 = edit((items) => items.filter((i) => i.public_id.endsWith("05") === false).map((i) => ({ ...i })));
  const v2 = edit((items) =>
    items.map((i) => (i.public_id.endsWith("02") ? { ...i, translations: i.translations.map((t) => ({ ...t, label: t.locale_code === "en" ? "Our path" : t.label })) } : i))
  );
  pushRevision(db, "menus", "main", "cms.menus", "history", v1, null, micros(base + 1_000_000), { id: 4, name: "Somchai Vongsa" }, 1, menu.id);
  pushRevision(db, "menus", "main", "cms.menus", "history", v2, "renamed Our Path", micros(base + 2_000_000), { id: 6, name: "Noy Keomany" }, 1, menu.id);
  void keyOf;
}

export type { MockMenu };
