// Which entities have a revisions endpoint and where (doc/05 section 11.7 item 1). `RevisionsTab`
// (components/global/revisions/) takes `{ resource, id }`; this table turns it into the URL base, the key a user
// needs to restore and the URL of the entity itself (whose ETag is the `If-Match` of a restore).
//
// T1.4.7 adds the publishable resources (`pages`, `posts`, ...: kinds `draft` / `published`) here.
import { PERMISSION_KEYS } from "@/lib/constants/permissions";

export type RevisionResource = "menus" | "settings" | "ui-strings" | "categories" | "tags" | "media/assets";

export type RevisionEntityId = string | number;

type ResourceConfig = {
  // `menus` + `main` -> `/menus/main`.
  base: (id: RevisionEntityId) => string;
  // Permission key to READ the history, and the action(s) that allow a restore (any of them).
  readKey: (id: RevisionEntityId) => string;
  restoreKey: (id: RevisionEntityId) => string;
  restoreActions: readonly string[];
  // `GET` of the entity itself (answers its current ETag). `null` = there is no single-entity read (ui-strings):
  // the editor passes the ETag in.
  entityPath: ((id: RevisionEntityId) => string) | null;
};

const seg = (id: RevisionEntityId) => encodeURIComponent(String(id));

export const REVISION_RESOURCES: Record<RevisionResource, ResourceConfig> = {
  menus: {
    base: (id) => `/menus/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_MENUS,
    restoreKey: () => PERMISSION_KEYS.CMS_MENUS,
    restoreActions: ["update"],
    entityPath: (id) => `/menus/${seg(id)}`,
  },
  settings: {
    base: (id) => `/settings/${seg(id)}`,
    // The `seo` group belongs to `cms.seo` (doc/05 11.7 item 1).
    readKey: (id) => (id === "seo" ? PERMISSION_KEYS.CMS_SEO : PERMISSION_KEYS.CMS_SETTINGS),
    restoreKey: (id) => (id === "seo" ? PERMISSION_KEYS.CMS_SEO : PERMISSION_KEYS.CMS_SETTINGS),
    restoreActions: ["update"],
    entityPath: (id) => `/settings/${seg(id)}`,
  },
  "ui-strings": {
    base: (id) => `/ui-strings/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_UI_STRINGS,
    restoreKey: () => PERMISSION_KEYS.CMS_UI_STRINGS,
    restoreActions: ["update"],
    entityPath: null,
  },
  categories: {
    base: (id) => `/categories/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_CATEGORIES,
    restoreKey: () => PERMISSION_KEYS.CMS_CATEGORIES,
    restoreActions: ["update"],
    entityPath: (id) => `/categories/${seg(id)}`,
  },
  tags: {
    // Tags are guarded by the categories key (doc/05 11.7 item 1).
    base: (id) => `/tags/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_CATEGORIES,
    restoreKey: () => PERMISSION_KEYS.CMS_CATEGORIES,
    restoreActions: ["update"],
    entityPath: (id) => `/tags/${seg(id)}`,
  },
  "media/assets": {
    base: (id) => `/media/assets/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.MEDIA_LIBRARY,
    restoreKey: () => PERMISSION_KEYS.MEDIA_LIBRARY,
    restoreActions: ["update", "update_own"],
    entityPath: (id) => `/media/assets/${seg(id)}`,
  },
};

export function revisionBase(resource: RevisionResource, id: RevisionEntityId): string {
  return REVISION_RESOURCES[resource].base(id);
}

// Query-key prefix of everything revision related for one entity (list pages + opened revisions).
export const revisionsQueryKey = (resource: RevisionResource, id: RevisionEntityId) =>
  ["revisions", resource, String(id)] as const;
