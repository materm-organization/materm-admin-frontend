"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { SearchIcon, UserPlusIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { CustomPagination } from "@/components/global/custom-pagination";
import { DataTable } from "@/components/global/data-table";
import { CreateUserDialog } from "@/components/protected/users/create-user-dialog";
import { TemporaryPasswordDialog } from "@/components/protected/users/temporary-password-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHasAction } from "@/hooks/use-auth";
import { useUsers } from "@/hooks/use-users";
import { DEFAULT_PAGE, DEFAULT_PAGE_LIMIT } from "@/lib/constants/pagination";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";
import type { User, UserState } from "@/types/iam";

const STATE_VARIANT: Record<UserState, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  invited: "outline",
  disabled: "secondary",
  locked: "destructive",
};

export function UsersList() {
  const t = useTranslations("users");
  const format = useFormatter();
  const canCreate = useHasAction(PERMISSION_KEYS.IAM_USERS, PERMISSION_ACTIONS.CREATE);

  const [page, setPage] = useState(DEFAULT_PAGE);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  // The one-time temporary password lives ONLY here, until the dialog is
  // confirmed with "Done" — never in the query cache or storage.
  const [issued, setIssued] = useState<{ username: string; password: string | null } | null>(null);

  const { data, isLoading, isFetching } = useUsers({
    page,
    limit: DEFAULT_PAGE_LIMIT,
    keyword,
  });

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

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(searchInput.trim());
    setPage(DEFAULT_PAGE);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={submitSearch} className="flex gap-2" role="search">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            maxLength={100}
            className="w-full sm:w-72"
          />
          <Button type="submit" variant="outline">
            <SearchIcon />
            {t("search")}
          </Button>
        </form>
        {canCreate ? (
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <UserPlusIcon />
            {t("create.open")}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        skeletonRowCount={DEFAULT_PAGE_LIMIT}
        emptyTitle={t("empty")}
      />
      {data?.meta ? (
        <CustomPagination
          metaData={data.meta}
          onPageChange={setPage}
          isLoading={isFetching}
          rowLimit={DEFAULT_PAGE_LIMIT}
          setRowLimit={() => {}}
        />
      ) : null}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={({ username, temporaryPassword }) =>
          setIssued({ username, password: temporaryPassword })
        }
      />
      {issued ? (
        <TemporaryPasswordDialog
          username={issued.username}
          password={issued.password}
          onDone={() => setIssued(null)}
        />
      ) : null}
    </div>
  );
}
