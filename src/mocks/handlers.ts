// MSW handlers over the in-memory model (`mock-db.ts` and the save-live modules): media library, menus, settings,
// UI strings, categories / tags, revisions, cache purge, plus the two reads those screens need next to them
// (languages, system status). Base-agnostic URL patterns (`*/api/v1/...`)
// so the same handlers serve the Vitest server (`http://localhost:3000/api/v1`) and the browser mock whatever
// `NEXT_PUBLIC_API_BASE_URL` is. Tests call `resetMockDb()` in `beforeEach`; a test that needs a special answer
// puts its own handler in front with `server.use(...)`.
import { http, HttpResponse, type HttpHandler } from "msw";

import { lockConflict, notFound, preconditionRequired } from "@/mocks/mock-core";
import type { Locale } from "@/types/locales";
import { LOCALE_ROWS } from "@/components/schema-form/fixtures/lookup";
import { listAuditLogs } from "@/mocks/mock-audit";
import { formsApiHandlers } from "@/mocks/forms-handlers";
import { createMenuItem, deleteMenuItem, getMenu, listMenus, patchMenuItem, reorderMenuItems } from "@/mocks/mock-menus";
import { getSectionType, listAlbumItems, listLookup, listSectionTypes } from "@/mocks/mock-cms-lookups";
import {
  createPage,
  createSection,
  deletePage,
  deleteSection,
  reorderSections,
  discardDraft,
  getPage,
  getPageRevision,
  getReferences,
  getSection,
  getTemplates,
  listPageRevisions,
  listPages,
  listSections,
  patchPage,
  patchSection,
  publishPage,
  restorePage,
  restorePageRevision,
  setHome,
  unpublishPage,
  withIdempotency,
} from "@/mocks/mock-pages";
import {
  checkPostSlug,
  createPost,
  deletePost,
  discardPostDraft,
  getPost,
  getPostRevision,
  listPostRevisions,
  listPosts,
  patchPost,
  publishPost,
  replacePostMedia,
  restorePost,
  restorePostRevision,
  unpublishPost,
} from "@/mocks/mock-posts";
import {
  createAlbum,
  createAlbumItems,
  deleteAlbum,
  deleteAlbumItem,
  discardAlbumDraft,
  getAlbum,
  getAlbumRevision,
  listAlbumItems as listAlbumItemRows,
  listAlbumRevisions,
  listAlbums,
  patchAlbum,
  patchAlbumItem,
  publishAlbum,
  reorderAlbumItems,
  restoreAlbum,
  restoreAlbumRevision,
  unpublishAlbum,
} from "@/mocks/mock-albums";
import {
  createFaqGroup,
  createFaqItem,
  deleteFaqGroup,
  deleteFaqItem,
  discardFaqGroupDraft,
  getFaqGroup,
  getFaqRevision,
  listFaqGroups,
  listFaqItems,
  listFaqRevisions,
  patchFaqGroup,
  patchFaqItem,
  publishFaqGroup,
  reorderFaqItems,
  restoreFaqGroup,
  restoreFaqRevision,
  unpublishFaqGroup,
} from "@/mocks/mock-faq";
import { replaceAssetFile, uploadAsset } from "@/mocks/mock-media-upload";
import { createPreviewLink, listPreviewLinks, revokePreviewLink } from "@/mocks/mock-preview";
import { getSettingsGroup, listSettingsGroups, putSettingsGroup } from "@/mocks/mock-settings";
import {
  createTaxonomy,
  deleteTaxonomy,
  getTaxonomyRow,
  listTaxonomy,
  patchTaxonomy,
  restoreTaxonomyRow,
} from "@/mocks/mock-taxonomy";
import { bundleSync, deleteUiString, listUiStrings, putUiString, uiStringKeyEtag } from "@/mocks/mock-ui-strings";
import {
  MockHttpError,
  createFolder,
  deleteAsset,
  deleteFolder,
  getAsset,
  getMockDb,
  getRevision,
  listAssets,
  listFolders,
  listRevisions,
  listUsages,
  patchAsset,
  patchFolder,
  purgeCache,
  restoreAsset,
  restoreRevision,
} from "@/mocks/mock-db";

