"use client";

import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { CopyIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CustomPagination } from "@/components/global/custom-pagination";
import { DataTable } from "@/components/global/data-table";
import { EmptyMuted } from "@/components/global/empty";
import { BulkBar } from "@/components/global/list/bulk-bar";
import { FilterBar } from "@/components/global/list/filter-bar";
import { EmptyFiltered } from "@/components/global/states/empty-filtered";
import { ErrorState } from "@/components/global/states/error-state";
import { FetchingBar } from "@/components/global/states/fetching-bar";
import { NoPermission } from "@/components/layout/no-permission";
import { MediaFolderTree, NO_FOLDER } from "@/components/protected/media/media-folders";
import { MediaAssetSheet } from "@/components/protected/media/media-asset-sheet";
import { MediaUploadButton } from "@/components/protected/media/media-upload-dialog";
import { MediaThumb } from "@/components/protected/media/media-thumb";
import { useMediaView } from "@/components/protected/media/use-media-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useListParams } from "@/hooks/use-list-params";
import { useDefaultLocaleCode } from "@/hooks/use-locales";
import { useMediaAssets, useMediaFolders } from "@/hooks/use-media";
import { useCan } from "@/hooks/use-permission";
import { isNoPermissionError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import { LIST_LIMIT_OPTIONS, sortToSortingState, sortingStateToSort } from "@/lib/list-params";
import { MEDIA_KINDS, MEDIA_SORT_FIELDS, MEDIA_SORT_OPTIONS, formatBytes, isMissingAlt } from "@/lib/media";
import { cn } from "@/lib/utils";
import type { MediaAsset, MediaListQuery } from "@/types/media";

const ALL = "__all__";

// URL state of the library (doc/07 section 2.5.1): page / limit / keyword / sort + the filters below. `?asset=<id>`
// (the open detail sheet) is NOT part of it - it is added and removed next to these, see `useAssetParam`.
export const MEDIA_LIST_CONFIG = {
  filters: {
    kind: z.enum(MEDIA_KINDS).optional(),
    // A folder id or `root` (no folder); the API takes the same.
    folder_id: z.string().regex(/^(\d+|root)$/).optional(),
    unused: z.literal("true").optional(),
    missing_alt: z.literal("true").optional(),
    trashed: z.literal("true").optional(),
  },
  sortable: MEDIA_SORT_FIELDS,
  defaultSort: "-created_at",
  defaultLimit: 20,
} satisfies ListParamsConfig;

// `?asset=<id>`: the detail sheet. Opening / closing keeps the list's own params.
function useAssetParam() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = searchParams.get("asset");
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const set = (next: number | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === undefined) params.delete("asset");
    else params.set("asset", String(next));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [id, set] as const;
}

