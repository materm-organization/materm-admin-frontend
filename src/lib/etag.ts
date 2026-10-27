// Optimistic locking plumbing (doc/05 section 1.12, doc/07 section 2.5.6).
//  - READ: a service for a resource that carries a lock returns `{ data, etag }` built by `withEtag(response)`
//    (the `ETag` header is exposed by the backend's CORS config). Keep it in the query data of the GET.
//  - WRITE: PATCH / PUT / DELETE / status commands send `If-Match: <etag>` exactly as received (the value is
//    already quoted: `"7"` or `"2026-10-21T08:01:22.481903Z"` — never re-quote or strip it). Spread
//    `ifMatch(etag)` into the axios request config. `required: true` is for the endpoints where the server
//    answers 428 without it (`PUT /roles/{id}/permissions`, `PATCH /roles/{id}`, publishable cms/forms roots):
//    a missing ETag then throws a client error instead of sending a request that is certain to fail.
//  - A response that returns the resource carries a NEW etag: put `{ data, etag }` into the cache with
//    `queryClient.setQueryData` (no refetch).
//  - 409 `CONFLICT_LOCK_VERSION` / 412: see `isConflictError` (lib/api-error.ts) and `ConflictDialog`.
import type { AxiosRequestConfig, AxiosResponse } from "axios";

export type WithEtag<T> = {
  data: T;
  // `undefined` when the response has no (or an empty) ETag header.
  etag: string | undefined;
};

export const IF_MATCH_HEADER = "If-Match";

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const target = name.toLowerCase();
  // AxiosHeaders has `get`, plain objects are keyed by lower-cased names; accept both (and any casing).
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, name);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === target && typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

// `response.data` is the API envelope (`ApiResponse<…>`); it is kept untouched next to the etag.
export function withEtag<T>(response: Pick<AxiosResponse<T>, "data" | "headers">): WithEtag<T> {
  return { data: response.data, etag: readHeader(response.headers, "etag") };
}

// Thrown by `ifMatch(etag, { required: true })` when the caller has no ETag to send.
export class MissingEtagError extends Error {
  constructor() {
    super("Missing ETag: load the resource with withEtag() before writing it");
    this.name = "MissingEtagError";
  }
}

// The `If-Match` header as a plain record, to COMBINE with other headers:
//   axiosInstance.put(url, body, { headers: { ...ifMatchHeaders(etag, { required: true }), ...idempotencyKeyHeaders(key) } })
// Without an etag and without `required` it is `{}` (the server decides: iam `PATCH /users/{id}` accepts no
// header, cms roots answer 428).
export function ifMatchHeaders(
  etag: string | null | undefined,
  options: { required?: boolean } = {}
): Record<string, string> {
  if (!etag) {
    if (options.required) throw new MissingEtagError();
    return {};
  }
  return { [IF_MATCH_HEADER]: etag };
}

// The same as an axios request config, when `If-Match` is the only extra header:
//   axiosInstance.patch(url, body, ifMatch(etag))
export function ifMatch(
  etag: string | null | undefined,
  options: { required?: boolean } = {}
): Pick<AxiosRequestConfig, "headers"> {
  const headers = ifMatchHeaders(etag, options);
  return Object.keys(headers).length > 0 ? { headers } : {};
}