const P = (path: string) => `*/api/v1${path}`;
const ok = (data: unknown, init: { status?: number; etag?: string; meta?: unknown } = {}) =>
  HttpResponse.json(
    { success: true, data, ...(init.meta ? { meta: init.meta } : {}) },
    { status: init.status ?? 200, headers: init.etag ? { ETag: init.etag } : undefined }
  );

// Runs a resolver and turns a `MockHttpError` into the API's error envelope.
function guard<A extends { request: Request; params: Record<string, string | readonly string[] | undefined> }>(
  resolver: (args: A) => Response | Promise<Response>
) {
  return async (args: A) => {
    try {
      return await resolver(args);
    } catch (error) {
      if (error instanceof MockHttpError) {
        return HttpResponse.json(error.body, { status: error.status, headers: error.headers });
      }
      throw error;
    }
  };
}

const param = (params: Record<string, string | readonly string[] | undefined>, name: string) => String(params[name]);
const searchOf = (request: Request) => new URL(request.url).searchParams;
const jsonBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text ? JSON.parse(text) : undefined;
};

const mediaHandlers: HttpHandler[] = [
  http.get(P("/media/assets"), guard(({ request }) => {
    const { data, meta } = listAssets(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
  http.get(P("/media/assets/:id"), guard(({ params }) => {
    const { asset, etag } = getAsset(getMockDb(), param(params, "id"));
    return ok(asset, { etag });
  })),
  http.patch(P("/media/assets/:id"), guard(async ({ request, params }) => {
    const { asset, etag } = patchAsset(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(asset, { etag });
  })),
  http.delete(P("/media/assets/:id"), guard(({ request, params }) => {
    deleteAsset(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(null);
  })),
  http.post(P("/media/assets/:id/restore"), guard(({ request, params }) => {
    const { asset, etag } = restoreAsset(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(asset, { etag });
  })),
  http.get(P("/media/assets/:id/usages"), guard(({ request, params }) => {
    const { data, meta } = listUsages(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { meta });
  })),
  // P2: multipart upload / replace (mock-media-upload.ts). The specific paths first: `/media/uploads` is not an id.
  http.post(P("/media/uploads"), guard(async ({ request }) => {
    const { asset, etag } = await uploadAsset(getMockDb(), request);
    return ok(asset, { status: 201, etag });
  })),
  http.post(P("/media/:id/file"), guard(async ({ request, params }) => {
    const { asset, etag } = await replaceAssetFile(getMockDb(), param(params, "id"), request);
    return ok(asset, { etag });
  })),
  http.get(P("/media/folders"), guard(() => ok(listFolders(getMockDb())))),
  http.post(P("/media/folders"), guard(async ({ request }) => {
    const folder = createFolder(getMockDb(), await jsonBody(request));
    return ok(folder, { status: 201, etag: folder.etag });
  })),
  http.patch(P("/media/folders/:id"), guard(async ({ request, params }) => {
    const folder = patchFolder(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(folder, { etag: folder.etag });
  })),
  http.delete(P("/media/folders/:id"), guard(({ request, params }) => {
    deleteFolder(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(null);
  })),
];

// The six save-live entities share the revisions endpoints (doc/05 11.7); `idParam` names the path parameter.
function revisionHandlers(resource: string, basePattern: string, idParam: string, listEtag?: (id: string) => string): HttpHandler[] {
  return [
    http.get(P(`${basePattern}/revisions`), guard(({ request, params }) => {
      const id = param(params, idParam);
      const { data, meta } = listRevisions(getMockDb(), resource, id, searchOf(request));
      return ok(data, { meta, etag: listEtag?.(id) });
    })),
    http.get(P(`${basePattern}/revisions/:revId`), guard(({ params }) =>
      ok(getRevision(getMockDb(), resource, param(params, idParam), param(params, "revId")))
    )),
    http.post(P(`${basePattern}/revisions/:revId/restore`), guard(async ({ request, params }) => {
      const { data, etag } = restoreRevision(
        getMockDb(), resource, param(params, idParam), param(params, "revId"), await jsonBody(request), request.headers.get("If-Match")
      );
      return ok(data, { etag });
    })),
  ];
}

export const revisionApiHandlers: HttpHandler[] = [
  ...revisionHandlers("media/assets", "/media/assets/:id", "id"),
  ...revisionHandlers("menus", "/menus/:key", "key"),
  ...revisionHandlers("settings", "/settings/:group", "group"),
  // PROVISIONAL contract (see mock-ui-strings.ts): the list of a key carries the ETag a key-level restore needs.
  ...revisionHandlers("ui-strings", "/ui-strings/:key", "key", (key) => uiStringKeyEtag(getMockDb(), key)),
  ...revisionHandlers("categories", "/categories/:id", "id"),
  ...revisionHandlers("tags", "/tags/:id", "id"),
];

export const systemApiHandlers: HttpHandler[] = [
  http.post(P("/system/cache/purge"), guard(async ({ request }) => ok(purgeCache(getMockDb(), await jsonBody(request))))),
  http.get(P("/system/status"), () =>
    ok({
      status: "ok",
      service: {
        name: "materm-admin-backend",
        version: "0.1.0-mock",
        commit: "mock",
        environment: "dev",
        started_at: "2026-10-27T01:00:00Z",
        server_time: "2026-10-27T04:00:00Z",
        uptime_seconds: 10800,
      },
      dependencies: [
        { name: "database", status: "ok", latency_ms: 3, checked_at: "2026-10-27T04:00:00Z", error_code: null },
        { name: "redis", status: "ok", latency_ms: 1, checked_at: "2026-10-27T04:00:00Z", error_code: null },
        { name: "file_store", status: "not_configured", latency_ms: null, checked_at: "2026-10-27T04:00:00Z", error_code: null },
        { name: "mailer", status: "not_configured", latency_ms: null, checked_at: "2026-10-27T04:00:00Z", error_code: null },
      ],
      counters: { users: 3, roles: 4 },
      outbox: { pending: 0, failed: 0, last_success_at: "2026-10-27T03:59:30Z" },
    })
  ),
];

// Locales: every PATCH needs `If-Match: <row.etag>` (missing or `*` -> 428, stale -> 409 CONFLICT_LOCK_VERSION, never 412); the answer
// is the row with its new `etag` (also as the `ETag` header). The edit is applied to a module-level copy (`resetMockLocales`).
let mockLocales: Locale[] = structuredClone(LOCALE_ROWS);
let localeStamp = 0;
export const resetMockLocales = () => {
  mockLocales = structuredClone(LOCALE_ROWS);
  localeStamp = 0;
};
export const localeApiHandlers: HttpHandler[] = [
  http.get(P("/locales"), () => ok(mockLocales)),
  http.patch(P("/locales/:code"), guard(async ({ request, params }) => {
    const row = mockLocales.find((l) => l.code === param(params, "code"));
    if (!row) throw notFound();
    const ifMatch = request.headers.get("If-Match")?.trim();
    if (!ifMatch || ifMatch === "*") throw preconditionRequired();
    if (ifMatch !== row.etag) throw lockConflict();
    Object.assign(row, (await jsonBody(request)) as Partial<Locale>);
    localeStamp += 1;
    row.etag = `"2026-10-28T02:00:00.${String(localeStamp).padStart(6, "0")}Z"`;
    return ok(row, { etag: row.etag });
  })),
];

// The audit log: the full filter set for `ops.audit:read`, the History tab shape for anyone with `read` on the entity (mock-audit.ts).
export const auditApiHandlers: HttpHandler[] = [
  http.get(P("/audit-logs"), guard(({ request }) => {
    const { data, meta } = listAuditLogs(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
];

// --- T1.3.8 save-live -------------------------------------------------------------------------------------------
const menuHandlers: HttpHandler[] = [
  http.get(P("/menus"), guard(() => ok(listMenus(getMockDb())))),
  http.get(P("/menus/:key"), guard(({ params }) => {
    const { menu, etag } = getMenu(getMockDb(), param(params, "key"));
    return ok(menu, { etag });
  })),
  http.post(P("/menus/:key/items"), guard(async ({ request, params }) => {
    const { data, etag } = createMenuItem(getMockDb(), param(params, "key"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { status: 201, etag });
  })),
  // `items/order` before `items/:id`: a path segment named "order" is the reorder, never an item id.
  http.put(P("/menus/:key/items/order"), guard(async ({ request, params }) => {
    const { data, etag } = reorderMenuItems(getMockDb(), param(params, "key"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.patch(P("/menus/:key/items/:id"), guard(async ({ request, params }) => {
    const { data, etag } = patchMenuItem(getMockDb(), param(params, "key"), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.delete(P("/menus/:key/items/:id"), guard(({ request, params }) => {
    const { data, etag } = deleteMenuItem(getMockDb(), param(params, "key"), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
];

// Pages, the publish engine and the page revisions (T1.4.7; 05 section 12). `Idempotency-Key` is honoured on the
// four routes that list it (create, set-home, publish, unpublish): the same key with the same request replays the
// stored answer (`Idempotent-Replayed: true`), the same key with another request is a 422.
function idempotent(request: Request, params: Record<string, string | readonly string[] | undefined>, run: () => { status: number; data: unknown; etag?: string; location?: string }) {
  const url = new URL(request.url);
  const fingerprint = `${request.method} ${url.pathname}${url.search} ${request.headers.get("If-Match") ?? ""}`;
  void params;
  let location: string | undefined;
  const result = withIdempotency(getMockDb(), request.headers.get("Idempotency-Key"), fingerprint, () => {
    const done = run();
    location = done.location;
    return done;
  });
  const headers: Record<string, string> = {};
  if (location) headers.Location = location;
  if (result.etag) headers.ETag = result.etag;
  if (result.replayed) headers["Idempotent-Replayed"] = "true";
  return HttpResponse.json({ success: true, data: result.data }, { status: result.status, headers });
}

const pageHandlers: HttpHandler[] = [
  http.get(P("/pages"), guard(({ request }) => {
    const { data, meta } = listPages(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
  http.post(P("/pages"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => ({ status: 201, ...createPage(getMockDb(), body) }));
  })),
  http.get(P("/page-templates"), guard(({ request }) => ok(getTemplates(getMockDb(), searchOf(request))))),
  http.get(P("/pages/:id"), guard(({ params }) => {
    const { data, etag } = getPage(getMockDb(), param(params, "id"));
    return ok(data, { etag });
  })),
  http.patch(P("/pages/:id"), guard(async ({ request, params }) => {
    const { data, etag } = patchPage(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.delete(P("/pages/:id"), guard(({ request, params }) => {
    const { data, etag } = deletePage(getMockDb(), param(params, "id"), searchOf(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/pages/:id/restore"), guard(({ request, params }) => {
    const { data, etag } = restorePage(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/pages/:id/set-home"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => ({ status: 200, ...setHome(getMockDb(), param(params, "id"), body, request.headers.get("If-Match")) }));
  })),
  http.get(P("/pages/:id/references"), guard(({ params }) => ok(getReferences(getMockDb(), param(params, "id"))))),
  http.get(P("/pages/:id/sections"), guard(({ request, params }) => {
    const { data, etag } = listSections(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { etag });
  })),
  http.get(P("/pages/:id/sections/:sectionId"), guard(({ params }) => {
    const { data, etag } = getSection(getMockDb(), param(params, "id"), param(params, "sectionId"));
    return ok(data, { etag });
  })),
  http.patch(P("/pages/:id/sections/:sectionId"), guard(async ({ request, params }) => {
    const { data, etag } = patchSection(getMockDb(), param(params, "id"), param(params, "sectionId"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/pages/:id/sections"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => ({ status: 201, ...createSection(getMockDb(), param(params, "id"), body, request.headers.get("If-Match")) }));
  })),
  http.put(P("/pages/:id/sections/order"), guard(async ({ request, params }) => {
    const { data, etag } = reorderSections(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.delete(P("/pages/:id/sections/:sectionId"), guard(({ request, params }) => {
    const { data, etag } = deleteSection(getMockDb(), param(params, "id"), param(params, "sectionId"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/pages/:id/publish"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => ({ status: 200, ...publishPage(getMockDb(), param(params, "id"), searchOf(request), body, request.headers.get("If-Match")) }));
  })),
  http.post(P("/pages/:id/unpublish"), guard(({ request, params }) =>
    idempotent(request, params, () => ({ status: 200, ...unpublishPage(getMockDb(), param(params, "id"), searchOf(request), request.headers.get("If-Match")) }))
  )),
  http.post(P("/pages/:id/discard-draft"), guard(({ request, params }) => {
    const { data, etag } = discardDraft(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.get(P("/pages/:id/revisions"), guard(({ request, params }) => {
    const { data, meta } = listPageRevisions(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { meta });
  })),
  http.get(P("/pages/:id/revisions/:revId"), guard(({ params }) => ok(getPageRevision(getMockDb(), param(params, "id"), param(params, "revId"))))),
  http.post(P("/pages/:id/revisions/:revId/restore"), guard(async ({ request, params }) => {
    const { data, etag } = restorePageRevision(getMockDb(), param(params, "id"), param(params, "revId"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
];

// Posts, their publish engine and revisions (T1.5.5; 05 section 13.3). `slug-check` is registered BEFORE `:id` or the id
// route would swallow it (05 13.3.4). `Idempotency-Key` is honoured on create, publish and unpublish.
const postHandlers: HttpHandler[] = [
  http.get(P("/posts"), guard(({ request }) => {
    const { data, meta } = listPosts(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
  http.post(P("/posts"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => {
      const done = createPost(getMockDb(), body);
      return { status: 201, ...done, location: `/api/v1/posts/${(done.data as { id: number }).id}` };
    });
  })),
  http.get(P("/posts/slug-check"), guard(({ request }) => ok(checkPostSlug(getMockDb(), searchOf(request))))),
  http.get(P("/posts/:id"), guard(({ request, params }) => {
    const { data, etag } = getPost(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { etag });
  })),
  http.patch(P("/posts/:id"), guard(async ({ request, params }) => {
    const { data, etag } = patchPost(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.delete(P("/posts/:id"), guard(({ request, params }) => {
    const { data, etag } = deletePost(getMockDb(), param(params, "id"), searchOf(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/posts/:id/restore"), guard(({ request, params }) => {
    const { data, etag } = restorePost(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.put(P("/posts/:id/media"), guard(async ({ request, params }) => {
    const { data, etag } = replacePostMedia(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/posts/:id/publish"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, params, () => ({ status: 200, ...publishPost(getMockDb(), param(params, "id"), searchOf(request), body, request.headers.get("If-Match")) }));
  })),
  http.post(P("/posts/:id/unpublish"), guard(({ request, params }) =>
    idempotent(request, params, () => ({ status: 200, ...unpublishPost(getMockDb(), param(params, "id"), searchOf(request), request.headers.get("If-Match")) }))
  )),
  http.post(P("/posts/:id/discard-draft"), guard(({ request, params }) => {
    const { data, etag } = discardPostDraft(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.get(P("/posts/:id/revisions"), guard(({ request, params }) => {
    const { data, meta } = listPostRevisions(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { meta });
  })),
  http.get(P("/posts/:id/revisions/:revId"), guard(({ params }) => ok(getPostRevision(getMockDb(), param(params, "id"), param(params, "revId"))))),
  http.post(P("/posts/:id/revisions/:revId/restore"), guard(async ({ request, params }) => {
    const { data, etag } = restorePostRevision(getMockDb(), param(params, "id"), param(params, "revId"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
];

// Albums and FAQ groups (T1.5.6; 05 sections 13.4, 13.5): CRUD, their items, the publish engine and the revisions. Registered BEFORE the
// picker lookups below (`GET /albums`, `/faq-groups`, `/albums/:id/items` of the schema form), which they replace. `items/order` is a PUT,
// `items/:itemId` a PATCH / DELETE: no clash. `Idempotency-Key` is honoured on create, add items, publish and unpublish.
function itemCollectionHandlers(
  base: string,
  fns: {
    list: (db: ReturnType<typeof getMockDb>, params: URLSearchParams) => { data: unknown; meta: unknown };
    create: (db: ReturnType<typeof getMockDb>, body: unknown) => { data: unknown; etag: string };
    get: (db: ReturnType<typeof getMockDb>, id: string) => { data: unknown; etag: string };
    patch: (db: ReturnType<typeof getMockDb>, id: string, body: unknown, ifMatch: string | null) => { data: unknown; etag: string };
    remove: (db: ReturnType<typeof getMockDb>, id: string, params: URLSearchParams, ifMatch: string | null) => { data: unknown; etag: string };
    restore: (db: ReturnType<typeof getMockDb>, id: string, ifMatch: string | null) => { data: unknown; etag: string };
    items: (db: ReturnType<typeof getMockDb>, id: string) => { data: unknown; etag: string };
    createItem: (db: ReturnType<typeof getMockDb>, id: string, body: unknown, ifMatch: string | null) => { data: unknown; etag: string };
    patchItem: (db: ReturnType<typeof getMockDb>, id: string, itemId: string, body: unknown, ifMatch: string | null) => { data: unknown; etag: string };
    removeItem: (db: ReturnType<typeof getMockDb>, id: string, itemId: string, ifMatch: string | null) => { data: unknown; etag: string };
    reorder: (db: ReturnType<typeof getMockDb>, id: string, body: unknown, ifMatch: string | null) => { data: unknown; etag: string };
    publish: (db: ReturnType<typeof getMockDb>, id: string, params: URLSearchParams, body: unknown, ifMatch: string | null) => { data: unknown; etag: string | undefined };
    unpublish: (db: ReturnType<typeof getMockDb>, id: string, params: URLSearchParams, ifMatch: string | null) => { data: unknown; etag: string | undefined };
    discard: (db: ReturnType<typeof getMockDb>, id: string, ifMatch: string | null) => { data: unknown; etag: string };
    revisions: (db: ReturnType<typeof getMockDb>, id: string, params: URLSearchParams) => { data: unknown; meta: unknown };
    revision: (db: ReturnType<typeof getMockDb>, id: string, revId: string) => unknown;
    restoreRevision: (db: ReturnType<typeof getMockDb>, id: string, revId: string, body: unknown, ifMatch: string | null) => { data: unknown; etag: string };
  }
): HttpHandler[] {
  const db = getMockDb;
  return [
    http.get(P(base), guard(({ request }) => {
      const { data, meta } = fns.list(db(), searchOf(request));
      return ok(data, { meta });
    })),
    http.post(P(base), guard(async ({ request, params }) => {
      const body = await jsonBody(request);
      return idempotent(request, params, () => {
        const done = fns.create(db(), body);
        return { status: 201, ...done, location: `/api/v1${base}/${(done.data as { id: number }).id}` };
      });
    })),
    http.get(P(`${base}/:id`), guard(({ params }) => {
      const { data, etag } = fns.get(db(), param(params, "id"));
      return ok(data, { etag });
    })),
    http.patch(P(`${base}/:id`), guard(async ({ request, params }) => {
      const { data, etag } = fns.patch(db(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.delete(P(`${base}/:id`), guard(({ request, params }) => {
      const { data, etag } = fns.remove(db(), param(params, "id"), searchOf(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.post(P(`${base}/:id/restore`), guard(({ request, params }) => {
      const { data, etag } = fns.restore(db(), param(params, "id"), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.get(P(`${base}/:id/items`), guard(({ params }) => {
      const { data, etag } = fns.items(db(), param(params, "id"));
      return ok(data, { etag });
    })),
    http.post(P(`${base}/:id/items`), guard(async ({ request, params }) => {
      const body = await jsonBody(request);
      return idempotent(request, params, () => ({ status: 201, ...fns.createItem(db(), param(params, "id"), body, request.headers.get("If-Match")) }));
    })),
    http.put(P(`${base}/:id/items/order`), guard(async ({ request, params }) => {
      const { data, etag } = fns.reorder(db(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.patch(P(`${base}/:id/items/:itemId`), guard(async ({ request, params }) => {
      const { data, etag } = fns.patchItem(db(), param(params, "id"), param(params, "itemId"), await jsonBody(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.delete(P(`${base}/:id/items/:itemId`), guard(({ request, params }) => {
      const { data, etag } = fns.removeItem(db(), param(params, "id"), param(params, "itemId"), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.post(P(`${base}/:id/publish`), guard(async ({ request, params }) => {
      const body = await jsonBody(request);
      return idempotent(request, params, () => ({ status: 200, ...fns.publish(db(), param(params, "id"), searchOf(request), body, request.headers.get("If-Match")) }));
    })),
    http.post(P(`${base}/:id/unpublish`), guard(({ request, params }) =>
      idempotent(request, params, () => ({ status: 200, ...fns.unpublish(db(), param(params, "id"), searchOf(request), request.headers.get("If-Match")) }))
    )),
    http.post(P(`${base}/:id/discard-draft`), guard(({ request, params }) => {
      const { data, etag } = fns.discard(db(), param(params, "id"), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.get(P(`${base}/:id/revisions`), guard(({ request, params }) => {
      const { data, meta } = fns.revisions(db(), param(params, "id"), searchOf(request));
      return ok(data, { meta });
    })),
    http.get(P(`${base}/:id/revisions/:revId`), guard(({ params }) => ok(fns.revision(db(), param(params, "id"), param(params, "revId"))))),
    http.post(P(`${base}/:id/revisions/:revId/restore`), guard(async ({ request, params }) => {
      const { data, etag } = fns.restoreRevision(db(), param(params, "id"), param(params, "revId"), await jsonBody(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
  ];
}

const albumHandlers: HttpHandler[] = itemCollectionHandlers("/albums", {
  list: listAlbums,
  create: createAlbum,
  get: getAlbum,
  patch: patchAlbum,
  remove: deleteAlbum,
  restore: restoreAlbum,
  items: listAlbumItemRows,
  createItem: createAlbumItems,
  patchItem: patchAlbumItem,
  removeItem: deleteAlbumItem,
  reorder: reorderAlbumItems,
  publish: publishAlbum,
  unpublish: unpublishAlbum,
  discard: discardAlbumDraft,
  revisions: listAlbumRevisions,
  revision: getAlbumRevision,
  restoreRevision: restoreAlbumRevision,
});

const faqHandlers: HttpHandler[] = itemCollectionHandlers("/faq-groups", {
  list: listFaqGroups,
  create: createFaqGroup,
  get: getFaqGroup,
  patch: patchFaqGroup,
  remove: deleteFaqGroup,
  restore: restoreFaqGroup,
  items: listFaqItems,
  createItem: createFaqItem,
  patchItem: patchFaqItem,
  removeItem: deleteFaqItem,
  reorder: reorderFaqItems,
  publish: publishFaqGroup,
  unpublish: unpublishFaqGroup,
  discard: discardFaqGroupDraft,
  revisions: listFaqRevisions,
  revision: getFaqRevision,
  restoreRevision: restoreFaqRevision,
});

// Preview links (T1.4.4, doc/05 12.9; posts 13.3.8). The creation answer carries the raw token in `url` and must not be cached.
const previewLinkHandlers: HttpHandler[] = [
  http.post(P("/pages/:id/preview-links"), guard(async ({ request, params }) => {
    const link = createPreviewLink(getMockDb(), param(params, "id"), await jsonBody(request));
    return HttpResponse.json({ success: true, data: link }, { status: 201, headers: { "Cache-Control": "no-store" } });
  })),
  http.get(P("/pages/:id/preview-links"), guard(({ request, params }) => {
    const { data, meta } = listPreviewLinks(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { meta });
  })),
  http.post(P("/posts/:id/preview-links"), guard(async ({ request, params }) => {
    const link = createPreviewLink(getMockDb(), param(params, "id"), await jsonBody(request), "posts");
    return HttpResponse.json({ success: true, data: link }, { status: 201, headers: { "Cache-Control": "no-store" } });
  })),
  http.get(P("/posts/:id/preview-links"), guard(({ request, params }) => {
    const { data, meta } = listPreviewLinks(getMockDb(), param(params, "id"), searchOf(request), "posts");
    return ok(data, { meta });
  })),
  http.delete(P("/preview-links/:id"), guard(({ params }) => ok(revokePreviewLink(getMockDb(), param(params, "id"))))),
];

// The registry of section types and the picker lookups of a section's props (T1.4.8).
const cmsLookupHandlers: HttpHandler[] = [
  http.get(P("/section-types"), guard(({ request }) => ok(listSectionTypes(getMockDb(), searchOf(request))))),
  http.get(P("/section-types/:key"), guard(({ params }) => ok(getSectionType(param(params, "key"))))),
  ...(["albums", "faq-groups"] as const).map((kind) =>
    http.get(P(`/${kind}`), guard(({ request }) => {
      const { data, meta } = listLookup(getMockDb(), kind, searchOf(request));
      return ok(data, { meta });
    }))
  ),
  http.get(P("/albums/:id/items"), guard(({ params }) => ok(listAlbumItems(getMockDb(), param(params, "id"))))),
];

const settingsHandlers: HttpHandler[] = [
  http.get(P("/settings"), guard(() => ok(listSettingsGroups(getMockDb())))),
  http.get(P("/settings/:group"), guard(({ params }) => {
    const { data, etag } = getSettingsGroup(getMockDb(), param(params, "group"));
    return ok(data, { etag });
  })),
  http.put(P("/settings/:group"), guard(async ({ request, params }) => {
    const { data, etag } = putSettingsGroup(getMockDb(), param(params, "group"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
];

const uiStringHandlers: HttpHandler[] = [
  http.get(P("/ui-strings"), guard(({ request }) => {
    const { data, meta } = listUiStrings(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
  http.post(P("/ui-strings/bundle-sync"), guard(async ({ request }) => ok(bundleSync(getMockDb(), searchOf(request), await jsonBody(request))))),
  http.put(P("/ui-strings/:key/:locale"), guard(async ({ request, params }) => {
    const { data, etag } = putUiString(getMockDb(), param(params, "key"), param(params, "locale"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.delete(P("/ui-strings/:key/:locale"), guard(({ request, params }) =>
    ok(deleteUiString(getMockDb(), param(params, "key"), param(params, "locale"), request.headers.get("If-Match")))
  )),
];

function taxonomyHandlers(kind: "categories" | "tags"): HttpHandler[] {
  const base = `/${kind}`;
  return [
    http.get(P(base), guard(({ request }) => {
      const { data, meta } = listTaxonomy(getMockDb(), kind, searchOf(request));
      return ok(data, { meta });
    })),
    http.post(P(base), guard(async ({ request }) => {
      const { data, etag } = createTaxonomy(getMockDb(), kind, await jsonBody(request));
      return ok(data, { status: 201, etag });
    })),
    http.get(P(`${base}/:id`), guard(({ params }) => {
      const { data, etag } = getTaxonomyRow(getMockDb(), kind, param(params, "id"));
      return ok(data, { etag });
    })),
    http.patch(P(`${base}/:id`), guard(async ({ request, params }) => {
      const { data, etag } = patchTaxonomy(getMockDb(), kind, param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
    http.delete(P(`${base}/:id`), guard(({ request, params }) => {
      deleteTaxonomy(getMockDb(), kind, param(params, "id"), request.headers.get("If-Match"));
      return ok(null);
    })),
    http.post(P(`${base}/:id/restore`), guard(({ request, params }) => {
      const { data, etag } = restoreTaxonomyRow(getMockDb(), kind, param(params, "id"), request.headers.get("If-Match"));
      return ok(data, { etag });
    })),
  ];
}

export const saveLiveApiHandlers: HttpHandler[] = [
  ...menuHandlers,
  ...pageHandlers,
  ...postHandlers,
  ...albumHandlers,
  ...faqHandlers,
  ...previewLinkHandlers,
  ...cmsLookupHandlers,
  ...settingsHandlers,
  ...uiStringHandlers,
  ...taxonomyHandlers("categories"),
  ...taxonomyHandlers("tags"),
];


// Everything above, for the browser mock and for tests that want the whole set.
export const mockApiHandlers: HttpHandler[] = [
  // T1.5.7 forms / submissions / dashboard: FIRST, so the real `GET /forms` answers before the older picker lookup.
  ...formsApiHandlers,
  ...mediaHandlers,
  ...saveLiveApiHandlers,
  ...revisionApiHandlers,
  ...systemApiHandlers,
  ...localeApiHandlers,
  ...auditApiHandlers,
];

export { mediaHandlers };
