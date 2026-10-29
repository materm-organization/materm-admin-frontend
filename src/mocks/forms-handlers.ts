// MSW handlers of the forms, submissions and dashboard models (T1.5.7). They are put IN FRONT of the older lookup handler of
// `GET /forms` (the schema form's form picker, `mock-cms-lookups.ts`): MSW answers with the first handler that matches, and the
// picker only needs `slug` and `name`, which the real list has. Base-agnostic URL patterns like `handlers.ts`.
//
// ORDER MATTERS: the fixed submissions paths (`summary`, `export`, `bulk-status`) are registered before `/submissions/:id`.
import { http, HttpResponse, type HttpHandler } from "msw";

import { dashboardFails, dashboardSummary } from "@/mocks/mock-dashboard";
import {
  discardFormDraft,
  getForm,
  getFormRevision,
  listFormRevisions,
  listForms,
  patchForm,
  publishForm,
  replaceRecipients,
  restoreFormRevision,
  unpublishForm,
} from "@/mocks/mock-forms";
import { getMockDb } from "@/mocks/mock-db";
import { MockHttpError, fail } from "@/mocks/mock-core";
import { withIdempotency } from "@/mocks/mock-pages";
import {
  addSubmissionNote,
  bulkSubmissionStatus,
  exportSubmissions,
  getSubmission,
  listSubmissions,
  setSubmissionStatus,
  submissionsSummary,
} from "@/mocks/mock-submissions";

const P = (path: string) => `*/api/v1${path}`;
type Params = Record<string, string | readonly string[] | undefined>;
const ok = (data: unknown, init: { status?: number; etag?: string; meta?: unknown; headers?: Record<string, string> } = {}) =>
  HttpResponse.json(
    { success: true, data, ...(init.meta ? { meta: init.meta } : {}) },
    { status: init.status ?? 200, headers: { ...(init.etag ? { ETag: init.etag } : {}), ...init.headers } }
  );

function guard<A extends { request: Request; params: Params }>(resolver: (args: A) => Response | Promise<Response>) {
  return async (args: A) => {
    try {
      return await resolver(args);
    } catch (error) {
      if (error instanceof MockHttpError) return HttpResponse.json(error.body, { status: error.status, headers: error.headers });
      throw error;
    }
  };
}

const param = (params: Params, name: string) => String(params[name]);
const searchOf = (request: Request) => new URL(request.url).searchParams;
const jsonBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text ? JSON.parse(text) : undefined;
};

// `Idempotency-Key` on publish / unpublish (05 12.7): the same key + request replays the stored answer.
function idempotent(request: Request, run: () => { data: unknown; etag?: string }) {
  const url = new URL(request.url);
  const fingerprint = `${request.method} ${url.pathname}${url.search} ${request.headers.get("If-Match") ?? ""}`;
  const result = withIdempotency(getMockDb(), request.headers.get("Idempotency-Key"), fingerprint, () => ({ status: 200, ...run() }));
  const headers: Record<string, string> = {};
  if (result.etag) headers.ETag = result.etag;
  if (result.replayed) headers["Idempotent-Replayed"] = "true";
  return HttpResponse.json({ success: true, data: result.data }, { status: result.status, headers });
}

const formHandlers: HttpHandler[] = [
  http.get(P("/forms"), guard(({ request }) => {
    const { data, meta } = listForms(getMockDb(), searchOf(request));
    return ok(data, { meta });
  })),
  http.get(P("/forms/:id"), guard(({ params }) => {
    const { data, etag } = getForm(getMockDb(), param(params, "id"));
    return ok(data, { etag });
  })),
  http.patch(P("/forms/:id"), guard(async ({ request, params }) => {
    const { data, etag } = patchForm(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.put(P("/forms/:id/recipients"), guard(async ({ request, params }) => {
    const { data, etag } = replaceRecipients(getMockDb(), param(params, "id"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.post(P("/forms/:id/publish"), guard(async ({ request, params }) => {
    const body = await jsonBody(request);
    return idempotent(request, () => publishForm(getMockDb(), param(params, "id"), searchOf(request), body, request.headers.get("If-Match")));
  })),
  http.post(P("/forms/:id/unpublish"), guard(({ request, params }) =>
    idempotent(request, () => unpublishForm(getMockDb(), param(params, "id"), searchOf(request), request.headers.get("If-Match")))
  )),
  http.post(P("/forms/:id/discard-draft"), guard(({ request, params }) => {
    const { data, etag } = discardFormDraft(getMockDb(), param(params, "id"), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
  http.get(P("/forms/:id/revisions"), guard(({ request, params }) => {
    const { data, meta } = listFormRevisions(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { meta });
  })),
  http.get(P("/forms/:id/revisions/:revId"), guard(({ params }) => ok(getFormRevision(getMockDb(), param(params, "id"), param(params, "revId"))))),
  http.post(P("/forms/:id/revisions/:revId/restore"), guard(async ({ request, params }) => {
    const { data, etag } = restoreFormRevision(getMockDb(), param(params, "id"), param(params, "revId"), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag });
  })),
];

// Personal data: nothing may keep an answer (`Cache-Control: no-store`, 05 13.7).
const NO_STORE = { "Cache-Control": "no-store" };

const submissionHandlers: HttpHandler[] = [
  http.get(P("/submissions"), guard(({ request }) => {
    const { data, meta } = listSubmissions(getMockDb(), searchOf(request));
    return ok(data, { meta, headers: NO_STORE });
  })),
  http.get(P("/submissions/summary"), guard(() => ok(submissionsSummary(getMockDb()), { headers: { "Cache-Control": "private, max-age=15" } }))),
  http.get(P("/submissions/export"), guard(({ request }) => {
    const { csv, filename } = exportSubmissions(getMockDb(), searchOf(request));
    return new HttpResponse(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, ...NO_STORE },
    });
  })),
  http.post(P("/submissions/bulk-status"), guard(async ({ request }) => ok(bulkSubmissionStatus(getMockDb(), await jsonBody(request)), { headers: NO_STORE }))),
  http.get(P("/submissions/:id"), guard(({ request, params }) => {
    const { data, etag } = getSubmission(getMockDb(), param(params, "id"), searchOf(request));
    return ok(data, { etag, headers: NO_STORE });
  })),
  http.patch(P("/submissions/:id"), guard(async ({ request, params }) => {
    const { data, etag } = setSubmissionStatus(getMockDb(), param(params, "id"), searchOf(request), await jsonBody(request), request.headers.get("If-Match"));
    return ok(data, { etag, headers: NO_STORE });
  })),
  http.post(P("/submissions/:id/notes"), guard(async ({ request, params }) => {
    const { data, location } = addSubmissionNote(getMockDb(), param(params, "id"), searchOf(request), await jsonBody(request));
    return ok(data, { status: 201, headers: { ...NO_STORE, Location: location } });
  })),
];

const dashboardHandlers: HttpHandler[] = [
  http.get(P("/dashboard/summary"), guard(() => {
    const db = getMockDb();
    if (dashboardFails(db)) throw fail(500, "INTERNAL_ERROR", "An internal error occurred.");
    return ok(dashboardSummary(db), { headers: { "Cache-Control": "private, max-age=30" } });
  })),
];

export const formsApiHandlers: HttpHandler[] = [...formHandlers, ...submissionHandlers, ...dashboardHandlers];
