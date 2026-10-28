// MSW handlers over the in-memory model (`mock-db.ts` and the save-live modules): media library, menus, settings,
// UI strings, categories / tags, revisions, cache purge, plus the two reads those screens need next to them
// (languages, system status). Base-agnostic URL patterns (`*/api/v1/...`)
// so the same handlers serve the Vitest server (`http://localhost:3000/api/v1`) and the browser mock whatever
// `NEXT_PUBLIC_API_BASE_URL` is. Tests call `resetMockDb()` in `beforeEach`; a test that needs a special answer
// puts its own handler in front with `server.use(...)`.
import { http, HttpResponse, type HttpHandler } from "msw";

import { LOCALE_ROWS } from "@/components/schema-form/fixtures/lookup";
import { createMenuItem, deleteMenuItem, getMenu, listMenus, patchMenuItem, reorderMenuItems } from "@/mocks/mock-menus";
import {
  createPage,
  deletePage,
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

export const localeApiHandlers: HttpHandler[] = [http.get(P("/locales"), () => ok(LOCALE_ROWS))];

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
function idempotent(request: Request, params: Record<string, string | readonly string[] | undefined>, run: () => { status: number; data: unknown; etag?: string }) {
  const url = new URL(request.url);
  const fingerprint = `${request.method} ${url.pathname}${url.search} ${request.headers.get("If-Match") ?? ""}`;
  void params;
  const result = withIdempotency(getMockDb(), request.headers.get("Idempotency-Key"), fingerprint, run);
  const headers: Record<string, string> = {};
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
  ...settingsHandlers,
  ...uiStringHandlers,
  ...taxonomyHandlers("categories"),
  ...taxonomyHandlers("tags"),
];


// Everything above, for the browser mock and for tests that want the whole set.
export const mockApiHandlers: HttpHandler[] = [
  ...mediaHandlers,
  ...saveLiveApiHandlers,
  ...revisionApiHandlers,
  ...systemApiHandlers,
  ...localeApiHandlers,
];

export { mediaHandlers };
