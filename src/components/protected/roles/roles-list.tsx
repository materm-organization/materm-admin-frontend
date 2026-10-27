"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { LockIcon, ShieldPlusIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ListPage } from "@/components/global/list/list-page";
import { PermissionGate } from "@/components/global/permission-gate";
import { CreateRoleDialog } from "@/components/protected/roles/create-role-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useRolesList } from "@/hooks/use-roles";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import type { RoleSummary } from "@/types/iam";

// URL state: ?page=&limit=&keyword=&sort= — the sort allow-list of GET /roles (doc/05 section 3.2.1).
const ROLES_LIST_CONFIG: ListParamsConfig = {
  sortable: ["sort_order", "name", "role_key", "user_count"],
  defaultSort: "sort_order",
};

export function RolesList() {
  const t = useTranslations("roles");
  const list = useListParams(ROLES_LIST_CONFIG);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useRolesList(list.query);

  const columns = useMemo<ColumnDef<RoleSummary>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => (
          <Link href={`/admin/roles/${row.original.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "role_key",
        accessorKey: "role_key",
        header: t("columns.roleKey"),
        enableSorting: true,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.role_key}</span>,
      },
      {
        id: "type",
        header: t("columns.type"),
        cell: ({ row }) =>
          row.original.is_super ? (
            <Badge className="gap-1">
              <LockIcon /> {t("badges.super")}
            </Badge>
          ) : row.original.is_system ? (
            <Badge variant="secondary" className="gap-1">
              <LockIcon /> {t("badges.system")}
            </Badge>
          ) : (
            <Badge variant="outline">{t("badges.custom")}</Badge>
          ),
      },
      {
        id: "user_count",
        accessorKey: "user_count",
        header: t("columns.users"),
        enableSorting: true,
        cell: ({ row }) => (
          <Link
            href={`/admin/users?role_id=${row.original.id}`}
            className="underline-offset-4 hover:underline"
            aria-label={t("columns.usersLink", { name: row.original.name, count: row.original.user_count })}
          >
            {row.original.user_count}
          </Link>
        ),
      },
      { id: "sort_order", accessorKey: "sort_order", header: t("columns.order"), enableSorting: true },
    ],
    [t]
  );

  return (
    <>
      <ListPage
        list={list}
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(row) => String(row.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        primaryAction={
          <PermissionGate permission={PERMISSION_KEYS.IAM_ROLES} action={PERMISSION_ACTIONS.CREATE}>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <ShieldPlusIcon />
              {t("create.open")}
            </Button>
          </PermissionGate>
        }
        emptyTitle={t("empty")}
      />
      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
