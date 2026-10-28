// Menus (doc/05-api-spec.md section 11.2, doc/api/openapi-admin.yaml: MenuSummary, MenuDetail, MenuItem, MenuLink,
// CreateMenuItemRequest, UpdateMenuItemRequest, ReorderMenuItemsRequest, MenuStamp). P1 menus are FLAT
// (`parent_id` is always null; `limits.max_depth = 1`).
import type { SaveLiveWarning, UserRef } from "@/types/media";

export type MenuKey = "main" | "footer" | "social" | (string & {});

export type MenuLinkType = "page" | "url";
export type MenuActiveMatch = "exact" | "prefix";
export type MenuLinkState = "ok" | "page_unpublished" | "page_trashed" | "icon_unknown";

export type MenuLink = {
  type: MenuLinkType;
  // Required when `type = page` (and `url` then absent).
  page_id?: number | null;
  // Required when `type = url`: `https://`, `/path`, `mailto:`, `tel:` or `#`; never `http://`, `javascript:`, `//host`.
  url?: string | null;
  open_in_new_tab?: boolean;
};

export type MenuItemTranslation = { label: string; aria_label?: string | null };

export type MenuPageRef = { id: number; name: string; path: string; status: string; is_trashed: boolean } | null;

export type MenuItem = {
  id: number;
  public_id: string;
  parent_id: number | null;
  sort_order: number;
  link: MenuLink;
  icon: string | null;
  active_match: MenuActiveMatch;
  is_visible: boolean;
  translations: Record<string, MenuItemTranslation>;
  // Active locales that have no `label` yet.
  missing_locales: string[];
  page: MenuPageRef;
  link_state: MenuLinkState;
  created_by?: UserRef;
  updated_by?: UserRef;
  created_at: string;
  updated_at: string;
};

export type MenuSummary = {
  id: number;
  public_id: string;
  key: MenuKey;
  name: string;
  description: string;
  is_system: boolean;
  item_count: number;
  visible_item_count: number;
  updated_at: string;
  updated_by?: UserRef;
  etag: string;
};

export type MenuLimits = { max_depth: number; max_items: number; recommended_max_items: number | null };
export type MenuOptions = { link_types: string[]; active_match: string[]; icons: string[] };

export type MenuDetail = MenuSummary & {
  items: MenuItem[];
  limits: MenuLimits;
  options: MenuOptions;
};

// What every write of an item answers next to the item: the menu's NEW ETag (put it in the cache, no refetch).
export type MenuStamp = { id: number; key: string; etag: string; updated_at: string; item_count: number };

export type CreateMenuItemPayload = {
  link: MenuLink;
  translations: Record<string, MenuItemTranslation | null>;
  icon?: string | null;
  active_match?: MenuActiveMatch;
  is_visible?: boolean;
  parent_id?: number | null;
  position?: number;
};

// Partial, at least one key. `translations`: `{ en: null }` deletes the English text (never the default language).
export type UpdateMenuItemPayload = Partial<Omit<CreateMenuItemPayload, "position">> & { position?: number };

export type ReorderMenuItemsPayload = { items: Array<{ id: number; parent_id?: number | null }> };

export type MenuItemWriteResult = { item: MenuItem; menu: MenuStamp; warnings: SaveLiveWarning[] };
export type MenuDeleteResult = { menu: MenuStamp; warnings: SaveLiveWarning[] };
export type MenuOrderResult = {
  items: Array<{ id: number; public_id: string; parent_id: number | null; sort_order: number }>;
  menu: MenuStamp;
  warnings: SaveLiveWarning[];
};
