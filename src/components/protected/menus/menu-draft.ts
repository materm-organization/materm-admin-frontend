// The form state of one menu item and what leaves it (doc/05 section 11.2, doc/07 section 3.10). Pure.
import type { ApiFieldError } from "@/types/api";
import type { CreateMenuItemPayload, MenuActiveMatch, MenuItem, MenuLink, MenuLinkType, UpdateMenuItemPayload } from "@/types/menus";

export const MAX_LABEL = 60;
export const MAX_ARIA = 120;
export const MAX_URL = 2000;
// The same rule as the server (stricter than the DB check): https, a root-relative path (not `//host`), mailto:, tel: or #.
export const MENU_URL_PATTERN = /^(https:\/\/|\/(?!\/)|mailto:|tel:|#)\S*$/;

export type ItemDraft = {
  linkType: MenuLinkType;
  pageId: number | null;
  url: string;
  openInNewTab: boolean;
  icon: string;
  activeMatch: MenuActiveMatch;
  isVisible: boolean;
  labels: Record<string, string>;
  ariaLabels: Record<string, string>;
};

export const emptyDraft = (menuKey: string): ItemDraft => ({
  linkType: menuKey === "social" ? "url" : "page",
  pageId: null,
  url: "",
  openInNewTab: menuKey === "social",
  icon: "",
  activeMatch: "prefix",
  isVisible: true,
  labels: {},
  ariaLabels: {},
});

export function draftFromItem(item: MenuItem): ItemDraft {
  return {
    linkType: item.link.type,
    pageId: item.link.type === "page" ? (item.link.page_id ?? null) : null,
    url: item.link.type === "url" ? (item.link.url ?? "") : "",
    openInNewTab: item.link.open_in_new_tab ?? false,
    icon: item.icon ?? "",
    activeMatch: item.active_match,
    isVisible: item.is_visible,
    labels: Object.fromEntries(Object.entries(item.translations).map(([c, t]) => [c, t.label])),
    ariaLabels: Object.fromEntries(Object.entries(item.translations).map(([c, t]) => [c, t.aria_label ?? ""])),
  };
}

export function linkOf(draft: ItemDraft): MenuLink {
  return draft.linkType === "page"
    ? { type: "page", page_id: draft.pageId, open_in_new_tab: draft.openInNewTab }
    : { type: "url", url: draft.url.trim(), open_in_new_tab: draft.openInNewTab };
}

const sameLink = (a: ItemDraft, b: ItemDraft) =>
  a.linkType === b.linkType && a.pageId === b.pageId && a.url.trim() === b.url.trim() && a.openInNewTab === b.openInNewTab;

// Languages whose label / aria text differs (a label counts as present when it has non-blank text).
function changedLocales(a: ItemDraft, b: ItemDraft): string[] {
  const codes = new Set([...Object.keys(a.labels), ...Object.keys(a.ariaLabels), ...Object.keys(b.labels), ...Object.keys(b.ariaLabels)]);
  return [...codes].filter(
    (c) =>
      (a.labels[c] ?? "").trim() !== (b.labels[c] ?? "").trim() || (a.ariaLabels[c] ?? "").trim() !== (b.ariaLabels[c] ?? "").trim()
  );
}

export function isDraftChanged(saved: ItemDraft, draft: ItemDraft): boolean {
  return (
    !sameLink(saved, draft) ||
    saved.icon !== draft.icon ||
    saved.activeMatch !== draft.activeMatch ||
    saved.isVisible !== draft.isVisible ||
    changedLocales(saved, draft).length > 0
  );
}

function translationOf(draft: ItemDraft, code: string) {
  const label = (draft.labels[code] ?? "").trim();
  const aria = (draft.ariaLabels[code] ?? "").trim();
  return { label, aria_label: aria === "" ? null : aria };
}

// PATCH body: only what changed. A language whose label was cleared is deleted (`null`), never the default one.
export function buildPatch(saved: ItemDraft, draft: ItemDraft, defaultLocale: string, options: { translateOnly?: boolean } = {}): UpdateMenuItemPayload {
  const payload: UpdateMenuItemPayload = {};
  if (!options.translateOnly) {
    if (!sameLink(saved, draft)) payload.link = linkOf(draft);
    if (saved.icon !== draft.icon) payload.icon = draft.icon || null;
    if (saved.activeMatch !== draft.activeMatch) payload.active_match = draft.activeMatch;
    if (saved.isVisible !== draft.isVisible) payload.is_visible = draft.isVisible;
  }
  const codes = changedLocales(saved, draft);
  if (codes.length) {
    payload.translations = {};
    for (const code of codes) {
      const t = translationOf(draft, code);
      payload.translations[code] = t.label === "" && code !== defaultLocale ? null : t;
    }
  }
  return payload;
}

export function buildCreate(menuKey: string, draft: ItemDraft): CreateMenuItemPayload {
  const translations: CreateMenuItemPayload["translations"] = {};
  for (const code of Object.keys(draft.labels)) {
    const t = translationOf(draft, code);
    if (t.label !== "") translations[code] = t;
  }
  return {
    link: linkOf(draft),
    translations,
    active_match: draft.activeMatch,
    is_visible: draft.isVisible,
    ...(menuKey === "social" ? { icon: draft.icon || null } : {}),
  };
}

// Client checks (the server decides). Paths are the API's (`/translations/la/label`, `/link/url`, ...).
export function validateDraft(menuKey: string, draft: ItemDraft, defaultLocale: string, options: { translateOnly?: boolean } = {}): ApiFieldError[] {
  const errors: ApiFieldError[] = [];
  const add = (path: string, code: string, params?: ApiFieldError["params"]) => errors.push({ in: "body", path, code, ...(params ? { params } : {}) });
  if (!(draft.labels[defaultLocale] ?? "").trim()) add(`/translations/${defaultLocale}/label`, "required");
  for (const [code, label] of Object.entries(draft.labels)) {
    if ([...label.trim()].length > MAX_LABEL) add(`/translations/${code}/label`, "too_long", { max: MAX_LABEL });
  }
  for (const [code, aria] of Object.entries(draft.ariaLabels)) {
    if ([...aria.trim()].length > MAX_ARIA) add(`/translations/${code}/aria_label`, "too_long", { max: MAX_ARIA });
  }
  if (options.translateOnly) return errors;
  if (draft.linkType === "page") {
    if (menuKey === "social") add("/link/type", "not_applicable");
    if (draft.pageId === null) add("/link/page_id", "required");
  } else {
    const url = draft.url.trim();
    if (!url) add("/link/url", "required");
    else if (url.length > MAX_URL) add("/link/url", "too_long", { max: MAX_URL });
    else if (!MENU_URL_PATTERN.test(url) || (menuKey === "social" && !url.startsWith("https://"))) add("/link/url", "pattern_mismatch");
  }
  if (menuKey === "social" && !draft.icon) add("/icon", "required");
  return errors;
}

// Where the error belongs in the form (`label:la`, `link.url` ...), to find the field and its language.
export function issueLocale(path: string): string | undefined {
  return /^\/translations\/([^/]+)\//.exec(path)?.[1];
}

// The menu in the shape of a revision snapshot (05 11.7 item 3), for `RevisionsTab`'s "compare with current".
export function menuSnapshotOf(menu: { key: string; items: MenuItem[] }): Record<string, unknown> {
  return {
    key: menu.key,
    items: [...menu.items]
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((i) => ({
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
