"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { ForbiddenState } from "@/components/global/states/forbidden-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { UserCommands } from "@/components/protected/users/user-commands";
import { UserEditForm } from "@/components/protected/users/user-edit-form";
import { UserHistory } from "@/components/protected/users/user-history";
import { UserStateBadge } from "@/components/protected/users/user-state-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUser } from "@/hooks/use-users";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import type { User } from "@/types/iam";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function SecurityFacts({ user }: { user: User }) {
  const t = useTranslations("users.detail.security");
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "—";
  return (
    <dl className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact label={t("lastLogin")} value={when(user.last_login_at)} />
      <Fact label={t("passwordChanged")} value={when(user.password_changed_at)} />
      <Fact label={t("mustChange")} value={user.must_change_password ? t("yes") : t("no")} />
      {user.state === "locked" ? <Fact label={t("lockedUntil")} value={when(user.locked_until)} /> : null}
      {user.invited_at ? <Fact label={t("invitedAt")} value={when(user.invited_at)} /> : null}
      {user.accepted_at ? <Fact label={t("acceptedAt")} value={when(user.accepted_at)} /> : null}
      <Fact label={t("createdAt")} value={when(user.created_at)} />
    </dl>
  );
}

// SCR-08 (doc/07 section 3.4): header + commands, tabs Profile / Security / History. Loading, NoPermission,
// not-found and error states as everywhere; the breadcrumb shows the user's name.
export function UserDetailView({ id }: { id: string }) {
  const t = useTranslations("users.detail");
  const query = useUser(id);
  // Bumped after "load the latest version" so the form drops my edits even if the ETag did not change.
  const [reloads, setReloads] = useState(0);
  const user = query.data?.data.data;
  const etag = query.data?.etag;
  const notFound = query.error ? parseApiError(query.error).status === 404 : false;
  useBreadcrumbTitle(query.isError ? null : user?.name);

  if (query.isLoading) return <EditorSkeleton />;
  if (query.error && isNoPermissionError(query.error)) return <ForbiddenState />;
  if (notFound) {
    return (
      <NotFoundState
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
        backHref="/admin/users"
        backLabel={t("backToList")}
      />
    );
  }
  if (query.error || !user) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-wide">{user.name}</h1>
            <UserStateBadge state={user.state} />
            <Badge variant="outline">{user.role_name}</Badge>
          </div>
          <p className="font-mono text-sm text-muted-foreground">{user.username}</p>
        </div>
        <UserCommands user={user} />
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{t("tabs.profile")}</TabsTrigger>
          <TabsTrigger value="security">{t("tabs.security")}</TabsTrigger>
          <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="pt-4">
          <UserEditForm
            key={`${etag ?? ""}|${user.updated_at}|${reloads}`}
            user={user}
            etag={etag}
            onReload={async () => {
              await query.refetch();
              setReloads((n) => n + 1);
            }}
          />
        </TabsContent>
        <TabsContent value="security" className="pt-4">
          <SecurityFacts user={user} />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <UserHistory userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
