"use client";

import { LockIcon, PencilIcon, ShieldIcon, Trash2Icon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/global/confirm-dialog";
import { PermissionGate } from "@/components/global/permission-gate";
import { EditorSkeleton } from "@/components/global/states/editor-skeleton";
import { ErrorState } from "@/components/global/states/error-state";
import { ForbiddenState } from "@/components/global/states/forbidden-state";
import { NotFoundState } from "@/components/global/states/not-found-state";
import { useBreadcrumbTitle } from "@/components/layout/breadcrumb-context";
import { EditRoleDialog } from "@/components/protected/roles/edit-role-dialog";
import { RoleMatrixEditor } from "@/components/protected/roles/role-matrix-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiErrorHandler } from "@/hooks/use-api-error";
import { usePermissions } from "@/hooks/use-permissions";
import { useCan } from "@/hooks/use-permission";
import { useMutationDeleteRole, useRole } from "@/hooks/use-roles";
import { isNoPermissionError, parseApiError } from "@/lib/api-error";
import { PERMISSION_ACTIONS, PERMISSION_KEYS } from "@/lib/constants/permissions";

// SCR-10 (doc/07 section 3.5): header (name, key, badges, member count), the lock explanations, edit / delete
// and the permission matrix.
//  - every system role (`is_system`, including the super role) is READ-ONLY here, with a lock icon and an
//    explanation: matrix, name edit and delete are off (user decision: change what a group may do by creating a
//    custom role, e.g. by copying the system one). This is a UI rule only: the server still lets `iam.roles:update`
//    change the grants of a system role other than `is_super` (doc/05 section 3.2.6, 409 SYSTEM_ROLE_PROTECTED
//    for the super role), so it can be relaxed here without a backend change;
//  - without `iam.roles:update` the matrix is read-only too.
export function RoleDetailView({ id }: { id: string }) {
  const t = useTranslations("roles");
  const router = useRouter();
  const query = useRole(id);
  const catalog = usePermissions();
  const mutationDelete = useMutationDeleteRole();
  const { toastError } = useApiErrorHandler();
  const canUpdate = useCan(PERMISSION_KEYS.IAM_ROLES, PERMISSION_ACTIONS.UPDATE);

  // Bumped after "load the latest version": the editors are keyed by it, so my discarded edits are dropped
  // even when the server's version (ETag) did not change.
  const [reloads, setReloads] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [inUseCount, setInUseCount] = useState<number | null>(null);

  const role = query.data?.data.data;
  // System roles are locked, so their seeded English description is replaced by a translation when one exists
  // (`roles.systemDescriptions.<role_key>`); custom roles and unknown keys keep the backend text.
  const systemKey = role?.is_system ? `systemDescriptions.${role.role_key}` : null;
  const description = role ? (systemKey && t.has(systemKey) ? t(systemKey) : role.description) : "";
  const etag = query.data?.etag;
  const notFound = query.error ? parseApiError(query.error).status === 404 : false;
  // `null` = the page names nothing (404 / error): no extra breadcrumb level; `undefined` = loading.
  useBreadcrumbTitle(query.isError ? null : role?.name);

  if (query.isLoading) return <EditorSkeleton />;
  if (query.error && isNoPermissionError(query.error)) return <ForbiddenState />;
  if (notFound) {
    return (
      <NotFoundState
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        backHref="/admin/roles"
        backLabel={t("detail.backToList")}
      />
    );
  }
  if (query.error || !role) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} isRetrying={query.isFetching} />;
  }

  const locked = role.is_system || role.is_super;
  const reload = async () => {
    await query.refetch();
    setReloads((n) => n + 1);
  };
  const editorKey = `${etag ?? ""}|${role.updated_at ?? ""}|${reloads}`;

  const confirmDelete = async () => {
    try {
      await mutationDelete.mutateAsync(role.id);
      toast.success(t("delete.toast.success"));
      router.push("/admin/roles");
    } catch (error) {
      const parsed = parseApiError(error);
      if (parsed.code === "ROLE_IN_USE") {
        const count = Number(parsed.details?.user_count ?? role.user_count);
        setInUseCount(Number.isFinite(count) ? count : role.user_count);
        return; // resolves -> the confirm dialog closes, the "in use" dialog opens
      }
      toastError(error, t("delete.toast.error"));
      throw error; // keep the confirm dialog open
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-wide">{role.name}</h1>
            {role.is_super ? (
              <Badge variant="default" className="gap-1">
                <LockIcon /> {t("badges.super")}
              </Badge>
            ) : role.is_system ? (
              <Badge variant="secondary" className="gap-1">
                <LockIcon /> {t("badges.system")}
              </Badge>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{role.role_key}</span>
            <Link
              href={`/admin/users?role_id=${role.id}`}
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <UsersIcon className="size-3.5" aria-hidden />
              {t("detail.usersCount", { count: role.user_count })}
            </Link>
          </p>
          {description ? <p className="max-w-2xl text-sm">{description}</p> : null}
        </div>
        <div className="flex gap-2">
          <PermissionGate permission={PERMISSION_KEYS.IAM_ROLES} action={PERMISSION_ACTIONS.UPDATE}>
            {!locked ? (
              <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                <PencilIcon />
                {t("detail.editDetails")}
              </Button>
            ) : null}
          </PermissionGate>
          <PermissionGate permission={PERMISSION_KEYS.IAM_ROLES} action={PERMISSION_ACTIONS.DELETE}>
            {!role.is_system ? (
              <Button type="button" variant="outline" className="text-destructive" onClick={() => setDeleting(true)}>
                <Trash2Icon />
                {t("detail.delete")}
              </Button>
            ) : null}
          </PermissionGate>
        </div>
      </div>

      {role.is_super ? (
        <div role="note" className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <ShieldIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t("locks.superTitle")}</p>
            <p className="text-muted-foreground">{t("locks.superBody")}</p>
          </div>
        </div>
      ) : role.is_system ? (
        <div role="note" className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t("locks.systemTitle")}</p>
            <p className="text-muted-foreground">{t("locks.systemBody")}</p>
          </div>
        </div>
      ) : null}
      {!locked && !canUpdate ? (
        <p role="note" className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t("locks.readOnlyBody")}
        </p>
      ) : null}

      <RoleMatrixEditor
        key={editorKey}
        role={role}
        etag={etag}
        actions={catalog.data?.data.actions}
        readOnly={locked || !canUpdate}
        onReload={reload}
      />

      {editing ? (
        <EditRoleDialog
          key={editorKey}
          role={role}
          etag={etag}
          onClose={() => setEditing(false)}
          onReload={reload}
        />
      ) : null}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("delete.title", { name: role.name })}
        description={t("delete.description", { count: role.user_count })}
        confirmLabel={t("delete.confirm")}
        destructive
        requireTyping={role.role_key}
        onConfirm={confirmDelete}
      />

      <Dialog open={inUseCount !== null} onOpenChange={(open) => (!open ? setInUseCount(null) : undefined)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("delete.inUseTitle")}</DialogTitle>
            <DialogDescription>{t("delete.inUseBody", { count: inUseCount ?? 0 })}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setInUseCount(null)}>
              {t("delete.close")}
            </Button>
            <Button asChild>
              <Link href={`/admin/users?role_id=${role.id}`}>{t("delete.viewUsers")}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
