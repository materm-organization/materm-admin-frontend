// URL <-> list state, pure (no React): the core of `useListParams` (hooks/use-list-params.ts). doc/07 sections
// 1.1 (9) and 2.5.1: page / limit / keyword / sort / the page's own filters live in the search params so a list
// can be shared and the back button works. Whatever does not validate is DROPPED (falls back to its default),
// so a hand-typed URL can never make the API answer 422 (`limit` outside 1..100 is a 422, not a clamp).
import type { SortingState } from "@tanstack/react-table";
import { z } from "zod";

import { DEFAULT_PAGE, DEFAULT_PAGE_LIMIT } from "@/lib/constants/pagination";

export const LIST_LIMIT_OPTIONS = [10, 20, 50, 100] as const;
export const MAX_LIST_LIMIT = 100;
export const MAX_KEYWORD_LENGTH = 100;
// Multi-value filters are sent comma separated, at most 10 values (doc/05 section 1.6).
export const MAX_FILTER_VALUES = 10;
const MAX_SORT_FIELDS = 3;
const SORT_FIELD = /^[a-z][a-z0-9_]*$/;

export type ListParamsConfig<F extends z.ZodRawShape = z.ZodRawShape> = {
  // The page's own filters: one zod schema per search-param key. Each value arrives as a string (or
  // undefined when absent) — use `z.coerce.number()`, `z.enum([...])`, or a `z.string().transform(split)` for
  // comma lists. Optional keys stay `undefined` when missing/invalid.
  filters?: F;
  // Sort allow-list (the endpoint's, doc/05 section 1.6). Empty/undefined = the page cannot sort and `sort`
  // is ignored.
  sortable?: readonly string[];
  // e.g. "-created_at"
  defaultSort?: string;
  defaultLimit?: number;
};

type FilterValues<F extends z.ZodRawShape> = z.infer<z.ZodObject<F>>;

export type ListParams<F extends z.ZodRawShape = z.ZodRawShape> = {
  page: number;
  limit: number;
  keyword: string;
  sort: string | undefined;
  filters: FilterValues<F>;
};

type SearchParamsLike = { get(name: string): string | null };

function defaultLimitOf(config: ListParamsConfig<z.ZodRawShape>): number {
  const limit = config.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIST_LIMIT ? limit : DEFAULT_PAGE_LIMIT;
}

// "-created_at,name" validated against the allow-list; returns undefined when nothing valid remains.
export function sanitizeSort(
  value: string | null | undefined,
  sortable: readonly string[] | undefined
): string | undefined {
  if (!value || !sortable || sortable.length === 0) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_SORT_FIELDS) return undefined;
  const seen = new Set<string>();
  for (const part of parts) {
    const field = part.startsWith("-") ? part.slice(1) : part;
    if (!SORT_FIELD.test(field) || !sortable.includes(field) || seen.has(field)) return undefined;
    seen.add(field);
  }
  return parts.join(",");
}

function parsePositiveInt(value: string | null): number | undefined {
  if (value === null || !/^\d{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 ? n : undefined;
}

export function parseListParams<F extends z.ZodRawShape>(
  config: ListParamsConfig<F>,
  searchParams: SearchParamsLike
): ListParams<F> {
  const defaultLimit = defaultLimitOf(config);
  const page = parsePositiveInt(searchParams.get("page")) ?? DEFAULT_PAGE;
  const rawLimit = parsePositiveInt(searchParams.get("limit"));
  const limit = rawLimit !== undefined && rawLimit <= MAX_LIST_LIMIT ? rawLimit : defaultLimit;
  const rawKeyword = (searchParams.get("keyword") ?? "").trim();
  const keyword = rawKeyword.length <= MAX_KEYWORD_LENGTH ? rawKeyword : "";
  const sort =
    sanitizeSort(searchParams.get("sort"), config.sortable) ??
    sanitizeSort(config.defaultSort, config.sortable);

  const filters: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(config.filters ?? {})) {
    const raw = searchParams.get(key);
    let parsed = raw === null ? undefined : (schema as z.ZodTypeAny).safeParse(raw);
    // Absent or invalid: fall back to the schema's own default (or undefined for an optional filter).
    if (!parsed?.success) parsed = (schema as z.ZodTypeAny).safeParse(undefined);
    if (parsed.success && parsed.data !== undefined) filters[key] = parsed.data;
  }

  return { page, limit, keyword, sort, filters: filters as FilterValues<F> };
}

function filterToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const joined = value
      .filter((v) => v !== undefined && v !== null && v !== "")
      .slice(0, MAX_FILTER_VALUES)
      .map(String)
      .join(",");
    return joined || undefined;
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// Canonical query string for the URL: defaults are omitted (`?page=1` never appears), key order is stable.
export function serializeListParams<F extends z.ZodRawShape>(
  config: ListParamsConfig<F>,
  params: ListParams<F>
): URLSearchParams {
  const out = new URLSearchParams();
  const defaults = parseListParams(config, new URLSearchParams());
  if (params.page !== DEFAULT_PAGE) out.set("page", String(params.page));
  if (params.limit !== defaults.limit) out.set("limit", String(params.limit));
  if (params.keyword) out.set("keyword", params.keyword);
  if (params.sort && params.sort !== defaults.sort) out.set("sort", params.sort);
  for (const key of Object.keys(config.filters ?? {})) {
    const value = filterToString((params.filters as Record<string, unknown>)[key]);
    const defaultValue = filterToString((defaults.filters as Record<string, unknown>)[key]);
    if (value !== undefined && value !== defaultValue) out.set(key, value);
  }
  return out;
}

// The object an API list service takes (and the React Query key part): no `undefined`, no empty keyword,
// `sort` only when set, filters flattened (arrays comma-joined).
export type ApiListQuery = {
  page: number;
  limit: number;
  keyword?: string;
  sort?: string;
  [filter: string]: string | number | undefined;
};

export function toApiQuery<F extends z.ZodRawShape>(params: ListParams<F>): ApiListQuery {
  const query: ApiListQuery = { page: params.page, limit: params.limit };
  if (params.keyword) query.keyword = params.keyword;
  if (params.sort) query.sort = params.sort;
  for (const [key, value] of Object.entries(params.filters as Record<string, unknown>)) {
    const asString = filterToString(value);
    if (asString !== undefined) query[key] = typeof value === "number" ? value : asString;
  }
  return query;
}

// Number of active filters (keyword counts; page/limit/sort do not) — drives "Clear filters" and the
// empty-vs-filtered-empty state.
export function countActiveFilters<F extends z.ZodRawShape>(
  config: ListParamsConfig<F>,
  params: ListParams<F>
): number {
  const defaults = parseListParams(config, new URLSearchParams());
  let count = params.keyword ? 1 : 0;
  for (const key of Object.keys(config.filters ?? {})) {
    const value = filterToString((params.filters as Record<string, unknown>)[key]);
    if (value !== undefined && value !== filterToString((defaults.filters as Record<string, unknown>)[key])) {
      count += 1;
    }
  }
  return count;
}

// `sort` string <-> TanStack table `SortingState` (column id = sort field).
export function sortToSortingState(sort: string | undefined): SortingState {
  if (!sort) return [];
  return sort
    .split(",")
    .filter(Boolean)
    .map((part) => (part.startsWith("-") ? { id: part.slice(1), desc: true } : { id: part, desc: false }));
}

export function sortingStateToSort(state: SortingState): string | undefined {
  if (state.length === 0) return undefined;
  return state.map((s) => (s.desc ? `-${s.id}` : s.id)).join(",");
}
