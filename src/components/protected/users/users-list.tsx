"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type SetStateAction } from "react";
import { z } from "zod";

import { ListPage } from "@/components/global/list/list-page";
import { MultiSelectChecklist, type MultiSelectOption } from "@/components/global/multi-select-checklist";
import { OneTimeSecretDialog } from "@/components/global/one-time-secret-dialog";
import { PermissionGate } from "@/components/global/permission-gate";
import { CreateUserDialog } from "@/components/protected/users/create-user-dialog";
import { UserStateBadge } from "@/components/protected/users/user-state-badge";
import { Button } from "@/components/ui/button";
import { useRoles } from "@/hooks/use-roles";
import { useListParams } from "@/hooks/use-list-params";
import { useUsers } from "@/hooks/use-users";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import { MAX_FILTER_VALUES, type ListParamsConfig } from "@/lib/list-params";
import type { User } from "@/types/iam";

const USER_STATES = ["active", "invited", "disabled", "locked"] as const;

// "2,3" -> [2, 3]: a comma list of up to 10 positive ids; anything invalid drops the whole filter.
const roleIdsFilter = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.coerce.number().int().positive()).min(1).max(MAX_FILTER_VALUES))
  .optional();
const statesFilter = z
  .string()
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.enum(USER_STATES)).min(1).max(USER_STATES.length))
  .optional();

// URL state of the list: ?page=&limit=&keyword=&sort=&role_id=2,3&state=active,locked (doc/07 section 3.4).
// `sort` is the allow-list of GET /users; a column's id is its sort field. A module-level constant:
// `useListParams` needs a stable config object.
const USERS_LIST_CONFIG = {
  filters: { role_id: roleIdsFilter, state: statesFilter },
  sortable: ["name", "username", "email", "role", "last_login_at", "created_at"],
  defaultSort: "name",
} satisfies ListParamsConfig;

export function UsersList() {
  const t = useTranslations("users");
  const format = useFormatter();

  const list = useListParams(USERS_LIST_CONFIG);
  const [createOpen, setCreateOpen] = useState(false);
  // The one-time temporary password lives ONLY here, until the dialog is
  // confirmed with "Done" — never in the query cache or storage.
  const [issued, setIssued] = useState<{ username: string; password: string | null } | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useUsers(list.query);
  const roles = useRoles();

  const roleOptions = useMemo<MultiSelectOption[]>(
    () => (roles.data?.data ?? []).map((r) => ({ value: String(r.id), name: r.name })),
    [roles.data]
  );
  const stateOptions = useMemo<MultiSelectOption[]>(
    () => USER_STATES.map((st) => ({ value: st, name: t(`state.${st}`) })),
    [t]
  );
  // The URL is the state: the checklist reads the selected values from it and writes them back instantly.
  const toSelected = (values: readonly (string | number)[] | undefined, options: MultiSelectOption[]) =>
    (values ?? []).map((v) => options.find((o) => o.value === String(v)) ?? { value: String(v), name: String(v) });
  const selectedRoles = toSelected(list.params.filters.role_id, roleOptions);
  const selectedStates = toSelected(list.params.filters.state, stateOptions);

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: t("columns.name"),
        enableSorting: true,
        cell: ({ row }) => (
          <Link href={`/admin/users/${row.original.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      { id: "username", accessorKey: "username", header: t("columns.username"), enableSorting: true },
      {
        id: "email",
        accessorKey: "email",
        header: t("columns.email"),
        enableSorting: true,
        cell: ({ row }) => row.original.email ?? "—",
      },
      // The column id is the API sort field (`role`), the value shown is the role's name.
      { id: "role", accessorKey: "role_name", header: t("columns.role"), enableSorting: true },
      {
        id: "state",
        accessorKey: "state",
        header: t("columns.state"),
        cell: ({ row }) => (
          <UserStateBadge state={row.original.state} />
        ),
      },
      {
        id: "last_login_at",
        accessorKey: "last_login_at",
        header: t("columns.lastLogin"),
        enableSorting: true,
        cell: ({ row }) =>
          row.original.last_login_at
            ? format.dateTime(new Date(row.original.last_login_at), {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "—",
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
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={() => void refetch()}
        getRowId={(row) => String(row.id)}
        keywordPlaceholder={t("searchPlaceholder")}
        filters={
          <>
            <MultiSelectChecklist
              label={t("filters.role")}
              data={roleOptions}
              isLoading={roles.isLoading}
              instantApply
              selectedValues={selectedRoles}
              setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                const next = typeof action === "function" ? action(selectedRoles) : action;
                list.setFilters({ role_id: next.length ? next.map((o) => Number(o.value)) : undefined });
              }}
            />
            <MultiSelectChecklist
              label={t("filters.state")}
              data={stateOptions}
              instantApply
              selectedValues={selectedStates}
              setSelectedValues={(action: SetStateAction<MultiSelectOption[]>) => {
                const next = typeof action === "function" ? action(selectedStates) : action;
                list.setFilters({
                  state: next.length ? (next.map((o) => o.value) as (typeof USER_STATES)[number][]) : undefined,
                });
              }}
            />
          </>
        }
        primaryAction={
          <PermissionGate permission={PERMISSION_KEYS.IAM_USERS} action={PERMISSION_ACTIONS.CREATE}>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <UserPlusIcon />
              {t("create.open")}
            </Button>
          </PermissionGate>
        }
        emptyTitle={t("empty")}
      />

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={({ username, temporaryPassword }) =>
          setIssued({ username, password: temporaryPassword })
        }
      />
      {issued ? (
        <OneTimeSecretDialog
          secret={issued.password}
          onDone={() => setIssued(null)}
          title={t("temporaryPassword.title")}
          description={t("temporaryPassword.description", { username: issued.username })}
          label={t("temporaryPassword.label")}
          onceWarning={t("temporaryPassword.onceWarning")}
          unavailable={t("temporaryPassword.unavailable")}
          doneLabel={t("temporaryPassword.done")}
        />
      ) : null}
    </>
  );
}
