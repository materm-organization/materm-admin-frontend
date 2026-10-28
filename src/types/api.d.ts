// Shared response envelope types (doc/05-api-spec.md section 1.3). Success
// responses are `{ success: true, data }`; errors are `{ success: false,
// message, code, errors?, details?, request_id? }` — clients decide on `code`
// (machine code), never on `message` (human text, shown only as a fallback).
export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
};

// One entry of `errors[]` (VALIDATION_FAILED / CONFLICT_DUPLICATE, section
// 1.5). `path` is a JSON Pointer (RFC 6901) inside `in` — `/new_password`,
// `/grants/3/actions/1`; `""` = the whole object. `code` is a field code
// (`required`, `too_short`, `password_policy.min_length`, ...).
export type ApiFieldError = {
  // "entity": a path inside a revision snapshot (a restore that refers to data that no longer exists).
  in: "body" | "query" | "path" | "header" | "entity";
  path: string;
  code: string;
  message?: string;
  params?: Record<string, string | number | boolean | string[]>;
};

export type ApiErrorResponse = {
  success: false;
  message?: string;
  code?: string;
  errors?: ApiFieldError[];
  details?: Record<string, unknown>;
  request_id?: string;
};

// The backend's list endpoints take `page`/`limit`/`keyword` as query params
// (internal/core/dto/response_dto.go's PaginationQuery) — `keyword`, not
// `search`.
export type ApiPaginationParams = {
  page?: number;
  limit?: number;
  keyword?: string;
};

// Pagination metadata is a SEPARATE `meta` object alongside a flat `data`
// array (pkg/response/success.go's NewPaginatedResponse) — not nested inside
// `data` the way a single-envelope-doubles-as-pagination convention would
// shape it. `TotalPage`'s JSON key is `total_page` (not `totalPages`).
export type ApiMeta = {
  total: number;
  page: number;
  limit: number;
  total_page: number;
};

export type ApiResponsePagination<T> = ApiResponse<T> & {
  meta: ApiMeta;
};
