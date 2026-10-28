// MSW handlers over the in-memory model (`mock-db.ts`): media library, revisions, cache purge, plus the two
// reads those screens need next to them (languages, system status). Base-agnostic URL patterns (`*/api/v1/...`)
// so the same handlers serve the Vitest server (`http://localhost:3000/api/v1`) and the browser mock whatever
// `NEXT_PUBLIC_API_BASE_URL` is. Tests call `resetMockDb()` in `beforeEach`; a test that needs a special answer
// puts its own handler in front with `server.use(...)`.
import { http, HttpResponse, type HttpHandler } from "msw";

import { LOCALE_ROWS } from "@/components/schema-form/fixtures/lookup";
import {
  MockHttpError,
  createFolder,
  deleteAsset,
  deleteFolder,
  getAsset,
  getEntity,
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
function revisionHandlers(resource: string, basePattern: string, idParam: string): HttpHandler[] {
  return [
    http.get(P(`${basePattern}/revisions`), guard(({ request, params }) => {
      const { data, meta } = listRevisions(getMockDb(), resource, param(params, idParam), searchOf(request));
      return ok(data, { meta });
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

// Single-entity reads that answer the current ETag (what `RevisionsTab` asks when its editor passes none).
function entityHandler(resource: string, basePattern: string, idParam: string): HttpHandler {
  return http.get(P(basePattern), guard(({ params }) => {
    const entity = getEntity(getMockDb(), resource, param(params, idParam));
    return ok(entity.body, { etag: entity.etag });
  }));
}

export const revisionApiHandlers: HttpHandler[] = [
  ...revisionHandlers("media/assets", "/media/assets/:id", "id"),
  ...revisionHandlers("menus", "/menus/:key", "key"),
  ...revisionHandlers("settings", "/settings/:group", "group"),
  ...revisionHandlers("ui-strings", "/ui-strings/:key", "key"),
  ...revisionHandlers("categories", "/categories/:id", "id"),
  ...revisionHandlers("tags", "/tags/:id", "id"),
  entityHandler("menus", "/menus/:key", "key"),
  entityHandler("settings", "/settings/:group", "group"),
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

// Everything above, for the browser mock and for tests that want the whole set.
export const mockApiHandlers: HttpHandler[] = [
  ...mediaHandlers,
  ...revisionApiHandlers,
  ...systemApiHandlers,
  ...localeApiHandlers,
];

export { mediaHandlers };
