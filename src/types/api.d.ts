// Shared response envelope types. Success responses are
// `{ success: true, data }`; errors use `message`, not a bare `error`
// string (see lib/axios.ts's error toast handling). Adjust to the real
// backend's wire shape.
export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  message: string;
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
