"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { UserPlusIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ListPage } from "@/components/global/list/list-page";
import { OneTimeSecretDialog } from "@/components/global/one-time-secret-dialog";
import { PermissionGate } from "@/components/global/permission-gate";
import { CreateUserDialog } from "@/components/protected/users/create-user-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useUsers } from "@/hooks/use-users";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { ListParamsConfig } from "@/lib/list-params";
import type { User, UserState } from "@/types/iam";

const STATE_VARIANT: Record<UserState, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  invited: "outline",
  disabled: "secondary",
  locked: "destructive",
};

// URL state of the list: ?page=&limit=&keyword= (role/state filters and sort come with SCR-07, P1-W1).
// A module-level constant: `useListParams` needs a stable config object.
const USERS_LIST_CONFIG: ListParamsConfig = {};

export function UsersList() {
  const t = useTranslations("users");
  const format = useFormatter();

  const list = useListParams(USERS_LIST_CONFIG);
  const [createOpen, setCreateOpen] = useState(false);
  // The one-time temporary password lives ONLY here, until the dialog is
  // confirmed with "Done" — never in the query cache or storage.
  const [issued, setIssued] = useState<{ username: string; password: string | null } | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useUsers(list.query);

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      { accessorKey: "username", header: t("columns.username") },
      {
        accessorKey: "email",
        header: t("columns.email"),
        cell: ({ row }) => row.original.email ?? "—",
      },
      { accessorKey: "role_name", header: t("columns.role") },
      {
        accessorKey: "state",
        header: t("columns.state"),
        cell: ({ row }) => (
          <Badge variant={STATE_VARIANT[row.original.state] ?? "outline"}>
            {t(`state.${row.original.state}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "last_login_at",
        header: t("columns.lastLogin"),
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
