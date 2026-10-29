// The publishable entities (doc/05 section 12.7: `POST /{e}/{id}/publish`, `.../unpublish`, `.../discard-draft`;
// doc/07 section 3.24). `PublishBar` takes `resource` and builds every URL and permission check from this table.
// Pages are the first, posts the second (T1.5.5); albums, FAQ groups and forms are added in M5 (one entry each).
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";

export type PublishableResource = "pages" | "posts" | "albums" | "faq-groups" | "forms";

export type PublishableConfig = {
  // `/pages/12`
  base: (id: number | string) => string;
  // The list endpoint (its queries are refreshed after a command).
  listPath: string;
  // Permission key: `publish` / `unpublish` / `update` (= discard draft, save draft) are actions of this key.
  permissionKey: string;
  // The `entity_type` of the aggregate stamp.
  entityType: string;
  // A preview link needs `read` plus one of these (05 12.9.2).
  previewActions: readonly string[];
  // Whether preview links exist for this entity kind (05 12.9 / 13.3.8: pages and posts only; albums, FAQ groups and forms
  // hide the button, PT-18). `PublishBar` shows the Preview button only when this is true.
  previewLinks: boolean;
  // The kind has `update_own` (the creator may save, discard and issue preview links of their own thing, 05 13.3.2). Publish and
  // unpublish never count the creator: they need `publish` / `unpublish`.
  ownActions: boolean;
};

export const PUBLISHABLE_RESOURCES: Record<PublishableResource, PublishableConfig> = {
  pages: {
    base: (id) => `/pages/${id}`,
    listPath: "/pages",
    permissionKey: PERMISSION_KEYS.CMS_PAGES,
    entityType: "cms.pages",
    previewActions: [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW],
    previewLinks: true,
    ownActions: false,
  },
  posts: {
    base: (id) => `/posts/${id}`,
    listPath: "/posts",
    permissionKey: PERMISSION_KEYS.CMS_BLOG,
    entityType: "cms.posts",
    previewActions: [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW],
    previewLinks: true,
    ownActions: true,
  },
  // T1.5.6 (05 13.2): no preview links (PT-18), no `update_own`.
  albums: {
    base: (id) => `/albums/${id}`,
    listPath: "/albums",
    permissionKey: PERMISSION_KEYS.CMS_GALLERIES,
    entityType: "cms.albums",
    previewActions: [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW],
    previewLinks: false,
    ownActions: false,
  },
  "faq-groups": {
    base: (id) => `/faq-groups/${id}`,
    listPath: "/faq-groups",
    permissionKey: PERMISSION_KEYS.CMS_FAQ,
    entityType: "cms.faq_groups",
    previewActions: [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW],
    previewLinks: false,
    ownActions: false,
  },
  // T1.5.7 (05 13.2 / 13.6.5): no preview links (PT-18), no `update_own`. The recipients are not part of the draft (13.6.4).
  forms: {
    base: (id) => `/forms/${id}`,
    listPath: "/forms",
    permissionKey: PERMISSION_KEYS.FORMS_MANAGE,
    entityType: "forms.forms",
    previewActions: [PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.REVIEW],
    previewLinks: false,
    ownActions: false,
  },
};

export const publishableBase = (resource: PublishableResource, id: number | string) => PUBLISHABLE_RESOURCES[resource].base(id);
