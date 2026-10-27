"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FileDiffIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { z } from "zod";

import { ListPage } from "@/components/global/list/list-page";
import { AuditDetailSheet } from "@/components/protected/audit/audit-detail-sheet";
import { AuditFilters } from "@/components/protected/audit/audit-filters";
import { type AuditFilterValues, checkAuditRange, toAuditParams } from "@/components/protected/audit/audit-range";
import { Badge } from "@/components/ui/badge";
import { useAuditLogs } from "@/hooks/use-audit";
import { useListParams } from "@/hooks/use-list-params";
import type { ListParamsConfig } from "@/lib/list-params";
import type { AuditLogEntry } from "@/types/audit";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ENTITY_TYPE = z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/).max(64);

// URL state: the ONLY keys GET /audit-logs accepts, as search params (`?result=denied&action=iam.user.*`).
// There is no `keyword` (the box is hidden; a hand-typed `?keyword=` is dropped when the request is built).
// `from` / `to` are whole days (Asia/Vientiane); they become UTC bounds in `toAuditParams`.
const AUDIT_LIST_CONFIG = {
  filters: {
    actor_id: z.coerce.number().int().positive().optional(),
    actor_type: z.enum(["user", "api_key", "system", "public"]).optional(),
    action: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((v) => v.split(",").length <= 10)
      .optional(),
    result: z.enum(["success", "denied", "error"]).optional(),
    entity_type: ENTITY_TYPE.optional(),
    entity_id: z.coerce.number().int().positive().optional(),
    request_id: z.string().regex(/^[A-Za-z0-9._-]{8,64}$/).optional(),
    from: DAY.optional(),
    to: DAY.optional(),
  },
  sortable: ["occurred_at"],
  defaultSort: "-occurred_at",
} satisfies ListParamsConfig;

// SCR-11 (doc/07 section 3.6): filter form, table (newest first), detail drawer with the before/after diff.
export function AuditList() {
  const t = useTranslations("audit");
  const format = useFormatter();
  const list = useListParams(AUDIT_LIST_CONFIG);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const filters = list.params.filters as AuditFilterValues;
  const range = checkAuditRange(filters);
  const params = useMemo(() => toAuditParams({ ...list.query, ...filters }), [list.query, filters]);
  const { data, isLoading, isFetching, error, refetch } = useAuditLogs(params, range.ok);

  const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        id: "occurred_at",
        accessorKey: "occurred_at",
        header: t("columns.time"),
        enableSorting: true,
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left underline-offset-4 hover:underline"
            onClick={() => setSelected(row.original)}
            title={row.original.occurred_at}
          >
            {format.dateTime(new Date(row.original.occurred_at), { dateStyle: "medium", timeStyle: "medium" })}
          </button>
        ),
      },
      {
        id: "actor",
        header: t("columns.actor"),
        cell: ({ row }) => (
          <span>
            {row.original.actor_name ?? "—"}{" "}
            <span className="text-xs text-muted-foreground">({t(`actorTypes.${row.original.actor_type}`)})</span>
          </span>
        ),
      },
      {
        id: "action",
        accessorKey: "action",
        header: t("columns.action"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
      },
      {
        id: "result",
        accessorKey: "result",
        header: t("columns.result"),
        cell: ({ row }) => (
          <Badge variant={row.original.result === "success" ? "secondary" : "destructive"}>
            {t(`results.${row.original.result}`)}
          </Badge>
        ),
      },
      {
        id: "entity",
        header: t("columns.entity"),
        cell: ({ row }) =>
          row.original.entity_type ? (
            <span className="font-mono text-xs">
              {row.original.entity_type}
              {row.original.entity_id !== null ? `#${row.original.entity_id}` : ""}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "summary",
        accessorKey: "summary",
        header: t("columns.summary"),
        cell: ({ row }) => <span className="line-clamp-2 max-w-xs">{row.original.summary ?? "—"}</span>,
      },
      { id: "ip", accessorKey: "ip", header: t("columns.ip"), cell: ({ row }) => row.original.ip ?? "—" },
      {
        id: "changes",
        header: t("columns.changes"),
        cell: ({ row }) =>
          row.original.has_changes ? (
            <FileDiffIcon className="size-4" aria-label={t("hasChanges")} role="img" />
          ) : null,
      },
    ],
    [t, format]
  );

  return (
    <>
      <ListPage
        list={list}
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        isLoading={range.ok && isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(row) => String(row.id)}
        hideKeyword
        filters={<AuditFilters key={JSON.stringify(list.params.filters)} filters={filters} onApply={(next) => list.setFilters(next as Parameters<typeof list.setFilters>[0])} />}
        emptyTitle={t("empty")}
      />
      <AuditDetailSheet
        entry={selected}
        onClose={() => setSelected(null)}
        onFilterRequest={(requestId) => {
          setSelected(null);
          list.setFilters({ request_id: requestId });
        }}
      />
    </>
  );
}