// SCR-35 (doc/07 section 3.22): the media library - folders on the left, keyword + filters on top, a grid or a
// table of the files, pagination, selection, upload (P2, `media.library:create`) and the detail sheet. A read that ends in 403 is `NoPermission`.
export function MediaLibrary() {
  const t = useTranslations("media");
  const tList = useTranslations("list");
  const format = useFormatter();
  const list = useListParams(MEDIA_LIST_CONFIG);
  const [assetId, setAssetId] = useAssetParam();
  const [view, setView] = useMediaView();
  const defaultLocale = useDefaultLocaleCode();
  const folders = useMediaFolders();

  const canCreate = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.CREATE);
  const canUpdate = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.UPDATE);
  // The trash needs `read` and `delete` (or `delete_own`): without it the API answers 403.
  const canSeeTrash = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, [PERMISSION_ACTIONS.DELETE, PERMISSION_ACTIONS.DELETE_OWN]);
  const canDeleteFolder = useCan(PERMISSION_KEYS.MEDIA_LIBRARY, PERMISSION_ACTIONS.DELETE);

  const { filters } = list.params;
  const query = useMemo<MediaListQuery>(() => {
    const q: MediaListQuery = { ...(list.query as MediaListQuery) };
    // A folder in the tree includes everything below it.
    if (filters.folder_id && filters.folder_id !== NO_FOLDER) q.include_subfolders = true;
    return q;
  }, [list.query, filters.folder_id]);
  // New files go to the folder being browsed (a numeric id), else to the root.
  const uploadFolderId = filters.folder_id && /^\d+$/.test(filters.folder_id) ? Number(filters.folder_id) : null;
  const { data, isLoading, isFetching, error, refetch } = useMediaAssets(query);
  const rows = useMemo(() => data?.data ?? [], [data]);

  // Selection belongs to the page of results it was made on: any change of query forgets it.
  const queryKey = JSON.stringify(query);
  const [selection, setSelection] = useState<{ key: string; rows: RowSelectionState }>({ key: queryKey, rows: {} });
  const rowSelection = selection.key === queryKey ? selection.rows : {};
  const setRowSelection = (next: RowSelectionState) => setSelection({ key: queryKey, rows: next });
  const selectedRows = rows.filter((r) => rowSelection[String(r.id)]);

  const copyNames = async () => {
    const text = selectedRows.map((r) => r.original_filename).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("bulk.copied", { count: selectedRows.length }));
    } catch {
      toast.error(t("bulk.copyFailed"));
    }
  };

  const trashed = filters.trashed === "true";
  // The trash switch alone is a view, not a filter: an empty trash says "empty", not "nothing matches".
  const filteredEmpty = list.activeFilterCount - (trashed ? 1 : 0) > 0;
  const hasError = error !== undefined && error !== null;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  const columns = useMemo<ColumnDef<MediaAsset>[]>(
    () => [
      {
        id: "original_filename",
        accessorKey: "original_filename",
        enableSorting: true,
        header: t("columns.name"),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setAssetId(row.original.id)}
            className="flex max-w-80 items-center gap-3 text-left outline-none focus-visible:underline"
            aria-label={t("tile.open", { name: row.original.original_filename })}
          >
            <span className="block size-12 shrink-0 overflow-hidden rounded border bg-muted">
              <MediaThumb asset={row.original} alt="" compact />
            </span>
            <span className="min-w-0 truncate font-medium">{row.original.original_filename}</span>
          </button>
        ),
      },
      {
        id: "kind",
        header: t("columns.kind"),
        cell: ({ row }) => <Badge variant="outline">{t.has(`kinds.${row.original.kind}`) ? t(`kinds.${row.original.kind}`) : row.original.kind}</Badge>,
      },
      { id: "bytes", accessorKey: "bytes", enableSorting: true, header: t("columns.size"), cell: ({ row }) => formatBytes(row.original.bytes) },
      {
        id: "dimensions",
        header: t("columns.dimensions"),
        cell: ({ row }) => (row.original.width && row.original.height ? `${row.original.width} × ${row.original.height}` : "—"),
      },
      {
        id: "usage_count",
        header: t("columns.usedIn"),
        cell: ({ row }) =>
          row.original.usage_count > 0 ? (
            <Badge variant="secondary">{t("tile.usedIn", { count: row.original.usage_count })}</Badge>
          ) : (
            <span className="text-muted-foreground">{t("tile.unused")}</span>
          ),
      },
      {
        id: "alt",
        header: t("columns.alt"),
        cell: ({ row }) =>
          isMissingAlt(row.original, defaultLocale) ? <Badge variant="outline">{t("tile.noAlt")}</Badge> : <span className="text-muted-foreground">—</span>,
      },
      {
        id: "updated_at",
        accessorKey: "updated_at",
        enableSorting: true,
        header: trashed ? t("columns.deleted") : t("columns.updated"),
        cell: ({ row }) => date((trashed ? row.original.deleted_at : row.original.updated_at) ?? row.original.updated_at),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, defaultLocale, trashed]
  );

  const sortValue = list.params.sort ?? "-created_at";

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside>
        <MediaFolderTree
          folders={folders.data?.data ?? []}
          isLoading={folders.isLoading}
          selected={filters.folder_id}
          onSelect={(value) => list.setFilters({ folder_id: value })}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDeleteFolder}
        />
      </aside>

      <div className="min-w-0 space-y-4">
        <FilterBar
          keyword={list.params.keyword}
          onKeywordSubmit={list.setKeyword}
          keywordPlaceholder={t("searchPlaceholder")}
          hasActiveFilters={list.hasActiveFilters}
          onClear={list.clearFilters}
          actions={
            <>
              <MediaUploadButton folderId={uploadFolderId} />
              <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(next) => next && setView(next as "grid" | "list")}
              aria-label={t("view.label")}
            >
              <ToggleGroupItem value="grid" aria-label={t("view.grid")}>
                <LayoutGridIcon />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label={t("view.list")}>
                <ListIcon />
              </ToggleGroupItem>
              </ToggleGroup>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Label className="sr-only" htmlFor="media-kind">
              {t("filters.kind")}
            </Label>
            <Select value={filters.kind ?? ALL} onValueChange={(v) => list.setFilters({ kind: v === ALL ? undefined : (v as (typeof MEDIA_KINDS)[number]) })}>
              <SelectTrigger id="media-kind" size="sm" className="w-40" aria-label={t("filters.kind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.kindAll")}</SelectItem>
                {MEDIA_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortValue} onValueChange={(v) => list.setSort(v)}>
              <SelectTrigger size="sm" className="w-44" aria-label={t("filters.sort")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIA_SORT_OPTIONS.map(([value, key]) => (
                  <SelectItem key={value} value={value}>
                    {t(`sort.${key}`)}
                  </SelectItem>
                ))}
                {/* an arbitrary sort from the URL (list view column) still has to show */}
                {MEDIA_SORT_OPTIONS.some(([v]) => v === sortValue) ? null : (
                  <SelectItem value={sortValue}>{sortValue}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <CheckFilter
            label={t("filters.unused")}
            checked={filters.unused === "true"}
            onChange={(checked) => list.setFilters({ unused: checked ? "true" : undefined })}
          />
          <CheckFilter
            label={t("filters.missingAlt")}
            checked={filters.missing_alt === "true"}
            onChange={(checked) => list.setFilters({ missing_alt: checked ? "true" : undefined })}
          />
          {canSeeTrash ? (
            <CheckFilter
              label={t("filters.trashed")}
              checked={trashed}
              onChange={(checked) => list.setFilters({ trashed: checked ? "true" : undefined })}
            />
          ) : null}
        </FilterBar>

        {selectedRows.length > 0 ? (
          <BulkBar count={selectedRows.length} onClear={() => setRowSelection({})}>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyNames()}>
              <CopyIcon />
              {t("bulk.copyNames")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("bulk.note")}</span>
          </BulkBar>
        ) : null}

        {hasError && isNoPermissionError(error) ? (
          <NoPermission />
        ) : hasError && rows.length === 0 ? (
          <ErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} />
        ) : (
          <div>
            <FetchingBar active={isFetching && !isLoading} />
            {view === "list" ? (
              <DataTable
                columns={columns}
                data={rows}
                getRowId={(row) => String(row.id)}
                isLoading={isLoading}
                skeletonRowCount={list.params.limit}
                emptyTitle={trashed ? t("empty.trashTitle") : t("empty.title")}
                emptyDescription={trashed ? undefined : t("empty.description")}
                emptyContent={filteredEmpty ? <EmptyFiltered onClear={list.clearFilters} /> : undefined}
                sorting={sortToSortingState(list.params.sort)}
                onSortingChange={(state) => list.setSort(sortingStateToSort(state))}
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
            ) : isLoading ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <li key={i}>
                    <Skeleton className="aspect-4/3 w-full" />
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              filteredEmpty ? (
                <EmptyFiltered onClear={list.clearFilters} />
              ) : (
                <EmptyMuted
                  title={trashed ? t("empty.trashTitle") : t("empty.title")}
                  description={trashed ? undefined : t("empty.description")}
                />
              )
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label={t("grid.label")}>
                {rows.map((asset) => (
                  <MediaTile
                    key={asset.id}
                    asset={asset}
                    selected={Boolean(rowSelection[String(asset.id)])}
                    defaultLocale={defaultLocale}
                    trashed={trashed}
                    onOpen={() => setAssetId(asset.id)}
                    onToggle={(checked) => setRowSelection({ ...rowSelection, [String(asset.id)]: checked })}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {data?.meta ? (
          <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {tList("total", { total: data.meta.total })}
            </p>
            <CustomPagination
              metaData={data.meta}
              onPageChange={list.setPage}
              isLoading={isFetching}
              rowLimit={list.params.limit}
              setRowLimit={list.setLimit}
            />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{tList("rowsPerPage")}</span>
              <Select value={String(list.params.limit)} onValueChange={(v) => list.setLimit(Number(v))}>
                <SelectTrigger size="sm" className="w-20" aria-label={tList("rowsPerPage")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIST_LIMIT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </div>

      {assetId !== undefined ? <MediaAssetSheet key={assetId} assetId={assetId} onClose={() => setAssetId(undefined)} /> : null}
    </div>
  );
}

function CheckFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function MediaTile({
  asset,
  selected,
  defaultLocale,
  trashed,
  onOpen,
  onToggle,
}: {
  asset: MediaAsset;
  selected: boolean;
  defaultLocale: string;
  trashed: boolean;
  onOpen: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("media.tile");
  const noAlt = isMissingAlt(asset, defaultLocale);
  return (
    <li className={cn("relative overflow-hidden rounded-md border bg-card", selected && "border-primary ring-2 ring-primary")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("open", { name: asset.original_filename })}
        className="block w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="block aspect-4/3 overflow-hidden bg-muted">
          <MediaThumb asset={asset} alt="" />
        </span>
        <span className="block truncate px-2 pt-1.5 text-sm font-medium" aria-hidden>
          {asset.original_filename}
        </span>
        <span className="flex flex-wrap items-center gap-1 px-2 pt-0.5 pb-2 text-xs text-muted-foreground" aria-hidden>
          <span>{formatBytes(asset.bytes)}</span>
          {asset.width && asset.height ? <span>· {asset.width}×{asset.height}</span> : null}
        </span>
      </button>
      <span className="flex flex-wrap gap-1 px-2 pb-2 empty:hidden">
        {trashed ? <Badge variant="destructive">{t("trashed")}</Badge> : null}
        {asset.usage_count === 0 ? <Badge variant="outline">{t("unused")}</Badge> : null}
        {noAlt ? <Badge variant="outline">{t("noAlt")}</Badge> : null}
        {asset.status !== "ready" ? <Badge variant="destructive">{asset.status}</Badge> : null}
      </span>
      <Checkbox
        checked={selected}
        onCheckedChange={(value) => onToggle(value === true)}
        aria-label={t("select", { name: asset.original_filename })}
        className="absolute top-2 left-2 bg-background"
      />
    </li>
  );
}
