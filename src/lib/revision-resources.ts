// Which entities have a revisions endpoint and where (doc/05 section 11.7 item 1). `RevisionsTab`
// (components/global/revisions/) takes `{ resource, id }`; this table turns it into the URL base, the key a user
// needs to restore and the URL of the entity itself (whose ETag is the `If-Match` of a restore).
//
// The publishable resources (`pages`, `posts`, then `albums`... in M5: kinds `draft` / `published`, a restore becomes
// the working draft - doc/05 section 12.8) carry `publishable: true`.
import { splitEntryRef } from "@/lib/collections/ref";
import { PERMISSION_KEYS } from "@/lib/constants/permissions";

export type RevisionResource = "menus" | "settings" | "ui-strings" | "categories" | "tags" | "redirects" | "authors" | "media/assets" | "pages" | "posts" | "albums" | "faq-groups" | "forms" | "collections" | "collection-entries" | "shared-sections";

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
  // Publishable entity (draft / published / history / restore rows, a restore becomes the working draft). Save-live
  // entities leave it out.
  publishable?: boolean;
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
  authors: {
    // Authors are guarded by the blog key (doc/05 15.0); `update` restores.
    base: (id) => `/authors/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_BLOG,
    restoreKey: () => PERMISSION_KEYS.CMS_BLOG,
    restoreActions: ["update"],
    entityPath: (id) => `/authors/${seg(id)}`,
  },
  redirects: {
    base: (id) => `/redirects/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_REDIRECTS,
    restoreKey: () => PERMISSION_KEYS.CMS_REDIRECTS,
    restoreActions: ["update"],
    entityPath: (id) => `/redirects/${seg(id)}`,
  },
  pages: {
    base: (id) => `/pages/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_PAGES,
    restoreKey: () => PERMISSION_KEYS.CMS_PAGES,
    restoreActions: ["update"],
    entityPath: (id) => `/pages/${seg(id)}`,
    publishable: true,
  },
  posts: {
    base: (id) => `/posts/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_BLOG,
    restoreKey: () => PERMISSION_KEYS.CMS_BLOG,
    // `update`, or `update_own` of my own post: the host passes `canRestore` (it knows the owner).
    restoreActions: ["update", "update_own"],
    entityPath: (id) => `/posts/${seg(id)}`,
    publishable: true,
  },
  albums: {
    base: (id) => `/albums/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_GALLERIES,
    restoreKey: () => PERMISSION_KEYS.CMS_GALLERIES,
    restoreActions: ["update"],
    entityPath: (id) => `/albums/${seg(id)}`,
    publishable: true,
  },
  "faq-groups": {
    base: (id) => `/faq-groups/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_FAQ,
    restoreKey: () => PERMISSION_KEYS.CMS_FAQ,
    restoreActions: ["update"],
    entityPath: (id) => `/faq-groups/${seg(id)}`,
    publishable: true,
  },
  forms: {
    base: (id) => `/forms/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.FORMS_MANAGE,
    restoreKey: () => PERMISSION_KEYS.FORMS_MANAGE,
    restoreActions: ["update"],
    entityPath: (id) => `/forms/${seg(id)}`,
    publishable: true,
  },
  // Collection definitions (05 17.6): save-live, addressed by key; a restore needs `manage_schema` and passes the schema rules again.
  collections: {
    base: (id) => `/collections/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_COLLECTIONS,
    restoreKey: () => PERMISSION_KEYS.CMS_COLLECTIONS,
    restoreActions: ["manage_schema"],
    entityPath: (id) => `/collections/${seg(id)}`,
  },
  // Collection entries (05 17.10): publishable; the id is the composite `"<key>:<id>"` (`lib/collections/ref.ts`).
  "collection-entries": {
    base: (ref) => {
      const { key, id } = splitEntryRef(ref);
      return `/collections/${seg(key)}/entries/${id}`;
    },
    readKey: () => PERMISSION_KEYS.CMS_COLLECTIONS,
    restoreKey: () => PERMISSION_KEYS.CMS_COLLECTIONS,
    restoreActions: ["update"],
    entityPath: (ref) => {
      const { key, id } = splitEntryRef(ref);
      return `/collections/${seg(key)}/entries/${id}`;
    },
    publishable: true,
  },
  // Shared sections (05 18.8): publishable; the history entity type is `cms.shared_section`. A restore needs `cms.sections:update`.
  "shared-sections": {
    base: (id) => `/shared-sections/${seg(id)}`,
    readKey: () => PERMISSION_KEYS.CMS_SECTIONS,
    restoreKey: () => PERMISSION_KEYS.CMS_SECTIONS,
    restoreActions: ["update"],
    entityPath: (id) => `/shared-sections/${seg(id)}`,
    publishable: true,
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

export const isPublishableResource = (resource: RevisionResource): boolean => REVISION_RESOURCES[resource].publishable === true;
